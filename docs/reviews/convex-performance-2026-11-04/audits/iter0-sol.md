## Score: 4/10

- **Measured:** A core roster screen returns `LIMIT_EXCEEDED` on the 153-employee fixture, meeting the rubric’s ≤4 criterion. It reads 162 documents before returning the refusal. (`evidence/iter0-baseline.md:20`; `audit-brief.md:27`)
- **Measured:** Placement recommendations read 2,886–2,887 documents and about 1,818 KB per execution. Saved-scan search reads 2,389 documents across 22 requests to settle one page. (`evidence/iter0-baseline.md:6`; `evidence/iter0-baseline.md:8`)
- **Measured:** Building occupancy reads 917 documents and 819.4 KB to return 1.0 KB; building inventory reads 1,829 documents. These are active client subscriptions. (`evidence/iter0-baseline.md:10`; `evidence/iter0-baseline.md:13`; `src/features/storageLayouts/StorageLayoutScreens.tsx:347`; `src/features/storageLayouts/useStorageBuilding.ts:23`)
- **Inferred:** Shared warehouse generation documents couple otherwise independent inventory writes and catalogue subscriptions. Existing pagination limits individual requests, but several completed operations still scale with warehouse size or retained history. (`convex/lib/finishedGoodsSummary.ts:331`; `convex/finishedGoods/catalogue.ts:371`; `convex/finishedGoods/jobScans.ts:675`)
- **Measured:** Many detail, self-service, and write paths are comparatively small. Eight concurrent job-scan saves produced zero OCC retries and failures on both backends; this does not test inventory contention. (`evidence/iter0-baseline.md:43`; `evidence/iter0-baseline.md:74`; `evidence/iter0-baseline.md:87`; `evidence/iter0-baseline.md:106`)

Audited revision: `80dc0a937022ebebcd36a113e4401d3acaaa52f1`. Code paths below are relative to `/Users/macbook/Development/industrial-sas-convex-perf-base`; evidence paths are relative to `/Users/macbook/Development/industrial-sas-convex-perf/docs/reviews/convex-performance-2026-11-04`.

**Measured evidence limits:** This is iteration 0, an A/A baseline. Read counts and bytes are the primary signal; latency and reactive fan-out are indicative under the documented machine load. Progressive-query figures cover the summed continuation chain. Payslip refusals and unsuccessful package resolution do not establish successful-path performance. (`evidence/iter0-baseline.md:1`; `audit-brief.md:17`; `audit-brief.md:20`)

## Findings (ranked by impact, max 10)

### 1. The roster’s employee limit prevents a core screen from loading

- **Location:** `convex/hr/roster.ts:321`; `convex/hr/shared.ts:1109`; `convex/model/hr/roster.ts:53`. Caller: `src/features/hr/ShiftsRoster.tsx:698`.
- **Evidence — measured:** 162 documents, 112.8 KB read, then `LIMIT_EXCEEDED`. (`evidence/iter0-baseline.md:20`)
- **Evidence — inferred:** The implementation loads the site’s employee range and rejects more than 50 employed employees before applying search or department filters. A narrow search cannot rescue an oversized site. Successful requests subsequently load attendance for the entire site/date range. (`convex/hr/shared.ts:1119`; `convex/hr/roster.ts:328`; `convex/hr/roster.ts:348`; `convex/hr/shared.ts:1067`)
- **Cost mechanism:** Site-size-dependent reads followed by complete failure; below the limit, attendance subscriptions still include employees outside the displayed filter.
- **Fix:** Page authorized employees through tenant/site indexes, apply indexed department criteria where available, and fetch employee/date attendance, assignments, and leave claims for the displayed page. Retain bounded atomic saves, employee/date revisions, historical employment eligibility, and frozen-plan checks. Backfill any new paging/filter fields before switching readers.
- **Expected impact and risk — inferred:** Restores roster access for larger sites and makes grid reads proportional to displayed employees and dates. Risk is omitting transferred or historically employed employees, or weakening recorded-plan locks; raising the constant alone does not resolve this.

### 2. Placement recommendations hydrate and calculate the entire warehouse

- **Location:** `convex/finishedGoods/workflow.ts:1021`, `convex/finishedGoods/workflow.ts:617`. Callers: `src/features/finishedGoods/PalletScreens.tsx:598`; `src/features/finishedGoods/MoveScreen.tsx:177`.
- **Evidence — measured:** `recommend`: 2,886 documents, 1,817.9 KB read, 238.3 KB returned. `recommendMove`: 2,887 documents, 1,818.6 KB read, 238.5 KB returned. (`evidence/iter0-baseline.md:6`; `evidence/iter0-baseline.md:7`)
- **Evidence — inferred:** Every warehouse zone is loaded, then eligible zones hydrate parents, positions, floor blocks, and both held and stored occupancy. The function calculates supports and fits before sorting all candidates. Request-local caches and concurrency limits reduce duplication but do not bound total work. (`convex/finishedGoods/workflow.ts:1034`; `convex/finishedGoods/workflow.ts:1045`; `convex/finishedGoods/workflow.ts:650`; `convex/finishedGoods/workflow.ts:1063`)
- **Cost mechanism:** Reads and geometry work grow with warehouse zones, occupancy, and support surfaces. The subscription depends on all inspected ranges.
- **Fix:** Introduce maintained zone eligibility summaries and indexed candidate retrieval, then calculate exact geometry for candidate pages and the selected preview. Preserve complete candidate reachability, current ordering, condition/unknown-geometry precedence, and truthful exhaustion reasons. Keep fresh transactional collision and stack validation at reservation. Backfill summaries and gate their use on verified readiness.
- **Expected impact and risk — inferred:** Removes much of the warehouse-wide hydration from initial selection. Summary false negatives could hide valid destinations; stale summaries must never authorize placement.

### 3. Saved-scan substring search remains a history scan across many requests

- **Location:** `convex/finishedGoods/jobScans.ts:624`; `convex/lib/boundedRecordPage.ts:214`. Caller: `src/features/finishedGoods/jobScan/JobScanRecords.tsx:131`.
- **Evidence — measured:** Search settles through 22 requests, reading 2,389 documents and 1,541.1 KB, versus 60 documents and 36.9 KB for the unsearched page. (`evidence/iter0-baseline.md:8`; `evidence/iter0-baseline.md:30`)
- **Evidence — inferred:** The indexes select warehouse, mapping state, and creation time; substring matching happens afterward. Each filtered request scans a chunk and re-reads previously accepted IDs. Building-name matching can require parent reads. Scan documents also contain optional `aiRaw`, although the list response omits it. (`convex/schema.ts:1072`; `convex/finishedGoods/jobScans.ts:699`; `convex/lib/boundedRecordPage.ts:215`; `convex/lib/boundedRecordPage.ts:237`; `convex/schema.ts:1054`)
- **Cost mechanism:** Sparse or absent matches require progressively scanning retained history. Continuations repeat authorization and retained-row reads; large source documents increase byte cost.
- **Fix:** Build a tenant/warehouse-scoped substring candidate index, with exact existing normalization and live verification of candidates. Cover all currently searchable fields and building-name changes; retain a correct fallback for unsupported short searches during migration. Move cold extraction payloads into separately authorized detail documents through a compatible backfill.
- **Expected impact and risk — inferred:** Selective searches can approach matching-result cost; splitting cold payloads reduces bytes independently. Ordinary token or prefix search would change behavior. Posting growth, rename propagation, ordering, and pagination require validation.

### 4. Building catalogue rows reconstruct summary metrics from every placement

- **Location:** `convex/storageLayouts/catalogue.ts:338`, `convex/storageLayouts/catalogue.ts:467`. Caller: `src/features/storageLayouts/StorageLayoutScreens.tsx:347`.
- **Evidence — measured:** `buildingOccupancy` reads 917 documents and 819.4 KB to return 1.0 KB. The separate presence-oriented `buildingStatusControl` reads 11 documents. (`evidence/iter0-baseline.md:13`; `evidence/iter0-baseline.md:50`)
- **Evidence — inferred:** Every rendered building row opens its own occupancy subscription. Each query reads all stored and reserved placements, groups by zone, and computes footprint unions. (`src/features/storageLayouts/StorageLayoutScreens.tsx:354`; `convex/storageLayouts/catalogue.ts:342`)
- **Cost mechanism:** A paginated building catalogue still performs occupancy-sized reads for its visible buildings. Placement changes can trigger complete recalculation of a small summary.
- **Fix:** Maintain exact zone occupancy summaries and roll them into building metrics, with tenant/building indexes and a verified backfill. Keep indexed presence checks for structural-write protection. Preserve the union semantics: stacked footprints overlap, and held area is the combined union minus stored area. (`convex/model/storageLayout/areaUsage.ts:6`; `convex/model/storageLayout/areaUsage.ts:25`)
- **Expected impact and risk — inferred:** Catalogue reads become proportional to displayed buildings or their summary rows. Adding rectangle areas would corrupt metrics; summary maintenance must handle overlapping holds, moves, and location-only occupancy.

### 5. Shared generation records create inventory contention and broad invalidation

- **Location:** `convex/lib/finishedGoodsSummary.ts:246`, `convex/lib/finishedGoodsSummary.ts:311`; wrapper: `convex/lib/tenantFunctions.ts:489`. Readers: `convex/finishedGoods/catalogue.ts:371`, `convex/finishedGoods/catalogue.ts:515`; storage readers: `convex/storageLayouts/locationCatalogue.ts:339`.
- **Evidence — inferred:** Successful tracked pallet/product/move/batch writes increment one `finishedGoodsSummaryReadiness` document per warehouse. Storage edits similarly increment one `storageCatalogueSignals` document. Catalogue pages and product summaries read the shared readiness record; product contribution changes also update shared per-product summaries. (`convex/lib/finishedGoodsSummary.ts:253`; `convex/lib/finishedGoodsSummary.ts:313`; `convex/lib/finishedGoodsSummary.ts:331`; `convex/lib/finishedGoodsSummary.ts:46`)
- **Evidence — measured, limited:** Both eight-way job-scan tests report zero retries, but job-scan writes are outside the tracked inventory tables. Fan-out disagrees substantially between identical backends. Also, the “stored pallet” measurement probe targets a state that `saveMeasurement` explicitly refuses, so it cannot validate successful inventory-write fan-out. (`evidence/iter0-baseline.md:85`; `evidence/iter0-baseline.md:87`; `evidence/iter0-baseline.md:104`; `evidence/iter0-baseline.md:106`; `convex/finishedGoods/workflow.ts:521`)
- **Cost mechanism:** Independent writes contend on a warehouse record, while subscriptions reading that document invalidate even when their displayed product or page did not change.
- **Fix:** Separate stable readiness from mutable invalidation state. Use product/range-specific versions where sufficient, and a bounded shard/version scheme where a complete aggregate needs consistency. Preserve sorted-page and continuation guarantees; do not simply remove generation checks. Consider product-summary sharding only after measuring concentrated same-product writes.
- **Expected impact and risk — inferred:** Narrows subscriptions and removes a warehouse-wide write conflict point. This is an unmeasured contention risk, not an observed retry rate. Incorrect version scoping could produce inconsistent totals or skipped/repeated pagination results.

### 6. Active building views subscribe to all inventory; legacy floor views also read warehouse moves

- **Location:** `convex/storageLayouts/catalogue.ts:528`, `convex/storageLayouts/catalogue.ts:184`, `convex/storageLayouts/moveOccupancy.ts:11`. Caller: `src/features/storageLayouts/useStorageBuilding.ts:22`.
- **Evidence — measured:** Building inventory reads 1,829 documents/1,317.4 KB and returns 447.8 KB. Static layout reads only 25 documents. Legacy building and location-map queries read 1,844 and 936 documents respectively. (`evidence/iter0-baseline.md:9`; `evidence/iter0-baseline.md:10`; `evidence/iter0-baseline.md:12`; `evidence/iter0-baseline.md:36`)
- **Evidence — inferred:** The current hook always subscribes to complete building inventory alongside layout. Inventory hydrates every active placement’s pallet/product. Legacy `readFloor` additionally reads warehouse-wide active moves when no move map is supplied. `getStorageLocationMap` intentionally returns a resolved floor as well as the requested zone. (`src/features/storageLayouts/useStorageBuilding.ts:21`; `convex/storageLayouts/catalogue.ts:541`; `convex/storageLayouts/catalogue.ts:100`; `convex/storageLayouts/catalogue.ts:658`)
- **Cost mechanism:** Inventory work grows with building occupancy. Legacy floor/map subscriptions additionally depend on active moves elsewhere in the warehouse. Much of the inventory cost is legitimate hydration of the large returned result.
- **Fix:** Use exact summaries for building-wide overview metrics and load detailed inventory by displayed floor/zone or page. Preserve access to the full inventory through explicit paging. Add appropriately scoped move indexes/fields and backfill legacy rows before narrowing reads. Retain the existing layout/inventory separation.
- **Expected impact and risk — inferred:** Reduces initial hydration and unrelated reactivity where screens display only part of the building. Preserve floor-map context, both move holds, stack geometry, and full-detail behavior for compatibility clients.

### 7. Location-picker fallback scans and hydrates many candidates for a tiny result

- **Location:** `convex/finishedGoods/jobScanLocations.ts:320`, `convex/finishedGoods/jobScanLocations.ts:663`. Caller: `src/features/finishedGoods/jobScan/LocationPicker.tsx:578`.
- **Evidence — measured:** `searchPage` reads 896 documents and 474.3 KB across two requests, returning 0.8 KB. Exact `resolve` reads 15 documents. (`evidence/iter0-baseline.md:14`; `evidence/iter0-baseline.md:42`)
- **Evidence — inferred:** Prefix retrieval is indexed, but contains matching traverses the remaining ranges. Physical candidates may require position/zone resolution before matching; lookahead continues until another match or exhaustion is proven. (`convex/finishedGoods/jobScanLocations.ts:348`; `convex/finishedGoods/jobScanLocations.ts:128`; `convex/finishedGoods/jobScanLocations.ts:719`; `convex/finishedGoods/jobScanLocations.ts:735`)
- **Cost mechanism:** Sparse substring results remain catalogue-sized searches, with additional physical-parent reads.
- **Fix:** Maintain normalized physical display/search fields on a scoped search projection and index substring candidates. Backfill canonical building ownership before relying exclusively on building-filtered ranges; retain the legacy fallback until complete. Revalidate target lifecycle and authorization before returning choices.
- **Expected impact and risk — inferred:** Avoids most parent hydration for rejected candidates and narrows selective searches. Preserve prefix-first ordering, Thai/interior-fragment matching, QR identity handling, and honest exhaustion before offering registration.

### 8. Warehouse catalogue counters still scan every product and summary

- **Location:** `convex/finishedGoods/catalogue.ts:524`. Caller: `src/features/finishedGoods/FinishedGoodsCatalogue.tsx:105`.
- **Evidence — measured:** 272 documents and 136.9 KB across two requests to return 1.6 KB. (`evidence/iter0-baseline.md:16`)
- **Evidence — inferred:** Each chunk reads up to 100 products, then reads each product’s materialized summary and accumulates warehouse totals. The cursor includes warehouse generation. Product-level precomputation therefore does not make these screen counters constant-sized. (`convex/finishedGoods/catalogue.ts:548`; `convex/finishedGoods/catalogue.ts:586`; `convex/finishedGoods/catalogue.ts:610`)
- **Cost mechanism:** Completed counter loading is O(products), with a restart risk when generation changes during continuation.
- **Fix:** Maintain bounded, sharded warehouse totals from existing contribution changes, plus exact unit-label reference counts. Backfill and reconcile against the current product-summary calculation before enabling the new reader.
- **Expected impact and risk — inferred:** Replaces product-sized counter reads with bounded aggregate reads. Preserve product count, inherited formats, unit-label removal, and atomic contribution accounting; a single new warehouse counter would recreate finding 5’s contention.

### 9. Compatibility endpoints retain large complete-range reads and capacity cliffs

- **Location:** `convex/finishedGoods/workflow.ts:1289`, `convex/finishedGoods/workflow.ts:73`; related compatibility endpoint: `convex/storageLayouts/locationCatalogue.ts:459`. Client exposure: `src/lib/convex/finishedGoodsApi.ts:53`.
- **Evidence — measured:** `workflow:list` reads 1,440 documents/914.8 KB and returns 925.4 KB. (`evidence/iter0-baseline.md:11`)
- **Evidence — inferred:** It loads all warehouse products, pallets, and active moves, then sorts and joins them in memory. The shared helper uses `.all(10_000)`, which throws on excess rather than truncating. The current catalogue uses the paged endpoint; no active production `fgRefs.list` invocation was found in the inspected client source. (`convex/finishedGoods/workflow.ts:1296`; `convex/finishedGoods/workflow.ts:1308`; `convex/lib/tenantStorage.ts:379`; `src/features/finishedGoods/FinishedGoodsCatalogue.tsx:90`)
- **Cost mechanism:** Large full responses and eventual capacity failures for clients still using compatibility APIs.
- **Fix:** Migrate remaining integrations to paginated contracts, verify deployed-client usage, and retire complete-list APIs through an explicit compatibility rollout. Do not silently truncate existing responses.
- **Expected impact and risk — inferred:** Removes an expensive retained API and its growth ceiling. Current UI benefit is limited because it already uses paging; premature removal could break older clients.

## Already good (brief)

- **Inferred:** Tenant access validates ownership, enforces indexed access, and fails complete reads rather than silently dropping occupancy. Keep these safeguards. (`convex/lib/tenantDb.ts:89`; `convex/lib/tenantStorage.ts:369`; `convex/lib/tenantStorage.ts:386`)
- **Measured and inferred:** Normal scan listing uses warehouse/mapping indexes and bounded continuation; its baseline is 60 documents. Query-local readers share pending parent reads without introducing cross-user caches. (`evidence/iter0-baseline.md:30`; `convex/finishedGoods/jobScans.ts:625`; `convex/lib/queryDocumentReader.ts:8`)
- **Measured and inferred:** Static building layout is already separated from live inventory. Product summaries are materialized through idempotent contribution reconciliation and resumable backfill. (`evidence/iter0-baseline.md:36`; `convex/storageLayouts/catalogue.ts:524`; `convex/lib/finishedGoodsSummary.ts:78`; `convex/lib/finishedGoodsSummary.ts:201`)
- **Measured:** A 50-item scan save reads 10 documents and writes 53; single-save/correct/delete flows read 10–13 documents. (`evidence/iter0-baseline.md:74`)
- **Inferred; actions unmeasured:** Image-provider work has explicit attempt/total deadlines, response-size limits, and bounded retry policy. Period-close construction advances through bounded employee steps. (`convex/lib/imageProvider.ts:29`; `convex/lib/imageProvider.ts:344`; `convex/hr/periodClose.ts:135`)

## What would raise the score to 9+

- Demonstrate successful roster loading beyond 50 employees using bounded pages, preserving historical eligibility and all write locks.
- Make recommendation selection, occupancy metrics, and warehouse counters depend on selective indexes or verified summaries; keep exact transactional placement validation.
- Demonstrate selective substring search without history-sized reads, while preserving existing normalization, searchable fields, ordering, and completeness.
- Remove warehouse-wide write chokepoints and unnecessary subscription dependencies while retaining cursor consistency and exact aggregates.
- Repeat measurements at increasing fixture sizes. Test successful inventory writes, same-warehouse and same-product contention, unrelated-write invalidation, and continuation during writes. Re-run fan-out under controlled load; exercise activated payslips, successful package resolution, and expensive actions. The existing refusal paths and noisy A/A fan-out do not establish those results. (`audit-brief.md:18`; `audit-brief.md:20`; `convex/finishedGoods/workflow.ts:521`)
