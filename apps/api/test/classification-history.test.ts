import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDataSource } from '../src/data-source';
import { ClassificationHistoryService } from '../src/requests/classification-history.service';
import { ClassificationProvider } from '../src/requests/classification-provider';
import { ClassificationRecord } from '../src/requests/classification-record.entity';
import { ClassificationService } from '../src/requests/classification.service';
import { CustomerRequest } from '../src/requests/customer-request.entity';
import { KeywordClassifier } from '../src/requests/keyword-classifier';
import { RequestsService } from '../src/requests/requests.service';

// Every message starts with this so cleanup can find them. None contains a keyword, and each
// has three or more words, so the keyword classifier answers with its full confidence.
const PREFIX = 'history test:';
const UNKNOWN_REQUEST = '00000000-0000-4000-8000-000000000000';

// Needs a real Postgres (CI provides one via DATABASE_URL); skipped otherwise.
describe.skipIf(!process.env.DATABASE_URL)('classification history (Postgres)', () => {
  const requestIds: string[] = [];
  let ds: DataSource;
  let requests: RequestsService;
  let history: ClassificationHistoryService;
  let service: ClassificationService;

  async function insertRequest(status = 'open'): Promise<string> {
    const [{ id }] = await ds.query<{ id: string }[]>(
      `INSERT INTO customer_requests (message, status) VALUES ('history test request', $1) RETURNING id`,
      [status],
    );
    requestIds.push(id);
    return id;
  }

  const rowsWithMessage = (message: string) =>
    ds.query<{ request_id: string | null; category: string; provider: string }[]>(
      'SELECT request_id, category, provider FROM classification_history WHERE message = $1',
      [message],
    );

  beforeAll(async () => {
    ds = createDataSource();
    await ds.initialize();
    await ds.runMigrations();
    requests = new RequestsService(ds.getRepository(CustomerRequest));
    history = new ClassificationHistoryService(ds.getRepository(ClassificationRecord));
    service = new ClassificationService(new KeywordClassifier(), requests, history, ds);
  });

  afterAll(async () => {
    if (!ds?.isInitialized) {
      return;
    }
    await ds.query('DELETE FROM classification_history WHERE message LIKE $1', [`${PREFIX}%`]);
    await ds.query('DELETE FROM customer_requests WHERE id = ANY($1)', [requestIds]);
    await ds.destroy();
  });

  describe('listing', () => {
    const messages = {
      billing: `${PREFIX} refund please`,
      sales: `${PREFIX} demo please`,
      support: `${PREFIX} help please`,
      unknown: `${PREFIX} hello there`,
    };
    let requestId: string;

    beforeAll(async () => {
      requestId = await insertRequest();
      // Sequential on purpose: each classification is its own transaction, so the order is known.
      for (const message of Object.values(messages)) {
        await service.classify({ message, requestId });
      }
    });

    it('lists a request newest first, with the fields the page needs', async () => {
      const page = await history.list({ requestId });

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
      const page = await history.list({ requestId, category: 'billing' });

      expect(page.items.map((item) => item.message)).toEqual([messages.billing]);
      expect(page.total).toBe(1);
    });

    it('bounds the items with limit, while total still counts every match', async () => {
      const page = await history.list({ requestId, limit: 2 });

      expect(page.items.map((item) => item.category)).toEqual(['unknown', 'support']);
      expect(page.total).toBe(4);
    });
  });

  it('records an ad-hoc classification with no request', async () => {
    const message = `${PREFIX} ad hoc refund please`;

    await service.classify({ message });

    expect(await rowsWithMessage(message)).toEqual([
      { request_id: null, category: 'billing', provider: 'keyword' },
    ]);
  });

  it('leaves no history row when the request does not exist', async () => {
    const message = `${PREFIX} missing request refund please`;

    await expect(service.classify({ message, requestId: UNKNOWN_REQUEST })).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(await rowsWithMessage(message)).toEqual([]);
  });

  it('rolls the request update back when the history row cannot be written', async () => {
    const requestId = await insertRequest('open');
    // The provider name column is varchar(64), so this insert fails after the request was updated.
    const tooLong = {
      name: 'x'.repeat(70),
      classify: () => ({ category: 'billing', confidence: 0.86 }),
    } as ClassificationProvider;
    const failing = new ClassificationService(tooLong, requests, history, ds);
    const message = `${PREFIX} rollback refund please`;

    await expect(failing.classify({ message, requestId })).rejects.toThrow();

    const [request] = await ds.query('SELECT status, category, confidence FROM customer_requests WHERE id = $1', [requestId]);
    expect(request).toEqual({ status: 'open', category: null, confidence: null });
    expect(await rowsWithMessage(message)).toEqual([]);
  });

  it('deletes a request together with its history', async () => {
    const requestId = await insertRequest();
    await service.classify({ message: `${PREFIX} cascade refund please`, requestId });

    await ds.query('DELETE FROM customer_requests WHERE id = $1', [requestId]);

    expect((await history.list({ requestId })).total).toBe(0);
  });
});
