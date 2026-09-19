import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestRecord, RequestWithNotes } from '../src/requests/request-model';
import { RequestStore } from '../src/requests/request-store';
import { RequestsService } from '../src/requests/requests.service';

const ID = '3f2b1c9e-8d4a-4e6b-9a1f-2c5d7e8f9a0b';

const record: RequestRecord = {
  id: ID,
  message: 'refund',
  status: 'open',
  category: null,
  confidence: null,
  createdAt: new Date('2026-09-19T10:00:00Z'),
  updatedAt: new Date('2026-09-19T10:00:00Z'),
};
const withNotes: RequestWithNotes = { ...record, notes: [] };

describe('RequestsService', () => {
  const store = {
    list: vi.fn(),
    findWithNotes: vi.fn(),
    create: vi.fn(),
    updateStatus: vi.fn(),
  } satisfies RequestStore;
  const service = new RequestsService(store);

  // A block body: a returned function would be run by Vitest as a teardown hook.
  beforeEach(() => {
    Object.values(store).forEach((fn) => fn.mockReset());
  });

  it('lists through the store and passes the limit along', async () => {
    store.list.mockResolvedValue([]);

    await service.list(5);
    await service.list();

    expect(store.list.mock.calls).toEqual([[5], [undefined]]);
  });

  it('returns the request the store finds', async () => {
    store.findWithNotes.mockResolvedValue(withNotes);

    expect(await service.getById(ID)).toBe(withNotes);
    expect(store.findWithNotes).toHaveBeenCalledWith(ID);
  });

  it('answers 404, naming the request, when there is none', async () => {
    store.findWithNotes.mockResolvedValue(null);

    const failure = await service.getById('missing').catch((e) => e);

    expect(failure).toBeInstanceOf(NotFoundException);
    expect(failure.message).toBe('Request missing not found');
  });

  it('creates through the store', async () => {
    store.create.mockResolvedValue(record);

    expect(await service.create('refund')).toBe(record);
    expect(store.create).toHaveBeenCalledWith('refund');
  });

  it('returns the request with its new status', async () => {
    const updated = { ...withNotes, status: 'resolved' as const };
    store.updateStatus.mockResolvedValue(updated);

    expect(await service.updateStatus(ID, 'resolved')).toBe(updated);
    expect(store.updateStatus).toHaveBeenCalledWith(ID, 'resolved');
  });

  it('answers 404 when the request to update does not exist', async () => {
    store.updateStatus.mockResolvedValue(null);

    const failure = await service.updateStatus('missing', 'resolved').catch((e) => e);

    expect(failure).toBeInstanceOf(NotFoundException);
    expect(failure.message).toBe('Request missing not found');
  });
});
