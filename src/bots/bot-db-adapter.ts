import { Repository } from 'typeorm';
import { FbAccount, BotStatus } from '../accounts/fb-account.entity';
import { Template } from '../templates/template.entity';
import { ReplyLog } from '../analytics/reply-log.entity';

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

export class BotDbAdapter {
  constructor(
    private accounts: Repository<FbAccount>,
    private templates: Repository<Template>,
    private logs: Repository<ReplyLog>,
    private userId: string,
  ) {}

  async setAccountStatus(accountId: string, status: string, error: string | null) {
    await this.accounts.update(accountId, {
      status: status as BotStatus,
      lastError: error ?? undefined,
      lastSeenAt: new Date(),
    });
  }

  async wasRecentlyReplied(accountId: string, convoUrl: string): Promise<boolean> {
    const since = new Date(Date.now() - COOLDOWN_MS);
    const count = await this.logs.count({
      where: { accountId, conversationId: convoUrl },
    });
    if (!count) return false;

    const latest = await this.logs.findOne({
      where: { accountId, conversationId: convoUrl },
      order: { repliedAt: 'DESC' },
    });
    return !!latest && latest.repliedAt > since;
  }

  async markReplied(accountId: string, convoUrl: string, templateId: string | null) {
    // No-op here — insertLog handles the actual record. This just satisfies the bot interface.
  }

  async getNextTemplate(): Promise<{ id: string; body: string; use_count: number } | null> {
    const template = await this.templates.findOne({
      where: { userId: this.userId, isActive: true },
      order: { useCount: 'ASC' },
    });
    if (!template) return null;
    return { id: template.id, body: template.content, use_count: template.useCount };
  }

  async incrementTemplateUse(templateId: string) {
    await this.templates.increment({ id: templateId }, 'useCount', 1);
  }

  async insertLog(
    accountId: string,
    _label: string,
    convoUrl: string,
    templateId: string | null,
    templateBody: string,
    status: string,
    error: string | null,
  ) {
    if (status !== 'sent') return;
    const log = this.logs.create({
      accountId,
      conversationId: convoUrl,
      templateContent: templateBody,
    });
    await this.logs.save(log);
  }
}
