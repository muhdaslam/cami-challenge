import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, FindOptionsWhere, Repository } from 'typeorm';
import {
  ClassificationEntry,
  ClassificationHistoryFilter,
  ClassificationHistoryPage,
  ClassificationLog,
  RequestNotFoundError,
} from './classification-log';
import { ClassificationRecord } from './classification-record.entity';
import { CustomerRequest } from './customer-request.entity';
import { classifiedRequest } from './request-lifecycle';

/** ClassificationLog on Postgres through TypeORM. */
@Injectable()
export class TypeOrmClassificationLog implements ClassificationLog {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ClassificationRecord)
    private readonly records: Repository<ClassificationRecord>,
  ) {}

  async record({ requestId, message, result, provider }: ClassificationEntry): Promise<void> {
    // The request update and its history row stand or fall together.
    await this.dataSource.transaction(async (manager) => {
      if (requestId) {
        const requests = manager.getRepository(CustomerRequest);
        const request = await requests.findOne({ where: { id: requestId } });
        if (!request) {
          throw new RequestNotFoundError(requestId);
        }
        Object.assign(request, classifiedRequest(request, result));
        await requests.save(request);
      }

      await manager.getRepository(ClassificationRecord).insert({
        requestId,
        message,
        category: result.category,
        confidence: result.confidence,
        provider,
      });
    });
  }

  async list({
    category,
    requestId,
    limit,
  }: ClassificationHistoryFilter): Promise<ClassificationHistoryPage> {
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
