import {
  Controller, Post, Get, Delete, Param, Body, UseGuards, Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { LoginSessionsService } from './login-sessions.service';

@Controller('accounts/:accountId/login-session')
@UseGuards(JwtAuthGuard)
export class LoginSessionsController {
  constructor(private svc: LoginSessionsService) {}

  @Post()
  start(@CurrentUser() user: { id: string }, @Param('accountId') accountId: string) {
    return this.svc.start(user.id, accountId);
  }

  @Get('screenshot')
  async screenshot(
    @CurrentUser() user: { id: string },
    @Param('accountId') accountId: string,
    @Res() res: Response,
  ) {
    const buf = await this.svc.getScreenshot(user.id, accountId);
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
    res.end(buf);
  }

  @Post('click')
  click(
    @CurrentUser() user: { id: string },
    @Param('accountId') accountId: string,
    @Body() body: { x: number; y: number },
  ) {
    return this.svc.click(user.id, accountId, body.x, body.y);
  }

  @Post('type')
  type(
    @CurrentUser() user: { id: string },
    @Param('accountId') accountId: string,
    @Body() body: { text: string },
  ) {
    return this.svc.type(user.id, accountId, body.text);
  }

  @Post('press')
  press(
    @CurrentUser() user: { id: string },
    @Param('accountId') accountId: string,
    @Body() body: { key: string },
  ) {
    return this.svc.press(user.id, accountId, body.key);
  }

  @Get('status')
  status(@CurrentUser() user: { id: string }, @Param('accountId') accountId: string) {
    return this.svc.getStatus(user.id, accountId);
  }

  @Delete()
  close(@CurrentUser() user: { id: string }, @Param('accountId') accountId: string) {
    return this.svc.close(user.id, accountId);
  }
}
