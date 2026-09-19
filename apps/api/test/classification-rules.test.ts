import { describe, expect, it } from 'vitest';
import { applyClassificationRules } from '../src/requests/classification-rules';
import { ClassificationResult } from '../src/requests/keyword-classifier';

const result = (category: ClassificationResult['category'], confidence: number) => ({
  category,
  confidence,
});

describe('applyClassificationRules', () => {
  describe('short messages', () => {
    it('leaves messages of three or more words unchanged', () => {
      expect(applyClassificationRules(result('billing', 0.86), 'fix my invoice')).toEqual(
        result('billing', 0.86),
      );
    });

    it.each([
      ['billing', 0.86, 0.71],
      ['sales', 0.8, 0.65],
      ['support', 0.78, 0.63],
    ] as const)('softens %s (%d) to %d under three words', (category, from, to) => {
      const softened = applyClassificationRules(result(category, from), 'two words');

      expect(softened.category).toBe(category);
      expect(softened.confidence).toBeCloseTo(to, 10);
    });

    it('counts words split on any run of whitespace', () => {
      expect(applyClassificationRules(result('billing', 0.86), 'a\t\tb').confidence).toBeLessThan(0.86);
      expect(applyClassificationRules(result('billing', 0.86), 'a  b \n c').confidence).toBe(0.86);
    });

    it('does not soften "unknown"', () => {
      expect(applyClassificationRules(result('unknown', 0.4), 'hi')).toEqual(result('unknown', 0.4));
    });

    it('never softens below the 0.5 floor, and the weak-result rule then applies', () => {
      expect(applyClassificationRules(result('billing', 0.6), 'refund')).toEqual(
        result('unknown', 0.5),
      );
    });
  });

  describe('weak results', () => {
    it('reports "unknown" below 0.55 and keeps the confidence', () => {
      expect(applyClassificationRules(result('support', 0.54), 'one two three')).toEqual(
        result('unknown', 0.54),
      );
    });

    it('keeps a result at exactly 0.55', () => {
      expect(applyClassificationRules(result('support', 0.55), 'one two three')).toEqual(
        result('support', 0.55),
      );
    });
  });
});
