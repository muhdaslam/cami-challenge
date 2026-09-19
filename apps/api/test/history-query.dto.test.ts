import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CLASSIFICATION_CATEGORIES } from '../src/requests/classification-provider';
import { HistoryQueryDto, MAX_HISTORY_LIMIT } from '../src/requests/history-query.dto';

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
  ])('rejects %s with one reason', async (_name, query, property, check) => {
    expect(await failures(query)).toEqual([[property, check]]);
  });
});
