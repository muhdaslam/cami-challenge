import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, FindOptionsRelations, Repository } from 'typeorm';
import { ClassificationResult } from './classification-provider';
import { CustomerRequest, RequestStatus } from './customer-request.entity';
import { RequestNote } from './request-note.entity';

export type RequestListItem = {
  id: string;
  message: string;
  status: RequestStatus;
  category: string | null;
  confidence: number | null;
  noteCount: number;
  latestNotePreview: string | null;
  createdAt: string;
  updatedAt: string;
};

// Raw driver row: `pg` returns bigint (COUNT) as a string and timestamptz as a Date.
type RequestListRow = Omit<RequestListItem, 'noteCount' | 'createdAt' | 'updatedAt'> & {
  noteCount: string;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class RequestsService {
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

  async getById(id: string): Promise<CustomerRequest> {
    return this.findOrFail(id, { notes: true });
  }

  // Pass the manager of a running transaction to make this part of it.
  async applyClassification(
    id: string,
    { category, confidence }: ClassificationResult,
    manager?: EntityManager,
  ): Promise<void> {
    const requests = manager ? manager.getRepository(CustomerRequest) : this.requests;
    const row = await this.findOrFail(id, undefined, requests);
    row.category = category;
    row.confidence = confidence;
    // Classifying a request means work on it has started.
    if (row.status === 'open') {
      row.status = 'in_progress';
    }
    await requests.save(row);
  }

  async updateStatus(id: string, status: RequestStatus): Promise<CustomerRequest> {
    const row = await this.getById(id);
    row.status = status;
    return this.requests.save(row);
  }

  async create(message: string): Promise<CustomerRequest> {
    const row = this.requests.create({
      message,
      status: 'open',
      category: null,
      confidence: null,
    });
    return this.requests.save(row);
  }

  private async findOrFail(
    id: string,
    relations?: FindOptionsRelations<CustomerRequest>,
    requests: Repository<CustomerRequest> = this.requests,
  ): Promise<CustomerRequest> {
    const row = await requests.findOne({ where: { id }, relations });
    if (!row) {
      throw new NotFoundException(`Request ${id} not found`);
    }
    return row;
  }
}
