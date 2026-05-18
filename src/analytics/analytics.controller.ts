import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AnalyticsService } from './analytics.service';
import { FbAccount } from '../accounts/fb-account.entity';

@Controller('analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(
    private analytics: AnalyticsService,
    @InjectRepository(FbAccount) private accounts: Repository<FbAccount>,
  ) {}

  @Get('stats')
  async getStats(@CurrentUser() user: { id: string }) {
    const accounts = await this.accounts.find({ where: { userId: user.id } });
    const accountIds = accounts.map((a) => a.id);
    return this.analytics.getStats(user.id, accountIds);
  }

  @Get('logs/:accountId')
  getLogs(@CurrentUser() user: { id: string }, @Param('accountId') accountId: string, @Query('limit') limit?: string) {
    return this.analytics.getRecentLogs(accountId, limit ? parseInt(limit) : 50);
  }
}
