## Score: 4/10

- **Measured:** Storage reads improve substantially: building occupancy falls from 917 to 20 documents; building inventory falls from 1,829 to 34. Inventory still transfers 963.6 KB from the database. (`evidence/iter2.md:30`; `evidence/iter2.md:37`)
- **Measured:** Recommendations fall from 2,886–2,887 documents on the same-run base to 686–687, but still read approximately 1,284 KB per call. (`evidence/iter2.md:11`; `evidence/iter2.md:12`)
- **Measured:** Saved-scan search remains at 2,389 documents across 22 requests. The roster still returns `LIMIT_EXCEEDED` after reading 162 documents on the 153-employee fixture. The existing core-flow failure keeps the score within the rubric’s ≤4 band. (`evidence/iter2.md:6`; `evidence/iter2.md:18`)
- **Measured:** Corrected concurrent clients expose 13 OCC retries for eight pallet creations; sampled conflict records identify `finishedGoodsSummaryReadiness`. The base has 14 retries, so this is confirmation of an existing bottleneck. (`evidence/iter2.md:91`; `evidence/iter2.md:114`; `evidence/iter2.json:2925`)
- **Inferred:** The score remains unchanged despite real improvements. Warehouse-wide recommendation work, shared generation writes, and history-based searches remain; derived occupancy also introduces write amplification and migration risks. (`convex/finishedGoods/workflow.ts:1106`; `convex/lib/finishedGoodsSummary.ts:345`; `convex/lib/zoneOccupancy.ts:243`)

## Changes since last audit

- **Active-building traversal and query-local caching — correct by inspection.** The retained iteration-1 changes preserve lifecycle checks and reconstruct warehouse zone-code order. Mutation validation continues to use authoritative reads. The new interleaved-building test closes the earlier ASCII ordering coverage gap; Unicode ordering and reactive activation are still not directly tested. **Measured:** Combined with derived occupancy, recommendation reads are now 686–687, versus 2,454–2,455 in iteration 1. (`convex/finishedGoods/workflow.ts:703`; `convex/finishedGoods/workflow.ts:1106`; `convex/finishedGoods/workflow.ts:2539`; `tests/integration/storage-query-scale.integration.test.ts:1001`; `evidence/iter2.md:11`)

- **Derived occupancy readers — correct for the maintained, ready snapshot.** The new tables preserve placement fields, pallet facts, status/creation ordering, location-only counts, and the existing footprint-union calculation. Queries retain their permission declarations and warehouse checks; derived access uses tenant-scoped indexes. **Measured:** Against the same-run base, recommendations save 2,200 document reads and 547,407 read bytes each; inventory saves 1,795 reads and 362,250 bytes; occupancy saves 897 reads and 830,858 bytes. Return-byte counts match the base. Previous finding 4, reconstructing occupancy from every placement, is **resolved for ready warehouses**. (`convex/schema.ts:1018`; `convex/lib/schemaPolicy.ts:40`; `convex/lib/zoneOccupancy.ts:61`; `convex/storageLayouts/catalogue.ts:350`; `convex/storageLayouts/catalogue.ts:571`; `evidence/iter2.json:26`; `evidence/iter2.md:30`; `evidence/iter2.md:37`)

- **Transactional maintenance and overflow fallback — risky.** Tracking records placement zones before and after changes, refreshes pallet facts across both move holds, and flushes in the source transaction. This supports correct invalidation without a cross-request cache. However, every affected zone rewrites its packed entries; overflowed zones rebuild from complete placement ranges and hydrate pallets even though their entries are discarded. One overflowed zone also forces the entire building inventory back to authoritative reads. These write and capacity costs are not measured by the supplied placement probes. (`convex/lib/finishedGoodsSummary.ts:255`; `convex/lib/finishedGoodsSummary.ts:307`; `convex/lib/tenantFunctions.ts:539`; `convex/lib/zoneOccupancy.ts:124`; `convex/lib/zoneOccupancy.ts:247`; `convex/storageLayouts/catalogue.ts:584`)

- **Backfill and raw-writer invalidation — risky; fixture cleanup — regression.** The internal backfill derives the tenant from the warehouse, gates readers on readiness, and blocks cross-building inconsistencies. Raw seed writers now invalidate readiness. However, invalidation during an unfinished backfill does not invalidate its continuation, allowing later completion to re-enable stale rows. Cleanup adds only the readiness table and leaves both derived data tables behind. Neither problem has a supplied runtime measurement. (`convex/storageLayouts/zoneOccupancyBackfill.ts:31`; `convex/storageLayouts/zoneOccupancyBackfill.ts:67`; `convex/storageLayouts/zoneOccupancyBackfill.ts:93`; `convex/staging/annexDemo.ts:1211`; `convex/staging/e2eFixture.ts:339`)

- **Regression tests — useful, with gaps.** Added tests compare full authoritative and derived outputs after backfill, reservation, verification, confirmation, cancellation, stacking changes, and a two-zone move. They also cover overflow and mismatched-building readiness. They do not establish reactive resubscription behavior, concurrent maintenance, invalidation during backfill, cleanup completeness, packed-document byte limits, or overflow write budgets. Tests were inspected, not executed: this read-only snapshot has no `node_modules`. (`tests/integration/storage-query-scale.integration.test.ts:719`; `tests/integration/storage-query-scale.integration.test.ts:805`; `tests/integration/storage-query-scale.integration.test.ts:883`; `tests/integration/storage-query-scale.integration.test.ts:960`)

- **Profiler repairs — correct in part; reactive accounting remains risky.** Independent HTTP clients remove mutation serialization, refusal checks now cover `written:false`, and measurement saves use an eligible pallet with changed dimensions. **Measured:** Measurement save now writes five documents; both targets report overlapping contention requests. Settled initial subscriptions and follow-up accounting improve fan-out coverage, but follow-ups are read before log synchronization and never replace the WebSocket subscriptions’ old arguments. Previous finding 10 is **partially resolved**. (`scripts/performance/convex/profile.mjs:82`; `scripts/performance/convex/profile.mjs:287`; `scripts/performance/convex/profile.mjs:448`; `scripts/performance/convex/profile.mjs:531`; `scripts/performance/convex/scenarios.mjs:434`; `evidence/iter2.md:78`; `evidence/iter2.json:2910`)

**Audit scope and evidence:** Snapshot `011ccd35959ca12024fddd29c107387b04c1c41c`, including commits `a3fa1e28`, `4352b15b`, and the evidence-only commit `011ccd35`. **Inferred verification:** Recomputing the profiler’s digest algorithm gives candidate `d2f9e425256dc7eb` and baseline `a486b726209f5b84`, matching the recorded hashes. The candidate’s recorded revision predates the evidence-only commit but matches this snapshot’s Convex source. Backend version remains `unknown`. (`scripts/performance/convex/profile.mjs:677`; `evidence/iter2.json:26`)

Code references are relative to the audited snapshot; evidence references are relative to the supplied review directory. Document/byte counts carry more weight than latency. The parallel HR paging work is outside this snapshot and receives no credit.

## Findings (ranked by impact, max 10)

### 1. Open — roster capacity still prevents a core screen from loading

- **Location:** `convex/hr/roster.ts:321`; `convex/hr/shared.ts:1109`; `convex/model/hr/roster.ts:53`. Caller: `src/features/hr/ShiftsRoster.tsx:699`.
- **Evidence — measured:** 162 documents and 112.8 KB read, followed by `LIMIT_EXCEEDED`. (`evidence/iter2.md:18`)
- **Evidence — inferred:** The complete employee range and 50-employee limit precede search/department filtering. Successful smaller requests then load site-wide monthly attendance. (`convex/hr/roster.ts:328`; `convex/hr/roster.ts:330`; `convex/hr/roster.ts:348`)
- **Cost mechanism:** Site-sized reads followed by refusal; broad attendance dependencies below the limit.
- **Fix:** Page authorized employees and fetch attendance, assignments, and leave claims for displayed employees. Preserve historical employment eligibility, revisions, frozen-plan checks, and bounded atomic saves.
- **Expected impact and risk — inferred:** Restores larger-site access and bounds reads. Eligibility and write-lock regressions require caller-level coverage. This is previous finding 1, unchanged.

### 2. Open — saved-scan substring search still scans history

- **Location:** `convex/finishedGoods/jobScans.ts:625`; `convex/finishedGoods/jobScans.ts:675`. Caller: `src/features/finishedGoods/jobScan/JobScanRecords.tsx:132`.
- **Evidence — measured:** Search reads 2,389 documents and 1,541.1 KB across 22 requests; ordinary listing reads 60 documents. (`evidence/iter2.md:6`; `evidence/iter2.md:28`)
- **Evidence — inferred:** Warehouse/mapping indexes narrow ownership and mapping state, while substring matching and building-name matching occur afterward. (`convex/finishedGoods/jobScans.ts:644`; `convex/finishedGoods/jobScans.ts:699`)
- **Cost mechanism:** Sparse searches approach retained-history cost despite bounded requests.
- **Fix:** Backfill tenant/warehouse-scoped substring candidates with exact normalization and live verification. Cover every searchable field and building renames; retain a correct migration fallback.
- **Expected impact and risk — inferred:** Selective searches approach matching-result cost. Prefix/token-only replacement would change behavior; ordering and cursor completeness must remain exact. This is previous finding 3.

### 3. Partially resolved — recommendations still hydrate and calculate the active warehouse

- **Location:** `convex/finishedGoods/workflow.ts:1090`; `convex/finishedGoods/workflow.ts:1142`. Callers: `src/features/finishedGoods/PalletScreens.tsx:599`; `src/features/finishedGoods/MoveScreen.tsx:177`.
- **Evidence — measured:** Reads fall approximately 76% against base, but each call still reads approximately 1.28 MB and returns approximately 238 KB. (`evidence/iter2.md:11`; `evidence/iter2.md:12`)
- **Evidence — inferred:** Packed entries replace individual placement/pallet reads, but all active buildings’ zones are traversed and eligible supports still undergo geometry and stack calculations. (`convex/finishedGoods/workflow.ts:1115`; `convex/finishedGoods/workflow.ts:1161`; `convex/finishedGoods/workflow.ts:1178`)
- **Cost mechanism:** Data transfer, computation, and reactive dependencies still grow with active warehouse occupancy.
- **Fix:** Use verified eligibility summaries to select candidate pages, then calculate exact geometry for candidates and requested previews. Preserve complete reachability, ordering, reason precedence, and fresh transactional validation.
- **Expected impact and risk — inferred:** Reduces initial warehouse-wide work. Summary false negatives could hide valid destinations. This is previous finding 2, materially improved but unfinished.

### 4. Open — warehouse generation writes remain a measured contention point

- **Location:** `convex/lib/finishedGoodsSummary.ts:345`; product summary updates: `convex/lib/finishedGoodsSummary.ts:47`. Readers include `convex/finishedGoods/catalogue.ts:531`.
- **Evidence — measured:** Eight concurrent pallet creations produce 21 executions and 13 retries on candidate, versus 22 executions and 14 retries on base. Sampled conflicts name `finishedGoodsSummaryReadiness`. (`evidence/iter2.md:91`; `evidence/iter2.md:114`; `evidence/iter2.json:2925`)
- **Evidence — inferred:** Inventory writes still increment the warehouse generation; product contribution writes also share product summaries. The same-product probe does not establish cross-product throughput. (`convex/lib/finishedGoodsSummary.ts:65`; `convex/lib/finishedGoodsSummary.ts:345`)
- **Cost mechanism:** Shared documents couple otherwise independent writes and invalidate broad catalogue continuations.
- **Fix:** Separate stable readiness from mutable versions; scope versions to the relevant product/range and use bounded aggregate shards where measured contention warrants them.
- **Expected impact and risk — inferred:** Removes shared conflicts and unnecessary resets. Preserve cursor consistency and atomic totals. Previous finding 5 remains open; the corrected harness now confirms its contention mechanism.

### 5. New — packed occupancy adds zone-sized work to individual writes

- **Location:** `convex/lib/zoneOccupancy.ts:114`; `convex/lib/zoneOccupancy.ts:243`. Example affected mutation: `convex/finishedGoods/workflow.ts:2674`.
- **Evidence — inferred:** Every touched zone sorts placements, recalculates footprint unions, and replaces both summary and entries documents. Above 500 entries, every refresh reads authoritative placement ranges and hydrates their pallets before discarding the packed entries. A pallet-only stacking change now incurs this maintenance. (`convex/lib/zoneOccupancy.ts:124`; `convex/lib/zoneOccupancy.ts:163`; `convex/lib/zoneOccupancy.ts:247`; `convex/lib/finishedGoodsSummary.ts:326`)
- **Cost mechanism:** Zone-sized write bytes and computation, shared zone-document conflicts, and overflow scans on each write. Entry count alone does not establish a serialized-byte bound.
- **Fix:** Measure reservation, release, move, and pallet-fact writes at increasing zone sizes. Use byte-bounded entry chunks or projections, avoid fetching discarded overflow facts, and retain exact transactional union accounting.
- **Expected impact and risk — inferred:** Keeps the read optimization from moving excessive cost into mutations. Overflow correctness tests exist, but write cost and contention remain unmeasured. (`tests/integration/storage-query-scale.integration.test.ts:960`)

### 6. Partially resolved — building inventory remains occupancy-sized; legacy scans remain open

- **Location:** `convex/storageLayouts/catalogue.ts:571`; `convex/storageLayouts/catalogue.ts:604`. Caller: `src/features/storageLayouts/useStorageBuilding.ts:22`. Legacy list: `convex/finishedGoods/workflow.ts:1386`.
- **Evidence — measured:** Inventory drops to 34 document reads, but still reads 963.6 KB and returns 447.8 KB. Legacy building, location-map, and finished-goods list endpoints still read 1,844, 936, and 1,440 documents respectively. (`evidence/iter2.md:7`; `evidence/iter2.md:8`; `evidence/iter2.md:9`; `evidence/iter2.md:30`)
- **Evidence — inferred:** The live hook requests complete building inventory. Any incomplete zone causes a building-wide fallback. Legacy complete reads retain capacity cliffs. (`src/features/storageLayouts/useStorageBuilding.ts:23`; `convex/storageLayouts/catalogue.ts:584`; `convex/lib/tenantStorage.ts:386`)
- **Cost mechanism:** Packed documents reduce document count without bounding inventory payload; overflow loses the optimization for unrelated zones.
- **Fix:** Combine exact overview summaries with floor/zone/page-scoped detail; fall back per overflowed zone. Audit compatibility consumers before retiring complete-range endpoints.
- **Expected impact and risk — inferred:** Bounds displayed-detail hydration while preserving both move holds, stack geometry, and location-only occupancy. Previous finding 6 is partially resolved; previous finding 9 remains open, with lower priority because its measured endpoints have no live subscribers.

### 7. Open — location-picker substring fallback reads many rejected candidates

- **Location:** `convex/finishedGoods/jobScanLocations.ts:320`; `convex/finishedGoods/jobScanLocations.ts:663`. Caller: `src/features/finishedGoods/jobScan/LocationPicker.tsx:578`.
- **Evidence — measured:** Search reads 896 documents and 474.3 KB across two requests to return 0.8 KB; exact resolution reads 15 documents. (`evidence/iter2.md:10`; `evidence/iter2.md:42`)
- **Evidence — inferred:** Prefix retrieval is followed by contains-match ranges. Physical source hydration precedes text rejection, and lookahead checks exhaustion. (`convex/finishedGoods/jobScanLocations.ts:348`; `convex/finishedGoods/jobScanLocations.ts:719`; `convex/finishedGoods/jobScanLocations.ts:733`)
- **Cost mechanism:** Sparse interior matches remain catalogue-sized searches.
- **Fix:** Backfill normalized physical search projections and scoped substring candidates, preserving live authorization/lifecycle checks and legacy building ownership fallback.
- **Expected impact and risk — inferred:** Avoids hydrating rejected candidates. Preserve prefix-first ordering, Thai matching, QR identity, and truthful exhaustion before registration. This is previous finding 7.

### 8. Open — warehouse counters still scan every product summary

- **Location:** `convex/finishedGoods/catalogue.ts:524`. Caller: `src/features/finishedGoods/FinishedGoodsCatalogue.tsx:105`.
- **Evidence — measured:** 272 documents and 136.9 KB across two requests to return 1.6 KB. (`evidence/iter2.md:14`)
- **Evidence — inferred:** Each chunk reads products and their summaries; continuation scope includes warehouse generation. (`convex/finishedGoods/catalogue.ts:548`; `convex/finishedGoods/catalogue.ts:586`; `convex/finishedGoods/catalogue.ts:610`)
- **Cost mechanism:** O(products) settled loading, repeated after generation changes.
- **Fix:** Maintain bounded sharded warehouse totals and exact unit-label reference counts, with backfill and reconciliation.
- **Expected impact and risk — inferred:** Replaces product-sized reads with bounded aggregate reads. Preserve inherited formats, label removal, and atomic accounting without introducing another single warehouse counter. This is previous finding 8.

### 9. New — backfill invalidation and derived-row cleanup are incomplete

- **Location:** `convex/storageLayouts/zoneOccupancyBackfill.ts:31`; `convex/storageLayouts/zoneOccupancyBackfill.ts:93`; `convex/staging/e2eFixture.ts:339`.
- **Evidence — inferred:** During backfill, readiness is already false. A raw writer can change a previously rebuilt zone, but `invalidateZoneOccupancy` then makes no state change. Remaining pages can complete and set readiness true over stale earlier rows. No persisted expected cursor or invalidation epoch prevents this interleaving. Separately, fixture cleanup omits `storageZoneOccupancy` and `storageZoneOccupancyEntries`, then deletes their parents and reports completion. (`convex/storageLayouts/zoneOccupancyBackfill.ts:38`; `convex/storageLayouts/zoneOccupancyBackfill.ts:67`; `convex/storageLayouts/zoneOccupancyBackfill.ts:98`; `convex/staging/e2eFixture.ts:513`)
- **Cost mechanism:** Potentially stale inventory/recommendations after overlapping operational writes; accumulating orphaned packed documents after fixture cleanup.
- **Fix:** Persist a backfill session, expected cursor, and invalidation epoch; advance the epoch for every raw invalidation. Refuse stale completion. Add bounded tenant/warehouse cleanup for both derived tables before deleting parents.
- **Expected impact and risk — inferred:** Makes readiness and cleanup claims reliable. Add interleaving and repeated-cleanup tests; neither issue is demonstrated by the current measurements.

### 10. Partially resolved — reactive follow-up measurements still undercount work

- **Location:** `scripts/performance/convex/profile.mjs:448`; actual client behavior: `src/hooks/useCatalogueSync.ts:72`.
- **Evidence — measured:** Cancellation reports only one follow-up request and 210 documents on both targets, while settled summary loading requires two requests and 272 documents. (`evidence/iter2.md:14`; `evidence/iter2.md:86`; `evidence/iter2.md:109`)
- **Evidence — inferred:** Follow-up log entries are filtered immediately after HTTP calls without waiting for collector synchronization. `settledArgs()` returns updated arguments, but the follow-up caller discards them and keeps the original WebSocket subscription. Thus subsequent writes exercise stale continuation arguments. (`scripts/performance/convex/profile.mjs:297`; `scripts/performance/convex/profile.mjs:455`; `scripts/performance/convex/profile.mjs:457`)
- **Cost mechanism:** Missing late completions and inaccurate reactive dependencies conceal client recovery work. The reported follow-up totals cannot be treated as complete settled-screen costs.
- **Fix:** Correlate and await every completion, replace subscriptions as the client advances/resets, and assert successful settling. Add unrelated-product and same-zone placement probes.
- **Expected impact and risk — inferred:** Produces defensible fan-out totals. Independent clients, refusal handling, eligible measurement saves, and source digests resolve substantial parts of previous finding 10; query-read reductions remain supported.

## Already good (brief)

- **Inferred:** Tenant ownership checks remain enforced, and new derived tables use tenant-scoped access. No authorization widening was identified in the changed query paths. (`convex/lib/tenantDb.ts:89`; `convex/lib/schemaPolicy.ts:40`; `convex/storageLayouts/catalogue.ts:505`)
- **Measured and inferred:** Previous finding 4 is resolved on the ready path: occupancy reads 20 documents using exact per-zone union summaries; structural edit protection still checks authoritative placement presence. (`evidence/iter2.md:37`; `convex/storageLayouts/catalogue.ts:45`; `convex/lib/zoneOccupancy.ts:66`)
- **Measured:** Static layout remains separate at 25 reads; ordinary scan listing remains at 60 reads; a 50-item scan save reads 10 documents and writes 53. (`evidence/iter2.md:28`; `evidence/iter2.md:35`; `evidence/iter2.md:77`)
- **Inferred:** Query-only recommendation caching retains fresh reservation validation, and parity tests cover important occupancy transitions. (`convex/finishedGoods/workflow.ts:707`; `convex/finishedGoods/workflow.ts:1443`; `tests/integration/storage-query-scale.integration.test.ts:805`)

## What would raise the score to 9+

- Demonstrate successful paginated roster loading beyond 50 employees, preserving historical eligibility and write protection.
- Make substring searches selective while preserving normalization, ordering, completeness, and rename behavior.
- Bound recommendation and building-detail work by displayed results, including bytes and geometry computation.
- Remove measured warehouse contention and demonstrate bounded derived-maintenance costs under concurrent placement writes and overflow.
- Protect backfill completion against invalidation, complete derived-row cleanup, and verify both with regression tests.
- Measure fully settled reactive subscriptions, successful payslip/package paths, and expensive actions at increasing fixture sizes. Current payslip and package figures remain refusal-path measurements. (`evidence/iter2.md:56`; `evidence/iter2.md:64`)
