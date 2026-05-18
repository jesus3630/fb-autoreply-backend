import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { FbAccount } from '../accounts/fb-account.entity';
import { Template } from '../templates/template.entity';

export enum UserTier {
  STARTER = 'starter',
  PRO = 'pro',
  BUSINESS = 'business',
  AGENCY = 'agency',
}

export const TIER_LIMITS: Record<UserTier, { accounts: number; repliesPerMonth: number }> = {
  [UserTier.STARTER]: { accounts: 1, repliesPerMonth: 200 },
  [UserTier.PRO]: { accounts: 5, repliesPerMonth: -1 },
  [UserTier.BUSINESS]: { accounts: 20, repliesPerMonth: -1 },
  [UserTier.AGENCY]: { accounts: -1, repliesPerMonth: -1 },
};

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  password: string;

  @Column({ nullable: true })
  name: string;

  @Column({ type: 'enum', enum: UserTier, default: UserTier.STARTER })
  tier: UserTier;

  @Column({ nullable: true })
  stripeCustomerId: string;

  @Column({ nullable: true })
  stripeSubscriptionId: string;

  @Column({ nullable: true })
  stripeSubscriptionStatus: string;

  @Column({ nullable: true, type: 'timestamptz' })
  subscriptionEndsAt: Date;

  @OneToMany(() => FbAccount, (account) => account.user)
  accounts: FbAccount[];

  @OneToMany(() => Template, (template) => template.user)
  templates: Template[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
