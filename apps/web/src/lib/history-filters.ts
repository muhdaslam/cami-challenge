import { CLASSIFICATION_CATEGORIES, ClassificationCategory } from './api';

// Everything about the history filters that is not React: what they are, how they live in the
// URL, how they become API parameters, and the rules that keep them consistent.

export const TIME_RANGES = [
  { value: '1h', label: 'Last hour', ms: 3_600_000 },
  { value: '24h', label: '24 hours', ms: 86_400_000 },
  { value: '7d', label: '7 days', ms: 7 * 86_400_000 },
] as const;
export type TimeRange = (typeof TIME_RANGES)[number]['value'];

export const CONFIDENCE_PRESETS = [
  { id: 'high', label: 'High (80% and up)', min: 0.8 },
  { id: 'medium', label: 'Medium (60–79%)', min: 0.6, max: 0.79 },
  { id: 'low', label: 'Low (below 60%)', max: 0.59 },
] as const;
export type ConfidencePreset = 'any' | (typeof CONFIDENCE_PRESETS)[number]['id'] | 'custom';

export type Scope = 'all' | 'linked' | 'adhoc';

export const MAX_SEARCH_LENGTH = 100;

export type HistoryFilters = {
  category?: ClassificationCategory;
  provider?: string;
  requestId?: string;
  // True: only classifications with no request. False: only those with one.
  adHoc?: boolean;
  // A time range is either a preset ("the last 24 hours", resolved when the request is made)
  // or custom days; choosing one clears the other.
  range?: TimeRange;
  // Local days, as YYYY-MM-DD. `to` is the last day included.
  from?: string;
  to?: string;
  minConfidence?: number;
  maxConfidence?: number;
  q?: string;
};

export type FilterId = 'category' | 'provider' | 'request' | 'scope' | 'time' | 'confidence' | 'search';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

// Anything a URL can carry is untrusted: keep what is valid and drop the rest.
export function parseFilters(params: { get(name: string): string | null }): HistoryFilters {
  const filters: HistoryFilters = {};

  const category = params.get('category');
  if (CLASSIFICATION_CATEGORIES.includes(category as ClassificationCategory)) {
    filters.category = category as ClassificationCategory;
  }

  const provider = params.get('provider')?.trim();
  if (provider) {
    filters.provider = provider.slice(0, 64);
  }

  const requestId = params.get('requestId');
  if (requestId && UUID.test(requestId)) {
    filters.requestId = requestId;
  }

  const adHoc = params.get('adHoc');
  if ((adHoc === 'true' || adHoc === 'false') && !(filters.requestId && adHoc === 'true')) {
    filters.adHoc = adHoc === 'true';
  }

  const range = params.get('range');
  if (TIME_RANGES.some((r) => r.value === range)) {
    filters.range = range as TimeRange;
  } else {
    const from = params.get('from');
    const to = params.get('to');
    if (from && isDay(from)) filters.from = from;
    if (to && isDay(to)) filters.to = to;
    if (filters.from && filters.to && filters.from > filters.to) {
      [filters.from, filters.to] = [filters.to, filters.from];
    }
  }

  const min = parseUnit(params.get('minConfidence'));
  const max = parseUnit(params.get('maxConfidence'));
  if (min !== undefined) filters.minConfidence = min;
  if (max !== undefined) filters.maxConfidence = max;
  if (min !== undefined && max !== undefined && min > max) {
    filters.minConfidence = max;
    filters.maxConfidence = min;
  }

  const q = params.get('q')?.trim();
  if (q) {
    filters.q = q.slice(0, MAX_SEARCH_LENGTH);
  }

  return filters;
}

// The URL form: only what is set, in a fixed order, so the same filters are the same URL.
export function toSearchParams(filters: HistoryFilters): URLSearchParams {
  const params = new URLSearchParams();
  const set = (name: string, value: string | number | boolean | undefined) => {
    if (value !== undefined && value !== '') params.set(name, String(value));
  };

  set('category', filters.category);
  set('provider', filters.provider);
  set('requestId', filters.requestId);
  set('adHoc', filters.requestId && filters.adHoc === true ? undefined : filters.adHoc);
  if (filters.range) {
    set('range', filters.range);
  } else {
    set('from', filters.from);
    set('to', filters.to);
  }
  set('minConfidence', filters.minConfidence);
  set('maxConfidence', filters.maxConfidence);
  set('q', filters.q?.trim());
  return params;
}

// The API form. Presets and days become moments here, at the moment of asking, so `now` is
// passed in: a page of results and the pages after it must use the same one.
export function toApiParams(filters: HistoryFilters, now: Date): URLSearchParams {
  const params = new URLSearchParams();
  const set = (name: string, value: string | number | boolean | undefined) => {
    if (value !== undefined && value !== '') params.set(name, String(value));
  };

  set('category', filters.category);
  set('provider', filters.provider);
  set('requestId', filters.requestId);
  if (!filters.requestId) set('adHoc', filters.adHoc);

  if (filters.range) {
    const { ms } = TIME_RANGES.find((r) => r.value === filters.range)!;
    set('from', new Date(now.getTime() - ms).toISOString());
  } else {
    if (filters.from) set('from', startOfDay(filters.from).toISOString());
    // `to` is the last day included, and the API's `to` is exclusive: the start of the next day.
    if (filters.to) set('to', startOfDay(filters.to, 1).toISOString());
  }

  set('minConfidence', filters.minConfidence);
  set('maxConfidence', filters.maxConfidence);
  set('q', filters.q?.trim());
  return params;
}

// ---- changing filters: each keeps the rules that make a combination meaningful ----

export const withRange = (filters: HistoryFilters, range?: TimeRange): HistoryFilters => ({
  ...filters,
  range,
  from: undefined,
  to: undefined,
});

export function withDays(filters: HistoryFilters, days: { from?: string; to?: string }): HistoryFilters {
  let { from, to } = days;
  if (from && to && from > to) [from, to] = [to, from];
  return { ...filters, range: undefined, from: from || undefined, to: to || undefined };
}

export function withConfidence(filters: HistoryFilters, preset: ConfidencePreset): HistoryFilters {
  const found = CONFIDENCE_PRESETS.find((p) => p.id === preset);
  return {
    ...filters,
    minConfidence: found && 'min' in found ? found.min : undefined,
    maxConfidence: found && 'max' in found ? found.max : undefined,
  };
}

// Picking a scope means "not one request", so it drops the request filter.
export const withScope = (filters: HistoryFilters, scope: Scope): HistoryFilters => ({
  ...filters,
  requestId: undefined,
  adHoc: scope === 'all' ? undefined : scope === 'adhoc',
});

// Looking at one request makes the ad-hoc scope meaningless, so it is dropped with it.
export const withRequest = (filters: HistoryFilters, requestId?: string): HistoryFilters => ({
  ...filters,
  requestId,
  adHoc: filters.adHoc === false ? false : undefined,
});

export function confidencePresetOf(filters: HistoryFilters): ConfidencePreset {
  const { minConfidence: min, maxConfidence: max } = filters;
  if (min === undefined && max === undefined) return 'any';
  const found = CONFIDENCE_PRESETS.find(
    (p) => ('min' in p ? p.min : undefined) === min && ('max' in p ? p.max : undefined) === max,
  );
  return found ? found.id : 'custom';
}

export function scopeOf(filters: HistoryFilters): Scope {
  if (filters.adHoc === undefined) return 'all';
  return filters.adHoc ? 'adhoc' : 'linked';
}

// One entry per filter that is doing something, for the chips above the table.
export function activeFilters(filters: HistoryFilters): { id: FilterId; label: string }[] {
  const active: { id: FilterId; label: string }[] = [];
  if (filters.category) active.push({ id: 'category', label: `Category: ${filters.category}` });
  if (filters.provider) active.push({ id: 'provider', label: `Provider: ${filters.provider}` });
  if (filters.requestId) active.push({ id: 'request', label: `Request ${filters.requestId.slice(0, 8)}` });
  if (filters.adHoc !== undefined && !filters.requestId) {
    active.push({ id: 'scope', label: filters.adHoc ? 'Ad hoc only' : 'Linked to a request' });
  }
  if (filters.range) {
    active.push({ id: 'time', label: TIME_RANGES.find((r) => r.value === filters.range)!.label });
  } else if (filters.from || filters.to) {
    active.push({ id: 'time', label: `${filters.from ?? 'start'} to ${filters.to ?? 'now'}` });
  }
  const preset = confidencePresetOf(filters);
  if (preset !== 'any') {
    const found = CONFIDENCE_PRESETS.find((p) => p.id === preset);
    active.push({
      id: 'confidence',
      label: found ? `Confidence: ${found.label}` : `Confidence: ${percent(filters.minConfidence, '0')}–${percent(filters.maxConfidence, '100')}`,
    });
  }
  if (filters.q) active.push({ id: 'search', label: `Search: “${filters.q}”` });
  return active;
}

export function clearFilter(filters: HistoryFilters, id: FilterId): HistoryFilters {
  switch (id) {
    case 'category':
      return { ...filters, category: undefined };
    case 'provider':
      return { ...filters, provider: undefined };
    case 'request':
      return { ...filters, requestId: undefined };
    case 'scope':
      return { ...filters, adHoc: undefined };
    case 'time':
      return { ...filters, range: undefined, from: undefined, to: undefined };
    case 'confidence':
      return { ...filters, minConfidence: undefined, maxConfidence: undefined };
    case 'search':
      return { ...filters, q: undefined };
  }
}

// ---- small helpers ----

function isDay(value: string): boolean {
  const match = DAY.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

// Midnight local time at the start of the given YYYY-MM-DD, plus `addDays` days.
function startOfDay(day: string, addDays = 0): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date + addDays);
}

function parseUnit(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : undefined;
}

function percent(value: number | undefined, fallback: string): string {
  return value === undefined ? `${fallback}%` : `${Math.round(value * 100)}%`;
}
