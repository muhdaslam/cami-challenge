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

export type ClassificationHistoryFilter = {
  category?: ClassificationCategory;
  requestId?: string;
  limit: number;
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
  // Every match, ignoring `limit`.
  total: number;
};

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

  /** Newest first. */
  list(filter: ClassificationHistoryFilter): Promise<ClassificationHistoryPage>;
}

export const CLASSIFICATION_LOG = Symbol('CLASSIFICATION_LOG');
