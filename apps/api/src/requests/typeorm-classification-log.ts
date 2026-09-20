import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import {
  ClassificationEntry,
  ClassificationHistoryFacets,
  ClassificationHistoryFilter,
  ClassificationHistoryPage,
  ClassificationHistoryQuery,
  ClassificationLog,
  InvalidCursorError,
  RequestNotFoundError,
} from './classification-log';
import { CLASSIFICATION_CATEGORIES, ClassificationCategory } from './classification-provider';
import { ClassificationRecord } from './classification-record.entity';
import { CustomerRequest } from './customer-request.entity';
import { classifiedRequest } from './request-lifecycle';

// LIKE treats % and _ as wildcards; a search for them must match them literally.
const escapeLike = (text: string) => text.replace(/[\\%_]/g, '\\$&');

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
    limit,
    cursor,
    ...filter
  }: ClassificationHistoryQuery): Promise<ClassificationHistoryPage> {
    const { total } = (await this.matching(filter)
      .select('COUNT(*)', 'total')
      .getRawOne<{ total: string }>()) ?? { total: '0' };

    // Newest first; `id` breaks created_at ties so the order is deterministic. The cursor is
    // the last row of the previous page, and "after" is judged against that row's own
    // created_at inside the database: a timestamp carried through JavaScript would lose the
    // microseconds Postgres keeps, and rows created within the same millisecond would be skipped.
    const page = this.matching(filter);
    if (cursor) {
      page.andWhere(
        '(r.created_at, r.id) < (SELECT c.created_at, c.id FROM classification_history c WHERE c.id = :cursor)',
        { cursor },
      );
    }
    // One row more than asked for tells whether there is a next page.
    const rows = await page
      .orderBy('r.createdAt', 'DESC')
      .addOrderBy('r.id', 'DESC')
      .limit(limit + 1)
      .getMany();

    if (cursor && rows.length === 0 && !(await this.records.existsBy({ id: cursor }))) {
      throw new InvalidCursorError();
    }

    const items = rows.slice(0, limit).map((row) => ({
      id: row.id,
      requestId: row.requestId,
      message: row.message,
      category: row.category,
      confidence: row.confidence,
      provider: row.provider,
      createdAt: row.createdAt.toISOString(),
    }));

    return {
      items,
      total: Number(total),
      nextCursor: rows.length > limit ? items[items.length - 1].id : null,
    };
  }

  async facets(filter: ClassificationHistoryFilter): Promise<ClassificationHistoryFacets> {
    const [categories, providers] = await Promise.all([
      this.matching(filter, 'category')
        .select('r.category', 'value')
        .addSelect('COUNT(*)', 'count')
        .groupBy('r.category')
        .getRawMany<{ value: ClassificationCategory; count: string }>(),
      this.matching(filter, 'provider')
        .select('r.provider', 'value')
        .addSelect('COUNT(*)', 'count')
        .groupBy('r.provider')
        .getRawMany<{ value: string; count: string }>(),
    ]);

    const perCategory = new Map(categories.map((row) => [row.value, Number(row.count)]));
    return {
      // Every category, so the choices do not jump around as other filters change.
      category: CLASSIFICATION_CATEGORIES.map((value) => ({
        value,
        count: perCategory.get(value) ?? 0,
      })),
      provider: providers
        .map((row) => ({ value: row.value, count: Number(row.count) }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
    };
  }

  // The rows the filters select. A facet leaves out its own filter, so it can offer the
  // alternatives to what is selected.
  private matching(
    filter: ClassificationHistoryFilter,
    leaveOut?: 'category' | 'provider',
  ): SelectQueryBuilder<ClassificationRecord> {
    const { category, provider, requestId, adHoc, from, to, minConfidence, maxConfidence, text } =
      filter;
    const query = this.records.createQueryBuilder('r');

    if (category && leaveOut !== 'category') {
      query.andWhere('r.category = :category', { category });
    }
    if (provider && leaveOut !== 'provider') {
      query.andWhere('r.provider = :provider', { provider });
    }
    if (requestId) {
      query.andWhere('r.requestId = :requestId', { requestId });
    }
    if (adHoc !== undefined) {
      query.andWhere(adHoc ? 'r.requestId IS NULL' : 'r.requestId IS NOT NULL');
    }
    if (from) {
      query.andWhere('r.createdAt >= :from', { from });
    }
    if (to) {
      query.andWhere('r.createdAt < :to', { to });
    }
    if (minConfidence !== undefined) {
      query.andWhere('r.confidence >= :minConfidence', { minConfidence });
    }
    if (maxConfidence !== undefined) {
      query.andWhere('r.confidence <= :maxConfidence', { maxConfidence });
    }
    if (text) {
      query.andWhere("r.message ILIKE :pattern ESCAPE '\\'", { pattern: `%${escapeLike(text)}%` });
    }
    return query;
  }
}
