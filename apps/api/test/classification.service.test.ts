import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassificationService } from '../src/requests/classification.service';
import { KeywordClassifier } from '../src/requests/keyword-classifier';
import { RequestsService } from '../src/requests/requests.service';

const ID = '3f2b1c9e-8d4a-4e6b-9a1f-2c5d7e8f9a0b';

describe('ClassificationService', () => {
  const applyClassification = vi.fn();
  const requests = { applyClassification } as unknown as RequestsService;
  const service = new ClassificationService(new KeywordClassifier(), requests);

  // A block body: a returned function would be run by Vitest as a teardown hook.
  beforeEach(() => {
    applyClassification.mockReset();
  });

  it('classifies without persisting when there is no requestId', async () => {
    const response = await service.classify({ message: 'Please fix my invoice and payment charge' });

    expect(response).toEqual({ category: 'billing', confidence: 0.86, requestId: null });
    expect(applyClassification).not.toHaveBeenCalled();
  });

  it('treats a null requestId like a missing one', async () => {
    const dto = { message: 'Please fix my invoice', requestId: null } as unknown as {
      message: string;
    };

    expect((await service.classify(dto)).requestId).toBeNull();
    expect(applyClassification).not.toHaveBeenCalled();
  });

  it('trims the message before classifying', async () => {
    // Untrimmed, whitespace splitting sees three "words" and would skip the short-message rule.
    const response = await service.classify({ message: '   refund   ' });

    expect(response.confidence).toBeCloseTo(0.71, 10);
  });

  it('persists the result after the rules, and echoes the requestId', async () => {
    const response = await service.classify({ message: 'refund', requestId: ID });

    expect(response).toEqual({ category: 'billing', confidence: response.confidence, requestId: ID });
    expect(applyClassification).toHaveBeenCalledTimes(1);
    expect(applyClassification).toHaveBeenCalledWith(ID, {
      category: 'billing',
      confidence: response.confidence,
    });
    expect(response.confidence).toBeCloseTo(0.71, 10);
  });

  it('reports "unknown" when the provider is not confident enough', async () => {
    // KeywordClassifier can never trigger this rule; another provider could.
    const unsure = { classify: () => ({ category: 'billing', confidence: 0.5 }) };
    const withUnsureProvider = new ClassificationService(
      unsure as unknown as KeywordClassifier,
      requests,
    );

    const response = await withUnsureProvider.classify({ message: 'a long enough message' });

    expect(response).toEqual({ category: 'unknown', confidence: 0.5, requestId: null });
  });

  it('lets a missing request surface as NotFoundException', async () => {
    applyClassification.mockRejectedValue(new NotFoundException());

    await expect(service.classify({ message: 'refund', requestId: ID })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
