# Convex performance audit, iteration 9

- **Auditor:** Claude Opus 5.5, via Kiro CLI. Nothing was delegated. I used no other model, Claude Code or provider tool, and I did not read Sol's audits.
- **Audited code:** `e8c7ac380f0db0585fac22d59b297e597ee80b08`. The workspace HEAD is that commit, and the only working-tree change is an untracked `report.html`, so I read the tree directly.
  - Iteration diff: `f9903ff9..e8c7ac38` (10 commits). It includes the HR exact-50 fix `2494a6a5`, which my iteration-8 report excluded.
  - Cumulative diff: `80dc0a93..e8c7ac38` (60 files under `convex`, `tests` and `scripts/performance`, +29,027 / −5,265).
  - Backend changes in this iteration: `convex/hr/pagination.ts` (+6), `convex/finishedGoods/searchIndexBackfill.ts`, `convex/storageLayouts/zoneOccupancyBackfill.ts`. Nothing else under `convex/` changed.
- **Method:** read-only. I made no source edits, ran no tests, made no backend calls or deployments, and ran no mutating git commands. This file is my only write.
- **The measured code is the audited code (verified).** I recomputed the profiler digest (`scripts/performance/convex/profile.mjs:995-1015`) from git blobs. `convex/` hashes to `a23837ec418f4a20` at `70994cb7`, `e8883ecc` and `e8c7ac38`. That is the candidate digest in `iter9.json`. Base hashes to `a486b726209f5b84`, matching main.
- **Evidence and how far it goes:**
  - `iter9.md`/`.json`: real local engine, dataset-L, **3 uncached samples** per query, load average 21.7. Query rows only. **Write flows, reactive fan-out and contention were not rerun** (their tables are empty), so every write, fan-out and OCC number below comes from iteration 8.
  - `iter9-reconcile-fixture.json`: **convex-test instrumentation, not the real engine.** It compares the reconcile transaction before and after the fix in a 101-building fixture. A maintained create went from 106 docs / 6 read calls to 8 docs / 10 calls. The scheduled whole-index rebuild that the old code triggered is excluded, so the fixture does not measure the main saving.
  - `iter9-building-real.json`: **one real-engine sample, after the fix only.** A maintained create in the 127-building warehouse, then reconcile: 9 docs, 3,676 bytes, 1 doc written, 24.4 ms, status `done`. There is no real-engine before sample.
  - `iter8-search-parity.json`: 537 traversals over 300 needles on the real engine, **0 mismatches**, at `a6fd4698`. Iteration 9 does not change any search reader, so this still applies to the readers. It is not a new parity run for iteration 9.
  - **Validation as reported, not re-run by me:** 50 focused tests pass in `storage-query-scale.integration.test.ts` and `search-reconcile-building-window.integration.test.ts`. The Convex typecheck and scoped lint pass. The broader job-scan and location search test files were still running, so their result is unknown. The full iteration-8 suite is **5,704 passed and 2 failed**: a catalogue-search timeout and a DesktopShell focus test, both intermittent and unresolved. **The suite is not all-green.**

## Score: 7/10

- **Iteration 9 fixes maintenance and availability. No screen query changed (measured).** Every candidate row in `iter9.json` has the same docs and bytes as in iteration 8. Examples: `recommend` list 438 docs, job-scan search 61, inventory 35 docs and 469 KB.
- **A maintained building create no longer rebuilds the job-scan index (fixture and one real sample).**
  - In the convex-test fixture, the reconcile now finishes in-transaction (8 docs, 10 calls). Before, it read 106 docs and scheduled a full rebuild.
  - On the real engine, a create in the 127-building warehouse reconciles for 9 docs with status `done`.
  - That the old code would have rebuilt on the real engine is inferred from the code and the building count. It was not measured.
- **Exact-50 legacy rosters are served again, and occupancy readiness can no longer hide a legacy write (inferred, with tests that failed before the fix).** These resolve my iteration-8 findings 2, 3 and 6. Real-engine search parity now exists (0 mismatches), so this score is no longer provisional.
- **What keeps it at 7:**
  - The recommendation list still reads about 2 docs per compatible zone (438 docs, 747 KB) and re-runs on reservations in other zones (iteration-8 fan-out: 440 docs).
  - A 50-scan delete reads 3,766 docs, against 160 on main (iteration 8), and the 300-id maximum is still unmeasured.
  - An over-budget layout change still turns off every occupancy reader in the warehouse.
  - The three legacy whole-warehouse endpoints still read 936–1,844 docs.
- **Improvements are not inflated.** Nothing about the remaining findings was measured in this iteration, and the plan documents (`iter9-plan.md`) did not affect the score.

## Changes since last audit

- **HR full terminal page (`2494a6a5`, `convex/hr/pagination.ts:373-379`). Verdict: correct; resolves old finding 3.**
  - When the current lane is exhausted and the page is full, the scanner asks the lane source for one following lane. If there is none, the page is marked done. Rows buffered beyond the page still keep `isDone` false (`:422`).
  - For the roster's static single lane (`convex/hr/roster.ts:409-415`), `source.after` reads no documents (`staticLanes`, `pagination.ts:197-199`). A dynamic source pays one bounded read.
  - The legacy chunk is `HR_MAX_CHUNK = 99` (`roster.ts:416-419`), so a 50-row site is read in one short page. That page is exhausted on any engine.
  - The new test checks 49, 50 and 51 employees ("returns the complete legacy roster at exactly 50 employees and refuses the 51st"). It guards the boundary.
  - _Measured:_ the profiled 153-employee site still refuses for 253 docs, against 162 on main. The 50-employee case is measured only in convex-test, where the empty follow-up request is gone (`iter8-validation.md`). It has no real-engine row.
  - _Missed in iteration 8:_ a related legacy refusal predates this fix (finding 4).
- **Search reconcile only re-derives new buildings (`70994cb7`, `convex/finishedGoods/searchIndexBackfill.ts:454-487, 568-580`). Verdict: correct; resolves old finding 2 for its trigger.**
  - _Selection:_ when the layout marker is current, the repair takes buildings with `_creationTime >= watermark` on `by_orgId_warehouseId`, capped at 101. A mismatched marker still re-derives the whole warehouse, as before.
  - _Coverage (inferred):_
    - The selection has no upper bound, so it also re-derives buildings from the last 30 s. That is idempotent.
    - The watermark moves only after the pass (`:666-668, 700-703`), so a building created after the window's end is selected again next time.
    - Builds set the watermark to start − 30 s (`:222-224`), so buildings created during a build are caught.
    - A missing reconcile row starts at watermark 0 (`:85`). It then selects every building and, above 100, rebuilds. That fails safe.
  - _Renames:_ maintained code renames buildings through the tracked flush, which moves the counter (`convex/lib/finishedGoodsSummary.ts:489-511`). Main does the same, so unmaintained renames take the full path. Raw renames by seeds were never covered; that is unchanged and documented.
  - _Tests:_ the four cases in `search-reconcile-building-window.integration.test.ts` (maintained, raw, 101 new, marker mismatch) assert the status and that the new name is indexed.
    - A regression back to the whole-warehouse read would turn the maintained case into `rebuilding`, so the test guards the bound.
    - The tests do not assert read counts. The fixture JSON records them.
  - _Measured:_ fixture 106 → 8 docs and 6 → 10 calls for a maintained create, 105 → 7 docs for a raw create. The overflow and mismatch cases are unchanged (105 and 106). The real engine, after the fix only, read 9 docs.
  - _Inferred:_ the avoided cost is one full re-index, plus history-scan searches until it finishes. On main's path those searches cost 2,389 docs over 22 requests on L and 10,352 on XL (iteration 8). Neither the rebuild nor that saving was measured in iteration 9.
  - The doc comment that said readers "keep merging" is fixed (`:500-501`).
- **Occupancy backfill captures generations at start (`70994cb7`, `convex/storageLayouts/zoneOccupancyBackfill.ts:139-164, 219-243`). Verdict: correct; resolves old finding 6.**
  - _Capture:_ the starting transaction stamps `summaryGeneration` and `layoutGeneration` before it builds the first page. Both are in the same transaction, so no write can fall between them.
  - _Follow (maintained writes):_
    - The surface flush rebuilds touched zones with the current `runId` (`convex/lib/zoneSurfaces.ts:458-476`).
    - It advances `layoutGeneration` only if the stamp equals this write's `before` (`:536-545`). With the stamp now set at start, a maintained write during a run follows the counter.
    - The test "follows maintained layout writes between backfill pages" checks that the run still ends ready, with occupancy parity.
  - _Poisoning (legacy writes):_
    - Main bumps `storageCatalogueSignals` and `finishedGoodsSummaryReadiness.generation` on every write (`git show 80dc0a93:convex/lib/finishedGoodsSummary.ts`, flush), and it never follows the occupancy stamp.
    - After such a write the stamp differs from the counter, so the finish sets `ready: false, stale: true` (`zoneOccupancyBackfill.ts:229-241`).
    - Poisoning is sticky. Take a legacy write (L→L+1) followed by a maintained one: the maintained write's `before` is L+1 while the stamp is still L, so it does not follow. Counters only increase, so the stamp cannot match again by accident.
    - Both orders are inferred from the code. The test "rejects a backfill whose %s generation changes between pages" covers a single legacy change of each kind, with batch size 1, so earlier pages are already built. No test covers a legacy write followed by a maintained one.
  - _Candidate-only operation cannot starve the backfill (inferred):_
    - Only the tracked flush bumps the layout counter (`finishedGoodsSummary.ts:489-511`, grep). It always either follows or poisons with an immediate restart (`zoneSurfaces.ts:519-535`).
    - The summary generation moves only on operator restarts or invalidation (`convex/staging/summaryBackfill.ts:22-30, 46-60`) and in the staging seed.
  - _Readers:_ readers already compare both generations (`convex/lib/zoneOccupancy.ts:686`, `zoneOccupancyBackfill.ts:309-317`). Rows of a poisoned run are never trusted.
  - _Minor:_ a poisoned finish does not schedule a restart, so the warehouse stays on the fallback until the hourly sweep (`zoneOccupancyBackfill.ts:281-345`). The runbook still says the run records the generation "on finishing" (`docs/operations/storage-zone-occupancy.md:122-123`). See finding 10.
- **Budget cap (`zoneOccupancyBackfill.ts:34, 113-115`). Verdict: correct.** Overrides above 500 are refused. With the default 500, a crossing zone costing about 3,500 still leaves room under the 4,096 read-call limit (comment at `:26-33`). The 3,500 figure is an estimate and has not been measured for a 500-pallet zone. No script or runbook passes a larger budget (grep). The test "rejects unsafe backfill read budget %s" covers 501, 16000, 0 and 1.5.
- **Profiler and setup (`47366fcc`, `ccaa15cc`, `a6fd4698`, `e8883ecc`). Verdict: adequate, with one wrong row.**
  - `e8883ecc` samples main with main's real arguments (`profile.mjs:311-324`). The iteration-8 base failures on the new argument shapes (`recommend` list: 0 docs, 7 errors) are gone: base now reads 2,886 docs.
  - **The "previous month" roster row has no `baseArgs`** (`scripts/performance/convex/scenarios.mjs:506-511`). Base failed 3/3 with `ArgumentValidationError: extra field pageSize`. `iter9.md` still prints a base exec of 0.14 ms without an error note. That number is a failed call.
  - The paged `hr/roster:roster` row compares candidate's answered page (84 docs, 131 KB) with main's `LIMIT_EXCEEDED` (162 docs). That is a different output, not a like-for-like saving.
  - `a6fd4698` halves the batch only on an explicit execution timeout, and only during parity setup. It does not change production defaults. The setup needed it because 10-row search backfill pages hit the real backend's 1-second limit under load (finding 5).
- **Cumulative versus main (measured in `iter9.json`, same run, docs read, candidate vs base):**
  - `recommend` list 438 vs 2,886. `recommendMove` list 439 vs 2,887.
  - Job-scan search 61 vs 2,389. Picker search 39 vs 896; picker hit 98 vs 900.
  - Inventory 35 vs 1,829 docs. Building occupancy 21 vs 917. Catalogue summary 18 vs 272. HR period preview 111 vs 164.
  - Worse than main: the legacy roster refusal, 253 vs 162.
  - Unchanged from main: `getStorageBuilding` 1,844, `workflow:list` 1,440, `getStorageLocationMap` 936, location detail 312, HR review queue 251, job-scan location options 218.
  - Latency with 3 samples at load 21 is indicative only. Example: job-scan search exec 52 ms against 699 ms on base.

## Findings (ranked by impact, max 10)

### 1. The recommendation list still reads every compatible zone and re-runs on writes in any of them (open, old 1)

- **Location:** `convex/finishedGoods/workflow.ts:1335-1447`, `convex/lib/zoneSurfaces.ts:311-350`. Callers: the put-away and move screens. Unchanged in iteration 9.
- **Evidence:**
  - **Measured (iteration 9, 3 samples):** 438–439 docs and 747 KB read per call, returning 128 KB. Base reads 2,886–2,887 docs.
  - **Measured (iteration 8 fan-out, not rerun):** reserving another pallet re-runs the stored pallet's `recommendMove` list (440 docs). The whole `reserve` fan-out re-reads 1,051 docs and 1.6 MB.
  - **Inferred:** about 2 docs per listed zone. The cost grows with the zones in active buildings. No dataset grows zones (L and XL both have 421).
- **Cost mechanism:** O(compatible zones) per call. Every held-placement write in a compatible zone re-runs every open list for that product.
- **Fix:** keep a per-zone fit summary (free area and height per surface class, plus an unmeasured flag), maintained in the same flush as the entries row and backfilled with the occupancy run. The list then reads one small row per zone and loads entries only for zones that can fit. Alternatively, rank on the server and return the top N with a count.
- **Expected impact and risk:** 2–5× fewer bytes, and re-runs only when a zone's fit changes. Moderate risk; the surface and occupancy parity tests cover the payload.

### 2. Job-scan deletes amplify reads about 24×, and the 300-id maximum is unmeasured (open, old 4)

- **Location:** `convex/lib/jobScanSearch.ts:245-268, 338-354, 395-549`. `deleteJobScans` accepts up to 300 ids (`convex/finishedGoods/jobScans.ts:51, 99-100, 583-603`). Unchanged in iteration 9.
- **Evidence:**
  - **Measured (iteration 8, L and XL; not rerun):**
    - A 50-scan delete reads 3,766 docs (1.2 MB) and writes 1,253 docs (5,368 index rows). Base reads 160 and writes 53.
    - A 50-scan save writes 1,253 docs. A single update reads 95 and writes 35, against 13 and 4 on base.
  - **Inferred:**
    - A linear extrapolation gives about 22,600 docs and 7 MB for 300 ids. That is below the 32,000-document limit, but read calls were never counted.
    - `collectIfOrphaned` reads before it checks the write budget, so released terms keep costing reads after the 1,500-write budget is spent.
    - convex-test does not enforce the 4,096 read-call limit (iteration-8 notes).
- **Fix:**
  - Measure a 300-id delete on the real engine, recording read calls.
  - Once the write budget is spent, push released terms to `deferredTerms` without reading them, and skip the search-row read for scans the orphan job already covers.
- **Expected impact and risk:** removes a possible hard failure at the selection limit. Low risk.

### 3. A layout change over the maintenance budget turns off every occupancy reader in the warehouse (open, old 5)

- **Location:** `convex/lib/zoneSurfaces.ts:519-535`. The budgets are 60 zones and 300 locations (`:46, 50`). Unchanged.
- **Evidence (inferred):**
  - A building status change touching more than 60 zones, or a write to more than 300 locations, sets occupancy readiness to `ready: false, stale: true`.
  - That turns off inventory, building occupancy and recommendations until a full rebuild finishes. Iteration 9 makes rebuilds stricter, because any legacy write during the run also poisons it. That is correct, but it lengthens the same window.
- **Cost mechanism:** fallback costs during the rebuild. **Measured (iteration 9, base paths):** inventory 1,829 docs, building occupancy 917, `recommend` 2,886.
- **Fix:** give surfaces their own validity (a surfaces generation or run), so over-budget layout changes invalidate only surfaces while occupancy rows stay trusted. Optionally, rebuild only the touched buildings' surfaces in chained pages.
- **Expected impact and risk:** the fallback is confined to recommendations during large layout edits. Low risk.

### 4. Legacy roster refusals are costly, and one pre-paging case is refused where main answered (partially resolved, old 3; the second case I missed in iteration 8)

- **Location:** `convex/hr/roster.ts:402-451`, `convex/hr/pagination.ts:267-393`.
- **Evidence:**
  - **Measured:** the 153-employee refusal reads 253 docs, against 162 on main (L). The shown 50 rows are hydrated (`pagination.ts:395-421`) before `roster.ts:450` refuses.
  - **Inferred, missed in iteration 8:**
    - Legacy calls read one chunk of 99 employee rows. Main read every site employee (up to `MAX_HR_EMPLOYEE_SCAN = 10,000`, `convex/hr/shared.ts:52`) and refused only above 50 employed in the month (`80dc0a93:convex/hr/shared.ts:1109-1130`).
    - A site with about 100 or more employee records, of which 50 or fewer are employed that month (former staff accumulate), gets `LIMIT_EXCEEDED` from the candidate. The unfinished scan returns `scanning` (`pagination.ts:392-393`), which legacy refuses.
    - This predates iteration 8. The `page.status !== "ready"` refusal exists at `60dd3979`.
    - No test covers it. The 153-row test asserts refusal only where main also refuses.
    - Only clients that predate paging are affected. The current client pages (`src/features/hr/ShiftsRoster.test.tsx:608-619`).
- **Fix:**
  - For legacy calls, loop native chunks inside the transaction up to main's scan bound, counting matches without hydrating, then refuse above 50 or hydrate the ≤50 rows.
  - Or add an hrScanPage option that refuses before hydration once matches exceed the page or the scan stays unfinished.
- **Expected impact and risk:** restores main's legacy contract, and the 153-employee refusal drops to about 100 docs. Low risk; add a test with 60 former and 40 current employees.

### 5. Full search rebuilds remain a cost cliff in large warehouses, and backfill pages hit the execution limit under load (residual of old 2)

- **Location:** `convex/finishedGoods/searchIndexBackfill.ts:568-593` (rebuild trigger), `:183-185` (default batch 25), `:382` (`REPAIR_BUILDINGS = 100`).
- **Evidence:**
  - **Inferred:** the maintained-create trigger is gone. A mismatched layout marker in a warehouse with more than 100 buildings (a legacy or rollback layout write), or more than 100 new buildings in one window, still schedules `run({restart: true})`. Readers then use the history scan until the rebuild finishes. That is by design, but the profiled warehouse (127 buildings) is on that side of the bound.
  - **Measured (`iter8-validation.md`, setup):** on the loaded local machine, 10-row search backfill pages exceeded the real backend's 1-second execution limit. Setup needed adaptive halving down to smaller pages. Production uses 25 rows and has no such fallback. This is indicative, since the machine load was high, and it is unmeasured on cloud.
- **Cost mechanism:** history-scan searches during a rebuild (2,389 docs over 22 requests on L, 10,352 on XL, iteration 8), plus the re-index itself.
- **Fix:**
  - Re-derive building names in chained pages instead of bailing out above 100.
  - Make the production backfill retry a timed-out page with a smaller batch, as the setup script does.
  - Measure one production-default page on an idle machine.
- **Expected impact and risk:** removes the remaining rebuild trigger and the stall risk. Low risk.

### 6. Building inventory still returns whole-building payloads (open, old 7)

- **Evidence (measured, iteration 9):** 35 docs and 469 KB read, returning 447.8 KB.
- **Fix:** a per-floor query, or omit the per-placement columns the building screen does not render.

### 7. Sorted catalogue first pages still re-run on every finished-goods write (open, old 8)

- **Evidence (measured, iteration 8; not rerun):** reserve and cancel re-run 2 pages (146–147 docs). createPallet re-runs 3 pages (259 docs).
- **Fix:** unchanged from iteration 7.

### 8. Pallet creation still serializes on per-warehouse documents (open, by design)

- **Evidence (measured, iteration 8; not rerun):**
  - L: 39 retries on candidate, 42 on base.
  - XL: 56/52 retries with 1–2 failures on candidate, 63/64 with 5 failures on base.
  - Same-zone reservation burst: 7 OCC retries and 7 refusals out of 15 executions, with equal refusal handling on both targets.
- **Cost mechanism:** the gapless sequence counter and one of 8 totals shards. Neither is new.

### 9. Iteration-9 measurements cannot show regressions in writes or fan-out (new, evidence gap)

- **Evidence:**
  - The iteration-9 profile has 3 samples and skips write flows, fan-out and contention (`iter9.md`, empty tables).
  - The building reconcile has a convex-test before/after and one real-engine after sample, with no real-engine before.
  - The previous-month roster base column (0.14 ms) is a failed call (`scenarios.mjs:506-511` has no `baseArgs`).
  - The iteration-9 changes do not touch query or write paths, so I infer no regression. That inference rests on the diff, not on a measurement.
- **Fix:**
  - Add `baseArgs` to the previous-month roster (or `null`), and print error counts next to base exec values.
  - Rerun write flows, fan-out and contention after the next code change.
  - Record a real-engine before sample by running the reconcile probe against `f9903ff9`.

### 10. Small items (open or new, low)

- The three whole-warehouse legacy endpoints are unchanged: 1,844, 1,440 and 936 docs (measured), with no live subscriber.
- **New:** a poisoned occupancy finish does not schedule a restart, so recovery waits up to an hour for the sweep (`zoneOccupancyBackfill.ts:229-243`). The over-budget flush, by contrast, restarts at once (`zoneSurfaces.ts:528-535`).
- **New:** runbook drift. `docs/operations/storage-zone-occupancy.md:122-123` says the run records the layout generation "on finishing". It now captures both generations at start and ends not-ready after a legacy write. The 500 cap is not documented.
- The `layoutRow` multi-warehouse short-circuit (`convex/lib/searchIndexWrites.ts:73`). It fails safe.
- **Rollout:** the version bumps make every warehouse fall back until the hourly sweeps rebuild it. Run the backfills right after deploy.

## Already good (brief)

- **Search is O(matches) and exact:** 61 docs against 2,389 on base (measured), and 537 real-engine traversals with 0 mismatches. Reconciliation now repairs new buildings in-transaction for 9 docs on the real engine.
- **Occupancy readiness is now sound under interleaving:** generations are captured at start, maintained writes follow them, and legacy writes or invalidation poison the run (inferred, tested).
- **Occupancy-derived reads are small (measured):** inventory 35 docs, building occupancy 21, zone preview 16.
- **HR period preview and review scoping are bounded by the limit** (111 docs on L and XL, iteration 8), and exact-50 rosters are served.
- **Backfill transactions are bounded:** the read budget is capped at 500, and overflowed zones are re-checked one page per transaction.

## What would raise the score to 9+

- **Make the recommendation list O(displayed)** with per-zone fit summaries, so it re-runs only when a zone's fit changes (finding 1). Measure it on a dataset that grows zones.
- **Bound job-scan delete reads after the write budget,** and measure a 300-id delete on the real engine with read calls (finding 2).
- **Confine over-budget layout changes to surfaces** (finding 3).
- **Restore main's legacy roster contract** for sites with many former employees, and refuse before hydration (finding 4).
- **Page building-name repairs and adapt backfill batch size on timeout,** so large warehouses never fall back to history scans (finding 5).
- **Rerun write flows, fan-out and contention,** fix the base-argument gap, and get the full suite and the two broader search test files to a recorded pass (finding 9).
