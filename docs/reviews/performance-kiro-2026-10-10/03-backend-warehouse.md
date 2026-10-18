# Backend warehouse/storage/finished-goods performance audit — 2026-10-10

Scope: Convex warehouse, storage-layout and finished-goods reads, reactive
subscriptions, indexes, pagination, geometry/occupancy, summaries, the
authorization hot path, mutation fanout, and the frontend callsites that open
broad or repeated subscriptions. HR is excluded; another reviewer covers it.
Global navigation-permission batching (`convex/lib/navigationGrants.ts`) and
scene-derivation work are already covered by
[the 2026-10-10 plan](../../plans/performance-improvement-2026-10-10.md). They are
referenced here only where this audit adds a new bound or dependency.

## Evidence limits

This was a read-only source review of the current working tree, which includes
pending user changes. I did not run builds, tests, dev servers, seeds or
deployments. **No runtime performance numbers were measured in this audit.**
Counts below such as "≈8 index ranges per zone" are derived from code, not
traces. The only runtime figures cited come from existing artifacts:

- [`docs/plans/convex-database-io-optimization.md`](../../plans/convex-database-io-optimization.md):
  in September, the dashboard showed 4.23 GB of database I/O, 3.45 GB of it from
  `getStorageBuilding`. A cold PD building read was 323,099 bytes / 436 docs,
  and FG1 was 38,458 bytes / 61 docs. These were measured before the layout and
  inventory split.
- [`docs/plans/catalogue-query-optimization.md`](../../plans/catalogue-query-optimization.md):
  read-count reductions from the query-local document reader.

Platform limits used for the capacity cliffs come from
[Convex limits](https://docs.convex.dev/production/state/limits). Each query or
mutation may read at most **4,096 index ranges** (each `db.get` or `db.query`
counts as one), 32,000 scanned documents and 16 MiB. A function may have at most
1,000 concurrent IO operations. Free and Starter deployments (S16) run **16
concurrent queries**. The installed versions are `convex` 1.46.0 and `next`
16.3.8. I read `AGENTS.md` and
`node_modules/next/dist/docs/01-app/02-guides/client-side-data-fetching/index.md`.
Every proposal stays inside Convex functions and the existing client hooks,
which use the guide's inline-loading-state pattern. None changes Next routing,
caching or prefetching.

Existing mitigations, which this report does not repeat as new work:

- Layout and inventory queries are already split (`c2e00d0`).
- Query-local document readers already exist (`convex/lib/queryDocumentReader.ts`).
- Authorization already runs without a wall-clock dependency for cache reuse
  (`tenantFunctions.ts:320–333`).
- Catalogues already use bounded, cursor-based scans.
- `.all(limit)` already fails explicitly instead of truncating
  (`tenantDb.ts:604–623`).
- Product summaries are already materialized.
- The location-option selector is already independent of the page query.
- The reusable read instrumentation is `measuredRead` in
  `tests/integration/storage-occupancy.integration.test.ts:188–246`.

Every fix below keeps inventory live, occupancy exact, both move holds visible
and search semantics unchanged. None truncates results.

## Shared measurement kit

Each "before/after" below refers to these methods:

- **M1 — read-count instrumentation (deterministic, CI-able).** Extend
  `measuredRead` to count `db.get` + `db.query` calls as index ranges, along with
  documents and bytes. Also record the maximum number of outstanding calls,
  which shows serial depth versus concurrency. Assert budgets in integration
  tests.
- **M2 — isolated local Convex.** Use `pnpm dev:seed --storage-ui` /
  `--pagination` plus a PD+FG1 import fixture. Record per-function execution time
  and `usageStats`, with cold and warm runs reported separately, as in the
  September artifact.
- **M3 — reactive fanout in the browser.** Open the screens under test in session
  A. From session B, script 20 pallet writes (measure/reserve/confirm). Count
  WebSocket `QueryUpdated` modifications per query path, and record the time
  from mount to rendered result.
- **M4 — contention.** Run two or three sessions issuing concurrent reserve and
  measurement mutations in one warehouse. Record mutation latency and the
  OCC-retry/conflict counts in the Convex logs.

---

## F1. Destination recommendations make serial, warehouse-wide reads and break at a capacity cliff

**Priority P1 · Effort M · Inferred from code**

**Where:**

- `convex/finishedGoods/workflow.ts:930–1046` (`recommendations`):
  - 943–947 loads every zone of every status via `by_orgId_warehouseId_code`.
  - 953–954 processes zones one at a time:
    `for (const zone of zones) { const context = await locationContext(...) }`.
- `locationContext` (537–757):
  - 542–559: four sequential `get`s, and the first re-reads the zone already
    loaded.
  - 571–583: positions and all of the floor's reserved blocks are re-read for
    every zone.
  - 597–615: held and stored placements.
  - 638–705: one sequential `locations` `get` per position.
  - 708–744: one sequential `palletOf` per stored placement.
  - 973: per support, `validateStack` adds further sequential reads.
- Subscribers: `src/features/finishedGoods/PalletScreens.tsx:567–570` (`recommend`)
  and `MoveScreen.tsx:155–158` (`recommendMove`).

**Journey and why it is slow:** this is the "choose storage" screen after
measurement and the move destination picker. Each execution makes at least 8
serial DB calls per zone, plus positions and stored pallets, across every zone
in the warehouse, including zones in archived or draft buildings.
`locationContext` rejects those zones only after 1–4 reads. The approved PD and
FG1 plans contain 198 + 15 zones (`pdApprovedPlan.test.ts:11`,
`fg1ApprovedPlan.test.ts:8`), so the query costs ≥1,705 index ranges and ≥1,700
serial calls before positions or pallets. Above roughly 2,400 positioned or
stored items, the 4,096-range cap is exceeded. The query then fails as
`INTERNAL_ERROR` (`tenantFunctions.ts:531–538`), and the picker shows no
destinations. The pagination fixture's 363 locations start at ≈2,900 ranges. The
query depends on every placement, pallet, position and location in the
warehouse, so every write by any operator re-executes the whole computation for
every open picker. This reactivity is correct, but each rerun is maximally
expensive.

**Fix (correctness-preserving):**

1. Build a per-query read scope with `createQueryDocumentReader` for buildings,
   floors, locations, pallets and products. Memoize blocks per floor.
2. Enumerate exactly the set that `locationContext` accepts:
   - ACTIVE buildings via `storageBuildings.by_orgId_warehouseId_status_code`;
   - their floors via `by_orgId_buildingId_floorNumber`;
   - ACTIVE zones per floor via `storageZones.by_orgId_floorId_status_code`.

   Keep the per-zone location-ACTIVE check and the floor/building identity
   checks. No new index is needed.

3. Split `locationContext` into `loadZoneContext(scope, zone, building, floor)`
   plus the existing single-zone wrapper. `reserve`, `reserveMove`, `getPallet`
   and `stackOptions` keep their behavior, so preview and commit share one rule
   set.
4. Issue independent reads with `Promise.all`: positions, held and stored
   placements, position-location gets and lower-pallet gets. Process zones with
   bounded concurrency, for example 16, well under the 1,000-IO cap.
5. Keep the candidate sort, `previewCandidates` and the `reasons` set
   byte-identical.

Expected effect: per-zone ranges fall from 8 to ≈4 plus positions and pallets,
and serial depth falls from Σzones×8 to ≈(zones/16)×4.

**Optional, needs a product decision:** apply `conditionCheck` before placement
reads to skip mismatched zones. This saves 3 ranges per mismatched zone. The
only observable change is in the diagnostic `reasons` shown when there are zero
candidates: an unmeasured zone with a mismatched condition would report
`STORAGE_CONDITION_MISMATCH` instead of `LOCATION_GEOMETRY_UNKNOWN`.

**Risks and safeguards:**

- Rules could drift between preview and commit. Use one shared zone-context
  function.
- Concurrency must stay bounded.
- The read set stays the same kind, so reactivity is unchanged.

**Measure:**

- M1: ranges, documents and serial depth for PD+FG1 with 0, 1,000 and 2,500
  stored pallets.
- M2: execution time.
- M3: time from mount to first candidate on the pallet page.

The target is that 2,500 stored pallets succeed and serial depth falls by ≥5×.

**Regression tests:**

- Old/new deep-equal parity for `recommend` and `recommendMove` across SIMPLE,
  RACK and PLATFORM zones, stacked pallets, unmeasured (location-only) zones,
  condition mismatch, archived zones, draft buildings and inactive locations.
- A capacity test with 213 zones and 2,500 stored pallets.
- An M1 range-budget assertion.
- Existing suites: `finished-goods.integration`, `-moves`, `-stacking`.

## F2. One readiness document is written by every warehouse write and read by every catalogue

**Priority P1 · Effort M · Inferred from code**

**Where:**

- Writes: `convex/lib/finishedGoodsSummary.ts:223–298`. `flush` increments
  `finishedGoodsSummaryReadiness.generation` (283–287) for each warehouse touched
  by writes to pallets, products, moves, buildings, floors, zones or positions.
  It runs for every audited mutation (`tenantFunctions.ts:478–481, 529`).
- Readers of the same document:
  - `finishedGoods/catalogue.ts:52, 338, 369, 378, 414, 482, 497, 517`;
  - `batches.ts:472–476, 519–523`;
  - `storageLayouts/catalogue.ts:413–416`;
  - `locationCatalogue.ts:328–330, 398–399`;
  - `finishedGoodsSummary.ts:148–152`, which re-reads it once per product row.
- An in-progress scan is discarded on any generation change
  (`cataloguePagination.ts:117–128`).
- Sorted cursors embed the generation (`catalogue.ts:369`).

**Journey and why it is slow:**

- **Invalidation fanout:** one pallet measurement re-executes every open
  product, pallet and batch catalogue, every `productSummary`, the building
  catalogue page, the location catalogue and the building options for every user
  in the warehouse. This includes lists a pallet write cannot change, such as
  buildings and locations.
- **Scan livelock:** sparse searches and sorted scans that need K round trips
  restart on each bump. With writes arriving faster than K×RTT, they stay in
  "scanning" indefinitely.
- **Sorted paging:** on any write, a page-2+ cursor fails scope decoding, returns
  `reset`, and `useCatalogueSync` (`src/hooks/useCatalogueSync.ts:58–70`)
  silently sends the user back to page 1.
- **Contention:** every FG and storage mutation in a warehouse read-modify-writes
  the same document, so concurrent operators collide under OCC. The pallet and
  position sequences also share one counter document
  (`workflow.ts:98–123`).
- **Per-row cost:** each product row re-reads readiness, adding about 100 extra
  ranges per 100-row page.

**Fix:**

1. Keep `finishedGoodsSummaryReadiness` only for `ready`, `version`, `cursor` and
   `continuationKey`, which change only during backfill. Read it once per query.
2. Move change signals into a new `catalogueChangeSignals` table keyed by
   `(warehouseId, domain)`:
   - `fg`: products, pallets, batches, moves;
   - `storage`: buildings, floors, zones, positions.

   `flush` bumps only the domains that were written, driven by an exhaustive
   table-to-domain map. Storage catalogues read only `storage`. A missing
   document means 0, so no backfill is needed.

3. Use the signal only where frozen state depends on it: sorted (`compare`) scans
   and the summary scan. F3 removes the summary scan. Unsorted `continueCursor`
   pages already survive generation bumps by contract
   (`tests/integration/catalogue-pagination.integration.test.ts:441–468`). Extend
   the same contract to in-progress unsorted `scanCursor`s: saved IDs are
   re-hydrated and re-matched on every request (`cataloguePagination.ts:136–143`),
   so no stale row can be shown.
4. **Product decision:** for sorted pages, either keep strict resets but show
   "list changed, back to first page" instead of a silent jump, or rely on the
   existing anchor revalidation (143–146). The second option accepts the same
   boundary drift that unsorted pages already accept.
5. Then split `finishedGoodsCounters` into per-kind documents, so pallet creation
   and reservations do not conflict.

**Risks and safeguards:**

- A missing domain bump only affects scan restarts, never row freshness, because
  rows remain reactive and re-hydrated. A type-level exhaustive map and a test
  guard against it.
- The FG-domain document is still hot. M4 shows whether that matters; F3's
  totals document can act as the `fg` signal so only one hot document remains.
- Cursors in flight at deploy reset once.

**Measure:**

- M3: the building and location catalogues should drop from 20 updates to 0
  during a 20-pallet-write burst.
- A sparse product search should complete under one write every 5 s. Expect
  never before, a single pass after.
- M4: conflicts and retries before versus after.

**Regression tests:**

- An unsorted scan in progress survives an `fg` bump.
- The storage page's M1 table list excludes `fg` signals.
- `productSummary` is unaffected by a bump.
- Sorted behavior matches the chosen decision.
- The table-to-domain map covers every tracked table.
- Existing `finished-goods-summary`, `catalogue-pagination` and
  `storage-location-catalogue` suites.

## F3. Warehouse totals rescan every product after each write

**Priority P1 · Effort M (+ bounded backfill) · Inferred from code**

**Where:**

- `convex/finishedGoods/catalogue.ts:490–614` (`summary`): the scope includes
  the generation (514–518); each page reads 100 products; per-product
  `readSummary` calls run serially (576–589), each re-reading readiness and the
  summary.
- Client: `src/features/finishedGoods/FinishedGoodsCatalogue.tsx:106–130` drives
  the continuation and allows one reset retry per `viewKey`. Line 146 derives
  the unit filter options from it.

**Journey and why it is slow:** the catalogue header totals and the unit filter.
The final `ready` subscription carries frozen totals in a signed cursor. After
any warehouse write it returns `reset`, and the client re-runs ⌈P/100⌉
sequential requests of ≥200 serial ranges each. For 2,000 products that is 20
round trips per write per open tab. If a second reset arrives mid-rescan,
`summaryResetAttempt` blocks the retry, and the totals and unit filters stay
unavailable until the user navigates away.

**Fix:** maintain an exact `finishedGoodsWarehouseSummaries` document per
warehouse in the same transaction:

- `adjust()` (`finishedGoodsSummary.ts:46–77`) applies its product delta to the
  warehouse totals (stored, awaitingMeasurement, awaitingStorage, moving).
- `saveProduct` maintains the product count and a `unitCounts` map on create
  and on unit change.
- Extend the existing resumable `backfillProductSummaries` (177–220) and expose
  readiness only when both projections are built. The README rule still holds: a
  missing projection shows as unavailable, never as zero.
- `summary` becomes one document read: exact, reactive, with no scan and no
  reset.

**Risks and safeguards:**

- A write path that bypasses `adjust` or `saveProduct` would cause drift. Add a
  property test in `tests/properties` that compares the materialized totals
  with a full recomputation over randomized operation sequences.
- No new contention: it is written by the same transactions that bump the
  generation today.

**Measure:**

- Per write: before, ⌈P/100⌉ requests and ≈200 ranges each; after, 1 request
  and ≈10 ranges (auth + 1).
- M3: time from a write to updated header totals.

**Regression tests:**

- Parity with the current scan on the 121-product pagination fixture.
- Unit rename and archive.
- Concurrent writes.
- Backfill resume.
- `not_ready` gating.
- Forged-cursor tests become obsolete.

## F4. Location catalogue search costs two client round trips per location, and the building filter scans the whole warehouse

**Priority P1 · Effort S–M · Inferred from code**

**Where:**

- `convex/storageLayouts/locationCatalogue.ts:172–305` (`searchLocationChunk`):
  - 203–212 pages zones with `limit: 1`;
  - 232–239 returns an empty chunk, so a second request is needed to inspect the
    zone ("Convex permits only one native pagination call per query").
- `page` (308–369): `buildingId` and `floorNumber` apply only in `matches`
  (361–366) over `by_orgId_warehouseId_code` (345–358).
- Each non-final chunk returns `scanning`, and the client re-subscribes
  (`useCatalogueSync`).

**Journey and why it is slow:** location catalogue search and the
building/floor filter. A no-match or late-match search over PD+FG1 (213 zones)
takes ≈426 sequential query round trips, each paying the auth chain (F6). F2
can restart it mid-way. A building filter with no search reads every warehouse
zone, 20 per request.

**Fix:**

1. Read one native page of up to `min(20, remaining capacity)` zones per
   request. Then, for each zone, run the heading check with the shared
   building/floor readers. Read positions with non-native bounded reads, which
   the adapter serves with `take`, not `paginate`
   (`tenantStorage.ts:254–257`):
   - ACTIVE positions with `.all(100)`, bounded by
     `maximumPositionsPerArea` (`storagePosition.ts:21–22`);
   - INACTIVE positions with `take(100)`, falling back to the existing per-zone
     native continuation only if all 100 come back.

   Concatenate ACTIVE then INACTIVE text by code, which is the existing index
   order, so boundary-spanning substring matches stay identical.

2. Add `storageZones.by_orgId_buildingId_code` and use it when `buildingId` is
   set. The code order matches the current within-building order. The floor and
   status filters stay residual.

**Risks and safeguards:**

- The one-native-paginate rule holds, because only the zone page is native.
- The index adds write cost to zones, which are written rarely.
- Ordering parity is tested.

**Measure:**

- Requests and settle time for a no-match, a last-zone match, a Thai label and a
  building filter on PD.
- The target is ≥20× fewer requests.

**Regression tests:**

- Additions to `storage-location-catalogue.integration`:
  - parity of matched IDs and order for heading matches, position matches,
    cross-position substrings and more than 100 historical positions;
  - building+floor filters;
  - a request-count assertion.

## F5. Stack options load every warehouse pallet and recompute on each rotation or selection change

**Priority P2 · Effort M · Inferred from code**

**Where:**

- `convex/finishedGoods/workflow.ts:2342–2451`:
  - 2370–2383 reads every pallet with `rows(...).all(10_000)`;
  - 2384–2387 calls `isStackingPallet`, which uses the unmemoized `productOf`
    (2215–2228);
  - 2447 returns full pallet documents.
- Client: `src/features/finishedGoods/StackScreen.tsx:147–154` puts `rotation`
  and `upperPalletId` in the arguments.

**Journey and why it is slow:** the stack screen. Every rotation toggle or
upper-pallet choice opens a new subscription that re-reads all warehouse
pallets, including retired and history pallets, and makes a product `get` for
each legacy pallet. Any pallet write reruns it. The query hard-fails at more
than 10,000 pallets (`CAPACITY_DATA_LIMIT`), so the screen breaks as history
accumulates.

**Fix:**

- Split the query into two:
  - `stackCandidates({warehouseId, palletId})` returns compact rows with only the
    fields StackScreen renders and uses a memoized product reader. It reads only
    AWAITING_PLACEMENT, STORED and RESERVED pallets through a new index,
    `finishedGoodsPallets.by_orgId_warehouseId_status_code` (3 ranges). The
    existing filters stay: not retired, measured, not the lower pallet,
    stacking-capable.
  - `stackPreview({..., upperPalletId?, rotation})` holds the existing
    lower/upper/context logic and reuses F1's zone context.
- The candidate list stays complete and live, and toggles only rerun the
  preview.

**Risks and safeguards:**

- Candidate-set parity.
- Convex builds the index at deploy, so no data migration is needed.

**Measure:**

- M1 documents and bytes per toggle, before versus after.
- Time from toggle to preview at 500 and 5,000 pallets.

**Regression tests:**

- `finished-goods-stacking.integration` parity for the candidate set and preview
  errors (STACK_* codes, `MOVE_UNCHANGED`).
- A toggle performs no pallet-table scan (M1).
- More than 10,000 historical pallets do not fail.

## F6. Every query and mutation pays a serial, partly duplicated tenant and authorization chain

**Priority P2 · Effort M (security review) · Inferred from code**

**Where:**

- `convex/lib/tenantFunctions.ts:445–540`.
- `tenantContext.ts:276–360`: user → organization → membership → warehouse →
  scope, each awaited in turn.
- `tenantContextLookups.ts:66–108`: two membership buckets, plus a REVOKED
  fallback.
- `authorization.ts:255–345`:
  - 273 re-reads the membership;
  - 286 reads roles;
  - 296–322 makes a role `get` and a `rolePermission` read per role, in turn;
  - 329 re-reads the scope.

**Journey and why it is slow:** every subscription and every rerun. The cost is
≈9–11 ranges in ≈7–8 serial hops, plus 2 hops per extra role tried. The
building catalogue opens 1 + 2×rows queries (F7), so 100 rows mean ≈201 chain
executions competing for 16 concurrent query slots on S16.

**Fix:** use the same transaction snapshot so the verdict is identical:

1. Resolve the user and organization concurrently.
2. Pass the context's membership and scope documents into
   `resolveAuthorizationFacts`, keeping the identity and organization equality
   checks, instead of re-querying them.
3. Fetch the role documents and their permission rows together with
   `Promise.all` (≤32, `MEMBERSHIP_ROLE_LIMIT`), then evaluate them in grant
   order with the current deny precedence.

Expected effect: ≈9 → 6 ranges and ≈7 → 3–4 serial hops.

**Also check first:** a query's `requestId` is `crypto.randomUUID()` (455), so
reruns never return byte-identical values. The client marks a query changed on
every `QueryUpdated`, by identity
(`node_modules/convex/dist/esm/browser/sync/optimistic_updates_impl.js:101–107`).
Whether the backend suppresses identical results was not verified. Patch a field
the query reads without changing its output and count M3 frames. If updates
arrive that differ only by `requestId`, derive a deterministic ok-path ID while
keeping random IDs for denials and UUIDv7 for audited writes. Update the
v4-format assertion in `query-cache.integration.test.ts:32–42` if the format
changes.

**Risks and safeguards:**

- This is security-critical: keep every integrity check unchanged.
- Parallel role reads add non-granting roles' permission rows to the read set.
  That adds rare extra invalidations on role edits, with no behavior change.

**Measure:**

- M1 ranges and depth per call.
- M2 p50 execution time for `buildingOccupancy`.

**Regression tests:**

- Existing suites: `authorization-enforcement`, `tenant-context-resolution`,
  `query-cache`, `tenant-functions`, `tests/isolation`.
- New cases: a re-added membership, a malformed role row in a later grant,
  multi-role grant order, and warehouse-scoped denial.

## F7. Building catalogue rows open two subscriptions each and scan every held or stored placement

**Priority P2 · Effort S (merge) / L (projection) · Inferred from code**

**Where:**

- `src/features/storageLayouts/StorageLayoutScreens.tsx:243–260, 287–296`.
- `BuildingStatusToggle.tsx:57–60`.
- `convex/storageLayouts/catalogue.ts`:
  - 327–365 (`buildingWithOccupancy`) reads every RESERVED and STORED placement
    document, up to 10k each;
  - 454–469 (`buildingOccupancy`);
  - 650–670 (`buildingStatusControl` → `hasOccupiedStorage`, 32–52), which reads
    the same index ranges with `first()`.

**Journey and why it is slow:** pages of 20, 50 or 100 buildings open up to 200
extra queries, each with the F6 chain. On S16, row cells fill progressively.

**Fix:**

- **S — merge:** make one row query that returns occupancy plus
  `{status, version, blocked}`. Compute `blocked` from the same rows: the
  building is ACTIVE and has any RESERVED or STORED row, which matches
  `hasOccupiedStorage`. The permission stays `masterData.storageLayout.read`.
  The mutation keeps its transactional check (`writes.ts:305, 635`).
- **L — only if M1/M2 show the placement scan matters:** maintain an exact
  per-zone occupancy projection. Recompute the zone union from that zone's
  placements inside the F8 flush whenever placements are written. The building
  query would then read zone rows instead of placements. Never use incremental
  area approximations.

**Risks and safeguards:**

- The toggle's disabled and blocked states.
- `blocked` is derived only from data the reader can already see.
- The projection carries drift risk, so it needs a parity property test.

**Measure:**

- Subscriptions per page.
- Time until all 100 rows render (M3).
- Documents per row (M1).

**Regression tests:**

- `StorageLayoutScreens.test.tsx` loading and error states and the blocked
  toggle.
- `storage-occupancy` footprint parity (stacked, held, unmeasured).

## F8. The mutation summary flush reconciles pallets one at a time and makes redundant tracked reads

**Priority P2 · Effort S–M · Inferred from code**

**Where:**

- `convex/lib/finishedGoodsSummary.ts`:
  - 79–134 (`reconcileUnitContribution`): ledger + pallet, the move check, then
    `adjust` ×2, each reading and patching the product summary;
  - 263–267: `note()` makes a `get` before and after every patch;
  - 281: the flush loop runs serially.
- Writers: `batches.ts:296–325` and `batchManagement.ts:185–200` (up to
  `MAX_FG_PACKAGES` = 50 inserts, plus the replaced units).

**Journey and why it is slow:** "Create/Save batch" and repacking. Replacing 50
units touches about 100 pallets. That means about 100 sequential reconcile
chains of 4–6 calls each, about 200 extra tracked gets, and up to 200
read/patch cycles on the same product summary document in one transaction.

**Fix:**

- In `flush`:
  - load the ledger rows, pallets and IN_TRANSIT checks for all touched pallets
    concurrently;
  - compute the next contributions;
  - aggregate the deltas per product, plus the warehouse totals once F3 exists;
  - apply all removals first and run the existing non-negative check, then
    apply the additions;
  - patch each summary once and write the contribution rows.
- Drop the post-write `note()` for tracked tables, whose `warehouseId` and
  `palletId` never change.

**Risks and safeguards:** final summaries must be identical and the ledger must
stay idempotent. Applying removals before additions keeps the existing drift
detection.

**Measure:**

- M2 `commitBatch` execution time and M1 ranges for a 50-unit replacement.
- The target is ≥5× fewer serial calls.

**Regression tests:**

- `finished-goods-summary`, `-batches` and `-batch-management` integration
  suites.
- A property test comparing the summary with a full recomputation.
- A deliberately corrupted ledger still throws.

## F9. Job-scan record search reads the whole history on every settled search

**Priority P2 · Effort M (+ backfill) · Inferred from code**

**Where:**

- `convex/finishedGoods/jobScans.ts:582–670`: the search path (621–640) calls
  `reader.all(10_000)` on full documents, including `aiRaw`, then pages by
  offset.
- Client: `src/features/finishedGoods/jobScan/JobScanRecords.tsx:80–86`.
- Writers: 478–580.

**Journey and why it is slow:** job-scan record search and paging. Every settled
search, and every page, re-reads up to 10k full documents. Once a warehouse
passes 10,000 scans, the read throws `CAPACITY_DATA_LIMIT` and search stops
working entirely. Large `aiRaw` payloads approach the 16 MiB limit earlier.

**Fix:**

- Maintain a compact projection, `finishedGoodsJobScanSearch`, in the same
  transaction as save, assign and delete. Each row holds `warehouseId`,
  `scanId`, `mapped`, `createdAt` and the five uppercased search fields stored
  separately, which keeps today's per-field `includes` semantics.
- Scan it newest-first in bounded chunks with a continuation cursor, the
  existing catalogue pattern, and stop once a page is filled. Hydrate only the
  roughly 20 result documents.
- Backfill the projection with a resumable job.

**Risks and safeguards:**

- Projection drift: write the projection in the same mutation and test parity.
- Rows that are incomplete during backfill must show as unavailable, never as
  "no results".

**Measure:**

- M1 bytes and documents per search at 1k, 10k and 20k scans.
- Time to the first page for a common term and for a sparse term.

**Regression tests:**

- `finished-goods-job-scans.integration`:
  - ALL, MAPPED and UNMAPPED parity;
  - ordering;
  - assign and delete update the projection;
  - more than 10,000 rows still succeed.

## F10. Building inventory move lookups cost two index ranges per pallet

**Priority P2 (P1 if a building approaches ~1,000 pallets) · Effort M · Inferred from code**

**Where:**

- `convex/storageLayouts/catalogue.ts:515–568`: lines 544–548 pass every
  distinct `palletId`.
- `moveOccupancy.ts:11–48`: two status queries per pallet.

**Why it matters:** ranges ≈ auth (≈9) + 3 + 2N moves + N pallets + products.
That stays under 4,096 only while N is about 1,360 distinct pallets per building
or fewer. Past that, the building scene and space-details dialog fail. This
adds a code-derived capacity risk to the plan’s scene-subscription work.
That work already rejects a universal warehouse-wide scan. The approximate
threshold needs transaction metrics on representative fixtures; it is not a
measured production failure boundary.

**Fix (exact, building-scoped):**

- Denormalize `sourceBuildingId` and `targetBuildingId` onto new moves in
  `reserveMove` (`workflow.ts:1756–1917`). Both values are already known there.
- Index the moves by `(sourceBuildingId, status)` and `(targetBuildingId,
status)`.
- Read the active moves of one building in 4 ranges.
- Backfill only the RESERVED and IN_TRANSIT moves, a small bounded set.
- **Interim:** keep the per-pallet lookup for buildings with up to T pallets.
  Above T, use the 2-range warehouse active-move read. The result map is keyed
  by placement ID, so both paths are exact.

**Risks and safeguards:**

- Cross-building moves must show holds in both buildings.
- Do not add the move onto the source placement: that would break the
  `sourceUpdatedAt` concurrency token (1906).

**Measure:** M1 ranges at 100, 1,000 and 2,000 pallets per building.

**Regression tests:**

- `storage-occupancy` parity, including the existing source/target hold test
  (327+) extended across buildings.
- A 2,000-pallet capacity test.

## F11. Legacy unbounded endpoints remain public

**Priority P3 · Effort S · Inferred from code + September artifact**

**Where:**

- `convex/storageLayouts/catalogue.ts`:
  - 367–395 `listStorageBuildings`: up to 100 buildings × all placements;
  - 511 `getStorageBuilding`;
  - 570–600 `getStorageFloor`;
  - 602–648 `getStorageLocationMap`: the whole floor plus warehouse moves, to
    show one location.
- `finishedGoods/workflow.ts:1176–1231` `list`: all products and all pallets.
- `locationCatalogue.ts:433–452` `list`.
- `src` contains no callsites, only reference and type definitions at
  `src/lib/convex/storageLayoutApi.ts:179–185` and `finishedGoodsApi.ts:62`.

**Why it matters:** `getStorageBuilding` alone was 3.45 GB of September's
4.23 GB (artifact above). Stale tabs or integrations can still trigger these
reads and hit capacity failures.

**Fix:**

- Check per-function call counts in the Convex dashboard over at least 14 days.
- Once the compatibility and frontend-rollback window has passed, remove these
  endpoints, or make them thin wrappers over the bounded queries.
- Update `tests/fixtures/public-function-contract.json`.

**Risk:** `vercel rollback` can restore an older frontend (see the README's
recovery section). Keep the endpoints until no rollback target still uses them.

---

## Ranked top 3

1. **F1 — destination recommendations.** This is the heaviest reactive query on
   the most frequent operator journey, and it has a hard failure cliff within
   plausible growth.
2. **F2 + F3 — the readiness hot document and materialized totals.** They remove
   cross-domain invalidation, scan livelock, silent sorted-page resets and the
   per-write totals rescan, and they make contention measurable.
3. **F4 — location search and the building filter.** About 426 → about 11 round
   trips for PD-size searches, with no semantic change.

## Dependencies and ordering

- Instrument M1 first, then add range budgets to each patch's tests.
- F1's zone-context refactor comes before F5, because `stackPreview` reuses it.
- F2 comes before F3, because F3's totals document can serve as the `fg` signal.
  The counter split (F2.5) helps only after F2.
- F6 is independent. Land it before measuring F7, so the per-row cost is not
  double-counted.
- F8's batched flush is the hook F7's optional projection would use.
- Coordinate F10 with the plan’s scene-subscription and active-move work.
- The new indexes (F4, F5, F10) and tables (F2, F3, F9) ship through the
  existing release pipeline and runbook. Convex builds the indexes at deploy.
  The F3, F9 and F10 backfills reuse the resumable-readiness pattern, and each
  shows "unavailable" until it is ready.

## Recommendations to reject because they trade away UX or correctness

- Caching, snapshotting, polling or debouncing recommendations, occupancy,
  inventory or totals instead of using reactive subscriptions. That produces
  stale inventory.
- Returning only the first N destination candidates or catalogue matches, or
  lowering zone, position or placement limits to fit query caps. That is
  truncation.
- Estimating footprint union with bounding boxes or summed areas, or dropping
  the source or target move hold.
- Showing partial-scan or "≈" totals, or zeros while projections build.
- Replacing substring search with a token or prefix search index without proven
  parity, especially for Thai text.
- Caching authorization facts across requests, or skipping per-request checks.
  Revocation must stay prompt.
- A universal warehouse-wide move scan for small buildings, or denormalizing
  move state onto source placements. The latter breaks the `sourceUpdatedAt`
  conflict checks.
- Persistent browser caches for inventory or permissions.
