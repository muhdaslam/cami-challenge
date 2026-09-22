import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { RequestListItem, RequestRecord, RequestStatus, RequestWithNotes } from './request-model';
import { REQUEST_STORE, RequestStore } from './request-store';

@Injectable()
export class RequestsService {
  constructor(@Inject(REQUEST_STORE) private readonly store: RequestStore) {}

  list(limit?: number): Promise<RequestListItem[]> {
    return this.store.list(limit);
  }

  async getById(id: string): Promise<RequestWithNotes> {
    return this.orNotFound(id, await this.store.findWithNotes(id));
  }

  create(message: string): Promise<RequestRecord> {
    return this.store.create(message);
  }

  async updateStatus(id: string, status: RequestStatus): Promise<RequestWithNotes> {
    return this.orNotFound(id, await this.store.updateStatus(id, status));
  }

  private orNotFound<T>(id: string, found: T | null): T {
    if (!found) {
      throw new NotFoundException(`Request ${id} not found`);
    }
    return found;
  }
}
