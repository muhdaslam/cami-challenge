export const CLASSIFICATION_CATEGORIES = ['support', 'sales', 'billing', 'unknown'] as const;

export type ClassificationCategory = (typeof CLASSIFICATION_CATEGORIES)[number];

export type ClassificationResult = {
  category: ClassificationCategory;
  confidence: number;
};

/**
 * Anything that can classify a customer message: the keyword classifier today, an LLM later.
 * A provider returns its own opinion only. Policy such as softening short messages lives in
 * ClassificationService, so it holds for every provider.
 */
export interface ClassificationProvider {
  /** Stored with every classification, e.g. "keyword" or a model plus prompt version. */
  readonly name: string;
  classify(message: string): ClassificationResult | Promise<ClassificationResult>;
}

export const CLASSIFICATION_PROVIDER = Symbol('CLASSIFICATION_PROVIDER');

/** A provider is external input as far as this app is concerned: check it before trusting it. */
export function isClassificationResult(value: unknown): value is ClassificationResult {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { category, confidence } = value as Record<string, unknown>;
  return (
    CLASSIFICATION_CATEGORIES.includes(category as ClassificationCategory) &&
    typeof confidence === 'number' &&
    Number.isFinite(confidence) &&
    confidence >= 0 &&
    confidence <= 1
  );
}
