import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { User } from '../users/user.entity';
import { ReplyLog } from '../analytics/reply-log.entity';

export enum BotStatus {
  IDLE = 'idle',
  RUNNING = 'running',
  STOPPED = 'stopped',
  ERROR = 'error',
}

@Entity('fb_accounts')
export class FbAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => User, (user) => user.accounts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  label: string;

  @Column({ default: false })
  isActive: boolean;

  @Column({ type: 'enum', enum: BotStatus, default: BotStatus.IDLE })
  status: BotStatus;

  @Column({ nullable: true })
  lastError: string;

  @Column({ nullable: true, type: 'timestamptz' })
  lastSeenAt: Date;

  @OneToMany(() => ReplyLog, (log) => log.account)
  replyLogs: ReplyLog[];

  @CreateDateColumn()
  createdAt: Date;
}
