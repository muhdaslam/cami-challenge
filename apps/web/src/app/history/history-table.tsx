import { ClassificationCategory, ClassificationHistoryItem } from '@/lib/api';

// Full class names on purpose: Tailwind only generates classes it can find in the source.
const CATEGORY_STYLES: Record<ClassificationCategory, string> = {
  billing: 'bg-amber-100 text-amber-800',
  sales: 'bg-emerald-100 text-emerald-800',
  support: 'bg-sky-100 text-sky-800',
  unknown: 'bg-slate-100 text-slate-600',
};

function HistoryRow({
  item,
  onSelectRequest,
}: {
  item: ClassificationHistoryItem;
  onSelectRequest: (requestId: string) => void;
}) {
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
          <button
            type="button"
            className="underline decoration-dotted underline-offset-2 hover:text-slate-900"
            title={`Show only this request (${item.requestId})`}
            onClick={() => onSelectRequest(item.requestId!)}
          >
            {item.requestId.slice(0, 8)}
          </button>
        ) : (
          <span className="font-sans text-slate-400">ad hoc</span>
        )}
      </td>
    </tr>
  );
}

export function HistoryTable({
  items,
  dimmed,
  onSelectRequest,
}: {
  items: ClassificationHistoryItem[];
  dimmed: boolean;
  onSelectRequest: (requestId: string) => void;
}) {
  return (
    <div
      className={`overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm ${
        dimmed ? 'opacity-60' : ''
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
          {items.map((item) => (
            <HistoryRow key={item.id} item={item} onSelectRequest={onSelectRequest} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
