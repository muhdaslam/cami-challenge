import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomerRequest } from './customer-request.entity';
import { RequestNote } from './request-note.entity';
import { RequestListItem, RequestRecord, RequestStatus, RequestWithNotes } from './request-model';
import { RequestStore } from './request-store';

// Raw driver row: `pg` returns bigint (COUNT) as a string and timestamptz as a Date.
type RequestListRow = Omit<RequestListItem, 'noteCount' | 'createdAt' | 'updatedAt'> & {
  noteCount: string;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * RequestStore on Postgres through TypeORM. The entities double as the plain records the port
 * promises (they are plain data classes), so they are returned as they are.
 */
@Injectable()
export class TypeOrmRequestStore implements RequestStore {
  constructor(
    @InjectRepository(CustomerRequest)
    private readonly requests: Repository<CustomerRequest>,
  ) {}

  async list(limit?: number): Promise<RequestListItem[]> {
    // Single statement: the note count and latest note are correlated sub-selects, so the
    // query count stays constant as requests and notes grow, and requests without notes
    // are still listed. `id` breaks created_at ties so the order is deterministic. With a
    // `limit` the sub-selects only run for the rows that are returned.
    const rows = await this.requests
      .createQueryBuilder('request')
      .select('request.id', 'id')
      .addSelect('request.message', 'message')
      .addSelect('request.status', 'status')
      .addSelect('request.category', 'category')
      .addSelect('request.confidence', 'confidence')
      .addSelect(
        (qb) =>
          qb
            .select('COUNT(*)')
            .from(RequestNote, 'note')
            .where('note.requestId = request.id'),
        'noteCount',
      )
      .addSelect(
        (qb) =>
          qb
            .select('note.body')
            .from(RequestNote, 'note')
            .where('note.requestId = request.id')
            .orderBy('note.createdAt', 'DESC')
            .addOrderBy('note.id', 'DESC')
            .limit(1),
        'latestNotePreview',
      )
      .addSelect('request.createdAt', 'createdAt')
      .addSelect('request.updatedAt', 'updatedAt')
      .orderBy('request.createdAt', 'DESC')
      .addOrderBy('request.id', 'DESC')
      .limit(limit)
      .getRawMany<RequestListRow>();

    return rows.map((row) => ({
      id: row.id,
      message: row.message,
      status: row.status,
      category: row.category,
      confidence: row.confidence,
      noteCount: Number(row.noteCount),
      latestNotePreview: row.latestNotePreview,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  findWithNotes(id: string): Promise<RequestWithNotes | null> {
    return this.findEntity(id);
  }

  create(message: string): Promise<RequestRecord> {
    const row = this.requests.create({
      message,
      status: 'open',
      category: null,
      confidence: null,
    });
    return this.requests.save(row);
  }

  async updateStatus(id: string, status: RequestStatus): Promise<RequestWithNotes | null> {
    const row = await this.findEntity(id);
    if (!row) {
      return null;
    }
    row.status = status;
    return this.requests.save(row);
  }

  private findEntity(id: string): Promise<CustomerRequest | null> {
    return this.requests.findOne({ where: { id }, relations: { notes: true } });
  }
}
