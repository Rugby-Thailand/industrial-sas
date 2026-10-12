# Location search, filters and pagination — independent review

Kiro, 2026-10-12. Baseline: `733c6aca` plus the uncommitted worktree in
`baseline-status.txt`. This review only reads code and runs tests. It changes no
application code or existing tests. A temporary measurement test was run and
then deleted (see the appendix). No browser, deployment or external data
mutation was used.

## Summary

- The job-scan picker ("1. Where are you?", `/finished-goods/scan`) does not
  have a slow query. It has a slow loop. Each request reads at most 20 ledger
  rows, and the client re-subscribes for the next step until 20 matches are
  found or the ledger runs out. A sparse search, a no-match search, or a blank
  browse where most rows are ineligible needs ⌈rows/20⌉ sequential round trips.
  Measured: 50 requests for 1,000 locations.
- The storage-layout "All locations" text search is the worst path: 2 requests
  per zone. Measured: 2,000 sequential requests for 1,000 zones (200 for 100).
- The "blank browse, no locations" report fits two verified causes. (a) The
  picker renders nothing while a step is loading (`useQuery` → `undefined`) or
  after `reset`. (b) The picker excludes every location in a non-ACTIVE
  building, then shows "No matching location." Measured: 0 rows after 50
  requests when the only building is DRAFT.
- Each request is bounded on the server (≤ ~160 index ranges, against Convex's
  limit of 4,096). Searches as a whole are not bounded: the client advances scan
  steps without a cap. So "bounded per request" does not mean "fast per search".
- Building, floor and status filters are applied after hydration, never through
  an index. A building filter therefore does not reduce reads. An empty building
  took 50 requests with 1,000 zones. An icon-only building filter only helps
  performance if an index backs it.

## Measurements (actual, in-process `convex-test`)

Fixture: one ACTIVE building with N zones, each with a `FLOOR_BLOCK` ledger row.
The last zone is labelled `NEEDLE ZONE`. There is a second, empty building.
Page size is 20. I drove each search like `useCatalogueSync`, following
`scanCursor` until the status was not `scanning`. Counts come from a proxy on
`ctx.db.get` and `ctx.db.query`, so they include tenant/auth overhead of about
2 gets and 10 queries per request.

| Journey (N = 1,000)                 |  Requests |  Rows | `db.get` total | `db.query` total | Max ranges/request |
| ----------------------------------- | --------: | ----: | -------------: | ---------------: | -----------------: |
| Picker blank browse, first page     |         1 |    20 |            102 |               51 |                153 |
| Picker sparse `NEEDLE`              |        50 |     1 |          5,100 |            2,850 |                159 |
| Picker no match                     |        50 |     0 |          5,100 |            2,850 |                159 |
| Picker blank browse, building DRAFT |        50 | **0** |          5,100 |            2,550 |                153 |
| Catalogue blank, first page         |         1 |    20 |              4 |               12 |                 16 |
| Catalogue sparse `needle`           | **2,000** |     1 |          7,000 |           23,999 |                 17 |
| Catalogue, empty building filter    |        50 |     0 |            200 |              600 |                 16 |

At N = 100, each row of the table had one tenth of the requests (5, 5, 5, 200
and 5 respectively), so cost scales linearly with N. Derived per-row cost of
picker hydration: 5 gets and 2 queries. The sparse picker adds 6 queries per
request because it repeats the exact lookup.

Limits of these numbers: they are deterministic counts, not latency. The
in-process harness took 1.7 s (picker) and 8.6 s (catalogue) for N = 1,000. That
excludes the network, the Convex scheduler and React. Real latency is an
estimate only: at an unmeasured 100–300 ms per reactive step, the picker would
take about 5–15 s and catalogue search about 3–10 min for 1,000 zones. Even the
documented 34-location demo would need 68 sequential steps for catalogue search.
Real cardinalities (ledger rows, zones, positions per warehouse) are unknown;
Phase 0 measures them.

Existing suites pass on this worktree: `LocationPicker`, `useCatalogueSync`,
`useCursorPagination`, `useScanContinuation`, and the `catalogue-pagination`,
`storage-location-catalogue` and `finished-goods-job-scans` integration tests.
That is 7 files and 74 tests.

## Root-cause candidates

R1. The picker's scan step is tied to the remaining page capacity.
`convex/finishedGoods/jobScanLocations.ts:300` sets
`limit: Math.min(20, remainingScanCapacity(...))`. `cataloguePagination.ts:212–218`
explains why: the native cursor cannot resume mid-page, so a step never reads
more rows than it can return. The tenant adapter allows up to 100 rows per
native page (`tenantStorage.ts:265`, `maximumRowsRead: 101`), and the function
budget allows far more. The step size, not the database, drives the request
count.

R2. Picker hydration fan-out. `searchPage` scans every ACTIVE ledger row
(`jobScanLocations.ts:282`). The ledger covers zones, positions, named entries
and dock/staging rows. `hydrate` calls `reader.byId` (`:305–309`), which:

- re-reads the row it already has (`:121`);
- queries the position, then the zone, by `locationId`;
- calls `targetContext` (`scanning.ts:139`), which reads building, floor,
  `zoneLocation` and `location` again without the per-query cache.

For a zone-backed row, 3 of those 5 gets read the same location document. The
building and floor reads repeat for every row.

R3. The picker repeats the exact lookup on every step. `searchPage` calls
`lookupJobLocation` before each step (`:505–506`, 6 index reads). It does this
even though the client already has a separate `resolve` subscription
(`LocationPicker.tsx:96–100`).

R4. Catalogue text search advances one zone per two requests.
`locationCatalogue.ts:203–238` reads one zone (`limit: 1`). The next request
inspects it (`:259`) and up to 50 positions (`:270`). The code comment at `:232`
explains the cause: only one native paginate is allowed per query.

R5. Filters are not index-backed. `locationCatalogue.ts:361–366` and
`jobScanLocations.ts:475–487` filter by building, floor and status after
hydration. `storageZones` already has `by_orgId_floorId_status_code`; no list
uses it for filters.

R6. Client mechanics. Each step changes `useQuery` arguments. Convex 1.46
returns `undefined` until the new result arrives (no keep-previous;
`node_modules/convex/dist/esm/react/client.js:450–467`). Each settled keystroke
(250 ms debounce) restarts the scan from the beginning. Each step is a billed
function call and a reactive subscription.

Related read amplification outside the reported path:

- Job-record search reads up to 10,000 records per request, including AI
  payloads, and pages by offset (`jobScans.ts:404–420`). It fails with
  `CAPACITY_DATA_LIMIT` rather than truncating, but 16 MiB may be reached
  first. That last point is an estimate.
- The legacy public `jobScans.searchLocations` (`:106–146`) reads all zones up to
  10,000 and uses offset paging. No UI uses it (grep). Deprecate it through the
  public-contract process.
- The add-location `options` query (`jobScanLocations.ts:324–360`) reads all
  buildings and all of their floors. Its cardinality is small, but it is bounded
  only at 10,000 per read.

## False or misleading "no results" risks

F1. Ineligible-only results look like "no match" (measured). The picker drops
locations in non-ACTIVE buildings and inactive zones (`jobScanLocations.ts:78–96`,
`scanning.ts:138–162`). `LocationPicker.tsx:301` then shows "No matching
location." even for a blank browse. The backend should return a reason (for
example "N locations excluded: building not active"), and the UI should show
it.

F2. Blank states. The picker has no branch for `outcome === undefined` or
`status: "reset"`. It only renders `ready`, `scanning` (`:352`, and only when
`!canCreate`) and `!ok` (`:357`). On first load and between scan steps, the
list area is empty. `StorageLocationCatalogue.tsx:281` handles this correctly.

F3. Semantic mismatch. Picker text matches only code and name (`:510–514`). The
catalogue also matches building name, building code and positions
(`locationCatalogue.ts:260–295`). Typing a building name in the picker returns
"No matching location."

F4. Scan restart. A change in summary generation discards an in-progress
catalogue scan (`cataloguePagination.ts:117`). This is low risk because it
restarts the scan rather than returning a false empty result.

Verified as not a risk: `paginatedScan` never slices a page while keeping a
cursor beyond it. Capacity overruns throw `CATALOGUE_READ_CAPACITY_EXCEEDED`
rather than truncating. `useCatalogueSync` steps back from an empty final page.

## Client limits and backend bounding

| Kind                  | Where                                      | Bound                                                                               |
| --------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------- |
| Client page size      | `useCursorPagination.ts`                   | 20/50/100; 500-cursor history; 24 scopes in `history.state`                         |
| Client debounce/text  | `useDebouncedSearch`, `LocationPicker.tsx` | 250 ms; 200 chars (UI only)                                                         |
| Client scan steps     | `useCatalogueSync`                         | **Unbounded**: advances while `scanning`                                            |
| Backend per step      | `paginatedScan` + `.page()`                | Native page ≤ 101 rows/512 KiB; picker ≤ 20; catalogue search 1 zone + 50 positions |
| Backend cursor state  | `cataloguePagination.ts:29`                | 32,768 chars; ids ≤ page size; 16 pending ranges                                    |
| Platform per function | Convex limits                              | 4,096 index ranges, 32,000 documents, 16 MiB, 1 s user code                         |
| Total per search      | —                                          | **None** (O(N) requests)                                                            |

## Cursor pagination options

| Option                                                                                        | Fit                                                                       | Cost/limits                                                                                                                                                    | Verdict                                                                                                                                                       |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native `.paginate` cursor + scan continuation (current)                                       | Reactive, opaque, actor-scoped, handles live page growth with `endCursor` | One per query; cannot stop mid-page, so step ≤ remaining capacity; sparse filters become O(N/20) round trips                                                   | Keep the contract. Raise rows per step by carrying surplus matched IDs into the next cursor (state already has `ids`; relax `ids.length ≤ pageSize` to ≤ 100) |
| Keyset/seek on index fields (`code`, `_creationTime`, `_id`), e.g. `convex-helpers` `getPage` | Many bounded range reads per query; stop at any row; works for joins      | Needs a tenantDb range API (security-sensitive adapter) or a new dependency; tiebreak required; cursor exposes key values (same tenant only)                   | Best primitive for multi-range batching and building filters across floors. Adopt only with tenant-adapter review                                             |
| Offset (job-record search, legacy `searchLocations`)                                          | Simple page numbers and totals                                            | O(N) reads per request; 10,000 cap; unstable under writes                                                                                                      | Retire for large lists                                                                                                                                        |
| `usePaginatedQuery`                                                                           | Infinite "load more", built in                                            | Accumulates live subscriptions; no previous/next or page-size history; same sparse-filter problem                                                              | Not a fix for sparse filters                                                                                                                                  |
| Convex text search index                                                                      | O(results) reads                                                          | Token and last-term prefix only; no substring; SimpleTokenizer is weak for Thai (no spaces); scans ≤ 1,024 results; relevance order only; billed on index size | Optional fast path for code tokens, with substring fallback. Not a replacement                                                                                |
| Search projection table (one compact row per selectable destination)                          | Index-backed building/floor/eligibility; no hydration until selected      | Schema change, transactional maintenance, backfill with readiness flag                                                                                         | The structural fix if Phase 2 is not enough on real counts                                                                                                    |
| Trigram postings table                                                                        | Index-bounded substring search, Thai-safe                                 | Write fan-out of about (text length − 2) rows per destination                                                                                                  | Evaluate only if sparse substring search must be O(page)                                                                                                      |

## Pagination coverage

Already on the shared cursor stack (`useCursorPagination`, `CursorPagination`,
`useCatalogueSync`):

- finished-goods catalogue;
- product batches and legacy units;
- job-scan records;
- the storage building catalogue;
- the "All locations" table;
- registered (named) locations;
- the picker.

Not paginated: the HR employees, review queue, history, holidays and periods
screens have no cursor UI (grep). Their backend caps rows with explicit
`complete` flags, for example `MAX_SITE_EMPLOYEES = 99` per site and holidays 99. The HR area is in active uncommitted work, so schedule HR lists after it
lands. Floor zone panels use scene data (README: scene reads stay independent
of list pagination).

Next.js 16.3.8 docs: `cacheComponents` is not enabled, so Activity-based state
preservation (`02-guides/preserving-ui-state.md`) does not apply. The existing
`history.state` cursor restore stays the right mechanism. If filters move to the
URL:

- wrap readers of `useSearchParams` in `Suspense` (`use-search-params.md:82–86,
180–181`);
- use the pending-feedback pattern from `interactive-apps.md:178–290`;
- keep cursors out of URLs, because they are actor-scoped and up to 32 KB.

## Recommended phases

Phase 0 — Baseline (no behaviour change)

- Commit the appendix harness as a read-budget integration test with
  N ∈ {100, 1,000}. It records requests per search, ranges per request and rows,
  for each journey above.
- Obtain real counts per warehouse with operator-approved, read-only access:
  ACTIVE ledger rows by type, zones, positions and buildings by status.
- Run a local browser timing on `pnpm dev:seed --pagination` and the UI-B
  profile. Measure settled keystroke to `ready`, with ≥ 20 runs each, and report
  p50 and p95.
- Accept when baselines are recorded in the review. These are actual numbers,
  not estimates.

Phase 1 — Correct states (UI plus a small backend field)

- Picker: show the busy status for `undefined`, `scanning` and `reset`. Show
  progress from `scanned`. Keep the last ready rows, with `aria-busy`, during
  continuation within the same criteria and actor.
- Backend returns an exclusion reason or count, and the UI distinguishes "no
  match" from "no eligible locations (building not active)".
- Decide whether picker text should match building name and code, to match the
  catalogue.
- Tests: unit tests for undefined, scanning, reset, DRAFT-only and blank browse
  with rows (current picker tests always mock `ready`). Add an integration test
  that DRAFT-only returns the reason.

Phase 2 — Fewer round trips, no schema change

- Picker: about 100 rows per step, with surplus matches carried in the cursor.
  Reuse the page row. Cache building and floor, and skip `zoneLocation` and
  `location` re-reads in list hydration. Run the exact lookup only on the first
  step, or drop it in favour of the client's `resolve` call.
- Catalogue search: hydrate a batch of 20–50 zones per step. Use non-native
  `take(51)` position reads, and keep the per-zone continuation only for zones
  with more positions.
- Filters: a floor filter, or building → floors, reads
  `by_orgId_floorId_status_code` and iterates floors in the cursor state.
- Accept at N = 1,000:
  - picker sparse/no-match ≤ 11 requests (from 50), ≤ 1.5 gets per row;
  - catalogue sparse ≤ 60 requests (from 2,000);
  - empty-building filter ≤ 2 requests (from 50);
  - each request ≤ 1,000 index ranges.
- Accept on parity: identical result sets and order against the current
  implementation for blank, code prefix, mid-substring, label, Thai label,
  substring across position boundaries, default-position alias, named entries,
  inactive parents and another tenant/warehouse. Existing suites must stay
  green, and Phase 0 p95 must improve beyond run-to-run variance.

Phase 3 — Only if real counts still need it after Phase 2

- Add a location search projection: warehouse, building, floor, eligibility,
  kind, normalized code/name, and target IDs. Index it by warehouse, eligibility
  and code, and by building, eligibility and code. Maintain it in every
  zone/position/ledger/building status or name write. Backfill with readiness,
  following the `summaryBackfill` pattern. Show "unavailable" while it is not
  ready, never empty.
- Optionally add a search-index fast path with substring fallback, after
  evaluating it on Thai text. Apply the same treatment to job-record search: a
  compact projection without AI payloads.
- Accept: sparse search ≤ ⌈N/100⌉ requests with one document per scanned row.
  Building-filtered reads should be proportional to that building's size.
  Include write-cost and backfill-retry tests.

Phase 4 — Icon-only building filter and remaining lists

- Use an `IconButton` with a building icon that opens a searchable chooser fed
  by the bounded `options` query (100 per page). Its accessible name must
  include the current value ("Building: BLDG-A"). Show a visible active marker
  and a removable filter chip, because an icon alone hides the state. Add Thai
  and English copy. Add keyboard, screen-reader (a11y suite) and contrast tests.
  Use the same component in the location table, the named list and,
  optionally, the picker scope.
- It should ship with, or after, Phase 2's index-backed building read.
  Otherwise it is a UI change with no read reduction.
- Move HR lists to the shared cursor stack after the HR work lands. Retire the
  offset paths.

## Not verified

- Production or staging cardinalities, real per-step latency, the Convex region
  and mobile network behaviour.
- Real-device or browser timings: no browser was used, by instruction.
- Whether Convex dedupes repeated `db.get` within a query for billing. The
  limits page counts `db.get` calls as index ranges.
- HR history, review and periods backends beyond the caps cited.

## Appendix — measurement harness

I created and ran the harness as
`tests/integration/zz-kiro-filter-measure.integration.test.ts` with
`KIRO_N=100|1000 pnpm exec vitest run --project integration <file>`, then
deleted it. Its main pieces:

```ts
// Proxy ctx.db to count get/query (includes tenant/auth overhead).
const counting = (db, c) =>
  new Proxy(db, {
    get(t, k, r) {
      const m = Reflect.get(t, k, r);
      if ((k === "get" || k === "query") && typeof m === "function")
        return (...a) => {
          c[k]++;
          return Reflect.apply(m, t, a);
        };
      return typeof m === "function" ? m.bind(t) : m;
    },
  });
// Drive like useCatalogueSync: follow scanCursor until status !== "scanning".
for (;;) {
  const v = (
    await world.t.withIdentity(identity).run((ctx) =>
      fn._handler(
        { ...ctx, db: counting(ctx.db, c) },
        {
          warehouseId,
          pageSize: 20,
          ...args,
          ...(scan ? { scanCursor: scan } : {}),
        },
      ),
    )
  ).value;
  requests++;
  if (v.status !== "scanning") break;
  scan = v.scanCursor;
}
// Seed: 2 ACTIVE buildings (B empty), N zones + FLOOR_BLOCK ledger rows in A,
// last label "NEEDLE ZONE"; DRAFT case patches building A status afterwards.
```
