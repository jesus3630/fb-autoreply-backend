import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { IsString, IsOptional, IsBoolean } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TemplatesService } from './templates.service';

class CreateTemplateDto {
  @IsString() content: string;
}

class UpdateTemplateDto {
  @IsOptional() @IsString() content?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Controller('templates')
@UseGuards(JwtAuthGuard)
export class TemplatesController {
  constructor(private templates: TemplatesService) {}

  @Get()
  findAll(@CurrentUser() user: { id: string }) {
    return this.templates.findAll(user.id);
  }

  @Post()
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateTemplateDto) {
    return this.templates.create(user.id, dto.content);
  }

  @Put(':id')
  update(@CurrentUser() user: { id: string }, @Param('id') id: string, @Body() dto: UpdateTemplateDto) {
    return this.templates.update(user.id, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.templates.remove(user.id, id);
  }
}
