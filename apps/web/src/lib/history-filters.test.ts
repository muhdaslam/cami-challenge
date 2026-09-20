import { describe, expect, it } from 'vitest';
import {
  activeFilters,
  clearFilter,
  confidencePresetOf,
  HistoryFilters,
  MAX_SEARCH_LENGTH,
  parseFilters,
  scopeOf,
  toApiParams,
  toSearchParams,
  withConfidence,
  withDays,
  withRange,
  withRequest,
  withScope,
} from './history-filters';

const UUID = '3f2b1c9e-8d4a-4e6b-9a1f-2c5d7e8f9a0b';
const parse = (query: string) => parseFilters(new URLSearchParams(query));
const NOW = new Date('2026-09-19T12:00:00Z');

describe('parseFilters', () => {
  it('reads every filter', () => {
    expect(
      parse(
        `category=billing&provider=keyword&requestId=${UUID}&adHoc=false&from=2026-09-01&to=2026-09-19&minConfidence=0.6&maxConfidence=0.79&q=refund`,
      ),
    ).toEqual({
      category: 'billing',
      provider: 'keyword',
      requestId: UUID,
      adHoc: false,
      from: '2026-09-01',
      to: '2026-09-19',
      minConfidence: 0.6,
      maxConfidence: 0.79,
      q: 'refund',
    });
  });

  it.each([
    ['a category in the wrong case', 'category=Billing'],
    ['a request id that is not a UUID', 'requestId=abc'],
    ['an adHoc that is neither true nor false', 'adHoc=yes'],
    ['a range that is not a preset', 'range=1y'],
    ['a day that is not a date', 'from=yesterday'],
    ['a day that does not exist', 'from=2026-02-30'],
    ['a confidence that is text', 'minConfidence=high'],
    ['a confidence above 1', 'maxConfidence=1.5'],
    ['an empty confidence', 'minConfidence='],
    ['a search of only spaces', 'q=%20%20'],
    ['a parameter it does not know', 'sort=asc'],
  ])('ignores %s', (_name, query) => {
    expect(parse(query)).toEqual({});
  });

  it('lets a preset range win over custom days', () => {
    expect(parse('range=24h&from=2026-09-01&to=2026-09-19')).toEqual({ range: '24h' });
  });

  it('puts days and confidence bounds the right way round', () => {
    expect(parse('from=2026-09-19&to=2026-09-01')).toEqual({ from: '2026-09-01', to: '2026-09-19' });
    expect(parse('minConfidence=0.9&maxConfidence=0.5')).toEqual({ minConfidence: 0.5, maxConfidence: 0.9 });
  });

  it('lets a request override "ad hoc only", but not "linked only"', () => {
    expect(parse(`requestId=${UUID}&adHoc=true`)).toEqual({ requestId: UUID });
    expect(parse(`requestId=${UUID}&adHoc=false`)).toEqual({ requestId: UUID, adHoc: false });
  });

  it('cuts a search that is too long', () => {
    expect(parse(`q=${'a'.repeat(MAX_SEARCH_LENGTH + 20)}`).q).toHaveLength(MAX_SEARCH_LENGTH);
  });
});

describe('toSearchParams', () => {
  it('is empty when no filter is set', () => {
    expect(toSearchParams({}).toString()).toBe('');
  });

  it.each<[string, HistoryFilters]>([
    ['a category', { category: 'sales' }],
    ['a preset range', { range: '7d', provider: 'keyword' }],
    ['custom days', { from: '2026-09-01', to: '2026-09-19' }],
    ['a confidence range and a search', { minConfidence: 0.6, maxConfidence: 0.79, q: 'refund policy' }],
    ['a request, linked only', { requestId: UUID, adHoc: false }],
    ['ad hoc only', { adHoc: true }],
    [
      'everything',
      { category: 'billing', provider: 'keyword', adHoc: true, range: '1h', minConfidence: 0.8, q: 'refund' },
    ],
  ])('round-trips %s through the URL', (_name, filters) => {
    expect(parseFilters(toSearchParams(filters))).toEqual(filters);
  });

  it('gives the same URL however the filters were built', () => {
    const a = toSearchParams({ q: 'x', category: 'sales', provider: 'keyword' }).toString();
    const b = toSearchParams({ provider: 'keyword', category: 'sales', q: 'x' }).toString();

    expect(a).toBe(b);
  });

  it('leaves custom days out when a preset is set', () => {
    expect(toSearchParams({ range: '24h', from: '2026-09-01' }).toString()).toBe('range=24h');
  });
});

describe('toApiParams', () => {
  it('sends only what is set', () => {
    expect(toApiParams({}, NOW).toString()).toBe('');
  });

  it.each([
    ['1h', '2026-09-19T11:00:00.000Z'],
    ['24h', '2026-09-18T12:00:00.000Z'],
    ['7d', '2026-09-12T12:00:00.000Z'],
  ] as const)('turns the %s preset into a fixed distance before now', (range, from) => {
    expect(toApiParams({ range }, NOW).get('from')).toBe(from);
    expect(toApiParams({ range }, NOW).has('to')).toBe(false);
  });

  it('makes custom days local-day boundaries, "to" being the start of the day after', () => {
    const params = toApiParams({ from: '2026-09-01', to: '2026-09-19' }, NOW);

    expect(params.get('from')).toBe(new Date(2026, 8, 1).toISOString());
    expect(params.get('to')).toBe(new Date(2026, 8, 20).toISOString());
  });

  it.each([
    ['a month end', '2026-09-30', new Date(2026, 9, 1)],
    ['a year end', '2026-12-31', new Date(2027, 0, 1)],
    ['a leap day', '2028-02-29', new Date(2028, 2, 1)],
  ])('rolls "to" over %s', (_name, day, expected) => {
    expect(toApiParams({ to: day }, NOW).get('to')).toBe(expected.toISOString());
  });

  it('passes the plain filters through under the API\'s names', () => {
    const params = toApiParams(
      { category: 'billing', provider: 'keyword', requestId: UUID, minConfidence: 0.6, maxConfidence: 0.79, q: '  refund  ' },
      NOW,
    );

    expect(Object.fromEntries(params)).toEqual({
      category: 'billing',
      provider: 'keyword',
      requestId: UUID,
      minConfidence: '0.6',
      maxConfidence: '0.79',
      q: 'refund',
    });
  });

  it('sends adHoc, but not alongside a request', () => {
    expect(toApiParams({ adHoc: true }, NOW).get('adHoc')).toBe('true');
    expect(toApiParams({ adHoc: false }, NOW).get('adHoc')).toBe('false');
    expect(toApiParams({ requestId: UUID, adHoc: false }, NOW).has('adHoc')).toBe(false);
  });

  it('leaves a blank search out', () => {
    expect(toApiParams({ q: '   ' }, NOW).has('q')).toBe(false);
  });
});

describe('changing filters', () => {
  it('a preset range clears custom days, and the other way round', () => {
    const custom = { from: '2026-09-01', to: '2026-09-19' };

    expect(withRange(custom, '24h')).toMatchObject({ range: '24h', from: undefined, to: undefined });
    expect(withDays({ range: '24h' }, custom)).toMatchObject({ range: undefined, ...custom });
    expect(withRange({ range: '24h' }, undefined).range).toBeUndefined();
  });

  it('withDays puts the days in order and treats an empty day as none', () => {
    expect(withDays({}, { from: '2026-09-19', to: '2026-09-01' })).toMatchObject({
      from: '2026-09-01',
      to: '2026-09-19',
    });
    expect(withDays({ from: '2026-09-01' }, { from: '', to: '2026-09-05' })).toMatchObject({
      from: undefined,
      to: '2026-09-05',
    });
  });

  it('a confidence preset sets the bounds, and "any" clears them', () => {
    expect(withConfidence({}, 'high')).toMatchObject({ minConfidence: 0.8, maxConfidence: undefined });
    expect(withConfidence({}, 'medium')).toMatchObject({ minConfidence: 0.6, maxConfidence: 0.79 });
    expect(withConfidence({}, 'low')).toMatchObject({ minConfidence: undefined, maxConfidence: 0.59 });
    expect(withConfidence({ minConfidence: 0.8 }, 'any')).toMatchObject({
      minConfidence: undefined,
      maxConfidence: undefined,
    });
  });

  it('a scope means "not one request", so it drops the request', () => {
    expect(withScope({ requestId: UUID }, 'adhoc')).toMatchObject({ requestId: undefined, adHoc: true });
    expect(withScope({}, 'linked')).toMatchObject({ adHoc: false });
    expect(withScope({ adHoc: true }, 'all').adHoc).toBeUndefined();
  });

  it('looking at one request drops "ad hoc only" but keeps "linked only"', () => {
    expect(withRequest({ adHoc: true }, UUID)).toMatchObject({ requestId: UUID, adHoc: undefined });
    expect(withRequest({ adHoc: false }, UUID)).toMatchObject({ requestId: UUID, adHoc: false });
    expect(withRequest({ requestId: UUID }, undefined).requestId).toBeUndefined();
  });

  it('reads a preset and a scope back from the filters', () => {
    expect(confidencePresetOf({})).toBe('any');
    expect(confidencePresetOf({ minConfidence: 0.8 })).toBe('high');
    expect(confidencePresetOf({ minConfidence: 0.6, maxConfidence: 0.79 })).toBe('medium');
    expect(confidencePresetOf({ maxConfidence: 0.59 })).toBe('low');
    expect(confidencePresetOf({ minConfidence: 0.8, maxConfidence: 1 })).toBe('custom');
    expect(scopeOf({})).toBe('all');
    expect(scopeOf({ adHoc: true })).toBe('adhoc');
    expect(scopeOf({ adHoc: false })).toBe('linked');
  });
});

describe('active filters', () => {
  it('lists none for no filters', () => {
    expect(activeFilters({})).toEqual([]);
  });

  it('describes each filter that is set', () => {
    expect(
      activeFilters({
        category: 'billing',
        provider: 'keyword',
        adHoc: true,
        range: '24h',
        minConfidence: 0.8,
        q: 'refund',
      }),
    ).toEqual([
      { id: 'category', label: 'Category: billing' },
      { id: 'provider', label: 'Provider: keyword' },
      { id: 'scope', label: 'Ad hoc only' },
      { id: 'time', label: '24 hours' },
      { id: 'confidence', label: 'Confidence: High (80% and up)' },
      { id: 'search', label: 'Search: “refund”' },
    ]);
  });

  it('describes custom days and a custom confidence range', () => {
    expect(activeFilters({ from: '2026-09-01' })).toEqual([{ id: 'time', label: '2026-09-01 to now' }]);
    expect(activeFilters({ minConfidence: 0.55, maxConfidence: 0.7 })).toEqual([
      { id: 'confidence', label: 'Confidence: 55%–70%' },
    ]);
  });

  it('shows a request by its short id, and no scope beside it', () => {
    expect(activeFilters({ requestId: UUID, adHoc: false })).toEqual([{ id: 'request', label: 'Request 3f2b1c9e' }]);
  });

  it('is emptied by clearing each active filter in turn', () => {
    let filters: HistoryFilters = {
      category: 'sales',
      provider: 'keyword',
      requestId: UUID,
      range: '7d',
      minConfidence: 0.6,
      maxConfidence: 0.79,
      q: 'demo',
    };
    for (const { id } of activeFilters(filters)) {
      filters = clearFilter(filters, id);
    }

    expect(activeFilters(filters)).toEqual([]);
  });

  it('clears the time and the confidence as a whole', () => {
    expect(clearFilter({ range: '1h', from: 'x', to: 'y' } as HistoryFilters, 'time')).toEqual({
      range: undefined,
      from: undefined,
      to: undefined,
    });
    expect(clearFilter({ minConfidence: 0.1, maxConfidence: 0.9 }, 'confidence')).toEqual({
      minConfidence: undefined,
      maxConfidence: undefined,
    });
  });
});
