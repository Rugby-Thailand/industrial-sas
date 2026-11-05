## Score: 4/10

**Retrospective independent iteration5 audit — 2026-11-05.** Code references below mean `c9d39c91`, inspected with `git show`, never working-tree HEAD. Evidence references are relative to this report directory. No iteration6 or later improvements receive credit. No Opus reviews were read, and no delegation, tests, backend calls, deployments, imports, or commits were performed.

- **Measured:** Catalogue summary improves from 272 reads across two requests to **18 reads, 6.9 KB, one request** (`evidence/iter5.md:38`). This resolves the ordinary ready-warehouse totals scan on the measured fixture.
- **Measured:** Roster still fails with `LIMIT_EXCEEDED` after **162 reads** on 153 employees (`evidence/iter5.md:18`). The rubric explicitly places core-flow limit failures in the ≤4 band; the score remains unchanged from iteration4.
- **Measured:** Saved-scan search still reads **2,389 documents across 22 requests**, location search **896 across two**, recommendations **687–688**, and building inventory **964.1 KB** despite only 35 documents (`evidence/iter5.md:6-12`, `:30`).
- **Measured:** Eight concurrent same-product creates incur **17 retries**, versus base’s 14; distinct-pallet measurements incur **4**, versus base’s 17, with no failures. Single bursts do not establish a stable contention rate (`evidence/iter5.md:93-95`, `:120-122`).
- **Inferred:** Maintained totals preserve tenant-scoped access and transactional deltas for inspected ordinary writes, but generation trust, single-transaction backfill capacity, shared shard contention, and incomplete reactive measurement remain qualifications.

## Changes since last audit

- **Maintained totals — correct for inspected normal tracked writes; risky trust boundary.** Eight product-hashed shards aggregate counters and product-unit reference counts. Pallet contribution deltas and product before/after changes flush in the source transaction (`convex/lib/finishedGoodsSummary.ts:63`, `:329`, `:416`; `convex/lib/warehouseTotals.ts:90`). Public summary retains its existing permission and warehouse gate (`convex/finishedGoods/catalogue.ts:545`). **Measured:** 272 → 18 reads. This is standalone iteration5 evidence, not extrapolation from iteration6.
- **Narrow product-summary subscription — correct by inspection.** `readinessState` removes the warehouse change-shard dependency for a single product; the product document, readiness row, and actual summary remain dependencies (`convex/finishedGoods/catalogue.ts:52`, `:529`; `convex/lib/finishedGoodsSummary.ts:241`). **Measured:** reservation fan-out records eight reruns and 1,718 reads versus base’s ten and 6,098; absence of product-summary and totals reruns is appropriate when their displayed values do not change (`evidence/iter5.md:87`).
- **Totals backfill and hourly sweep — bounded dispatch, incomplete capacity validation.** Backfill reads at most 2,000 products plus their summaries in one mutation and replaces all eight totals rows atomically; concurrent writes to those read ranges/rows must serialize. Sweep pages 50 warehouses (`convex/finishedGoods/totalsBackfill.ts:27`, `:44`, `:62`, `:108`). No dense-capacity measurement is supplied.
- **Tests — useful but incomplete, inspected only.** The new parity test compares maintained output to the paged scan across product insertion, unit replacement, pallet status change and deletion. The rollback test manually increments legacy generation and confirms fallback/rebuild (`tests/integration/finished-goods-warehouse-totals.integration.test.ts:151`, `:196`). It does not demonstrate actual old-writer deployment behavior, cross-product concurrency, corrupt/missing shards, the 2,000-product boundary, or large unit-label payloads.
- **Profiler — preparation added, existing limitations retained.** Rebuild invokes totals backfill but catches every thrown error and does not assert its returned `built` status (`scripts/performance/convex/profile.mjs:85`). Fast-path measurements prove availability on this fixture, not reliable automatic preparation on all warehouses.

**Snapshot verification:** Recomputed SHA256 by sorting `git ls-tree -r --name-only c9d39c91 -- convex`, appending each path's bytes then its `git show c9d39c91:<path>` contents. Full digest: `be40ad7cfa789fc2c87d5741a44a3d57f937a29efae1f0480d2e690b6eb8e3b2`; recorded prefix **be40ad7cfa789fc2 matches**. Thus `db92906a+dirty` metadata is consistent with the committed iteration5 backend (`evidence/iter5.json:18`; digest algorithm in `scripts/performance/convex/profile.mjs:730`). Backend version remains `unknown`; digest establishes source identity, not independent deployment attestation. Reviewed incremental diff `db92906a..c9d39c91`, cumulative changed-file inventory and relevant implementation from `80dc0a93..c9d39c91`, commit history, and my iteration4 report. Document/byte counts outweigh latency under reported load.

## Findings (ranked by impact, max 10)

### 1. Open — roster still refuses the large-site core flow

- **Location:** `convex/hr/roster.ts:321`; caller `src/features/hr/ShiftsRoster.tsx:698`.
- **Evidence / cost — measured:** 162 reads, 112.8 KB, then `LIMIT_EXCEEDED` (`evidence/iter5.md:18`). **Inferred:** employee limit precedes filtering; monthly attendance dependencies remain site-wide.
- **Fix / impact / risk:** Page historically eligible authorized employees and scope attendance to displayed employees. Preserve frozen plans, revision checks and bounded saves. Previous finding 1 remains open.

### 2. Open — substring search remains history-sized

- **Location:** `convex/finishedGoods/jobScans.ts:625`, `:675`; `convex/finishedGoods/jobScanLocations.ts:663`, `:733`; callers `JobScanRecords.tsx:132`, `LocationPicker.tsx:578` under `src/features/finishedGoods/jobScan/`.
- **Evidence / cost — measured:** 2,389 reads / 1,541.1 KB for saved scans; 896 / 474.3 KB for locations (`evidence/iter5.md:6`, `:10`). **Inferred:** bounded continuation requests still hydrate rejected substring candidates.
- **Fix / impact / risk:** Maintain tenant/warehouse-scoped exact normalized gram postings with complete fallback during migration. Verify Thai/NFKC semantics, ordering and truthful exhaustion. Previous finding 2 remains open.

### 3. Partially resolved — recommendation and inventory bytes remain large

- **Location:** `convex/finishedGoods/workflow.ts:1090`, `:1106`; `convex/storageLayouts/catalogue.ts:571`; `convex/lib/zoneOccupancy.ts:406`.
- **Evidence / cost — measured:** Recommendations read about 1,284 KB and return about 238 KB; building inventory reads 964.1 KB and returns 447.8 KB (`evidence/iter5.md:11-12`, `:30`). **Inferred:** warehouse candidate geometry and complete inventory hydration remain broad; warehouse overflow disables derived reads and can persist after occupancy falls.
- **Fix / impact / risk:** Page verified candidate projections and floor/zone details, recover overflow in bounded jobs. Preserve exact placement validation, ordering and move holds. Previous findings 3 and 5 remain partially resolved.

### 4. Partially resolved — totals add cross-product shard contention

- **Location:** `convex/lib/warehouseTotals.ts:28`, `:96`; `convex/finishedGoods/workflow.ts:110`; `convex/lib/finishedGoodsSummary.ts:179`.
- **Evidence / cost — inferred:** The comment that totals add no conflicts beyond a product summary is too strong: different products hashing to one of eight totals shards now share a write row. Sequence counters and change shards also remain shared dependencies. **Measured:** 17 same-product creation retries and four distinct-pallet measurement retries in eight-call bursts (`evidence/iter5.md:93-95`); these totals cannot attribute incremental conflicts specifically to totals shards.
- **Fix / impact / risk:** Profile distinct-product collisions and repeated same-zone bursts; tune shard count or narrow aggregation while preserving unique codes and exact totals. Previous finding 4 remains partially resolved; cross-product totals coupling is new.

### 5. New — totals generation trust does not detect the preceding sharded writer

- **Location:** `convex/lib/warehouseTotals.ts:121-127`; `convex/lib/finishedGoodsSummary.ts:451-455`; `convex/finishedGoods/catalogue.ts:552`.
- **Evidence / cost — inferred:** Trust compares only legacy `generation`. The actual preceding iteration4 writer increments change shards, not legacy generation, and does not maintain warehouse totals. After totals initialization, rollback to that writer and return to iteration5 could leave matching totals-generation metadata with stale totals. This is a conditional integrity risk, not a measured stale result. The test's simulated legacy increment does not cover that predecessor.
- **Fix / impact / risk:** Explicitly invalidate totals on rollback/redeployment or introduce a durable maintenance epoch enforced by supported writers and rebuild before enabling reads. Test the actual predecessor protocol. Fast-path trust also assumes all eight valid shards exist; the reader does not verify completeness. Avoid claiming arbitrary old-writer safety.

### 6. New — totals backfill has a hard optimization ceiling and no byte budget

- **Location:** `convex/lib/warehouseTotals.ts:14`, `:76`; `convex/finishedGoods/totalsBackfill.ts:44-69`, `:124`.
- **Evidence / cost — inferred:** Above 2,000 products the backfill returns `TOO_MANY_PRODUCTS`, retaining product-sized fallback scans; hourly sweep retries such warehouses. Below that cap, one transaction still hydrates every product and summary and packs all unit labels into eight rows. Unit-label bytes are not bounded by the fixed shard count. No maximum-density profile establishes transaction headroom.
- **Fix / impact / risk:** Measure boundary and byte-heavy cases, then use resumable owned accumulation with write invalidation before publishing readiness. Preserve serializable exactness and label reference counts. Previous finding 7 is resolved on the measured ready fixture, partially resolved overall.

### 7. Partially resolved / open — occupancy maintenance and recovery remain zone-sized

- **Location:** `convex/lib/zoneOccupancy.ts:175`, `:310`; `convex/storageLayouts/zoneOccupancyBackfill.ts:69`, `:122`.
- **Evidence / cost — measured:** Reservation reads/writes 37/9 documents versus base 28/7 (`evidence/iter5.md:78`, `:105`). **Inferred:** whole occupancy-row replacement scales with zone placements; a 50-zone reconstruction page can require 25,000 placements plus pallet hydration at 500 placements each. This is a source-derived upper workload, not a measured execution.
- **Fix / impact / risk:** Budget reconstruction by work/bytes, conservatively one dense zone per job, and test same-zone concurrency and recovery. Preserve run ownership and complete readiness. Previous findings 6 and 8 remain partially resolved and open respectively; superseded-run protection and bounded warehouse dispatch remain resolved.

### 8. Partially resolved — reactive evidence still omits subscription replacement

- **Location:** `scripts/performance/convex/profile.mjs:310`, `:329`, `:477`; client `src/hooks/useCatalogueSync.ts:72`.
- **Evidence / cost — inferred:** Follow-up recovery discards settled arguments and retains the original subscription. Fixed waits and capped continuation loops lack complete terminal assertions. **Measured:** recorded reservation fan-out improves to 1,718 reads with zero follow-ups, but this does not prove all later settled-client behavior (`evidence/iter5.md:87`).
- **Fix / impact / risk:** Replace subscriptions after settlement, assert terminal success and correlate all completions; repeat bursts and unrelated-product writes. Previous finding 9 remains partially resolved. Payslip policy refusals and package NOT_OK rows remain unsuccessful-path evidence, not successful-flow validation (`evidence/iter5.md:56`, `:64-65`).

## Already good (brief)

- **Inferred:** New totals table is registered for tenant access (`convex/lib/schemaPolicy.ts:36`); internal backfill derives tenant ownership from the warehouse (`convex/finishedGoods/totalsBackfill.ts:31-38`). No new public authorization bypass was found in inspected changes.
- **Inferred:** Transactional before/after product tracking maintains reference-counted unit labels; inherited storage-format logic remains in the product summary (`convex/lib/finishedGoodsSummary.ts:258`, `:424`). Cross-warehouse product reassignment is not correctly generalized by the single chosen warehouse at `:428`; any future caller permitting that must transfer both warehouse contributions explicitly.
- **Measured:** Ordinary scans remain 60 reads; saving 50 scans reads 10 and writes 53; building occupancy reads 21 (`evidence/iter5.md:28`, `:77`, `:37`). Earlier occupancy and bounded-dispatch gains persist.

## What would raise the score to 9+

Demonstrate successful bounded roster loading beyond 50 employees; selective multilingual substring retrieval; result-sized recommendation/detail subscriptions; safe totals trust across actual rollback versions; bounded byte-aware totals and occupancy recovery; acceptable repeated cross-product and same-zone contention; and fully settled reactive measurements with successful-path coverage. Iteration5's totals improvement is real, but cannot offset the remaining core-flow failure under the supplied rubric.
