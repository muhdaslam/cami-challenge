import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassificationHistoryPage, ClassificationLog } from '../src/requests/classification-log';
import { ClassificationHistoryService } from '../src/requests/classification-history.service';
import { DEFAULT_HISTORY_LIMIT } from '../src/requests/history-query.dto';

const ID = '3f2b1c9e-8d4a-4e6b-9a1f-2c5d7e8f9a0b';

describe('ClassificationHistoryService', () => {
  const page: ClassificationHistoryPage = { items: [], total: 0 };
  const log = { record: vi.fn(), list: vi.fn() } satisfies ClassificationLog;
  const service = new ClassificationHistoryService(log);

  // A block body: a returned function would be run by Vitest as a teardown hook.
  beforeEach(() => {
    log.list.mockReset();
    log.list.mockResolvedValue(page);
  });

  it('applies the default limit when none is given', async () => {
    await service.list({});

    expect(log.list).toHaveBeenCalledWith({
      category: undefined,
      requestId: undefined,
      limit: DEFAULT_HISTORY_LIMIT,
    });
  });

  it('passes the filters and an explicit limit through', async () => {
    await service.list({ category: 'billing', requestId: ID, limit: 5 });

    expect(log.list).toHaveBeenCalledWith({ category: 'billing', requestId: ID, limit: 5 });
  });

  it('returns the log\'s page as it is', async () => {
    expect(await service.list({})).toBe(page);
  });
});
