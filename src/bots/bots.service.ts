import { Injectable, Logger, NotFoundException, BadRequestException, OnModuleInit } from '@nestjs/common';
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

@Injectable()
export class BotsService implements OnModuleInit {
  private readonly logger = new Logger(BotsService.name);
  private running = new Map<string, RunningBot>();

  constructor(
    @InjectRepository(FbAccount) private accounts: Repository<FbAccount>,
    @InjectRepository(Template) private templates: Repository<Template>,
    @InjectRepository(ReplyLog) private logs: Repository<ReplyLog>,
    private accountsService: AccountsService,
  ) {}

  async onModuleInit() {
    const allAccounts = await this.accounts.find();
    this.logger.log(`onModuleInit: ${allAccounts.length} accounts — ${allAccounts.map(a => `${a.label}:${a.status}:cookies=${!!a.cookies}`).join(', ')}`);
    const runningAccounts = allAccounts.filter(a => a.status === BotStatus.RUNNING && a.cookies);
    if (runningAccounts.length === 0) {
      this.logger.log('No bots to auto-restart.');
      return;
    }
    this.logger.log(`Auto-restarting ${runningAccounts.length} bot(s) from previous session...`);
    for (const account of runningAccounts) {
      try {
        await this.start(account.userId, account.id);
      } catch (err) {
        this.logger.error(`Auto-restart failed for ${account.label}: ${(err as Error).message}`);
      }
    }
  }

  async start(userId: string, accountId: string) {
    const account = await this.accounts.findOne({ where: { id: accountId, userId } });
    if (!account) throw new NotFoundException('Account not found');
    if (!account.cookies) throw new BadRequestException('Paste your Facebook cookies before starting the bot.');
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
    });

    this.logger.log(`Bot started: ${account.label} (${accountId})`);
    return { status: 'started', accountId };
  }

  async stop(userId: string, accountId: string) {
    const account = await this.accounts.findOne({ where: { id: accountId, userId } });
    if (!account) throw new NotFoundException('Account not found');

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
}
