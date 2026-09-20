const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export type RequestStatus = 'open' | 'in_progress' | 'resolved';

export type RequestListItem = {
  id: string;
  message: string;
  status: RequestStatus;
  category: string | null;
  confidence: number | null;
  noteCount: number;
  latestNotePreview: string | null;
  createdAt: string;
  updatedAt: string;
};

// The table shows this many rows, so that is all we ask the API for.
export const REQUEST_LIST_LIMIT = 25;

// Takes no arguments on purpose: TanStack Query passes a context object as the first
// argument of a queryFn, which would end up in the URL.
export async function fetchRequests(): Promise<RequestListItem[]> {
  const res = await fetch(`${API_URL}/requests?limit=${REQUEST_LIST_LIMIT}`);
  if (!res.ok) {
    throw new Error(`Failed to load requests (${res.status})`);
  }
  return res.json();
}

export type CreatedRequest = {
  id: string;
  message: string;
  status: RequestStatus;
  createdAt: string;
  updatedAt: string;
};

export async function createRequest(message: string): Promise<CreatedRequest> {
  const res = await fetch(`${API_URL}/requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    throw new Error(`Failed to create request (${res.status})`);
  }
  return res.json();
}

export async function updateRequestStatus(
  id: string,
  status: RequestStatus,
): Promise<RequestListItem> {
  const res = await fetch(`${API_URL}/requests/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    throw new Error(`Failed to update status (${res.status})`);
  }
  return res.json();
}

export async function classifyMessage(message: string, requestId?: string) {
  const res = await fetch(`${API_URL}/requests/classify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, requestId }),
  });
  if (!res.ok) {
    throw new Error(`Failed to classify (${res.status})`);
  }
  return res.json();
}

export const CLASSIFICATION_CATEGORIES = ['billing', 'sales', 'support', 'unknown'] as const;

export type ClassificationCategory = (typeof CLASSIFICATION_CATEGORIES)[number];

export type ClassificationHistoryItem = {
  id: string;
  // Null for a classification that was not attached to a request.
  requestId: string | null;
  message: string;
  category: ClassificationCategory;
  confidence: number;
  provider: string;
  createdAt: string;
};

export type ClassificationHistoryPage = {
  items: ClassificationHistoryItem[];
  // Every match, not only the rows returned.
  total: number;
  // Pass it back to get the next page; null on the last one.
  nextCursor: string | null;
};

export type FacetCount<T extends string = string> = { value: T; count: number };

// How many classifications match per value, under every filter except that facet's own.
export type ClassificationHistoryFacets = {
  category: FacetCount<ClassificationCategory>[];
  provider: FacetCount[];
};

// The history table loads this many rows at a time.
export const HISTORY_LIMIT = 50;

// `filters` are the API's own parameter names; see toApiParams in history-filters.ts.
export async function fetchHistory(
  filters: URLSearchParams,
  cursor?: string,
): Promise<ClassificationHistoryPage> {
  const params = new URLSearchParams(filters);
  params.set('limit', String(HISTORY_LIMIT));
  if (cursor) {
    params.set('cursor', cursor);
  }
  const res = await fetch(`${API_URL}/requests/history?${params}`);
  if (!res.ok) {
    throw new Error(`Failed to load history (${res.status})`);
  }
  return res.json();
}

export async function fetchHistoryFacets(
  filters: URLSearchParams,
): Promise<ClassificationHistoryFacets> {
  const res = await fetch(`${API_URL}/requests/history/facets?${filters}`);
  if (!res.ok) {
    throw new Error(`Failed to load history filters (${res.status})`);
  }
  return res.json();
}
