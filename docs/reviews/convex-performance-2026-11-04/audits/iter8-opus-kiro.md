# Convex performance audit, iteration 8 (PROVISIONAL)

- **Auditor:** Claude Opus 5.5, via Kiro CLI. Nothing was delegated, and no other model or service was used. I did not read Sol's audits.
- **Audited code:** `f9903ff90a463eee3e0731923d919abbfe84f88c`.
  - Iteration diff: `60dd3979..f9903ff9`. Cumulative diff: `80dc0a93..f9903ff9`.
  - The workspace HEAD moved to `47366fcc` during the audit (commits `2494a6a5` and `47366fcc`). Those commits change only `convex/hr/pagination.ts`, `scripts/performance/convex/profile.mjs` and one test. Every file I cite is identical at both SHAs. I did not audit the later commits (see finding 3).
- **Method:** read-only. I made no deployments, ran no Convex commands, ran no tests (the parent is running the full suite) and made no commits. This file is my only write.
- **Evidence status:**
  - `evidence/iter8.md` and `.json` (dataset-L): present. Profiled at candidate `3308eee9`. Between `3308eee9` and `f9903ff9` only `profile.mjs` differs, so `convex/` is identical.
  - `evidence/iter8-xl.md` and `.json` (dataset-XL): present at audit finish. Candidate `f9903ff9`.
  - `evidence/iter8-search-parity.json`: **absent at audit finish, so real-engine search parity for iteration 8 is unavailable.** This audit is provisional for that reason.
- **The measured code is the audited code (verified).** I recomputed the profiler's digest (`scripts/performance/convex/profile.mjs:944-963`) over `convex/` at `f9903ff9` with `convex/` clean. It is `ec7564df058c0f30`, the candidate digest in both iter8 profiles.

## Score: 7/10 (provisional)

- **Recommendations read less (measured).**
  - `recommend` and `recommendMove` (list) read 438–439 docs and 747 KB, down from 687–688 docs and 1,284 KB. Base reads 2,886–2,887 docs and 1.86 MB. They still return 128 KB.
  - The `reserve` fan-out re-reads 1,051 docs and 1.6 MB, down from 1,568 docs and 2.7 MB. Base re-reads 6,098 docs and 3.8 MB.
  - The count is the same on L and XL, but XL grows only scan history and employees. Zones and buildings are equal (421 and 127), so growth with layout size is not measured.
- **HR period preview is now bounded (measured).** It reads 111 docs on both L and XL. It was 164 on L and 776 on XL; base reads 164 and 776.
- **Search stays O(matches) (measured).**
  - Job-scan search: 61 docs on L and 70 on XL. Base needs 2,389 docs over 22 requests on L, and 10,352 on XL.
  - Picker hit: 98 docs against 900, measured for the first time.
  - The new rollback guard costs readers one document (`storageCatalogueSignals`).
- **Inventory reads half the bytes (measured).** It reads 469 KB instead of 964 KB, but still returns 448 KB.
- **What keeps it at 7 (measured and inferred).**
  - The recommendation list still reads about 2 documents per zone that can hold the product. It re-runs on a held-placement write in any such zone (finding 1).
  - In warehouses with more than 100 buildings, creating any building now forces a full job-scan index rebuild, and searches fall back to the history scan meanwhile (finding 2).
  - At the audited SHA, legacy roster clients with exactly 50 employees get `LIMIT_EXCEEDED`, where main returned the roster (finding 3).
  - A 50-scan delete reads 3,766 docs, against 160 on base, and the 300-id maximum is unmeasured against the 4,096 read-call limit (finding 4).
  - Iteration-8 search parity is missing.

## Changes since last audit

- **Zone surfaces, projected entries v2 and stack facts (`5193bd93`, `df5d74a4`, `5c898dc4`, `3308eee9`). Verdict: correct, with two risky edges (findings 5 and 6).**
  - _Which zones are read (inferred):_
    - Rows are read through `by_orgId_warehouseId_buildingActive_eligible_conditionKey` (`convex/lib/zoneSurfaces.ts:334-350`), then filtered by run, version and the live active-building set (`convex/finishedGoods/workflow.ts:1408-1420`).
    - `resolvedContext` still re-reads the building and floor and re-checks the zone's warehouse and status (`workflow.ts:820-840`).
  - _Payload and order:_
    - Reasons are needed only when nothing fits. In that case every listed zone is evaluated in zone-code order (`workflow.ts:1436-1446`). Results are cached, so zones already evaluated are not evaluated again.
    - `stackedPalletIds` are sorted by placement creation time, the same order as `heldPlacements` (`convex/lib/zoneOccupancy.ts:157-196` vs `workflow.ts:2865-2880`).
    - Above 50 children, or when more than 50 pallets are missing during a rebuild, stack facts stay unknown and readers query them (`zoneOccupancy.ts:141-147, 452-485`).
    - Mutations still use fresh reads (`workflow.ts:2896-2915`).
  - _Maintenance:_
    - Placement writes touch the pallet they rest on, before and after the write (`convex/lib/finishedGoodsSummary.ts:387-396, 484-488`).
    - Layout writes rebuild the zones they touch in the same transaction (`zoneSurfaces.ts:384-540`). Readiness follows the layout counter only when this transaction moved it from `before` (`zoneSurfaces.ts:537-545`).
  - _Authorization:_ `recommendationZone` keeps its permission and warehouse binding. The surface row is reached through `tenantDb` (org-scoped), and `resolvedContext` rejects other warehouses.
  - _Measured:_
    - List: 438 docs, 747 KB. Zone preview: 16 docs (was 17). Inventory: 469 KB read (was 964).
    - `reserve` writes 9.4 KB, against 9.9 KB in iteration 7 and 7.2 KB on base. The notes' fixture measured a 47% entries-row cut; on the real flow the write bytes fell 5%.
    - The dense-zone backfill bug (4,096 read calls) was found only on the real backend. It is fixed by the read-call budget (`convex/storageLayouts/zoneOccupancyBackfill.ts:26-34`).
  - _Condition filter:_ the test "read one surface row and one entries row per compatible zone" fixes the cost at 2 docs per zone. At 438 docs, the profiled probe is compatible with roughly every listed zone, so the condition filter saved nothing for it (inferred). The reduction comes from collapsing positions and their locations into one row.
- **Search rollback guard (`4154f491`, `c458e593`, `cfe3f6ae`, `f08608f1`). Verdict: correct for its stated guarantee, with one new cost trigger (finding 2).**
  - _Layout marker:_
    - Readers compare `storageCatalogueSignals.generation` with the readiness copy (`convex/lib/jobScanSearch.ts:874-876`, `convex/lib/locationSearch.ts:59-67`).
    - Maintained writes follow the counter only when it moved by exactly one (`convex/lib/searchIndexWrites.ts:136-145`). The finished-goods flush runs before the search flush (`convex/lib/tenantFunctions.ts:548-549`).
    - Main bumps the same counter for every storage-table write (`git show 80dc0a93:convex/lib/finishedGoodsSummary.ts`, flush).
  - _Reconcile window:_
    - The window is `[watermark, now − 30 s)` (`convex/finishedGoods/searchIndexBackfill.ts:617-693`).
    - Scans are found by `updatedAt`, which main sets on every edit (`80dc0a93:convex/finishedGoods/jobScans.ts:443-449, 568`), and by `_creationTime`.
    - Locations are found by `_creationTime` only (`:376-379`). Main's location status patches happen together with layout writes, which move the counter (`80dc0a93:convex/storageLayouts/writes.ts:1086-1096`, `zones.ts:1747`). Raw patches by old code are documented as needing `invalidate` (`docs/operations/search-index.md`, "Not covered by reconcile").
  - _Reactivity:_
    - Reconcile progress lives on `searchIndexReconcile`, which readers never read.
    - The reconcile range ends 30 s in the past, so it does not conflict with fresh saves.
    - Job-scan and picker searches now also re-run on every layout write, because they read the counter. Layout writes are rare.
  - _Measured:_ search docs are unchanged (61 L, 70 XL; picker 39).
  - _Minor:_
    - The reconcile doc comment still says readers "keep merging" (`searchIndexBackfill.ts:488-489`). The shipped design removed that.
    - `layoutRow` skips noting a second warehouse once any warehouse is noted (`searchIndexWrites.ts:73`). That causes a spurious fallback and repair, so it fails safe.
- **Term collection (`93439178`). Verdict: correct.**
  - The orphan check reads the term's slot range with `take(1)`, so a concurrent linker conflicts and retries (`jobScanSearch.ts:245-268`).
  - _Measured:_ update reads 95 and writes 35 (was 89 and 31). Delete reads 85 and writes 26 (was 73 and 24).
- **Totals (`0c00f619`). Verdict: correct.** Invalidation poisons an unfinished build. A build that saw the legacy generation move restarts (`convex/finishedGoods/totalsBackfill.ts:71-91, 277-285`). Candidate writers do not bump that generation.
- **Overflow re-check and readiness report (`8e710e76`, `9a7e6ddf`). Verdict: correct; this resolves my iteration-7 finding 9.**
  - Every overflowed zone is walked, one page per transaction (`zoneOccupancyBackfill.ts:330-377`).
  - `buildingReady` uses `buildingScopeClear` (`:217`).
  - The resume token keeps only the page's zones (`:198-208`).
  - The LOCAL-DRAFT insert now invalidates the search index (`convex/staging/annexDemo.ts:497-499`).
- **Site employee scan (`339c72fb`). Verdict: correct.**
  - It reads chunks of up to 100 rows (`TENANT_INDEX_MAX_PAGE_SIZE`). Ties on equal codes are de-duplicated by ID. It falls back to the whole-site read when one code fills a chunk (`convex/hr/shared.ts:1185-1261`).
  - The budget accounting differs from `employeesInRange` after a refusal. The only shared-budget caller returns at the first `null` (`convex/hr/review.ts:100-108`), so its answers are unchanged.
  - _Measured:_ 111 docs on L and XL (was 164 and 776).
- **Legacy roster (`116293ee`). Verdict: regression at the audited SHA (finding 3).** Rows are sent once (0.1 KB `LIMIT_EXCEEDED` answer), but the `!page.isDone` refusal also hits a complete 50-row page.
- **Profiler (`ff036202`, `c3737c08`, `6aee6883`, `42b5b082`, `f9903ff9`). Verdict: adequate, with caveats.**
  - New measurements: a picker search that hits, a previous-month roster (594 docs for 20 employees and 30 days, proportional to the result), a 50-scan delete, and a same-zone reservation burst (equal refusal handling on both targets).
  - **The "switched zone" fan-out cannot show zone isolation.** That preview is for the same pallet the fan-out reserves (`scripts/performance/convex/scenarios.mjs:316-338` vs `profile.mjs:445-475`). Its single re-run is explained by the pallet write alone. Isolation still rests on `convex-test`.
  - The `recommendMove` list subscribes for a different, stored pallet (`scenarios.mjs:271-276`). Its re-run on `reserve` (440 docs) is real evidence of the cross-zone scope in finding 1.
  - The XL base fan-out for `reserve` errored ("no recommended destination"), so XL has no base comparison for that write.
  - Latency is load-dominated (load 23–32 on XL). For example, XL search is 1,293 ms exec for 70 docs. It is indicative only.

## Findings (ranked by impact, max 10)

### 1. The recommendation list still reads every compatible zone and re-runs on writes in any of them (partially resolved, old 1)

- **Location:** `convex/finishedGoods/workflow.ts:1335-1447`, `convex/lib/zoneSurfaces.ts:311-350`. Callers: the put-away and move screens.
- **Evidence:**
  - **Measured:** 438–439 docs and 747 KB read per call (was 687–688 and 1,284 KB), returning 128 KB. Identical on L and XL.
  - **Measured:** a reservation of another pallet re-runs the stored pallet's `recommendMove` list (440 docs). The awaiting pallet's own list re-runs too (439 docs), which is expected.
  - **Inferred:** the cost is about 2 docs per listed zone (its surface row plus its entries row), plus floors and blocks. It grows with the zones in active buildings. The XL dataset does not grow zones.
- **Cost mechanism:** O(compatible zones) per call. Each held-placement write rewrites one entries row that every list subscriber for a compatible product reads.
- **Fix:**
  - Keep a per-zone fit summary, maintained with the entries row (free area and height per surface class, unmeasured flag). The list then reads one small row per zone, and only zones that can fit the pallet's footprint and height load their entries.
  - Alternatively, rank on the server and return the top N with a count.
  - Maintain the summary in the same flush, and backfill it with the occupancy run.
- **Expected impact and risk:** another 2–5× fewer bytes, and re-runs only when a zone's fit changes. Moderate risk; the existing surface and occupancy parity tests cover the payload.

### 2. Creating any building in a warehouse with more than 100 buildings forces a full job-scan index rebuild (new, regression risk)

- **Location:** `convex/finishedGoods/searchIndexBackfill.ts:546-575` (`reconcile`), `:453-475` (`repairBuildingNames`, `REPAIR_BUILDINGS = 100` at `:382`), `:741-751` (sweep trigger), `:197-212` (rebuild sets `ready: false`).
- **Evidence (inferred):**
  - `createdBuilding` finds a building created since the watermark, by any writer, including maintained code that already indexed its name.
  - `repairBuildingNames` then reads up to 101 buildings. With more than 100, it returns `null`, and `reconcile` schedules `run({restart: true})`. That sets `ready: false`, so every search uses the history scan until the build re-indexes the whole history.
  - The profiled dataset has 127 buildings, and the pagination seed puts its 121+ buildings in one warehouse (`convex/staging/paginationDemo.ts:96-121`). So the profiled warehouse probably meets the condition.
  - The runbook covers the over-100 rebuild only for "counter differs", not for new buildings (`docs/operations/search-index.md`, "Repair").
  - No test covers more than 100 buildings on this path (grep).
- **Cost mechanism:**
  - Per search during the rebuild, the base cost applies. **Measured:** 2,389 docs over 22 requests on L, 10,352 docs on XL.
  - On top of that, one full re-index (about 88 pages of 25 scans on L, 320 on XL).
  - It repeats for every building created.
- **Fix:** re-derive only the buildings created in the window. Bound the `createdBuilding` query with `take(REPAIR_BUILDINGS + 1)` and pass those rows to `indexBuildingNames`. Rebuild only if that list overflows, or if the layout counter differs. Unchanged names cost 2 reads each, so maintained creates become nearly free.
- **Expected impact and risk:** removes the trigger. Low risk. Add a test with 101+ buildings and one maintained create, asserting `status !== "rebuilding"`.

### 3. Legacy roster clients with exactly 50 employees are refused at the audited SHA (new, behavior regression)

- **Location:** `convex/hr/roster.ts:450`, together with `hrScanPage` in `convex/hr/pagination.ts` at `f9903ff9`.
- **Evidence (inferred, and confirmed by the next commit):**
  - The refusal is `legacy && (page.status !== "ready" || !page.isDone)`. At `f9903ff9`, `hrScanPage` does not mark a full page as done when the source has no more rows. A site with exactly 50 employees therefore gets `LIMIT_EXCEEDED`. Main refused only above 50.
  - Commit `2494a6a5`, outside the audited SHA, adds that check and the test "returns the complete legacy roster at exactly 50 employees and refuses the 51st". I have not audited it.
- **Measured:** the refusal reads 253 docs on L, against base's 162 (XL: 253 against 774).
- **Fix:** take `2494a6a5` after review. Consider deciding `isDone` by peeking one row, without hydrating the page, to cut the 253-doc refusal.
- **Expected impact and risk:** restores main's contract at the boundary. Low risk.

### 4. Job-scan deletes amplify reads and writes about 24×, and the 300-id maximum is unmeasured (open, old 4; grown)

- **Location:** `convex/lib/jobScanSearch.ts:338-354` (`dropScanGrams`), `:245-268` (`collectIfOrphaned`), `:395-549`. `deleteJobScans` accepts up to 300 ids (`convex/finishedGoods/jobScans.ts:51, 99-100, 583-603`).
- **Evidence:**
  - **Measured (L and XL identical):** a 50-scan delete reads 3,766 docs (1.2 MB) and writes 1,253 docs (5,368 index rows). Base reads 160 and writes 53.
  - **Measured:** a 50-scan save writes 1,253 docs against 53. A single update reads 95 and writes 35, against 13 and 4.
  - **Inferred:**
    - After the 1,500-write budget is spent, deletes still read the scan, its search row, and 2 calls per released term (`collectIfOrphaned` reads before checking the budget).
    - At 300 ids that is several thousand read calls, against the 4,096 read-call limit that the notes found `convex-test` does not enforce.
    - The `convex-test` "100-ticket delete" case asserts only derived writes.
- **Fix:**
  - Measure a 300-scan delete on the real backend, including read calls.
  - Once the budget is spent, push released terms to `deferredTerms` without reading them, and skip the search-row read for the scans the orphan job already covers.
- **Expected impact and risk:** prevents a possible hard failure at the selection limit. Low risk.

### 5. A layout change over the maintenance budget turns off every occupancy reader in the warehouse (new; trade-off too broad)

- **Location:** `convex/lib/zoneSurfaces.ts:478-529`. The budgets are 60 zones and 300 locations (`:46-52`).
- **Evidence (inferred):**
  - Changing the status of a building with more than 60 zones, or of more than 300 position locations, sets the occupancy readiness to `ready: false, stale: true`.
  - That turns off zone-occupancy rows for inventory, building occupancy and recommendations, not just surfaces, until a full occupancy rebuild finishes.
  - Each such mutation restarts the rebuild, so a series of large layout edits keeps the warehouse on the fallback.
- **Cost mechanism:** fallback costs during the rebuild. **Measured on base paths:** inventory 1,829 docs, building occupancy (base) 97 ms, `recommend` 2,886 docs.
- **Fix:** give surfaces their own validity, such as a surfaces run or generation field. The over-budget path then invalidates only surfaces, and recommendations read the layout while occupancy rows stay trusted. Optionally, rebuild only the touched buildings' surfaces in chained pages.
- **Expected impact and risk:** the cost is confined to recommendations during large layout edits. Low risk.

### 6. The occupancy backfill records the layout generation at finish, not at start (new, integrity, low)

- **Location:** `convex/storageLayouts/zoneOccupancyBackfill.ts:136-153` (start) vs `:219-228` (finish).
- **Evidence (inferred):**
  - A layout write by code that does not maintain surfaces, landing during a run, moves the counter. The finish then copies the new value, so a zone already rebuilt in that run keeps a stale surface row that readers trust.
  - The search build records it at start (`searchIndexBackfill.ts:197-212`). The legacy `summaryGeneration` has the same end-stamp pattern.
- **Cost mechanism:** possibly wrong recommendations (missed or stale positions) after a rollback overlapping a backfill. Mutations re-validate against the layout documents, so no wrong write follows.
- **Fix:** stamp `layoutGeneration` (and `summaryGeneration`) at run start, and at finish refuse readiness if the counter moved without a follow.
- **Expected impact and risk:** closes a narrow window. Very low risk.

### 7. Building inventory still returns whole-building payloads (partially resolved, old 5)

- **Evidence (measured):** 35 docs and 469 KB read (was 964), returning 447.8 KB on L and XL.
- **Fix:** add a per-floor query, or omit the per-placement columns the building screen does not render.

### 8. Sorted catalogue first pages still re-run on every finished-goods write (open, old 6)

- **Evidence (measured):** reserve and cancel re-run 2 pages (146–147 docs). createPallet re-runs 3 pages (259 docs).
- **Fix:** unchanged from iteration 7.

### 9. Pallet creation still serializes on per-warehouse documents (open, by design)

- **Evidence (measured):**
  - L: 39/39 retries, against base 42/42.
  - XL: 56/52 retries with 1–2 failures, against base 63/64 with 5 failures.
  - The sampled conflicts are the sequence counter and a totals shard. The totals are sharded by product into 8 shards (`convex/lib/warehouseTotals.ts:12`), so this is not a new hot document.

### 10. Small items (open or new, low)

- The three whole-warehouse legacy endpoints are unchanged: 1,844, 1,440 and 936 docs, with no live subscriber.
- **Rollout:** the version bumps (search 2, occupancy 2) make every warehouse fall back until the hourly sweeps rebuild it. Run the backfills right after deploy.
- The stale reconcile comment (`searchIndexBackfill.ts:488-489`).
- The `layoutRow` multi-warehouse short-circuit (`searchIndexWrites.ts:73`).

## Already good (brief)

- **Search reads O(matches) on L and XL**, and stays exact through every maintained write. A layout counter catches unmaintained layout writes, and a 1-minute reconcile repairs unmaintained scan and location writes. Its watermark lives on a row that readers never subscribe to.
- **HR period preview and review scoping are bounded by the limit**, not by the site. Their answers are unchanged.
- **Occupancy-derived reads are small:** building occupancy 21 docs, zone preview 16, inventory 35 docs. Overflowed zones now all recover each sweep.
- **The totals build fails safe** on invalidation and on legacy writes.
- **Contention is flat or better than base:** measurement edits take 1 retry against 13, and job-scan saves 0.

## What would raise the score to 9+

- **Make the recommendation list O(displayed):** fit summaries per zone, and re-runs only when a zone's fit changes (finding 1). Measure it on a dataset that grows zones.
- **Fix the two availability regressions:** maintained building creates must not trigger rebuilds (finding 2), and complete 50-row legacy rosters must be served (finding 3, pending review of `2494a6a5`).
- **Bound job-scan delete reads after the budget** and measure the 300-id maximum on the real backend (finding 4).
- **Confine over-budget layout changes to surfaces** (finding 5), and stamp generations at backfill start (finding 6).
- **Land and check the iteration-8 real-engine search parity** (`iter8-search-parity.json`). It is absent, which is why this score is provisional.
- **Add fan-out cases that can show isolation:** reserve pallet A while pallet B's switched-zone preview and B's list are open, for a zone of another condition.
