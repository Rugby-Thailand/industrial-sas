# Convex performance audit — final report (10 iterations)

Worktree: `/Users/macbook/Development/industrial-sas-convex-perf`
Branch: `perf/convex-backend-audit`
Baseline: `origin/main@80dc0a93`, fetched when the task started.
Final backend: `c4ff5087`; final audit snapshot: `80a57bbd` (same backend).
Nothing pushed, merged, or deployed to a hosted environment.

Implementation stopped at **iteration 10**, as requested. Final independent scores:
**Sol 6.1: 7/10; Opus 5.5 via Kiro CLI: 7/10**. The 9/10 target was not achieved.
See the [Sol review](audits/iter10-sol.md) and [Opus review](audits/iter10-opus-kiro.md).

## Baseline versus final measurements

The original [A/A baseline](evidence/iter0-baseline.md) ran both engines on main.
The final [profile](evidence/iter10.md) and [raw JSON](evidence/iter10.json) compare
main and candidate on identical restored dataset-L: 1,305 pallets, 126 products,
421 zones, 127 buildings, 2,182 scans, 153 employees. Seven uncached samples after
warmup, alternating target order; scanning continuations are summed. The table
uses successful main/candidate calls from that same final run.

| Flow                                    | Documents read: main → final | KiB read: main → final | Execution p50 ms: main → final | Requests |
| --------------------------------------- | ---------------------------: | ---------------------: | -----------------------------: | -------: |
| Put-away recommendations (current list) |                  2,886 → 438 |        1,817.9 → 746.9 |                424.53 → 112.65 |    1 → 1 |
| Saved-scan search                       |                   2,389 → 61 |         1,541.1 → 26.5 |                 644.95 → 98.44 |   22 → 1 |
| Building inventory                      |                   1,829 → 35 |        1,317.4 → 469.4 |                 260.95 → 53.87 |    1 → 1 |
| Building occupancy                      |                     917 → 21 |            819.4 → 8.6 |                  99.01 → 21.06 |    1 → 1 |
| Catalogue totals                        |                     272 → 18 |            136.9 → 6.9 |                  68.69 → 18.05 |    2 → 1 |
| Location picker search (miss)           |                     896 → 39 |           474.3 → 16.0 |                 133.18 → 19.06 |    2 → 1 |
| Location picker search (hit)            |                     900 → 98 |           476.5 → 37.9 |                 154.66 → 16.38 |    2 → 1 |

The current recommendation list includes opening-zone previews; older full-payload
calls also read 438 documents and retain the exact 244,011-byte response. Inventory
still returns 458,594 bytes in both versions despite fewer database reads. Search
chain byte totals include continuation traffic; they are not only final visible rows.

Backend execution times are local measurements, not production latency promises.
Machine load averaged about 24 before/22 after. Read/write counts and bytes are the
more stable cost indicators. Hosted billing, dollar savings and production traffic
were not measured. The engine version endpoint did not identify itself in the
profiler (`backend: unknown`); local config names `precompiled-2026-10-22-1447815`.

## Subscriptions, writes and contention

- Reservation fan-out: **6,098 → 1,053 documents** re-read; main additionally made
  client follow-up requests reading 334 documents, candidate made none. Broad
  compatible-zone dependencies remain. This is one scenario, not every write.
- Eight distinct-pallet measurement writes: **12 → 2 OCC retries**, no failures.
- Creation remains serialized by numbering: different-product bursts recorded
  **53 → 52 retries and one failure on each target**. Same-product candidate
  had 43 retries/no failures versus main 54/no failures. These are small bursts,
  not sustained-throughput guarantees.
- Same-zone reservation intentionally targets the same space: both sides have
  seven `SPACE_OCCUPIED` refusals. Do not count these as throughput improvements.
- Exact substring search shifts work to writes. A final 50-scan save writes
  **1,253 documents versus main 53**; a 50-scan delete reads **4,066 versus 160**.
  This is a remaining regression in maintenance cost, not hidden by read savings.

## Maximum delete and recovery fixes

[Iteration 10 evidence](evidence/iter10-notes.md) records the accepted 300-id delete
failure, followed by success on the same IDs. Before: all 300 remained after the
4,096-read-call limit. After: all 300 removed atomically, **2,486 read calls** used,
1,610 remaining, 6,223 documents read/2,074 written. The local guarded probe calls
the actual authorized mutation. One corpus/sample does not prove every input bound.

Orphan checks are now deferred once their maintenance budget is exhausted, then
revalidated before cleanup. Eleven subsequent observed reindex transactions read
45,897 documents and wrote 15,299. They are time-window observations, not guaranteed
isolated chain attribution. Deferral protects the foreground transaction; it does
not eliminate maintenance cost. The regression test verifies eventual cleanup.

Opus identified a different, **unmeasured** shape: many distinct shared terms can
consume read calls while keeping write usage below the deferral threshold. A
read-call budget and a real-engine shared-term 300-id case remain release work;
the successful unique-text sample does not establish universal 300-id safety.
The after probe recorded a dirty HEAD without a source digest. Its delete path
matches the final commit, but the artifact alone cannot prove the entire deployed
working tree. The final seven-sample profile separately records a matching digest.

Iteration 9 eliminated unnecessary whole-index rebuilds after a single maintained
building creation: fixture 106→8 reads, real-engine after-only 9 reads. It also
captures occupancy generations before backfill and rejects stale completion.
Maintained writes may advance the stamp only after updating the affected data.
Legacy roster calls now finish a bounded scan across former employees, cap employed
staff before UI filters, and avoid hydrating rows before a refusal. The 49/50/51
boundary and 60-former/40-current case preserve the older client contract.

## Changes across the audit

- Tenant-scoped derived occupancy, surface rows and stack facts reduce repeated
  placement/layout reads; a narrow zone preview supplements complete ranking.
- Maintained catalogue totals and sharded change signals remove full recounts and
  much warehouse-wide write contention without changing gapless identifiers.
- Exact normalized substring indexes preserve search semantics; rollback markers,
  reconciliation, invalidation and orphan collection maintain derived data.
- HR roster pagination and range reads limit work to displayed employees; period
  preview exits early at its accepted bound. Current 153-employee roster now returns
  a 20-employee page in 84 reads; main refuses it. This is capacity, not a like-for-like
  latency comparison. Prior-month candidate page reads 594 documents.
- Backfills have run ownership, bounded continuations, generation checks and
  overflow recovery. Raw imports/repairs outside supported tracked writes still
  require explicit invalidation.

## Validation and review history

Final affected validation: **60 tests in six files passed**; full ESLint and Convex
TypeScript checks passed. HR-focused run: 28 tests passed. The broader search corpus
at iteration 9 passed 10 tests in two files. Last full real-engine search parity is
explicitly iteration 8: 537 traversals across 300 needles, zero mismatches. No new
iteration 10 full-corpus parity result is claimed.

The entire iteration 8 suite remains **5,704 passed, 2 failed**. Process cancellation
and mobile-menu focus restoration failed in the combined run; isolated checks
passed, and the relevant source matches baseline. These remain unresolved
intermittent validation limitations, not an all-green result. Full details:
[validation record](evidence/iter8-validation.md).

| Iteration                   |       Sol 6.1 |      Opus 5.5 |
| --------------------------- | ------------: | ------------: |
| 0 baseline                  |             4 |             5 |
| 1                           |             4 |             5 |
| 2                           |             4 |             6 |
| 3                           |             4 |             6 |
| 4                           |             4 |             6 |
| 5 standalone, retrospective |             4 |             6 |
| 6                           |             6 |             6 |
| 7                           |             7 |             7 |
| 8                           | 7 provisional | 7 provisional |
| 9                           |             7 |             7 |
| 10                          |             7 |             7 |

Iteration 5 was originally reviewed together with 6. Standalone retrospective audits
now use commit `c9d39c91`, whose backend digest exactly matches the dirty-tree
iteration 5 profile. Their dates and retrospective status are explicit. Reviews are
under [audits/](audits/). Since the user's tool constraint, Sol reviews use Codex
and Opus reviews use Kiro CLI; no later Claude Code/provider review was launched.
The requested models were available. Before/after profiler screenshots are required
only after both scores reach 8; that threshold was never reached, so no profiler screenshots were required.

## Remaining bottlenecks and rollout

1. Search write amplification and cleanup queue cost, especially varied text and
   sustained bulk churn; the fix establishes one measured 300-id case only.
   Low-write, many-shared-term selections still need a read-call guard and measurement.
2. Recommendation subscriptions still read every compatible zone, and full inventory
   payloads remain large. Reducing these further needs full-ranking/semantic parity.
3. Shared sequence allocation still has OCC failures. Changing gapless numbering is
   a product/data contract decision, not an optimization silently made here.
4. Production-default backfill execution headroom and dense-zone worst cases remain
   unproved; profiler setup used smaller adaptive batches. Only 126 products were
   measured. Prior iteration 8 XL grew scans/employees, not products/layout size.
5. Layout edits above the maintenance budget still invalidate warehouse occupancy;
   search repair above 100 buildings can require a full rebuild. Poisoned occupancy
   runs wait for the hourly sweep unless explicitly restarted.
6. Unsupported raw writes need invalidation. Remaining suite failures and fresh
   production-shaped recovery/parity checks must be addressed before claiming clean
   rollout validation.

Keep intermediate development commits out of deployment/rollback history (use the
[documented squash rollout](../../operations/storage-zone-occupancy.md#release-constraint-squash-merge)). Follow [search-index operations](../../operations/search-index.md)
and the other derived-data runbooks: complete/read readiness, monitor deferred work,
and invalidate/rebuild after unsupported raw repairs or incompatible rollback. This
local audit has not performed a production rollout.

Before release, run the full suite and real-engine parity at the release SHA,
complete occupancy/search backfills per warehouse, and monitor scheduled cleanup
volume. Keep `ALLOW_LOCAL_TEST_SEED` unset on hosted deployments; remove or exclude
the local metrics probe before production deployment where practical. Measure
the shared-term maximum delete before claiming support for every 300-id selection.
The occupancy and search runbooks were corrected after the final reviews; backend
code stayed unchanged from the audited snapshot.
