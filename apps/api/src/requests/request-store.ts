import { RequestListItem, RequestRecord, RequestStatus, RequestWithNotes } from './request-model';

/**
 * What the requests use cases need from storage. It is shaped by those use cases, not by a
 * table: an adapter decides how each one is answered.
 */
export interface RequestStore {
  /** Newest first. `limit` bounds the rows; every request is returned when it is omitted. */
  list(limit?: number): Promise<RequestListItem[]>;

  /** Null when there is no such request. */
  findWithNotes(id: string): Promise<RequestWithNotes | null>;

  create(message: string): Promise<RequestRecord>;

  /** Null when there is no such request. */
  updateStatus(id: string, status: RequestStatus): Promise<RequestWithNotes | null>;
}

export const REQUEST_STORE = Symbol('REQUEST_STORE');
