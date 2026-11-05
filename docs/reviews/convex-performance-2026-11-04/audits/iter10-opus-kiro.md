# Convex performance audit, iteration 10 (final, stopping cap)

- **Auditor:** Claude Opus 5.5, via Kiro CLI. Nothing was delegated. I used no other model or tool provider, and I did not read Sol's audits.
- **Audited code:** `80a57bbdc0f6d4bb02a8331aa5c3966b063edc4f`. The workspace HEAD is that commit. The only working-tree change is an untracked `report.html`, so I read the tree directly and used `git show`/`git diff` for older revisions.
  - Iteration diff: `e8c7ac38..80a57bbd` (5 commits). Backend changes: `convex/lib/jobScanSearch.ts` (+4), `convex/hr/roster.ts` (legacy path), new `convex/staging/performanceLimits.ts`, `convex/_generated/api.d.ts`. Scripts: new `scripts/performance/convex/bulk-delete.mjs`, `scenarios.mjs` (+`baseArgs`). Tests: `hr-roster-paging.integration.test.ts` (+2 cases), new `job-scan-delete-limit.integration.test.ts`.
  - Cumulative diff: `80dc0a93..80a57bbd` (63 files under `convex`, `tests`, `scripts/performance`, +29,432 / −5,266).
- **Method:** read-only. No source edits, no tests, no backend calls or deployments, no commits. This file is my only write.
- **Source provenance (verified).** I recomputed the profiler digest (`scripts/performance/convex/profile.mjs:995-1015`) from git blobs:
  - `c4ff5087`, `ad175269` and `80a57bbd` all hash to `af5ae17ff5f5dc78`. That is the candidate digest in `iter10.json` (target `ad175269`, `dirty: false`). Base hashes to `a486b726209f5b84` (main). So the final profile measured the audited backend.
  - `5f0a51c7` hashes to `82f2ca94ffbb1ac2`. It has `deleteScans` as an `internalMutation`. The commit after it, `c4ff5087`, makes it a public `mutation` (`git diff 474ffc9a c4ff5087`). The delete "after" probe called the public `staging/performanceLimits:deleteScans` with `revision: 5f0a51c7` and `workingTreeDirtyAtMeasurement: true`. So it ran a working tree that cannot be `5f0a51c7` as committed.
  - The delete path (`jobScanSearch.ts`, `jobScans.ts`, `searchIndexBackfill.ts`, `searchIndexWrites.ts`) is byte-identical from `5f0a51c7` to `c4ff5087`. Only `roster.ts` and `performanceLimits.ts` differ. The claim that the measured backend equals `c4ff5087` is consistent with git, but git alone cannot prove it. The probe script records only `git rev-parse HEAD` (`bulk-delete.mjs:105`), with no digest. I accept the after sample as evidence for the committed delete path, with that caveat.
- **Evidence and how far it goes:**
  - `iter10.md`/`.json`: real local engine, dataset-L restored from `output/perf/dataset-L.zip`, **7 uncached samples per query** (write flows record `n: 4`). Load average 22–24. **This run includes write flows, reactive fan-out and contention**, which iteration 9 lacked.
  - `iter10-delete-before.json` / `-diagnostic.json`: real engine, the 300-id public delete on `e8c7ac38`. Both fail with 300 rows remaining, 7,032 docs read, 0 writes. The read-call cause appears only in the diagnostic's note, from temporary logging that was not committed. The logged error itself is the tenant wrapper's `INTERNAL_ERROR`.
  - `iter10-delete-after.json`: **one real-engine sample**. The same 300 IDs are passed by file (`bulk-delete.mjs:29-30`); the before attempts committed nothing.
  - `iter10-delete-followups.json`: 11 successful transactions in the 5.7 s after the delete. They carry **no function identifier or request correlation**, so they are attributed by time window only. I re-summed them: 45,897 reads and 15,299 writes, which matches the notes.
  - **Validation as reported, not re-run by me:**
    - 60 tests in 6 files pass, along with full ESLint and the Convex typecheck.
    - The broader search corpus (10 tests) passed at iteration 9, not at the final SHA.
    - The full suite was last run at iteration 8: **5,704 passed and 2 failed. The suite is not all-green.**
    - The last full real-engine search parity run (537 traversals, 0 mismatches) is **from iteration 8**. There is no new one for iteration 10.

## Score: 7/10

- **The accepted 300-id delete limit failed on the real engine, and now succeeds (measured, one sample each).**
  - On `e8c7ac38`, the same 300 IDs failed atomically (7,032 docs read, 300 rows remain). The cause was the 4,096 read-call limit, shown by the diagnostic.
  - After the fix, the delete succeeds using 2,486 of 4,096 read calls, with 1,610 to spare. It reads 6,223 docs and writes 2,074 docs (11,002 index rows), in 463 ms of execution.
  - My iteration-9 finding 2 called this case unmeasured and possibly failing. That was correct, and it is now fixed for the measured selection.
- **The cost of that delete moved to the scheduler, and it is large (measured by time window).** Eleven follow-up transactions read 45,897 docs and wrote 15,299, about 7.4× the delete's own reads. In total, deleting 300 scans costs about 52,000 reads and 17,400 writes, against 160 reads and 53 writes for 50 scans on main. I credit the removed failure, not any reduction in work.
- **The legacy roster contract is restored and cheaper than main (inferred and tested; refusal measured).** Unpaged calls now use main's `siteEmployeesInRange` cap before filters. The 153-employee refusal reads 109 docs, against 253 at iteration 9 and 162 on main. The 60-former/40-current case has a test that the notes say failed before the fix.
- **No screen query changed, and the fan-out and contention reruns show no regression (measured).** All 71 query rows have the same docs and bytes as in iteration 9, except the legacy roster refusal. `reserve` fan-out re-reads 1,053 docs, against 6,098 on base (1,051 at iteration 8).
- **What keeps it at 7:**
  - The recommendation list still reads about 438 docs (747 KB) per call and re-runs on writes in any compatible zone.
  - Job-scan deletes still amplify reads by about 25× at 50 IDs (4,066 against 160), plus the deferred 300-ID cost above.
  - The inventory screen still returns 448 KB.
  - Over-budget layout changes still disable occupancy for the whole warehouse.
  - The search rebuild cliff above 100 buildings remains.
  - Validation is not green, and parity was not rerun at the final SHA.
  - None of these changed in iteration 10, and the rubric's 8 needs the heavy paths to be bounded *and* justified. The delete path is bounded now, but its deferred cost is not justified by anything measured.

## Changes since last audit

- **Defer orphan checks once the search write budget is spent (`5f0a51c7`, `convex/lib/jobScanSearch.ts:249-253`). Verdict: correct; resolves the hard failure behind old finding 2. Cost reduction: none.**
  - *Mechanism:* `collectIfOrphaned` now returns `"deferred"` before any read when `budget.left <= 0`. Before, each released term cost a `get` and a `take(1)` linkage range even with nothing left to write. In a high-diversity 300-scan delete, the budget runs out during scan-gram deletes (`dropScanGrams`, `:342-358`). The released-term loop runs last (`:552-554`), so up to 7 slots × 300 scans worth of terms used to be read for nothing.
  - *Integrity (inferred):*
    - The scan rows, their search rows (`:412`, unconditional) and the source deletions stay in one transaction.
    - Deferred terms go to `reindex` (`searchIndexWrites.ts:148-172`). There `repostJobScanTerms` re-runs `collectIfOrphaned` with a fresh budget. A term that is still linked is kept, and an orphan is deleted with its postings.
    - Leftover scan grams of deleted scans are only extra candidates, because their search rows are gone. Results stay exact during the window, by the existing design (`searchIndexBackfill.ts:118-122`).
    - No authorization or selection check is skipped.
  - *New, minor cost (inferred):* before, a released term that was still linked returned `"kept"` without touching the budget. Now any released term past exhaustion is deferred. In `repostJobScanTerms` (`:559-586`), a deferred term that is still linked and shared is unposted and fully re-posted (`:584-585`), up to 512 gram rows. That is wasted writes for terms that never changed. They are bounded and rescheduled, and the high-diversity probe hardly exercises the case, because its terms are unique and unshared.
  - *Test:* `job-scan-delete-limit.integration.test.ts` saves 300 diverse scans, backfills, deletes them all, and asserts fewer than 4,096 explicit read calls. Its counter reported 3,014; the real engine counted 2,486. The test then drains the scheduler and asserts that search rows, scan grams, terms and term grams are all gone, with no failed jobs. It guards both the limit and the eventual cleanup. It does not assert read cost after cleanup.
  - *Measured effect:*
    - Before: failed at 7,032 docs.
    - After: 2,486 read calls, 6,223 docs, 2,074 writes, 11,002 index rows.
    - Follow-ups: 11 transactions, 45,897 reads, 15,299 writes. Seven used the full 1,500 writes, at about 3 reads per write (the tenant layer's `readOwned` get per delete, `tenantDb.ts:471`, plus range reads).
    - The 50-ID delete in the profile is under the write budget (1,353 writes), so the guard does not fire there (inferred).
- **Legacy roster uses main's bounded site scan before filters (`474ffc9a`, `convex/hr/roster.ts:403-470`). Verdict: correct; resolves old finding 4.**
  - *Behavior:* unpaged calls (`:368`) call `siteEmployeesInRange(…, MAX_ROSTER_EMPLOYEES)` (`:406-414`, `convex/hr/shared.ts:1185-1260`), as main did (`80dc0a93:convex/hr/roster.ts:321-329`).
    - The cap applies to employed staff before search and department filters.
    - Former employees are scanned past, up to `MAX_HR_EMPLOYEE_SCAN = 10,000`, the same bound as main.
    - Refusal happens before any monthly cell is read.
    - The chunked reader stops at the 51st employed row. Its documented answer equals main's whole-range read.
  - *Ordering:* rows are in code order from the index, as on main. Hydration runs 10 at a time (`:440-462`). The response shape is unchanged (`employees`, `status: "ready"`, `isDone: true`).
  - *Paged path:* `chunk` no longer special-cases legacy (`:485`), because legacy no longer reaches `hrScanPage`. Paged callers are unchanged.
  - *Tests:*
    - "40 current employees behind 60 former employees": the codes `FORMER-*` sort before `PRESENT-*`, so this reproduces the iteration-9 failure.
    - "refuses an oversized legacy roster before hydrating rows even when a search narrows it": asserts at most 100 employee range docs and zero assignment or attendance range reads. It guards both cap-before-filter and refuse-before-hydrate.
    - The 49/50/51 boundary test remains.
  - *Measured:* the 153-employee refusal reads 109 docs (76.5 KB), against 253 at iteration 9 and 162 on main, with `resultCode: LIMIT_EXCEEDED` on both targets.
- **Local-only metrics probe (`convex/staging/performanceLimits.ts`). Verdict: acceptable, with a small surface cost.**
  - *Behavior:*
    - `deleteScans` is a **public** mutation (`:24`), the first public function under `convex/staging/`; the other seeds there are internal.
    - It refuses unless `ALLOW_LOCAL_TEST_SEED === "true"` and `CONVEX_CLOUD_URL`/`CONVEX_URL` is a loopback URL (`:6-13`). Hosted deployments set `CONVEX_CLOUD_URL` to their `https://…convex.cloud` URL, so it is off there (inferred).
    - It forwards to `finishedGoods/jobScans:deleteJobScans` through `ctx.runMutation` (`:32`), so the caller's identity, `MANAGE` permission, warehouse and selection checks all apply. It adds no privilege.
  - *Test:* the guard test checks that a hosted URL refuses even with the flag set, and that a loopback call without identity throws `ANONYMOUS`.
  - *Residual:* the probe ships to production as a dead public endpoint that returns transaction metrics. See rollout action 3.
- **Profiler base arguments (`scenarios.mjs:509-515`). Verdict: correct; resolves part of old finding 9.**
  - The previous-month base call now omits `pageSize`. `iter10.json` shows base `errors: 0, resultCode: LIMIT_EXCEEDED` (162 docs).
  - The `.md` table still shows the base exec (17.91 ms) without the base result code. Readers must check the JSON to know the base number is a refusal, not an answer.
  - Candidate (594 docs, 152 KB returned for 20 employees × a month of cells) and base are still different outputs.
- **`bulk-delete.mjs`. Verdict: adequate for one-sample evidence.**
  - Setup saves 30 × 10 unique scans, excluded from the metrics.
  - Executions are filtered by function identifier, `HttpApi` caller and timestamp (`:86-97`). That excludes the scheduled follow-ups, which the notes collected separately and attribute by time window only.
  - It records the git HEAD, not a source digest.
- **Measurements in `iter10.md` versus iteration 8/9 (measured, same dataset):**
  - Queries: identical docs and bytes to iteration 9 for 70 of 71 rows.
  - Fan-out (candidate vs base):
    - `reserve`: 1,053 vs 6,098 docs, with 0 vs 3 client follow-ups.
    - `cancelReservation`: 1,053 vs 6,096.
    - `createPallet`: 321 vs 316.
    - `saveJobScans`: 183 vs 122 (3 vs 2 re-runs).
  - Contention (candidate vs base):
    - `createPallet`, same product: 43 vs 54 OCC retries.
    - `createPallet`, different products: 52 vs 53 retries, with **1 failure on each target**. Iteration 8 had 0 failures on L.
    - `saveMeasurement`: 2 vs 12 retries.
    - Same-zone reserve: 7 retries and 7 business refusals on both.
  - The 50-ID delete reads 4,066 docs, against 3,766 in iteration 8. Its own preceding save also wrote 1,353 docs instead of 1,253. The flow's texts come from `Date.now() % 100000 + 50_000` (`scenarios.mjs:601`, `scanItem` at `:544-546`), so their digit count and gram count vary with the clock. I read this as an input difference, not a code regression (inferred). The guard cannot add reads.
  - Latency at load 22–24 is indicative only.

## Findings (ranked by impact, max 10)

### 1. The recommendation list still reads every compatible zone and re-runs on writes in any of them (open, old 1)

- **Location:** `convex/finishedGoods/workflow.ts:1335-1447`, `convex/lib/zoneSurfaces.ts:311-350`. Callers: the put-away and move screens. Unchanged in iteration 10.
- **Evidence (measured, iteration 10):**
  - Per call: `recommend` list 438 docs and 746.9 KB read, returning 127.7 KB. `recommendMove` list 439 docs. Base reads 2,886–2,887.
  - Fan-out: one `reserve` re-runs `recommend` (439 docs) and `recommendMove` (440 docs). The whole `reserve` fan-out re-reads 1,053 docs and 1.59 MB.
- **Evidence (inferred):** about 2 docs per compatible zone. The cost grows with zones in active buildings. Neither dataset grows zones (421 in both).
- **Cost mechanism:** O(compatible zones) per call. Every held-placement write in a compatible zone re-runs every open list for that product.
- **Fix:** keep a per-zone fit summary (free area and height per surface class, plus an unmeasured flag), maintained in the surface flush and backfilled with the occupancy run. Read entries only for zones that can fit. Alternatively, rank on the server and return the top N plus a count.
- **Expected impact and risk:** 2–5× fewer bytes, and re-runs only when a zone's fit changes. Moderate risk; the surface and occupancy parity tests cover the payload.

### 2. Job-scan deletes still amplify reads, and large deletes move tens of thousands of reads to the scheduler (partially resolved, old 2)

- **Location:** `convex/lib/jobScanSearch.ts:342-358, 395-555, 559-586`; `convex/finishedGoods/searchIndexBackfill.ts:123-160`; `convex/finishedGoods/jobScans.ts:582-602`.
- **Evidence (measured):**
  - 50 IDs: 4,066 docs read and 1,353 written (5,768 index rows), against 160 and 53 on main.
  - 300 IDs: 6,223 reads and 2,074 writes in the transaction, then about 45,897 reads and 15,299 writes in 11 follow-ups (time-window attribution).
  - Single update: 95 reads and 35 writes, against 13 and 4.
- **Evidence (inferred):**
  - About 58 writes per deleted scan (scan, search row, about 50 scan-gram rows, terms). Each tenant delete also costs a `get` (`convex/lib/tenantDb.ts:471`).
  - Deferred-term reposts rewrite shared terms that are still linked (`jobScanSearch.ts:584-585`).
  - While cleanup runs, every follow-up transaction writes gram ranges that open job-scan searches read, so a large delete can cause several rounds of search re-runs. This is not measured.
- **Cost mechanism:** per-scan posting fan-out. Reads per write are about 3 in cleanup. Cost scales linearly with selection size and text diversity.
- **Fix:**
  - Delete scan postings with a single range delete per scan where the engine allows, or skip `readOwned` for derived tables the transaction itself owns.
  - Before a deferred shared term is re-posted, check for linkage and leave it alone if it is still linked and posted.
  - Consider capping UI selections at the measured comfortable size (for example 100), or make the delete itself paged with explicit progress.
- **Expected impact and risk:** severalfold fewer deferred reads. Low to moderate risk; the 300-ID cleanup test covers end state.

### 3. Read calls are bounded only indirectly by the write budget (new, inferred)

- **Location:** `convex/lib/jobScanSearch.ts:249-268, 552-554`.
- **Evidence (inferred, not measured):**
  - A released term that is still linked returns `"kept"` after 2 read calls and spends no budget. The new guard fires only once **writes** are exhausted.
  - Consider a selection whose scans have few unshared texts, so they produce few scan-gram writes, but many distinct shared terms that other scans still link. Such a selection can stay under 1,500 writes and still check up to 7 × 300 terms at 2 calls each, plus per-scan gets and ranges.
  - That could exceed 4,096 read calls. The measured probe used unique unshared texts, so it exhausted the write budget early and does not cover this shape.
- **Fix:** add a read-call budget alongside the write budget. Count calls, or check `ctx.meta.getTransactionMetrics().databaseQueries.remaining` before each orphan check, and defer below a margin. Add a fixture with 300 scans that each carry distinct, promoted shared terms.
- **Expected impact and risk:** closes the remaining path to the limit failure. Low risk.

### 4. An over-budget layout change still turns off every occupancy reader in the warehouse (open, old 3)

- **Location:** `convex/lib/zoneSurfaces.ts:519-535`; the budgets are 60 zones and 300 locations (`:46, 50`). Unchanged.
- **Evidence (inferred):** a building status change touching more than 60 zones, or a write to more than 300 locations, sets occupancy readiness to stale. Inventory, building occupancy and recommendations then use the fallback until a full rebuild finishes.
- **Cost mechanism (measured, base paths in iteration 10):** inventory 1,829 docs, building occupancy 917, `recommend` 2,886, during the rebuild window.
- **Fix:** give surfaces their own validity (a generation or run), so large layout edits invalidate only surfaces. Optionally, rebuild the touched buildings in chained pages.
- **Expected impact and risk:** confines the fallback to recommendations. Low risk.

### 5. Full search rebuilds remain a cost cliff in large warehouses, and backfill page timing is unproven at production defaults (open, old 5)

- **Location:** `convex/finishedGoods/searchIndexBackfill.ts:568-593` (rebuild trigger), `:183-185` (default batch 25), `:382` (`REPAIR_BUILDINGS = 100`).
- **Evidence:**
  - **Inferred:** a mismatched layout marker in a warehouse with more than 100 buildings, or more than 100 new buildings in one window, still schedules a full rebuild. The profiled warehouse has 127 buildings.
  - **Measured (indicative):** iteration-10 setup again used 10-row pages with the harness's timeout retry (notes). Production uses 25 rows and has no such retry.
- **Cost mechanism:** history-scan searches during a rebuild (2,389 docs over 22 requests on L, iteration 8), plus the re-index itself.
- **Fix:** page building-name repairs instead of bailing out above 100, retry a timed-out backfill page with a smaller batch in production, and measure one default page on an idle machine or on cloud.
- **Expected impact and risk:** removes the cliff and the stall risk. Low risk.

### 6. Building inventory still returns whole-building payloads (open, old 6)

- **Evidence (measured, iteration 10):** 35 docs and 469.4 KB read, returning 447.8 KB. Base reads 1,829 docs.
- **Fix:** add a per-floor query, or drop per-placement columns that the building screen does not render.

### 7. Sorted catalogue first pages still re-run on every finished-goods write (open, old 7)

- **Evidence (measured, iteration 10 fan-out):** `reserve` and `cancelReservation` re-run 2 catalogue pages (148 docs), and `createPallet` re-runs 3 (260 docs).
- **Fix:** unchanged from iteration 7. Subscribe sorted first pages to a per-sort version row that moves only when the visible order can change.

### 8. Pallet creation still serializes on per-warehouse documents, with one OCC failure per burst (open, by design)

- **Evidence (measured, iteration 10):**
  - Same product: 43 retries on candidate and 54 on base, with no failures.
  - Different products: 52 retries and **1 failure** on candidate, 53 and **1 failure** on base.
  - Same-zone reserve: 7 retries and 7 refusals on both.
- **Cost mechanism:** the gapless sequence counter and the totals shards. Neither is new. A user-visible failure under an 8-way burst is now measured on L, not only on XL.
- **Fix:** allocate sequence numbers in per-product or per-day blocks if gaplessness can be relaxed per block. Otherwise surface OCC exhaustion as a retryable conflict in the UI.

### 9. The validation and provenance record is not final-grade (open, old 9)

- **Evidence:**
  - The full suite was last run at iteration 8, with 2 failures.
  - The broad search corpus was last run at iteration 9.
  - Real-engine parity was last run at iteration 8.
  - The delete probe ran on a dirty tree and records no digest.
  - The follow-up transactions carry no function identifier.
  - The `.md` hides base result codes.
  - None of this affects the reads I credited, which come from the final, digest-verified profile and the one delete sample.
- **Fix:**
  - Record `convexDigest` in `bulk-delete.mjs` and keep the identifier on each follow-up execution.
  - Print base result codes in the `.md`.
  - Rerun the full suite and parity at the release SHA.

### 10. Small items (open, low)

- The three whole-warehouse legacy endpoints are unchanged: `getStorageBuilding` 1,844 docs, `workflow:list` 1,440, `getStorageLocationMap` 936 (measured). None has a live subscriber.
- A poisoned occupancy finish does not schedule a restart (`convex/storageLayouts/zoneOccupancyBackfill.ts:229-243`), so recovery waits for the hourly sweep.
- The runbook still says the occupancy run records the generation "on finishing" (`docs/operations/storage-zone-occupancy.md:122-123`). It does not document the 500 read-budget cap, or that large job-scan deletes leave scheduled cleanup behind.
- The `layoutRow` multi-warehouse short-circuit (`convex/lib/searchIndexWrites.ts:73`) fails safe.

## Already good (brief)

- **Search is O(matches):** job-scan search reads 61 docs against 2,389 on base. Picker search reads 39 against 896, and a picker hit 98 against 900 (measured, iteration 10). Exactness rests on the iteration-8 parity run.
- **The maximum delete is now atomic and succeeds,** with 1,610 read calls to spare on the measured high-diversity selection. Cleanup is eventual and covered by a test.
- **Occupancy-derived reads are small (measured):** inventory 35 docs, building occupancy 21, recommendation zone preview 16, catalogue summary 18 (against 1,829, 917, n/a and 272 on base).
- **Fan-out is much lower than main:** `reserve` re-reads 1,053 docs against 6,098, with no client follow-ups against 3 (measured).
- **HR reads are bounded:** period preview 111 docs. The legacy roster refusal is now cheaper than main (109 against 162), and paged roster pages read 84 docs.

## Remaining limitations, ranked

1. The recommendation list costs O(compatible zones) per call and per re-run (finding 1). It is the largest recurring cost on a hot screen.
2. Job-scan delete amplification and deferred cleanup cost about 52,000 reads per 300-ID delete (finding 2). Deferred work is not eliminated work.
3. The read-call limit is unguarded for low-write, many-kept-term deletes (finding 3). The availability failure is possible but unmeasured.
4. Over-budget layout edits disable occupancy for the whole warehouse (finding 4).
5. The search rebuild cliff above 100 buildings, and unproven production backfill page timing (finding 5).
6. The inventory payload of about 448 KB (finding 6) and catalogue first-page re-runs (finding 7).
7. Gapless-counter OCC: 1 failure per 8-way distinct-product burst on both targets (finding 8).
8. The validation record: not all-green, parity not rerun at the final SHA (finding 9).

## Required rollout actions

1. **Run the occupancy and search backfills right after deploy, per warehouse.** The version bumps make every warehouse use fallback paths until the hourly sweeps finish. Watch for page timeouts at the default batch of 25 (finding 5).
2. **Get the release candidate to a recorded green full suite,** and rerun the 537-traversal real-engine parity corpus at the release SHA before relying on search exactness.
3. **Keep the metrics probe off production.**
   - Confirm `ALLOW_LOCAL_TEST_SEED` is unset on every hosted deployment.
   - Preferably, exclude `convex/staging/performanceLimits.ts` from production deploys or delete it once measurement ends. It is the only public function under `staging/`.
4. **Before advertising 300-ID deletes, measure a low-diversity, shared-term 300-ID selection on the real engine** and add the read-call guard (finding 3). Until then, consider a lower UI selection cap.
5. **Monitor scheduled `reindex` volume and function-call usage after bulk deletes.** A 300-ID delete triggers about 46,000 deferred reads. Alert on `reindex` chains that stop with `remaining > 0`.
6. **Update `docs/operations/storage-zone-occupancy.md`** for start-time generation capture, the 500 cap, and deferred delete cleanup.
7. **Confirm that no unpaged roster clients remain** (or keep the restored legacy path), and plan to retire the three whole-warehouse legacy endpoints.

## What would raise the score to 9+

- Make the recommendation list O(displayed) with per-zone fit summaries, so it re-runs only when a zone's fit changes. Measure it on a dataset that grows zones (finding 1).
- Cut per-scan posting writes and deferred reads for deletes. Add a read-call budget, and measure both 300-ID selection shapes with follow-ups correlated by identifier (findings 2 and 3).
- Confine over-budget layout changes to surfaces, and page building-name repairs (findings 4 and 5).
- Trim the inventory payload, and stop catalogue first pages re-running on unrelated writes (findings 6 and 7).
- Back the release with a green full suite and a final-SHA parity run (finding 9).
