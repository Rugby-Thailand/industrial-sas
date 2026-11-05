## Score: 7/10

- **Both remaining O(history) and O(tenant) search paths are now index-backed (measured).**
  - Saved job-scan search ("FO6907", first page): 61 docs in 1 request on dataset-L, against base's 2,389 docs over 22 requests. On dataset-XL it is 70 docs in 1 request, against 10,352 over 95.
  - The cost no longer grows with history: 61 → 70 docs while history grew about 5×.
  - Picker `searchPage`: 39 docs against 896, on both datasets.
  - Parity: 0 mismatches over 537 needle/filter traversals against main on the real engine (`evidence/iter7-search-parity.json`). In my run the picker maintenance and read-cost tests passed. The picker parity test timed out, and the job-scan suite did not finish (see Changes).
- **Reactivity narrowed again (measured).**
  - `reserve` now re-runs 7 queries (1,568 docs). Iteration 6 re-ran 8 (1,708 docs); base re-runs 10 (6,098 docs, plus 3 follow-up requests).
  - `pageProductBatches`, `pageLegacyUnits` and the products-tab `catalogue:page` no longer re-run on placement-only writes.
  - The zone preview is now its own 17-doc query.
- **Roster and readiness are cheaper and self-healing (measured and inferred).**
  - The 20-employee roster page reads 84 docs on both the 153-employee and the 765-employee sites. Index queries per page fall from about 353 to 98 (`convex-test`).
  - Building readiness no longer stays degraded after one bad zone.
  - The totals build now works for any catalogue size.
- **What keeps this at 7, not 8 (measured).**
  - `recommend`/`recommendMove` still read 687–688 docs and 1.28 MB per call, and each re-runs on every held-placement write in the warehouse.
  - Building inventory still reads 964 KB.
  - `hr/periods:preview` reads every site employee (164 → 776 docs on XL) to return 0.8 KB. I missed this before (finding 3).
  - Job-scan writes now cost about 7× the documents.
  - A new derived store has no automatic guard against writes made by code that does not maintain it (finding 2).
- **The measured code is the audited code (verified).** I recomputed the profiler's digest (`scripts/performance/convex/profile.mjs:854-873`) over the snapshot's `convex/` and got `421a7138418199aa`, the iter7 candidate's digest. `git diff 78bae3d9..60dd3979 -- convex` is empty.

## Changes since last audit

- **11b2cc10…29951466: index-backed job-scan search. Verdict: correct; trade-offs accepted; one operational risk (finding 2).**
  - _Completeness (inferred):_ every field text that contains the needle is reachable through one of these paths:
    - **Shared term:** found through its trigram postings or its unposted `""` row (`convex/lib/jobScanSearch.ts:799-838`), then streamed through the search-row slot index (`:921-942`).
    - **Unshared text:** found through per-scan trigram postings, or the per-scan `""` row (`:909-920`).
    - **Building name:** a shared term keyed by building, streamed through `by_orgId_warehouseId_buildingId_createdAt`.
    - Any single gram of a well-formed needle is a complete filter, because code-point n-grams of a substring are n-grams of the text (`convex/lib/textGrams.ts:1-8`). Needles under 3 code points, or that are not well formed, keep the scan (`jobScanSearch.ts:675-677`).
    - **Overflow goes to the history scan:** more than 99 term rows for the rarest probed gram, more than 99 unposted terms, or more than 48 matching terms switches to the same history scan in key order (`:835-907`).
  - _Normalization:_ the posted texts, the needle and `accept` all use `normalizeJobScanSearch` (NFKC, trim, en-US lower-case; `:78-100`), so Thai, compatibility and case variants behave exactly as before. Texts shorter than 3 code points are not posted, and a needle of 3 or more code points cannot occur in them.
  - _Exactness of results:_ every candidate is re-read and passes the unchanged `accept` (`convex/finishedGoods/jobScans.ts:683-693`), so stale or extra rows cost reads but never change results.
  - _Ordering and paging:_
    - Streams are merged newest first by (createdAt, scan creation time, ID), and equal keys are deduplicated across stream heads (`jobScanSearch.ts:945-968`). `Stream.fill` uses at least 2 rows, so a boundary row never stalls a stream (`:611-658`).
    - Budget stops resume after the last *examined* key, which is safe because the merge examines keys in order. Full pages resume after the last *shown* key (one-match look-ahead).
    - Cursors are bound to the org and actor scope and to the needle's grams (`:700-742`).
    - `isDone` on the last non-empty page is true by design.
    - The notes say clients without `progressive` "get full pages". In fact, when the budget runs out they get a short `ready` page with `isDone:false` (`:1016-1024`). That matches the old "complete, possibly short page" contract (`jobScans.ts:617-620`), so it is not a regression.
  - _Maintenance on every writer:_
    - Every `mutationWithOrg` runs through the tracked db (`audit` is always true for mutations), and flushes postings in the same transaction (`convex/lib/tenantFunctions.ts:489-501, 548-550`). A thrown failure rolls everything back (`:552-559`).
    - Patches are tracked only when they touch relevant fields (`convex/lib/searchIndexWrites.ts:18-31, 52-59`). Positions and zones are noted under both their old and new location.
    - `createdAt` and a zone's `buildingId` are never patched (grep). That matters because existing per-scan postings keep their key fields when the texts are unchanged (`jobScanSearch.ts:428-440, 485-490`).
    - Raw internal writers: `temporaryRetention`, `duplicateAudit` and `locationBuildingBackfill` do not touch indexed fields. Staging seeds call `invalidateSearchIndex`. The one exception is the LOCAL-DRAFT building insert at `convex/staging/annexDemo.ts:494-495`, which sits outside the invalidated branch. It is staging-only and harmless, because no scan references that building.
  - _Write budget and deferred re-index:_
    - Over the budget, a scan or location keeps an always-searched `""` row that lists all its texts, and a re-index is scheduled (`jobScanSearch.ts:448-484`, `convex/lib/locationSearch.ts:205-231`, `convex/finishedGoods/searchIndexBackfill.ts:87-122`). Results stay exact meanwhile.
    - The reschedule stops when no progress is made, so it cannot loop.
  - _Readiness fallback:_
    - Readers use the index only when the row is `ready && !stale && version` (`jobScanSearch.ts:127-137`).
    - The backfill pages are serializable against writers, which maintain their own rows whatever the readiness.
    - Invalidation poisons a run, and only the newest `runId` may finish (`searchIndexBackfill.ts:153-163, 240-244`).
  - _Measured cost:_
    - **Writes (dataset-L):** `saveJobScans` 1 item writes 28 docs (base 4); 50 items write 1,253 docs and 5,268 index rows in 184 ms (base 53 docs, 15 ms). `updateJobScan` reads 89 and writes 31 (base 13 and 4). `deleteJobScans` reads 73 and writes 24.
    - **Contention:** 8 concurrent saves × 3 rounds: 0 OCC retries.
    - **Reactivity:** the search subscription now re-runs on a save (`listJobScans`×3 against ×2 on base). That is expected, because a new matching scan belongs on its first page.
    - **Latency:** on XL the search is 640 ms exec but only 14 ms of user time. The rest is index-query waits, against base's 6.6 s summed over 95 requests. This is indicative only.
- **11b2cc10: picker bigram postings. Verdict: correct.**
  - Postings use `locationSourceTexts`, which takes the same first position or area (`locationSearch.ts:70-90`) as `physicalSource` (`convex/finishedGoods/jobScanLocations.ts:139-162`), with the same NFC/upper-case normalization.
  - The traversal uses the same prefix-then-rest phases in code order over `[gram, ""]` (`jobScanLocations.ts:361-382`).
  - Rows superseded by a `""` row are dropped. Each proposal is re-read and run through the unchanged `evaluateRow`, with `row.code === posting.code`, ACTIVE status, and the same "missing `buildingId` is in the filtered range" rule as `pickerSegments` (`:812-843` vs `:328-358`).
  - The gram is carried in the cursor (`:788-795, 867-889`).
  - **Measured:** 39 docs against 896. But the profiled needle "R0" returns 195 bytes, which is very likely an empty page, so the profile shows only the miss case. The `convex-test` table in `docs/operations/search-index.md` covers hits: 18 matches cost 289 docs against 1,096, and 203 matches cost 886 against 1,286.
- **1e7652f4…23092043: recommendation list and zone split. Verdict: correct; the reactive isolation is shown only by a test.**
  - **List + zone = old payload.**
    - Both run `zoneRecommendation`. Every removed field is the same for every candidate in a zone, so `zonePreview(first)` restores it (`convex/finishedGoods/workflow.ts:1140-1232, 1395-1429`; `convex/model/finishedGoods/recommendationView.ts`).
    - The sort keys are kept. Without `view`, the full payload is unchanged (`workflow.ts:1356-1386`).
    - `expectSplitParity` deep-compares both paths (`tests/integration/storage-query-scale.integration.test.ts:100-160`).
  - **Opening zones** come from the first candidate, the first non-stacking candidate and the first inspect-only area (`workflow.ts:1325-1344`). This matches the clients' first selection.
  - **Two read shortcuts:**
    - A condition-mismatched zone reads its summary row's `unmeasured` instead of its entries row.
    - A zone with unmeasured units skips its positions and blocks, because it returns `LOCATION_GEOMETRY_UNKNOWN` first.
    - Both are exact, and both apply only when a product is given, so mutations are unaffected (`workflow.ts:770-779`, `convex/lib/zoneOccupancy.ts:505-519`).
  - **Authorization of `recommendationZone`:**
    - It uses the same READ permission and warehouse binding as `recommend`. It checks the pallet and product warehouse, and `locationContext` rejects zones from another warehouse, zones that are not ACTIVE, and their parents. Org isolation comes from `tenantDb`. A test covers another warehouse and another org (`storage-query-scale…:1891-1955`).
    - It does not apply `recommendMove`'s STORED and stack gates. That exposes nothing `recommend` does not already return.
  - **Measured:** the list returns 128 KB (was 238 KB) and reads the same 687 docs and 1.28 MB.
  - **The fan-out cannot show zone isolation.** The profiled `reserve` writes into the viewed zone itself, so `recommendationZone`×2 re-running is expected. Isolation rests on the `convex-test` case at `storage-query-scale…:1811-1889`.
- **4c79e6b6: catalogue change token read lazily. Verdict: correct; partial.**
  - The token is now a memoised thunk, read only to resume a scan, emit a scan cursor, or emit or validate a continuation (`convex/lib/cataloguePagination.ts:95-100, 131-137, 196, 260, 275-277`).
  - One net delta per product: `adjustWarehouseTotals` returns before reading anything when the delta is 0 (`convex/lib/finishedGoodsSummary.ts:141-157`, `convex/lib/warehouseTotals.ts:98-105`).
  - A sorted first page that is not done still embeds the token, and so still re-runs on every finished-goods write. The test asserts this (`tests/integration/catalogue-pagination.integration.test.ts:461-465`).
  - **Measured:** on `reserve`, `catalogue:page` re-runs only for the pallets tab and the pallets search (145 docs), whose ranges contain the reserved pallet.
- **a0bf04c1, 4e9824f3, e0b011fb (totals). Verdict: correct.**
  - **Resumable build.** It counts products in creation order, using `after` and `afterIds` for ties. Writers apply deltas only to products the build has already counted, decided after reading the readiness row.
    - Each page reads the readiness row and the summaries it counts, then writes readiness. So a writer and a page serialize either way.
    - A product with an unknown position poisons the build and forces a restart.
    - Unfinished builds clear `totalsVersion`, so readers fall back to the scan (`convex/finishedGoods/totalsBackfill.ts:66-182`, `warehouseTotals.ts:19-29, 106-130`).
  - **Contention:** writers only *read* the readiness row. Measured cross-product `createPallet` contention is 41 retries against 45 on base (XL: 37 against 36), which closes my iteration-6 gap on unmeasured totals-row conflicts.
  - **`__proto__` unit labels:** counted with a `Map` (4e9824f3).
  - **Fail-safe gaps (iteration-6 finding 8):**
    - The version check is added (`convex/finishedGoods/catalogue.ts:556-559`), closing 8d.
    - Finishing the summary backfill now schedules the build (`convex/staging/summaryBackfill.ts:31-38`), closing 8b.
    - The refusal for large catalogues is gone, closing 8c.
    - 8a is handled by documentation only (squash-merge).
- **b3315247 and e0b011fb (roster). Verdict: correct; small leftovers for clients that predate paging.**
  - `frozenPlanReader` range-reads `by_orgId_employeeId_businessDate` with a bound of `min(100, days×2)`. Point lookups are used only for dates after the last row read once the range is full, which is exact (`convex/hr/shared.ts:778-813`).
  - Lock order is unchanged.
  - `sitePeriodsEndingFrom` is exact. It also reads future periods, which is harmless (`shared.ts:1213-1226`).
  - The 10-wide hydration pool keeps page order (`convex/hr/pagination.ts:398-415`).
  - Legacy requests that are not ready now get `LIMIT_EXCEEDED` (`convex/hr/roster.ts:448-451`), which closes the iteration-6 crash path.
  - **Measured:** 84 docs on both datasets. The request without a page size returns 647 KB, because the legacy answer serializes the rows twice (`...page` and `employees`, `roster.ts:466-467`). Finding 7 covers this.
- **54b4149b: self-healing building readiness and budgeted backfill. Verdict: correct.**
  - **Readiness check.** `complete` and `buildingMismatch` are required fields, written on every summary row. Two `take(1)` probes over the new indexes replace the sticky flags (`zoneOccupancy.ts:455-472`).
  - **Recovery.**
    - A mismatch clears on the next tracked write.
    - An overflowed zone clears only through the sweep's `recheckZone`, at most 10 per warehouse per hour, always taken in index order.
  - **Backfill resume.** It re-paginates the same page and skips zones already done. Each rebuild replaces the zone's row, so a resume never double-counts.
  - **Measured:** building occupancy reads 21 docs and inventory 35, both unchanged.
  - **Small issues:**
    - `run.buildingReady` still reports the sticky flags. Use the internal `health` query instead.
    - `decodeResume` rejects a resume token that lists more than 50 done zones (`convex/storageLayouts/zoneOccupancyBackfill.ts:43`). That happens only with `batchSize` 50 and zones deleted mid-page. The sweep uses 20.
- **Profiler (02cc7c13, 38f4d044, cec81afb). Verdict: adequate, with caveats.**
  - The digest is verified.
  - Each target is subscribed with its own client's arguments (`baseArgs`). Three-round bursts and a cross-product burst were added.
  - XL is a real 5× growth of scan history and employees.
  - **Caveats:**
    - The picker probe measures only a miss.
    - The `reserve` fan-out lands in the viewed zone.
    - Latencies of the recommendation rows are inflated by load. On the same rows base took 2,710 ms, and iteration 6 measured 170–181 ms.
    - The "Function execution timed out (1s)" note on `recommendMove (full payload)` is the candidate's `lastError` while `errors` = 0. It most likely comes from the warm-up call, and the report attaches it without saying so.
    - Base search return bytes (22 KB) are summed over 22 requests, so they cannot be compared with the candidate's 3.9 KB.
- **Tests run.** In `/Users/macbook/Development/industrial-sas-convex-perf` (HEAD 60dd3979, `convex/` and `tests/` clean):
  - `hr-roster-read-cost`, `hr-roster-paging` and the readiness and backfill cases of `storage-query-scale` passed.
  - `location-search-index`:
    - "reads the needle's postings" passed. Its printed reads match the documented table; for example "R0" is 203 matches, 886 against 1,286 docs.
    - "keeps postings exact through tracked layout writes, renames and deferred work" passed.
    - The parity case printed `{"needles":60,"compared":114}` but then hit vitest's 600 s test timeout (1,060 s wall time on this loaded machine). So it did not pass in my run.
  - `job-scan-search-index`: it did not finish before my 30-minute background limit killed the run. **I could not confirm it passes.** The real-engine parity (0 mismatches over 537 traversals) is therefore the evidence I rely on for job-scan exactness, together with my code reading above.

## Findings (ranked by impact, max 10)

### 1. Put-away and move recommendation still reads every active zone and re-runs on every held-placement write (partially resolved)

- **Location:**
  - `convex/finishedGoods/workflow.ts:1235-1315` (`recommendations`) and `690-910` (`locationContext`).
  - Callers: `PalletScreens.tsx`, `MoveScreen.tsx`, `PlacementEditor.tsx`.
- **Evidence:**
  - **Measured:** the list reads 687–688 docs and 1,284 KB and returns 128 KB (was 238 KB).
  - **Measured:** `reserve` and `cancel` re-run both lists at 688 and 689 docs, about 2.6 MB re-read.
  - **Measured:** exec p50 is 700–1,029 ms on the loaded L run against 160 ms on the idle XL run. A 1 s timeout was logged on one sample.
  - **Inferred:** the cost grows with the zones in active buildings, not with history.
- **Cost mechanism:**
  - For each zone it reads the positions, one location per position, and the entries row.
  - Any held-placement write in the warehouse rewrites an entries row that every list subscriber reads.
- **Fix:**
  - Precompute per-zone surface rows (positions × locations), maintained by layout writes, with a backfill.
  - Keep a per-zone "fits product class" summary maintained with the entries row, so the list reads one small row per zone.
  - Optionally rank on the server, return the top N with a count, and depend on a per-building occupancy version.
- **Expected impact and risk:** about 5–10× fewer bytes and narrower re-runs. Moderate risk; the existing split-parity fixtures cover it.

### 2. The search indexes trust a "ready" flag that code which does not maintain them cannot clear (new, correctness of results)

- **Location:** `convex/lib/jobScanSearch.ts:127-137`, `convex/lib/locationSearch.ts:48-67`, `convex/finishedGoods/searchIndexBackfill.ts:286-319`, `docs/operations/search-index.md`.
- **Evidence (inferred):**
  - The sweep skips warehouses whose readiness is current.
  - Code that does not maintain the index may be deployed after a build: main, or any commit before 11b2cc10. Job scans it saves or corrects, and locations it changes, then get no postings.
  - When the index code returns, readers silently miss those rows, and nothing rebuilds the index.
  - The runbook's manual `invalidate` is the only guard. The totals store at least had the legacy-generation check (my iteration-6 8a).
- **Cost mechanism:** missing search results, not cost. A missed scan stays unfindable by text until an operator invalidates the index.
- **Fix:** make the hourly sweep reconcile by watermark.
  - Re-index scans and locations whose `updatedAt` or `_creationTime` is later than the last sweep's watermark. This catches any writer. Deletes are harmless: leftovers only add candidates.
  - Alternatively, have CI call `invalidate` on every deploy whose previous digest lacks the maintainer.
- **Expected impact and risk:** closes the gap for a bounded hourly cost (the rows written since the last sweep). Low risk.

### 3. `hr/periods:preview` reads every site employee to decide that it is "paged" (new; missed before)

- **Location:** `convex/hr/periods.ts:480-495`, `convex/hr/periodData.ts:83-95`, `convex/hr/shared.ts:1154-1194`.
- **Evidence:**
  - **Measured:** 164 docs on L and 776 on XL (765 employees), returning 0.8 KB.
  - **Inferred:** `employeesInRange` calls `reader.all(budget)` and only then filters `employedInRange` and compares with `MAX_PREVIEW_EMPLOYEES = 50`.
- **Cost mechanism:**
  - Reads are O(site employees) per preview.
  - The subscription re-runs on any employee write at the site.
- **Fix:** scan in chunks and stop as soon as 51 employed rows are seen. Better, store `employeeCount` on the period draft so the decision is one read. Other `siteEmployeesInRange` callers with a small limit benefit too.
- **Expected impact and risk:** 776 → about 60 docs. Low risk.

### 4. Search postings amplify job-scan writes (new; accepted trade-off)

- **Location:** `convex/lib/jobScanSearch.ts:326-497`, `convex/lib/searchIndexWrites.ts`.
- **Evidence:**
  - **Measured, write docs (base in brackets):**
    - 1-item save: 28 (4).
    - 50-item save: 1,253 docs, 5,268 index rows, 184 ms (53 docs, 15 ms).
    - Update: 31 written, 89 read (4 written, 13 read).
    - Delete: 24 (4).
  - **Measured in `convex-test`:** deleting 30 tickets writes 843 docs.
  - **Measured in `convex-test`:** for very common needles the index path reads more than the scan (276 against 125 docs for "box-0").
  - **Inferred:** a mass layout import costs about 4 reads plus 1 write per touched location even after the 1,500-write budget is spent (`convex/lib/locationSearch.ts:166-187`). This is unmeasured.
- **Fix:**
  - Keep the budget. Measure a large layout import and a 100-ticket delete.
  - Consider posting only grams of fields users actually search fragments of. Building and part names are already shared terms.
- **Expected impact and risk:** none now. This is a watch item.

### 5. Building inventory still carries whole-building, full-document payloads (open, old 7)

- **Evidence:** **Measured:** 35 docs, 964 KB read and 447.8 KB returned. Each `reserve` writes 9.7 KB (base 7.2).
- **Fix:** project the entries copies to the fields readers use, and add a per-floor inventory query.

### 6. Catalogue: sorted first pages still re-run on every finished-goods write (partially resolved)

- **Location:** `convex/lib/cataloguePagination.ts:131-136, 275-277`.
- **Evidence:**
  - **Measured:** reserve and cancel re-run 2 pages (145 docs), not 3 pages plus batches and legacy units (iteration 6: 321 docs).
  - **Inferred:** a sorted, unfinished first page embeds the token.
- **Fix:** bind sorted continuations to the token value read at continuation time, by validating on resume only, or scope the token per product.

### 7. Roster leftovers for clients that predate paging (partially resolved, old 5b; low)

- **Location:** `convex/hr/roster.ts:415-418, 448-468`.
- **Evidence:**
  - **Measured:** the request without a page size returns 647 KB for 50 employees. The rows are serialized twice (`page` and `employees`).
  - **Inferred:** with more than 50 matching employees, a legacy client silently sees the first 50, where main refused with `LIMIT_EXCEEDED`.
- **Fix:** for legacy callers, return `employees` without `page`, and answer `LIMIT_EXCEEDED` when `!isDone`.

### 8. A per-warehouse sequence document serializes pallet creation (open; accepted by design)

- **Evidence:** **Measured:** 8 same-product creates × 3 rounds take 47 retries (base 43). Different products take 41 (base 45).
- **Fix:** only with a code-format change or gaps. The notes' reasoning for rejecting split sequences is sound.

### 9. Readiness and backfill rough edges (new, low)

- Overflowed zones recover at most 10 per warehouse per hour, always taken in index order.
- `run.buildingReady` reports the sticky flags rather than what readers actually do.
- `decodeResume` can reject a valid token after mid-page zone deletes when `batchSize` is 50.
- The staging LOCAL-DRAFT building insert skips search invalidation (`convex/staging/annexDemo.ts:494`).
- All of these fail safe.

### 10. Expensive whole-warehouse legacy endpoints are still public (open)

- **Evidence:**
  - **Measured:** `getStorageBuilding` 1,844 docs, `workflow:list` 1,440, `getStorageLocationMap` 936.
  - **Inferred:** none has a live subscriber.
- **Fix:** retire them.

## Already good (brief)

- **Text search is index-backed, exact and parity-gated.** Every candidate is re-matched, with readiness fallback, budgeted writes and an always-searched deferral. Rare needles cost O(matches) on both datasets.
- **The catalogue is cheap.** The summary is 18 docs, unsorted first pages no longer re-run, and the totals build is serializable and works at any size.
- **Occupancy-derived reads stay low and now self-heal:** 21 docs for building occupancy and 35 for inventory.
- **The roster reads per page, not per site,** with about 4× fewer index queries.
- **Write contention is flat or better than base.** Distinct-pallet measurement edits take 3 retries against base's 15, and job-scan saves 0.

## What would raise the score to 9+

- **Make recommendation O(displayed)** with per-zone surfaces, per-zone fit summaries and a narrower reactive scope (finding 1).
- **Make the derived search stores robust to rollbacks:** a watermark reconcile in the sweep (finding 2).
- **Bound HR previews by the page, not the site** (finding 3). Re-check the other `siteEmployeesInRange` callers on XL.
- **Project the inventory and entries payloads** (finding 5), and **bind sorted catalogue continuations without subscribing first pages to the token** (finding 6).
- **Measure what is still unmeasured:**
  - a picker search that hits;
  - a write in an unrelated zone with the zone preview open;
  - a large layout import and a mass ticket delete under the search budget;
  - mid-month roster pages;
  - search latency on a cloud deployment.
