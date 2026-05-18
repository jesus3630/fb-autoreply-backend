import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FbAccount, BotStatus } from '../accounts/fb-account.entity';
import { TemplatesService } from '../templates/templates.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { AccountsService } from '../accounts/accounts.service';

interface BotWorker {
  accountId: string;
  userId: string;
  status: BotStatus;
  process: ReturnType<typeof import('child_process').spawn> | null;
  startedAt: Date;
}

@Injectable()
export class BotsService {
  private readonly logger = new Logger(BotsService.name);
  private workers = new Map<string, BotWorker>();

  constructor(
    @InjectRepository(FbAccount) private accounts: Repository<FbAccount>,
    private templatesService: TemplatesService,
    private analyticsService: AnalyticsService,
    private accountsService: AccountsService,
  ) {}

  async start(userId: string, accountId: string) {
    const account = await this.accounts.findOne({ where: { id: accountId, userId } });
    if (!account) throw new NotFoundException('Account not found');
    if (this.workers.has(accountId)) return { status: 'already_running' };

    const worker: BotWorker = {
      accountId,
      userId,
      status: BotStatus.RUNNING,
      process: null,
      startedAt: new Date(),
    };

    this.workers.set(accountId, worker);
    await this.accountsService.updateStatus(accountId, BotStatus.RUNNING);
    this.logger.log(`Bot started for account ${accountId}`);

    return { status: 'started', accountId };
  }

  async stop(userId: string, accountId: string) {
    const account = await this.accounts.findOne({ where: { id: accountId, userId } });
    if (!account) throw new NotFoundException('Account not found');

    const worker = this.workers.get(accountId);
    if (worker?.process) {
      worker.process.kill();
    }

    this.workers.delete(accountId);
    await this.accountsService.updateStatus(accountId, BotStatus.STOPPED);
    this.logger.log(`Bot stopped for account ${accountId}`);

    return { status: 'stopped', accountId };
  }

  getRunningAccounts(userId: string): string[] {
    return Array.from(this.workers.values())
      .filter((w) => w.userId === userId)
      .map((w) => w.accountId);
  }

  async getStatus(userId: string) {
    const accounts = await this.accounts.find({ where: { userId } });
    return accounts.map((acc) => ({
      ...acc,
      isRunning: this.workers.has(acc.id),
    }));
  }

  async recordReply(accountId: string, conversationId: string, templateContent: string, buyerName?: string, messagePreview?: string) {
    await this.analyticsService.logReply(accountId, conversationId, templateContent, buyerName, messagePreview);
    this.logger.log(`Reply logged for account ${accountId}, conversation ${conversationId}`);
  }
}
