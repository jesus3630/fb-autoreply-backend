import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Template } from './template.entity';

@Injectable()
export class TemplatesService {
  constructor(@InjectRepository(Template) private templates: Repository<Template>) {}

  findAll(userId: string) {
    return this.templates.find({ where: { userId }, order: { useCount: 'ASC', createdAt: 'ASC' } });
  }

  create(userId: string, content: string) {
    const template = this.templates.create({ userId, content });
    return this.templates.save(template);
  }

  async update(userId: string, id: string, data: Partial<Template>) {
    const template = await this.templates.findOne({ where: { id, userId } });
    if (!template) throw new NotFoundException('Template not found');
    Object.assign(template, data);
    return this.templates.save(template);
  }

  async remove(userId: string, id: string) {
    const template = await this.templates.findOne({ where: { id, userId } });
    if (!template) throw new NotFoundException('Template not found');
    await this.templates.remove(template);
    return { success: true };
  }

  async getLeastUsed(userId: string): Promise<Template | null> {
    return this.templates.findOne({
      where: { userId, isActive: true },
      order: { useCount: 'ASC' },
    });
  }

  async incrementUseCount(id: string) {
    await this.templates.increment({ id }, 'useCount', 1);
  }
}
