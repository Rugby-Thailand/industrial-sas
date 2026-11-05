_Retrospective standalone review of iteration 5, written 2026-11-05 by Claude Opus 5.5 through the Kiro CLI. It scores only the frozen snapshot `c9d39c91` and its profile `evidence/iter5.md`/`.json`. Iterations 5 and 6 were previously reviewed together at the iteration-6 snapshot; this file supplies the missing standalone iteration-5 score. I started from my own `audits/iter4-opus.md`. I did not read the Sol audits, any later audit or evidence, or the working-tree backend. Source was read with `git show c9d39c91:<path>`. No tests, backend calls or deployments were run. Line numbers refer to `c9d39c91`._

## Score: 6/10

- **The catalogue summary now answers from maintained totals in one request (measured).**
  - `finishedGoods/catalogue:summary` read 18 docs and 6.9 KB in 1 request. Base read 272 docs and 136.9 KB over 2 requests. Exec p50 was 10.0 ms against 49.2 ms on base.
  - The fast path is `convex/finishedGoods/catalogue.ts:550-565` over `convex/lib/warehouseTotals.ts:117-154`. It reads the readiness row plus at most 8 shard rows.
- **Catalogue reactivity narrowed for placement writes (measured).**
  - `reserve` and `cancelReservation` no longer re-run `productSummary` or `summary`. Iteration 4 re-ran both, at 17 and 15 docs. Re-runs per reserve fell from 10 queries to 8, and re-read docs from 1,735 to 1,718.
  - The client follow-up chain after a write is gone. Iteration 4 needed 2 extra requests and 282 docs for reserve and cancel, and 284 docs for createPallet. Iteration 5 needs 0.
  - The full reactive cost of a `createPallet` fell from 642 docs (358 re-run + 284 follow-up) to 364.
- **The paths that hold the score in the 5–6 band did not change (measured).**
  - Job-scan search: 2,389 docs over 22 requests.
  - Picker `searchPage`: 896 docs to return 0.8 KB.
  - `recommend`/`recommendMove`: 687/688 docs and 1.28 MB, re-run on every reserve and cancel.
  - `hr/roster:roster` still returns `LIMIT_EXCEEDED`.
  - The improved query was already one of the smaller catalogue costs, so the rubric band does not move.
- **The new totals are correct for the semantics the scan defined (inferred, guarded by a parity test).** Writers maintain them in the same transaction as the per-product summaries. The backfill is serializable. The reader falls back to the scan when the totals are missing or suspect.
- **The totals cost more on writes than the code comment claims (inferred, unmeasured).** Every changed contribution writes a product-hashed shard twice, including net-zero edits. Writers of different products that hash to the same shard now conflict. The contention probe cannot see either effect, because its writes leave contributions unchanged (new finding 7).
- **The measured code is the audited code (verified).**
  - I recomputed the harness digest (`scripts/performance/convex/profile.mjs:730-749` at `c9d39c91`) from git objects for every `convex/` file in the `c9d39c91` tree, 193 files. It gives `be40ad7cfa789fc2`, the candidate digest recorded in `iter5.json`.
  - `db92906a..c9d39c91` adds or modifies `convex/` files and deletes none. The "db92906a+dirty" worktree therefore hashes exactly like `c9d39c91`: tracked files plus the two untracked new files.
  - `db92906a`'s own tree hashes to `4352442e2b921f72`, so the profile did not measure plain `db92906a`. Base `80dc0a93` recomputes to `a486b726209f5b84`, which matches.
  - The profile finished at 2026-11-04T16:52:22Z, and `c9d39c91` was committed 44 s later (23:53:06 +0700) together with the evidence files.
  - Caveat: the record shows `backend: "unknown"`, so the engine build cannot be confirmed from the evidence.

## Changes since last audit

- **Maintained warehouse totals plus a one-request summary fast path. Verdict: correct; the cost side is understated (see finding 7).**
  - _Files:_ `convex/lib/warehouseTotals.ts`, `convex/lib/finishedGoodsSummary.ts:66-73, 332-349, 395-399, 419-431`, `convex/finishedGoods/catalogue.ts:550-565`, `convex/schema.ts:517-535`.
  - _Exactness on the counter fields (inferred):_
    - Every product-summary delta goes through `adjust` (`finishedGoodsSummary.ts:48-86`). `adjust` now applies the same signed contribution to the product's totals shard in the same transaction (`66-73`).
    - The four totals fields are therefore always the sum of `stored`, `awaitingMeasurement`, `awaitingStorage` and `moving` over all product summaries. That is exactly what the scan path adds up (`catalogue.ts:645-662`).
    - The scan path reads all products through `by_orgId_warehouseId_sku` with no status filter. The backfill counts the same set (`totalsBackfill.ts:41-47`).
  - _Product count and units (inferred):_
    - The tracker records each product's pre-mutation `{warehouseId, unit}` on its first write. An insert records `null` (`finishedGoodsSummary.ts:337-349, 395-399`).
    - The flush compares that with the final row and applies `products ±1` and unit reference counts (`419-431`). Insert, unit change and delete are all covered. A product inserted and then patched in one mutation keeps `null` as its before-state, which is correct.
    - The scan and the totals reader both skip falsy units and sort with the default comparator (`catalogue.ts:660-663`, `warehouseTotals.ts:149-152`). The resulting lists are equal whenever the reference counts are exact.
    - No mutation patches `warehouseId` on products (the upsert fields at `workflow.ts:345-361` omit it), so the flush's single-warehouse attribution is safe.
  - _Result shape (inferred):_ the fast path returns `{status: "ready", totals, isDone: true, continueCursor: "", scanned: products}`. That equals the scan's final page (`catalogue.ts:664-682`). The test compares the two with `toEqual`.
  - _Tenant isolation:_
    - The totals table is registered in `TENANT_TABLES` (`schemaPolicy.ts:36`). Its index is org-prefixed (`schema.ts:535`).
    - Reads and writes go through `tenantDb`, and the e2e reset deletes the rows (`e2eFixture.ts:349`).
    - Both new functions are `internal` (`tests/fixtures/public-function-contract.json`).
  - _Measured effect:_ `summary` dropped from 272 docs/2 requests to 18/1. It no longer re-runs on reserve or cancel, because both stay `awaitingStorage` and `reconcileUnitContribution` returns early (`finishedGoodsSummary.ts:128-136`). The 2-request client follow-up chain after writes went to 0.
  - _Write cost (measured):_ the `createPallet` row in the reactive fan-out table went from 21/8/6.4 KB (iteration 4) to 27/9/6.9 KB (docs read / docs written / KB written). The code explains the totals-shard lookup and one more written doc. I cannot attribute the remaining read increase from the code. Rows for reserve (37/9) and saveMeasurement (23/5) are unchanged. The profile's saveMeasurement leaves its contribution unchanged, so it never touches totals.
- **`productSummary` reads the readiness row instead of the continuation token (`catalogue.ts:52-61, 532-536`). Verdict: correct; this resolves the `productSummary` part of my finding 3.**
  - `readSummary` uses only `ready`, `version` and `warehouseId` (`finishedGoodsSummary.ts:246-255`). Dropping `generation` changes no output.
  - Measured: it no longer re-runs on reserve or cancel. It still re-runs on createPallet, which correctly changes its value. This was the uncommitted fix I declined to credit in iteration 4. It is in this commit and measured, so it is credited now.
- **Totals backfill `run` (`convex/finishedGoods/totalsBackfill.ts:25-99`). Verdict: correct, with a hard size cap.**
  - It runs in a single transaction. It reads every product and its summary, then the existing shard rows, then `replace`s or inserts all 8 shards and stamps `totalsVersion`/`totalsGeneration` on readiness (`80-96`).
  - Any concurrent product, summary or shard write intersects that read set, so OCC makes the build serializable, as the header comment claims. Racing runs serialize on the same rows.
  - The tenant is derived from the warehouse (`29-35`).
  - Above `MAX_TOTALS_BACKFILL_PRODUCTS = 2,000` the `.all()` cap throws and the run returns `TOO_MANY_PRODUCTS` (`39-50`). Such warehouses stay on the scan permanently (finding 7).
- **Hourly sweep (`totalsBackfill.ts:102-142`, `crons.ts:17-22`). Verdict: correct, bounded.**
  - It pages 50 warehouses per transaction, schedules the next page first and schedules `run` only where totals are not current.
  - Freshness gap: nothing schedules `run` when summaries become ready or after a generation bump. The fallback scan therefore serves for up to an hour (finding 7).
- **Rollback guard (`warehouseTotals.ts:121-127`). Verdict: correct for `main`; not a guard against iterations 2–4.**
  - `main`'s tracker bumps `readiness.generation` on every write (`80dc0a93:convex/lib/finishedGoodsSummary.ts:331-336`), so writes by main make the totals non-current. The second test simulates exactly that.
  - The iteration 2–4 trackers (`d84cb789`..`db92906a`) do not bump the generation. A deployment rolled back to one of them would not trip the guard.
  - Inferred: Convex's default schema validation should refuse any of those rollbacks while readiness rows carry `totalsVersion`/`totalsGeneration`, which earlier schemas do not declare (`schema.ts:517-520`). So this is defense in depth. It is not a live hazard.
- **Harness and seed (`profile.mjs:85-99`, `scripts/seed-local-test.mjs:138-139`). Verdict: adequate for this measurement, but fragile.**
  - The profile runs `totalsBackfill:run` with `stdio: "ignore"`, swallows every error and never checks `built: true`.
  - A failed build would silently measure the fallback. The 18-doc/1-request row shows the build did succeed here.
  - No profile flow compares fast-path values with the scan on the real fixture, so value parity rests on the integration test alone.
  - The contention probe's saveMeasurement comment ("unchanged quantities", `profile.mjs:636-637`) means it never exercises the new shard rows.
- **Tests (`tests/integration/finished-goods-warehouse-totals.integration.test.ts`). Verdict: they guard the main parity claim.**
  - Covered (`152-194`), with 123 products so that the scan needs more than one chunk:
    - Parity against the scan through a tracked insert, a unit change, a status change and a pallet delete.
    - One request, and fewer docs than the scan.
  - Covered (`196-214`): fallback after a generation bump, and trust restored by a rebuild.
  - Not covered:
    - A pallet's `productId` changing across shards.
    - A quantity-only edit.
    - `TOO_MANY_PRODUCTS`.
    - The sweep.
    - Concurrent build versus writer. `convex-test` serializes transactions, so it cannot exercise that case anyway.
  - I did not run the tests.
- **Measurement noise worth noting.**
  - `createPallet (same product)` contention went from 22 executions/14 retries (iteration 4) to 25/17. Base went from 20/12 to 22/14.
  - Same-product writers already serialize on the product-summary row and the pallet counter, and load was higher (load average 28.8/46.1 against 13.0/8.1). I read the change as noise.
  - The write-flow `cancelReservation` read count fell from 35 to 32 with no code reason. The fan-out row for the same function is 35 in both iterations.

## Findings (ranked by impact, max 10)

### 1. Put-away recommendation still reads, returns and re-runs for the whole warehouse (open; unchanged)

- **Location:** `convex/finishedGoods/workflow.ts` (`recommendations`, `locationContext`; unchanged in this diff). Callers: `PalletScreens.tsx`, `MoveScreen.tsx`, `DestinationPicker.tsx`.
- **Evidence (measured):**
  - `recommend` read 687 docs and 1,283.7 KB, and returned 238.3 KB. Base read 2,886 docs.
  - A reserve or cancel re-runs `recommend` (688 docs) and `recommendMove` (689 docs). Together that is about 2.6 MB of the 2,745 KB re-read for one screen.
- **Cost mechanism:**
  - Each active-building zone reads its positions, one location per position, and an entries row.
  - Any placement write in the warehouse rewrites an entries row that every subscriber reads.
- **Fix:**
  - Move the preview payload (`previewSupports`, `occupied`, `unavailable`) into a per-zone detail query.
  - Precompute per-zone surfaces, maintained by layout writes and built by a backfill.
  - Rank server-side, return the top N, and depend on a per-building version.
- **Expected impact and risk:** about 10× fewer docs and bytes, plus narrower re-runs. The detail split is low risk; precompute and ranking are moderate risk and need the existing parity tests.

### 2. Job-scan text search scans job-scan history (open; unchanged)

- **Location:** `convex/finishedGoods/jobScans.ts` (`listJobScans` search path), `convex/lib/boundedRecordPage.ts`.
- **Evidence:**
  - Measured: 2,389 docs and 1,541 KB over 22 requests. This is still the largest read in the profile.
  - Inferred: the cost is about pageSize divided by match rate, so it is worst for rare needles.
- **Fix:**
  - Add a trigram posting table on ordinary indexes, `[orgId, warehouseId, (mapped,) gram, createdAt, scanCreationTime]`.
  - Choose the rarest gram by parallel `take(k)` probes, re-verify each candidate with `jobScanTextMatches`, and keep the bounded scan for needles under 3 code points.
  - Index asynchronously behind a watermark with an exact tail scan. Gate the result with `search-parity.mjs`.
- **Expected impact and risk:** rare needles drop from O(history) to O(postings + page). Writes grow by about 100 postings per scan. The ordering and the building-name merge need the parity gate.

### 3. Catalogue lists still re-run on every finished-goods write (partially resolved further)

- **Location:** token readers at `convex/finishedGoods/catalogue.ts:62-75` (used by `page`), `convex/finishedGoods/batches.ts:454, 504`. The writer is at `convex/lib/finishedGoodsSummary.ts:451-456`.
- **Evidence (measured):**
  - Resolved this iteration: `productSummary` and `summary` no longer re-run on reserve or cancel, and post-write follow-up requests are 0 (were 2, about 282 docs).
  - Still re-run on reserve, cancel and createPallet: `catalogue:page`×3 (274–276 docs), `pageProductBatches` (18) and `pageLegacyUnits` (39–40).
- **Cost mechanism:**
  - The change-shard range `[orgId, warehouseId, *]` is a warehouse-wide dependency for every list request, first pages included.
  - Any write also resets in-progress list scans. Main behaves the same way.
- **Fix:**
  - Scope the batch and legacy-unit tokens per product, for example a `(warehouseId, productId, shard)` counter.
  - Read the token only on continuation requests: a first page embeds the token in the cursor it issues instead of subscribing to it.
- **Expected impact and risk:** removes about 330 re-read docs per open catalogue screen per unrelated write. Low risk, covered by the change-shard and pagination tests.

### 4. Job-scan location picker search joins every location row (open; unchanged)

- **Location:** `convex/finishedGoods/jobScanLocations.ts` (`searchPage`).
- **Evidence:** measured 896 docs and 474.3 KB over 2 requests, to return 0.8 KB.
- **Fix:** denormalize the position/zone label and `buildingId` onto `locations` and filter within the row, which needs a backfill. Alternatively, use a small-scale version of finding 2's posting table.

### 5. Derived-occupancy readiness: sticky degradations (open; unchanged)

- **Location:** `convex/storageLayouts/zoneOccupancyBackfill.ts` (sweep), `convex/lib/zoneOccupancy.ts`.
- **Evidence (inferred):**
  - `overflow` and `blocked` clear only on a restart, and the sweep skips ready warehouses.
  - One transient over-limit zone, or one repaired cross-building placement, keeps `buildingOccupancy` (measured 21 docs, base 917) and inventory (35, base 1,829) on the slow path indefinitely.
- **Fix:** have the sweep re-probe `overflow`/`blocked` warehouses daily, and add an admin health query.

### 6. Building inventory and entries rows: few docs, whole-building bytes (open; merged from my old findings 6 and 7)

- **Location:** `convex/storageLayouts/catalogue.ts` (`getStorageBuildingInventory`), `convex/lib/zoneOccupancy.ts` (entries copies), `convex/schema.ts` (entries table).
- **Evidence (measured):**
  - Inventory reads 35 docs but 964.1 KB, and returns 447.8 KB.
  - A reserve writes 9.4 KB, against 7.2 KB on base.
  - Bytes fall much less than docs (`recommend` 1,818 → 1,284 KB).
- **Cost mechanism:** entries rows carry full placement documents, including audit, QR and identity fields that readers never use. Any placement write in the building re-reads every held zone's row.
- **Fix:** project entries down to the fields that readers and `scope.placement` use. Add a per-floor inventory query, and a profile flow that asserts 0 entries writes for a fact-neutral edit.
- **Expected impact and risk:** roughly half the read and write bytes. Low risk under the parity tests.

### 7. Maintained totals: unconditional double shard writes, new cross-product conflicts, a size cap and a freshness gap (new)

- **Location:**
  - `convex/lib/finishedGoodsSummary.ts:66-73, 137-138` (two `adjust` calls per changed contribution).
  - `convex/lib/warehouseTotals.ts:28-33, 90-114`.
  - `convex/finishedGoods/totalsBackfill.ts:39-50, 102-142`.
- **Evidence (inferred unless marked):**
  - _Double and zero-delta writes:_
    - A changed contribution calls `adjust(previous, -1)` and then `adjust(next, +1)`. Each call reads and patches a totals shard, even when every totals field nets to zero.
    - A quantity-only or format-only edit therefore writes the shard twice for no value change. Unless the engine elides an unchanged final value (I have not verified that it does), that edit re-runs every open `catalogue:summary` and adds an OCC write.
  - _Cross-product conflicts:_
    - The comment "Same product, same shard: totals add no conflicts beyond its summary row" (`warehouseTotals.ts:28`) holds only for same-product writers.
    - With 8 product-hashed shards, two concurrent status-changing writes on different products share a shard with probability 1/8. That conflict is in addition to the existing 1/8 random change-shard collision, so per-pair conflict odds rise from about 12.5% to about 23%. The affected writes are receiving, measurement, put-away and moves.
    - Measured: the profile cannot show this. Its distinct-pallet probe leaves contributions unchanged (`profile.mjs:636-657`), and its createPallet probe uses one product.
  - _Cap and wasted sweeps:_
    - Warehouses above 2,000 products never get the fast path.
    - The hourly sweep reschedules `run` for them every hour. Each run reads 2,001 products and fails, and no reason is persisted.
    - Below the cap, a build reads about 2 docs per product in one transaction and conflicts with any summary write. On a busy warehouse it can retry repeatedly.
  - _Freshness:_ after summaries become ready, or after a generation bump, the scan fallback serves until the next hourly sweep, up to 1 h. This is slower but correct.
  - _Hardening:_
    - The fast path skips the `version === VERSION` check that the scan applies through `readSummary` (`finishedGoodsSummary.ts:250-255`).
    - Staging seeds that insert products with raw `ctx.db` (`staging/annexDemo.ts:762`) do not move the generation, so after a build the fast-path product count and units could drift from the scan. This is staging only.
- **Fix:**
  - In the tracker, accumulate a net totals delta per `(warehouse, shard)` across the mutation and apply it once in `flush`, skipping zero deltas. That removes the double and zero-delta writes.
  - For the counter fields, either write to a random shard (readers sum all shards, so the product hash buys nothing for them) or keep product hashing and accept the conflicts.
  - Schedule `run` from `backfillProductSummaries` when it flips `ready`, and from the restart path.
  - Persist `TOO_MANY_PRODUCTS` on readiness so the sweep skips the warehouse. Or page the build under a `runId`, as the occupancy backfill does.
  - Check `readiness.version` in `readWarehouseTotals`.
  - Add a profile probe with 8 status-changing writes on distinct products.
- **Expected impact and risk:** small per write, but it sits on the receiving and put-away hot paths. Low risk, because the parity test can be extended to cover a product reassignment and a quantity-only edit.

### 8. HR roster fails above 50 employees (open; unchanged)

- **Location:** `convex/hr/roster.ts`, `convex/model/hr/roster.ts` (`MAX_ROSTER_EMPLOYEES`).
- **Evidence:** measured 162 docs, then `LIMIT_EXCEEDED` at 153 employees.
- **Fix:** paginate employees with a native cursor, filter during the scan, and read attendance days per page.

### 9. A per-warehouse sequence document serializes pallet creation (open; unchanged)

- **Location:** `convex/finishedGoods/workflow.ts` (`nextCode`), the `finishedGoodsCounters` table.
- **Evidence:** measured 8 concurrent same-product `createPallet` calls take 25 executions with 17 retries (base 22/14), RTT p50 455.8 ms.
- **Fix:** split the pallet and position sequences into separate rows. Allocate code blocks per session only if gap-free codes are not required.

### 10. Expensive whole-warehouse legacy endpoints are still public (open; unchanged)

- **Evidence:**
  - Measured: `getStorageBuilding` 1,844 docs, `workflow:list` 1,440, `getStorageLocationMap` 936.
  - Inferred: none has a live subscriber.
- **Fix:** retire them, or rebuild them on the split and derived queries.

## Already good (brief)

- The catalogue summary is O(1) in tenant size on the fast path: 18 docs, 1 request (measured). It falls back to the exact scan whenever the totals are not provably current.
- The totals build is a serializable single transaction. Tenant scoping, registration, e2e reset and internal-only visibility are all in place.
- `productSummary` depends only on its own rows (measured: no re-run on reserve or cancel).
- Everything I credited in iteration 4 is unchanged:
  - The exact sharded continuation token.
  - Single-owner occupancy backfill runs and the bounded sweep.
  - Building occupancy at 21 docs and inventory at 35 (measured).
  - Job-scan writes at 0 retries under 8 concurrent writers (measured).
- Provenance is verifiable: the content digest recomputes exactly from the commit's git objects.

## What would raise the score to 9+

- Make recommendation O(displayed): a detail query for the preview, precomputed per-zone surfaces, server-side top-N and projected entries copies (findings 1 and 6).
- Add exact index-backed substring search for job scans and the picker, using trigram postings, a watermark tail and the parity gate, and add roster paging (findings 2, 4 and 8). These remain the O(history) and limit-failure paths that keep the score at 5–6.
- Finish narrowing catalogue reactivity: per-product batch tokens, and token reads only on continuations (finding 3).
- Net, zero-skipping totals deltas, event-driven totals builds and a distinct-product contention probe (finding 7). Self-healing occupancy readiness (finding 5).
- Make the harness fail when a derived build fails, and add fast-path-versus-scan value parity on the profile fixture.
