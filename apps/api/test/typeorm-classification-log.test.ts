import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDataSource } from '../src/data-source';
import { ClassificationEntry, RequestNotFoundError } from '../src/requests/classification-log';
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

  it('works end to end behind ClassificationService', async () => {
    const service = new ClassificationService(new KeywordClassifier(), log);
    const id = await insertRequest('open');

    const response = await service.classify({ message: `${PREFIX} end to end refund`, requestId: id });

    expect(response).toEqual({ category: 'billing', confidence: 0.86, requestId: id });
    expect(await storedRequest(id)).toEqual({ status: 'in_progress', category: 'billing', confidence: 0.86 });
    expect((await log.list({ requestId: id, limit: 50 })).total).toBe(1);
  });
});
