'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  CLASSIFICATION_CATEGORIES,
  ClassificationCategory,
  ClassificationHistoryItem,
  fetchHistory,
} from '@/lib/api';

// Full class names on purpose: Tailwind only generates classes it can find in the source.
const CATEGORY_STYLES: Record<ClassificationCategory, string> = {
  billing: 'bg-amber-100 text-amber-800',
  sales: 'bg-emerald-100 text-emerald-800',
  support: 'bg-sky-100 text-sky-800',
  unknown: 'bg-slate-100 text-slate-600',
};

function HistoryRow({ item }: { item: ClassificationHistoryItem }) {
  const percent = Math.round(item.confidence * 100);

  return (
    <tr>
      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
        {new Date(item.createdAt).toLocaleString()}
      </td>
      <td className="px-4 py-3">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_STYLES[item.category]}`}
        >
          {item.category}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-slate-700" style={{ width: `${percent}%` }} />
          </div>
          <span className="tabular-nums text-slate-700">{percent}%</span>
        </div>
      </td>
      {/* Takes the width the other columns leave and truncates; scrolls sideways when too narrow. */}
      <td className="w-full min-w-[12rem] max-w-0 px-4 py-3">
        <div className="truncate text-slate-900" title={item.message}>
          {item.message}
        </div>
      </td>
      <td className="px-4 py-3 font-mono text-xs text-slate-600">{item.provider}</td>
      <td className="px-4 py-3 font-mono text-xs text-slate-600">
        {item.requestId ? (
          <span title={item.requestId}>{item.requestId.slice(0, 8)}</span>
        ) : (
          <span className="font-sans text-slate-400">ad hoc</span>
        )}
      </td>
    </tr>
  );
}

export default function HistoryPage() {
  const [category, setCategory] = useState<ClassificationCategory | ''>('');
  const historyQuery = useQuery({
    queryKey: ['history', category],
    queryFn: () => fetchHistory(category || undefined),
    // Keep the old rows on screen while a new filter loads, instead of flashing "Loading".
    placeholderData: keepPreviousData,
  });

  const page = historyQuery.data;
  const inCategory = category ? ` in ${category}` : '';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Classification history</h2>
        <p className="mt-1 text-sm text-slate-600">
          Every classification the API has made, newest first: what was classified, the result,
          and which provider produced it.
        </p>
      </div>

      <label className="flex max-w-xs flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">Category</span>
        <select
          className="rounded border border-slate-300 bg-white px-3 py-2"
          value={category}
          onChange={(e) => setCategory(e.target.value as ClassificationCategory | '')}
        >
          <option value="">All categories</option>
          {CLASSIFICATION_CATEGORIES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>

      {historyQuery.isError ? (
        <p className="text-red-700">Could not load the classification history.</p>
      ) : !page ? (
        <p className="text-slate-600">Loading history…</p>
      ) : page.items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
          <p>No classifications{inCategory} yet.</p>
          <p className="mt-1">
            Use Classify on the <a className="underline" href="/">Requests</a> page and they will
            show up here.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-slate-600">
            {page.items.length < page.total
              ? `Showing the latest ${page.items.length} of ${page.total}${inCategory}`
              : `${page.total} classification${page.total === 1 ? '' : 's'}${inCategory}`}
          </p>
          <div
            className={`overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm ${
              historyQuery.isPlaceholderData ? 'opacity-60' : ''
            }`}
          >
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Confidence</th>
                  <th className="px-4 py-3">Message</th>
                  <th className="px-4 py-3">Provider</th>
                  <th className="px-4 py-3">Request</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {page.items.map((item) => (
                  <HistoryRow key={item.id} item={item} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
