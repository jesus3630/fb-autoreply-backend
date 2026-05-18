import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AccountsModule } from './accounts/accounts.module';
import { TemplatesModule } from './templates/templates.module';
import { BotsModule } from './bots/bots.module';
import { BillingModule } from './billing/billing.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { User } from './users/user.entity';
import { FbAccount } from './accounts/fb-account.entity';
import { Template } from './templates/template.entity';
import { ReplyLog } from './analytics/reply-log.entity';

@Module({
  controllers: [AppController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        entities: [User, FbAccount, Template, ReplyLog],
        synchronize: true,
        logging: false,
      }),
    }),
    AuthModule,
    UsersModule,
    AccountsModule,
    TemplatesModule,
    BotsModule,
    BillingModule,
    AnalyticsModule,
  ],
})
export class AppModule {}
