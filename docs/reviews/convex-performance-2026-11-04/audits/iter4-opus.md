## Score: 6/10

- **The continuation token is exact again, and the write hot spot stays gone (measured and inferred).**
  - Writers read-modify-write one of 8 random shard rows (`convex/lib/finishedGoodsSummary.ts:170-192`). Readers sum all shards plus the legacy generation (`202-214`).
  - A query snapshot that follows a write's commit always includes that write's increment, so a late-committing write now moves the token (inferred). That closes my iteration-3 finding 3.
  - Measured: 8 concurrent `saveMeasurement` calls on distinct pallets took 11 executions with 3 OCC retries (RTT p50 62.9 ms). Base took 21 executions with 13 retries (216 ms). Iteration 3 had 0 retries, so exactness cost about 3 retries per 8 writers. That matches the expected shard collisions for 8 writers on 8 shards (about 2.75).
- **Query cost did not move this iteration (measured).** Every cold read count equals iteration 3:
  - `recommend` reads 687 docs, `buildingOccupancy` 21, building inventory 35.
  - Job-scan search reads 2,389 docs over 22 requests. The picker `searchPage` reads 896 docs to return 0.8 KB.
  - Steady-state catalogue re-runs grew by 4 or 5 docs each, because they now read up to 8 shard rows instead of 1 marker. A `reserve` re-runs 1,735 docs (1,707 before); a `createPallet` 358 (323).
- **The readiness hardening is closed for concurrent runs (inferred, guarded by a test).**
  - Continuations carry a `runId`, and pages of a superseded run neither rebuild nor declare readiness (`convex/storageLayouts/zoneOccupancyBackfill.ts:81-111`).
  - The sweep pages warehouses 50 per transaction (`177-215`).
  - The new test "refuses an older run's continuation…" passes.
- **The paths that keep the score at 5–6 are unchanged.**
  - Job-scan search still grows with history. An attempt to fix it with a Convex search index was correctly rejected (see "Changes").
  - The picker search still joins every location.
  - `hr/roster:roster` still returns `LIMIT_EXCEEDED`.
  - Recommendations still re-read about 1.28 MB for every subscriber on each placement write.
- **The measured code is the audited code (verified).**
  - I recomputed the harness digest (`scripts/performance/convex/profile.mjs:715-734`) over the snapshot's `convex/`. The harness hashes tracked files, so I counted the still-tracked deleted `finishedGoods/changeLog.ts` as `<deleted>`. The result, `2d07483e04c5d63c`, equals the candidate row labelled `00504646+dirty`.
  - So the dirty tree that was measured is exactly db92906a's `convex/`.

## Changes since last audit

- **Sharded exact change counter replaces the insert-only log. Verdict: correct; this resolves my finding 3 on ordering.**
  - _Files:_ `finishedGoodsSummary.ts:166-214, 413-416`, `schema.ts:519-530`, `schemaPolicy.ts:35`, `crons.ts`, `e2eFixture.ts:348`.
  - _Exactness (inferred):_
    - The token is `legacyGeneration + Σcount`. Both terms only increase, because patches only add 1 and the legacy generation only rises. The sum therefore changes exactly when either term does.
    - The late-commit case is now handled. Write A's increment is either in a reader's snapshot or not, so the next page request after A commits sees a different sum.
    - Duplicate shard rows cannot arise. Two first writers to one shard both read the empty `[warehouseId, shard]` range, so OCC serializes them. The reader's `.all(8)` can therefore never hit its cap refusal.
    - Only the e2e reset deletes shard rows. It also deletes the readiness row, so the `continuationKey` rotates and a recycled sum cannot validate an old cursor.
  - _Deploy transition (inferred):_
    - Iteration-3 cursors carried `≈1.7e12 + gen`, so they reset once.
    - Main's cursors carried `gen`. They stay valid until the first write, then reset. Both cases are safe.
    - The prune cron and its whole-warehouse head read are gone. That removes the starvation risk I raised.
  - _Contention (measured):_ distinct-pallet writers went from 0 to 3 retries. They remain far below base (13).
    - `Math.random` in Convex mutations is seeded per execution. The measured spread confirms the shards are actually distributed.
    - 16 or 32 shards would cut collisions roughly 2–4×, at the cost of 8–24 more tiny reads per catalogue request.
  - _Cost (measured):_
    - Each tracked write reads 3 more docs: `saveMeasurement` 20 → 23, `cancelReservation` 32 → 35.
    - Each steady-state catalogue query reads 4–5 more: `catalogue:summary` re-run 11 → 15, `productSummary` 13 → 17, `catalogue:page`×3 253 → 265.
  - _Reactive scope (measured):_ unchanged in breadth. Every finished-goods write still re-runs `catalogue:page`×3, `summary`, `productSummary`, `pageProductBatches` and `pageLegacyUnits`.
    - `productSummary` still reads the token through `readiness()` (`catalogue.ts:52-70, 526`), although `readProductSummary` never uses `generation` (`finishedGoodsSummary.ts:232-250`).
    - A fix for this is uncommitted in `/Users/macbook/Development/industrial-sas-convex-perf`. It is not credited here.
  - _Tests:_
    - `finished-goods-change-shards.integration.test.ts` checks that 20 writes move the token by exactly 20, that readiness is untouched, and that there are at most 8 rows.
    - Still missing: a catalogue continuation driven across a tracked write, and two interleaved writers. `convex-test` serializes transactions, so it cannot exercise the late-commit ordering anyway.
- **Backfill run IDs. Verdict: correct; this resolves finding 5b.**
  - A restart writes a new UUID onto readiness in the same transaction that clears `stale`, `blocked` and `overflow` (`zoneOccupancyBackfill.ts:94-111`).
  - Any continuation whose `runId` differs, including a missing `runId` or a missing readiness row, returns `superseded: true, isDone: true, ready: false` without rebuilding (`81-92`).
  - Racing restarts serialize on the readiness row.
  - Callers that still pass only `cursor` stop safely. `profile.mjs`, `seed-local-test.mjs` and the ops doc were updated.
  - A benign side effect: an operator's hand-driven run that outlives the hourly sweep is superseded by the sweep's own chain, which then finishes the job.
- **Sweep paging (`zoneOccupancyBackfill.ts:177-215`). Verdict: correct.**
  - It reads 50 warehouses per transaction and schedules the next page before the loop. If the loop throws, the schedule rolls back with it.
  - Each sweep transaction now reads O(50 × 2) docs instead of O(all warehouses).
  - `overflow` and `blocked` are still never re-evaluated (finding 5a remains open).
- **Key-order-independent unchanged-row comparison (`zoneOccupancy.ts:130-149`). Verdict: correct, but unverified.**
  - `canonical` sorts object keys, drops `undefined` members and preserves array order.
  - The schema has no `v.bytes`/`v.int64` fields, which would serialize wrongly (`grep` of `schema.ts` is empty). So no real change can compare equal.
  - No test or measurement shows that a fact-preserving pallet edit now skips the rewrite. The real engine's field reordering, which is the case this fixes, cannot be reproduced in `convex-test`.
  - Pre-existing and minor: `sameFields` iterates only `next`'s keys, so a top-level field dropped from the next shape would not trigger a replace.
- **Rejected job-scan search index (`evidence/rejected-search-index.md`). Verdict: the conclusion is sound; a different exact, index-backed design exists (see finding 2).**
  - The design indexed every token suffix in a Convex `searchIndex` and re-verified hits. Its completeness depended on last-term prefix expansion, which is bounded and silent.
  - The parity harness (`scripts/performance/convex/search-parity.mjs`) is rigorous. It pages every needle/filter to completion on both engines and compares ordered IDs. It found 23 of 537 combinations returning fewer rows, for example `FO6910`: 62 vs 2,100.
  - The Thai failure is real (inferred). U+0E33 SARA AM has a compatibility decomposition (ํ + า), so NFKC changes it before tokenization.
  - Even with an app-side encoding that dodged the tokenizer, a search index stays relevance-ordered and result-capped. It cannot deliver a complete createdAt-ordered result for common needles, and that incompleteness is unobservable. So it cannot serve as a fast path either.
  - The revert is clean: the snapshot's `jobScans.ts` and `schema.ts` have no search-index remnants.
  - The code comment "No index answers arbitrary substrings" (`jobScans.ts:675`) is too strong. Ordinary indexes over an n-gram posting table can answer them exactly.
- **Harness. Verdict: adequate.**
  - The digest check works.
  - A caveat: cold catalogue rows were measured with no shard rows present. They equal iteration 3 exactly, while the fan-out re-runs show +4–5 docs. The cold table therefore understates steady-state catalogue reads by up to 8 docs per request (inferred). This is immaterial to the score.
  - Still unmeasured: `confirmScanAssignment`, and a reserve-into-different-zones contention probe.
- **Tests run.**
  - I ran `pnpm exec vitest run` on `finished-goods-change-shards` and `storage-query-scale` in `/Users/macbook/Development/industrial-sas-convex-perf` (HEAD db92906a): 2 files, 21 tests passed.
  - Every file under review is byte-identical to the snapshot. The only uncommitted change there is in `finishedGoods/catalogue.ts`, which those tests do not exercise.

## Findings (ranked by impact, max 10)

### 1. Put-away recommendation still reads, returns and re-runs for the whole warehouse (partially resolved; unchanged)

- **Location:** `convex/finishedGoods/workflow.ts:1090-1230` (`recommendations`) and `690-910` (`locationContext`). Callers: `PalletScreens.tsx`, `MoveScreen.tsx`, `DestinationPicker.tsx`.
- **Evidence:**
  - Measured: 687 docs, 1,284 KB read, 238.3 KB returned (base 2,887 docs, 1,818 KB).
  - Measured: each `reserve`/`cancel` re-runs `recommend` and `recommendMove` at 688 and 689 docs, about 2.6 MB re-read for one screen.
- **Cost mechanism:**
  - Each active-building zone reads its positions, one location per position, and its entries row.
  - Any held-placement write in the warehouse rewrites an entries row that every recommend subscriber reads.
  - The payload is O(supports²) per zone.
- **Fix:**
  - (a) Move `previewSupports`, `occupied` and `unavailable` into a per-zone detail query.
  - (b) Precompute per-zone surfaces (positions × locations), maintained by layout writes. That needs a backfill like the occupancy one.
  - (c) Rank server-side, return the top N, and depend on a per-building occupancy version.
- **Expected impact and risk:**
  - About 10× fewer docs and bytes, and narrower re-runs.
  - (a) is low risk. (b) and (c) are moderate risk and need the existing parity tests.

### 2. Job-scan text search scans job-scan history (open; the search-index route is correctly closed)

- **Location:** `convex/finishedGoods/jobScans.ts:599-740, 743-772`, `convex/lib/boundedRecordPage.ts`.
- **Evidence:**
  - Measured: 2,389 docs and 1,541 KB over 22 requests, unchanged. This is the largest read in the profile.
  - Inferred: the cost is about pageSize divided by match rate. It is worst for rare needles, and rare needles are usually long.
- **Fix (exact semantics, ordinary indexes):**
  - Add a posting table `finishedGoodsJobScanGrams { orgId, warehouseId, mapped, gram, createdAt, scanCreationTime, scanId }`. Index it on `[orgId, warehouseId, gram, createdAt, scanCreationTime]` and `[orgId, warehouseId, mapped, gram, createdAt, scanCreationTime]`.
  - Build the trigrams of each field separately, after `normalizeJobScanSearch` (code points, no cross-field grams).
  - A field containing the needle contains all of the needle's trigrams. Walking one gram's postings newest-first and re-verifying each with `jobScanTextMatches` is therefore a complete superset in the same order. Carry `scanCreationTime` so tie order matches `by_orgId_warehouseId_createdAt`, because a 50-item batch shares one `createdAt`.
  - Pick the gram by probing every needle gram with `take(k)` in parallel. Use the one that is exhausted, otherwise the one whose k-th posting is oldest (lowest density).
  - Keep the bounded scan for needles shorter than 3 code points; common needles fill pages fast.
  - Handle building-name matches with one of two options:
    - Denormalize an effective `buildingId` onto scans and merge, by `(createdAt, creationTime)`, an index stream of scans in name-matching buildings (the warehouse's building list is bounded).
    - Or include building-name grams in the postings and re-index on the rare building rename.
- **Cost and rollout:**
  - About 100 postings per scan. A 50-item save would write about 5k rows, so index asynchronously behind an `indexedThrough` watermark.
  - Queries then scan only the un-indexed tail exactly.
  - Update and delete must rewrite postings. Existing rows need a backfill.
  - Gate it with the existing `search-parity.mjs`, which must show 0 mismatches.
- **Expected impact and risk:**
  - Rare needles drop from O(history) to O(postings of the rarest gram + page).
  - The write amplification and storage are real, and the ordering and building-merge code need the parity gate.
  - A cheaper interim step: a narrow projection table, so each scanned row costs about 150 B instead of about 650 B. That cuts bytes roughly 4× but not docs.

### 3. Every catalogue subscription still re-runs on every finished-goods write (partially resolved: the token is now exact)

- **Location:** readers at `convex/finishedGoods/catalogue.ts:52-70, 382, 526, 542` and `convex/finishedGoods/batches.ts:454, 504`. The writer is at `finishedGoodsSummary.ts:413-416`.
- **Evidence:**
  - Measured: `productSummary` (17 docs), `pageProductBatches` (15), `pageLegacyUnits` (36), `catalogue:summary` (15) and `catalogue:page`×3 (265) re-run on `reserve`, `cancel` and `createPallet`.
  - Measured: 3 OCC retries per 8 distinct-pallet writers.
- **Cost mechanism:**
  - The shard range `[orgId, warehouseId, *]` is a warehouse-wide reactive dependency, so about 7 catalogue queries re-run per open screen per write.
  - Any write also resets every in-progress multi-request catalogue scan. That was true in main too.
- **Fix:**
  - Let `productSummary` read the raw readiness row. An uncommitted fix for this exists.
  - Scope the batch and legacy-unit tokens per product, for example a shard keyed `(warehouseId, productId, shard)` incremented next to the warehouse shard.
  - Read the token only on continuation requests (`cursor`/`scanCursor` present). First pages could validate against a token embedded in the cursor they issue, rather than subscribing to it.
  - Optionally use 16 shards.
- **Expected impact and risk:** removes 1–3 re-runs per screen per write. The risk is low, and the change-shard and catalogue-pagination tests cover it.

### 4. Job-scan location picker search joins every location row (open)

- **Location:** `convex/finishedGoods/jobScanLocations.ts:663-757`.
- **Evidence:** Measured: 896 docs and 474 KB over 2 requests to return 0.8 KB, unchanged.
- **Fix:** denormalize the position/zone label and `buildingId` onto `locations` and filter within the row. Alternatively, reuse the trigram-posting design from finding 2 at a much smaller scale. Either needs a backfill.

### 5. Derived-occupancy readiness: sticky degradations (mostly resolved from the old finding 5)

- **Location:** `convex/storageLayouts/zoneOccupancyBackfill.ts:177-215`, `convex/lib/zoneOccupancy.ts:301-303, 351-406`.
- **Evidence (inferred):**
  - Resolved: (b) concurrent chains, through `runId` (tested), and the unbounded sweep, through paging.
  - Open (a): `overflow` and `blocked` are cleared only by a restart, and the sweep skips ready warehouses. One transient 501-placement zone, or one repaired cross-building placement, keeps `buildingOccupancy` (21 → about 917 docs) and inventory (35 → about 1,829 docs) on the slow path indefinitely.
  - Open (c): placement-only writes by pre-change code escape the rollback guard. The effect is display-only.
- **Fix:**
  - Have the sweep also restart `overflow` or `blocked` warehouses daily, or re-probe a zone when a write removes a placement from it.
  - Add an admin health query for `ready`, `buildingReady` and the flags.
- **Expected impact and risk:** keeps the measured savings after real-world edge events. Small change, low risk.

### 6. Building inventory: few documents, but still a whole-building payload (partially resolved)

- **Location:** `convex/storageLayouts/catalogue.ts:571-660`.
- **Evidence:** Measured: 35 docs (was 1,829), but 964 KB read and 447.8 KB returned for one building.
- **Cost mechanism:** any placement write in the building re-runs the query, which re-reads every held zone's entries row.
- **Fix:** a per-floor inventory query for the floor editor and review screens, plus the projection from finding 7.

### 7. Entries rows store full placement documents (partially resolved: the comparison is now canonical)

- **Location:** `convex/lib/zoneOccupancy.ts:39-58, 130-149, 175-215`, `convex/schema.ts:1044-1075`.
- **Evidence:**
  - Measured: bytes still fall much less than docs (`recommend` 1,818 → 1,284 KB; reserve fan-out 3,808 → 2,751 KB), and a `reserve` writes 9.4 KB (base 7.2).
  - Inferred: the copies carry audit, QR and identity fields that readers never use.
  - The rewrite skip is now key-order independent. Whether real-engine field reordering is actually defeated is unmeasured.
- **Fix:**
  - Store only the placement fields that readers and `scope.placement` use.
  - Add a profile flow, such as a quantity-neutral pallet edit, that asserts 0 entries-row writes.
- **Expected impact and risk:** read and write bytes fall roughly in half. Low risk, because the parity tests cover the output.

### 8. HR roster fails above 50 employees (open)

- **Location:** `convex/hr/roster.ts:301-356`, `convex/model/hr/roster.ts:53`.
- **Evidence:** Measured: 162 docs, then `LIMIT_EXCEEDED` at 153 employees. The paging change is not in this snapshot.
- **Fix:** paginate employees with a native cursor, filter during the scan, and read days per page.

### 9. A per-warehouse sequence document serializes pallet creation (open)

- **Location:** `convex/finishedGoods/workflow.ts:110-133` (`nextCode`), `schema.ts:1284-1290`.
- **Evidence:** Measured: 8 concurrent `createPallet` calls take 22 executions with 14 retries (base 20/12), RTT p50 206 ms. The retries are on `finishedGoodsCounters`.
- **Fix:**
  - Split the pallet and position sequences into separate rows.
  - Allocate code blocks per session only if gap-free codes are not a business requirement.
- **Expected impact and risk:** low at current receiving rates. Codes are user-visible, so confirm the numbering rule first.

### 10. Expensive whole-warehouse legacy endpoints are still public (open)

- **Evidence:**
  - Measured: `getStorageBuilding` 1,844 docs, `workflow:list` 1,440 docs, `getStorageLocationMap` 936 docs, all unchanged.
  - Inferred: none has a live subscriber.
- **Fix:** retire them, or rebuild them on the split and derived queries.

## Already good (brief)

- The catalogue continuation token is exact under any commit order. No writer touches a warehouse-wide document (measured: 3 retries vs base 13 for distinct pallets), and the prune cron and its whole-warehouse read are gone.
- Backfill runs are single-owner (`runId`), the sweep is bounded per transaction, and every readiness path has a recovery or parity test that passes.
- Overflow handling is bounded and failure-free. Derived occupancy is transactional and tenant-registered, and mutations keep authoritative validation.
- Building occupancy stays at 21 docs, and inventory at 35 (measured).
- Job-scan writes stay O(items) with 0 retries under 8 concurrent writers (measured).
- The search-index experiment was gated by a real-engine parity harness and reverted when it failed. That is the right discipline, and the harness is reusable for the next design.

## What would raise the score to 9+

- Make recommendation O(displayed): a detail query for the preview payload, precomputed per-zone surfaces, and server-side top-N (finding 1). Project the entries copies (finding 7).
- Index-backed exact substring search for job scans and the picker, using a trigram posting table on ordinary indexes, a watermark tail scan and the existing parity gate (findings 2 and 4). Add roster paging (finding 8). These are the remaining O(history) and limit-failure paths that hold the score in the 5–6 band.
- Narrow catalogue reactivity: no token read in `productSummary`, per-product batch tokens, and token reads only on continuations (finding 3).
- Make degraded readiness self-healing and observable (finding 5).
- Profile `confirmScanAssignment`, a reserve-into-different-zones contention probe and a fact-neutral pallet edit. Rerun on a fixture about 5× larger with a bulk LOCATION_ONLY zone above 500 entries.
