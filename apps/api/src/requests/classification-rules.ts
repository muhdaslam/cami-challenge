import { ClassificationResult } from './classification-provider';

// Fewer words than this counts as a "very short" message.
const SHORT_MESSAGE_WORDS = 3;
const SHORT_MESSAGE_PENALTY = 0.15;
const SHORT_MESSAGE_FLOOR = 0.5;
// Results below this confidence are reported as "unknown".
const MIN_CONFIDENCE = 0.55;

/**
 * Policy applied to whatever a classifier returns, so it holds for any provider.
 * `trimmed` is the message with surrounding whitespace removed.
 */
export function applyClassificationRules(
  result: ClassificationResult,
  trimmed: string,
): ClassificationResult {
  let next = result;

  // Soften confidence for very short messages.
  if (trimmed.split(/\s+/).length < SHORT_MESSAGE_WORDS && next.category !== 'unknown') {
    next = {
      category: next.category,
      confidence: Math.max(SHORT_MESSAGE_FLOOR, next.confidence - SHORT_MESSAGE_PENALTY),
    };
  }

  // Prefer "unknown" when confidence is weak.
  if (next.confidence < MIN_CONFIDENCE) {
    next = { category: 'unknown', confidence: next.confidence };
  }

  return next;
}
