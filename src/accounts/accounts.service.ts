import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FbAccount } from './fb-account.entity';
import { User, TIER_LIMITS } from '../users/user.entity';

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(FbAccount) private accounts: Repository<FbAccount>,
    @InjectRepository(User) private users: Repository<User>,
  ) {}

  async findAll(userId: string) {
    return this.accounts.find({ where: { userId }, order: { createdAt: 'ASC' } });
  }

  async create(userId: string, label: string) {
    const user = await this.users.findOneOrFail({ where: { id: userId } });
    const limits = TIER_LIMITS[user.tier];
    const count = await this.accounts.count({ where: { userId } });

    if (limits.accounts !== -1 && count >= limits.accounts) {
      throw new ForbiddenException(`Your ${user.tier} plan allows ${limits.accounts} account(s). Upgrade to add more.`);
    }

    const account = this.accounts.create({ userId, label });
    return this.accounts.save(account);
  }

  async remove(userId: string, accountId: string) {
    const account = await this.accounts.findOne({ where: { id: accountId, userId } });
    if (!account) throw new NotFoundException('Account not found');
    await this.accounts.remove(account);
    return { success: true };
  }

  async updateStatus(accountId: string, status: FbAccount['status'], lastError?: string) {
    return this.accounts.update(accountId, { status, lastError: lastError ?? undefined, lastSeenAt: new Date() });
  }
}
