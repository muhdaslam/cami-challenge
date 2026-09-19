import 'reflect-metadata';
import { DataSource, Logger } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InitialSchema1710000000000 } from '../src/migrations/1710000000000-InitialSchema';
import { CustomerRequest } from '../src/requests/customer-request.entity';
import { RequestNote } from '../src/requests/request-note.entity';
import { TypeOrmRequestStore } from '../src/requests/typeorm-request-store';

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

const MISSING = '00000000-0000-4000-8000-000000000000';

// Needs a real Postgres (CI provides one via DATABASE_URL); skipped otherwise.
describe.skipIf(!process.env.DATABASE_URL)('TypeOrmRequestStore (Postgres)', () => {
  const counter = new QueryCounter();
  const fixtureIds: string[] = [];
  let ds: DataSource;
  let store: TypeOrmRequestStore;

  // Fixtures sit a day in the future so they sort ahead of any seeded rows; assertions
  // filter by fixture id so they hold with or without seed data.
  const base = Date.now() + 24 * 60 * 60_000;
  const at = (offsetMs: number) => new Date(base + offsetMs);

  async function insertRequest(message: string, createdAt: Date = new Date()): Promise<string> {
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
    store = new TypeOrmRequestStore(ds.getRepository(CustomerRequest));
  });

  afterAll(async () => {
    if (!ds?.isInitialized) {
      return;
    }
    // Notes are removed by ON DELETE CASCADE.
    await ds.query('DELETE FROM customer_requests WHERE id = ANY($1)', [fixtureIds]);
    await ds.destroy();
  });

  describe('list', () => {
    let olderId: string;
    let newerId: string;

    const listedFixtures = async () =>
      (await store.list()).filter((item) => fixtureIds.includes(item.id));

    beforeAll(async () => {
      olderId = await insertRequest('list test: has notes', at(0));
      // Inserted out of created_at order so "latest" is not simply the last row inserted.
      await insertNote(olderId, 'newest note', at(3_000));
      await insertNote(olderId, 'oldest note', at(1_000));
      await insertNote(olderId, 'middle note', at(2_000));

      newerId = await insertRequest('list test: no notes', at(60_000));
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

    it('returns every request when no limit is given', async () => {
      const [{ total }] = await ds.query<{ total: number }[]>(
        'SELECT count(*)::int AS total FROM customer_requests',
      );

      expect(await store.list()).toHaveLength(total);
    });

    it('bounds the query itself to the newest rows, unchanged', async () => {
      const all = await store.list();

      counter.queries.length = 0;
      const limited = await store.list(2);

      expect(limited).toEqual(all.slice(0, 2));
      // One statement with a LIMIT, not the full list sliced in JS.
      expect(counter.queries).toHaveLength(1);
      expect(counter.queries[0]).toMatch(/LIMIT 2\b/);
    });

    it('issues a single query however many requests and notes exist', async () => {
      counter.queries.length = 0;
      await store.list();
      const before = counter.queries.length;

      for (let i = 0; i < 5; i += 1) {
        const id = await insertRequest(`list test: extra ${i}`, at(120_000 + i));
        await insertNote(id, `extra note ${i}.a`, at(120_000 + i));
        await insertNote(id, `extra note ${i}.b`, at(121_000 + i));
      }

      counter.queries.length = 0;
      await store.list();
      const after = counter.queries.length;

      expect(before).toBe(1);
      expect(after).toBe(1);
    });
  });

  describe('findWithNotes', () => {
    it('returns the request with all its notes', async () => {
      const id = await insertRequest('find test: with notes');
      await insertNote(id, 'first note', at(1_000));
      await insertNote(id, 'second note', at(2_000));

      const found = await store.findWithNotes(id);

      expect(found).toMatchObject({ id, message: 'find test: with notes', status: 'open' });
      expect(found?.notes.map((note) => note.body).sort()).toEqual(['first note', 'second note']);
    });

    it('serialises to the same JSON shape the API has always returned', async () => {
      const id = await insertRequest('find test: shape');

      const json = JSON.parse(JSON.stringify(await store.findWithNotes(id)));

      expect(Object.keys(json)).toEqual([
        'id',
        'message',
        'status',
        'category',
        'confidence',
        'createdAt',
        'updatedAt',
        'notes',
      ]);
    });

    it('returns null when there is no such request', async () => {
      expect(await store.findWithNotes(MISSING)).toBeNull();
    });
  });

  describe('create', () => {
    it('stores an open, unclassified request and returns it', async () => {
      const created = await store.create('create test: new request');
      fixtureIds.push(created.id);

      expect(created).toMatchObject({
        message: 'create test: new request',
        status: 'open',
        category: null,
        confidence: null,
      });
      expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(created.createdAt).toBeInstanceOf(Date);

      const [row] = await ds.query('SELECT message, status FROM customer_requests WHERE id = $1', [created.id]);
      expect(row).toEqual({ message: 'create test: new request', status: 'open' });
    });
  });

  describe('updateStatus', () => {
    it('stores the new status and returns the request with its notes', async () => {
      const id = await insertRequest('status test: has a note');
      await insertNote(id, 'a note', at(1_000));

      const updated = await store.updateStatus(id, 'resolved');

      expect(updated).toMatchObject({ id, status: 'resolved' });
      expect(updated?.notes).toHaveLength(1);
      const [row] = await ds.query('SELECT status FROM customer_requests WHERE id = $1', [id]);
      expect(row.status).toBe('resolved');
    });

    it('returns null for a request that does not exist, and creates nothing', async () => {
      expect(await store.updateStatus(MISSING, 'resolved')).toBeNull();

      const [{ n }] = await ds.query('SELECT count(*)::int AS n FROM customer_requests WHERE id = $1', [MISSING]);
      expect(n).toBe(0);
    });
  });
});
