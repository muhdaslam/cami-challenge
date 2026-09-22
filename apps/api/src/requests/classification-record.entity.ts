import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ClassificationCategory } from './classification-provider';
import { CustomerRequest } from './customer-request.entity';

/** One row per classification: an append-only log, never updated. */
@Entity({ name: 'classification_history' })
export class ClassificationRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => CustomerRequest, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'request_id' })
  request!: CustomerRequest | null;

  // Null for ad-hoc classifications that are not attached to a request.
  @Column({ name: 'request_id', type: 'uuid', nullable: true })
  requestId!: string | null;

  // The trimmed text that was classified.
  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'varchar', length: 32 })
  category!: ClassificationCategory;

  @Column({ type: 'float' })
  confidence!: number;

  // ClassificationProvider.name, e.g. "keyword".
  @Column({ type: 'varchar', length: 64 })
  provider!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
