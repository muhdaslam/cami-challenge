import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassificationHistoryService } from '../src/requests/classification-history.service';
import { ClassificationService } from '../src/requests/classification.service';
import { RequestsController } from '../src/requests/requests.controller';
import { RequestsService } from '../src/requests/requests.service';

describe('RequestsController', () => {
  const list = vi.fn().mockResolvedValue([]);
  const classify = vi.fn();
  const listHistory = vi.fn();
  const controller = new RequestsController(
    { list } as unknown as RequestsService,
    { classify } as unknown as ClassificationService,
    { list: listHistory } as unknown as ClassificationHistoryService,
  );

  beforeEach(() => {
    list.mockClear();
    classify.mockReset();
    listHistory.mockReset();
  });

  describe('list', () => {
    it.each([0, -1])('rejects a limit of %i', (limit) => {
      expect(() => controller.list(limit)).toThrow(BadRequestException);
      expect(list).not.toHaveBeenCalled();
    });

    it('passes the limit through, or nothing when it is absent', async () => {
      await controller.list(5);
      await controller.list(undefined);

      expect(list.mock.calls).toEqual([[5], [undefined]]);
    });
  });

  describe('classify', () => {
    it('delegates to the classification service and returns its result', async () => {
      const dto = { message: 'refund', requestId: '3f2b1c9e-8d4a-4e6b-9a1f-2c5d7e8f9a0b' };
      const response = { category: 'billing', confidence: 0.71, requestId: dto.requestId };
      classify.mockResolvedValue(response);

      expect(await controller.classify(dto)).toBe(response);
      expect(classify).toHaveBeenCalledWith(dto);
    });
  });

  describe('history', () => {
    it('delegates the query to the history service and returns its page', async () => {
      const query = { category: 'billing' as const, limit: 5 };
      const page = { items: [], total: 0 };
      listHistory.mockResolvedValue(page);

      expect(await controller.history(query)).toBe(page);
      expect(listHistory).toHaveBeenCalledWith(query);
    });
  });
});
