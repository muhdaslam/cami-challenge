# AI Usage

## Tools used

- **Claude Code** (Anthropic's coding agent) in its VS Code extension, model `claude-sonnet-5`, for
  all seven tasks. It worked inside the repo: it read the code, wrote plans, edited files, ran the
  shell, and wrote the tests and the notes in `DECISIONS.md`.
- What it ran from there: Docker (a throwaway Postgres 16 container for every database check, never
  my compose stack, and a replica of the GitHub Actions job in a `node:20` container), `psql` with
  `EXPLAIN ANALYZE`, Vitest, `tsc`, headless Chrome through `playwright-core` (browser checks and
  screenshots), and one-off Node and bash scripts (HTTP comparisons against a build of the previous
  commit, and mutation checks). Those scripts are not committed; `DECISIONS.md` says which result
  came from which check.

## How I used AI

- One task at a time, in the README's order, one commit per task. I committed each one myself.
- For the larger changes Claude wrote a plan first and I approved it before any code (five plans:
  the list N+1, bounding the list, the classify layers, classification history, the persistence
  boundary). None was sent back.
- Where a decision was mine, it asked a multiple-choice question with a recommended option (six in
  all) and the answer went into `DECISIONS.md` with the alternatives.
- Checks were run, not just read: reproduce the bug first (the stale UI in headless Chrome, CI by
  replaying the workflow), compare with the previous commit where behaviour had to stay the same,
  and reintroduce each bug to see that a test fails.

## What I changed or rejected

### Calls that were mine

- **Rejected: discarding a generated file.** Running Next.js rewrote `apps/web/next-env.d.ts`
  while Claude was verifying the UI fix. Claude tried to clean it up with
  `git checkout -- apps/web/next-env.d.ts`; I rejected that command, asked why the file had
  changed, and reverted it myself.
- **Overridden: how far the persistence seam goes.** Claude recommended one port, for the classify
  write path only (the smallest change that removes the real leak). I chose ports for every data
  access. What that costs (six files, two DI tokens) and what it buys (database-free tests for
  `RequestsService` and the history list, tests for get / create / update status that did not
  exist, a guard test) are in `DECISIONS.md`.
- **Questioned: refetching after an update.** I asked whether, after an update, the client should
  refetch the whole list or just get the updated request. The alternatives were written up (they are
  under "Alternatives not taken" in `DECISIONS.md`) and I took the cheaper one Claude recommended,
  `?limit=25`, over returning the updated row from PATCH and classify.
- **Accepted: the other four recommendations.** Leave the server-side update as it is for now, a
  class-validator DTO, HTTP 400s for invalid classify input, and recording every classify call
  including ad hoc ones. Each has its cost and alternative in `DECISIONS.md`.

### What Claude got wrong, and what changed

Mostly caught by checks (a comparison with the previous commit, `EXPLAIN`, repeated test runs, a
browser run, a screenshot), not by reading the code.

- **The old behaviour, described wrongly.** It first said invalid input to `POST /requests/classify`
  answered `200 { error }`. It answers `201 { error }`, because a `@Post` defaults to 201. This was
  corrected before I approved the plan, and the change is recorded as `201 { error }` -> `400`.
- **An index that needed a sort.** The first `request_id` index on the history table lacked `id`,
  so the list query still sorted. `EXPLAIN` on 60,000 synthetic rows showed it; the migration was
  edited before it shipped.
- **A clipped column.** The history page's last column was cut off because Claude copied the
  Requests page's `overflow-hidden` card. A screenshot showed it, and the check now measures
  clipping instead of inferring it.
- **A flaky database test.** A whole-table count raced with other test files inserting requests
  (1 failure in 60 runs). The database test files now run one at a time (0 failures in 120).
- **An invalid mutation run.** Its first mutation-testing script ran under zsh, which does not
  word-split `$FILES`, so the backups and the restore did nothing and six source files were left
  mutated. It noticed because every result said the mutation changed no file, rewrote the files from
  their known contents, confirmed the suite still passed, and redid the run in bash with verified
  backups.
- **A lockfile that grew by 349 lines.** `npm install vitest` resolved 4.1.11 and also bumped the
  API's vitest. Claude reverted and pinned 4.1.10, which the API already uses, so the lockfile gains
  one line.
- **Four bugs only a real browser found** in the first version of the richer history page, which
  has no component tests: two quick filter changes (From, then To) overwrote each other; a cached
  infinite query kept 130 old rows after "Clear all"; the back button skipped filter changes; and a
  `<select>` wrapped in its `<label>` took the text of every option as its name. Each was fixed and
  the browser check re-run.
- **An index explained wrongly.** It wrote that the provider index helps because Postgres was
  "walking the newest-first index", and the migration comment said a newly added provider benefits.
  Re-reading the original `EXPLAIN` showed a parallel scan of the whole table for a provider whose
  rows are all old, while a provider spread evenly over time was already fast (0.5 ms). Both texts
  were rewritten to match the measurements.
- **Confidence presets with a gap.** The high / medium / low presets are cut at two decimals, and
  the column is a `double`, so a value strictly between 0.79 and 0.8 (or 0.59 and 0.6) matches no
  preset. Today's classifier cannot produce such values, so the design was kept and the limit is in
  `DECISIONS.md`, with the fix (an exclusive upper bound) for a provider with finer confidences.

## Trade-offs

Any AI-related trade-offs under the timebox.

## Team workflow (optional stretch)

If relevant: how you would set standards for AI-assisted development on a team.
