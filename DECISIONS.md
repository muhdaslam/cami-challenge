# Decisions

Use this file to record assumptions, trade-offs, prioritisation, and anything you cut.

## Prioritisation

What did you tackle first, what did you defer, and why?

- List performance (`GET /requests`) first: backend-only, the response contract is unchanged,
  and it can be checked byte-for-byte against the old output.
- UI freshness second: client-only and small, and the list is now fast enough (~4 ms) that
  refetching it after every mutation is cheap.
- CI third: a one-line cause, but it interacts with the Postgres-backed test from the first task.
- Controller structure fourth: classify only, not a rewrite. Validation, the two rules and
  persistence each got one home, so task 5's provider swap and history insert have an obvious place.
- Classification history last, as the largest slice. It builds on that layering: the provider seam,
  the transaction and the history insert each landed in `ClassificationService`.
- Persistence boundary (stretch) after that: by then the leak was concrete and measurable (a
  `DataSource` in the service and an `EntityManager` in two other services' signatures), so the seam
  could be shaped by what actually hurt.
- Richer history filters (stretch) last: it needs the history table (task 5) and the log port
  (persistence boundary) to exist, and the API had to come first, since the UI can only offer what
  the API can answer.

## Assumptions

Classification history (task 5):

- **Every classify call is recorded**, including ad-hoc calls with no `requestId` (stored with
  `request_id` NULL). Ad-hoc text has no request to cascade-delete it, so a retention and deletion
  policy is an open question before real customer text goes through that path.
- **The history is an append-only log.** Classifying a request twice gives two rows; the request
  itself keeps only the latest result. The app never updates or deletes history rows.
- **A row stores** the trimmed text that was classified (what the client sent, which is not
  necessarily the request's stored message), the final result after the policy rules, and the
  provider name. It does not store the provider's raw answer; for an LLM that, plus model and
  prompt version, would be worth adding.
- **Provider name is provenance.** For an LLM it should carry model and prompt version
  (for example `some-model@prompt-v3`), because history is what lets you compare providers.
- **Only applied classifications are recorded.** An unknown request (404), a failing provider (502)
  or an invalid provider answer (502) leaves no row.
- **History rows are deleted with their request** (`ON DELETE CASCADE`, like notes). There is no
  delete endpoint today.
- **Categories are a closed set** (`support`, `sales`, `billing`, `unknown`), enforced in the app
  (DTOs and the provider guard) and not by a database `CHECK`, which would turn every taxonomy
  change into a migration.
- **The list endpoint is strict:** every filter, `limit` and `cursor` is validated and an invalid
  value is a 400, with no silent fallback (unknown parameters are ignored, not rejected). Newest
  first, `limit` defaults to 50 (maximum 200), and `total` counts every match. The filters added
  later are in "Richer history filters".
- **There is no auth or per-user scoping** anywhere in the API, so the history is global.

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
- **Tests:** the list tests (now in `apps/api/test/typeorm-request-store.test.ts`, originally
  `requests-list.test.ts`) need Postgres (`DATABASE_URL`) and are skipped otherwise. Each
  assertion was mutation-checked: it fails when the matching bug is reintroduced
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
- **Not done:** an automated test. `apps/web` had no test runner, and adding vitest plus a DOM
  environment is a separate decision (a Node-only vitest arrived later, for the history filters,
  not for this cache behaviour). `staleTime` / `refetchOnWindowFocus` are left as they are:
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

### Controller structure

- **Cause:** `RequestsController.classify` did validation, two business rules and persistence
  inline, with `body: any` and `existing: any`, and answered invalid input with `201 { error }`.
- **Layers:** the controller is one delegating line (typed DTO in, typed response out).
  `ClassifyRequestDto` (class-validator, route-scoped `ValidationPipe`) validates at the edge.
  `ClassificationService` runs trim -> provider -> rules -> persist. `classification-rules.ts` is the
  pure policy with named constants; it is applied to whatever a provider returns, so it does not
  live in the classifier. `RequestsService.applyClassification` owns `open` -> `in_progress` (a
  request lifecycle rule) and no longer loads every note; `save()` had no other caller and is gone.
- **Dormant rule:** "below 0.55 is `unknown`" can never fire with `KeywordClassifier` (softened
  values are 0.71 / 0.65 / 0.63 and `unknown` is already 0.4). It is tested with a stub provider so
  it still holds when task 5 swaps providers.
- **Deliberate behaviour changes:** invalid message `201 { error }` -> `400`; a non-UUID
  `requestId` `500` -> `400`; `requestId: ""` (echoed back before) -> `400`. Error bodies are Nest's
  standard shape with one reason per field (`stopAtFirstError`, decorator order). Nothing else changes.
- **Verification:** HEAD's controller and the new layers were run side by side over 16,275
  generated cases (word counts, keyword families, whitespace, the 1999 / 2000 / 2001 length
  boundary, non-strings, every `requestId` shape) and differ only in the changes above. An HTTP
  A/B of a HEAD build against the new build on the same database gave byte-identical responses
  for 11 scenarios and identical row changes. Ten injected bugs were each caught by a test (the
  0.5 floor and the 0.55 boundary only by the unit tests, since the keyword classifier cannot reach
  them). The CI replay passes on npm 10.8.2 with the new dependencies (49 tests). The differential
  and HTTP scripts are not committed.
- **Dependencies:** `class-validator` and `class-transformer`. The lockfile change is additions
  only (40 lines), generated with the npm that wrote the existing lock: npm 10 rewrote unrelated
  entries (added `peer` flags, dropped `libc` fields), although CI's npm 10.8.2 installs the result fine.
- **Not done:** `create` still answers `201 { error }` and `updateStatus` persists any string as a
  status. The classify read-modify-write can lose an update to a concurrent status change (task 5's
  history insert wants a transaction anyway). The pipe is route-scoped, not global. The provider is
  not behind an interface yet (task 5); `ClassificationService` is the only class that knows it.
  The pipe wiring is covered only by the HTTP check, because Vitest does not emit the decorator
  metadata `ValidationPipe` uses.

## Classification history scope

What you implemented for history / provider seam, and what you left out.

- **Schema:** table `classification_history` (migration `1789821338890-ClassificationHistory`) with
  three indexes: `(created_at DESC, id DESC)` for the list, `(category, created_at DESC, id DESC)`
  for the filtered list, `(request_id, created_at DESC, id DESC)` for one request and the cascade.
  (A fourth, for the provider filter, came with "Richer history filters".)
  Checked on 60,000 synthetic rows: both list queries are plain index scans (~0.02 ms). The first
  version of the request index lacked `id` and needed a sort; the migration was not deployed, so it
  was edited. `total` is a count scan (~1.5 ms at 60k rows) that grows with the matches; when the
  table gets large, replace it with an estimate or a "has more" flag.
- **Recording:** the history row is written in the same transaction as the request update. This
  first lived in `ClassificationService` with an `EntityManager` passed through two other services;
  it now sits behind the `ClassificationLog` port (see "Persistence boundary"). A Postgres test
  proves it: a history insert that fails rolls the request update back, and that test fails if
  the update is moved outside the transaction.
- **Provider interface:** `ClassificationProvider { name; classify(message) }` returns a result or a
  promise of one, so an LLM fits without changing `KeywordClassifier`'s API or test. It is
  injected by a DI token, and the one line in `RequestsModule` that binds it is the swap point.
  The policy rules (short messages, weak results) stay in the service so they apply to any
  provider. A provider is treated as external input: an unknown category or a confidence outside
  [0, 1] is a 502, and so is a provider that throws (the cause is logged).
- **LLM failure modes (design notes, not built):** *timeouts and retries* belong inside the
  provider, bounded, with a 502 rather than a silent "unknown" when it gives up; *malformed or
  invented output* is what the guard catches; *non-determinism* is contained by temperature 0 and
  a versioned provider name; *latency and cost* matter because classify is synchronous in the
  request today, so an LLM would move it to a job and let the UI poll the history; *prompt
  injection and PII*: customer text goes into the prompt, so its output is untrusted (the guard)
  and what may leave the system needs a decision; *rate limits* need backoff.
- **Web:** `/history` shows the category badge, a confidence bar, the message, the provider, and a
  short request id or "ad hoc", with a category filter, "Showing the latest N of M", and loading,
  error and empty states. A screenshot check found the last column clipped (I had copied the
  Requests page's `overflow-hidden` card); the card now scrolls sideways and the message column
  takes the remaining width, and the script measures clipping instead of inferring it. The page
  was rebuilt later; see "Richer history filters".
- **Deploy ordering:** the migration only adds a table, so it is an "expand" step: safe to run
  before the new code ships, and the old code ignores it. The api container migrates at boot, so a
  rolling deploy has to finish the migration before new instances take traffic. Rolling back is
  `down`, which drops the table and its data: acceptable only before real history exists.
- **Test isolation:** the Postgres-backed test files now run one at a time. A whole-table count in
  `requests-list.test.ts` (now `typeorm-request-store.test.ts`) raced with other files inserting
  requests (reproduced: 1 failure in 60 runs; 0 in 120 after the change), and a third database
  file made that likelier. The suite still takes about 1.5 s.
- **Verification:** an A/B of classify against the previous commit gave identical responses and
  request-row changes over 18 scenarios, the only new effect being the history row. Eleven
  injected bugs (no transaction, no recording, no guard, wrong order or filter, `total` from the
  page, missing validation) were each caught by a test. The CI replay passes on npm 10.8.2 with
  the migration run on an empty database (88 tests). The browser scripts are not committed.
- **Left out:** seeding demo history; an env switch for the provider (one implementation, so it
  would be speculative); an LLM provider; the raw provider output; retention and deletion.
  Date-range and provider filters, cursor pagination ("load more") and the per-request drill-down
  were also left out here and were added afterwards ("Richer history filters").

## Stretch (if any)

### Persistence boundary

- **Where it hurt (measured before the change):** three services imported TypeORM, `EntityManager`
  was in two services' public signatures, `ClassificationService` held a `DataSource`, its unit test
  needed four fakes plus a fake transaction, `RequestsService` had no DB-free tests at all, and the
  `open` -> `in_progress` rule lived inside a TypeORM method, so proving it needed Postgres.
- **The seam:** two ports shaped by use case and free of any framework: `RequestStore` (list, find
  with notes, create, update status) and `ClassificationLog` (record, list). Two, not one per table
  and not a generic `Repository<T>` (that would only re-create TypeORM's API): `record` touches the
  request and the history together and they must change together, so one port owns that
  transaction. "Not found" is `null` from a query and a `RequestNotFoundError` from the command,
  which cannot return an absence; the services map both to the same 404 bodies as before.
- **Adapters:** `TypeOrmRequestStore` and `TypeOrmClassificationLog` hold all the TypeORM code (the
  list's SQL moved over unchanged). They return the entities typed as the ports' plain records
  without re-mapping, so the JSON is identical; a test pins its key order.
- **Domain rule:** `classifiedRequest` is pure, so any store shares one implementation of "starts
  work on an open request" and it is tested without a database.
- **Scope, and what it buys:** ports for every data access, as chosen. I had recommended only the
  classify write path, which alone removes the real leak. The read-side ports are pass-throughs with
  one implementation; what they add is DB-free tests for `RequestsService` and
  `ClassificationHistoryService`, tests for get, create and update status that did not exist
  (they now run against the adapter), and a rule a test can enforce. The cost is six files and two
  DI tokens.
- **Guard:** `architecture.test.ts` fails if anything outside the adapters, the entities and the
  module imports TypeORM or an entity, or if a port, model or rule imports a framework.
- **Before -> after:** service files importing TypeORM 3 -> 0; `EntityManager` in service
  signatures 2 -> 0; `ClassificationService` collaborators 4 -> 2; persistence casts in its test
  4 -> 0; services with DB-free tests 1 -> 3; tests that run without Postgres 71 -> 105.
- **Verification:** an A/B of every endpoint against the previous commit (43 scenarios: byte-exact
  for reads, ids and timestamps normalised for writes, including the existing quirks such as a 500
  for a non-UUID id and any string accepted as a status) was identical, as were the request rows
  and history rows the writes left behind. Eleven injected bugs were each caught, among them a
  request update outside the transaction (the Postgres rollback test) and a service importing
  TypeORM (the guard). The CI replay passes with 129 tests. The scripts are not committed.
- **Not done:** an in-memory adapter (it pays rent only with a second consumer); a separate domain
  model (the entities stay shared with `data-source.ts`, the module and the adapters, so the port
  types are satisfied structurally, and a real second store would want its own mapping); a response
  DTO layer (the controller returns the records, whose shape is the API); changing any behaviour,
  including the quirks above.

### Richer history filters

- **What it does:** `/history` filters by category, provider, request (a request id in the table
  drills down), scope (a request / no request), time (presets or custom days), confidence
  (presets) and message text, all combined with AND. Category and provider show how many rows each
  choice would give, and the table loads more pages on demand. The filters live in the URL, so a
  filtered view can be shared, reloaded and stepped through with the back button.
- **API semantics** (`GET /requests/history`, and `GET /requests/history/facets` for the counts):
  `from` is inclusive and `to` exclusive, so adjacent ranges neither overlap nor drop the boundary
  row. `minConfidence` / `maxConfidence` are inclusive, within 0..1. `q` is a case-insensitive
  substring of the classified text (`ILIKE`, with `%`, `_` and `\` escaped so they are literal), 1
  to 100 characters after trimming; it is not a word or full-text search. `requestId` with
  `adHoc=true`, `from` >= `to` and `minConfidence` > `maxConfidence` are 400s (`adHoc=false` with a
  `requestId` is redundant, not wrong). `total` counts every match, not the page.
- **Paging:** keyset, not offset, so a page costs the same however deep it is (80,000 rows in:
  5.6 ms) and rows arriving at the top do not shift a page in progress. The cursor is the last
  row's id, and Postgres decides "after that row" (`(created_at, id) < (SELECT ... WHERE id =
  :cursor)`). A cursor that carried the timestamp would be cut to milliseconds by a JS `Date`
  while Postgres keeps microseconds, so rows created in the same millisecond could be skipped or
  repeated; the paging tests include rows that differ only in the microseconds. A cursor that
  points at no row is a 400, not an empty last page.
- **Facets:** each facet ignores its own filter (choosing "billing" still shows the other
  categories' counts, as they would be if you switched), all four categories are listed even at 0,
  and providers sort by count, then name. It costs two `GROUP BY` scans (~12 ms at 200k rows).
- **Index and search, measured on 200,000 rows before adding anything:** one index was worth it,
  `(provider, created_at DESC, id DESC)` (migration `1789836981276-ClassificationHistoryProviderIndex`).
  A provider with 0.5% of the rows, spread over time, was already fine on the existing index
  (0.5 ms). The bad case is a provider whose few rows are all old, such as one that has been
  replaced: newest-first order cannot find them without reading everything newer, so Postgres
  scanned the whole table (6.6 ms, growing with it) against 0.05 ms and constant with the index.
  Everything else rides the existing indexes or scans cheaply (median of seven HTTP calls, warm
  cache: first page 4.9 ms, category 3.7, ad hoc 1.4, last 24 h 1.0, low confidence 7.4). Search
  is the slow one (31 ms for a common word, 47 ms for no match, since it scans the table). A
  `pg_trgm` GIN index took the count from 80 ms to 4 ms for a common word and from 33 ms to 0.02 ms
  for no match, and I did not add it: it needs an extension (privileges on managed Postgres),
  every classify write would pay for an index on free text, and 30-50 ms at this size is
  acceptable. Search grows with the table, so add it when it stops being (a linear guess: about a
  second at 4 million rows). `total` and the facets are scans that grow with the matches; the
  remedy is the one in "Classification history scope" (a "has more" flag, estimated or cached counts).
- **Sequencing:**
  1. *Migration first.* It only adds an index, so the old API ignores it, and `down` drops it. It
     builds inside the migration's transaction, which blocks inserts into `classification_history`
     while it runs; on a big table that would need `CREATE INDEX CONCURRENTLY` in a migration with
     `transaction = false`, since Postgres refuses it inside a transaction. The api container
     migrates at boot, so a rolling deploy must finish migrating before new instances take traffic.
  2. *API before web.* The new API is a superset: the old parameters behave the same and the
     response only gains `nextCursor`, which the old page ignores. The other order is worse: an old
     API silently drops filters it does not know (checked against the previous build: a
     `provider`, a `q` and a `minConfidence` that match nothing still returned all 131 rows, and
     `/facets` is a 404), so a new page would present unfiltered rows as filtered and could not
     page.
  3. *Rollback* is the reverse: web, then API; the index can stay, it is harmless.
- **The URL is the state.** `parseFilters` keeps only values the API would accept and drops the
  rest, so a hand-edited or stale URL cannot break the page or send garbage (the API is strict on
  its own regardless). A request id beats "ad hoc only" when both are in a URL, since the pair would
  be a 400; choosing a scope drops the request, and drilling into a request drops "ad hoc only".
- **Time:** presets (24 h, 7 d, 30 d) are resolved to `from` when the request is sent, and they
  exclude custom days (choosing one clears the other; a URL with both keeps the preset). Custom
  From / To are the viewer's local days, and "To" is shown as included, so it is sent as the start
  of the next local day (the API's `to` is exclusive). The API only takes instants, so what
  counts as "a day" is decided by the browser, and two viewers in different zones see different days.
- **Confidence is three presets, not number boxes:** high >= 0.8, medium 0.6 to 0.79, low <= 0.59.
  Known limit: the cuts are at two decimals and the column is a `double`, so a confidence strictly
  between 0.79 and 0.8 (or 0.59 and 0.6) matches no preset (it still shows under "Any"). Today's
  classifier and rules only produce 0.86, 0.8, 0.78, 0.4 and their softened values, and no stored
  row is in a gap, but a provider with finer confidences would need an exclusive upper bound
  (`[min, max)`, like `from` / `to`) so the presets partition the range.
- **Found by driving a real browser (mine, since fixed):** two quick changes (From, then To)
  overwrote each other, because handlers built the next URL from the render's filters before the
  previous change had landed; updates are now functions of the latest filters. The infinite query
  is `gcTime: 0`, since a cached one showed 130 old rows after "Clear all" and would refetch every
  loaded page once stale. The back button skipped filter changes while everything used `replace`;
  discrete changes now push, and only the debounced search (300 ms) replaces, so typing does not
  leave an entry per pause. Wrapping a `<select>` in its `<label>` gave the label the text of every
  option as its name; the labels now use `htmlFor`.
- **Web tests:** `apps/web` now has vitest (Node only, no DOM) with 49 tests of the pure filter
  module: parsing, serialising, presets, day boundaries, the contradiction rules. The page itself
  is covered by browser scripts that are not committed. The lockfile gains one line. I first let
  npm pick 4.1.11, which also bumped the API's vitest and rewrote 349 lines of the lock, and
  reverted to the exact 4.1.10 the API already uses.
- **Verification:** (a) the API against independent SQL on 200,000 rows: totals, first-page ids and
  next-page flags for 12 filter combinations; a walk of 136 pages of 37 rows in the exact SQL order
  with no gaps or repeats; facets equal `GROUP BY`; 18 invalid inputs each got one precise 400; the
  old parameters returned the previous commit's bytes apart from the new `nextCursor`. (b) 22
  injected bugs (bounds off by one, scope swapped, case-sensitive search, unescaped wildcards,
  cursor direction, no look-ahead row, `total` from the page, an ignored filter, a facet applying its
  own filter, the DTO and service checks, the web's day boundaries and preset edges), each caught by
  a test. (c) Headless Chrome on 130 controlled rows: counts on the chips equal SQL, every control,
  the debounce race, back button, shared URL, reload, hostile URL, empty state, drill-down, no
  clipped table at 1200 px and a sideways scroll at 700 px; the Requests page scripts from earlier
  tasks still pass. (d) The CI replay passes on npm 10.8.2 with the lockfile untouched by `npm ci`,
  the migrations run on an empty database, and 239 tests (190 API, 49 web). The scripts are not
  committed.
- **Not done:** choosing several categories or providers at once; other sort orders; saved
  filters and export; word or full-text search and the trigram index above; DOM-level component
  tests; estimated totals. A retention policy for ad-hoc text is still open.

## What you would do with more time

- Real pagination for `GET /requests` (keyset on `created_at, id`) with a way to see rows beyond
  the newest 25; today `?limit=` only bounds the list. `customer_requests` has no `created_at`
  index, so the plan is a Seq Scan plus a top-N sort of ~1.2k rows: fine now, worth an index at
  scale.
- Add the `(request_id, created_at DESC)` index if notes per request grow enough for the
  latest-note lookup to show up in `EXPLAIN`.
- Extend the web tests (vitest now covers only the pure history filter logic) with a DOM
  environment, to cover the status / classify cache behaviour and the pages. Invalidate
  `['history']` when a classification finishes if navigation becomes client-side; today the nav
  uses plain `<a>` links, so every navigation is a full reload.
- Give `create` and `updateStatus` the same DTO treatment (an invalid status is currently
  stored as-is), then consider a global `ValidationPipe`.
- History: a retention policy for ad-hoc text, an estimated `total` and cached facets once the
  table is large, the trigram index if search gets slow, and half-open confidence buckets if a
  provider reports finer confidences.
