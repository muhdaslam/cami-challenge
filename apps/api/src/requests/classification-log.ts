import { ClassificationCategory, ClassificationResult } from './classification-provider';

export type ClassificationEntry = {
  /** The request the result is applied to; null for an ad-hoc classification. */
  requestId: string | null;
  /** The trimmed text that was classified. */
  message: string;
  /** The final result, after the policy rules. */
  result: ClassificationResult;
  /** ClassificationProvider.name */
  provider: string;
};

/** Every filter is optional, and they combine with AND. */
export type ClassificationHistoryFilter = {
  category?: ClassificationCategory;
  /** The exact provider name. */
  provider?: string;
  requestId?: string;
  /** True: only classifications that belong to no request. False: only those that do. */
  adHoc?: boolean;
  /** Created at or after this moment. */
  from?: Date;
  /** Created before this moment. */
  to?: Date;
  minConfidence?: number;
  maxConfidence?: number;
  /** A case-insensitive substring of the classified text. */
  text?: string;
};

export type ClassificationHistoryQuery = ClassificationHistoryFilter & {
  limit: number;
  /** The `nextCursor` of the previous page: continue after that row. */
  cursor?: string;
};

export type ClassificationHistoryItem = {
  id: string;
  requestId: string | null;
  message: string;
  category: ClassificationCategory;
  confidence: number;
  provider: string;
  createdAt: string;
};

export type ClassificationHistoryPage = {
  items: ClassificationHistoryItem[];
  // Every match, ignoring `limit` and `cursor`.
  total: number;
  /** Pass it as `cursor` to get the next page; null on the last page. */
  nextCursor: string | null;
};

export type FacetCount<T extends string = string> = { value: T; count: number };

/** How many classifications match per value, under every filter except that facet's own. */
export type ClassificationHistoryFacets = {
  category: FacetCount<ClassificationCategory>[];
  provider: FacetCount[];
};

/** The cursor does not point at a history row (for instance, its request was deleted). */
export class InvalidCursorError extends Error {
  constructor() {
    super('cursor does not point at a classification');
    this.name = 'InvalidCursorError';
  }
}

/** A classification was meant for a request that does not exist. */
export class RequestNotFoundError extends Error {
  constructor(readonly requestId: string) {
    super(`Request ${requestId} not found`);
    this.name = 'RequestNotFoundError';
  }
}

/**
 * The classification history, and the one write that has to stay consistent with it. Recording
 * a classification touches two things (the request it is applied to and the history) and both
 * must change together, so a single port owns that.
 */
export interface ClassificationLog {
  /**
   * Applies the result to the request, when there is one, and appends it to the history. Both
   * happen or neither does.
   * @throws RequestNotFoundError when `requestId` does not exist; nothing is recorded then.
   */
  record(entry: ClassificationEntry): Promise<void>;

  /**
   * Newest first. Pages follow each other by cursor, which stays correct while new rows arrive.
   * @throws InvalidCursorError when `cursor` does not point at a row.
   */
  list(query: ClassificationHistoryQuery): Promise<ClassificationHistoryPage>;

  facets(filter: ClassificationHistoryFilter): Promise<ClassificationHistoryFacets>;
}

export const CLASSIFICATION_LOG = Symbol('CLASSIFICATION_LOG');
