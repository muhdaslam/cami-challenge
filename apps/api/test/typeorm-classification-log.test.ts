import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDataSource } from '../src/data-source';
import {
  ClassificationEntry,
  InvalidCursorError,
  RequestNotFoundError,
} from '../src/requests/classification-log';
import { ClassificationCategory } from '../src/requests/classification-provider';
import { ClassificationRecord } from '../src/requests/classification-record.entity';
import { ClassificationService } from '../src/requests/classification.service';
import { KeywordClassifier } from '../src/requests/keyword-classifier';
import { TypeOrmClassificationLog } from '../src/requests/typeorm-classification-log';

// Every message starts with this so cleanup can find them.
const PREFIX = 'history test:';
const UNKNOWN_REQUEST = '00000000-0000-4000-8000-000000000000';

// Needs a real Postgres (CI provides one via DATABASE_URL); skipped otherwise.
describe.skipIf(!process.env.DATABASE_URL)('TypeOrmClassificationLog (Postgres)', () => {
  const requestIds: string[] = [];
  let ds: DataSource;
  let log: TypeOrmClassificationLog;

  async function insertRequest(status = 'open'): Promise<string> {
    const [{ id }] = await ds.query<{ id: string }[]>(
      `INSERT INTO customer_requests (message, status) VALUES ('history test request', $1) RETURNING id`,
      [status],
    );
    requestIds.push(id);
    return id;
  }

  const entry = (
    requestId: string | null,
    message: string,
    category: ClassificationCategory = 'billing',
    confidence = 0.86,
    provider = 'keyword',
  ): ClassificationEntry => ({ requestId, message, result: { category, confidence }, provider });

  const rowsWithMessage = (message: string) =>
    ds.query<{ request_id: string | null; category: string; provider: string }[]>(
      'SELECT request_id, category, provider FROM classification_history WHERE message = $1',
      [message],
    );

  const storedRequest = async (id: string) =>
    (
      await ds.query('SELECT status, category, confidence FROM customer_requests WHERE id = $1', [id])
    )[0];

  beforeAll(async () => {
    ds = createDataSource();
    await ds.initialize();
    await ds.runMigrations();
    log = new TypeOrmClassificationLog(ds, ds.getRepository(ClassificationRecord));
  });

  afterAll(async () => {
    if (!ds?.isInitialized) {
      return;
    }
    await ds.query('DELETE FROM classification_history WHERE message LIKE $1', [`${PREFIX}%`]);
    await ds.query('DELETE FROM customer_requests WHERE id = ANY($1)', [requestIds]);
    await ds.destroy();
  });

  describe('record', () => {
    it('stores the result on the request and moves an open one to in_progress', async () => {
      const id = await insertRequest('open');

      await log.record(entry(id, `${PREFIX} open request`, 'billing', 0.71));

      expect(await storedRequest(id)).toEqual({
        status: 'in_progress',
        category: 'billing',
        confidence: 0.71,
      });
    });

    it.each(['in_progress', 'resolved'])('keeps the status of a %s request', async (status) => {
      const id = await insertRequest(status);

      await log.record(entry(id, `${PREFIX} ${status} request`, 'sales', 0.65));

      expect(await storedRequest(id)).toEqual({ status, category: 'sales', confidence: 0.65 });
    });

    it('appends a history row for the request', async () => {
      const id = await insertRequest();
      const message = `${PREFIX} linked to a request`;

      await log.record(entry(id, message));

      expect(await rowsWithMessage(message)).toEqual([
        { request_id: id, category: 'billing', provider: 'keyword' },
      ]);
    });

    it('records an ad-hoc classification with no request', async () => {
      const message = `${PREFIX} ad hoc`;

      await log.record(entry(null, message));

      expect(await rowsWithMessage(message)).toEqual([
        { request_id: null, category: 'billing', provider: 'keyword' },
      ]);
    });

    it('throws RequestNotFoundError for an unknown request, and records nothing', async () => {
      const message = `${PREFIX} missing request`;

      await expect(log.record(entry(UNKNOWN_REQUEST, message))).rejects.toBeInstanceOf(
        RequestNotFoundError,
      );

      expect(await rowsWithMessage(message)).toEqual([]);
    });

    it('rolls the request update back when the history row cannot be written', async () => {
      const id = await insertRequest('open');
      const message = `${PREFIX} rollback`;
      // The provider column is varchar(64), so this insert fails after the request was updated.
      const failing = entry(id, message, 'billing', 0.86, 'x'.repeat(70));

      await expect(log.record(failing)).rejects.toThrow();

      expect(await storedRequest(id)).toEqual({ status: 'open', category: null, confidence: null });
      expect(await rowsWithMessage(message)).toEqual([]);
    });

    it('deletes a request together with its history', async () => {
      const id = await insertRequest();
      await log.record(entry(id, `${PREFIX} cascade`));

      await ds.query('DELETE FROM customer_requests WHERE id = $1', [id]);

      expect((await log.list({ requestId: id, limit: 50 })).total).toBe(0);
    });
  });

  describe('list', () => {
    const messages: Record<ClassificationCategory, string> = {
      billing: `${PREFIX} refund please`,
      sales: `${PREFIX} demo please`,
      support: `${PREFIX} help please`,
      unknown: `${PREFIX} hello there`,
    };
    let requestId: string;

    beforeAll(async () => {
      requestId = await insertRequest();
      // Sequential on purpose: each record is its own transaction, so the order is known.
      for (const [category, message] of Object.entries(messages)) {
        await log.record(entry(requestId, message, category as ClassificationCategory));
      }
    });

    it('lists a request newest first, with the fields the page needs', async () => {
      const page = await log.list({ requestId, limit: 50 });

      expect(page.items.map((item) => item.category)).toEqual(['unknown', 'support', 'sales', 'billing']);
      expect(page.total).toBe(4);
      expect(page.items[3]).toMatchObject({
        requestId,
        message: messages.billing,
        category: 'billing',
        confidence: 0.86,
        provider: 'keyword',
      });
      expect(new Date(page.items[3].createdAt).toISOString()).toBe(page.items[3].createdAt);
    });

    it('filters by category', async () => {
      const page = await log.list({ requestId, category: 'billing', limit: 50 });

      expect(page.items.map((item) => item.message)).toEqual([messages.billing]);
      expect(page.total).toBe(1);
    });

    it('bounds the items with limit, while total still counts every match', async () => {
      const page = await log.list({ requestId, limit: 2 });

      expect(page.items.map((item) => item.category)).toEqual(['unknown', 'support']);
      expect(page.total).toBe(4);
    });
  });

  // Filters, paging and facets. Every row carries this run's TAG, in its message and in its
  // provider, so the assertions hold whatever else is in the table.
  describe('filters, paging and facets', () => {
    const TAG = Date.now().toString(36);
    const P1 = `test-${TAG}-a`;
    const P2 = `test-${TAG}-b`;
    const T0 = Date.parse('2031-01-01T00:00:00Z');
    const at = (hours: number) => new Date(T0 + hours * 3_600_000);
    const row: Record<'r1' | 'r2' | 'r3' | 'r4' | 'r5', string> = {} as never;
    let linked: string;
    let otherLinked: string;

    async function insertRow(values: {
      requestId: string | null;
      text: string;
      category: ClassificationCategory;
      confidence: number;
      provider: string;
      createdAt: Date | string;
      // False keeps the row out of `text: TAG` searches (the paging fixtures are found by provider).
      tagged?: boolean;
    }): Promise<string> {
      const [{ id }] = await ds.query<{ id: string }[]>(
        `INSERT INTO classification_history (request_id, message, category, confidence, provider, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          values.requestId,
          `${PREFIX} ${values.tagged === false ? '' : `${TAG} `}${values.text}`,
          values.category,
          values.confidence,
          values.provider,
          values.createdAt,
        ],
      );
      return id;
    }

    const idsOf = async (query: Partial<Parameters<typeof log.list>[0]>) =>
      (await log.list({ limit: 50, ...query })).items.map((item) => item.id);

    beforeAll(async () => {
      linked = await insertRequest();
      otherLinked = await insertRequest();
      const base = { confidence: 0.8, category: 'billing' as ClassificationCategory };
      row.r1 = await insertRow({ ...base, requestId: linked, text: 'Refund did not arrive', confidence: 0.86, provider: P1, createdAt: at(1) });
      row.r2 = await insertRow({ ...base, requestId: linked, text: 'Interested in a DEMO', category: 'sales', confidence: 0.65, provider: P1, createdAt: at(2) });
      row.r3 = await insertRow({ ...base, requestId: null, text: 'login is broken', category: 'support', confidence: 0.63, provider: P1, createdAt: at(3) });
      row.r4 = await insertRow({ ...base, requestId: null, text: '100% wrong_input', category: 'unknown', confidence: 0.4, provider: P2, createdAt: at(4) });
      row.r5 = await insertRow({ ...base, requestId: otherLinked, text: 'other refund', confidence: 0.9, provider: P2, createdAt: at(5) });
    });

    describe('filters', () => {
      it('filters by provider', async () => {
        const page = await log.list({ provider: P1, limit: 50 });

        expect(page.items.map((item) => item.id)).toEqual([row.r3, row.r2, row.r1]);
        expect(page.total).toBe(3);
      });

      it('filters to ad-hoc or to request-linked classifications', async () => {
        expect(await idsOf({ text: TAG, adHoc: true })).toEqual([row.r4, row.r3]);
        expect(await idsOf({ text: TAG, adHoc: false })).toEqual([row.r5, row.r2, row.r1]);
      });

      it('filters by time: from is included, to is not', async () => {
        expect(await idsOf({ provider: P1, from: at(2), to: at(3) })).toEqual([row.r2]);
        expect(await idsOf({ provider: P1, from: at(2) })).toEqual([row.r3, row.r2]);
        expect(await idsOf({ provider: P1, to: at(2) })).toEqual([row.r1]);
      });

      it('filters by confidence, bounds included', async () => {
        expect(await idsOf({ provider: P1, maxConfidence: 0.65 })).toEqual([row.r3, row.r2]);
        expect(await idsOf({ provider: P1, minConfidence: 0.65 })).toEqual([row.r2, row.r1]);
        expect(await idsOf({ provider: P1, minConfidence: 0.63, maxConfidence: 0.65 })).toEqual([row.r3, row.r2]);
      });

      it('searches the text without regard to case', async () => {
        expect(await idsOf({ provider: P1, text: 'refund' })).toEqual([row.r1]);
        expect(await idsOf({ provider: P1, text: 'demo' })).toEqual([row.r2]);
      });

      it('takes % and _ in a search literally', async () => {
        expect(await idsOf({ provider: P2, text: '%' })).toEqual([row.r4]);
        expect(await idsOf({ provider: P2, text: '_' })).toEqual([row.r4]);
        expect(await idsOf({ provider: P2, text: '100% wrong_' })).toEqual([row.r4]);
        // As a wildcard, "_" would match the "d" of "refund".
        expect(await idsOf({ provider: P2, text: 'refun_' })).toEqual([]);
      });

      it('combines filters', async () => {
        expect(await idsOf({ provider: P1, category: 'billing', adHoc: false })).toEqual([row.r1]);
        expect(await idsOf({ text: TAG, category: 'billing', minConfidence: 0.88 })).toEqual([row.r5]);
        expect(await idsOf({ requestId: linked, text: TAG })).toEqual([row.r2, row.r1]);
      });
    });

    describe('paging', () => {
      it('follows the cursor through a filter, and total stays the same', async () => {
        const first = await log.list({ provider: P1, limit: 2 });
        expect(first.items.map((item) => item.id)).toEqual([row.r3, row.r2]);
        expect(first).toMatchObject({ total: 3, nextCursor: row.r2 });

        const second = await log.list({ provider: P1, limit: 2, cursor: first.nextCursor! });
        expect(second.items.map((item) => item.id)).toEqual([row.r1]);
        expect(second).toMatchObject({ total: 3, nextCursor: null });
      });

      it('has no next page when the results fit exactly', async () => {
        expect((await log.list({ provider: P1, limit: 3 })).nextCursor).toBeNull();
      });

      it('keeps the filters from page to page', async () => {
        const first = await log.list({ text: TAG, category: 'billing', limit: 1 });
        const second = await log.list({ text: TAG, category: 'billing', limit: 1, cursor: first.nextCursor! });

        expect([first.items[0].id, second.items[0].id]).toEqual([row.r5, row.r1]);
        expect(second.nextCursor).toBeNull();
      });

      it('walks rows with the same created_at without gaps or repeats', async () => {
        const provider = `test-${TAG}-tie`;
        const same = at(10);
        const ids = [];
        for (let i = 0; i < 5; i += 1) {
          ids.push(await insertRow({ requestId: null, text: `tie ${i}`, category: 'unknown', confidence: 0.4, provider, createdAt: same, tagged: false }));
        }

        const seen: string[] = [];
        let cursor: string | undefined;
        do {
          const page = await log.list({ provider, limit: 2, cursor });
          expect(page.total).toBe(5);
          seen.push(...page.items.map((item) => item.id));
          cursor = page.nextCursor ?? undefined;
        } while (cursor);

        expect(seen).toEqual([...ids].sort().reverse());
      });

      it('does not skip rows that differ only in the microseconds Postgres keeps', async () => {
        const provider = `test-${TAG}-us`;
        // Within one millisecond: a cursor that carried a JavaScript Date would lose these.
        const stamps = ['.123001', '.123400', '.123456', '.123999'];
        const ids = [];
        for (const fraction of stamps) {
          ids.push(await insertRow({ requestId: null, text: `us ${fraction}`, category: 'unknown', confidence: 0.4, provider, createdAt: `2031-02-01 00:00:00${fraction}+00`, tagged: false }));
        }

        const seen: string[] = [];
        let cursor: string | undefined;
        do {
          const page = await log.list({ provider, limit: 1, cursor });
          seen.push(...page.items.map((item) => item.id));
          cursor = page.nextCursor ?? undefined;
        } while (cursor);

        expect(seen).toEqual([...ids].reverse());
      });

      it('answers an empty last page, not an error, for a cursor at the very end', async () => {
        const page = await log.list({ provider: P1, limit: 5, cursor: row.r1 });

        expect(page).toEqual({ items: [], total: 3, nextCursor: null });
      });

      it('rejects a cursor that points at nothing', async () => {
        await expect(
          log.list({ provider: P1, limit: 2, cursor: UNKNOWN_REQUEST }),
        ).rejects.toBeInstanceOf(InvalidCursorError);
      });
    });

    describe('facets', () => {
      it('counts every category, and the providers, under the other filters', async () => {
        const facets = await log.facets({ text: TAG });

        expect(facets.category).toEqual([
          { value: 'support', count: 1 },
          { value: 'sales', count: 1 },
          { value: 'billing', count: 2 },
          { value: 'unknown', count: 1 },
        ]);
        expect(facets.provider).toEqual([
          { value: P1, count: 3 },
          { value: P2, count: 2 },
        ]);
      });

      it('leaves a facet\'s own filter out, and applies the others to it', async () => {
        const facets = await log.facets({ text: TAG, category: 'billing' });

        // Categories: the category filter is left out, so the alternatives stay visible.
        expect(facets.category.map((c) => c.count)).toEqual([1, 1, 2, 1]);
        // Providers: only the billing rows count.
        expect(facets.provider).toEqual([
          { value: P1, count: 1 },
          { value: P2, count: 1 },
        ]);
      });

      it('lists a category with no matches as zero', async () => {
        const facets = await log.facets({ text: TAG, provider: P1 });

        expect(facets.category).toEqual([
          { value: 'support', count: 1 },
          { value: 'sales', count: 1 },
          { value: 'billing', count: 1 },
          { value: 'unknown', count: 0 },
        ]);
        // The provider filter is left out of the provider facet.
        expect(facets.provider.map((p) => p.value)).toEqual([P1, P2]);
      });

      it('applies time and confidence filters to both facets', async () => {
        const facets = await log.facets({ text: TAG, from: at(3) });

        expect(facets.category.map((c) => c.count)).toEqual([1, 0, 1, 1]);
        expect(facets.provider).toEqual([
          { value: P2, count: 2 },
          { value: P1, count: 1 },
        ]);
      });
    });
  });

  it('works end to end behind ClassificationService', async () => {
    const service = new ClassificationService(new KeywordClassifier(), log);
    const id = await insertRequest('open');

    const response = await service.classify({ message: `${PREFIX} end to end refund`, requestId: id });

    expect(response).toEqual({ category: 'billing', confidence: 0.86, requestId: id });
    expect(await storedRequest(id)).toEqual({ status: 'in_progress', category: 'billing', confidence: 0.86 });
    expect((await log.list({ requestId: id, limit: 50 })).total).toBe(1);
  });
});
