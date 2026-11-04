## Score: 6/10

- **Measured:** The roster now succeeds on the 153-employee fixture: the current 20-employee page reads **85 documents**. The compatible request without `pageSize` reads **254 documents** and returns its first 50 employees; base instead returns `LIMIT_EXCEEDED` after 162 reads. This resolves the capacity failure that previously held the score at 4. (`evidence/iter6.md:14`; `evidence/iter6.md:22`; `evidence/iter6.json:2133`)
- **Measured:** Maintained catalogue totals read **18 documents / 6.9 KB in one request**, versus **272 / 136.9 KB across two requests** on base. The same improvement appears in iteration 5. (`evidence/iter6.md:39`; `evidence/iter5.md:39`)
- **Measured:** Heavy screen paths remain: saved-scan search reads **2,389 documents across 22 requests**, location search **896 across two**, and recommendations **687–688 documents / approximately 1,284 KB**. Building inventory reads only 35 documents but still transfers **964.1 KB** from the database. These keep performance within the rubric’s 5–6 band. (`evidence/iter6.md:6`; `evidence/iter6.md:10`; `evidence/iter6.md:11`; `evidence/iter6.md:12`; `evidence/iter6.md:30`)
- **Measured:** Eight concurrent same-product creations incur **12 retries versus 10 on base**; distinct-pallet measurement saves incur **3 versus 11**. Totals shards now appear among the recorded conflicts. All these operations succeed. (`evidence/iter6.md:94`; `evidence/iter6.md:96`; `evidence/iter6.md:121`; `evidence/iter6.md:123`; `evidence/iter6.json:3003`; `evidence/iter6.json:3036`)
- **Inferred:** The score increase credits working pagination and measured aggregate reads. Remaining maintenance limits, broad dependencies, and incomplete reactive measurement prevent 7+. Two new totals-integrity defects also need correction; the score remains a performance assessment.

## Changes since last audit

- **Maintained warehouse totals — correct on the ordinary tested path, with regressions and limits below.** **Inferred:** Product-summary deltas and product count/unit-label changes update tenant-scoped totals inside the source transaction. Backfill reads products and their summaries and publishes eight shards atomically; concurrent conflicting writes therefore cannot silently escape that transaction. Query authorization and warehouse checks remain intact. Tests compare maintained totals against the complete scan through product insertion, unit replacement, pallet transition and pallet deletion. They do not test product deletion, special unit-label keys, concurrent backfill, or rollback to iteration 4. (`convex/lib/finishedGoodsSummary.ts:66`; `convex/lib/finishedGoodsSummary.ts:419`; `convex/finishedGoods/totalsBackfill.ts:36`; `convex/finishedGoods/totalsBackfill.ts:59`; `convex/finishedGoods/totalsBackfill.ts:93`; `tests/integration/finished-goods-warehouse-totals.integration.test.ts:152`)

  **Measured:** Summary reads fall from 272 to 18 and requests from two to one. Recorded reservation/cancellation fan-out no longer includes summary rescans; candidate follow-up work is zero versus base’s two requests / 272 reads. **Iteration-4 finding 7 is partially resolved:** the measured warehouse is fixed, but initial totals construction refuses catalogues above 2,000 products. (`evidence/iter6.md:39`; `evidence/iter6.md:88`; `evidence/iter6.md:89`; `evidence/iter6.md:115`; `convex/lib/warehouseTotals.ts:14`)

- **Removing `productSummary`’s change-token dependency — correct.** **Inferred:** This single-product query has no accumulated continuation to invalidate. It still reads the authorized product, readiness and product summary, retaining dependencies on what it displays. **Measured:** Direct execution remains 12 reads versus base; reservation and cancellation no longer rerun it in the recorded scenario, while pallet creation does. No unrelated-product write probe establishes the complete scope improvement. (`convex/finishedGoods/catalogue.ts:517`; `convex/finishedGoods/catalogue.ts:534`; `evidence/iter6.md:46`; `evidence/iter6.md:88`; `evidence/iter6.md:90`)

- **Server-paged roster — correct for the inspected backend behavior; iteration-4 finding 1 resolved.** **Inferred:** Site authorization precedes employee traversal. Employment, search and department filters apply while scanning the existing employee-code index; hydration reads only displayed employees’ monthly attendance, assignments and claims. Global assignment revisions, old-site isolation, recorded plans and lock precedence remain intact. Saves retain the existing atomic validation and 50-employee bound. Cursor binding and retained-ID revalidation reuse the existing HR paginator. (`convex/hr/roster.ts:340`; `convex/hr/roster.ts:379`; `convex/hr/roster.ts:442`; `convex/hr/roster.ts:580`; `convex/hr/roster.ts:636`; `convex/hr/pagination.ts:203`; `convex/hr/pagination.ts:386`)

  **Inferred, test inspection:** Added tests traverse all 153 employees without duplicates at page sizes 20 and 50, check filters and read budgets, compare smaller-site output against the legacy fixture, and reject mismatched cursors. The client test covers selections and observed revisions surviving page changes. These are meaningful guards. (`tests/integration/hr-roster-paging.integration.test.ts:462`; `tests/integration/hr-roster-paging.integration.test.ts:573`; `tests/integration/hr-roster-paging.integration.test.ts:689`; `src/features/hr/ShiftsRoster.test.tsx:595`)

  **Measured qualification:** The paged row’s **0.15 ms base execution is argument-validation failure**, with seven errors and zero reads. It cannot support a latency speedup claim. The compatible no-page-size row compares a successful partial grid against the old capacity refusal, rather than equivalent successful results. (`evidence/iter6.json:2175`; `evidence/iter6.json:2211`)

**Scope and verification — inferred:** Audited snapshot `f4baced9`, the cumulative `80dc0a93..HEAD` changes, and iterations 5–6 against the previous iteration-4 report. The snapshot’s Convex digest recomputes to **`98e0162d6eb51ecb`**, matching iteration 6’s clean candidate. Iteration 5 records a dirty precursor; iteration 6 independently confirms its principal totals improvement. Backend versions remain `unknown`. Tests were inspected, not executed: this read-only snapshot has no `node_modules`. No deployment was called. (`scripts/performance/convex/profile.mjs:730`; `evidence/iter6.json:18`; `evidence/iter5.json:18`)

Code references are relative to the audited snapshot; evidence references are relative to the supplied review directory. Document and byte counts carry more weight than latency.

## Findings (ranked by impact, max 10)

### 1. Open — substring searches still perform history-sized work

- **Location:** `convex/finishedGoods/jobScans.ts:675`; `convex/finishedGoods/jobScanLocations.ts:703`. Callers: `src/features/finishedGoods/jobScan/JobScanRecords.tsx:132`; `src/features/finishedGoods/jobScan/LocationPicker.tsx:578`.
- **Evidence — measured:** Saved-scan search reads **2,389 documents / 1,541.1 KB across 22 requests**. Location search reads **896 / 474.3 KB across two**, returning 0.8 KB. (`evidence/iter6.md:6`; `evidence/iter6.md:10`)
- **Cost mechanism — inferred:** Indexed traversal precedes substring rejection. Request bounds prevent individual unbounded scans but do not make complete searches selective.
- **Fix:** Explore transactionally maintained normalized gram postings in tenant/warehouse-scoped equality indexes, with live verification and complete fallback during migration or for unsupported short queries.
- **Expected impact and risk — inferred:** Avoid hydrating rejected history. Preserve NFKC matching, multilingual completeness, newest-first ordering, picker prefix priority, QR identity and truthful exhaustion; measure posting write/storage costs. **Iteration-4 finding 2 remains open.**

### 2. Partially resolved — recommendations remain proportional to active warehouse contents

- **Location:** `convex/finishedGoods/workflow.ts:1090`; `convex/finishedGoods/workflow.ts:1106`. Callers: `src/features/finishedGoods/PalletScreens.tsx:598`; `src/features/finishedGoods/MoveScreen.tsx:177`.
- **Evidence — measured:** Recommendations read **687–688 documents**, approximately **1,284 KB**, and return approximately **238 KB**. (`evidence/iter6.md:11`; `evidence/iter6.md:12`)
- **Cost mechanism — inferred:** All active buildings’ zones are loaded before context construction, support validation and geometry evaluation. Derived occupancy reduces documents without bounding bytes or reactive scope by displayed candidates.
- **Fix:** Backfill verified candidate-selection projections, then hydrate bounded candidate pages and requested previews.
- **Expected impact and risk — inferred:** Reduce reads, payloads and geometry work. Preserve complete eligibility, candidate order, reason precedence and fresh transactional placement validation. **Iteration-4 finding 3 remains partially resolved.**

### 3. New regression — valid unit labels can corrupt maintained label counts or reject writes

- **Location:** `convex/lib/finishedGoodsSummary.ts:424`; `convex/lib/warehouseTotals.ts:80`; `convex/schema.ts:523`. Public input: `convex/finishedGoods/workflow.ts:250`.
- **Evidence — inferred:** Unit labels are arbitrary nonempty strings up to 40 characters. Delta accumulation uses `{}` and reads `units[label]` without checking ownership. For `__proto__`, assignment produces no own delta entry; inserting such a product increments its product count while omitting its unit label. For `constructor` or `toString`, inherited functions enter arithmetic and can produce nonnumeric counts rejected by the numeric schema. A local JavaScript probe confirms these object-property behaviors; this is not a measured backend execution.
- **Cost mechanism — inferred:** Ordinary authorized product writes can fail, or maintained results can diverge from the complete scan. Existing tests use ordinary labels and miss this case. (`tests/integration/finished-goods-warehouse-totals.integration.test.ts:164`)
- **Fix:** Accumulate labels with `Map` or a null-prototype dictionary. Add public-write parity cases for these labels, including edits/removal. Invalidate and rebuild potentially affected totals.
- **Expected impact and risk — inferred:** Restore accepted-input behavior and exact labels without changing authorization or imposing new label restrictions.

### 4. Partially resolved — shared counters and totals shards still contend

- **Location:** `convex/finishedGoods/workflow.ts:110`; `convex/lib/finishedGoodsSummary.ts:179`; `convex/lib/warehouseTotals.ts:29`; `convex/lib/warehouseTotals.ts:96`.
- **Evidence — measured:** Eight same-product creations require **20 executions / 12 retries**, versus base’s 18 / 10. Distinct-pallet measurements require **11 / 3**, versus 19 / 11. Recorded candidate conflicts identify both warehouse totals and change shards. (`evidence/iter6.md:94`; `evidence/iter6.md:96`; `evidence/iter6.json:3003`; `evidence/iter6.json:3036`)
- **Cost mechanism — inferred:** Sequence allocation and product summaries remain shared. Product-hashed totals add deterministic coupling between different products assigned to the same one of eight shards. The comment claiming no conflicts beyond a product summary does not cover cross-product collisions.
- **Fix:** Separate independent sequence allocation where semantics permit; tune aggregate sharding against repeated same-product, different-product and distinct-zone bursts. Scope remaining continuation signals where correctness permits.
- **Expected impact and risk — inferred:** Reduce retries while preserving exact totals, code uniqueness, ordering and idempotency. This burst does not establish a statistically significant retry regression from iteration 4. **Iteration-4 finding 4 remains partially resolved.**

### 5. Partially resolved — building inventory remains large and overflow disables optimization warehouse-wide

- **Location:** `convex/storageLayouts/catalogue.ts:571`; `convex/storageLayouts/catalogue.ts:641`; `convex/lib/zoneOccupancy.ts:406`. Caller: `src/features/storageLayouts/useStorageBuilding.ts:23`.
- **Evidence — measured:** Inventory reads **35 documents / 964.1 KB**, returning **447.8 KB**. (`evidence/iter6.md:30`)
- **Cost mechanism — inferred:** The live screen subscribes to complete inventory. Any warehouse overflow flag disables derived building readers. Ordinary writes skip overflow reconstruction, and sweep skips otherwise current overflowed warehouses, allowing fallback to persist after occupancy falls. (`convex/lib/zoneOccupancy.ts:317`; `convex/lib/zoneOccupancy.ts:420`; `convex/storageLayouts/zoneOccupancyBackfill.ts:200`)
- **Fix:** Separate overview summaries from floor/zone detail; maintain verified placement-building membership to scope fallback safely; schedule bounded overflow recovery.
- **Expected impact and risk — inferred:** Bound detail hydration and confine fallback cost. Preserve placement-building semantics, both move holds and exact geometry. **Iteration-4 finding 5 remains partially resolved.**

### 6. Partially resolved — individual writes still rewrite complete occupancy rows

- **Location:** `convex/lib/zoneOccupancy.ts:175`; `convex/lib/zoneOccupancy.ts:310`; maintenance caller `convex/lib/finishedGoodsSummary.ts:432`.
- **Evidence — measured:** Reservation reads/writes **37/9 documents**, versus base’s **28/7**; cancellation **32/8**, versus **23/6**. The reactive reservation probe writes 9.4 KB versus 7.2 KB. (`evidence/iter6.md:79`; `evidence/iter6.md:80`; `evidence/iter6.md:88`; `evidence/iter6.md:106`; `evidence/iter6.md:107`; `evidence/iter6.md:115`)
- **Cost mechanism — inferred:** Changed complete rows sort placements, calculate footprint unions, compare packed values and replace entries containing up to 500 placements. Same-zone writers share those documents.
- **Fix:** Profile dense-zone reservations, releases, moves and pallet edits with concurrent writers. Introduce byte-bounded chunks or narrower projections if required, retaining transactional area accounting.
- **Expected impact and risk — inferred:** Control write bytes, CPU and conflicts without sacrificing read correctness. Current measurements do not cover near-capacity same-zone contention. **Iteration-4 finding 6 remains partially resolved.**

### 7. Partially resolved — totals acceleration has a 2,000-product bootstrap ceiling

- **Location:** `convex/lib/warehouseTotals.ts:14`; `convex/finishedGoods/totalsBackfill.ts:40`; `convex/finishedGoods/catalogue.ts:566`. Caller: `src/features/finishedGoods/FinishedGoodsCatalogue.tsx:105`.
- **Evidence — measured:** The 126-product fixture achieves **18 reads in one request**. No larger-catalogue backfill measurement is supplied. (`evidence/iter6.md:1`; `evidence/iter6.md:39`)
- **Cost mechanism — inferred:** Initial construction and rebuild refuse above 2,000 products; those warehouses retain complete product-summary scanning and continuation invalidation. Successfully built warehouses can subsequently grow beyond that threshold, but cannot rebuild through this implementation. Unit-label arrays also grow with distinct labels despite the fixed shard count.
- **Fix:** Build totals through bounded, owned, resumable work with a defined concurrent-write reconciliation protocol and atomic publication. Bound label storage by bytes and expose refusal reasons operationally.
- **Expected impact and risk — inferred:** Extend measured gains to larger catalogues while preserving exact counters, label removal and safe fallback. **Iteration-4 finding 7 is partially resolved.**

### 8. Open — occupancy backfill bounds zones rather than reconstruction work

- **Location:** `convex/storageLayouts/zoneOccupancyBackfill.ts:69`; `convex/storageLayouts/zoneOccupancyBackfill.ts:122`; `convex/lib/zoneOccupancy.ts:77`; `convex/lib/zoneOccupancy.ts:228`.
- **Evidence — inferred:** An accepted 50-zone page can contain 500 held placements per zone. With distinct pallets, reconstruction can require **25,000 placement reads plus 25,000 pallet reads**, before metadata. These are source-derived workload counts, not measured executions. Default pages contain 20 zones.
- **Cost mechanism — inferred:** Dense pages can exceed transaction budgets and prevent recovery from advancing, despite bounded warehouse dispatch.
- **Fix:** Use a measured reconstruction budget, initially one zone per transaction if necessary; preserve run ownership and publish readiness only after complete traversal.
- **Expected impact and risk — inferred:** Make dense recovery viable. Add dense multi-zone and retry/resumption coverage. **Iteration-4 finding 8 remains open; this is an existing risk.**

### 9. New regression — the totals rollback guard misses iteration-4 writers

- **Location:** `convex/lib/warehouseTotals.ts:121`; `convex/finishedGoods/totalsBackfill.ts:125`; `convex/lib/finishedGoodsSummary.ts:451`. Historical writer: `convex/lib/finishedGoodsSummary.ts:412` at `db92906a`.
- **Evidence — inferred:** The guard compares only legacy `generation`. Iteration 4 already records ordinary writes in `finishedGoodsChangeShards` without advancing that generation. Build totals, roll back to iteration 4, change inventory or products, then restore iteration 6: totals can still pass readiness despite missing those writes. Sweep also considers them current.
- **Cost mechanism — inferred:** Stale derived counters can persist indefinitely. The rollback test manually increments legacy generation, so it does not guard rollback to the actual parent implementation. (`tests/integration/finished-goods-warehouse-totals.integration.test.ts:196`)
- **Fix:** Invalidate totals explicitly across unsupported writer-version transitions, or implement a compatibility protocol covering sharded writers. Rebuild before trusting affected totals; test the actual build → old writer → restore sequence.
- **Expected impact and risk — inferred:** Prevent silently stale counters after rollback/re-upgrade. No such deployment sequence is demonstrated in the supplied measurements.

### 10. Partially resolved — reactive measurements still do not model settled subscription replacement

- **Location:** `scripts/performance/convex/profile.mjs:309`; `scripts/performance/convex/profile.mjs:472`. Actual client: `src/hooks/useCatalogueSync.ts:72`.
- **Evidence — measured:** Reservation records **8 reruns / 1,708 reads**, versus base’s **10 / 6,098**, with zero versus two follow-up requests. These demonstrate reduced recorded work. (`evidence/iter6.md:88`; `evidence/iter6.md:115`)
- **Cost mechanism — inferred:** Recovery calls `settledArgs()` but discards its returned arguments and retains the old WebSocket subscription. Later writes therefore do not exercise the fully recovered subscription state. Settlement loops also lack an explicit successful-terminal assertion at their safety bound. (`scripts/performance/convex/profile.mjs:193`; `scripts/performance/convex/profile.mjs:477`)
- **Fix:** Replace subscriptions after recovery, assert terminal success, correlate complete execution logs and repeat bursts. Report validation failures separately from successful-query comparisons.
- **Expected impact and risk — inferred:** Make reactive totals representative of settled screens. Seven samples apply to query rows; mutation flows use four repetitions here, while contention and fan-out are individual scenarios. Successful payslip/package paths and expensive actions remain unestablished by this profile. (`scripts/performance/convex/profile.mjs:274`; `evidence/iter6.md:57`; `evidence/iter6.md:65`) **Iteration-4 finding 9 remains partially resolved.**

## Already good (brief)

- **Inferred:** Inspected totals and roster paths preserve tenant access and warehouse/site authorization. Internal totals construction derives tenant ownership from the warehouse. (`convex/lib/schemaPolicy.ts:36`; `convex/finishedGoods/totalsBackfill.ts:29`; `convex/hr/roster.ts:340`)
- **Inferred:** Roster hydration now follows displayed employees; assignment saves retain revision, frozen-plan, leave and recorded-day protections. Paging tests cover complete traversal and historical-output parity. (`convex/hr/roster.ts:442`; `convex/hr/roster.ts:696`; `tests/integration/hr-roster-paging.integration.test.ts:462`)
- **Inferred:** Previously resolved backfill ownership, bounded warehouse dispatch and append-only change-log removal remain resolved. (`convex/storageLayouts/zoneOccupancyBackfill.ts:80`; `convex/storageLayouts/zoneOccupancyBackfill.ts:182`; `convex/lib/finishedGoodsSummary.ts:175`)
- **Measured:** Ordinary scan listing reads 60 documents; saving 50 scans reads 10 and writes 53; static building layout reads 25. (`evidence/iter6.md:28`; `evidence/iter6.md:78`; `evidence/iter6.md:35`)

## What would raise the score to 9+

- Make substring searches selective while proving complete multilingual matching and ordering.
- Bound recommendation and inventory bytes, geometry work and subscriptions by displayed results.
- Extend exact totals construction beyond the bootstrap ceiling and repair unit-label and rollback integrity.
- Demonstrate dense occupancy recovery and acceptable same-zone, cross-product and sequence-counter contention.
- Measure fully settled subscriptions, sparse roster searches, populated shards, successful payroll/package paths and expensive actions as fixtures grow.
