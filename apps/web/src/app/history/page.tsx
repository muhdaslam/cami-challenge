'use client';

import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import { fetchHistory, fetchHistoryFacets } from '@/lib/api';
import {
  activeFilters,
  HistoryFilters,
  parseFilters,
  toApiParams,
  toSearchParams,
  withRequest,
} from '@/lib/history-filters';
import { FilterPanel } from './filter-panel';
import { HistoryTable } from './history-table';

// useSearchParams needs a Suspense boundary above it, or the page cannot be built ahead of time.
export default function HistoryPage() {
  return (
    <Suspense fallback={<p className="text-slate-600">Loading history…</p>}>
      <HistoryView />
    </Suspense>
  );
}

function HistoryView() {
  const router = useRouter();
  const pathname = usePathname();
  const urlKey = useSearchParams().toString();

  // The filters live in the URL: a view can be shared or bookmarked, and survives a reload
  // and the back button.
  const filters = useMemo(() => parseFilters(new URLSearchParams(urlKey)), [urlKey]);
  // "The last 24 hours" becomes a moment once per URL, so every page of results shares it.
  const apiParams = useMemo(() => toApiParams(filters, new Date()), [filters]);

  // The URL takes a moment to catch up with a change. Changes made in that moment (two clicks
  // in quick succession) must build on each other, not on the URL they both started from, so
  // each change is a function of the latest filters asked for.
  //
  // A change is a step in the browser history, so the back button undoes it. Search is the
  // exception (see FilterPanel): it replaces the entry, or every pause in typing would leave one.
  const latest = useRef(filters);
  useEffect(() => {
    latest.current = filters;
  }, [filters]);
  const updateFilters = useCallback(
    (change: (current: HistoryFilters) => HistoryFilters, options?: { replace?: boolean }) => {
      const next = change(latest.current);
      latest.current = next;
      const query = toSearchParams(next).toString();
      const go = options?.replace ? router.replace : router.push;
      go(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  const history = useInfiniteQuery({
    queryKey: ['history', urlKey],
    queryFn: ({ pageParam }) => fetchHistory(apiParams, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    // Keep the old rows on screen while a new filter loads, instead of flashing "Loading".
    placeholderData: keepPreviousData,
    // A view starts from its first page every time. Cached, the pages of a long list that was
    // loaded page by page would all be fetched again, one after another, once they go stale.
    gcTime: 0,
  });
  const facets = useQuery({
    queryKey: ['history-facets', urlKey],
    queryFn: () => fetchHistoryFacets(apiParams),
    placeholderData: keepPreviousData,
  });

  const items = history.data?.pages.flatMap((page) => page.items) ?? [];
  const total = history.data?.pages[0]?.total ?? 0;
  const filtered = activeFilters(filters).length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Classification history</h2>
        <p className="mt-1 text-sm text-slate-600">
          Every classification the API has made, newest first: what was classified, the result,
          and which provider produced it.
        </p>
      </div>

      <FilterPanel filters={filters} facets={facets.data} onChange={updateFilters} />

      {history.isError ? (
        <p className="text-red-700">Could not load the classification history.</p>
      ) : !history.data ? (
        <p className="text-slate-600">Loading history…</p>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
          {filtered ? (
            <>
              <p>No classifications match these filters.</p>
              <button
                type="button"
                className="mt-1 underline hover:text-slate-900"
                onClick={() => updateFilters(() => ({}))}
              >
                Clear all filters
              </button>
            </>
          ) : (
            <>
              <p>No classifications yet.</p>
              <p className="mt-1">
                Use Classify on the <a className="underline" href="/">Requests</a> page and they
                will show up here.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-600" aria-live="polite">
            {items.length < total
              ? `Showing ${items.length} of ${total}${filtered ? ' matching the filters' : ''}`
              : `${total} classification${total === 1 ? '' : 's'}${filtered ? ' matching the filters' : ''}`}
          </p>
          <HistoryTable
            items={items}
            dimmed={history.isPlaceholderData}
            onSelectRequest={(requestId) => updateFilters((current) => withRequest(current, requestId))}
          />
          {history.hasNextPage && (
            <button
              type="button"
              className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
              disabled={history.isFetchingNextPage}
              onClick={() => history.fetchNextPage()}
            >
              {history.isFetchingNextPage ? 'Loading…' : `Load more (${total - items.length} more)`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
