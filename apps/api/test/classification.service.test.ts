import 'reflect-metadata';
import { BadGatewayException, Logger, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassificationHistoryService } from '../src/requests/classification-history.service';
import { ClassificationProvider } from '../src/requests/classification-provider';
import { ClassificationService } from '../src/requests/classification.service';
import { KeywordClassifier } from '../src/requests/keyword-classifier';
import { RequestsService } from '../src/requests/requests.service';

const ID = '3f2b1c9e-8d4a-4e6b-9a1f-2c5d7e8f9a0b';

describe('ClassificationService', () => {
  const manager = { tag: 'transaction manager' } as unknown as EntityManager;
  const transaction = vi.fn(async (work: (m: EntityManager) => Promise<unknown>) => work(manager));
  const applyClassification = vi.fn();
  const record = vi.fn();

  const build = (provider: ClassificationProvider = new KeywordClassifier()) =>
    new ClassificationService(
      provider,
      { applyClassification } as unknown as RequestsService,
      { record } as unknown as ClassificationHistoryService,
      { transaction } as unknown as DataSource,
    );
  const service = build();

  // The provider failures below are logged on purpose; keep the test output readable.
  beforeAll(() => {
    Logger.overrideLogger(false);
  });

  // Block bodies: a returned function would be run by Vitest as a teardown hook.
  beforeEach(() => {
    applyClassification.mockReset();
    record.mockReset();
    transaction.mockClear();
  });

  it('records an ad-hoc classification without touching any request', async () => {
    const response = await service.classify({ message: 'Please fix my invoice and payment charge' });

    expect(response).toEqual({ category: 'billing', confidence: 0.86, requestId: null });
    expect(applyClassification).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(
      {
        requestId: null,
        message: 'Please fix my invoice and payment charge',
        category: 'billing',
        confidence: 0.86,
        provider: 'keyword',
      },
      manager,
    );
  });

  it('treats a null requestId like a missing one', async () => {
    const dto = { message: 'Please fix my invoice', requestId: null } as unknown as {
      message: string;
    };

    expect((await service.classify(dto)).requestId).toBeNull();
    expect(applyClassification).not.toHaveBeenCalled();
    expect(record.mock.calls[0][0].requestId).toBeNull();
  });

  it('trims the message before classifying, and records the trimmed text', async () => {
    // Untrimmed, whitespace splitting sees three "words" and would skip the short-message rule.
    const response = await service.classify({ message: '   refund   ' });

    expect(response.confidence).toBeCloseTo(0.71, 10);
    expect(record.mock.calls[0][0].message).toBe('refund');
  });

  it('applies the result to the request and records it in the same transaction', async () => {
    const response = await service.classify({ message: 'refund', requestId: ID });

    expect(response).toEqual({ category: 'billing', confidence: response.confidence, requestId: ID });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(applyClassification).toHaveBeenCalledWith(
      ID,
      { category: 'billing', confidence: response.confidence },
      manager,
    );
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toMatchObject({ requestId: ID, message: 'refund' });
    expect(record.mock.calls[0][1]).toBe(manager);
  });

  it('records the name of whichever provider answered', async () => {
    const other = { name: 'test-llm', classify: () => ({ category: 'sales', confidence: 0.9 }) };

    await build(other as ClassificationProvider).classify({ message: 'a long enough message' });

    expect(record.mock.calls[0][0]).toMatchObject({ provider: 'test-llm', category: 'sales' });
  });

  it('accepts a provider that answers asynchronously', async () => {
    const slow = {
      name: 'slow',
      classify: async () => ({ category: 'support', confidence: 0.9 }),
    };

    const response = await build(slow as ClassificationProvider).classify({
      message: 'a long enough message',
    });

    expect(response.category).toBe('support');
  });

  it('reports "unknown" when the provider is not confident enough', async () => {
    // KeywordClassifier can never trigger this rule; another provider could.
    const unsure = { name: 'unsure', classify: () => ({ category: 'billing', confidence: 0.5 }) };

    const response = await build(unsure as ClassificationProvider).classify({
      message: 'a long enough message',
    });

    expect(response).toEqual({ category: 'unknown', confidence: 0.5, requestId: null });
    expect(record.mock.calls[0][0]).toMatchObject({ category: 'unknown', provider: 'unsure' });
  });

  it.each([
    ['an unknown category', { category: 'Billing', confidence: 0.8 }],
    ['a confidence above 1', { category: 'billing', confidence: 1.7 }],
    ['a negative confidence', { category: 'billing', confidence: -0.1 }],
    ['a NaN confidence', { category: 'billing', confidence: Number.NaN }],
    ['a confidence that is text', { category: 'billing', confidence: '0.8' }],
    ['no result at all', null],
    ['an empty result', {}],
  ])('rejects a provider that returns %s, and persists nothing', async (_name, answer) => {
    const broken = { name: 'broken', classify: () => answer };

    await expect(
      build(broken as unknown as ClassificationProvider).classify({
        message: 'a long enough message',
        requestId: ID,
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(transaction).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('accepts the confidence bounds 0 and 1', async () => {
    for (const confidence of [0, 1]) {
      const edge = { name: 'edge', classify: () => ({ category: 'billing', confidence }) };
      await build(edge as ClassificationProvider).classify({ message: 'a long enough message' });
    }

    expect(record).toHaveBeenCalledTimes(2);
  });

  it('turns a provider failure into a bad gateway, and persists nothing', async () => {
    const down = {
      name: 'down',
      classify: () => {
        throw new Error('connection refused');
      },
    };

    await expect(
      build(down as unknown as ClassificationProvider).classify({ message: 'refund' }),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('lets a missing request surface as NotFoundException, and records nothing', async () => {
    applyClassification.mockRejectedValue(new NotFoundException());

    await expect(service.classify({ message: 'refund', requestId: ID })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(record).not.toHaveBeenCalled();
  });
});
