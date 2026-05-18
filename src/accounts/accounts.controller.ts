import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { IsString } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AccountsService } from './accounts.service';

class CreateAccountDto {
  @IsString() label: string;
}

class UpdateCookiesDto {
  @IsString() cookies: string;
}

@Controller('accounts')
@UseGuards(JwtAuthGuard)
export class AccountsController {
  constructor(private accounts: AccountsService) {}

  @Get()
  findAll(@CurrentUser() user: { id: string }) {
    return this.accounts.findAll(user.id);
  }

  @Post()
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateAccountDto) {
    return this.accounts.create(user.id, dto.label);
  }

  @Patch(':id/cookies')
  updateCookies(@CurrentUser() user: { id: string }, @Param('id') id: string, @Body() dto: UpdateCookiesDto) {
    return this.accounts.updateCookies(user.id, id, dto.cookies);
  }

  @Delete(':id')
  remove(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.accounts.remove(user.id, id);
  }
}
