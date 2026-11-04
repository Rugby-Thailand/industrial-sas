## Score: 4/10

- **Measured:** The warehouse-generation contention fix works on the isolated probe: eight concurrent measurement saves produce **0 retries**, versus **14 on base**, with no failures. Pallet creation still produces **13 retries on both targets**, now attributed to `finishedGoodsCounters`. (`evidence/iter3.md:93`; `evidence/iter3.md:95`; `evidence/iter3.md:122`; `evidence/iter3.json:2990`)
- **Measured:** Earlier read improvements remain: recommendations read **687–688 documents**, building inventory **35**, and building occupancy **21**, versus **2,886–2,887**, **1,829**, and **917** on base. Recommendation and inventory read bytes remain substantial. (`evidence/iter3.md:11`; `evidence/iter3.md:12`; `evidence/iter3.md:30`; `evidence/iter3.md:37`)
- **Measured:** Saved-scan search still reads **2,389 documents across 22 requests**; location-picker search reads **896 across two**. The roster still returns `LIMIT_EXCEEDED` after **162 reads**. That unchanged core-flow failure keeps this snapshot in the rubric’s ≤4 band. (`evidence/iter3.md:6`; `evidence/iter3.md:10`; `evidence/iter3.md:18`)
- **Inferred:** Overflow maintenance is materially safer, and derived-row cleanup is fixed. Backfill restart ownership, warehouse-wide overflow fallback, and unbounded maintenance dispatch remain risks. (`convex/lib/zoneOccupancy.ts:301`; `convex/staging/e2eFixture.ts:350`; `convex/storageLayouts/zoneOccupancyBackfill.ts:76`; `convex/storageLayouts/zoneOccupancyBackfill.ts:159`)
- **Inferred:** The score is unchanged, not reduced for existing problems. The independent HR paging work is absent and receives no credit.

## Changes since last audit

- **Insert-only change log — correct for the inspected normal path.** **Inferred:** Writers append a tenant-scoped marker instead of updating warehouse generation. Catalogue and batch readers use the latest marker together with legacy generation, preserving continuation invalidation. Permission declarations remain unchanged. Tests cover successive tokens and retaining the newest token during pruning, but not actual cursor recovery or concurrent pruning. **Measured:** The distinct-pallet contention probe falls from 14 retries on base to zero; same-product creation remains at 13. (`convex/lib/finishedGoodsSummary.ts:166`; `convex/lib/finishedGoodsSummary.ts:178`; `convex/lib/finishedGoodsSummary.ts:389`; `convex/finishedGoods/catalogue.ts:52`; `convex/finishedGoods/batches.ts:454`; `tests/integration/finished-goods-change-log.integration.test.ts:82`; `evidence/iter3.md:95`; `evidence/iter3.md:122`)

- **Overflow maintenance and unchanged-row suppression — correct, with remaining capacity risks.** **Inferred:** Initial reconstruction reads at most 501 placements per status; overflow skips discarded pallet hydration. Subsequent writes into a marked overflowed zone skip reconstruction. Unchanged rows avoid replacement. Complete rows still undergo zone-sized comparison, geometry calculation, and replacement when changed. **Measured:** The supplied reservation probe reads/writes 37/9 documents versus 28/7 on base; cancellation reads/writes 32/8 versus 23/6. These are useful fixture measurements, not a cap-sized or overflow contention benchmark. (`convex/lib/zoneOccupancy.ts:77`; `convex/lib/zoneOccupancy.ts:128`; `convex/lib/zoneOccupancy.ts:218`; `convex/lib/zoneOccupancy.ts:301`; `evidence/iter3.md:78`; `evidence/iter3.md:105`)

- **Readiness hardening — partially correct, still risky across overlapping runs.** **Inferred:** Invalidation now poisons an unfinished backfill, and legacy-generation checks distrust rows after older writers run. Separate building readiness preserves authoritative building membership when placements disagree with their zones. However, restart clears the shared poison flag without assigning a run identity; an older continuation can subsequently complete the newer run prematurely. The added invalidation test covers one uninterrupted chain, not this restart interleaving. **Measured:** Ready-path occupancy readers each add one document versus iteration 2; no overlapping-run measurement is supplied. (`convex/storageLayouts/zoneOccupancyBackfill.ts:33`; `convex/storageLayouts/zoneOccupancyBackfill.ts:76`; `convex/storageLayouts/zoneOccupancyBackfill.ts:105`; `convex/lib/zoneOccupancy.ts:390`; `tests/integration/storage-query-scale.integration.test.ts:1005`; `evidence/iter3.md:37`)

- **Building overflow fallback — correctness-preserving, but a performance regression for affected warehouses.** **Inferred:** One overflowed zone now disables derived building occupancy and inventory throughout its warehouse. Overflow remains latched during ordinary writes, and the sweep skips otherwise ready overflowed warehouses. The new per-zone inventory fallback does not avoid this warehouse-level gate. **Measured:** The supplied ready fixture retains the earlier reductions; it does not measure the warehouse-wide fallback penalty. (`convex/lib/zoneOccupancy.ts:301`; `convex/lib/zoneOccupancy.ts:404`; `convex/storageLayouts/catalogue.ts:575`; `convex/storageLayouts/catalogue.ts:590`; `convex/storageLayouts/zoneOccupancyBackfill.ts:167`)

- **Fixture cleanup — correct by inspection; previous cleanup defect resolved.** **Inferred:** Cleanup now includes both derived data tables and the change log through organization/warehouse indexes, before warehouse deletion. No repeated-cleanup regression test or runtime measurement was added. (`convex/staging/e2eFixture.ts:348`; `convex/staging/e2eFixture.ts:350`; `convex/staging/e2eFixture.ts:516`)

- **Automatic maintenance — risky at larger installation sizes.** **Inferred:** The new cron jobs automate retention and backfill, but both collect every warehouse in one transaction. The pruning deletion cap does not bound warehouse traversal. **Measured:** No maintenance-job scale measurements are supplied. (`convex/crons.ts:11`; `convex/finishedGoods/changeLog.ts:15`; `convex/storageLayouts/zoneOccupancyBackfill.ts:159`)

- **Profiler additions — useful, reactive recovery still incomplete.** **Measured:** Mutation costs and the distinct-pallet contention comparison are now recorded; cancellation captures two follow-up requests and 274 documents. **Inferred:** A fixed 1.5-second delay improves log capture but does not guarantee completion. Follow-up recovery still discards the settled arguments instead of replacing the WebSocket subscription. The overflow test checks unchanged entries, not read budgets; the size test checks one fixture’s JSON size. (`scripts/performance/convex/profile.mjs:446`; `scripts/performance/convex/profile.mjs:457`; `scripts/performance/convex/profile.mjs:618`; `tests/integration/storage-query-scale.integration.test.ts:964`; `tests/integration/storage-query-scale.integration.test.ts:1115`; `evidence/iter3.md:88`)

**Scope and verification — inferred:** Audited snapshot `0050464604b8f4e6c1d0051f3504d4c0b23cf26b`, including `d84cb789` and `00504646` over iteration 2. Recomputed Convex digests match the supplied evidence: candidate `8c112d95e35b8cc6`, base `a486b726209f5b84`. Thus the candidate’s recorded `d84cb789+dirty` source matches this snapshot under the profiler’s digest algorithm. Backend version remains `unknown`. Tests were inspected, not executed: this snapshot has no `node_modules`. No deployment was called. (`scripts/performance/convex/profile.mjs:710`; `evidence/iter3.json:26`)

Code references are relative to the snapshot; evidence references are relative to the supplied review directory. Document and byte counts carry more weight than latency. Comparisons against base include improvements retained from earlier iterations.

## Findings (ranked by impact, max 10)

### 1. Open — roster capacity still prevents a core screen from loading

- **Location:** `convex/hr/roster.ts:321`; `convex/hr/shared.ts:1109`; `convex/model/hr/roster.ts:53`. Caller: `src/features/hr/ShiftsRoster.tsx:699`.
- **Evidence — measured:** 162 documents and 112.8 KB read, then `LIMIT_EXCEEDED` on the 153-employee fixture. (`evidence/iter3.md:18`)
- **Evidence — inferred:** Complete employee loading and the 50-employee check precede search filtering. Successful smaller requests also load site-wide monthly attendance. (`convex/hr/roster.ts:328`; `convex/hr/roster.ts:330`; `convex/hr/roster.ts:348`)
- **Cost mechanism:** Site-sized loading followed by refusal; broad attendance dependencies below the limit.
- **Fix:** Page authorized employees and fetch displayed employees’ attendance, assignments, and leave claims. Preserve historical employment eligibility, revisions, frozen-plan checks, and bounded atomic saves.
- **Expected impact and risk — inferred:** Restores larger-site access and bounds screen work. Historical eligibility and save protection need caller-level regression coverage. **Previous finding 1 remains open.**

### 2. Partially resolved — a stale backfill continuation can complete after another run restarts

- **Location:** `convex/storageLayouts/zoneOccupancyBackfill.ts:76`; `convex/storageLayouts/zoneOccupancyBackfill.ts:105`. Consumers: `convex/lib/zoneOccupancy.ts:390`.
- **Evidence — inferred:** Restart clears `stale`, but continuations carry only a database cursor. For example: run A rebuilds zones 1–2; a raw write changes zone 2 and invalidates readiness; run B restarts and rebuilds zone 1; A’s remaining page completes and sets readiness true before B repairs zone 2. No session or expected cursor rejects A’s completion. The new test finishes the invalidated chain before restarting, so it misses this case. (`convex/storageLayouts/zoneOccupancyBackfill.ts:81`; `convex/storageLayouts/zoneOccupancyBackfill.ts:108`; `convex/storageLayouts/zoneOccupancyBackfill.ts:124`; `tests/integration/storage-query-scale.integration.test.ts:1029`)
- **Cost mechanism:** Incorrect readiness can expose stale inventory and recommendation projections; overlapping chains also repeat reconstruction work.
- **Fix:** Persist a run identifier, invalidation epoch, and expected continuation. Include them in scheduled pages and reject obsolete pages before rebuilding or completing. Add the overlapping-restart sequence with an actual source change.
- **Expected impact and risk — inferred:** Makes completion trustworthy under manual restart and scheduled recovery. Single-chain invalidation and cleanup are fixed, but **previous finding 9 is partially resolved**, not closed.

### 3. Open — substring searches still inspect many rejected records

- **Location:** `convex/finishedGoods/jobScans.ts:625`; `convex/finishedGoods/jobScanLocations.ts:663`. Callers: `src/features/finishedGoods/jobScan/JobScanRecords.tsx:132`; `src/features/finishedGoods/jobScan/LocationPicker.tsx:578`.
- **Evidence — measured:** Saved-scan search reads 2,389 documents and 1,541.1 KB across 22 requests. Location search reads 896 documents and 474.3 KB across two requests to return 0.8 KB. (`evidence/iter3.md:6`; `evidence/iter3.md:10`)
- **Evidence — inferred:** Scan substring and building-name matching follow indexed history retrieval. Location search follows prefix ranges with contains-match ranges and hydrates physical sources before rejection. (`convex/finishedGoods/jobScans.ts:675`; `convex/finishedGoods/jobScans.ts:699`; `convex/finishedGoods/jobScanLocations.ts:348`; `convex/finishedGoods/jobScanLocations.ts:733`)
- **Cost mechanism:** Sparse matches approach history/catalogue-sized work despite bounded individual requests.
- **Fix:** Backfill tenant/warehouse-scoped normalized substring candidates, then verify live source records. Maintain searchable projections on relevant edits and building renames; retain a correct migration fallback.
- **Expected impact and risk — inferred:** Avoids reading rejected source records. Preserve substring semantics, Thai normalization, scan ordering, prefix-first picker ordering, QR identity, and truthful exhaustion. **Previous findings 2 and 7 remain open.**

### 4. Partially resolved — recommendations remain active-warehouse-sized

- **Location:** `convex/finishedGoods/workflow.ts:1090`; `convex/finishedGoods/workflow.ts:1142`. Callers: `src/features/finishedGoods/PalletScreens.tsx:599`; `src/features/finishedGoods/MoveScreen.tsx:177`.
- **Evidence — measured:** Recommendations read 687–688 documents, approximately 1,284 KB, and return approximately 238 KB each. Base reads 2,886–2,887 documents. (`evidence/iter3.md:11`; `evidence/iter3.md:12`)
- **Evidence — inferred:** All active buildings’ zones are traversed; contexts and support geometry are calculated before returning candidates. (`convex/finishedGoods/workflow.ts:1106`; `convex/finishedGoods/workflow.ts:1115`; `convex/finishedGoods/workflow.ts:1178`)
- **Cost mechanism:** Read bytes, geometry work, and reactive dependencies grow with active warehouse occupancy.
- **Fix:** Use verified eligibility projections to select bounded candidate pages, then calculate exact geometry for candidates and requested previews. Backfill projections with a complete fallback.
- **Expected impact and risk — inferred:** Bounds initial work while retaining exact mutation validation. Prevent false negatives and preserve candidate ordering and reason precedence. **Previous finding 3 remains partially resolved.**

### 5. Partially resolved — warehouse-generation contention is removed, but code allocation still serializes creation

- **Location:** `convex/finishedGoods/workflow.ts:110`; `convex/lib/finishedGoodsSummary.ts:47`; `convex/lib/finishedGoodsSummary.ts:389`. Caller: `finishedGoods/workflow:createPallet`.
- **Evidence — measured:** Distinct-pallet measurement saves improve from 22 executions/14 retries to 8/0. Eight pallet creations remain at 21 executions/13 retries on both targets; sampled conflicts identify `finishedGoodsCounters`. (`evidence/iter3.md:93`; `evidence/iter3.md:95`; `evidence/iter3.md:120`; `evidence/iter3.md:122`; `evidence/iter3.json:2990`)
- **Evidence — inferred:** Pallet and position sequence allocation share one warehouse counter document. Product contribution changes still update product summary documents. The latest-marker read also retains warehouse-wide catalogue invalidation. (`convex/finishedGoods/workflow.ts:115`; `convex/finishedGoods/workflow.ts:124`; `convex/lib/finishedGoodsSummary.ts:65`; `convex/finishedGoods/batches.ts:454`)
- **Cost mechanism:** Shared counter serialization remains; aggregate writes and broad continuation invalidation add coupling.
- **Fix:** Separate independent pallet/position counters, shard aggregate totals where warranted, and scope continuation signals to relevant ranges. Preserve strict sequencing wherever required; batching allocation must preserve code-order semantics, uniqueness, and idempotency.
- **Expected impact and risk — inferred:** Removes avoidable coupling without weakening integrity. The counter predates this iteration and was not separately identified in my previous report; its current attribution does not justify lowering the score. **Previous finding 4 is partially resolved; its warehouse-generation write hotspot is resolved.**

### 6. Partially resolved — complete occupancy rows still make individual writes zone-sized

- **Location:** `convex/lib/zoneOccupancy.ts:159`; `convex/lib/zoneOccupancy.ts:315`. Maintenance caller: `convex/lib/finishedGoodsSummary.ts:369`.
- **Evidence — measured:** Reservation adds nine reads and two writes versus base; fan-out’s reservation writes 9.4 KB versus 7.2 KB. (`evidence/iter3.md:78`; `evidence/iter3.md:87`; `evidence/iter3.md:105`; `evidence/iter3.md:114`)
- **Evidence — inferred:** Complete rows still sort placements, calculate footprint unions, compare packed arrays, and replace changed entries. Overflow reconstruction and discarded-fact hydration are fixed. The size test covers one fixture; the overflow test does not assert read counts. (`convex/lib/zoneOccupancy.ts:166`; `convex/lib/zoneOccupancy.ts:177`; `convex/lib/zoneOccupancy.ts:204`; `tests/integration/storage-query-scale.integration.test.ts:964`; `tests/integration/storage-query-scale.integration.test.ts:1115`)
- **Cost mechanism:** Zone-sized CPU and write bytes, plus shared-zone document conflicts.
- **Fix:** Benchmark reservation, release, move, and pallet-fact writes near the cap with same-zone concurrency. Use byte-bounded chunks or narrower projections while maintaining exact transactional union accounting.
- **Expected impact and risk — inferred:** Prevents read savings from moving excessive work into writes. Add explicit read/write-byte budgets and maximum-field-size coverage. **Previous finding 5 is partially resolved.**

### 7. Partially resolved — building inventory remains large, and overflow disables optimization warehouse-wide

- **Location:** `convex/storageLayouts/catalogue.ts:571`; `convex/lib/zoneOccupancy.ts:404`. Caller: `src/features/storageLayouts/useStorageBuilding.ts:23`.
- **Evidence — measured:** Building inventory reads only 35 documents but still reads 964.0 KB and returns 447.8 KB. Legacy building, location-map, and finished-goods list endpoints read 1,844, 936, and 1,440 documents respectively. (`evidence/iter3.md:7`; `evidence/iter3.md:8`; `evidence/iter3.md:9`; `evidence/iter3.md:30`)
- **Evidence — inferred:** The live hook subscribes to complete inventory. One overflow flag forces all building readers in that warehouse onto authoritative ranges, including buildings without the overflow. Ordinary maintenance never clears it; the sweep skips otherwise ready warehouses. (`convex/storageLayouts/catalogue.ts:575`; `convex/storageLayouts/catalogue.ts:641`; `convex/lib/zoneOccupancy.ts:301`; `convex/storageLayouts/zoneOccupancyBackfill.ts:167`)
- **Cost mechanism:** Occupancy-sized payloads and a warehouse-wide performance cliff that can persist after a zone drains.
- **Fix:** Separate overview summaries from floor/zone/page detail. Maintain verified building membership so fallback can be scoped safely, and schedule bounded recovery of overflowed zones. Audit compatibility consumers before retiring legacy endpoints.
- **Expected impact and risk — inferred:** Bounds displayed-detail hydration and confines fallback cost. Preserve placement-building semantics, both move holds, and exact geometry. **Previous finding 6 remains partially resolved; warehouse-wide overflow fallback is a new regression.**

### 8. Open — warehouse counters still scan every product summary

- **Location:** `convex/finishedGoods/catalogue.ts:535`; `convex/finishedGoods/catalogue.ts:597`. Caller: `src/features/finishedGoods/FinishedGoodsCatalogue.tsx:105`.
- **Evidence — measured:** 272 documents and 136.9 KB across two requests to return 1.6 KB, unchanged from base. (`evidence/iter3.md:14`)
- **Evidence — inferred:** Every product and summary contributes to settled totals; the continuation scope still includes a warehouse-wide change token. (`convex/finishedGoods/catalogue.ts:559`; `convex/finishedGoods/catalogue.ts:621`)
- **Cost mechanism:** O(products) loading, restarted after inventory changes.
- **Fix:** Maintain bounded sharded warehouse totals and exact unit-label reference counts, with backfill and reconciliation.
- **Expected impact and risk — inferred:** Replaces product-sized loading with bounded aggregate reads. Preserve inherited formats, label removal, atomic totals, and avoid another single warehouse write hotspot. **Previous finding 8 remains open.**

### 9. New — maintenance jobs bound deletions but not warehouse traversal

- **Location:** `convex/finishedGoods/changeLog.ts:15`; `convex/storageLayouts/zoneOccupancyBackfill.ts:159`. Scheduled by `convex/crons.ts:11`.
- **Evidence — inferred:** Pruning collects every warehouse and performs per-warehouse indexed lookups even when nothing expires. Its 2,000-delete cap does not bound those reads. Sweep likewise collects every warehouse, reads two readiness records per warehouse, and schedules every eligible backfill in one mutation.
- **Cost mechanism:** Global tenant-count growth can exceed transaction or scheduling capacity and prevent retention or automatic readiness recovery.
- **Fix:** Page warehouses through bounded dispatcher transactions with stable cursors. Bound reads, deletions, and scheduled jobs independently; retain each warehouse’s newest change marker and use backfill run ownership.
- **Expected impact and risk — inferred:** Keeps maintenance operational as installations grow. Test multi-page dispatch, warehouse deletion between pages, and large retention backlogs. No supplied measurement establishes these jobs’ scale limits.

### 10. Partially resolved — reactive follow-up totals still do not model settled subscriptions

- **Location:** `scripts/performance/convex/profile.mjs:289`; `scripts/performance/convex/profile.mjs:457`. Actual client: `src/hooks/useCatalogueSync.ts:72`.
- **Evidence — measured:** Cancellation now records two follow-up requests and 274 reads. Reservation records 10 reactive executions/1,707 reads versus 10/6,098 on base. These demonstrate reduced recorded execution work. (`evidence/iter3.md:87`; `evidence/iter3.md:88`; `evidence/iter3.md:114`)
- **Evidence — inferred:** Recovery returns new arguments, but the caller discards them and retains the original WebSocket subscription. Later writes therefore exercise old continuation arguments. A fixed delay does not correlate every follow-up completion or assert successful settlement. (`scripts/performance/convex/profile.mjs:297`; `scripts/performance/convex/profile.mjs:311`; `scripts/performance/convex/profile.mjs:457`; `scripts/performance/convex/profile.mjs:459`)
- **Cost mechanism:** Stale subscription dependencies and potentially missing logs make these unsuitable as complete settled-screen recovery totals.
- **Fix:** Correlate and await each completion, assert terminal success, and replace subscriptions after every advance/reset. Add unrelated-product writes and same-zone placement contention.
- **Expected impact and risk — inferred:** Makes reactive comparisons representative. Independent-client contention measurements remain supported; the profiler’s “fullest open zone” selection does not establish cap-sized maintenance cost. **Previous finding 10 remains partially resolved.**

## Already good (brief)

- **Inferred:** Tenant-scoped access and warehouse authorization remain in place; no authorization widening was identified in the changed paths. New tables are registered as tenant tables. (`convex/lib/schemaPolicy.ts:35`; `convex/lib/tenantDb.ts:89`; `convex/storageLayouts/catalogue.ts:631`)
- **Measured:** Ready-path occupancy and inventory reductions persist, with identical base/candidate return-byte counts. Static layout remains separate at 25 reads. (`evidence/iter3.md:30`; `evidence/iter3.md:35`; `evidence/iter3.md:37`; `evidence/iter3.json:queries`)
- **Inferred:** Query-local caching preserves fresh transactional placement validation. Existing parity tests cover reservation, confirmation, cancellation, stacking changes, and two-zone moves. (`convex/finishedGoods/workflow.ts:707`; `tests/integration/storage-query-scale.integration.test.ts:810`; `tests/integration/storage-query-scale.integration.test.ts:887`)
- **Measured:** Ordinary scan listing reads 60 documents; a 50-item save reads 10 and writes 53. (`evidence/iter3.md:28`; `evidence/iter3.md:77`)

## What would raise the score to 9+

- Demonstrate successful paginated roster loading beyond 50 employees with historical eligibility and save protection preserved.
- Make both substring searches selective without changing matching, ordering, or completeness.
- Bound recommendation and building-detail reads, bytes, and geometry work by displayed results.
- Finish backfill run ownership, scope overflow fallback, and bound maintenance dispatch.
- Demonstrate acceptable counter and same-zone contention, including occupancy maintenance near capacity.
- Measure fully settled reactive recovery, successful payslip/package paths, and expensive actions at increasing fixture sizes. Current payslip/package rows remain refusal-path measurements. (`evidence/iter3.md:56`; `evidence/iter3.md:64`; `evidence/iter3.md:65`)
