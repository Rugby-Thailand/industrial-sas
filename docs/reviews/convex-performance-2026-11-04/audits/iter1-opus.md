## Score: 5/10

- **Score unchanged: one hot path improved by 15%, and nothing changed class (measured).** `recommend` dropped from 2,886 to 2,454 docs and `recommendMove` from 2,887 to 2,455 docs. Return bytes are identical (244,011 and 244,251 B in both columns). The payload is still about 238 KB per call and reads still grow with zones × held placements. Every other query reads exactly the same number of documents in candidate and base, so there are no regressions and no other gains.
- **Placement-write fan-out is now measured, and it confirms the broad reactive scope (measured).** One `reserve` re-runs 10 subscribed queries that re-read 5,428 docs and 3.5 MB, using about 1.1 s of execution time (base: 6,292 docs). `recommend` and `recommendMove` account for 4,911 of those docs. `recommendMove` is for a different, already-stored pallet, so a reserve anywhere in the warehouse re-runs every open move screen.
- **The heavy screens are untouched (measured).** Job-scan search reads 2,389 docs over 22 requests, `getStorageBuildingInventory` 1,829, `buildingOccupancy` 917 docs to return 1.0 KB, and the location picker `searchPage` 896. `hr/roster:roster` still returns `LIMIT_EXCEEDED`.
- **The contention evidence is invalid in both iterations (inferred from harness code; I missed this in iteration 0).** The probe sends its 8 "concurrent" mutations through one shared `ConvexHttpClient`, and that client queues mutations one at a time by default. "0 OCC retries" therefore says nothing about contention on the per-warehouse counter or the readiness document. My iteration-0 report counted it as a strength, and I withdraw that.
- **The change itself is correct (inferred).** It preserves the candidate set, the iteration order, authorization and tenant isolation. It also narrows the reactive scope: zone and building edits in draft or archived buildings no longer re-run recommendations. Mutations still validate with fresh reads.

## Changes since last audit

- **Recommendation reads only zones of ACTIVE buildings (`convex/finishedGoods/workflow.ts:1059-1087`). Verdict: correct.**
  - _Candidate set (inferred):_ `locationContext` already returns null for any zone whose building is missing, not ACTIVE or in another warehouse (`workflow.ts:658-668`). Only non-null contexts count towards `active` and `NO_ACTIVE_LOCATIONS` (`1097-1099`, `1180-1184`), so dropping those zones changes neither candidates nor reasons. A zone in an ACTIVE building whose own `warehouseId` differs is still read and rejected (`652-653`), as before.
  - _Order (inferred):_ the old range was ordered by `(warehouseId, code, _creationTime)`. The new code merges per-building ranges with `compareCodePoints` and then `_creationTime` (`613-622`, `1083-1087`). Convex orders strings by UTF-8 bytes, which matches code-point order, so the order is preserved. Order only matters for `previewCandidates`, the insertion order of the `reasons` Set and ties in the final sort.
  - _Indexes and reactive scope (inferred):_ both indexes already exist (`convex/schema.ts:1245-1248`, `1348`), so no schema change or backfill is needed. The query now depends on the ACTIVE-buildings range plus one zone range per active building. Before, it depended on the whole warehouse's zone range plus a `get` for each zone's building. Activating or archiving a building, and inserting or moving a zone into an active building, still invalidate it. Draft-building edits no longer do. Pre-reading the buildings and reusing them through `knownBuildings` (`571-597`) reads the same snapshot and adds no read.
  - _Capacity:_ the `.all(10_000)` cliff now applies per building instead of per warehouse, which is a minor improvement.
  - _Measured effect:_ combined with the change below, 432 fewer docs per call (−15%) and 432 fewer docs for each recommend subscriber per placement write. The profile cannot split the saving between the two changes.
- **Upper-pallet stack checks done once per request, with memoized stack reads (`workflow.ts:2482-2629`). Verdict: correct.**
  - _Equivalence (inferred):_ `upperStackBlock` evaluates `upper` once per request (`2546-2549`). `upper` is the same document for every support, and the lazy `??=` runs only when a pallet support exists, exactly as before (`2580-2583`). The inlined helpers match the originals:
    - The pallet read with its warehouse and `retiredAt` filter matches `palletOf` (`83-95`).
    - `stackingFormat` matches `isStackingPallet`, including the product/warehouse guard (`2392-2407`). The only difference is `""` versus nullish, and `storageFormat` is a literal union, so it cannot occur.
    - The inlined placement check matches `currentPlacement` (`1218-1232`).
  - _Safety (inferred):_ memoization is safe because a query runs on one snapshot and the callers only call `.length`/`.some` on the memoized arrays. The mutation callers of `validateStack` (`1445`, `1557`, `1867`, `2007`, `2738`) pass no scope, so they get `freshStackReads`. Authorization and tenant scoping go through `ctx.tenantDb` as before.
- **Tests (`tests/integration/storage-query-scale.integration.test.ts:550-640`). Verdict: they guard the read budget but not cross-building order.**
  - Test 1 would fail on the old code: 60 draft-building zones increase `rangeDocs.storageZones`. It also checks that the result is equal.
  - Test 2 would fail on the old code: it reads the product once per support, so the product-get count exceeds 2.
  - Gap: no recommend test has two or more ACTIVE buildings with interleaved zone codes, so the new merge sort is unguarded. The only extra ACTIVE building in this file (`285-289`) is used by an inventory test.
  - Gap: test 2 checks only that some supports are blocked, not which reason. Reason parity relies on the existing `finished-goods-stacking.integration.test.ts` (`278-372`, `558`).
  - I could not run them: the snapshot has no `node_modules`, and installing them would write files.
- **Profiler (`scripts/performance/convex/*`). Verdict: fit for doc and byte counts, invalid for contention.**
  - Doc and byte counts come from backend `usageStats`, and candidate and base agree on every untouched query.
  - Problem 1: `contend()` (`profile.mjs:446-450`) calls `invoke` → `target.http.mutation` on a single shared `ConvexHttpClient` (`profile.mjs:66`, `lib.mjs:37-38`). Convex 1.46 queues mutations unless `skipQueue` is passed (`node_modules/convex/dist/esm/browser/http_client.js:302-342`). The 8 writes therefore run one after another, and the rising RTTs fit that (p50 116 ms, max 179 ms for `createPallet`).
  - Problem 2: the candidate is recorded as `80dc0a93+dirty` with no content hash. It was measured about a minute before commit `a3fa1e28`, so the audited code and the measured code are linked only by timing. The identical return bytes are consistent with that.

## Findings (ranked by impact, max 10)

### 1. Put-away recommendation evaluates every zone, and returns and re-runs for the whole warehouse (partially resolved)

- **Location:** `convex/finishedGoods/workflow.ts:1046-1186` (`recommendations`), `1188-1215` (`recommend`, `recommendMove`), `642-866` (`locationContext`). Callers: `src/features/finishedGoods/PalletScreens.tsx:598-601`, `MoveScreen.tsx:177-180`, with client-side paging in `DestinationPicker.tsx:71-78`.
- **Evidence:**
  - Measured: 2,454 docs / 1,622 KB read / 238.3 KB returned (was 2,886). The reserve fan-out re-ran `recommend` at 2,455 docs and `recommendMove` at 2,456 docs.
  - Inferred: each zone in an active building still reads 2 placement ranges, plus positions, a location for each position and a pallet for each stored placement. Every candidate still carries copies of its zone's `occupied`, `unavailable` and the full `previewSupports` array (`1106-1157`).
- **Cost mechanism:** reads grow with zones in active buildings × held placements, at about 2.5k docs per call and per subscriber on every reserve, confirm, move or cancel in the warehouse. The payload is O(supports²) per zone.
- **Fix:** steps (a) and (c) below are still open; the stack part of my old (a) is done.
  - (a) Serve `previewSupports`, `occupied` and `unavailable` from a per-zone detail query that only the selected candidate subscribes to. This is a no-behaviour-change step.
  - (b) Read only ACTIVE zones per floor through `by_orgId_floorId_status_code` instead of every zone per building. This is a small saving; inactive zones in active buildings are still read and discarded.
  - (c) Add a per-zone occupancy projection rebuilt in `trackFinishedGoodsWrites.flush()`, with a new tenant table registered in `schemaPolicy`, a resumable backfill and a readiness flag.
- **Expected impact and risk:**
  - (a) cuts the payload by most of its 238 KB.
  - (c) brings reads to about 1 per zone and makes re-runs touch only the zones that changed. The risk is projection drift, which needs a reconcile job and old/new output diffing.

### 2. Job-scan text search scans the entire job-scan history (open)

- **Location:** `convex/finishedGoods/jobScans.ts:599-740`, `convex/lib/boundedRecordPage.ts:77, 236-254`.
- **Evidence:** Measured: 2,389 docs / 1,541 KB over 22 requests, unchanged.
- **Cost mechanism:** O(history) docs and about 22 round trips per settled search.
- **Fix:** unchanged from iteration 0:
  - Add a normalized `searchText` field with a `searchIndex` filtered by org, warehouse and mapped status.
  - Re-verify hits with `jobScanTextMatches`.
  - Keep the bounded scan as a fallback for short or Thai search terms.
  - Backfill existing rows.
- **Expected impact and risk:** typical searches need one request. Relevance ordering must be re-sorted by `createdAt`.

### 3. Per-warehouse hot documents written by every FG mutation and read by every catalogue query (open; re-runs now measured, contention still unmeasured)

- **Location:**
  - Writes: `convex/lib/finishedGoodsSummary.ts:251-262, 331-345`.
  - Readers: `convex/finishedGoods/catalogue.ts:52-60, 371, 515, 531`.
  - Counter: `convex/finishedGoods/workflow.ts:105-130`.
- **Evidence:**
  - Measured: `createPallet` re-ran `catalogue:page`×3 (246 docs) plus `catalogue:summary` (210 docs), and `reserve` re-ran the same 4 queries (454 docs). That includes the `search: "DEMO"` pallets page, whose results may well not change.
  - Inferred: the re-runs are consistent with the `generation` bump on the readiness document, but the profile cannot separate that from legitimate invalidation. The OCC numbers are invalid; see finding 9.
- **Fix:** unchanged:
  - Stop bumping `generation` on readiness, or move change detection into an insert-only log.
  - Remove `generation` from completed-page cursor scopes.
  - Shard warehouse totals.
  - Split `finishedGoodsCounters`.
- **Expected impact and risk:** catalogue screens stop re-running on unrelated writes. The sharded-total backfill and reconcile carry risk.

### 4. Storage building list subscribes to a full placement scan per row (open)

- **Location:** `convex/storageLayouts/catalogue.ts:338-377, 467-482`.
- **Evidence:** Measured: 917 docs / 819 KB read to return 1.0 KB, unchanged.
- **Fix:** per-zone occupancy projection (shared with finding 1c), summed per building.

### 5. Storage building screen reads two docs per held placement for the whole building (open)

- **Location:** `convex/storageLayouts/catalogue.ts:528-592, 88-151`.
- **Evidence:** Measured: 1,829 docs / 1,317 KB read / 447.8 KB returned, unchanged.
- **Fix:**
  - Copy the displayed pallet fields onto held placements.
  - Add a per-floor inventory query for the floor editor and review screens.

### 6. Job-scan location picker search joins every location row (open)

- **Location:** `convex/finishedGoods/jobScanLocations.ts:663-757`.
- **Evidence:** Measured: 896 docs / 474 KB over 2 requests to return 0.8 KB, unchanged.
- **Fix:** copy the position/zone label and `buildingId` onto `locations` and filter within the row, or add a search index. Needs a backfill.

### 7. HR roster fails above 50 employees (open)

- **Location:** `convex/hr/roster.ts:301-330, 348-356`, `convex/model/hr/roster.ts:53`.
- **Evidence:** Measured: 162 docs, then `LIMIT_EXCEEDED` at 153 employees.
- **Fix:** paginate employees with a native cursor, apply filters during the scan, and read days per page.

### 8. Expensive whole-warehouse legacy endpoints are still public (open)

- **Evidence:** Measured: `getStorageBuilding` 1,844 docs, `workflow:list` 1,440, `getStorageLocationMap` 936, all unchanged. Inferred: none has a live subscriber.
- **Fix:** retire them after the rollout window, or rebuild them on the split/paged queries.

### 9. Contention probe serializes its "concurrent" writers, so OCC results are unmeasured (new; harness, missed in iteration 0)

- **Location:** `scripts/performance/convex/profile.mjs:446-512`, `66`, `73-83`; `lib.mjs:37-38`.
- **Evidence:** Inferred: one `ConvexHttpClient` per target, and `http.mutation` without `{ skipQueue: true }` is queued by `processMutationQueue` (`http_client.js:302-342`). Measured symptom: `executions` equals `workers` and RTT climbs to the maximum.
- **Cost mechanism:** the profile cannot detect contention on `finishedGoodsCounters` (`nextCode`) or `finishedGoodsSummaryReadiness`, the two hot documents in finding 3.
- **Fix:**
  - Give each worker its own client, or pass `{ skipQueue: true }`.
  - Add a positive control that must show retries, such as 8 writers patching the same document.
  - Add a concurrent `reserve` probe across different zones.
- **Expected impact and risk:** harness only; no product risk.

## Already good (brief)

- Tenant wrapper: only org-prefixed index reads, a page cap of 100, and `.all()` fails instead of truncating.
- Progressive scans are bounded per request.
- Request-local memoization now extends to stack validation, and mutations deliberately keep fresh reads (`validateStack` without a scope).
- The building layout/inventory split works (layout measured at 25 docs), and product summaries are materialized.
- Job-scan writes cost O(items): 10 reads and 53 writes for 50 items (measured). OCC behaviour is unknown; see finding 9.
- The iteration-1 change kept results byte-identical in size, added read-budget tests that fail on the old code, and needed no schema change.

## What would raise the score to 9+

- Make recommendation O(displayed): a per-zone detail query for the preview payload, plus a per-zone occupancy projection maintained in `flush()`. The same projection serves building occupancy and inventory (findings 1, 4, 5).
- Remove per-warehouse read-modify-write documents from the catalogue's reactive path (finding 3), then prove it with a contention probe that is actually concurrent (finding 9).
- Index-backed search for job scans and picker locations (findings 2, 6).
- Paginate the roster (finding 7) and retire the legacy endpoints (finding 8).
- Profile with recorded candidate content hashes, a recommend parity test across several active buildings with interleaved zone codes, and a 5× larger fixture.
