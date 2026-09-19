import 'reflect-metadata';
import { DataSource, Logger } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InitialSchema1710000000000 } from '../src/migrations/1710000000000-InitialSchema';
import { CustomerRequest } from '../src/requests/customer-request.entity';
import { RequestNote } from '../src/requests/request-note.entity';
import { RequestsService } from '../src/requests/requests.service';

class QueryCounter implements Logger {
  queries: string[] = [];
  logQuery(query: string) {
    this.queries.push(query);
  }
  logQueryError() {}
  logQuerySlow() {}
  logSchemaBuild() {}
  logMigration() {}
  log() {}
}

// Needs a real Postgres (CI provides one via DATABASE_URL); skipped otherwise.
describe.skipIf(!process.env.DATABASE_URL)('RequestsService.list', () => {
  const counter = new QueryCounter();
  const fixtureIds: string[] = [];
  let ds: DataSource;
  let service: RequestsService;

  // Fixtures sit a day in the future so they sort ahead of any seeded rows; assertions
  // filter by fixture id so they hold with or without seed data.
  const base = Date.now() + 24 * 60 * 60_000;
  const at = (offsetMs: number) => new Date(base + offsetMs);

  async function insertRequest(message: string, createdAt: Date): Promise<string> {
    const [{ id }] = await ds.query<{ id: string }[]>(
      `INSERT INTO customer_requests (message, created_at, updated_at)
       VALUES ($1, $2, $2)
       RETURNING id`,
      [message, createdAt],
    );
    fixtureIds.push(id);
    return id;
  }

  async function insertNote(requestId: string, body: string, createdAt: Date) {
    await ds.query(
      `INSERT INTO request_notes (request_id, body, author_name, created_at)
       VALUES ($1, $2, 'Test', $3)`,
      [requestId, body, createdAt],
    );
  }

  async function listedFixtures() {
    const items = await service.list();
    return items.filter((item) => fixtureIds.includes(item.id));
  }

  let olderId: string;
  let newerId: string;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [CustomerRequest, RequestNote],
      migrations: [InitialSchema1710000000000],
      synchronize: false,
      logger: counter,
    });
    await ds.initialize();
    await ds.runMigrations();
    service = new RequestsService(ds.getRepository(CustomerRequest));

    olderId = await insertRequest('list test: has notes', at(0));
    // Inserted out of created_at order so "latest" is not simply the last row inserted.
    await insertNote(olderId, 'newest note', at(3_000));
    await insertNote(olderId, 'oldest note', at(1_000));
    await insertNote(olderId, 'middle note', at(2_000));

    newerId = await insertRequest('list test: no notes', at(60_000));
  });

  afterAll(async () => {
    if (!ds?.isInitialized) {
      return;
    }
    // Notes are removed by ON DELETE CASCADE.
    await ds.query('DELETE FROM customer_requests WHERE id = ANY($1)', [fixtureIds]);
    await ds.destroy();
  });

  it('lists requests without notes as noteCount 0 and no preview', async () => {
    const item = (await listedFixtures()).find((row) => row.id === newerId);

    expect(item).toBeDefined();
    expect(item?.noteCount).toBe(0);
    expect(item?.latestNotePreview).toBeNull();
  });

  it('reports the note count and the newest note by created_at', async () => {
    const item = (await listedFixtures()).find((row) => row.id === olderId);

    expect(item?.noteCount).toBe(3);
    expect(item?.latestNotePreview).toBe('newest note');
  });

  it('orders requests newest first and serialises timestamps as ISO strings', async () => {
    const items = await listedFixtures();

    expect(items.map((row) => row.id)).toEqual([newerId, olderId]);
    expect(items[0].createdAt).toBe(at(60_000).toISOString());
  });

  it('issues a single query however many requests and notes exist', async () => {
    counter.queries.length = 0;
    await service.list();
    const before = counter.queries.length;

    for (let i = 0; i < 5; i += 1) {
      const id = await insertRequest(`list test: extra ${i}`, at(120_000 + i));
      await insertNote(id, `extra note ${i}.a`, at(120_000 + i));
      await insertNote(id, `extra note ${i}.b`, at(121_000 + i));
    }

    counter.queries.length = 0;
    await service.list();
    const after = counter.queries.length;

    expect(before).toBe(1);
    expect(after).toBe(1);
  });
});
