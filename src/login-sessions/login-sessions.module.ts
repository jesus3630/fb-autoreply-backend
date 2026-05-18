import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FbAccount } from '../accounts/fb-account.entity';
import { LoginSessionsService } from './login-sessions.service';
import { LoginSessionsController } from './login-sessions.controller';

@Module({
  imports: [TypeOrmModule.forFeature([FbAccount])],
  providers: [LoginSessionsService],
  controllers: [LoginSessionsController],
})
export class LoginSessionsModule {}
