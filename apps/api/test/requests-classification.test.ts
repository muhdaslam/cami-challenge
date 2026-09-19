import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InitialSchema1710000000000 } from '../src/migrations/1710000000000-InitialSchema';
import { CustomerRequest } from '../src/requests/customer-request.entity';
import { RequestNote } from '../src/requests/request-note.entity';
import { RequestsService } from '../src/requests/requests.service';

// Needs a real Postgres (CI provides one via DATABASE_URL); skipped otherwise.
describe.skipIf(!process.env.DATABASE_URL)('RequestsService.applyClassification', () => {
  const fixtureIds: string[] = [];
  let ds: DataSource;
  let service: RequestsService;

  async function insertRequest(status: string): Promise<string> {
    const [{ id }] = await ds.query<{ id: string }[]>(
      `INSERT INTO customer_requests (message, status)
       VALUES ('classification test', $1)
       RETURNING id`,
      [status],
    );
    fixtureIds.push(id);
    return id;
  }

  async function stored(id: string) {
    const [row] = await ds.query<{ status: string; category: string | null; confidence: number | null }[]>(
      'SELECT status, category, confidence FROM customer_requests WHERE id = $1',
      [id],
    );
    return row;
  }

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [CustomerRequest, RequestNote],
      migrations: [InitialSchema1710000000000],
      synchronize: false,
    });
    await ds.initialize();
    await ds.runMigrations();
    service = new RequestsService(ds.getRepository(CustomerRequest));
  });

  afterAll(async () => {
    if (!ds?.isInitialized) {
      return;
    }
    await ds.query('DELETE FROM customer_requests WHERE id = ANY($1)', [fixtureIds]);
    await ds.destroy();
  });

  it('stores the category and confidence and moves an open request to in_progress', async () => {
    const id = await insertRequest('open');

    await service.applyClassification(id, { category: 'billing', confidence: 0.71 });

    expect(await stored(id)).toEqual({ status: 'in_progress', category: 'billing', confidence: 0.71 });
  });

  it.each(['in_progress', 'resolved'])('keeps the status of a %s request', async (status) => {
    const id = await insertRequest(status);

    await service.applyClassification(id, { category: 'sales', confidence: 0.65 });

    expect(await stored(id)).toEqual({ status, category: 'sales', confidence: 0.65 });
  });

  it('throws NotFoundException for an unknown request', async () => {
    await expect(
      service.applyClassification('00000000-0000-4000-8000-000000000000', {
        category: 'unknown',
        confidence: 0.4,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
