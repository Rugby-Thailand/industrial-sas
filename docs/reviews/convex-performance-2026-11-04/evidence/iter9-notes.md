# Iteration 9 — bounded reconciliation and backfill integrity

## Snapshot

Backend changes: `70994cb7` on the main audit branch, equivalent to `0328014e`
in the separate implementation checkout. Query profile: `e8883ecc` (the only
additional change is profiler baseline-argument handling). Neither commit has
been deployed remotely; the profiler uses loopback backends only.

## Changes and measured effects

1. When the search layout generation is current, inspect only buildings created
   since the reconciliation watermark. A mismatched generation still repairs the
   entire bounded building range. More than 100 selected buildings still schedules
   the existing rebuild. New tests cover maintained creation, raw creation,
   overflow, and a changed generation.
2. Occupancy backfill captures summary/layout generations before its first page.
   Completion checks the captured stamps instead of overwriting them with current
   values. Maintained layout writes may advance the captured marker after updating
   the affected rows; legacy generation changes and explicit invalidation cannot
   make an incomplete cache ready. Budget overrides are capped at 500, matching
   the existing single-zone headroom analysis.
3. Uncached query sampling now uses `baseArgs`, as subscription fan-out already
   did. Candidate-only endpoints report `NOT_APPLICABLE` for baseline. Older
   reports' failed baseline calls for new argument shapes must not be interpreted
   as cheap successful executions; compare the successful full-payload rows there.

### Reconciliation fixture, identical setup before and after

`iter9-reconcile-fixture.json` contains the raw instrumentation. It uses 101 old
buildings and then creates the new ones. These are **convex-test** read counts,
not billing measurements. Reads include range documents and explicit gets; calls
count index ranges plus gets. Scheduled rebuild work is excluded.

| Trigger                   | Before documents / calls | After documents / calls | Outcome                   |
| ------------------------- | -----------------------: | ----------------------: | ------------------------- |
| One maintained create     |                  106 / 6 |                  8 / 10 | rebuild scheduled → done  |
| One raw create            |                  105 / 6 |                  7 / 11 | rebuild scheduled → done  |
| 101 new buildings         |                  105 / 6 |                 105 / 6 | rebuild scheduled in both |
| Layout generation changed |                  106 / 6 |                 106 / 6 | rebuild scheduled in both |

The before code returned early to schedule a rebuild; the after code performs
additional small indexed checks and finishes the repair in this transaction.
The fixture does not measure the eliminated whole-index rebuild's total cost.

### Real local engine

`iter9-building-real.json`: one maintained create in the existing 127-building
warehouse, followed by reconciliation: **9 documents read, 3,676 bytes read,
1 document written, 24.44 ms execution, 29.84 ms RTT, status done**. One sample;
create cost excluded. The test leaves one additional draft building in this
local fixture. It ran after the query profile, so that profile still has 127.
There is no real-engine before sample for this exact scenario; the before
comparison above is from the identical convex-test fixture.

`iter9.json` / `iter9.md`: three uncached samples after warmup on the real local
engine, alternating candidate/main order. The L snapshots restored for iteration
8 parity were reused; this run skips mutation flows, fan-out and contention.
There was no new restore. Query read counts remain in line with iteration 8;
this iteration optimizes maintenance, not recommendation query scope. Earlier
L/XL flow and fan-out evidence remains labelled iteration 8, not remeasured here.
Latency is indicative on the shared machine; no cloud execution-cost estimate
or dollar saving is claimed.

## Validation

- Before fix: the maintained/raw building tests returned `rebuilding` instead
  of `done`. Both generation-interleaving regressions incorrectly returned
  ready; 501/16000 budget overrides were accepted.
- After fix: 50 tests in `storage-query-scale.integration.test.ts` and
  `search-reconcile-building-window.integration.test.ts` passed (18.11 s).
  A subsequent instrumented four-case building run also passed.
- Convex TypeScript check, changed-file ESLint, and formatting passed.
- The broader job-scan/location search files are still running separately.
  Their completion must be recorded before claiming their result.
- Full-suite iteration 8 remains **5,704 passed / 2 failed**. See
  `iter8-validation.md`; no claim that the entire suite is green.
- Iteration 8 real-engine parity: 537 traversals, zero mismatches. This is
  prior-snapshot evidence, not a newly run iteration 9 parity corpus.

## Still open

The 300-id delete transaction and its read-call headroom are not measured yet.
Broad recommendation subscriptions, full inventory payload size, search write
amplification, gapless counter contention, and default production backfill
execution-time headroom remain review inputs. No new auditor score is assigned
by the implementation agent. Both iteration 8 reviewers scored 7/10; the
screenshot threshold has not yet been reached.
