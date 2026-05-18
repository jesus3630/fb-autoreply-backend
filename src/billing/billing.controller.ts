import { Controller, Post, Body, UseGuards, Req, Headers } from '@nestjs/common';
import { IsString } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { BillingService } from './billing.service';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

class CheckoutDto {
  @IsString() priceId: string;
}

@Controller('billing')
export class BillingController {
  constructor(
    private billing: BillingService,
    private config: ConfigService,
  ) {}

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  checkout(@CurrentUser() user: { id: string }, @Body() dto: CheckoutDto) {
    const base = this.config.get<string>('FRONTEND_URL');
    return this.billing.createCheckoutSession(user.id, dto.priceId, `${base}/dashboard?upgraded=1`, `${base}/pricing`);
  }

  @Post('portal')
  @UseGuards(JwtAuthGuard)
  portal(@CurrentUser() user: { id: string }) {
    const base = this.config.get<string>('FRONTEND_URL');
    return this.billing.createPortalSession(user.id, `${base}/dashboard`);
  }

  @Post('webhook')
  webhook(@Req() req: Request & { rawBody?: Buffer }, @Headers('stripe-signature') sig: string) {
    return this.billing.handleWebhook(req.rawBody ?? Buffer.alloc(0), sig);
  }
}
