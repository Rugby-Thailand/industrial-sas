## Score: 6/10

- **Three storage views changed cost class (measured, candidate vs base on identical data).**
  - `recommend` dropped from 2,886 to 686 docs and `recommendMove` from 2,887 to 687 docs.
  - `getStorageBuildingInventory` dropped from 1,829 to 34 docs, and `buildingOccupancy` from 917 to 20 docs (819 KB to 8.1 KB read).
  - Return bytes are identical in both columns (244,011 / 244,251 / 458,594 / 978 B).
  - No other query changed its doc or byte count.
- **Placement-write fan-out fell by 72% in documents but only 28% in bytes (measured).** One `reserve` now re-reads 1,692 docs and 2,737 KB (base: 6,092 docs and 3,805 KB). `recommend` and `recommendMove` still account for 1,375 of those docs and about 2,570 KB. Every placement write anywhere in the warehouse still re-runs every open put-away and move screen, and each still returns 238 KB.
- **Contention is now measured, and it confirms the per-warehouse hot document (measured).** 8 truly concurrent `createPallet` calls took 21 executions with 13 OCC retries, all on `finishedGoodsSummaryReadiness`. Base showed 22 executions and 14 retries. RTT p50 was 197 ms, against 33 ms for `saveJobScans`. Every FG mutation, including `reserve`, bumps that document.
- **The heavy non-storage paths are untouched (measured).**
  - Job-scan search reads 2,389 docs over 22 requests, and grows with history.
  - The picker `searchPage` reads 896 docs to return 0.8 KB.
  - `hr/roster:roster` still returns `LIMIT_EXCEEDED`. The parallel paging work is not in this snapshot.
  - These keep the score out of the 7–8 band.
- **The derived-occupancy change is correct on every tenant write path I could find (inferred).** It is transactional and mutations still authorize with authoritative reads. Its weak points are operational:
  - Readiness is a sticky flag that nothing re-validates after a code rollback.
  - Zones above the 500-entry cap have an O(held) write cliff.
  - Full-document copies keep the byte savings small.
- **The measured code is the audited code (verified).** I recomputed the harness digest of the snapshot's `convex/`: `d2f9e425256dc7eb`, which matches the candidate row. `4352b15b..011ccd35` changes no code.

## Changes since last audit

- **Derived per-zone occupancy, maintained in `trackFinishedGoodsWrites().flush()` (`convex/lib/zoneOccupancy.ts`, `convex/lib/finishedGoodsSummary.ts:253-265, 326`). Verdict: correct, with the operational risks in findings 4, 5 and 8.**
  - _Write-path coverage (inferred):_
    - Every public mutation runs through `mutationWithOrg`, which sets `audit = true` (`convex/lib/tenantFunctions.ts:874-886`), so the handler's `tenantDb` is the tracked wrapper (`tenantFunctions.ts:488-492`).
    - Handlers never see a raw `ctx.db`. Outside that wrapper, I found only these direct tenant-db constructions: the backfill itself, `operations/temporaryRetention` (expiry tables only), `operations/duplicateAudit` (read-only), `staging/summaryBackfill` (product summaries), `staging/locationBuildingBackfill` (`locations` only) and `hr/announcementSchedule`.
    - Raw `ctx.db` placement writers exist only in staging seeds, and each now calls `invalidateZoneOccupancy` (`staging/annexDemo.ts:833, 1212`, `staging/storageLayoutUiDemo.ts:14`). `staging/paginationDemo.ts` inserts unplaced pallets only.
    - Zones, placements and pallets are never deleted anywhere outside staging. The only storage deletes are floors and reserved blocks (`storageLayouts/writes.ts:1347-1348`), and floor delete requires the floor to have no zones (`writes.ts:1293-1298`). So orphan rows cannot carry held placements.
    - Covered paths: `reserve`/`verify`/`confirm`/`cancel`, moves (both zones), the LOCATION_ONLY `confirmScanAssignment` (`finishedGoods/scanning.ts:295-430`, through `ctx.tenantDb.insert/patch`), pallet-only edits, and zone edits.
  - _Incremental maths (inferred):_
    - `note` captures the zone before and after each placement patch or replace, before a delete and after an insert (`finishedGoodsSummary.ts:257-264, 306-319`).
    - `refreshZoneOccupancy` drops every touched placement from the stored copy, adds back the current held version of each placement whose `zoneId` matches, and re-derives pallet facts for touched pallets through `by_orgId_palletId_status` (`zoneOccupancy.ts:213-285`).
    - A missing, incomplete or old-version row forces a rebuild from the authoritative ranges (`247-262`), so first touch before the backfill is safe.
  - _Ordering parity (inferred):_
    - `indexOrder` (status, then `_creationTime`; `zoneOccupancy.ts:62-64`) reproduces `by_orgId_zoneId_status` per status. The `held`/`stored` split preserves it (`workflow.ts:626-639`).
    - The building merge (`catalogue.ts:592-598`) reproduces `by_orgId_buildingId_status`, which the old code read as RESERVED then STORED.
    - The old cross-building recommend-order gap is now guarded (`storage-query-scale.integration.test.ts:1002`).
  - _Fact coverage (inferred):_ the readers use these pallet fields: `code`, `quantity`, `productId`, `warehouseId`, `retiredAt`, `status`, `placementId`, `storageFormat`, `stackable` and `maxStackLevels` (`workflow.ts:881-887, 2596-2650`; `catalogue.ts:111-160`). All of them are in `palletFacts` (`zoneOccupancy.ts:32-52`), and the narrowed `OccupancyPallet` type makes any other field a compile error.
  - _Fallbacks (inferred):_
    - The readers check readiness, the `blocked` flag and the version (`zoneOccupancy.ts:311-321`).
    - An incomplete zone falls back per zone in recommend (`341`) and for the whole building in inventory (`catalogue.ts:582, 589`).
    - Building occupancy uses summaries even for incomplete zones. That is correct, because `summarize` always sees the full list (`zoneOccupancy.ts:124-131`).
    - A cross-building placement sets `blocked` from both the backfill and any tracked write (`136`, `302-309`).
  - _Authorization and tenancy (inferred):_ the tables are registered in `TENANT_TABLES` (`schemaPolicy.ts:40-42`). Every read and write goes through org-prefixed indexes. Mutations still build their location scope without derived rows (`workflow.ts:707`, default `useZoneOccupancy = false`), so derived rows never authorize a placement.
  - _Reactive scope (inferred):_
    - Recommend now depends on the readiness row plus one entries row per zone, instead of 2 ranges per zone plus pallets. Its breadth is unchanged.
    - `buildingOccupancy` now also re-runs when a held pallet changes without any placement change (for example `saveStackingLimits`), because `write` always replaces the summary. That is cheap at 20 docs, but it is a new dependency.
  - _OCC (inferred, partly measured):_
    - The zone rows add read-modify-write documents per zone.
    - Same-zone placement writes already conflicted through the zone's placement range.
    - Every FG mutation already conflicts warehouse-wide on `finishedGoodsSummaryReadiness` (`finishedGoodsSummary.ts:345-358`; 13/14 retries measured in both columns).
    - So in practice the new rows add no contention. Only pallet-only edits on held pallets newly conflict with same-zone reserves, and they already collide on the readiness document.
  - _Write cost (inferred, unmeasured):_
    - A `reserve` adds about 6 reads (placement gets in `note`, the pallet plus 2 hold ranges, the zone, and 2 row lookups) and 2 replaces.
    - `confirmScanAssignment` with N units adds about 4N reads and 2 replaces.
    - The entries replace rewrites the whole zone's copies; see finding 8.
    - Only `saveMeasurement` is measured: 21 to 22 reads, 5 writes in both columns. That fits one extra pallet get for an unplaced pallet.
  - _Measured effect:_ see the score bullets. Exec p50 times are indicative: `recommend` 1,129 to 407 ms, inventory 222 to 61 ms, occupancy 96 to 11 ms.
- **Backfill (`storageLayouts/zoneOccupancyBackfill.ts`). Verdict: correct for the documented flow, with gaps in finding 4.** It is resumable, tenant-derived and bounded to batches of 1–50. The `restart` call clears `blocked`, and readiness is set only when no zone is blocked (`92-101`).
- **Tests (`tests/integration/storage-query-scale.integration.test.ts:806-1059`). Verdict: strong parity design, with gaps.**
  - Strengths:
    - The same snapshot is read authoritative-then-derived, and the test asserts equal values. It does this after the backfill and after `reserve`, `verify`, `confirm`, `cancel`, `saveStackingLimits` and a full two-zone move.
    - The overflow fallback and backfill blocking are tested, and so is the cross-building order I asked for.
  - Gaps:
    - (a) No tracked `confirmScanAssignment` parity test. LOCATION_ONLY placements are only raw-inserted before the backfill (`814`).
    - (b) No tracked write into an overflowed zone, which is the rebuild-on-every-write path.
    - (c) No test that a tracked write creating a building mismatch sets `blocked`.
    - (d) No read/write budget for the mutations themselves.
  - I did not run them. The snapshot has no `node_modules`. `/Users/macbook/Development/industrial-sas-convex-perf` has diverged since launch: it has uncommitted edits to `convex/lib/finishedGoodsSummary.ts`, `schema.ts`, `finishedGoods/catalogue.ts` and others, plus a new `finishedGoods/changeLog.ts`. A run there would not test this snapshot.
- **Harness. Verdict: fixed.**
  - `contend()` now uses one client per worker and records `overlapping` (`profile.mjs:531-546`). The positive control is in effect the 13 retries on `createPallet`.
  - Candidate and base carry content digests, refusals fail flows, and fan-out counts client follow-up chains.
  - Residual problem 1: `rebuildDerived` swallows every error as "target predates derived occupancy" (`profile.mjs:54-74`). A broken candidate backfill would silently profile the fallback path. This run clearly used the derived path.
  - Residual problem 2: write-flow profiling still omits `reserve`, `confirm` and `confirmScanAssignment`, so the write amplification is unmeasured.

## Findings (ranked by impact, max 10)

### 1. Put-away recommendation still reads, returns and re-runs for the whole warehouse (partially resolved)

- **Location:** `convex/finishedGoods/workflow.ts:1090-1230` (`recommendations`), `690-910` (`locationContext`). Callers: `PalletScreens.tsx`, `MoveScreen.tsx`, `DestinationPicker.tsx`.
- **Evidence:**
  - Measured: 686 docs / 1,283 KB read / 238.3 KB returned (base 2,886 / 1,818 KB). The reserve fan-out re-ran `recommend` and `recommendMove` at 687 and 688 docs, about 1.28 MB each.
  - Inferred: each zone in an active building still reads its positions, one location per position, and its entries row. The entries row carries full placement copies.
- **Cost mechanism:** reads still grow with zones in active buildings. Every placement or held-pallet write anywhere in the warehouse rewrites one entries row that every recommend subscriber reads. The payload stays O(supports²) per zone.
- **Fix:**
  - (a) Serve `previewSupports`, `occupied` and `unavailable` from a per-zone detail query (no behaviour change; removes most of the 238 KB).
  - (b) Precompute per-zone surfaces (positions × locations), maintained by layout writes, so a call reads about 2 rows per zone.
  - (c) To narrow re-runs, give subscribers a per-building occupancy version and evaluate zones lazily, or rank candidates server-side and return the top N.
- **Expected impact and risk:**
  - (a) is low risk.
  - (b) needs a layout-write hook and a backfill, similar to this iteration's.

### 2. Per-warehouse hot documents serialize all FG writes and re-run the catalogue (open; contention now measured)

- **Location:** `convex/lib/finishedGoodsSummary.ts:266-289, 345-358`. Readers: `convex/finishedGoods/catalogue.ts`.
- **Evidence:**
  - Measured: 8 concurrent `createPallet` calls took 21 executions with 13 OCC retries, all on `finishedGoodsSummaryReadiness` (base: 22 executions, 14 retries).
  - Measured: `reserve`, `cancelReservation` and `createPallet` each re-run `catalogue:page`×3 (244–246 docs) plus `catalogue:summary`, followed by 1–2 client follow-up requests (210–272 docs).
- **Cost mechanism:** every pallet, product, move or batch write bumps `generation` on one document per warehouse. This serializes all finished-goods mutations, including reserves into unrelated zones, and invalidates every catalogue subscription.
- **Fix:**
  - Move change detection to an insert-only change log, or per-product shards.
  - Remove `generation` from settled page cursors.
  - Shard warehouse totals.
- **Expected impact and risk:** removes the measured retries and the catalogue re-runs. The risk is in the reconcile and backfill of the sharded totals.

### 3. Job-scan text search scans the job-scan history (open)

- **Location:** `convex/finishedGoods/jobScans.ts:599-740`, `convex/lib/boundedRecordPage.ts`.
- **Evidence:** Measured: 2,389 docs / 1,541 KB over 22 requests, unchanged.
- **Cost mechanism:** O(history) docs and about 22 round trips per settled search.
- **Fix:**
  - Add a normalized `searchText` field with a `searchIndex` filtered by org, warehouse and mapped status.
  - Re-verify hits with `jobScanTextMatches`.
  - Keep the bounded scan for short or Thai terms.
  - Backfill existing rows.

### 4. Derived-occupancy readiness is a sticky trust flag with no liveness check (new)

- **Location:** `convex/lib/zoneOccupancy.ts:288-321`, `convex/storageLayouts/zoneOccupancyBackfill.ts:30-39, 66-101`, `docs/operations/storage-zone-occupancy.md:45-46`.
- **Evidence (inferred):**
  - _Rollback then roll-forward:_ the runbook says "Rolling back code is safe: older readers ignore the derived tables". But older code also does not maintain the derived rows, and it leaves `ready: true` in place. Rolling forward again makes readers trust rows that missed every write made during the rollback. The version check does not help, because the version is unchanged.
  - _Invalidation during a backfill:_ `invalidateZoneOccupancy` only flips `ready`, and `run` with an old `cursor` sets `ready: true` on its last page. A raw write in the middle of a backfill can therefore be marked ready over zones that were already visited.
  - _Rollout:_ new warehouses and fresh deployments stay on the slow path until an operator runs the backfill per warehouse. `blocked` is cleared only by a manual restart, and nothing schedules or reports either state.
- **Cost mechanism:** stale rows would show wrong occupancy and recommend spaces that are already held. Mutations re-validate with authoritative reads, so stored data stays correct, but users see refusals. The silent fallback hands the whole saving back without any signal.
- **Fix:**
  - Store a writer epoch, such as a deploy or code version, on readiness, and require it to match `ZONE_OCCUPANCY_VERSION` plus a build marker. Alternatively, have the runbook require `invalidate` plus `restart` after any rollback.
  - Give the backfill a run ID, and reject cursors from a run started before the last invalidation.
  - Schedule a per-warehouse backfill and reconcile (cron or on warehouse creation), and expose `ready`/`blocked` in an admin health view.
  - Add a periodic reconcile that diffs a few zones against the authoritative ranges.
- **Expected impact and risk:** closes the only path to stale reads, and makes the saving dependable in production. The changes are small.

### 5. Overflowed zones make every write O(held), and above 10,000 placements every write fails (new)

- **Location:** `convex/lib/zoneOccupancy.ts:76-92, 124-145, 163-193, 247-262`.
- **Evidence (inferred):**
  - When `entries.complete` is false (more than 500 held placements), every tracked write that touches the zone takes the rebuild path. That path reads all held placements (`.all(10_000)`) and runs `factsFor` with one pallet `get` per placement. `write` then discards those facts, because `kept = []` (`137-145`).
  - Above 10,000 held placements in one zone, `.all` throws `CAPACITY_DATA_LIMIT` (`convex/lib/tenantDb.ts:735-736`). From then on, every `reserve`, `confirmScanAssignment` or pallet edit touching that zone fails.
  - Before this change, `confirmScanAssignment` read only the zone's RESERVED range (`finishedGoods/scanning.ts:346-355`), so for bulk LOCATION_ONLY zones this is a new cost and a new failure mode. The fixture has no such zone (about 3 placements per zone), so the profile cannot show it.
- **Fix:**
  - Skip `factsFor` when the zone is incomplete.
  - For incomplete zones, maintain `held` and `unmeasured` incrementally and recompute only the geometric footprint. LOCATION_ONLY placements do not affect it, so read only the geometric placements.
  - Alternatively, chunk entries into several rows per zone instead of capping at 500.
  - Add a test that runs a tracked write into an overflowed zone.
- **Expected impact and risk:** removes an O(held) cost per write and a hard failure on large bulk zones. The risk is low.

### 6. Job-scan location picker search joins every location row (open)

- **Location:** `convex/finishedGoods/jobScanLocations.ts:663-757`.
- **Evidence:** Measured: 896 docs / 474 KB over 2 requests to return 0.8 KB, unchanged.
- **Fix:** copy the position/zone label and `buildingId` onto `locations` and filter within the row, or add a search index. Needs a backfill.

### 7. Building inventory: few documents, but still a whole-building payload (partially resolved)

- **Location:** `convex/storageLayouts/catalogue.ts:571-660`.
- **Evidence:** Measured: 34 docs (was 1,829), but 963.6 KB read (base 1,317 KB) and 447.8 KB returned for one building.
- **Cost mechanism:** the screen still loads every held placement in the building. Any placement write in any zone of the building re-runs it and re-reads every held zone's entries row.
- **Fix:** add a per-floor inventory query for the floor editor and review screens, and project the placement copies (see finding 8).

### 8. Entries rows store full placement documents and are rewritten even when nothing changed (new)

- **Location:** `convex/lib/zoneOccupancy.ts:114-161`, `convex/schema.ts:120-130, 1037-1066`.
- **Evidence:**
  - Measured: docs fell 72–98% but bytes much less: `recommend` read 1,818 to 1,283 KB, inventory 1,317 to 964 KB, and reserve fan-out 3,805 to 2,737 KB.
  - Inferred: each copy carries the audit and identity fields readers never use (`createdByUserId`, `updatedByUserId`, `verifiedByUserId`, `qrValue`, `locationId`, `floorId` and others). `write` replaces both rows unconditionally, including on pallet-only edits that leave the facts unchanged, on move start, and on zone geometry edits (`fg1Import`/`pdImport` patch hundreds of zones).
- **Cost mechanism:** O(zone held) write bytes per placement write. In a 500-entry zone that is a few hundred KB per reserve (inferred). There are also needless invalidations of the building list and inventory.
- **Fix:**
  - Store only the fields readers use, or keep exact copies only for the fields `scope.placement` needs.
  - Skip `replace` when the new summary or entries are deep-equal to the existing ones.
  - Stop treating zone writes that cannot change `buildingId`/`warehouseId` as occupancy changes.
- **Expected impact and risk:** read and write bytes fall roughly in half. The risk is low, because the parity tests cover the output.

### 9. HR roster fails above 50 employees (open)

- **Location:** `convex/hr/roster.ts:301-356`, `convex/model/hr/roster.ts:53`.
- **Evidence:** Measured: 162 docs, then `LIMIT_EXCEEDED` at 153 employees. The parallel paging change is not in this snapshot.
- **Fix:** paginate employees with a native cursor, filter during the scan, and read days per page.

### 10. Expensive whole-warehouse legacy endpoints are still public (open)

- **Evidence:**
  - Measured: `getStorageBuilding` 1,844 docs (it still uses the authoritative per-zone ranges), `workflow:list` 1,440 docs, `getStorageLocationMap` 936 docs, all unchanged.
  - Inferred: none has a live subscriber.
- **Fix:** retire them, or rebuild them on the split and derived queries.

## Already good (brief)

- The derived-occupancy design is sound:
  - Maintenance is in the same transaction as the source writes.
  - Readers opt in only when the warehouse is ready, and fall back per zone or per building.
  - Mutations keep authoritative validation.
  - The tables are tenant-registered and use org-prefixed indexes.
  - Output is byte-identical in size (measured), and the parity tests compare the same snapshot both ways.
- Building occupancy (former finding 4) is resolved: 917 to 20 docs and 8.1 KB read (measured).
- The contention probe (former finding 9) is fixed: real concurrent writers, an overlap check, OCC detail by document, and content digests that match the audited source.
- The tenant wrapper keeps its guarantees: only org-prefixed index reads, `.all()` fails instead of truncating, and progressive scans are bounded per request.
- Job-scan writes stay O(items): 10 reads and 53 writes for 50 items, with 0 OCC retries under 8 concurrent writers (measured).

## What would raise the score to 9+

- Remove the per-warehouse read-modify-write documents from every FG mutation and from the catalogue's reactive path. Then prove it with the now-working contention probe: 0 retries for concurrent `createPallet` and for `reserve` into different zones (finding 2).
- Make recommendation O(displayed): a detail query for the preview payload, precomputed per-zone surfaces, and narrower re-runs (finding 1). Project and deduplicate the entries writes (finding 8).
- Make derived occupancy operationally safe: an epoch or liveness check on readiness, a scheduled backfill and reconcile, and no O(held) overflow cliff (findings 4 and 5). Add tracked-write parity tests for `confirmScanAssignment`, for an overflowed zone and for a mismatch-created block.
- Index-backed search for job scans and picker locations (findings 3 and 6). Paginate the roster (finding 9) and retire the legacy endpoints (finding 10).
- Profile the placement mutations' own read and write cost, and repeat the run on a fixture about 5× larger that includes a bulk LOCATION_ONLY zone above 500 entries.
