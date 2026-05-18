import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private users: Repository<User>) {}

  findById(id: string) {
    return this.users.findOne({ where: { id }, relations: ['accounts', 'templates'] });
  }

  findByEmail(email: string) {
    return this.users.findOne({ where: { email } });
  }

  update(id: string, data: Partial<User>) {
    return this.users.update(id, data);
  }

  async getMe(id: string) {
    const user = await this.users.findOneOrFail({ where: { id } });
    return { id: user.id, email: user.email, name: user.name, tier: user.tier, createdAt: user.createdAt };
  }
}
