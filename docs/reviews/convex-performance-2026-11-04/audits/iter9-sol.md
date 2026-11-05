## Score: 7/10

- **Measured:** Iteration 9 L still reads 438/439 documents (~747 KB) for recommendations, 35 documents/469.4 KB for inventory and 594 documents for the previous-month roster (`evidence/iter9.md:9`). These remain material screen costs.
- **Measured:** The maintained-building fixture improves 106 to 8 documents, but read calls increase 6 to 10. Scheduled whole-index rebuild cost is excluded. The real-engine after-only sample reads 9 documents; it is not a real-engine before/after comparison (`evidence/iter9-reconcile-fixture.json:1`; `evidence/iter9-building-real.json:1`).
- **Inferred:** Generation capture and completion comparison close the identified occupancy construction window; the 500 cap removes unsafe overrides. These are concrete integrity improvements, not proof of production backfill time headroom.
- **Measured, prior iteration:** Search write amplification and sequence contention persist. XL records 1,253 writes for 50 scans and 3,766 reads for deleting 50; different-product creation has 52 retries and two failures (`evidence/iter8-xl.md:85`). No credit is assigned for planned work.

Independent reviewer: Sol. Frozen source `e8c7ac380f0db0585fac22d59b297e597ee80b08`; incremental range `f9903ff9..e8c7ac38`, cumulative baseline `80dc0a93`. Read AGENTS.md, both briefs and my iteration 8 report. No other auditor report read, delegation, tests, backend calls, imports or deployment performed. Only this report written; pre-existing untracked report.html left alone. Cumulative assessment carries forward the inspected iteration 8 findings, checks cumulative change scope and rechecks the changed mechanisms; it is not a claim of fresh exhaustive execution coverage.

## Changes since last audit

- **Correct, inferred — exact-50 HR repair:** `convex/hr/pagination.ts:373` checks for a following authorized lane when the exhausted lane fills the page. It neither consumes nor hydrates that following lane. Buffered matches still control completion. Reauthorization remains at `:398`. The 49/50/51 regression (`tests/integration/hr-roster-paging.integration.test.ts:56`) checks the actual boundary. This repair was excluded from iteration 8. Supplied validation reports 26 focused HR tests passing and elimination of an empty follow-up (12 calls/10 documents, convex-test instrumentation, not billing).
- **Correct, inferred — bounded building reconciliation:** `convex/finishedGoods/searchIndexBackfill.ts:453` selects the tenant/warehouse creation-time range only when the layout stamp is current; mismatch retains full bounded repair. `:568` retains rebuilding when selected buildings exceed 100. Inclusive watermark lookup preserves boundary rows; names are indexed with existing budget/deferred handling. Maintained/raw/overflow/mismatch tests check outcomes and terms (`tests/integration/search-reconcile-building-window.integration.test.ts:14`). Measured fixture maintained 106→8 documents, 6→10 calls; raw 105→7, 6→11; overflow and mismatch still rebuild. Total eliminated rebuild cost is unmeasured. One real local engine after-only maintained-create reconciliation: 9 reads, 3,676 bytes, one write, 24.44 ms execution; creation cost excluded.
- **Correct, inferred — occupancy start-generation guard:** `convex/storageLayouts/zoneOccupancyBackfill.ts:139` captures stamps before building; `:224` compares them at completion and poisons mismatches instead of stamping current generations onto earlier pages. Run ownership (`:126`) rejects superseded continuations. Maintained layout writes refresh affected rows before advancing the matching previous stamp (`convex/lib/zoneSurfaces.ts:516`); over-budget work marks stale and schedules restart. Thus maintained writes can follow construction, while legacy changes cannot silently bless earlier pages. Tests cover summary/layout interleavings, restart, maintained layout writes and unsafe budgets (`tests/integration/storage-query-scale.integration.test.ts:1219`). No new authorization boundary is introduced: internal maintenance derives organization from the warehouse and uses tenant access.
- **Correct with limitation, inferred — budget cap:** `convex/storageLayouts/zoneOccupancyBackfill.ts:114` rejects overrides above 500. This is a read-call stopping threshold between zones, not a hard 500-document maximum or a proof that any single dense zone fits all engine limits.
- **Correct, inferred — profiler arguments/setup:** `scripts/performance/convex/profile.mjs:314` applies baseline client arguments and skips candidate-only endpoints. Earlier tiny failing baseline executions are not successful comparisons. HTTP setup retains sequential transactions/run cursors; explicit execution timeouts retry the same page at smaller batches. This accommodation does not establish production default batch safety.
- **Evidence update:** Iteration 9 JSON contains three uncached samples after warmup, reused L snapshots without restore, and no writes/fan-out/contention. Backend digest differs from iteration 8; timing is indicative. Iteration 8 L/XL JSON and Markdown now exist. XL has 8,000 scans/765 employees but only 126 products; base reservation fan-out failed to find a destination and cannot support a successful comparison. Iteration 8 real-engine parity is 537 traversals/300 needles, zero mismatches, 7,905 versus 11,963 traversal requests; these are not cost totals or new iteration 9 parity.
- **Validation, reported not rerun:** 50 focused tests passed; Convex typecheck, scoped and full ESLint pass per supplied task record. Broader two search files remain running and are not claimed passed. Iteration 8 full suite remains 5,704 passed, two failed: process cancellation and mobile-menu focus restoration. Isolated passes do not erase those failures (`evidence/iter8-validation.md:51`).

## Findings (ranked by impact, max 10)

### 1. Partially resolved — broad recommendation evaluation and subscriptions
- Location: `convex/finishedGoods/workflow.ts:1347`; `convex/lib/zoneSurfaces.ts:345`.
- Evidence — measured: iteration 9 438/439 reads; iteration 8 XL reservation re-runs six queries reading 1,052 documents/~1,591 KB. No new fan-out measurement.
- Cost mechanism — inferred: all compatible candidates still participate; shared layout/building dependencies propagate writes.
- Fix: measure incremental candidate evaluation while retaining full ranking, no-fit reasons, tenant checks and ordering.
- Expected impact and risk: reduce screen/re-execution work; ranking parity is essential. Previous finding 1 remains partially resolved.

### 2. Partially resolved — exact substring search amplifies writes; accepted delete bound unmeasured
- Location: `convex/lib/jobScanSearch.ts:391`, `:545`, `:559`; `convex/finishedGoods/jobScans.ts:583`.
- Evidence — measured, iteration 8: 50-save writes 1,253 documents/5,368 index rows; 50-delete reads 3,766 versus baseline 160. **300-id delete remains unmeasured**, a next-iteration input; do not extrapolate a proven failure or safety guarantee from 50.
- Cost mechanism — inferred: postings, shared terms and orphan absence checks scale with text diversity and batch size.
- Fix: measure accepted maximum deletion and high-diversity churn with range/document/time headroom; preserve transactional completeness and authorization.
- Expected impact and risk: establish operating bounds without losing exact matches. Previous finding 2 partially resolved; maintained orphan cleanup remains good.

### 3. Partially resolved — occupancy arrays and recovery headroom
- Location: `convex/lib/zoneOccupancy.ts:428`, `:548`; `convex/storageLayouts/zoneOccupancyBackfill.ts:114`, `:224`.
- Evidence — measured: inventory still 469.4 KB for 35 reads. Inferred: full-zone array replacement couples writes; cap500 fixes unsafe overrides but permits completion of one zone after the threshold.
- Fix: measure dense stacks and successful non-overlapping concurrent reservations plus production-default recovery timing; split representation only with atomicity/parity preserved.
- Expected impact and risk: tighter bounds and less contention. Prior finding 4 partially resolved; generation-stamping defect resolved by inspection/tests, no real-engine interleaving measurement.

### 4. Open — gapless sequence contention
- Location: `convex/finishedGoods/workflow.ts:117`.
- Evidence — measured, iteration 8 XL: different-product bursts 52 retries/two failures; same-product 56 retries/one failure. Shared-machine observations are not sustained throughput guarantees.
- Cost mechanism — inferred: shared warehouse counter serializes allocation.
- Fix: establish throughput/tail-latency limits while preserving numbering; migrate only with an explicit contract change.
- Expected impact and risk: quantify retained ceiling without risking duplicate identifiers. Previous finding 5 open.

### 5. Open — bypass-writer recovery remains conditional
- Location: `convex/lib/searchReadiness.ts:26`; `convex/finishedGoods/searchIndexBackfill.ts:389`, `:453`, `:648`.
- Evidence — inferred: creation windows repair new buildings, not arbitrary old-name changes without generation movement; scan update windows require meaningful timestamps. Arbitrary raw deletions remain outside enumeration. No maintained-writer regression identified.
- Cost mechanism: missing postings can remain false negatives despite live-record verification of candidates.
- Fix: require invalidation for unsupported imports/repairs or durable change capture/periodic bounded full reconciliation.
- Expected impact and risk: completeness without broadening every search subscription. Previous finding 3 open; bounded creation repair resolves its separate excess-rebuild trigger.

### 6. Partially resolved — validation and scale coverage
- Location: `scripts/performance/convex/profile.mjs:314`; `evidence/iter8-validation.md:51`; `evidence/iter9-notes.md:60`.
- Evidence — measured/reported: XL and parity now available; query baseline argument defect repaired. Two full-suite failures persist, two broader search files unfinished, only one after-only building engine sample. Large product-catalogue construction and production-default execution headroom remain unproved.
- Cost mechanism — inferred: fixture counts miss transaction timing and realistic contention; low document counts can conceal large arrays.
- Fix: record outstanding results and measure accepted write bounds, default backfill and larger catalogues. Preserve failures and refusal outcomes in comparisons.
- Expected impact and risk: stronger confidence, no score credit merely for a plan. Previous finding 6 partially resolved.

## Already good (brief)

Tenant-scoped selective reads, bounded catalogue/roster pages, maintained totals, fallback for unknown stack facts, orphan collection and versioned readiness remain valuable. No new authorization, ordering or tenant-isolation regression identified in inspected changes. Prior iteration 8 dispositions: findings 1/2/4/6 partially resolved, 3/5 open; underlying earlier totals-poisoning finding stays resolved. HR scale evidence now confirms 111 preview reads at XL, while previous-month roster remains 594. The score's provisional evidence gaps narrow, but measured residual work still supports 7 rather than 9.

## What would raise the score to 9+

Reduce compatible-zone reactive work and dense inventory bytes; demonstrate safe maximum writes/deletes and default recovery execution; quantify acceptable sequence throughput; complete outstanding validation and fresh parity for changed recovery interleavings. Preserve exact semantics, authorization and retained data contracts.
