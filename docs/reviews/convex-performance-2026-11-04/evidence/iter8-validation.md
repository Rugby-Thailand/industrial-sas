# Iteration 8 validation follow-up — 2026-11-05

The requested review channels are now Codex (Sol 6.1) and Kiro CLI
(Opus 5.5). No further Claude Code/provider review was started.

## Snapshot and measurements

- L profile: `3308eee9`; XL profile: `f9903ff9`. The intervening commit only
  changes profiler backfill recovery. Raw XL data is `iter8-xl.json`.
- XL completed, but its baseline reservation fan-out had no recommended
  destination. That row is **not** a successful before/after comparison.
  Creation bursts also contain recorded OCC failures. Keep those failures
  visible; do not use retries alone as a throughput improvement claim.
- Sol's `iter8-sol.md` is a provisional review of `f9903ff9`, without XL,
  final validation or search-parity evidence. It does not review the later
  roster repair below.
- Opus's `iter8-opus-kiro.md` is also provisional (7/10), reviewing
  `f9903ff9` with L and XL evidence but without final parity or validation.
  It explicitly excludes the later follow-up commits. Its newly identified
  building-create rebuild trigger and occupancy generation-stamping window
  are inputs to iteration 9, not resolved findings.

## Confirmed regression and repair

The registered `hr-parity/04-shifts-roster-limits.test.ts` failed because a
legacy roster of exactly 50 employees returned `LIMIT_EXCEEDED`. The shared
page scanner had exhausted the current lane but did not check for another
lane when its output page was full.

`2494a6a5` checks whether an authorized following lane exists before declaring
the page unfinished. Buffered matches still require a continuation. A new
49/50/51-employee regression failed before the fix and passes afterwards.

Passed: **26 tests in five files**, including the registered 50 × 31-cell
transaction-limit test, roster paging and read-cost tests, HR pagination and
payslip pagination. Command:

```sh
pnpm exec vitest run --project integration \
  tests/integration/hr-parity/04-shifts-roster-limits.test.ts \
  tests/integration/hr-roster-paging.integration.test.ts \
  tests/integration/hr-roster-read-cost.integration.test.ts \
  tests/integration/hr-pagination.integration.test.ts \
  tests/integration/hr-payslip-pagination.integration.test.ts \
  --maxWorkers 2 --testTimeout 120000 --reporter verbose
```

The read-cost fixture's 50-employee traversal now finishes in one request;
the former empty follow-up (12 queries / 10 documents) is eliminated. These
are convex-test counts, not real-engine billing measurements.

## Full-suite validation: two unresolved failures

The initial full-suite run was stopped after the confirmed roster regression.
It is not a passing run. Two catalogue-search cases exceeded the default
5-second timeout; both passed unchanged with a 120-second diagnostic timeout
(22.5 and 27.3 seconds on the busy shared machine).

The process-cancellation test in `prepare-browser-suite.integration.test.ts`
failed when run with other tests, but passed in an isolated candidate run.
The same source files are unchanged from `80dc0a93`; baseline isolated and
full-file runs passed. This is an unresolved intermittent test failure, not
proof of a backend regression or proof that the entire suite passes.

The full rerun (backend/test source frozen at `47366fcc`) completed in
2,495 seconds: **415 files passed, 2 failed; 5,704 tests passed, 2 failed**.
The second failure is DesktopShell mobile-menu focus restoration. Both its
candidate and baseline isolated cases passed, and the relevant source is
unchanged from baseline. Neither isolated pass erases the full-suite failure.
Logs: `iter8-shell-diagnostic.log`, baseline `iter8-baseline-shell.log`.

Command:

```sh
SEARCH_INDEX_TEST_TIMEOUT_MS=3600000 pnpm exec vitest run \
  --maxWorkers 2 --testTimeout 120000
```

Local logs: `output/perf/iter8-validation-final.log`,
`iter8-roster-fix.log`, `iter8-catalogue-diagnostic.log`,
`iter8-cancellation-isolated.log`.

## Search parity preparation

The first attempt failed during search backfill with the real backend's
one-second execution limit. No parity result was produced. `47366fcc` adds
`--search-backfill-batch-size` (default 25, matching the production default).
The retry uses 10 rows per setup transaction on identical restored dataset-L
snapshots. This changes setup workload, not the timed search scenarios.
The CLI-per-page retry was stopped deliberately after more than 11 minutes
of setup. Each page spawned pnpm and the CLI again on the heavily loaded
machine; no parity result had been produced.

`ccaa15cc` reuses the same admin-authenticated `ConvexHttpClient.function`
transport used by the installed CLI (`convex/src/cli/lib/run.ts`). A real
read-only occupancy health call verified that transport on the local backend.
Setup remains sequential; each page retains its own backend transaction,
batch size, run ownership and readiness checks. Syntax, formatting and focused
ESLint pass. The new run restores both datasets again, logs page progress,
and then starts the same 300-needle comparison.

That HTTP setup also failed at a ten-row search backfill page with the same
one-second execution timeout, before parity started. `a6fd4698` retries only
this explicit timeout on the identical run/cursor, halving the batch until
one row. A one-row timeout or any other error still aborts. The failed mutation
is atomic, so no failed page is skipped. This is a setup accommodation, not
evidence that the production default backfill batch is safe under this load.
The adaptive setup completed. Real-engine search parity then compared
**537 needle/filter traversals across 300 needles with zero mismatches**.
Candidate used 7,905 requests versus baseline 11,963 on identical restored L
snapshots. These are traversal request counts, not execution-cost totals.
Full metadata and limitations are in `iter8-search-parity.json`.

ESLint passed before the follow-up. Formatting and focused ESLint passed for
the roster repair. Full ESLint and `pnpm exec tsc --noEmit -p
convex/tsconfig.json` both passed again at `47366fcc`. The full-suite result remains two failures, as reported above.
