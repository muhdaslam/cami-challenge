import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KeywordClassifier } from '../src/requests/keyword-classifier';
import { RequestsController } from '../src/requests/requests.controller';
import { RequestsService } from '../src/requests/requests.service';

describe('RequestsController.list', () => {
  const list = vi.fn().mockResolvedValue([]);
  const controller = new RequestsController(
    { list } as unknown as RequestsService,
    new KeywordClassifier(),
  );

  beforeEach(() => list.mockClear());

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
