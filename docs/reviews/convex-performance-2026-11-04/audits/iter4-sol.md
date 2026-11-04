## Score: 4/10

- **Measured:** The roster still returns `LIMIT_EXCEEDED` after **162 document reads** on the 153-employee fixture. This unchanged core-flow failure keeps the snapshot in the rubric’s ≤4 band. The independent HR paging work is absent and receives no credit. (`evidence/iter4.md:18`; `convex/hr/roster.ts:321`)
- **Measured:** Earlier improvements persist: recommendations read **687–688 documents**, building inventory **35**, and building occupancy **21**, versus **2,886–2,887**, **1,829**, and **917** on base. Recommendation and inventory byte counts remain substantial. (`evidence/iter4.md:11`; `evidence/iter4.md:12`; `evidence/iter4.md:30`; `evidence/iter4.md:37`)
- **Measured:** Eight concurrent distinct-pallet measurement saves incur **3 retries versus 13 on base**, with no failures. This is worse than iteration 3’s zero-retry probe; the recorded conflicts now identify `finishedGoodsChangeShards`. Same-product creation still incurs **14 retries versus 12 on base**. (`evidence/iter4.md:93`; `evidence/iter4.md:95`; `evidence/iter4.md:120`; `evidence/iter4.md:122`; `evidence/iter4.json:3015`)
- **Measured:** Saved-scan search still reads **2,389 documents across 22 requests**; location search reads **896 across two**. Reverting the incomplete search-index experiment preserves correctness but supplies no search-performance improvement. (`evidence/iter4.md:6`; `evidence/iter4.md:10`; `evidence/rejected-search-index.md:13`)
- **Inferred:** Superseded backfill ownership and unbounded warehouse dispatch are resolved. Remaining large reads, broad invalidation, occupancy maintenance costs, and incomplete reactive measurement prevent a higher score. The score is unchanged; existing problems are not penalized again.

## Changes since last audit

- **Sharded change counter — correct, with a measured contention tradeoff.** **Inferred:** Each tracked warehouse write transaction increments one tenant-scoped shard; readers sum at most eight shard rows plus legacy generation. Invalidation therefore no longer depends on which marker has the greatest creation time. Catalogue and batch callers retain their authorization and scope checks. The replacement test verifies exact increments across sequential writes and bounded shard count, but does not exercise reordered commits or actual continuation recovery. My iteration-3 assessment of the maximum-marker token was too strong: sequential token tests did not establish invalidation for every commit. **Measured:** Distinct-pallet retries are 3 versus base’s 13, compared with zero in iteration 3. (`convex/lib/finishedGoodsSummary.ts:170`; `convex/lib/finishedGoodsSummary.ts:202`; `convex/lib/finishedGoodsSummary.ts:412`; `convex/finishedGoods/catalogue.ts:52`; `convex/finishedGoods/batches.ts:454`; `tests/integration/finished-goods-change-shards.integration.test.ts:71`; `evidence/iter3.md:95`; `evidence/iter4.md:95`)

- **Backfill run ownership — correct; previous finding 2 resolved.** **Inferred:** Restart persists a fresh `runId`; continuations from another run return before rebuilding or declaring readiness. Scheduled pages, the seed script, and profiler now propagate ownership. The added test starts A, starts B, rejects A’s continuation with zero rebuilt zones, and completes B. The existing mid-run invalidation test remains. No corresponding runtime cost measurement is supplied. (`convex/storageLayouts/zoneOccupancyBackfill.ts:80`; `convex/storageLayouts/zoneOccupancyBackfill.ts:140`; `scripts/seed-local-test.mjs:146`; `scripts/performance/convex/profile.mjs:75`; `tests/integration/storage-query-scale.integration.test.ts:1008`; `tests/integration/storage-query-scale.integration.test.ts:1035`)

- **Warehouse dispatch and retention removal — correct; previous finding 9 resolved for its stated global-traversal defect.** **Inferred:** Sweep now pages 50 warehouses and schedules its continuation separately. The append-only log and pruning cron are removed; new counter storage is bounded by shard count. No multi-page dispatcher regression test or maintenance profile is supplied. Backfill reconstruction within each dispatched job has a separate capacity risk described below. (`convex/storageLayouts/zoneOccupancyBackfill.ts:177`; `convex/crons.ts:11`; `convex/schema.ts:524`; `convex/lib/finishedGoodsSummary.ts:167`)

- **Canonical occupancy comparison — correct by inspection.** **Inferred:** Recursive key sorting makes equality independent of persisted object-field order while preserving array order, preventing unnecessary replacement when values are unchanged. No dedicated key-reordering regression test was added. **Measured:** Reservation and cancellation still write 9 and 8 documents respectively; these changing-data probes do not isolate unchanged-row suppression. (`convex/lib/zoneOccupancy.ts:128`; `convex/lib/zoneOccupancy.ts:195`; `convex/lib/zoneOccupancy.ts:218`; `evidence/iter4.md:78`; `evidence/iter4.md:79`)

- **Rejected native search index — correct decision to revert this implementation.** **Measured, as reported:** Parity found 23 mismatches among 537 needle/filter combinations, including 62 results versus 2,100 for `FO6910` and zero versus 529 for `สำนัก`. **Inferred:** Exact verification removes false positives but cannot recover missing candidates. A fallback triggered only by reaching a candidate cap cannot detect omissions below that cap. The conclusion is sound for this suffix-token representation and its proposed fallback; it does not establish that every indexed substring design is impossible. The supplied note reports the prefix-expansion and Thai-tokenizer diagnoses, but contains no raw probe transcript or retained experimental implementation to independently verify those mechanisms. (`evidence/rejected-search-index.md:7`; `evidence/rejected-search-index.md:13`; `evidence/rejected-search-index.md:25`; `scripts/performance/convex/search-parity.mjs:86`; `convex/finishedGoods/jobScans.ts:743`)

- **Profiler update — correct ownership plumbing; previous measurement limitation remains.** **Inferred:** The only change to recovery profiling passes backfill `runId`. Reactive recovery still discards newly settled arguments and retains the original WebSocket subscription. Its figures describe recorded executions, not fully settled client subscription behavior. (`scripts/performance/convex/profile.mjs:75`; `scripts/performance/convex/profile.mjs:313`; `scripts/performance/convex/profile.mjs:457`)

**Scope and verification — inferred:** Reviewed `db92906aa7ffaf3c2c6a580d171213089be6adcf`, its iteration-3 parent, the cumulative baseline diff, and the supplied evidence. The committed Convex digest is `4352442e2b921f72`; reproducing the profiler’s precommit tracked-file list, including the deleted `changeLog.ts` sentinel, produces the recorded `2d07483e04c5d63c`. Base recomputes to `a486b726209f5b84`. This reconciles the `00504646+dirty` label with the snapshot under the harness’s algorithm; backend versions remain `unknown`. Tests were inspected, not executed: the snapshot has no `node_modules`. No deployment was called. (`scripts/performance/convex/profile.mjs:715`; `evidence/iter4.json:18`)

Code references are relative to the audited snapshot; evidence references are relative to the supplied review directory. Document and byte counts carry more weight than latency.

## Findings (ranked by impact, max 10)

### 1. Open — roster capacity still prevents a core screen from loading

- **Location:** `convex/hr/roster.ts:321`; `convex/model/hr/roster.ts:53`. Caller: `src/features/hr/ShiftsRoster.tsx:698`.
- **Evidence — measured:** 162 documents and 112.8 KB read before `LIMIT_EXCEEDED`. (`evidence/iter4.md:18`)
- **Evidence — inferred / cost mechanism:** Employee loading and the 50-employee refusal precede search filtering. Successful smaller requests also load site-wide monthly attendance, creating broad dependencies. (`convex/hr/roster.ts:328`; `convex/hr/roster.ts:330`; `convex/hr/roster.ts:348`)
- **Fix:** Page authorized, historically eligible employees and load displayed employees’ attendance, assignments, and leave claims. Preserve revision checks, frozen-plan protection, and bounded atomic saves.
- **Expected impact and risk — inferred:** Restores larger-site access and bounds screen work; historical eligibility and save semantics require regression coverage. **Previous finding 1 remains open.**

### 2. Open — substring searches still inspect many rejected records

- **Location:** `convex/finishedGoods/jobScans.ts:625`; `convex/finishedGoods/jobScanLocations.ts:663`. Callers: `src/features/finishedGoods/jobScan/JobScanRecords.tsx:132`; `src/features/finishedGoods/jobScan/LocationPicker.tsx:578`.
- **Evidence — measured:** Saved-scan search reads 2,389 documents and 1,541.1 KB across 22 requests. Location search reads 896 documents and 474.3 KB across two requests, returning 0.8 KB. (`evidence/iter4.md:6`; `evidence/iter4.md:10`)
- **Evidence — inferred / cost mechanism:** Indexed history retrieval precedes substring rejection; location search traverses remaining contains-match ranges and reads physical sources before rejection. Bounded requests still accumulate history-sized work. (`convex/finishedGoods/jobScans.ts:675`; `convex/finishedGoods/jobScans.ts:699`; `convex/finishedGoods/jobScanLocations.ts:348`; `convex/finishedGoods/jobScanLocations.ts:733`)
- **Fix:** Explore exact normalized gram-posting indexes using ordinary tenant/warehouse-scoped equality ranges, with live verification and a complete fallback for unsupported short queries or unfinished migration. Maintain postings transactionally and account for building-name changes.
- **Expected impact and risk — inferred:** Avoids hydrating rejected records. Measure posting storage and write amplification; preserve NFKC substring semantics, newest-first ordering, picker prefix priority, QR identity, and truthful exhaustion. **Previous finding 3 remains open.**

### 3. Partially resolved — recommendations remain active-warehouse-sized

- **Location:** `convex/finishedGoods/workflow.ts:1090`. Callers: `src/features/finishedGoods/PalletScreens.tsx:598`; `src/features/finishedGoods/MoveScreen.tsx:177`.
- **Evidence — measured:** 687–688 document reads, approximately 1,284 KB read, and approximately 238 KB returned per recommendation. (`evidence/iter4.md:11`; `evidence/iter4.md:12`)
- **Evidence — inferred / cost mechanism:** Every active building’s zones are loaded, contexts constructed, support rules checked, and geometry evaluated before results return. Derived rows reduce document count but retain occupancy-sized bytes and dependencies. (`convex/finishedGoods/workflow.ts:1106`; `convex/finishedGoods/workflow.ts:1115`; `convex/finishedGoods/workflow.ts:1142`; `convex/finishedGoods/workflow.ts:1178`)
- **Fix:** Backfill verified eligibility projections to select bounded candidate pages, then calculate exact geometry for selected candidates and requested previews.
- **Expected impact and risk — inferred:** Bounds initial reads, payloads, and CPU. Preserve candidate ordering, reason precedence, complete eligibility, and fresh transactional placement validation. **Previous finding 4 remains partially resolved.**

### 4. Partially resolved — shared counters and shard collisions still cause retries

- **Location:** `convex/finishedGoods/workflow.ts:110`; `convex/lib/finishedGoodsSummary.ts:47`; `convex/lib/finishedGoodsSummary.ts:170`. Callers: pallet creation and tracked finished-goods writes.
- **Evidence — measured:** Eight same-product creations produce 22 executions and 14 retries; sampled conflicts identify `finishedGoodsCounters`. Distinct-pallet saves produce 11 executions and 3 retries, identifying `finishedGoodsChangeShards`. No failures occurred. (`evidence/iter4.json:2973`; `evidence/iter4.json:3006`)
- **Evidence — inferred / cost mechanism:** Pallet and position allocation share one warehouse document. Product changes update shared product summaries. Eight change shards reduce warehouse coupling but do not eliminate it; summing them also preserves warehouse-wide subscription invalidation. (`convex/finishedGoods/workflow.ts:115`; `convex/lib/finishedGoodsSummary.ts:65`; `convex/lib/finishedGoodsSummary.ts:207`)
- **Fix:** Separate independent sequence counters, retain required sequencing guarantees, and tune shard count against measured concurrency and reader cost. Scope continuation signals to relevant products or ranges where correctness permits.
- **Expected impact and risk — inferred:** Reduces avoidable retries and unrelated reruns. Preserve code uniqueness, ordering, idempotency, and exact invalidation. The zero-retry result from iteration 3 is no longer applicable. **Previous finding 5 remains partially resolved.**

### 5. Partially resolved — building inventory remains large and overflow disables optimization warehouse-wide

- **Location:** `convex/storageLayouts/catalogue.ts:571`; `convex/lib/zoneOccupancy.ts:406`. Caller: `src/features/storageLayouts/useStorageBuilding.ts:23`.
- **Evidence — measured:** Building inventory reads 35 documents but 964.0 KB, returning 447.8 KB. (`evidence/iter4.md:30`)
- **Evidence — inferred / cost mechanism:** The live hook subscribes to complete inventory. One overflow flag disables derived building readers throughout the warehouse. Ordinary writes skip overflow reconstruction, and sweep skips otherwise ready overflowed warehouses, so the fallback can persist after occupancy falls. (`convex/storageLayouts/catalogue.ts:575`; `convex/storageLayouts/catalogue.ts:641`; `convex/lib/zoneOccupancy.ts:317`; `convex/lib/zoneOccupancy.ts:420`; `convex/storageLayouts/zoneOccupancyBackfill.ts:200`)
- **Fix:** Separate overview summaries from floor/zone detail. Maintain verifiable placement-building membership to scope fallback safely, and schedule bounded overflow recovery.
- **Expected impact and risk — inferred:** Bounds detail hydration and confines fallback cost. Preserve placement-building semantics, both move holds, and exact geometry. **Previous finding 7 remains partially resolved.**

### 6. Partially resolved — complete occupancy rows still make individual writes zone-sized

- **Location:** `convex/lib/zoneOccupancy.ts:175`; `convex/lib/zoneOccupancy.ts:310`. Maintenance caller: `convex/lib/finishedGoodsSummary.ts:393`.
- **Evidence — measured:** Reservation reads/writes 37/9 documents versus base’s 28/7; cancellation reads/writes 35/8 versus 23/6. Fan-out’s reservation writes 9.4 KB versus 7.2 KB. (`evidence/iter4.md:78`; `evidence/iter4.md:79`; `evidence/iter4.md:87`; `evidence/iter4.md:105`; `evidence/iter4.md:106`; `evidence/iter4.md:114`)
- **Evidence — inferred / cost mechanism:** Changed complete rows still sort placements, calculate footprint unions, recursively compare packed data, and replace entries containing up to 500 placements. Same-zone writers share these documents. Canonical equality fixes unnecessary replacement, not changed-row cost. (`convex/lib/zoneOccupancy.ts:130`; `convex/lib/zoneOccupancy.ts:166`; `convex/lib/zoneOccupancy.ts:182`; `convex/lib/zoneOccupancy.ts:331`)
- **Fix:** Measure reservation, release, moves, and pallet-fact edits near capacity with same-zone concurrency. Introduce byte-bounded chunks or narrower projections if needed, retaining exact transactional area accounting.
- **Expected impact and risk — inferred:** Prevents read savings from causing excessive write bytes, CPU, or conflicts. The current size test covers one fixture; the overflow test asserts unchanged entries rather than read budgets. (`tests/integration/storage-query-scale.integration.test.ts:967`; `tests/integration/storage-query-scale.integration.test.ts:1129`) **Previous finding 6 remains partially resolved.**

### 7. Open — warehouse totals still scan every product summary

- **Location:** `convex/finishedGoods/catalogue.ts:535`. Caller: `src/features/finishedGoods/FinishedGoodsCatalogue.tsx:105`.
- **Evidence — measured:** 272 documents and 136.9 KB across two requests to return 1.6 KB. (`evidence/iter4.md:14`)
- **Evidence — inferred / cost mechanism:** Settled totals require every product and its summary; warehouse generation changes invalidate the accumulated continuation. (`convex/finishedGoods/catalogue.ts:559`; `convex/finishedGoods/catalogue.ts:597`; `convex/finishedGoods/catalogue.ts:621`)
- **Fix:** Maintain bounded sharded warehouse totals and exact unit-label reference counts, with backfill and reconciliation.
- **Expected impact and risk — inferred:** Replaces product-sized loading with bounded aggregate reads. Preserve inherited formats, label removal, atomic totals, and avoid another single-document write hotspot. **Previous finding 8 remains open.**

### 8. Newly identified existing risk — backfill pages bound zones, not reconstruction work

- **Location:** `convex/storageLayouts/zoneOccupancyBackfill.ts:69`; `convex/storageLayouts/zoneOccupancyBackfill.ts:122`; `convex/lib/zoneOccupancy.ts:77`; `convex/lib/zoneOccupancy.ts:228`.
- **Evidence — inferred:** An accepted 50-zone page can contain 500 held placements per zone. With distinct pallets, that requires 25,000 placement documents plus 25,000 pallet reads before metadata and existing derived rows. These are source-derived workload counts, not measurements. The cron uses the default 20-zone page; no dense multi-zone backfill profile is supplied.
- **Cost mechanism:** Dense pages can exhaust transaction read/byte or execution budgets, leaving readiness recovery unable to advance. Paging warehouse dispatch does not bound this inner work.
- **Fix:** Use a conservatively measured per-transaction reconstruction budget, initially one zone per job if necessary. Preserve run ownership and publish readiness only after complete traversal.
- **Expected impact and risk — inferred:** Makes recovery viable for dense warehouses. Add dense multi-zone and retry/resumption coverage. This risk predates iteration 4 and was missed in my previous report; it is not an iteration-4 regression.

### 9. Partially resolved — reactive totals still do not represent settled subscriptions

- **Location:** `scripts/performance/convex/profile.mjs:294`; `scripts/performance/convex/profile.mjs:457`. Actual client: `src/hooks/useCatalogueSync.ts:72`.
- **Evidence — measured:** Reservation records 10 reactive executions and 1,735 reads versus base’s 10 and 6,098, plus two follow-up requests reading 282 versus 272 documents. These support reduced recorded work. (`evidence/iter4.md:87`; `evidence/iter4.md:114`)
- **Evidence — inferred / cost mechanism:** Recovery discards settled arguments instead of replacing subscriptions. Subsequent writes exercise old continuation arguments. Fixed log delays and completion windows also do not assert every expected completion or terminal settlement. Thus the harness cannot establish complete settled-screen recovery totals. (`scripts/performance/convex/profile.mjs:144`; `scripts/performance/convex/profile.mjs:313`; `scripts/performance/convex/profile.mjs:462`)
- **Measurement qualification — inferred:** Seven samples apply to query rows; mutation flows run four iterations with this configuration, while fan-out and contention use individual scenarios/bursts. The parity runner also needs an explicit terminal-exhaustion assertion before its 200-page safety bound is reused on larger datasets. (`scripts/performance/convex/profile.mjs:261`; `scripts/performance/convex/profile.mjs:429`; `scripts/performance/convex/profile.mjs:590`; `scripts/performance/convex/search-parity.mjs:91`)
- **Fix:** Replace subscriptions after recovery, assert successful terminal results, correlate all completions, and repeat bursts. Include unrelated-product writes and fully populated change shards.
- **Expected impact and risk — inferred:** Makes comparisons representative and detects missing work. Existing refusal-path payslip/package rows and absent expensive-action profiles cannot establish successful-path performance. (`evidence/iter4.md:56`; `evidence/iter4.md:64`; `evidence/iter4.md:65`) **Previous finding 10 remains partially resolved.**

## Already good (brief)

- **Inferred:** Tenant-scoped access and warehouse authorization remain intact in inspected changes. Shards and occupancy tables are registered tenant tables; internal backfill derives organization ownership from the warehouse. (`convex/lib/schemaPolicy.ts:35`; `convex/lib/schemaPolicy.ts:41`; `convex/storageLayouts/zoneOccupancyBackfill.ts:72`)
- **Inferred:** Existing parity tests compare derived and authoritative outputs through reservation, confirmation, cancellation, stacking changes, and two-zone moves. Fixture cleanup retains coverage of the derived tables and now cleans shards. (`tests/integration/storage-query-scale.integration.test.ts:813`; `tests/integration/storage-query-scale.integration.test.ts:890`; `convex/staging/e2eFixture.ts:348`)
- **Measured:** Ordinary scan listing reads 60 documents; saving 50 scans reads 10 and writes 53. Static building layout remains separate at 25 reads. (`evidence/iter4.md:28`; `evidence/iter4.md:35`; `evidence/iter4.md:77`)

## What would raise the score to 9+

- Demonstrate successful bounded roster loading beyond 50 employees with historical eligibility and save protection preserved.
- Make substring searches selective while proving complete multilingual matching and ordering.
- Bound recommendation and building-detail reads, bytes, geometry work, and reactive dependencies by displayed results.
- Scope overflow fallback and demonstrate dense backfill recovery within transaction budgets.
- Demonstrate acceptable sequence-counter, shard, and same-zone contention under repeated concurrent loads.
- Measure fully settled subscriptions, populated shards, successful payslip/package paths, and expensive actions as fixtures grow.
