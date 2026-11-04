## Score: 6/10

- **The catalogue summary now takes one small request (measured).**
  - `catalogue:summary` reads 18 docs and 6.9 KB in 1 request. Before it read 272 docs and 136.9 KB over 2 requests. Base is 49.9 ms; this is 11.4 ms.
  - After `reserve`, `cancelReservation` or `createPallet`, the client used to send 2 follow-up rescans (282–284 docs). It now sends none.
  - `reserve` and `cancel` re-run 8 queries instead of 10. `summary` and `productSummary` no longer re-run on placement-only writes.
- **The roster's limit failure is gone (measured and tested).**
  - On the 153-employee site, `hr/roster:roster` returned `LIMIT_EXCEEDED` after 162 docs. It now answers a 20-employee page in 1 request, at 85 docs and 131 KB returned.
  - The fixture month is only 4 days old, so it understates the cost. My `convex-test` run, with 20 recorded days per employee, reads 429–476 docs per 20-employee page and 1,059–1,166 per 50-employee page. That is still bounded by page size, not by site size.
- **Both changes keep behavior (inferred and tested).**
  - The maintained totals equal the scanned totals under every product and pallet write path I found. The backfill is serializable against concurrent summary writes.
  - The roster keeps eligibility, lock order, revisions, ordering and authorization. It passes a parity test against a snapshot captured from the old code.
  - The edge cases (findings 5 and 8) are small and fail safe, with one exception: a client that predates paging can crash on a scanning response.
- **The paths that keep the score in the 5–6 band are unchanged (measured).**
  - Job-scan search reads 2,389 docs over 22 requests and grows with history.
  - The picker `searchPage` reads 896 docs to return 0.8 KB.
  - `recommend` reads 687 docs and 1.28 MB, and re-runs with `recommendMove` on every placement write (1,377 docs).
  - `catalogue:page`×3 still re-runs on every finished-goods write.
  - This round removes one limit failure and one O(products) screen load. That puts the score at the top of the 6 band, not into 7: three screen paths still read in proportion to tenant size or history.
- **The measured code is the audited code (verified).**
  - I recomputed the harness digest (`scripts/performance/convex/profile.mjs:730-749`) over the snapshot's `convex/`. It gives `98e0162d6eb51ecb`, which equals the iteration-6 candidate.
  - The same digest over the c9d39c91 tree gives `be40ad7cfa789fc2`, which equals the iteration-5 candidate labelled `db92906a+dirty`.

## Changes since last audit

- **c9d39c91: maintained warehouse totals. Verdict: correct, with minor fail-safe gaps (finding 8).**
  - _How it works:_
    - Each product hashes to one of 8 rows (`convex/lib/warehouseTotals.ts:29-33`).
    - `adjust()` copies every summary delta into the product's totals row inside the same transaction (`convex/lib/finishedGoodsSummary.ts:66-73`).
    - The tracked writer records each product's warehouse and unit before its first write. At flush it applies the product-count and unit-count deltas (`finishedGoodsSummary.ts:333-349, 419-431`).
  - _Exactness (inferred):_ the scan computes, for the products in the warehouse, Σ summaries, the product count and the set of truthy units (`catalogue.ts:645-661`). The maintained rows equal that sum if four facts hold. I checked each one:
    - **Summary rows are written only in `adjust`** (`finishedGoodsSummary.ts:75, 80`; grep for all `finishedGoodsProductSummaries` writes).
    - **Every product and pallet write goes through the tracked db.**
      - The only product writes are the upsert at `workflow.ts:363, 367` and raw staging seeds. No code deletes products outside the e2e reset.
      - All pallet and move writes use `ctx.tenantDb` in audited mutations, which are wrapped at `tenantFunctions.ts:489-492`.
    - **A product never changes warehouse.** The upsert's `fields` omit `warehouseId` (`workflow.ts:345-361`).
    - **Pallets live in their product's warehouse.** `createPallet` resolves the product through `productOf(ctx, args)`.
  - _Unit semantics:_ the scan's `product.unit && …` matches the `before?.unit` / `after?.unit` truthiness. Both paths sort with the default sort. Per-shard counts stay non-negative because a product's unit always lands on that product's shard, and the reader drops counts ≤ 0.
  - _Serializability of the backfill (inferred):_
    - `run` reads, in one transaction, the readiness row, the warehouse's whole product range, each product's summary range by `productId`, and the existing totals rows (`totalsBackfill.ts:36-80`).
    - A concurrent summary insert or patch, product insert, readiness patch or totals insert lands in one of those read sets, so OCC orders it before or after the build.
    - Deltas that accumulated before the build are overwritten by `replace` (`totalsBackfill.ts:81-92`).
    - Duplicate totals rows cannot arise. First writers to a shard both read the empty `[warehouseId, shard]` range, so OCC serializes them.
  - _Rollback guard:_
    - Totals count only while `totalsGeneration === readiness.generation` (`warehouseTotals.ts:117-126`).
    - Main bumps `generation` on every tracked write (`git show 80dc0a93:convex/lib/finishedGoodsSummary.ts:331-336`). A restart or invalidate bumps it too (`staging/summaryBackfill.ts:24-28, 46-50`).
    - So writes by main make the reader fall back to the scan, and the hourly sweep rebuilds. This is tested.
    - It does not detect the intermediate branch commits d84cb789–db92906a, which no longer bump `generation` (finding 8a).
  - _Reactive scope (measured):_
    - `summary` now depends on the readiness row and 8 totals rows (`catalogue.ts:543-565`). `productSummary` depends on the raw readiness row and its own summary (`catalogue.ts:517-537`).
    - Fan-out confirms the narrowing. On `reserve` and `cancel`, whose contribution does not change, neither query re-runs.
    - On `createPallet`, both re-run, which is correct: `summary` at 18 docs and `productSummary` at 12 (was 17).
  - _Write cost (measured):_
    - `createPallet` rose from 21/8 to 27/9 (docs read / docs written). The extra write is the totals row. Code accounts for only about 1–2 of the 6 extra reads, so the rest is unattributed.
    - `reserve` (37/9), `cancelReservation` (32/8) and `saveMeasurement` (23/5) are unchanged, because the sampled calls do not change a contribution.
  - _Contention (measured, partly):_
    - Same-product `createPallet`: 12 retries (iteration 4: 14; base: 10). Its summary row already serializes these writers, so the totals rows add nothing here.
    - Distinct-pallet `saveMeasurement`: 3 retries (iteration 4: 3). But its write cost is unchanged, so the probe very likely never touches a totals row.
    - Conflicts between writers of different products that share a totals row (about 1/8 per pair, on top of the change shards) are unmeasured.
  - _Tests:_
    - `finished-goods-warehouse-totals.integration.test.ts` compares maintained and scanned totals on the same snapshot. It covers a build, a product insert with a new unit, a unit change, a pallet status change, a pallet delete, and the fallback after a legacy generation bump. It passes.
    - Not covered: `IN_TRANSIT` (`moving`), a pallet `productId` change, deltas that accumulated before the build, the sweep, and the `TOO_MANY_PRODUCTS` refusal. Interleaving cannot be exercised, because `convex-test` runs transactions serially.
- **c26e832f: server-paged roster. Verdict: correct for current clients; risky only for clients that predate paging (finding 5b).**
  - _Eligibility, lock order and revisions:_
    - The cell logic moved verbatim into `rosterRow` (`convex/hr/roster.ts:442-540`): RECORDED, then PERIOD_CLOSED, FROZEN, LEAVE_CLAIMED, and finally eligibility.
    - Old-site assignment rows keep only their revision. The plan of a recorded day is still shown as recorded.
  - _Employee set and order:_
    - The scan uses the same `by_orgId_warehouseId_code` lane and the same `employedInRange`, search and department predicates as the old `siteEmployeesInRange` plus filter (`shared.ts:1098-1149`).
    - Pages therefore concatenate to the old order. A test asserts this over 153 employees.
  - _Day lookup:_
    - The old code read the site's month of days and keyed them by employee and date (`shared.ts:1050-1095`). The new code reads each employee's month by `by_orgId_employeeId_businessDate` and keeps only the rows at this site (`roster.ts:459-475`). That is equivalent whenever an employee has at most one day per date at a site.
    - `holidaysInRange(first, last)` equals the old holidays filtered to the month's dates.
  - _Authorization (inferred):_
    - The query keeps the same `queryWithOrg` ADMIN spec and the same `siteOf` check.
    - The cursor is bound to the organization, actor, surface, criteria (site, month, search, department) and page size (`pagination.ts:203-208`, `cataloguePagination.ts:30-36`).
    - Carried IDs are re-read through tenant access and re-matched, including `employee.warehouseId === site._id` (`pagination.ts:386-392`, `roster.ts:398-403`).
  - _Tests:_
    - The parity fixture was captured from the old implementation. It contains every lock kind, both assignment kinds, a moved-in employee with an old-site row, and days recorded at another site. Page 1 at size 50 equals it under 6 sets of criteria.
    - Further tests cover paging, filters, page-size refusal and cursor reset. All pass.
  - _Measured:_
    - A 20-employee page: 85 docs, 1 request, 112 ms exec, 131 KB returned.
    - A request with no page size: 254 docs, 254 ms, 647 KB. It reads a 99-row chunk (`roster.ts:393-396`) to show 50 employees.
    - Base's 0.15 ms on the paged row is main rejecting `pageSize`, as expected.
  - _Reactive scope (inferred):_ the old grid read the whole site's month of attendance, so any attendance write at the site re-ran it. A page now depends only on its employees' ranges, plus the site's periods, holidays and shift catalogue.
- **Harness. Verdict: adequate, with two caveats.**
  - Digests verified (see the score bullets).
  - The roster row was measured on 2026-11-04 for month 2026-11. That means about 3 recorded days per employee, so it understates mid-month reads by about 5× (inferred, and consistent with the `convex-test` figures).
  - No probe exercises cross-product totals-row conflicts.
- **Tests run.**
  - I ran `pnpm exec vitest run` on `tests/integration/hr-roster-paging.integration.test.ts` and `tests/integration/finished-goods-warehouse-totals.integration.test.ts` in `/Users/macbook/Development/industrial-sas-convex-perf` (HEAD f4baced9, clean, with every reviewed file byte-identical to the snapshot).
  - Result: 2 files and 5 tests passed. Printed docs per page: size 20 gave 429, 429, 476, 448, 448, 448, 442 and 282; size 50 gave 1,059, 1,166, 1,062 and 72.

## Findings (ranked by impact, max 10)

### 1. Put-away recommendation still reads, returns and re-runs for the whole warehouse (partially resolved; unchanged)

- **Location:** `convex/finishedGoods/workflow.ts:1090-1230` (`recommendations`) and `690-910` (`locationContext`). Callers: `PalletScreens.tsx`, `MoveScreen.tsx`, `DestinationPicker.tsx`.
- **Evidence:**
  - Measured: 687 docs, 1,284 KB read, 238.3 KB returned (base 2,887 docs, 1,818 KB).
  - Measured: each `reserve` and `cancel` re-runs `recommend` and `recommendMove` at 688 and 689 docs, about 2.6 MB re-read for one screen.
- **Cost mechanism:**
  - Each zone in an active building reads its positions, one location per position, and its entries row.
  - Any held-placement write in the warehouse rewrites an entries row that every recommend subscriber reads.
  - The payload grows with the square of the supports in each zone.
- **Fix:**
  - Move `previewSupports`, `occupied` and `unavailable` into a per-zone detail query.
  - Precompute per-zone surfaces (positions × locations), maintained by layout writes, with a backfill.
  - Rank on the server, return the top N, and depend on a per-building occupancy version.
- **Expected impact and risk:** about 10× fewer docs and bytes, and narrower re-runs. The detail-query split is low risk. Precomputed surfaces and server ranking are moderate risk and need the existing parity tests.

### 2. Job-scan text search scans job-scan history (open)

- **Location:** `convex/finishedGoods/jobScans.ts:599-772`, `convex/lib/boundedRecordPage.ts`.
- **Evidence:**
  - Measured: 2,389 docs and 1,541 KB over 22 requests, unchanged. This is still the largest read in the profile.
  - Inferred: the cost is about page size divided by match rate.
- **Fix:** a trigram posting table on ordinary indexes, as detailed in my iteration-4 report.
  - Index posting rows per gram in `(createdAt, creationTime)` order, and pick the rarest gram by parallel `take(k)` probes.
  - Re-verify each hit with `jobScanTextMatches`, and keep the bounded scan for needles shorter than 3 code points.
  - Index asynchronously behind an `indexedThrough` watermark, scanning only the un-indexed tail exactly.
  - Gate it with `search-parity.mjs`, which must show 0 mismatches.
- **Expected impact and risk:** rare needles drop from O(history) to O(postings of the rarest gram). In exchange, writes are amplified and the posting table needs a backfill.

### 3. Every catalogue page subscription still re-runs on every finished-goods write (partially resolved: summary and productSummary narrowed)

- **Location:**
  - Token readers: `convex/finishedGoods/catalogue.ts:52-75, 382`, `convex/finishedGoods/batches.ts:454, 504`.
  - New writes: `convex/lib/finishedGoodsSummary.ts:66-73`.
- **Evidence:**
  - Measured: `catalogue:page`×3 (268–270 docs), `pageProductBatches` (16) and `pageLegacyUnits` (37–38) still re-run on `reserve`, `cancel` and `createPallet`.
  - Measured: `summary` and `productSummary` no longer re-run on `reserve` or `cancel`. That resolves part of the old finding.
  - Inferred: `adjust` patches the totals row even when the net change to the four counters is 0. Examples are a quantity-only or format-only contribution change, which applies −previous then +next. Such a patch re-runs `catalogue:summary` (18 docs) and widens the OCC surface for no visible change.
- **Fix:**
  - Scope the batch and legacy-unit tokens per product.
  - Read the token only on continuation requests.
  - In `reconcileUnitContribution`, compute one net delta per product. Skip `adjustWarehouseTotals` when every field is 0.
- **Expected impact and risk:** removes 1–3 re-runs per screen per write. Low risk, covered by the change-shard and totals parity tests.

### 4. Job-scan location picker search joins every location row (open)

- **Location:** `convex/finishedGoods/jobScanLocations.ts:663-757`.
- **Evidence:** Measured: 896 docs and 474 KB over 2 requests to return 0.8 KB, unchanged.
- **Fix:** denormalize the position/zone label and `buildingId` onto `locations`, or reuse the posting design from finding 2. Either needs a backfill.

### 5. Roster page: one frozen-plan point lookup per cell, a large payload, and a crash path for clients that predate paging (new)

- **Location:** `convex/hr/roster.ts:404-417, 442-540`, `convex/hr/shared.ts:751-767, 1151-1159`.
- **Evidence:**
  - a. **Measured:** exec p50 is 112 ms for a 20-employee page and 254 ms for the 50-employee request. Comparable list queries take 12–30 ms. Return size is 131 KB and 647 KB, about 6.5 KB per employee.
  - **Inferred:** every cell that is neither recorded nor period-closed runs its own `hasFrozenPlan` `.first()` lookup. That is up to 31 × page size index queries, 620 per 20-employee page.
    - These are invisible in docs-read when empty. Employees are hydrated sequentially (`pagination.ts:386-395`).
    - `sitePeriods` reads every site period (`all(MAX_SITE_PERIODS)`) on every page and re-runs every page on any period write.
    - These costs existed before. They become visible now that the roster answers.
  - b. **Inferred:** without `pageSize`, a request that does not fill 50 matches within its 99-row chunk returns `{ ok: true, status: "scanning", page: [] }` (`roster.ts:417`), with no `employees` or `dates`.
    - A narrow search on a site with more than 99 employee rows causes this almost always.
    - A tab that predates paging then evaluates `value.employees.length` on `undefined` and crashes (`git show db92906a:src/features/hr/ShiftsRoster.tsx:1005`).
    - Such tabs also now see only the first 50 employees without notice, where they used to get `LIMIT_EXCEEDED`.
    - This affects only the deploy-skew window, and saves stay validated by `assignRoster`.
- **Fix:**
  - Read `hrPeriodRows` once per employee, over `by_orgId_employeeId_businessDate` for [first, last], with a bound such as `take(dates × versions cap)`. On overflow, fall back to the point lookups.
  - Use `sitePeriodsEndingFrom(first)` instead of every site period.
  - Hydrate the page's employees with `Promise.all`.
  - Answer legacy requests that are not ready, or not done after 50 employees, with `{ ok: false, code: "LIMIT_EXCEEDED" }`, which old clients already render.
  - Optionally omit `plan` from a cell when it equals the schedule default.
- **Expected impact and risk:** roughly 30× fewer index queries per page, and lower latency. Low risk; the parity fixture covers the frozen-lock semantics.

### 6. Derived-occupancy readiness: sticky degradations (open: 5a and 5c from iteration 4)

- **Location:** `convex/storageLayouts/zoneOccupancyBackfill.ts:177-215`, `convex/lib/zoneOccupancy.ts:301-303, 351-406`.
- **Evidence (inferred):**
  - Only a restart clears `overflow` and `blocked`, and the sweep skips ready warehouses.
  - One transient 501-placement zone keeps `buildingOccupancy` (21 → about 917 docs) and inventory (35 → about 1,829 docs) on the slow path indefinitely.
- **Fix:** have the sweep re-probe flagged warehouses daily, and add an admin health query.

### 7. Building inventory and entries rows carry whole-building, full-document payloads (partially resolved; old findings 6 and 7 merged)

- **Location:** `convex/storageLayouts/catalogue.ts:571-660`, `convex/lib/zoneOccupancy.ts:39-58, 175-215`.
- **Evidence:**
  - Measured: inventory reads 35 docs, but 964 KB read and 447.8 KB returned.
  - Measured: a `reserve` writes 9.4 KB (base 7.2), and the reserve fan-out re-reads 2,742 KB.
- **Fix:**
  - Store only the placement fields that readers use.
  - Add a per-floor inventory query.
  - Add a fact-neutral pallet edit flow that asserts 0 entries-row writes.

### 8. Maintained totals: fail-safe gaps (new, low)

- **Location:** `convex/lib/warehouseTotals.ts:117-126`, `convex/finishedGoods/totalsBackfill.ts:25-142`.
- **Evidence (inferred):**
  - a. The rollback guard detects only code that bumps the legacy `generation`, which means main.
    - Deploying any branch commit d84cb789–db92906a after a build would maintain summaries without totals and stay "current".
    - Raw staging seeds (`staging/annexDemo.ts:762, 965…`) bypass both summaries and totals. `seed-local-test.mjs` invalidates first, so this is staging-only.
  - b. After a summary restart, or when product summaries first become ready, the summary falls back to the 272-doc, 2-request scan for up to 1 hour, until the sweep.
  - c. A warehouse with more than 2,000 products always uses the scan. The sweep re-runs a doomed `run` every hour, reading about 2,001 products each time (`totalsBackfill.ts:40-50, 120-138`).
  - d. `readWarehouseTotals` does not check `readiness.version === VERSION`, whereas the scan path refuses a version mismatch (`finishedGoodsSummary.ts:250-255`).
- **Fix:**
  - Have the final summary-backfill page schedule `totalsBackfill.run` directly.
  - Record `TOO_MANY_PRODUCTS` on readiness so the sweep skips the warehouse until its product count drops.
  - Add the version check.
  - If intermediate commits could ever be deployed, also stamp a totals-maintainer marker that pre-totals code cannot write.
- **Expected impact and risk:** correctness is unaffected today, and every gap except (a) falls back safely. Small changes.

### 9. A per-warehouse sequence document serializes pallet creation (open)

- **Location:** `convex/finishedGoods/workflow.ts:110-133`.
- **Evidence:** Measured: 8 concurrent same-product `createPallet` calls take 20 executions with 12 retries (base 18/10).
- **Fix:** separate rows for the pallet and position sequences. Allocate code blocks only if gaps are acceptable.

### 10. Expensive whole-warehouse legacy endpoints are still public (open)

- **Evidence:**
  - Measured: `getStorageBuilding` 1,844 docs, `workflow:list` 1,440 docs, `getStorageLocationMap` 936 docs.
  - Inferred: none has a live subscriber.
- **Fix:** retire them, or rebuild them on the split and derived queries.

## Already good (brief)

- **Catalogue totals are exact and cheap.** They are maintained in the same transaction as their source, built serializably, and fall back to the scan whenever they are suspect. Measured: 18 docs in 1 request, and no rescan after writes.
- **The roster works at any site size.** Reads per page scale with the page, not the site, and authorization and cursor binding reuse the audited HR scan helper. The parity check runs against a snapshot captured from the old code, not regenerated.
- **The sharded change token is still exact.** Distinct-pallet writers see 3 retries (base 11).
- **Occupancy-derived reads stay low.** Building occupancy reads 21 docs, inventory 35 and `recommend` 687, against base 917, 1,829 and 2,887.
- **Job-scan writes stay O(items),** with 0 retries under 8 concurrent writers.

## What would raise the score to 9+

- **Make recommendation O(displayed):** a detail query for the preview payload, precomputed per-zone surfaces, server-side top-N, and projected entries copies (findings 1 and 7).
- **Make substring search index-backed and exact for job scans and the picker:** trigram postings, a watermark tail scan and the parity gate (findings 2 and 4). These are the remaining O(history) and O(tenant) screen paths.
- **Narrow catalogue reactivity:** per-product batch tokens, token reads only on continuations, and no zero-delta totals writes (finding 3).
- **Make the roster cheaper:** one frozen-plan range read per employee, and a legacy-safe refusal for requests that are not ready (finding 5).
- **Make degraded states self-healing and observable** (findings 6 and 8).
- **Measure what is still unmeasured:** cross-product totals-row contention, a mid-month roster, `confirmScanAssignment`, and a fact-neutral pallet edit. Rerun on a fixture about 5× larger.
