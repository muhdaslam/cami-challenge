# Decisions

Use this file to record assumptions, trade-offs, prioritisation, and anything you cut.

## Prioritisation

What did you tackle first, what did you defer, and why?

- List performance (`GET /requests`) first: backend-only, the response contract is unchanged,
  and it can be checked byte-for-byte against the old output.
- UI freshness second: client-only and small, and the list is now fast enough (~4 ms) that
  refetching it after every mutation is cheap.
- CI third: a one-line cause, but it interacts with the Postgres-backed test from the first task.

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

### UI freshness

- **Cause:** in `apps/web/src/app/page.tsx` only the create mutation invalidated the `['requests']`
  query. The status and classify mutations never touched it, and `providers.tsx` sets
  `staleTime: 10_000` and `refetchOnWindowFocus: false`, so nothing refetched until a reload.
  The status `<select>` is driven by the cached list, so it also snapped back to the old value.
  Reproduced in headless Chrome first: the API stored the new status / category, the UI kept the
  old ones, and no `GET /requests` followed the `PATCH` / `POST`.
- **Fix:** both mutations invalidate `['requests']` in `onSettled` (not `onSuccess`, so a failed
  call also resyncs with the server). The status change additionally patches the cached row in
  `onMutate`, after `cancelQueries`. Classify is not optimistic: the API decides category,
  confidence and the `open` -> `in_progress` transition, so the client refetches rather than
  guessing them.
- **Refetch cost:** the API returned every request (367,337 B for 1,200 rows, uncompressed) while
  the table shows 25 (7,697 B, ~48x less), and every refetch and page load paid for it.
  `GET /requests` now takes an optional `?limit=` (absent = all rows, unchanged; below 1 or
  non-numeric = 400) and the page asks for 25. Postgres runs the note sub-selects only for the
  returned rows (`loops=25` in `EXPLAIN ANALYZE`, 0.4 ms). Tests check that the limited call
  equals the head of the unbounded list, that the `LIMIT` is in the SQL (a JS-side slice fails),
  that the default is not truncated, and that the controller rejects a limit below 1; each was
  mutation-checked.
- **Alternatives not taken:** `GET /requests/:id` for the updated row (it returns the entity plus
  every note and has no `noteCount` / `latestNotePreview`, so it is not list-shaped), and
  returning the updated row from PATCH / classify to patch the cache (changes two response
  contracts, classify is reworked in tasks 4 and 5, and it drops the free resync of other rows).
  `updateStatus` and `classify` still load the entity and all its notes before updating; left for
  tasks 4 and 6.
- **Why `cancelQueries`:** with 150 ms of latency per call, changing a second row while the first
  row's refetch was in flight let that stale response overwrite the optimistic value, and the
  select reverted for 6 frames. With the call, 0 frames revert (checked by removing it).
- **Verification:** scripted headless Chrome against a throwaway Postgres (dev data untouched):
  single status change, classify, six sequential changes, two near-simultaneous changes, a
  failed `PATCH` (UI reverts to the server value), and the 25 visible rows identical before and
  after a hard reload. The scripts are not committed.
- **Known limit:** the select still shows the old value for one animation frame right after a
  change, because TanStack notifies React through a `setTimeout(0)` hop. Removing it would need
  local pending state or React's `useOptimistic`; not worth the extra code here.
- **Not done:** an automated test. `apps/web` has no test runner, and adding vitest plus a DOM
  environment is a separate decision. `staleTime` / `refetchOnWindowFocus` are left as they are:
  fine for reads once mutations invalidate.

### CI

- **Cause:** the Migrate step overrode `DATABASE_URL` with `.../cami_app`, but the Postgres service
  only creates `cami` (`POSTGRES_DB: cami`, and every other URL in the repo uses `cami`), so it
  failed with `database "cami_app" does not exist`. It passes locally because a local
  `DATABASE_URL` points at `cami`. It was the only failing step; install, typecheck, tests and
  build were already green on a clean checkout.
- **Fix:** removed the override so Migrate uses the job-level `DATABASE_URL`, and moved Migrate
  before Test. The Postgres-backed list test runs the migrations itself in `beforeAll`, so with
  Migrate after Test both tables already existed when it ran (checked with a probe step): it
  could never catch a broken migration. Now it runs on an empty database and the tests run on a
  migrated one.
- **Verification:** replayed the steps parsed from `ci.yml` against a clean `git archive` of HEAD
  in a `node:20` container (Node 20.20.2, npm 10.8.2, Debian 12) with a `postgres:16-alpine`
  service and `CI=true`: only Migrate failed before, all seven steps pass after. This is not
  GitHub's runner (Debian slim, not Ubuntu), so the first real run is the final check. The replay
  scripts are not committed.
- **Not done:** the Lint step is a no-op (there is no `lint` script, so `--if-present` skips it),
  and the Node version is left at 20.

## Classification history scope

What you implemented for history / provider seam, and what you left out.

## Stretch (if any)

## What you would do with more time

- Real pagination for `GET /requests` (keyset on `created_at, id`) with a way to see rows beyond
  the newest 25; today `?limit=` only bounds the list. `customer_requests` has no `created_at`
  index, so the plan is a Seq Scan plus a top-N sort of ~1.2k rows: fine now, worth an index at
  scale.
- Add the `(request_id, created_at DESC)` index if notes per request grow enough for the
  latest-note lookup to show up in `EXPLAIN`.
- Add a web test runner and cover the status / classify cache behaviour. When classifications
  are persisted (history), invalidate `['history']` on classify if navigation becomes
  client-side; today the nav uses plain `<a>` links, so every navigation is a full reload.
