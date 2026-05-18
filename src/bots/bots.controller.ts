import { Controller, Post, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { BotsService } from './bots.service';

@Controller('bots')
@UseGuards(JwtAuthGuard)
export class BotsController {
  constructor(private bots: BotsService) {}

  @Get('status')
  getStatus(@CurrentUser() user: { id: string }) {
    return this.bots.getStatus(user.id);
  }

  @Post(':accountId/start')
  start(@CurrentUser() user: { id: string }, @Param('accountId') accountId: string) {
    return this.bots.start(user.id, accountId);
  }

  @Post(':accountId/stop')
  stop(@CurrentUser() user: { id: string }, @Param('accountId') accountId: string) {
    return this.bots.stop(user.id, accountId);
  }
}
