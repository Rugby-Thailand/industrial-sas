## Score: 6/10

- **The warehouse-wide write hot spot is gone (measured).** 8 concurrent `saveMeasurement` calls on distinct pallets took 8 executions with 0 OCC retries (RTT p50 64 ms). Base took 22 executions with 14 retries, all on `finishedGoodsSummaryReadiness` (RTT p50 276 ms). No mutation reads the change log (`finishedGoodsGeneration` is called only from the queries `catalogue.ts:52-71` and `batches.ts:454, 504`), so the inserts cannot conflict with each other (inferred).
- **Query cost did not move this iteration (measured).** Every read count is equal to iteration 2, or +1 from the new rollback-guard read:
  - `recommend` 687 docs (686 in iter2), building inventory 35 (34), `buildingOccupancy` 21 (20).
  - One `reserve` still re-runs 10 subscriptions: 1,707 docs and 2,742 KB (base 6,098 docs, 3,808 KB). `recommend` and `recommendMove` are 1,377 of those docs.
  - Every catalogue subscription still re-runs on every finished-goods write. The change-log head is a new warehouse-wide reactive dependency that replaces the old one.
- **The overflow write cliff I reported is removed (inferred from code, guarded by a test).**
  - Overflowed zones skip per-write maintenance (`zoneOccupancy.ts:302-303`).
  - A rebuild reads at most cap+1 rows per status, and a `CAPACITY_DATA_LIMIT` refusal is caught as "overflowed" (`77-106`). No write path can now reach the `.all(10_000)` refusal.
  - The new test writes to a pallet held in a 501-entry zone and asserts the rows are untouched (`storage-query-scale.integration.test.ts`, "does no full-range work…").
- **The heavy non-storage paths are unchanged (measured), and they keep the score in the 5–6 band.**
  - Job-scan search reads 2,389 docs over 22 requests, and grows with history.
  - The picker `searchPage` reads 896 docs to return 0.8 KB.
  - `hr/roster:roster` still returns `LIMIT_EXCEEDED`.
- **New risk: the continuation token is no longer serialized (inferred, see finding 3).** The token is "newest `_creationTime` + legacy generation". A writer that began earlier but commits later can land below the current newest row, and then the token does not move.
- **The measured code is the audited code (verified).** I recomputed the harness digest over the snapshot's `convex/`: `8c112d95e35b8cc6`, which matches the candidate row labelled `d84cb789+dirty`. The measured tree is therefore exactly 00504646's `convex/`. Load was 6.6–7.5, so this run's latencies are more credible than earlier runs': `recommend` 140 ms vs base 307 ms, inventory 54 vs 187 ms, occupancy 10 vs 89 ms.

## Changes since last audit

- **Insert-only change log replaces the per-warehouse generation bump.** Files: `convex/lib/finishedGoodsSummary.ts:150-191, 386-393`, `convex/finishedGoods/changeLog.ts`, `crons.ts:11-16`. **Verdict: correct for contention, risky for strict reset semantics.**
  - _Contention (measured, plus inferred):_
    - Writers now insert one marker and only read readiness, through `ensureSummaryReadiness`. They never patch it, which matches the 14 → 0 retry result.
    - `storageCatalogueSignals` is still read-modify-written, but only by layout-table writes (`finishedGoodsSummary.ts:369-385`). Placement writes are not layout writes.
  - _Token continuity (inferred):_
    - Both terms are monotone. The legacy generation only rises (summary backfill `restart`/`invalidate`, `staging/summaryBackfill.ts:27, 49`), and the newest row's `_creationTime` only rises, because prune always keeps the newest row. So the sum changes when either term changes, and a backfill restart still resets continuations (`cataloguePagination.ts:119`, `keysetScan.ts:381`).
    - Deploy transition: a warehouse with no markers yields `generation + 0`, so cursors issued by the old code stay valid until the first new write. A rollback makes new cursors mismatch, which resets them. Both are safe.
    - The cursor validators place no integer constraint on `generation`, so the fractional timestamp survives the JSON round-trip.
  - _Ordering gap (inferred):_ the old counter was serialized by OCC; the new token is not. See finding 3.
  - _Reactive scope (measured):_ unchanged in breadth. `take(1, "desc")` covers `[newest, +∞)`, so every new marker re-runs `catalogue:page`, `catalogue:summary`, `productSummary`, `pageProductBatches` and `pageLegacyUnits`. The fan-out table lists all of them for `reserve`, `cancel` and `createPallet`. `productSummary` never uses the token but still reads it (`catalogue.ts:526`).
  - _Prune safety (inferred):_
    - It deletes only rows strictly older than `min(cutoff, newest)` (`changeLog.ts:28-37`), so the token is never changed. Retention is irrelevant to correctness, because only the newest row matters.
    - It is bounded to 2,000 deletes per transaction and reschedules from the same warehouse index (`39-47`).
    - Its `.order("desc").first()` read (`20-26`) covers the head of every warehouse's log. Any finished-goods write anywhere therefore OCC-invalidates the whole prune transaction. Writers are never retried because of prune, since they do not read the log, but under global write load prune can starve. Reading only `.lt(cutoff)` in descending order and skipping the first row would keep the newest without touching the live head.
  - _Tests:_ `finished-goods-change-log.integration.test.ts` checks one marker per write, no readiness patch, a rising token, and prune keeping the newest. No test drives a catalogue continuation across a tracked write or across a summary-backfill restart. The existing `catalogue-pagination` reset test patches `generation` directly (`:445-473`).
- **Overflowed-zone handling.** Files: `zoneOccupancy.ts:73-106, 136-149, 185, 218-219, 301-303`, `storageLayouts/catalogue.ts:586-613`. **Verdict: correct, and it resolves my former finding 5.**
  - It is bounded and failure-free on writes. Pallet facts are no longer computed and then discarded.
  - Zone-scoped readers read overflowed zones directly (`zoneOccupancyEntries` returns `null`, `workflow.ts:626-653`).
  - The per-zone overflow branch in `derivedBuildingPlacements` (`catalogue.ts:591-612`) is effectively unreachable. The building-scope readiness check already refuses whenever `overflow` is set (`zoneOccupancy.ts:404`), so the branch only runs if a marker exists without the flag.
  - Residual: an overflowed zone never becomes complete again, even after it drains, and the `overflow` flag is sticky. See finding 5.
- **Two readiness scopes (`zoneOccupancy.ts:385-406`, `workflow.ts:1139` zone, `catalogue.ts:354, 576` building). Verdict: correct.**
  - Recommendations read held placements per zone through `by_orgId_zoneId_status` on both paths, so a cross-building placement does not change their output. The new test asserts parity and a lower recommend cost while blocked.
  - The building readers still fall back while blocked or overflowed.
- **Rollback guard (`summaryGeneration`; `zoneOccupancy.ts:365-383, 403`, `zoneOccupancyBackfill.ts:111-119`). Verdict: correct for its main case, with known gaps.**
  - Main (`80dc0a93`) bumps `generation` on every pallet, product, move or batch write (`git show 80dc0a93:convex/lib/finishedGoodsSummary.ts:313-343`). Rolling back to main and forward again therefore trips the guard.
  - Rolling back to iteration 2 also trips it. That is a false positive, but safe.
  - Gap: placement-only writes do not bump `generation` in main. `verify` and the mismatch reset (`workflow.ts:1675-1688`) are examples. Their changes to `verifiedAt` and `verificationMethod` would survive a rollback in the stored copies. The effect is display-only, because mutations re-validate authoritatively.
  - Cost: a summary-backfill restart or invalidate now also distrusts occupancy, and the slow path stays until the next hourly sweep. This is intended.
  - Test: "distrusts rows after writes by code that does not maintain them" checks fallback, sweep and recovery.
- **Stale flag and hourly sweep (`zoneOccupancyBackfill.ts:33-43, 76-119, 150-183`). Verdict: correct; this closes iteration-2 findings 4a and 4b, and most of 4c.**
  - An invalidation during a run sets `stale`. The final page then refuses `ready`, and only a restart clears the flag. A test covers this.
  - The sweep restarts every warehouse that is not ready, stale, at an old version, or generation-mismatched.
  - Residuals:
    - A second chain started while one is running (an hourly sweep or a manual restart) clears `stale` for the older chain. The older chain can then mark the warehouse ready before the newer chain has revisited zones it touched before the invalidation. The window is seconds wide; a run ID would close it.
    - The sweep never re-evaluates `blocked` or `overflow`, which are cleared only by a restart.
- **Skip-unchanged writes, and zone edits no longer refresh rows (`zoneOccupancy.ts:128-134, 179-209`; `finishedGoodsSummary.ts` dropped `storageZones` from `zones`). Verdict: correct, but the skip is weaker than intended.**
  - I checked every zone writer (`zones.ts`, `writes.ts`, `fg1Import.ts:406, 742, 923`, `pdImport.ts:404, 518`). None changes `buildingId` or `warehouseId`, and the restore paths verify the same building. The summaries derive footprint from placements, not zone geometry, so dropping zone edits is safe.
  - `sameFields` compares with `JSON.stringify`, which is key-order sensitive. Stored nested objects come back in the engine's own field order, while `palletFacts` (`39-58`) builds keys in insertion order. Entries rows with any freshly built pallet fact will therefore probably compare unequal and be rewritten anyway (inferred; `convex-test` may preserve insertion order and hide this). Behaviour stays correct, because the rewrite is idempotent.
- **e2e reset now clears the derived tables and the change log (`staging/e2eFixture.ts:348-351`). Verdict: correct.**
- **Harness. Verdict: improved.**
  - It now records each write's own cost: `reserve` 37 reads, 9 writes, 9.4 KB vs base 28/7/7.2; `cancel` 32/8 vs 23/6.
  - It adds the distinct-pallet contention probe, which is the right positive control for a warehouse-wide document.
  - It waits for follow-up log entries before counting them.
  - Open: `rebuildDerived` still swallows every error (`profile.mjs:54-74`) and ignores `buildingReady`. This run demonstrably used the derived paths, so the gap does not affect these numbers.
  - Open: `confirmScanAssignment` and a reserve-into-different-zones contention probe are still unmeasured.
- **Tests run.**
  - I ran `pnpm exec vitest run` on `finished-goods-change-log`, `storage-query-scale` and `catalogue-pagination` in `/Users/macbook/Development/industrial-sas-convex-perf`: 3 files, 42 tests passed.
  - That checkout is at 00504646, but it already has uncommitted next-iteration edits: job-scan search, `tenantDb.ts`, `tenantStorage.ts`, `schema.ts`, `crons.ts`, and an additive hook in `finishedGoodsSummary.ts`.
  - The files under review (`zoneOccupancy.ts`, `zoneOccupancyBackfill.ts`, `changeLog.ts`, both catalogues and `batches.ts`) are untouched there. So the pass is strong, but not exact, evidence for the snapshot.

## Findings (ranked by impact, max 10)

### 1. Put-away recommendation still reads, returns and re-runs for the whole warehouse (partially resolved; unchanged this iteration)

- **Location:** `convex/finishedGoods/workflow.ts:1090-1230` (`recommendations`) and `690-910` (`locationContext`). Callers: `PalletScreens.tsx`, `MoveScreen.tsx`, `DestinationPicker.tsx`.
- **Evidence:**
  - Measured: 687 docs, 1,284 KB read, 238.3 KB returned (base 2,887 docs, 1,818 KB).
  - Measured: a `reserve` re-runs `recommend` and `recommendMove` at 688 and 689 docs, about 1.28 MB each.
- **Cost mechanism:**
  - Each zone in an active building reads its positions, one location per position, and its entries row.
  - Any placement or held-pallet write anywhere in the warehouse rewrites an entries row that every recommend subscriber reads.
  - The payload is O(supports²) per zone.
- **Fix:**
  - (a) Serve `previewSupports`, `occupied` and `unavailable` from a per-zone detail query.
  - (b) Precompute per-zone surfaces (positions × locations), maintained by layout writes, so a call reads about 2 rows per zone.
  - (c) Rank candidates server-side, return the top N, and depend on a per-building occupancy version.
- **Expected impact and risk:**
  - About 10× fewer docs and bytes, and narrower re-runs.
  - (a) is low risk. (b) needs a layout-write hook and a backfill, like the occupancy one.

### 2. Job-scan text search scans the job-scan history (open)

- **Location:** `convex/finishedGoods/jobScans.ts:599-740`, `convex/lib/boundedRecordPage.ts`.
- **Evidence:** Measured: 2,389 docs and 1,541 KB over 22 requests, unchanged. This is the largest remaining read in the profile.
- **Fix:**
  - Add a normalized `searchText` field and a `searchIndex` filtered by org, warehouse and mapped status.
  - Re-verify hits with `jobScanTextMatches`.
  - Keep the bounded scan for short or Thai terms.
  - Backfill existing rows. Work on this is visibly in progress outside the snapshot, so it is not credited here.

### 3. The change-log token can miss a late-committing write, and every catalogue query still depends on it (new risk, plus the remainder of old finding 2)

- **Location:** `convex/lib/finishedGoodsSummary.ts:178-191, 386-393`; readers `finishedGoods/catalogue.ts:52-71, 382, 526, 542`, `finishedGoods/batches.ts:454, 504`.
- **Evidence:**
  - _Ordering (inferred):_ `_creationTime` is assigned when `insert` runs; a mutation can read it back before commit. It is not the commit timestamp. Suppose write A begins, write B begins later and commits first, a page request reads B's marker, and then A commits. A's marker sorts below B's, so `take(1, "desc")` still returns B and the continuation is accepted although A changed the data. A and B do not conflict (neither reads the log), so this ordering is allowed. The old counter was read-modify-written, so OCC serialized it and this could not happen.
  - _Reactive (measured):_ `productSummary` (13 docs), `pageProductBatches` (11), `pageLegacyUnits` (32), `catalogue:summary` (11) and `catalogue:page`×3 (253) re-run on `reserve`, `cancel` and `createPallet`, as before.
- **Cost mechanism:**
  - The ordering gap causes a rare, transient duplicate or skipped row in a progressive scan. That is the same bug class the generation existed to prevent.
  - Each finished-goods write re-runs about 7 catalogue queries per open screen.
- **Fix:**
  - Make the token robust without a shared write. For example, `(newest._creationTime, count of markers with _creationTime ≥ newest − W)`, where W exceeds the maximum mutation duration (about 2 s). A late marker then raises the count.
  - Verify the ordering behaviour with a two-writer test against the real backend.
  - Let `productSummary` and `readProductSummary` callers read raw readiness instead of the token. Readiness is now stable, so they would stop re-running on unrelated writes.
  - Scope the batch and legacy-unit tokens per product, for example markers carrying `productId`.
- **Expected impact and risk:**
  - Restores the exact reset guarantee at the cost of a small bounded read.
  - The `productSummary` change is trivial and removes one re-run per screen per write.

### 4. Job-scan location picker search joins every location row (open)

- **Location:** `convex/finishedGoods/jobScanLocations.ts:663-757`.
- **Evidence:** Measured: 896 docs and 474 KB over 2 requests to return 0.8 KB, unchanged.
- **Fix:** denormalize the position/zone label and `buildingId` onto `locations` and filter within the row, or add a search index. Needs a backfill.

### 5. Derived-occupancy readiness: sticky degradations and concurrent chains (partially resolved from old finding 4)

- **Location:** `convex/storageLayouts/zoneOccupancyBackfill.ts:76-119, 154-183`; `convex/lib/zoneOccupancy.ts:182-184, 301-303, 351-363`.
- **Evidence (inferred):**
  - Resolved: rollback then roll-forward (generation guard), invalidation mid-run (`stale`), and automatic rollout (hourly sweep). Tests cover all three.
  - Open (a): `overflow` and `blocked` are set once and cleared only by a restart. The sweep skips ready warehouses, so it never clears them. One transient 501-placement zone, or one repaired cross-building placement, sends `buildingOccupancy` (21 → 917 docs) and inventory (35 → 1,829 docs) back to the slow path for that warehouse indefinitely. The overflowed zone's own marker also never returns to exact rows.
  - Open (b): two concurrent chains (sweep plus manual restart, or two sweeps on a slow chain) share one `stale` flag, so the older chain can finish "ready" over zones the invalidation affected.
  - Open (c): placement-only writes by pre-change code (`verify`) escape the rollback guard (display-only).
- **Fix:**
  - Have the sweep restart warehouses that are `overflow` or `blocked` daily. Alternatively, on writes that remove placements from an overflowed zone, re-probe with the now-bounded `heldPlacementsOfZone`.
  - Store a `runId` on readiness at restart, pass it through `chain`, and finish only when it matches.
  - Expose `ready`, `buildingReady` and the flags in an admin health query.
- **Expected impact and risk:** keeps the measured savings in production after real-world edge events. The changes are small and low risk.

### 6. Building inventory: few documents, but still a whole-building payload (partially resolved)

- **Location:** `convex/storageLayouts/catalogue.ts:571-660`.
- **Evidence:** Measured: 35 docs (was 1,829), but 964 KB read and 447.8 KB returned for one building.
- **Cost mechanism:** any placement write in the building re-runs the query and re-reads every held zone's entries row.
- **Fix:** add a per-floor inventory query for the floor editor and review screens, and project the copies (finding 7).

### 7. Entries rows store full placement documents; the skip-unchanged check is order-sensitive (partially resolved)

- **Location:** `convex/lib/zoneOccupancy.ts:39-58, 128-134, 159-210`, `convex/schema.ts:1044-1075`.
- **Evidence:**
  - Measured: bytes still fall much less than docs (`recommend` 1,818 → 1,284 KB; reserve fan-out 3,808 → 2,742 KB). The `reserve` write rose from 7.2 to 9.4 KB.
  - Inferred: the copies still carry audit, QR and identity fields that readers never use. `sameFields` uses `JSON.stringify` on nested values, so a row whose pallet facts were rebuilt by `palletFacts` (insertion order) probably never equals the stored row (engine field order). Pallet-only edits of held pallets therefore still rewrite the entries row.
  - Resolved: zone geometry edits no longer touch the rows.
- **Fix:**
  - Compare with a canonical, key-sorted serialization.
  - Store only the placement fields that readers and `scope.placement` use.
- **Expected impact and risk:** read and write bytes fall roughly in half, and needless building-list and inventory re-runs go away. The risk is low, because the parity tests cover the output.

### 8. HR roster fails above 50 employees (open)

- **Location:** `convex/hr/roster.ts:301-356`, `convex/model/hr/roster.ts:53`.
- **Evidence:** Measured: 162 docs, then `LIMIT_EXCEEDED` at 153 employees. The parallel paging change is not in this snapshot.
- **Fix:** paginate employees with a native cursor, filter during the scan, and read days per page.

### 9. A per-warehouse sequence document serializes pallet creation (new; I missed this before)

- **Location:** `convex/finishedGoods/workflow.ts:110-133` (`nextCode`), `schema.ts:1284-1290`.
- **Evidence:**
  - Measured: 8 concurrent `createPallet` calls still take 21 executions with 13 retries in both columns, RTT p50 243 ms. The retries are now reported on `finishedGoodsCounters`.
  - In iteration 2 I attributed all of them to the readiness row. That row masked the counter, which the base column now shows too.
  - Pallet and position sequences share the same document.
- **Cost mechanism:** pallet creations within a warehouse are fully serialized, and position creation conflicts with them.
- **Fix:**
  - Split `palletSequence` and `positionSequence` into separate rows. That costs nothing.
  - If concurrent receiving grows, allocate code blocks per session or shard, provided strictly gap-free codes are not a business requirement.
- **Expected impact and risk:** the impact is low at current receiving rates. Codes are user-visible, so confirm the numbering requirement first.

### 10. Expensive whole-warehouse legacy endpoints are still public (open)

- **Evidence:**
  - Measured: `getStorageBuilding` 1,844 docs, `workflow:list` 1,440 docs, `getStorageLocationMap` 936 docs, all unchanged.
  - Inferred: none has a live subscriber.
- **Fix:** retire them, or rebuild them on the split and derived queries.

## Already good (brief)

- The warehouse-wide hot document is removed from all finished-goods writes (measured: 14 → 0 retries for distinct pallets). The token stays compatible with old cursors across the deploy.
- Overflow handling is bounded and failure-free (former finding 5 resolved). Rebuilds read at most cap+1 rows per status, writes skip overflowed zones, and an at-cap entries row is pinned below 600 KB by a test.
- Readiness hardening behaves as described: two scopes, the stale flag, the rollback guard and the hourly sweep. Each has a parity or recovery test, and the tests pass.
- Prune is safe for tokens (the newest row is always kept), bounded, and never causes user-write retries.
- Derived occupancy is transactional and tenant-registered, mutations keep authoritative validation, and building occupancy stays at 21 docs.
- Job-scan writes stay O(items) with 0 retries under 8 concurrent writers (measured).

## What would raise the score to 9+

- Make recommendation O(displayed): a detail query for the preview payload, precomputed per-zone surfaces, and server-side top-N (finding 1). Project the entries copies and compare them canonically (finding 7).
- Index-backed job-scan and picker search (findings 2 and 4), plus roster paging (finding 8). These are the remaining O(history) and limit-failure paths that hold the score in the 5–6 band.
- Restore an exact, contention-free continuation token, and drop the token dependency from queries that do not use it (finding 3). Prove it with a two-writer late-commit test and a reserve-into-different-zones contention probe showing 0 retries.
- Make degraded readiness self-healing: periodic re-evaluation of `overflow`/`blocked`, a run ID on chains, and a health view (finding 5).
- Profile `confirmScanAssignment`, and rerun on a fixture about 5× larger with a bulk LOCATION_ONLY zone above 500 entries, to show the overflow path's measured cost.
