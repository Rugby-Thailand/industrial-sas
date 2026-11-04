<!-- Claude Opus 5.5 (Agent tool, general-purpose, model=opus), iteration 0, audited main@80dc0a93 read-only. Saved verbatim by the parent. -->

## Score: 5/10

- **Several hot screens read thousands of documents per call, and the count grows with warehouse size or history (measured).** Put-away recommendation: `recommendMove` 2,887 docs / 1.8 MB and `recommend` 2,886 docs, each returning about 238 KB. Job-scan search: `listJobScans` 2,389 docs across 22 chained requests. Storage building screen: `getStorageBuildingInventory` 1,829 docs. Storage building list: `buildingOccupancy` reads 917 docs to return 1.0 KB. Job-scan location picker: `searchPage` reads 896 docs to return 0.8 KB.
- **Broad reactive scope (inferred from code).** `recommend` subscribes to the placements of every zone in the warehouse, so any put-away anywhere re-runs it on every open store/move screen. Every finished-goods (FG) write bumps one per-warehouse document (`finishedGoodsSummaryReadiness.generation`), and every catalogue query reads that document. So unrelated writes re-run catalogue pages, restart the summary scan, and send paged sorted views back to page 1.
- **Hot shared-document writes (inferred, not measured).** All FG mutations in a warehouse read and write the same readiness document, and pallet creation and reservations share one counter document. The measured contention test (8 concurrent `saveJobScans`, 0 OCC retries) does not cover this: job-scan saves write neither document.
- **Limit failure on an HR flow (measured).** `hr/roster:roster` reads 162 docs and then returns `LIMIT_EXCEEDED` for a site with 153 employees. The cap is 50 and is checked before the search and department filters, so filtering cannot get a large site under it.
- **Good foundation (inferred + measured).** The tenant wrapper only allows org-prefixed index reads and caps pages at 100 rows. Progressive scans are bounded per request. Job-scan writes cost O(items) (10 reads, 53 writes for 50 items) with 0 OCC retries. Shell and most HR queries read 8–30 docs.
- **Fan-out evidence is thin.** The `saveMeasurement` probe hit a stored pallet, which the code refuses (`RELEASE_RESERVATION_FIRST`, `convex/finishedGoods/workflow.ts:520-521`). It wrote only 2 audit docs, so no measured fan-out covers a real pallet or placement write. The base backend's 23 HR re-runs (85 s total exec time) are load noise.

## Findings (ranked by impact, max 10)

### 1. Put-away recommendation evaluates every zone, and returns and re-runs for the whole warehouse

- **Location:** `convex/finishedGoods/workflow.ts:1021-1140` (`recommendations`), `1142-1167` (`recommend`, `recommendMove`); per-zone reads at `650-681`, `739`, `812`; per-support checks at `1064-1073` → `2433-2482`. Callers (both reactive `useQuery`): `src/features/finishedGoods/PalletScreens.tsx:598-601` and `src/features/finishedGoods/MoveScreen.tsx:177-180`. The client filters and paginates the whole list locally (`src/features/finishedGoods/DestinationPicker.tsx:71-78`).
- **Evidence:** Measured: `recommendMove` 2,887 docs / 1,818.6 KB read / 238.5 KB returned / 357 ms; `recommend` 2,886 docs / 238.3 KB returned. Inferred: it reads all 421 zones (`1034-1039`). For each zone not skipped as mismatched, it reads 3 ranges (active positions, RESERVED and STORED placements), the location for each position and the pallet for each stored placement. For every pallet support, `validateStack` repeats the checks on the pallet being placed (product read plus 2 `stackChildren` ranges, `2439-2440`), then reads the parent pallet, its product, its active moves (2 ranges), its children (2 ranges) and its current placement. Every candidate carries copies of its zone's `occupied`, `unavailable` and the full `previewSupports` array (`947-960`, `1018`, `1106`, `1118`), so the payload is O(supports²) per zone.
- **Cost mechanism:** reads grow with zones × held placements, plus about 7 reads per pallet that could support a stack. The read set covers every RESERVED/STORED placement range in the warehouse, so any reserve, confirm, move or cancel anywhere re-runs it for every open store/move screen (~2.9k docs plus ~238 KB per subscriber).
- **Fix:** (a) No behaviour change: compute the placed pallet's own stack checks once per request instead of once per support; memoize product, pallet and `stackChildren` reads per request. (b) No behaviour change: drop `occupied`, `unavailable` and `previewSupports` from list rows and serve them from a per-zone detail query that only the selected candidate subscribes to. (c) Structural: keep a per-zone occupancy record, rebuilt in `trackFinishedGoodsWrites.flush()` (`convex/lib/finishedGoodsSummary.ts:247-347`) for every zone whose placements or held pallets change; recommend then reads one record per zone. Needs a new tenant table registered in `convex/lib/schemaPolicy.ts`, a resumable backfill and readiness flag like `backfillProductSummaries`; readers keep the current path until ready. `reserve`/`confirm` already re-validate (`workflow.ts:1383-1415`).
- **Expected impact and risk:** (a)+(b) cut most of the 238 KB payload and the repeated stack reads, low risk. (c) replaces ~2 reads per held placement with 1 read per zone. Risk: projection drift; recompute from authoritative ranges in the same mutation, add a reconcile job, diff old/new outputs in tests.

### 2. Job-scan text search scans the entire job-scan history

- **Location:** `convex/finishedGoods/jobScans.ts:599-740` (`accept` at `699-709`), `convex/lib/boundedRecordPage.ts:77, 236-254`; caller `src/features/finishedGoods/jobScan/JobScanRecords.tsx:131-145`.
- **Evidence:** Measured: 2,389 docs / 1,541 KB over 22 requests vs 60 docs unfiltered. Inferred: each request inspects ≤100 index rows; sparse matches walk all history; non-matching rows also cost a building read.
- **Cost mechanism:** O(history) docs and ~22 round trips per settled search; grows without bound.
- **Fix:** normalized `searchText` (7 fields + building name; suffixes of 3+ chars for codes), Convex `searchIndex` filtered by `orgId`/`warehouseId`/`mapped` via a tenant-scoped search read; re-verify hits with `jobScanTextMatches`; keep bounded scan fallback for short/Thai needles; backfill.
- **Expected impact and risk:** typical code/barcode searches become one request ~O(pageSize). Search results are relevance-ordered and capped: re-sort by `createdAt`, fall back when capped.

### 3. Per-warehouse hot documents written by every FG mutation and read by every catalogue query

- **Location:** `convex/lib/finishedGoodsSummary.ts:251-262, 331-345`; `convex/lib/tenantFunctions.ts:489-492, 540`; readers `convex/finishedGoods/catalogue.ts:52-60, 371, 402, 411, 447, 515, 531, 548-552, 564-571`, `convex/finishedGoods/batches.ts:451-452, 498-499`; cursor resets `convex/lib/cataloguePagination.ts:113, 119`; client `src/features/finishedGoods/FinishedGoodsCatalogue.tsx:90-128`, `src/hooks/useCatalogueSync.ts:79-90`; counter `convex/finishedGoods/workflow.ts:105-130`.
- **Evidence:** Measured re-run costs: `catalogue:summary` 272 docs/2 requests; `catalogue:page` 110/65 docs. Inferred: `flush()` patches `finishedGoodsSummaryReadiness` after any pallet/product/move/batch write; summary/sorted cursors include `generation`; `nextCode` shares one counter document. Not measured: contention probe used `saveJobScans`.
- **Fix:** stop bumping `generation` on readiness; insert-only change log read only by in-progress sorted scans; remove `generation` from completed-page cursor scopes; sharded warehouse totals updated in `adjust()`; split counters.
- **Expected impact and risk:** catalogue screens stop re-running on unrelated writes; summary becomes constant cost; risk in sharded-total backfill/reconcile.

### 4. Storage building list subscribes to a full placement scan per row

- **Location:** `convex/storageLayouts/catalogue.ts:338-377`, `467-482`; callers `src/features/storageLayouts/StorageLayoutScreens.tsx:313, 347-357`.
- **Evidence:** Measured 917 docs / 819 KB read to return 1.0 KB. Inferred: each row reads every RESERVED/STORED placement in its building; >10,000 per status throws `CAPACITY_DATA_LIMIT`.
- **Fix:** reuse the per-zone occupancy record (counts, unmeasured count, footprint union areas) and sum per building; fallback until backfilled.
- **Expected impact and risk:** O(placements in building) → O(zones in building) per row.

### 5. Storage building screen reads two docs per held placement for the whole building, including on floor-level screens

- **Location:** `convex/storageLayouts/catalogue.ts:528-592`, `88-151`; callers `src/features/storageLayouts/useStorageBuilding.ts:22-23`, `StorageLayoutScreens.tsx:700, 1784, 3663`.
- **Evidence:** Measured 1,829 docs / 1,317 KB read / 447.8 KB returned; layout half 25 docs.
- **Fix:** copy displayed pallet fields onto the placement when held (check all pallet writers); per-floor inventory query for floor editor/review screens.
- **Expected impact and risk:** ~half the docs per re-run; drift risk needs a reconcile check.

### 6. Job-scan location picker search joins every location row

- **Location:** `convex/finishedGoods/jobScanLocations.ts:663-757`, `128-151`, `320-351`; caller `src/features/finishedGoods/jobScan/LocationPicker.tsx:578-584`.
- **Evidence:** Measured 896 docs / 474 KB over 2 requests to return 0.8 KB.
- **Fix:** copy source position/zone display `label` and `buildingId` onto `locations`, maintained on create/rename; filter within the row; optionally the search-index approach from #2.
- **Expected impact and risk:** ~2× fewer docs for sparse searches; needs backfill.

### 7. HR roster fails above 50 employees and loads a whole site-month grid

- **Location:** `convex/hr/roster.ts:301-330, 348-356`, `convex/model/hr/roster.ts:53`, `convex/hr/shared.ts:1050-1079, 844-864`; caller `src/features/hr/ShiftsRoster.tsx:699`.
- **Evidence:** Measured 162 docs then `LIMIT_EXCEEDED` at 153 employees.
- **Fix:** page employees with a native cursor, apply filters during the scan, read days per employee on the page.
- **Expected impact and risk:** works for any site size; UI becomes paged.

### 8. Expensive whole-warehouse legacy endpoints are still public

- **Location:** `convex/finishedGoods/workflow.ts:1289-1344`; `convex/storageLayouts/catalogue.ts:379-407, 523-524, 594-622, 624, 626-671`; `convex/storageLayouts/locationCatalogue.ts:460-479`; `convex/finishedGoods/jobScans.ts:125-165`.
- **Evidence:** Measured `workflow:list` 1,440 docs; `getStorageBuilding` 1,844; `getStorageLocationMap` 936. Inferred: no live `useQuery` caller in `src/`; `.all(10_000)` capacity cliffs.
- **Fix:** retire after the rollout window or reimplement on the split/paged queries; update public API fixtures.

## Already good (brief)

- Tenant wrapper: org-prefixed index reads only, page cap 100, `.all()` fails rather than truncating (`convex/lib/tenantDb.ts:623-741`, `convex/lib/tenantStorage.ts:260-391`).
- Progressive scans bounded with `maximumRowsRead`/byte caps.
- Request-local memoization; authorization avoids wall-clock dependency for cacheable queries (`convex/lib/tenantFunctions.ts:325-338`).
- Building layout/inventory split (layout 25 docs measured); product summaries materialized.
- Job-scan writes tight (10 reads / 53 writes for 50 items; 0 OCC retries under 8 concurrent saves).
- HR queries capped; period-close preview has a paged fallback.

## What would raise the score to 9+

- Recommendation proportional to what it shows, small payload, per-zone detail query (finding 1).
- One per-zone occupancy record rebuilt in `flush()` shared by recommendation, building occupancy and inventory (1, 4, 5).
- Remove per-warehouse read-modify-write documents (3).
- Index-backed search for job scans and picker locations (2, 6).
- Paginate the roster (7); retire legacy endpoints (8).
- Re-profile with real placement-write fan-out, concurrent `reserve`/`createPallet` contention, and a 5× larger fixture.
