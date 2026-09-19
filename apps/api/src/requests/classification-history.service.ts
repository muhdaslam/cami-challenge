import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, FindOptionsWhere, Repository } from 'typeorm';
import { ClassificationCategory } from './classification-provider';
import { ClassificationRecord } from './classification-record.entity';
import {
  ClassificationHistoryPage,
  DEFAULT_HISTORY_LIMIT,
  HistoryQueryDto,
} from './history-query.dto';

export type NewClassificationRecord = {
  requestId: string | null;
  message: string;
  category: ClassificationCategory;
  confidence: number;
  provider: string;
};

@Injectable()
export class ClassificationHistoryService {
  constructor(
    @InjectRepository(ClassificationRecord)
    private readonly records: Repository<ClassificationRecord>,
  ) {}

  // Pass the manager of a running transaction to make this part of it.
  async record(entry: NewClassificationRecord, manager?: EntityManager): Promise<void> {
    const records = manager ? manager.getRepository(ClassificationRecord) : this.records;
    await records.insert(entry);
  }

  async list({
    category,
    requestId,
    limit = DEFAULT_HISTORY_LIMIT,
  }: HistoryQueryDto): Promise<ClassificationHistoryPage> {
    const where: FindOptionsWhere<ClassificationRecord> = {};
    if (category) {
      where.category = category;
    }
    if (requestId) {
      where.requestId = requestId;
    }

    // Newest first; `id` breaks created_at ties so the order is deterministic.
    const [rows, total] = await this.records.findAndCount({
      where,
      order: { createdAt: 'DESC', id: 'DESC' },
      take: limit,
    });

    return {
      items: rows.map((row) => ({
        id: row.id,
        requestId: row.requestId,
        message: row.message,
        category: row.category,
        confidence: row.confidence,
        provider: row.provider,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
    };
  }
}
