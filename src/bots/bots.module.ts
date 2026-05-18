import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FbAccount } from '../accounts/fb-account.entity';
import { BotsService } from './bots.service';
import { BotsController } from './bots.controller';
import { TemplatesModule } from '../templates/templates.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AccountsModule } from '../accounts/accounts.module';

@Module({
  imports: [TypeOrmModule.forFeature([FbAccount]), TemplatesModule, AnalyticsModule, AccountsModule],
  providers: [BotsService],
  controllers: [BotsController],
  exports: [BotsService],
})
export class BotsModule {}
