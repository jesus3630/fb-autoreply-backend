import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { FbAccount } from '../accounts/fb-account.entity';

@Entity('reply_logs')
export class ReplyLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  accountId: string;

  @ManyToOne(() => FbAccount, (account) => account.replyLogs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'accountId' })
  account: FbAccount;

  @Column()
  conversationId: string;

  @Column({ nullable: true })
  buyerName: string;

  @Column({ nullable: true, type: 'text' })
  messagePreview: string;

  @Column({ type: 'text' })
  templateContent: string;

  @CreateDateColumn()
  repliedAt: Date;
}
