import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FbAccount } from '../accounts/fb-account.entity';
import { Template } from '../templates/template.entity';
import { ReplyLog } from '../analytics/reply-log.entity';
import { BotsService } from './bots.service';
import { BotsController } from './bots.controller';
import { AccountsModule } from '../accounts/accounts.module';

@Module({
  imports: [TypeOrmModule.forFeature([FbAccount, Template, ReplyLog]), AccountsModule],
  providers: [BotsService],
  controllers: [BotsController],
  exports: [BotsService],
})
export class BotsModule {}
