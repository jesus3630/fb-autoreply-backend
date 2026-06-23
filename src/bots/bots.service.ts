import { Injectable, Logger, NotFoundException, BadRequestException, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FbAccount, BotStatus } from '../accounts/fb-account.entity';
import { Template } from '../templates/template.entity';
import { ReplyLog } from '../analytics/reply-log.entity';
import { AccountsService } from '../accounts/accounts.service';
import { BotDbAdapter } from './bot-db-adapter';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const MessengerBot = require('./messenger-bot');

interface RunningBot {
  instance: any;
  userId: string;
  startedAt: Date;
}

// Watchdog tuning — the bot polls Messenger every 45s and writes a heartbeat
// (lastSeenAt) on each healthy poll. If a bot is gone from memory or its
// heartbeat goes stale, the watchdog restarts it (with backoff).
const WATCHDOG_INTERVAL_MS = 60_000; // how often to check health
const STALE_MS = 3 * 60_000;         // heartbeat older than this = hung bot
const BACKOFF_BASE_MS = 60_000;      // first retry delay after a failed restart
const BACKOFF_MAX_MS = 30 * 60_000;  // cap so we never hammer Facebook

interface RestartTrack {
  failures: number;
  nextAttempt: number; // epoch ms before which we won't retry
}

@Injectable()
export class BotsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BotsService.name);
  private running = new Map<string, RunningBot>();
  private restartTracking = new Map<string, RestartTrack>();
  private watchdogTimer: NodeJS.Timeout | null = null;
  private watchdogBusy = false;

  constructor(
    @InjectRepository(FbAccount) private accounts: Repository<FbAccount>,
    @InjectRepository(Template) private templates: Repository<Template>,
    @InjectRepository(ReplyLog) private logs: Repository<ReplyLog>,
    private accountsService: AccountsService,
  ) {}

  async onModuleInit() {
    const allAccounts = await this.accounts.find();
    this.logger.log(`onModuleInit: ${allAccounts.length} accounts — ${allAccounts.map(a => `${a.label}:${a.status}:active=${a.isActive}:cookies=${!!a.cookies}`).join(', ')}`);

    // An account should be running if the user marked it active, or (legacy) it
    // was left in RUNNING state when the server last stopped. Migrate the latter
    // onto the isActive flag so the watchdog owns it from here on.
    const toRestart = allAccounts.filter(a => (a.isActive || a.status === BotStatus.RUNNING) && a.cookies);
    if (toRestart.length > 0) {
      this.logger.log(`Auto-restarting ${toRestart.length} bot(s) from previous session...`);
      for (const account of toRestart) {
        try {
          await this.start(account.userId, account.id);
        } catch (err) {
          this.logger.error(`Auto-restart failed for ${account.label}: ${(err as Error).message}`);
        }
      }
    } else {
      this.logger.log('No bots to auto-restart.');
    }

    this.watchdogTimer = setInterval(() => {
      this.runWatchdog().catch(err => this.logger.error(`Watchdog tick failed: ${(err as Error).message}`));
    }, WATCHDOG_INTERVAL_MS);
    this.logger.log(`Watchdog armed (every ${WATCHDOG_INTERVAL_MS / 1000}s).`);
  }

  onModuleDestroy() {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
  }

  async start(userId: string, accountId: string) {
    const account = await this.accounts.findOne({ where: { id: accountId, userId } });
    if (!account) throw new NotFoundException('Account not found');
    if (!account.cookies) throw new BadRequestException('Paste your Facebook cookies before starting the bot.');
    // Mark intent to run — the watchdog keeps active accounts alive.
    if (!account.isActive) await this.accounts.update(accountId, { isActive: true });
    if (this.running.has(accountId)) return { status: 'already_running' };

    const templateCount = await this.templates.count({ where: { userId, isActive: true } });
    if (templateCount === 0) throw new BadRequestException('Add at least one reply template before starting the bot.');

    const db = new BotDbAdapter(this.accounts, this.templates, this.logs, userId);

    const botAccount = {
      id: accountId,
      label: account.label,
      cookies: account.cookies,
    };

    const bot = new MessengerBot(botAccount, db);
    this.running.set(accountId, { instance: bot, userId, startedAt: new Date() });
    await this.accountsService.updateStatus(accountId, BotStatus.RUNNING);

    bot.start().catch(async (err: Error) => {
      this.logger.error(`Bot crashed [${account.label}]: ${err.message}`);
      this.running.delete(accountId);
      await this.accountsService.updateStatus(accountId, BotStatus.ERROR, err.message);
      // Leave isActive=true so the watchdog can attempt recovery (with backoff).
    });

    this.logger.log(`Bot started: ${account.label} (${accountId})`);
    return { status: 'started', accountId };
  }

  async stop(userId: string, accountId: string) {
    const account = await this.accounts.findOne({ where: { id: accountId, userId } });
    if (!account) throw new NotFoundException('Account not found');

    // Clear intent first so the watchdog won't immediately restart it.
    await this.accounts.update(accountId, { isActive: false });
    this.restartTracking.delete(accountId);

    const running = this.running.get(accountId);
    if (running) {
      await running.instance.stop();
      this.running.delete(accountId);
    }

    await this.accountsService.updateStatus(accountId, BotStatus.STOPPED);
    this.logger.log(`Bot stopped: ${account.label} (${accountId})`);
    return { status: 'stopped', accountId };
  }

  async getStatus(userId: string) {
    const accounts = await this.accounts.find({ where: { userId } });
    return accounts.map((acc) => ({
      ...acc,
      isRunning: this.running.has(acc.id),
      hasCookies: !!acc.cookies,
      cookies: undefined, // never leak cookies to frontend
    }));
  }

  /**
   * Periodic health check. Any account the user marked active (and that has
   * cookies) must have a live, fresh bot. If it's missing from memory or its
   * heartbeat is stale, restart it — with exponential backoff so a permanently
   * broken account (e.g. expired session) doesn't hammer Facebook.
   */
  private async runWatchdog() {
    if (this.watchdogBusy) return;
    this.watchdogBusy = true;
    try {
      const active = await this.accounts.find({ where: { isActive: true } });
      const now = Date.now();

      for (const acc of active) {
        if (!acc.cookies) continue; // can't run without a session

        const live = this.running.has(acc.id);
        const lastSeen = acc.lastSeenAt ? new Date(acc.lastSeenAt).getTime() : 0;
        const stale = now - lastSeen > STALE_MS;
        const healthy = live && !stale;

        if (healthy) {
          this.restartTracking.delete(acc.id); // recovered — reset backoff
          continue;
        }

        const track = this.restartTracking.get(acc.id) ?? { failures: 0, nextAttempt: 0 };
        if (now < track.nextAttempt) continue; // still backing off

        // A hung bot is still in the map but not heartbeating — kill it first.
        if (live && stale) {
          this.logger.warn(`Watchdog: ${acc.label} hung (no heartbeat ${Math.round((now - lastSeen) / 1000)}s) — restarting.`);
          const r = this.running.get(acc.id);
          try { if (r) await r.instance.stop(); } catch { /* ignore */ }
          this.running.delete(acc.id);
        } else {
          this.logger.warn(`Watchdog: ${acc.label} not running (status=${acc.status}) — restarting (attempt ${track.failures + 1}).`);
        }

        // Schedule backoff before attempting, so repeated failures grow the delay.
        track.failures += 1;
        track.nextAttempt = now + Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (track.failures - 1));
        this.restartTracking.set(acc.id, track);

        this.start(acc.userId, acc.id).catch(err =>
          this.logger.error(`Watchdog restart failed for ${acc.label}: ${(err as Error).message}`),
        );
      }
    } finally {
      this.watchdogBusy = false;
    }
  }
}
