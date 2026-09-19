import 'reflect-metadata';
import { BadGatewayException, Logger, NotFoundException } from '@nestjs/common';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassificationLog, RequestNotFoundError } from '../src/requests/classification-log';
import { ClassificationProvider } from '../src/requests/classification-provider';
import { ClassificationService } from '../src/requests/classification.service';
import { KeywordClassifier } from '../src/requests/keyword-classifier';

const ID = '3f2b1c9e-8d4a-4e6b-9a1f-2c5d7e8f9a0b';

describe('ClassificationService', () => {
  const record = vi.fn();
  const log = { record, list: vi.fn() } satisfies ClassificationLog;

  const build = (provider: ClassificationProvider = new KeywordClassifier()) =>
    new ClassificationService(provider, log);
  const service = build();

  // The provider failures below are logged on purpose; keep the test output readable.
  beforeAll(() => {
    Logger.overrideLogger(false);
  });

  // A block body: a returned function would be run by Vitest as a teardown hook.
  beforeEach(() => {
    record.mockReset();
  });

  it('records an ad-hoc classification without a request', async () => {
    const response = await service.classify({ message: 'Please fix my invoice and payment charge' });

    expect(response).toEqual({ category: 'billing', confidence: 0.86, requestId: null });
    expect(record).toHaveBeenCalledWith({
      requestId: null,
      message: 'Please fix my invoice and payment charge',
      result: { category: 'billing', confidence: 0.86 },
      provider: 'keyword',
    });
  });

  it('treats a null requestId like a missing one', async () => {
    const dto = { message: 'Please fix my invoice', requestId: null } as unknown as {
      message: string;
    };

    expect((await service.classify(dto)).requestId).toBeNull();
    expect(record.mock.calls[0][0].requestId).toBeNull();
  });

  it('trims the message before classifying, and records the trimmed text', async () => {
    // Untrimmed, whitespace splitting sees three "words" and would skip the short-message rule.
    const response = await service.classify({ message: '   refund   ' });

    expect(response.confidence).toBeCloseTo(0.71, 10);
    expect(record.mock.calls[0][0].message).toBe('refund');
  });

  it('records the result after the rules for the given request, and echoes the requestId', async () => {
    const response = await service.classify({ message: 'refund', requestId: ID });

    expect(response).toEqual({ category: 'billing', confidence: response.confidence, requestId: ID });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      requestId: ID,
      message: 'refund',
      result: { category: 'billing', confidence: response.confidence },
      provider: 'keyword',
    });
    expect(response.confidence).toBeCloseTo(0.71, 10);
  });

  it('records the name of whichever provider answered', async () => {
    const other: ClassificationProvider = {
      name: 'test-llm',
      classify: () => ({ category: 'sales', confidence: 0.9 }),
    };

    await build(other).classify({ message: 'a long enough message' });

    expect(record.mock.calls[0][0]).toMatchObject({
      provider: 'test-llm',
      result: { category: 'sales' },
    });
  });

  it('accepts a provider that answers asynchronously', async () => {
    const slow = {
      name: 'slow',
      classify: async () => ({ category: 'support', confidence: 0.9 }),
    } satisfies ClassificationProvider;

    const response = await build(slow).classify({ message: 'a long enough message' });

    expect(response.category).toBe('support');
  });

  it('reports "unknown" when the provider is not confident enough', async () => {
    // KeywordClassifier can never trigger this rule; another provider could.
    const unsure: ClassificationProvider = {
      name: 'unsure',
      classify: () => ({ category: 'billing', confidence: 0.5 }),
    };

    const response = await build(unsure).classify({ message: 'a long enough message' });

    expect(response).toEqual({ category: 'unknown', confidence: 0.5, requestId: null });
    expect(record.mock.calls[0][0]).toMatchObject({
      provider: 'unsure',
      result: { category: 'unknown', confidence: 0.5 },
    });
  });

  it.each([
    ['an unknown category', { category: 'Billing', confidence: 0.8 }],
    ['a confidence above 1', { category: 'billing', confidence: 1.7 }],
    ['a negative confidence', { category: 'billing', confidence: -0.1 }],
    ['a NaN confidence', { category: 'billing', confidence: Number.NaN }],
    ['a confidence that is text', { category: 'billing', confidence: '0.8' }],
    ['no result at all', null],
    ['an empty result', {}],
  ])('rejects a provider that returns %s, and records nothing', async (_name, answer) => {
    const broken = { name: 'broken', classify: () => answer };

    await expect(
      build(broken as unknown as ClassificationProvider).classify({
        message: 'a long enough message',
        requestId: ID,
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(record).not.toHaveBeenCalled();
  });

  it('accepts the confidence bounds 0 and 1', async () => {
    for (const confidence of [0, 1]) {
      const edge: ClassificationProvider = {
        name: 'edge',
        classify: () => ({ category: 'billing', confidence }),
      };
      await build(edge).classify({ message: 'a long enough message' });
    }

    expect(record).toHaveBeenCalledTimes(2);
  });

  it('turns a provider failure into a bad gateway, and records nothing', async () => {
    const down = {
      name: 'down',
      classify: () => {
        throw new Error('connection refused');
      },
    };

    await expect(build(down).classify({ message: 'refund' })).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(record).not.toHaveBeenCalled();
  });

  it('turns an unknown request into a 404 with the same message', async () => {
    record.mockRejectedValue(new RequestNotFoundError(ID));

    const failure = await service.classify({ message: 'refund', requestId: ID }).catch((e) => e);

    expect(failure).toBeInstanceOf(NotFoundException);
    expect(failure.message).toBe(`Request ${ID} not found`);
  });

  it('lets any other storage failure through unchanged', async () => {
    const outage = new Error('connection terminated');
    record.mockRejectedValue(outage);

    await expect(service.classify({ message: 'refund', requestId: ID })).rejects.toBe(outage);
  });
});
