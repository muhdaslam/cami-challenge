'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  classifyMessage,
  createRequest,
  fetchRequests,
  RequestListItem,
  RequestStatus,
  updateRequestStatus,
} from '@/lib/api';

const STATUSES: RequestStatus[] = ['open', 'in_progress', 'resolved'];
const REQUESTS_KEY = ['requests'] as const;

export default function HomePage() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');

  const requestsQuery = useQuery({
    queryKey: REQUESTS_KEY,
    queryFn: fetchRequests,
  });

  const createMutation = useMutation({
    mutationFn: (message: string) => createRequest(message),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: REQUESTS_KEY });
      setDraft('');
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: RequestStatus }) =>
      updateRequestStatus(id, status),
    // The <select> is driven by the cached list, so patch the row now; otherwise it snaps
    // back to the old status until the refetch below lands.
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: REQUESTS_KEY });
      queryClient.setQueryData<RequestListItem[]>(REQUESTS_KEY, (rows) =>
        rows?.map((row) => (row.id === id ? { ...row, status } : row)),
      );
    },
    // onSettled, not onSuccess: a failed update also resyncs with the server, which undoes
    // the optimistic patch.
    onSettled: () => queryClient.invalidateQueries({ queryKey: REQUESTS_KEY }),
  });

  const classifyMutation = useMutation({
    mutationFn: ({ id, message }: { id: string; message: string }) =>
      classifyMessage(message, id),
    // The API decides category, confidence and the open -> in_progress transition, so
    // refetch instead of guessing them client-side.
    onSettled: () => queryClient.invalidateQueries({ queryKey: REQUESTS_KEY }),
  });

  if (requestsQuery.isLoading) {
    return <p className="text-slate-600">Loading requests…</p>;
  }

  if (requestsQuery.isError) {
    return (
      <p className="text-red-700">
        Could not load requests. Is the API running at{' '}
        {process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}?
      </p>
    );
  }

  const requests = requestsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Open requests</h2>
        <p className="mt-1 text-sm text-slate-600">
          Update status or run classification. Seeded volume is intentional — watch API
          behaviour under load.
        </p>
      </div>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const message = draft.trim();
          if (message) {
            createMutation.mutate(message);
          }
        }}
      >
        <input
          className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Log a new customer request…"
        />
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {createMutation.isPending ? 'Adding…' : 'Add request'}
        </button>
      </form>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Message</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Notes</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {requests.map((row) => (
              <tr key={row.id}>
                <td className="max-w-md px-4 py-3">
                  <div className="font-medium text-slate-900">{row.message}</div>
                  {row.latestNotePreview ? (
                    <div className="mt-1 text-xs text-slate-500">
                      Latest note: {row.latestNotePreview}
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <select
                    className="rounded border border-slate-300 bg-white px-2 py-1"
                    value={row.status}
                    onChange={(e) =>
                      statusMutation.mutate({
                        id: row.id,
                        status: e.target.value as RequestStatus,
                      })
                    }
                  >
                    {STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3 tabular-nums">{row.noteCount}</td>
                <td className="px-4 py-3">
                  {row.category ?? '—'}
                  {row.confidence != null ? (
                    <span className="ml-1 text-xs text-slate-500">
                      ({row.confidence.toFixed(2)})
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                    onClick={() =>
                      classifyMutation.mutate({ id: row.id, message: row.message })
                    }
                  >
                    Classify
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(statusMutation.isSuccess || classifyMutation.isSuccess) && (
        <p className="text-sm text-slate-600">Last action reported success from the API.</p>
      )}
    </div>
  );
}
