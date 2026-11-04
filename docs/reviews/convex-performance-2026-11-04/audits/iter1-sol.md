## Score: 4/10

- **Measured:** The roster still returns `LIMIT_EXCEEDED` on the 153-employee fixture after reading 162 documents. This continues to meet the rubric’s ≤4 criterion; the score is unchanged. (`evidence/iter1.md:20`)
- **Measured:** Recommendations improve by 432 document reads per call, approximately 15%, but still read 2,454–2,455 documents and approximately 1,622 KB. (`evidence/iter1.md:6`; `evidence/iter1.md:7`)
- **Measured:** Saved-scan search still reads 2,389 documents across 22 requests. Building occupancy still reads 917 documents to return 1.0 KB. (`evidence/iter1.md:8`; `evidence/iter1.md:13`)
- **Inferred:** Warehouse-wide generation records, complete occupancy hydration, and scan-based substring matching remain the principal scalability constraints. (`convex/lib/finishedGoodsSummary.ts:331`; `convex/storageLayouts/catalogue.ts:541`; `convex/finishedGoods/jobScans.ts:675`)
- **Inferred:** The reported zero-OCC results cannot establish contention performance: the harness sends workers through one HTTP client whose mutations are queued. This corrects the previous report’s treatment of concurrency evidence without changing the score. (`scripts/performance/convex/profile.mjs:66`; `scripts/performance/convex/profile.mjs:82`; `scripts/performance/convex/profile.mjs:451`; finding 10)

## Changes since last audit

- **Active-building recommendation traversal — correct by inspection.** The single iteration commit, `a3fa1e28`, replaces warehouse-wide zone retrieval with indexed active-building retrieval followed by building-scoped zone ranges. Existing lifecycle and warehouse checks remain; the building range observes activation changes, and active buildings’ zone ranges observe candidate additions. Global code-point ordering is reconstructed before processing reasons and previews. Both indexes already exist, so this change needs no backfill. It introduces an O(active buildings) traversal rather than bounding recommendation work. (`convex/finishedGoods/workflow.ts:650`; `convex/finishedGoods/workflow.ts:1062`; `convex/finishedGoods/workflow.ts:1084`; `convex/schema.ts:1246`; `convex/schema.ts:1348`)
- **Recommendation read sharing — correct by inspection.** Known building documents and stack-validation reads are shared within one query execution. Warehouse, retirement, format, moving-support, child-occupancy, cycle, level, and placement checks remain. Mutation callers omit the optional scope and retain fresh reads. No cross-request cache or missing invalidation was identified. **Measured combined effect:** `recommend` falls from 2,886 to 2,454 documents; `recommendMove` falls from 2,887 to 2,455. Both save 200,952 read bytes against the same-run base; return-byte counts are unchanged. The evidence does not isolate the contribution of traversal versus caching. Latencies improve from 290.35 to 247.16 ms and 273.27 to 243.60 ms respectively, but remain indicative. (`convex/finishedGoods/workflow.ts:572`; `convex/finishedGoods/workflow.ts:2529`; `convex/finishedGoods/workflow.ts:2572`; `convex/finishedGoods/workflow.ts:1445`; `evidence/iter1.json:609`; `evidence/iter1.json:650`)
- **Added regression tests — correct, with coverage gaps.** Tests check complete result parity after adding 60 draft-building zones and enforce read ceilings with 200 blocked pallet supports. They guard the intended read reduction, but do not directly establish ordering across multiple active buildings, Unicode ordering, reactive activation, or cached ancestor-validation parity. Existing stacking tests provide additional behavioral coverage. Tests were inspected, not executed; the read-only snapshot has no installed dependencies. (`tests/integration/storage-query-scale.integration.test.ts:551`; `tests/integration/storage-query-scale.integration.test.ts:593`; `tests/integration/finished-goods-stacking.integration.test.ts:320`)
- **Profiling scripts — risky measurement implementation.** Unique identities, alternating query samples, and summed scan continuations support the query-read comparison. **Measured:** Reserve and cancellation each retain 10 reported re-executions while saving 864 document reads: 6,292→5,428 and 6,290→5,426. **Inferred limitations:** Fan-out holds initial query arguments rather than following client continuations; mutation success checks miss `written:false`; contention workers serialize. These limitations restrict the conclusions, as detailed in finding 10. (`scripts/performance/convex/lib.mjs:24`; `scripts/performance/convex/profile.mjs:134`; `scripts/performance/convex/profile.mjs:166`; `scripts/performance/convex/profile.mjs:253`; `evidence/iter1.md:85`; `evidence/iter1.md:108`)

Audited snapshot: `/Users/macbook/Development/industrial-sas-convex-perf-audit`, commit `a3fa1e284c8654e45f700b9c4eeafadb9be1ade1`. Code references below are relative to that snapshot. Evidence references are relative to `/Users/macbook/Development/industrial-sas-convex-perf/docs/reviews/convex-performance-2026-11-04`.

**Evidence limits — measured and inferred:** The JSON identifies the measured candidate as `80dc0a93+dirty`, without a source digest, and records backend version `unknown`. Its reductions are consistent with the audited diff, but the metadata cannot independently prove an exact deployed-source match. Document/byte counts are the primary signal. Payslip refusals and unsuccessful package resolution remain unsuccessful-path measurements. (`evidence/iter1.json:18`; `evidence/iter1.md:56`; `evidence/iter1.md:64`)

## Findings (ranked by impact, max 10)

### 1. Open — the roster limit still prevents a core screen from loading

- **Location:** `convex/hr/roster.ts:321`; `convex/hr/shared.ts:1109`; `convex/model/hr/roster.ts:53`. Caller: `src/features/hr/ShiftsRoster.tsx:699`.
- **Evidence — measured:** 162 documents and 112.8 KB read, followed by `LIMIT_EXCEEDED`. (`evidence/iter1.md:20`)
- **Evidence — inferred:** The site employee range is loaded and the 50-employee limit applied before search or department filtering. Successful requests subsequently load site-wide attendance for the month. (`convex/hr/shared.ts:1119`; `convex/hr/roster.ts:328`; `convex/hr/roster.ts:330`; `convex/hr/roster.ts:348`)
- **Cost mechanism:** Site-sized reads followed by complete refusal; below the limit, attendance dependencies extend beyond filtered employees.
- **Fix:** Page authorized employees through tenant/site indexes and retrieve employee/date attendance, assignments, and leave claims for the displayed page. Preserve historical employment eligibility, employee/date revisions, frozen-plan checks, and bounded atomic saves. Backfill any new filter fields.
- **Expected impact and risk — inferred:** Restores larger-site access and bounds grid reads. Incorrect eligibility or revision handling could omit historical employees or weaken write protection.

### 2. Partially resolved — recommendations still calculate the active warehouse

- **Location:** `convex/finishedGoods/workflow.ts:1046`; `convex/finishedGoods/workflow.ts:642`. Callers: `src/features/finishedGoods/PalletScreens.tsx:599`; `src/features/finishedGoods/MoveScreen.tsx:177`.
- **Evidence — measured:** Recommendations now read 2,454–2,455 documents, approximately 1,622 KB, and return approximately 238 KB. The 432-document reduction is real within the supplied comparison. (`evidence/iter1.md:6`; `evidence/iter1.md:7`)
- **Evidence — inferred:** Inactive-building reads and repeated stack reads are reduced. Every active building and its zones are still traversed; eligible contexts load occupancy and supports, then calculate fits before sorting candidates. (`convex/finishedGoods/workflow.ts:1062`; `convex/finishedGoods/workflow.ts:1094`; `convex/finishedGoods/workflow.ts:1113`; `convex/finishedGoods/workflow.ts:1130`)
- **Cost mechanism:** Reads, geometry work, and reactive dependencies still grow with active warehouse size.
- **Fix:** Retrieve candidate pages through verified eligibility summaries, calculating exact geometry for candidates and selected previews. Preserve complete reachability, ordering, preview behavior, and reason precedence. Keep fresh reservation/confirmation validation; backfill and reconcile summaries before enabling them.
- **Expected impact and risk — inferred:** Reduces initial warehouse-wide hydration. Summary false negatives could hide valid destinations; summaries must never authorize placement.

### 3. Open — saved-scan substring search remains a history scan

- **Location:** `convex/finishedGoods/jobScans.ts:625`; `convex/lib/boundedRecordPage.ts:214`. Caller: `src/features/finishedGoods/jobScan/JobScanRecords.tsx:131`.
- **Evidence — measured:** Search reads 2,389 documents and 1,541.1 KB across 22 requests; ordinary listing reads 60 documents. (`evidence/iter1.md:8`; `evidence/iter1.md:30`)
- **Evidence — inferred:** Warehouse/mapping indexes select history ranges; substring matching happens afterward. Continuations re-read accepted IDs, and building-name matching adds parent reads. Source documents retain optional `aiRaw`. (`convex/finishedGoods/jobScans.ts:675`; `convex/finishedGoods/jobScans.ts:699`; `convex/lib/boundedRecordPage.ts:215`; `convex/schema.ts:1054`)
- **Cost mechanism:** Sparse searches approach retained-history cost despite bounded individual requests.
- **Fix:** Add tenant/warehouse-scoped substring candidate indexing with exact existing normalization and live verification. Cover all searchable fields and building renames; retain correct short-search fallback during migration. Separately migrate cold extraction payloads into authorized detail documents.
- **Expected impact and risk — inferred:** Selective searches approach matching-result cost. Token/prefix-only search would change behavior; ordering, rename propagation, and cursor completeness require validation.

### 4. Open — building summary rows reconstruct occupancy from every placement

- **Location:** `convex/storageLayouts/catalogue.ts:338`; `convex/storageLayouts/catalogue.ts:467`. Caller: `src/features/storageLayouts/StorageLayoutScreens.tsx:347`.
- **Evidence — measured:** `buildingOccupancy` reads 917 documents and 819.4 KB to return 1.0 KB. (`evidence/iter1.md:13`)
- **Evidence — inferred:** Each displayed building row subscribes separately. Its query loads stored/reserved placements and computes footprint unions by zone. (`src/features/storageLayouts/StorageLayoutScreens.tsx:354`; `convex/storageLayouts/catalogue.ts:342`)
- **Cost mechanism:** Small catalogue summaries require occupancy-sized reads and recomputation.
- **Fix:** Maintain exact zone occupancy summaries and building aggregates, with verified backfill/reconciliation. Preserve indexed presence checks and union semantics: held area is the combined union minus stored area. (`convex/model/storageLayout/areaUsage.ts:25`)
- **Expected impact and risk — inferred:** Summary reads become proportional to displayed summary rows. Summing rectangle areas would corrupt stacked/overlapping occupancy; moves, holds, and location-only placements must remain exact.

### 5. Open — shared generation records couple inventory writes and subscriptions

- **Location:** `convex/lib/finishedGoodsSummary.ts:311`; wrapper: `convex/lib/tenantFunctions.ts:489`. Readers: `convex/finishedGoods/catalogue.ts:371`, `:515`; `convex/storageLayouts/locationCatalogue.ts:339`.
- **Evidence — inferred:** Tracked inventory writes increment one warehouse readiness/generation document. Storage changes similarly update one warehouse signal. Product contribution updates also share a per-product summary. (`convex/lib/finishedGoodsSummary.ts:253`; `convex/lib/finishedGoodsSummary.ts:313`; `convex/lib/finishedGoodsSummary.ts:331`; `convex/lib/finishedGoodsSummary.ts:46`)
- **Evidence — measured, limited:** Pallet creation reports seven query re-executions and 510 documents re-read on both targets. This probe uses the displayed product, so it does not establish unrelated-product invalidation. Contention remains untested because workers serialize. (`evidence/iter1.md:87`; `evidence/iter1.md:110`; finding 10)
- **Cost mechanism:** Warehouse documents create shared write-conflict points and broad invalidation dependencies.
- **Fix:** Separate stable readiness from mutable versions; use product/range-specific versions and bounded sharded aggregates while preserving continuation consistency. Measure concentrated product writes before choosing summary sharding.
- **Expected impact and risk — inferred:** Removes warehouse-wide contention and unnecessary re-execution. Incorrect version scope can produce inconsistent totals or pagination.

### 6. Open — active building views still hydrate complete inventory

- **Location:** `convex/storageLayouts/catalogue.ts:528`; legacy path: `convex/storageLayouts/catalogue.ts:184`. Caller: `src/features/storageLayouts/useStorageBuilding.ts:22`.
- **Evidence — measured:** Inventory reads 1,829 documents and 1,317.4 KB, returning 447.8 KB. Static layout reads 25 documents. Legacy building/map endpoints read 1,844 and 936 documents. (`evidence/iter1.md:9`; `evidence/iter1.md:10`; `evidence/iter1.md:12`; `evidence/iter1.md:36`)
- **Evidence — inferred:** The hook subscribes to complete building inventory alongside layout. Every placement hydrates pallet/product data. Legacy floor readers additionally retrieve warehouse-wide active moves. (`src/features/storageLayouts/useStorageBuilding.ts:23`; `convex/storageLayouts/catalogue.ts:541`; `convex/storageLayouts/catalogue.ts:100`; `convex/storageLayouts/moveOccupancy.ts:17`)
- **Cost mechanism:** Initial work grows with building occupancy; much supports the genuinely large returned result.
- **Fix:** Use exact overview summaries and floor/zone/page-scoped inventory, retaining explicit access to complete detail. Preserve the existing layout separation and building-scoped move reader.
- **Expected impact and risk — inferred:** Reduces hydration when only part of a building is displayed. Preserve both move holds, stack geometry, location-only occupancy, and compatibility floor context.

### 7. Open — location-picker fallback scans many candidates for a tiny result

- **Location:** `convex/finishedGoods/jobScanLocations.ts:320`; `:663`. Caller: `src/features/finishedGoods/jobScan/LocationPicker.tsx:578`.
- **Evidence — measured:** Search reads 896 documents and 474.3 KB across two requests, returning 0.8 KB; exact resolution reads 15 documents. (`evidence/iter1.md:14`; `evidence/iter1.md:42`)
- **Evidence — inferred:** Indexed prefix retrieval is followed by contains-match ranges. Physical candidates can require source hydration before rejection; lookahead proves further-match exhaustion. (`convex/finishedGoods/jobScanLocations.ts:348`; `:719`; `:733`)
- **Cost mechanism:** Sparse substring queries remain catalogue-sized searches.
- **Fix:** Backfill normalized physical search projections and scoped substring candidates, retaining live lifecycle/authorization checks and legacy building-ownership fallback until migration completes.
- **Expected impact and risk — inferred:** Narrows search and avoids hydration of rejected candidates. Preserve prefix-first ordering, Thai/interior matching, QR identity behavior, and truthful exhaustion before registration.

### 8. Open — warehouse counters still scan products and materialized summaries

- **Location:** `convex/finishedGoods/catalogue.ts:524`. Caller: `src/features/finishedGoods/FinishedGoodsCatalogue.tsx:105`.
- **Evidence — measured:** 272 documents and 136.9 KB across two requests to return 1.6 KB. (`evidence/iter1.md:16`)
- **Evidence — inferred:** Each chunk reads up to 100 products and their summaries. The continuation scope includes warehouse generation. (`convex/finishedGoods/catalogue.ts:548`; `:586`; `:610`)
- **Cost mechanism:** Completed counters remain O(products), with resets possible during inventory changes.
- **Fix:** Maintain bounded sharded warehouse totals and exact unit-label reference counts from contribution changes. Backfill and reconcile against current totals before switching.
- **Expected impact and risk — inferred:** Replaces product-sized reads with bounded aggregate reads. Preserve inherited formats, label removal, and atomic accounting; one warehouse counter would recreate finding 5.

### 9. Open — compatibility endpoints retain complete-range reads and capacity cliffs

- **Location:** `convex/finishedGoods/workflow.ts:1338`; helper: `:73`. Client export: `src/lib/convex/finishedGoodsApi.ts:53`.
- **Evidence — measured:** `workflow:list` reads 1,440 documents and 914.8 KB, returning 925.4 KB. (`evidence/iter1.md:11`)
- **Evidence — inferred:** It loads all warehouse products, pallets, and active moves before joining/sorting them. Complete reads throw beyond their 10,000-row bound. The current catalogue uses the paginated endpoint. (`convex/finishedGoods/workflow.ts:1345`; `:1357`; `convex/lib/tenantStorage.ts:379`; `src/features/finishedGoods/FinishedGoodsCatalogue.tsx:90`)
- **Cost mechanism:** Large responses and eventual capacity failures for compatibility consumers.
- **Fix:** Verify deployed-client usage, migrate integrations to paginated contracts, and retire complete-list APIs through an explicit rollout.
- **Expected impact and risk — inferred:** Removes retained expensive endpoints. Current UI benefit is limited; premature removal could break older clients.

### 10. New — the harness overstates contention and successful-write coverage

- **Location:** `scripts/performance/convex/profile.mjs:66`, `:194`, `:241`, `:448`; `scripts/performance/convex/scenarios.mjs:427`.
- **Evidence — inferred:** All workers share one `ConvexHttpClient`, calling mutations without `skipQueue`. The installed matching Convex 1.46.0 SDK queues and awaits mutations sequentially. The reported “8 concurrent” executions, zero OCC retries, and RTT therefore describe serialized requests. Supporting dependency: `/Users/macbook/Development/industrial-sas-convex-perf/node_modules/convex/src/browser/http_client.ts:418`, `:445`, `:463`. Reported figures: `evidence/iter1.md:89`, `:91`, `:112`, `:114`.
- **Evidence — inferred:** Measurement-save targets a stored pallet, which cannot succeed. Its 11 reads/two writes measure refusal handling. Flow checks ignore business refusals; contention checks miss both outer denials and `value.written:false`. Fan-out’s `writeOk` records only the outer envelope. (`scripts/performance/convex/scenarios.mjs:431`; `convex/finishedGoods/workflow.ts:515`; `:521`; `scripts/performance/convex/profile.mjs:204`; `:411`; `:465`; `convex/lib/writeEnvelope.ts:36`; `convex/lib/tenantFunctions.ts:539`; `evidence/iter1.md:78`)
- **Evidence — inferred:** Fan-out callbacks discard results and never advance `scanCursor`. Its counts describe initial subscriptions, excluding client continuation/reset work; the summary rerun reads 210 documents versus 272 for settled loading. (`scripts/performance/convex/profile.mjs:253`; `evidence/iter1.md:85`; `evidence/iter1.md:16`)
- **Cost mechanism:** These defects conceal contention, refusals, and continuation amplification.
- **Fix:** Use independent clients or `skipQueue:true`, verify overlapping executions, assert outer success plus the function’s actual write outcome, exercise an eligible measurement pallet, and implement client-equivalent continuation handling. Persist source digests and operation results.
- **Expected impact and risk — inferred:** Produces defensible performance evidence. This finding changes measurement confidence, not the observed production read reductions.

## Already good (brief)

- **Inferred:** Tenant ownership checks, indexed access, and fail-complete capacity handling remain intact. (`convex/lib/tenantDb.ts:89`; `convex/lib/tenantStorage.ts:368`)
- **Measured and inferred:** Ordinary scan listing remains bounded at 60 documents; query-local caching shares parent reads within the authorized execution. (`evidence/iter1.md:30`; `convex/finishedGoods/jobScans.ts:625`; `convex/lib/queryDocumentReader.ts:8`)
- **Measured and inferred:** Static building layout remains separate from inventory, reading 25 documents. Recommendation caching preserves fresh mutation validation. (`evidence/iter1.md:36`; `convex/storageLayouts/catalogue.ts:524`; `convex/finishedGoods/workflow.ts:1445`)
- **Measured:** The 50-item scan-save flow reads 10 documents and writes 53 on both targets. (`evidence/iter1.md:77`; `evidence/iter1.md:100`)

## What would raise the score to 9+

- Demonstrate successful, paginated roster loading beyond 50 employees while preserving historical eligibility and write locks.
- Make recommendation selection, occupancy metrics, and warehouse counters use selective indexes or verified summaries, retaining exact transactional placement checks.
- Demonstrate selective substring search without history-sized reads while preserving normalization, ordering, completeness, and rename behavior.
- Remove shared warehouse write bottlenecks and unnecessary reactive dependencies without weakening cursor consistency or aggregate integrity.
- Repair the harness and measure actual overlapping writes, unrelated-product invalidation, settled reactive continuations, successful measurement saves, activated payslips, successful package resolution, and expensive actions at increasing fixture sizes.
