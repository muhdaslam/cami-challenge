import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CLASSIFICATION_CATEGORIES } from '../src/requests/classification-provider';
import { HistoryQueryDto, MAX_HISTORY_LIMIT, MAX_SEARCH_LENGTH } from '../src/requests/history-query.dto';

const UUID = '3f2b1c9e-8d4a-4e6b-9a1f-2c5d7e8f9a0b';

// A query string only ever holds text, so that is what these tests feed in.
const parse = (query: Record<string, string>) => plainToInstance(HistoryQueryDto, query);

// [property, first failed check] for each invalid field, as the controller's pipe reports it.
const failures = async (query: Record<string, string>) =>
  (await validate(parse(query), { stopAtFirstError: true })).map((error) => [
    error.property,
    Object.keys(error.constraints ?? {})[0],
  ]);

const accepted: [string, Record<string, string>][] = [
  ['no filters', {}],
  ['a request', { requestId: UUID }],
  ['the smallest limit', { limit: '1' }],
  ['the largest limit', { limit: String(MAX_HISTORY_LIMIT) }],
  ['every filter', { category: 'billing', requestId: UUID, limit: '25' }],
  ['a provider', { provider: 'keyword' }],
  ['a provider name of the maximum length', { provider: 'p'.repeat(64) }],
  ['adHoc true', { adHoc: 'true' }],
  ['adHoc false', { adHoc: 'false' }],
  ['a date and time', { from: '2026-09-19T10:00:00Z' }],
  ['a date on its own', { from: '2026-09-19' }],
  ['a range', { from: '2026-09-19T10:00:00Z', to: '2026-09-20T10:00:00.000Z' }],
  ['confidence bounds 0 and 1', { minConfidence: '0', maxConfidence: '1' }],
  ['a fractional confidence', { minConfidence: '0.55' }],
  ['a search', { q: 'refund' }],
  ['a search with spaces around it', { q: '  refund  ' }],
  ['a search of the maximum length', { q: 'a'.repeat(MAX_SEARCH_LENGTH) }],
  ['a cursor', { cursor: UUID }],
  [
    'every kind of filter and a cursor',
    {
      category: 'billing',
      provider: 'keyword',
      requestId: UUID,
      from: '2026-09-19T10:00:00Z',
      to: '2026-09-20T10:00:00Z',
      minConfidence: '0.1',
      maxConfidence: '0.9',
      q: 'refund',
      limit: '10',
      cursor: UUID,
    },
  ],
  ...CLASSIFICATION_CATEGORIES.map((category): [string, Record<string, string>] => [
    `category ${category}`,
    { category },
  ]),
];

describe('HistoryQueryDto', () => {
  it.each(accepted)('accepts %s', async (_name, query) => {
    expect(await failures(query)).toEqual([]);
  });

  it('turns the limit into a number', () => {
    expect(parse({ limit: '25' }).limit).toBe(25);
  });

  it('converts and trims the way the service expects', () => {
    expect(parse({ adHoc: 'true' }).adHoc).toBe(true);
    expect(parse({ adHoc: 'false' }).adHoc).toBe(false);
    expect(parse({ minConfidence: '0.5', maxConfidence: '1' })).toMatchObject({
      minConfidence: 0.5,
      maxConfidence: 1,
    });
    expect(parse({ q: '  refund  ' }).q).toBe('refund');
  });

  it.each([
    ['a category in the wrong case', { category: 'Billing' }, 'category', 'isIn'],
    ['an unknown category', { category: 'refunds' }, 'category', 'isIn'],
    ['an empty category', { category: '' }, 'category', 'isIn'],
    ['a non-UUID requestId', { requestId: 'abc' }, 'requestId', 'isUuid'],
    ['a text limit', { limit: 'abc' }, 'limit', 'isInt'],
    ['a fractional limit', { limit: '1.5' }, 'limit', 'isInt'],
    ['a zero limit', { limit: '0' }, 'limit', 'min'],
    ['a negative limit', { limit: '-3' }, 'limit', 'min'],
    ['an empty limit', { limit: '' }, 'limit', 'min'],
    ['a limit above the maximum', { limit: String(MAX_HISTORY_LIMIT + 1) }, 'limit', 'max'],
    ['an empty provider', { provider: '' }, 'provider', 'isLength'],
    ['a provider name that is too long', { provider: 'p'.repeat(65) }, 'provider', 'isLength'],
    ['an adHoc that is neither true nor false', { adHoc: 'yes' }, 'adHoc', 'isBoolean'],
    ['an empty adHoc', { adHoc: '' }, 'adHoc', 'isBoolean'],
    ['a from that is not a date', { from: 'yesterday' }, 'from', 'isIso8601'],
    ['a to that is not a real date', { to: '2026-13-45' }, 'to', 'isIso8601'],
    ['a confidence that is text', { minConfidence: 'high' }, 'minConfidence', 'isNumber'],
    ['an empty confidence', { maxConfidence: '' }, 'maxConfidence', 'isNumber'],
    ['a confidence below 0', { minConfidence: '-0.1' }, 'minConfidence', 'min'],
    ['a confidence above 1', { maxConfidence: '1.5' }, 'maxConfidence', 'max'],
    ['an empty search', { q: '' }, 'q', 'isLength'],
    ['a search of only spaces', { q: '   ' }, 'q', 'isLength'],
    ['a search that is too long', { q: 'a'.repeat(MAX_SEARCH_LENGTH + 1) }, 'q', 'isLength'],
    ['a cursor that is not a UUID', { cursor: 'abc' }, 'cursor', 'isUuid'],
  ])('rejects %s with one reason', async (_name, query, property, check) => {
    expect(await failures(query)).toEqual([[property, check]]);
  });
});
