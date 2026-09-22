import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ClassificationHistoryFacets,
  ClassificationHistoryPage,
  ClassificationLog,
  InvalidCursorError,
} from '../src/requests/classification-log';
import { ClassificationHistoryService } from '../src/requests/classification-history.service';
import { DEFAULT_HISTORY_LIMIT } from '../src/requests/history-query.dto';

const ID = '3f2b1c9e-8d4a-4e6b-9a1f-2c5d7e8f9a0b';
const CURSOR = '9b1e6c2a-5d3f-4a7e-8c0b-1d2e3f4a5b6c';

describe('ClassificationHistoryService', () => {
  const page: ClassificationHistoryPage = { items: [], total: 0, nextCursor: null };
  const facets: ClassificationHistoryFacets = { category: [], provider: [] };
  const log = { record: vi.fn(), list: vi.fn(), facets: vi.fn() } satisfies ClassificationLog;
  const service = new ClassificationHistoryService(log);

  // A block body: a returned function would be run by Vitest as a teardown hook.
  beforeEach(() => {
    log.list.mockReset();
    log.list.mockResolvedValue(page);
    log.facets.mockReset();
    log.facets.mockResolvedValue(facets);
  });

  // Filters that only make sense together, which a single field's validation cannot see.
  const inconsistent = [
    ['a request together with adHoc=true', { requestId: ID, adHoc: true }, 'requestId cannot be combined with adHoc=true'],
    [
      'a range that ends before it starts',
      { from: '2026-09-20T00:00:00Z', to: '2026-09-19T00:00:00Z' },
      'from must be earlier than to',
    ],
    [
      'an empty range',
      { from: '2026-09-19T00:00:00Z', to: '2026-09-19T00:00:00Z' },
      'from must be earlier than to',
    ],
    [
      'a confidence range that is backwards',
      { minConfidence: 0.9, maxConfidence: 0.5 },
      'minConfidence must not be greater than maxConfidence',
    ],
  ] as const;

  describe('list', () => {
    it('applies the default limit when none is given', async () => {
      await service.list({});

      expect(log.list).toHaveBeenCalledWith(expect.objectContaining({ limit: DEFAULT_HISTORY_LIMIT }));
    });

    it('passes every filter through, with the dates turned into dates', async () => {
      await service.list({
        category: 'billing',
        provider: 'keyword',
        requestId: ID,
        from: '2026-09-19T10:00:00Z',
        to: '2026-09-20T10:00:00Z',
        minConfidence: 0.5,
        maxConfidence: 0.9,
        q: 'refund',
        limit: 5,
        cursor: CURSOR,
      });

      expect(log.list).toHaveBeenCalledWith({
        category: 'billing',
        provider: 'keyword',
        requestId: ID,
        adHoc: undefined,
        from: new Date('2026-09-19T10:00:00Z'),
        to: new Date('2026-09-20T10:00:00Z'),
        minConfidence: 0.5,
        maxConfidence: 0.9,
        text: 'refund',
        limit: 5,
        cursor: CURSOR,
      });
    });

    it('returns the log\'s page as it is', async () => {
      expect(await service.list({})).toBe(page);
    });

    it.each(inconsistent)('rejects %s, and asks the log nothing', async (_name, query, message) => {
      const failure = await service.list(query).catch((e) => e);

      expect(failure).toBeInstanceOf(BadRequestException);
      expect(failure.message).toBe(message);
      expect(log.list).not.toHaveBeenCalled();
    });

    it('accepts a request with adHoc=false, and equal confidence bounds', async () => {
      await service.list({ requestId: ID, adHoc: false, minConfidence: 0.7, maxConfidence: 0.7 });

      expect(log.list).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: ID, adHoc: false, minConfidence: 0.7, maxConfidence: 0.7 }),
      );
    });

    it('turns a cursor that points at nothing into a 400', async () => {
      log.list.mockRejectedValue(new InvalidCursorError());

      const failure = await service.list({ cursor: CURSOR }).catch((e) => e);

      expect(failure).toBeInstanceOf(BadRequestException);
      expect(failure.message).toBe('cursor does not point at a classification');
    });

    it('lets any other failure through unchanged', async () => {
      const outage = new Error('connection terminated');
      log.list.mockRejectedValue(outage);

      await expect(service.list({})).rejects.toBe(outage);
    });
  });

  describe('facets', () => {
    it('asks for the same filters, with no limit or cursor', async () => {
      await service.facets({ category: 'sales', provider: 'keyword', from: '2026-09-19T10:00:00Z', q: 'demo' });

      expect(log.facets).toHaveBeenCalledWith({
        category: 'sales',
        provider: 'keyword',
        requestId: undefined,
        adHoc: undefined,
        from: new Date('2026-09-19T10:00:00Z'),
        to: undefined,
        minConfidence: undefined,
        maxConfidence: undefined,
        text: 'demo',
      });
    });

    it('returns the log\'s facets as they are', async () => {
      expect(await service.facets({})).toBe(facets);
    });

    it.each(inconsistent)('rejects %s here too', async (_name, query, message) => {
      const failure = await Promise.resolve()
        .then(() => service.facets(query))
        .catch((e) => e);

      expect(failure).toBeInstanceOf(BadRequestException);
      expect(failure.message).toBe(message);
      expect(log.facets).not.toHaveBeenCalled();
    });
  });
});
