# Decisions

Use this file to record assumptions, trade-offs, prioritisation, and anything you cut.

## Prioritisation

What did you tackle first, what did you defer, and why?

- List performance (`GET /requests`) first: backend-only, the response contract is unchanged,
  and it can be checked byte-for-byte against the old output.

## Assumptions

## Trade-offs

### List performance

- **Cause:** `RequestsService.list()` ran one `notes.find()` per request (N+1) and loaded every
  note body just to derive a count and a preview: 1,202 queries per call on 1,201 requests.
- **Fix:** one statement with correlated sub-selects for `COUNT(*)` and the newest note body.
  Requests without notes still list as `0` / `null` (a join would drop them), one statement is
  one consistent snapshot, and Postgres evaluates the sub-selects after `ORDER BY` / `LIMIT`, so
  pagination stays cheap to add. `id` is a tie-breaker so the order is deterministic.
- **Result:** median 224.7 ms -> 4.4 ms (same process, same DB, warm cache), 1,202 queries -> 1.
  The HTTP response was byte-identical to the old implementation on the live data.
- **Tests:** `apps/api/test/requests-list.test.ts` needs Postgres (`DATABASE_URL`) and is skipped
  otherwise. Each assertion was mutation-checked: it fails when the matching bug is reintroduced
  (extra query per row, oldest note as "latest", wrong order, note-less requests dropped).
- **Not done:** pagination (changes the response contract, and the UI only renders the first 25
  rows) and a `(request_id, created_at DESC)` index (the existing index is enough at this size:
  ~9 ms in `EXPLAIN ANALYZE`).

## Classification history scope

What you implemented for history / provider seam, and what you left out.

## Stretch (if any)

## What you would do with more time

- Paginate `GET /requests` (keyset on `created_at, id`) and have the UI use it instead of
  fetching everything and slicing 25 rows client-side.
- Add the `(request_id, created_at DESC)` index if notes per request grow enough for the
  latest-note lookup to show up in `EXPLAIN`.
