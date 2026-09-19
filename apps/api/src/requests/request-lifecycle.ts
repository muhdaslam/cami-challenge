import { ClassificationCategory, ClassificationResult } from './classification-provider';
import { RequestStatus } from './request-model';

/**
 * What classifying a request changes on it: it gets the result, and work on it has started.
 * Pure, so every store applies the same rule.
 */
export function classifiedRequest(
  request: { status: RequestStatus },
  { category, confidence }: ClassificationResult,
): { status: RequestStatus; category: ClassificationCategory; confidence: number } {
  return {
    category,
    confidence,
    status: request.status === 'open' ? 'in_progress' : request.status,
  };
}
