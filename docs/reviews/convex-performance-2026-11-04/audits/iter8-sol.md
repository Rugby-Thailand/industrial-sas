## Score: 7/10 — provisional

- **Measured:** L recommendation reads improve from iteration 7's 687/688 to 438/439 documents, approximately 747 KB; inventory remains 35 documents but drops from 964.1 to 469.4 KB. These are worthwhile improvements, while substantial screen-load work remains (`evidence/iter8.md:12`; `convex/finishedGoods/workflow.ts:1347`).
- **Measured:** Saved-scan search remains 61 documents, maintained totals 18, current roster page 84. A hitting location search costs 98 documents. Previous-month roster costs 594 documents (`evidence/iter8.md`, query table).
- **Measured:** A 50-scan save writes 1,253 documents / 5,368 index rows; deleting 50 reads 3,766 and writes 1,253. Different-product pallet creation still incurs 39 retries across three eight-worker rounds, versus 42 on base (`evidence/iter8.md`, write and contention tables).
- **Inferred:** Projection, condition-selective surfaces, orphan collection and recovery repairs improve the implementation, but do not justify 9's near-result-sized reads and narrowly scoped dependencies. Retain 7 pending complete validation and XL evidence.

**Independent reviewer:** gpt-6.1-sol. **Code SHA:** `f9903ff9`; baseline `80dc0a93`; previous audited snapshot `60dd3979`. Only this report was written; no tests, deployment, Convex call or dataset mutation was performed. Read only the supplied Sol previous audit, not the other auditor's report.

**Evidence availability:** L JSON and Markdown were available. L identifies clean candidate `3308eee9`, backend digest `ec7564df058c0f30`, backend version unknown (`evidence/iter8.json:26`). The subsequent commit changes profiler build recovery rather than backend source. XL JSON and search-parity JSON were absent, XL Markdown empty. Final parent validation was unavailable. None is claimed passed. Numbers below are supplied measurements, not independently rerun. Shared-machine latency and invalid base argument comparisons do not establish speedups.

## Changes since last audit

- **Correct, inferred:** Surface rows select compatible storage conditions and retain fallback evaluation for no-fit reasons; layout generations guard trust. Floors/buildings remain authoritative reads. Projection retains placement geometry and support fields, reconstructs omitted warehouse/building defaults and falls back for unknown stack facts (`convex/lib/zoneSurfaces.ts:100`, `:317`, `:345`; `convex/lib/zoneOccupancy.ts:75`, `:155`, `:210`; `convex/finishedGoods/workflow.ts:1347`, `:2932`). Measured L read/byte improvement above. Tests inspect parity through layout changes, moving/occupied supports and foreign-zone refusals (`tests/integration/storage-query-scale.integration.test.ts:2050`, `:2186`, `:2565`). Test presence is not execution evidence.
- **Correct, inferred:** Placement writes refresh both old/new support pallets and move writes refresh their pallet; stack facts use authoritative active-move and held-child indexes. Unknown or excessive children retain direct lookup (`convex/lib/finishedGoodsSummary.ts:349`, `:395`; `convex/lib/zoneOccupancy.ts:155`). No authorization or tenant-isolation regression identified in inspected readers: tenant access remains scoped and resolved contexts check warehouse/building/floor consistency (`convex/finishedGoods/workflow.ts:807`).
- **Correct, inferred:** Totals invalidation now poisons unfinished construction; a changed legacy generation restarts it. Ownership checks still reject superseded continuations. Focused interleaving tests cover both triggers (`convex/finishedGoods/totalsBackfill.ts:68`, `:274`; `tests/integration/finished-goods-warehouse-totals.integration.test.ts:359`). Previous finding 3 resolved for these cases; no new real-engine construction measurement supplied.
- **Correct, inferred:** Overflow recovery walks every page instead of repeatedly taking the first ten; default occupancy reconstruction uses a 500 read-call budget and same-page resume. Final building readiness uses current exceptions. Dense-zone limit and superseded-run tests are meaningful (`convex/storageLayouts/zoneOccupancyBackfill.ts:169`, `:213`, `:327`; `tests/integration/storage-query-scale.integration.test.ts:1422`, `:1480`). Previous finding 5 partially resolved; production limits still merit the qualification below.
- **Correct with explicit operational limitation, inferred:** Search layout-marker fallback, source-hash reconciliation and independent progress rows improve rollback recovery without adding a watermark subscription to every search. They deliberately permit temporarily missing unmaintained scan/location writes (`convex/lib/searchReadiness.ts:26`; `convex/finishedGoods/searchIndexBackfill.ts:496`). This is eventual repair, not immediate exact parity after rollback.
- **Correct, inferred:** Released scan-field terms are collected only after an indexed absence check, protecting concurrent relinking through OCC; deferred work preserves budget handling (`convex/lib/jobScanSearch.ts:235`, `:545`, `:559`). Previous orphan-retention finding resolved for maintained edits/deletes, not arbitrary raw deletes.
- **Correct, inferred:** Employee scanning stops once enough employed rows prove paged mode; sparse historical employment can still require the bounded full range (`convex/hr/shared.ts:1178`). Measured L preview falls from 164 to 111 reads. Previous finding 8 partially resolved pending XL confirmation.
- **Improved, inferred:** Terminal traversal assertions and pooled RTT reporting address previous measurement defects. Expanded same-zone burst measures conflict refusal, not successful reservation throughput. Parent notes explicitly disclose this. Previous finding 9 partially resolved; real-engine parity and final validation unavailable.

## Findings (ranked by impact, max 10)

### 1. Partially resolved — recommendation work remains proportional to compatible warehouse capacity

- Location: `convex/finishedGoods/workflow.ts:1347`; `convex/lib/zoneSurfaces.ts:345`.
- Evidence — measured: 438/439 documents and approximately 747 KB per list, approximately 128 KB returned. Reservation re-runs both lists; six candidate queries together re-read 1,051 documents / 1,590.9 KB (`evidence/iter8.md`, query and fan-out tables).
- Cost mechanism — inferred: condition indexes exclude incompatible zones, but all compatible candidates and their occupancy are evaluated; ANY/no-condition and no-fit cases remain broad. Active buildings and warehouse layout generation remain shared dependencies.
- Fix: preserve complete ranking semantics while separating stable candidate metadata from changing zone evaluation; measure incremental or paged evaluation before changing selection behavior.
- Expected impact and risk: lower broad reactive work; ranking, reasons and ordering need parity coverage. This continues previous finding 1, with demonstrated improvement.

### 2. Partially resolved — exact substring search transfers substantial cost to writes

- Location: `convex/lib/jobScanSearch.ts:391`, `:545`, `:559`.
- Evidence — measured: 50-save 1,253 writes / 5,368 index rows; 50-delete 3,766 reads / 1,253 writes, versus base 160 / 53 for delete (`evidence/iter8.md`, write tables).
- Cost mechanism — inferred: per-scan postings plus shared terms and orphan checks; batches can approach read limits as text/term diversity changes. L success is not a general worst-case proof.
- Fix: measure maximum accepted field sizes and high-diversity 50-row churn; retain transactional candidate completeness when deferring work. Track orphan convergence and sustained ingest throughput.
- Expected impact and risk: establish safe operating bounds and avoid write latency regressions; do not sacrifice exact search. Previous finding 2 partially resolved by collection.

### 3. Recovery remains conditional on writer markers and clocks

- Location: `convex/lib/searchReadiness.ts:26`; `convex/finishedGoods/searchIndexBackfill.ts:389`, `:496`, `:648`.
- Evidence — inferred: scans are reconciled through updatedAt and creation-time windows; existing raw edits without a fresh timestamp and raw deletions are not enumerated by those windows. Locations reconcile creation, not arbitrary existing-row edits. Layout changes rely on their generation marker. The documented two-minute estimate assumes scheduler progress and manageable backlog.
- Cost mechanism: stale postings are verified against live records, preventing many false positives, but missing new postings can cause false negatives; raw deletions can retain terms indefinitely.
- Fix: require explicit invalidation for unsupported imports/repairs and rollback procedures, verify those runbooks, or add durable change capture/periodic bounded full reconciliation if arbitrary writers must be supported.
- Expected impact and risk: recovery completeness without charging every normal search. This qualifies the new recovery claim; it is not evidence of a maintained-writer regression.

### 4. Partially resolved — dense-zone entries still rewrite complete arrays

- Location: `convex/lib/zoneOccupancy.ts:428`, `:548`; `convex/storageLayouts/zoneOccupancyBackfill.ts:119`, `:169`.
- Evidence — measured: inventory read bytes halve, but still 469.4 KB for 35 reads; reserve/cancel read 37/32 and write 9/8 documents (`evidence/iter8.md`).
- Cost mechanism — inferred: projection reduces bytes, not the single-zone read/replace coupling. Reconstruction budget is checked between zones and accepts explicit overrides up to 16,000; default safety does not imply every accepted override stays below 4,096 ranges. Stack-child reads add document volume beyond the range estimate.
- Fix: cap overrides to safe work or document them as diagnostic only; measure near-capacity zones with realistic stack children and non-overlapping concurrent reservations. Chunk entries only if measurements justify complexity.
- Expected impact and risk: tighter reconstruction and write bounds while preserving atomic occupancy. Previous findings 4/7 remain partially resolved; ordinary default recovery improved.

### 5. Open — gapless sequence allocation retains cross-product contention

- Location: `convex/finishedGoods/workflow.ts:117`.
- Evidence — measured: same- and different-product creation each record 39 retries across 24 workers; all succeed (`evidence/iter8.md`, contention tables).
- Cost mechanism — inferred: shared warehouse counter serializes allocation; this is a retained numbering contract, not a demonstrated iteration regression.
- Fix: measure sustained throughput/tail latency; preserve numbering unless a deliberate migration is accepted.
- Expected impact and risk: identifies remaining throughput ceiling without risking duplicate codes. Previous finding 6 open.

### 6. Partially resolved — evidence does not establish complete scale or recovery performance

- Location: `scripts/performance/convex/profile.mjs:944`; `tests/integration/storage-query-scale.integration.test.ts:1480`; `evidence/iter8.json:26`.
- Evidence — measured availability: no XL or parity JSON, empty XL Markdown, unavailable final validation. Only 126 products on L. Previous-month roster reads 594 documents. Payroll policy and package fixture refusals remain non-success-path measurements.
- Cost mechanism — inferred: small document counts can hide large projected rows, empty index ranges and recovery transaction limits. Source inspection and convex-test assertions supplement rather than replace real-engine evidence.
- Fix: incorporate parent's completed validation, XL/parity artifacts and supported success paths; distinguish backend-equivalent SHA from profiler SHA and assertion presence from passing results.
- Expected impact and risk: reliable scoring and rollout assessment. Previous finding 9 remains partially resolved.

## Already good (brief)

- Selective first-page catalogue paths, maintained totals, tenant-scoped rehydration and bounded roster pages remain intact.
- Unknown stack facts fall back rather than asserting empty stacks. Derived-store versions force rebuild/fallback during migration.
- Totals poisoning, overflow fairness, source-hash reconciliation and transactional orphan absence checks address concrete previous risks.
- Previous findings disposition: 1 partially resolved; 2 partially resolved (maintained orphan cleanup resolved); 3 resolved; 4 partially resolved; 5 partially resolved; 6 open; 7 partially resolved; 8 partially resolved; 9 partially resolved.

## What would raise the score to 9+

Demonstrate complete final validation and real-engine XL parity; reduce compatible-zone reactive work and dense inventory bytes further; establish high-diversity write and dense-zone recovery bounds; demonstrate larger-catalogue construction and acceptable sustained sequence allocation throughput. Retain exact authorization, ordering, ranking and recovery contracts throughout.
