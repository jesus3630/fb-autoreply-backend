import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { ReplyLog } from './reply-log.entity';

@Injectable()
export class AnalyticsService {
  constructor(@InjectRepository(ReplyLog) private logs: Repository<ReplyLog>) {}

  async logReply(accountId: string, conversationId: string, templateContent: string, buyerName?: string, messagePreview?: string) {
    const log = this.logs.create({ accountId, conversationId, templateContent, buyerName, messagePreview });
    return this.logs.save(log);
  }

  async getStats(userId: string, accountIds: string[]) {
    if (!accountIds.length) return { total: 0, thisMonth: 0, today: 0 };

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [total, thisMonth, today] = await Promise.all([
      this.logs.count({ where: accountIds.map((id) => ({ accountId: id })).reduce((q, c) => ({ ...q, ...c }), {}) }),
      this.logs.count({ where: accountIds.map((id) => ({ accountId: id, repliedAt: Between(monthStart, now) })) }),
      this.logs.count({ where: accountIds.map((id) => ({ accountId: id, repliedAt: Between(todayStart, now) })) }),
    ]);

    return { total, thisMonth, today };
  }

  getRecentLogs(accountId: string, limit = 50) {
    return this.logs.find({
      where: { accountId },
      order: { repliedAt: 'DESC' },
      take: limit,
    });
  }
}
