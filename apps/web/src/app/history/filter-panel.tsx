'use client';

import { useEffect, useRef, useState } from 'react';
import {
  CLASSIFICATION_CATEGORIES,
  ClassificationCategory,
  ClassificationHistoryFacets,
} from '@/lib/api';
import {
  activeFilters,
  clearFilter,
  CONFIDENCE_PRESETS,
  confidencePresetOf,
  ConfidencePreset,
  HistoryFilters,
  MAX_SEARCH_LENGTH,
  scopeOf,
  TIME_RANGES,
  withConfidence,
  withDays,
  withRange,
  withScope,
} from '@/lib/history-filters';

const SEARCH_DELAY_MS = 300;

const chip = (selected: boolean) =>
  `rounded-full border px-3 py-1 text-sm ${
    selected
      ? 'border-slate-900 bg-slate-900 text-white'
      : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
  } disabled:cursor-not-allowed disabled:opacity-40`;

const control = 'rounded border border-slate-300 bg-white px-3 py-2 text-sm';

type Props = {
  filters: HistoryFilters;
  facets?: ClassificationHistoryFacets;
  // Takes a function of the latest filters, so quick successive changes do not overwrite each other.
  // `replace` swaps the current browser-history entry instead of adding one.
  onChange: (change: (current: HistoryFilters) => HistoryFilters, options?: { replace?: boolean }) => void;
};

export function FilterPanel({ filters, facets, onChange }: Props) {
  const categoryCounts = new Map(facets?.category.map((c) => [c.value, c.count]));
  const categoryTotal = facets?.category.reduce((sum, c) => sum + c.count, 0);
  const providers = facets?.provider ?? [];
  const providerOptions =
    filters.provider && !providers.some((p) => p.value === filters.provider)
      ? [...providers, { value: filters.provider, count: 0 }]
      : providers;

  const confidence = confidencePresetOf(filters);
  const noTime = !filters.range && !filters.from && !filters.to;
  const active = activeFilters(filters);

  // The search box types faster than the API should be asked, so it is copied into the URL
  // once typing pauses. `lastQ` tells apart a URL change made by that copy (already in the
  // box) from one made elsewhere (a removed chip, "Clear all", the back button), which the
  // box has to follow.
  const [text, setText] = useState(filters.q ?? '');
  const lastQ = useRef(filters.q ?? '');
  useEffect(() => {
    const current = filters.q ?? '';
    if (current !== lastQ.current) {
      lastQ.current = current;
      setText(current);
    }
  }, [filters.q]);
  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed === (filters.q ?? '')) return;
    const timer = setTimeout(() => {
      lastQ.current = trimmed;
      onChange((current) => ({ ...current, q: trimmed || undefined }), { replace: true });
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, filters.q, onChange]);

  return (
    <section
      aria-label="Filters"
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Category">
        <button
          type="button"
          className={chip(!filters.category)}
          aria-pressed={!filters.category}
          onClick={() => onChange((current) => clearFilter(current, 'category'))}
        >
          All{categoryTotal !== undefined ? ` (${categoryTotal})` : ''}
        </button>
        {CLASSIFICATION_CATEGORIES.map((name: ClassificationCategory) => {
          const count = categoryCounts.get(name);
          const selected = filters.category === name;
          return (
            <button
              key={name}
              type="button"
              className={chip(selected)}
              aria-pressed={selected}
              disabled={count === 0 && !selected}
              onClick={() => onChange((current) => ({ ...current, category: selected ? undefined : name }))}
            >
              {name}
              {count !== undefined ? ` (${count})` : ''}
            </button>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="history-search" className="font-medium text-slate-700">
            Search messages
          </label>
          <input
            id="history-search"
            type="search"
            className={control}
            value={text}
            maxLength={MAX_SEARCH_LENGTH}
            placeholder="e.g. refund"
            onChange={(e) => setText(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="history-provider" className="font-medium text-slate-700">
            Provider
          </label>
          <select
            id="history-provider"
            className={control}
            value={filters.provider ?? ''}
            onChange={(e) => {
              const provider = e.target.value || undefined;
              onChange((current) => ({ ...current, provider }));
            }}
          >
            <option value="">All providers</option>
            {providerOptions.map((p) => (
              <option key={p.value} value={p.value}>
                {p.value} ({p.count})
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="history-confidence" className="font-medium text-slate-700">
            Confidence
          </label>
          <select
            id="history-confidence"
            className={control}
            value={confidence}
            onChange={(e) => {
              const preset = e.target.value as ConfidencePreset;
              onChange((current) => withConfidence(current, preset));
            }}
          >
            <option value="any">Any</option>
            {CONFIDENCE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
            {confidence === 'custom' && (
              <option value="custom" disabled>
                Custom range
              </option>
            )}
          </select>
        </div>

        <div className="flex flex-col gap-1 text-sm">
          <label htmlFor="history-scope" className="font-medium text-slate-700">
            Belongs to
          </label>
          <select
            id="history-scope"
            className={control}
            value={scopeOf(filters)}
            disabled={Boolean(filters.requestId)}
            onChange={(e) => {
              const scope = e.target.value as 'all' | 'linked' | 'adhoc';
              onChange((current) => withScope(current, scope));
            }}
          >
            <option value="all">Any classification</option>
            <option value="linked">A request</option>
            <option value="adhoc">No request (ad hoc)</option>
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="space-y-1 text-sm">
          <span className="font-medium text-slate-700">When</span>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Time range">
            <button
              type="button"
              className={chip(noTime)}
              aria-pressed={noTime}
              onClick={() => onChange((current) => clearFilter(current, 'time'))}
            >
              Any time
            </button>
            {TIME_RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                className={chip(filters.range === r.value)}
                aria-pressed={filters.range === r.value}
                onClick={() => onChange((current) => withRange(current, r.value))}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3 text-sm">
          <div className="flex flex-col gap-1">
            <label htmlFor="history-from" className="font-medium text-slate-700">
              From
            </label>
            <input
              id="history-from"
              type="date"
              className={control}
              value={filters.from ?? ''}
              max={filters.to}
              onChange={(e) => {
                const from = e.target.value;
                onChange((current) => withDays(current, { from, to: current.to }));
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="history-to" className="font-medium text-slate-700">
              To (included)
            </label>
            <input
              id="history-to"
              type="date"
              className={control}
              value={filters.to ?? ''}
              min={filters.from}
              onChange={(e) => {
                const to = e.target.value;
                onChange((current) => withDays(current, { from: current.from, to }));
              }}
            />
          </div>
        </div>
      </div>

      {active.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <span className="text-sm text-slate-500">Filtering by</span>
          {active.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-800 hover:bg-slate-200"
              aria-label={`Remove filter: ${label}`}
              onClick={() => onChange((current) => clearFilter(current, id))}
            >
              {label} <span aria-hidden="true">×</span>
            </button>
          ))}
          <button
            type="button"
            className="text-sm text-slate-600 underline hover:text-slate-900"
            onClick={() => onChange(() => ({}))}
          >
            Clear all
          </button>
        </div>
      )}
    </section>
  );
}
