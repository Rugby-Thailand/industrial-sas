# Filter, search, and pagination improvement plan

Implementation status: see the [October 13 delivery and audit report](../reviews/filter-delivery-2026-10-13/README.md). The evidence below records the original research baseline; final implementation and validation supersede its pending steps.

Research started October 12, 2026. Status: researched and tested; application changes are planned, not implemented or deployed.

## Recommended order

1. Fix the scan location picker: default browse, immediate exact matches, truthful loading/empty states, and a building filter button.
2. Make its database work proportional to the requested page, including indexed building and code-prefix filtering.
3. Apply the same pagination and search contract to every record table/list, starting with scanned records and storage catalogues, then HR.
4. Address the remaining expensive list inputs: destination recommendations, full building payloads, catalogue sorts, and holiday queries.

This extends the [October 10 performance plan](performance-improvement-2026-10-10.md) with reproduced location defects and a focused cross-page rollout. Reuse the existing pagination components; pagination infrastructure already exists.

## Evidence collected

The isolated worktree is `/Users/macbook/Development/industrial-sas-filter-research`, branch `research/filter-performance-2026-10-12`. It snapshots HEAD `733c6aca` plus the original workspace's tracked and untracked work. Existing local secrets were not copied; installed dependencies are shared. Production checks used the already authenticated T3 preview and only searched/read locations.

| Check                                               | Result                                                                                                                                                         | Evidence                                                                                                                                                         |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live exact search `F1-L30-16`                       | **14.115 s**, then **13.795 s** from input event to visible matching row                                                                                       | [First trace](../reviews/filter-performance-2026-10-12/live-exact-trace.json), [repeat](../reviews/filter-performance-2026-10-12/live-exact-repeat.json)         |
| Live blank search                                   | No locations or loading status after **43.024 s**                                                                                                              | [Trace](../reviews/filter-performance-2026-10-12/live-blank-trace.json)                                                                                          |
| Live prefix `F1-L30`                                | No location matches after **23.932 s**; an exact-code-missing message and Add location appeared while search continued                                         | [Early trace](../reviews/filter-performance-2026-10-12/live-prefix-initial.json), [later trace](../reviews/filter-performance-2026-10-12/live-prefix-trace.json) |
| Deployed frontend                                   | `browseWithoutSearch` defaults to false and blank search passes `"skip"` to the query                                                                          | [Public bundle snippets](../reviews/filter-performance-2026-10-12/deployed-picker-snippets.json)                                                                 |
| Current local frontend                              | Blank query is enabled; ready blank-query rows render. Initial loading feedback and early exact-match rendering fail desired-behavior probes                   | [Location diagnosis](../reviews/filter-performance-2026-10-12/location-tests.md)                                                                                 |
| Actual backend handler with 121 synthetic locations | Exact, sparse prefix, and no-match search require **7 sequential responses**; results remain hidden until completion. Direct exact resolve needs **1 request** | [Backend probe output](../reviews/filter-performance-2026-10-12/location-backend-results.txt)                                                                    |
| Existing pagination/storage regression batch        | **56 tests passed**, 6 files, 3.37 s                                                                                                                           | [Output](../reviews/filter-performance-2026-10-12/existing-pagination-tests.txt)                                                                                 |

Independent Kiro scaling probes reproduced the same growth at 1,000 synthetic physical locations: a sparse picker search required **50 sequential responses**, and the storage-location catalogue required **2,000** (one zone-selection step and one inspection step per zone). Empty building filtering still needed 50 catalogue responses. These counts prioritize indexed storage queries immediately after the picker. See [100-row measurements](../reviews/filter-performance-2026-10-12/kiro-measure-100.json), [1,000-row measurements](../reviews/filter-performance-2026-10-12/kiro-measure-1000.json), and the [independent review](../reviews/filter-performance-2026-10-12/kiro-review.md).

These are two live exact-search observations, not a production percentile or a mobile benchmark. Backend read counts come from the actual handlers through the repository's local test harness, not production database profiling. Production and local frontend versions differ; the production backend revision was not established. Do not infer production dataset size or request count from the 121-row fixture.

## What is causing the symptoms

**Blank browse is disabled in the deployed frontend.** The loaded public asset `3stz5_2p4j0ur.js` gates the query behind `browseWithoutSearch || settledText.trim()`. The current `LocationPicker.tsx` has no such gate. Before release, identify and align the intended frontend/backend revisions; reproducing only the local component would miss this production behavior.

**Typed exact lookup does not supply the displayed row.** `LocationPicker.tsx:96` runs the exact resolver, but `zones` comes only from the catalogue result at line 92. The positive exact response is unused for rendering; the negative response drives Add location. Barcode lookup already selects a resolved location directly. A typed code should show the resolved choice without waiting for the catalogue; typing must not automatically select it.

**Bounded requests still form a slow sequential scan.** `jobScanLocations.ts:260` pages through active warehouse locations in chunks of at most 20, hydrates candidates, and then applies text matching. `searchPage` repeats exact lookup on continuation requests. `cataloguePagination.ts` emits an empty page while it fills a result page or reaches exhaustion. A rare match or a miss therefore costs work proportional to the warehouse's locations, plus repeated authorization and parent lookups. Raising a limit alone does not fix this.

**The UI conflates incomplete search and absence.** No initial status is rendered while the query is undefined. A typed prefix can produce a valid exact-code miss, but that does not establish that there are no matching locations. The live DOM also alternates transient no-match/checking states while results are pending. Loading, searching, settled-empty, denied, and failed states need separate treatment.

**Pagination is present but cannot help until the page finishes.** The scan picker already uses `useCursorPagination`, `useCatalogueSync`, and `CursorPagination`, with sizes 20/50/100. Its footer appears only for a ready result with another/previous page. Existing traversal tests pass. Improve data access and visibility before adding a second pagination implementation.

## 1. Location picker behavior — first implementation slice

Owner files: `src/features/finishedGoods/jobScan/LocationPicker.tsx`, `JobScanScreen.tsx`, `messages/en.json`, `messages/th.json`, and their tests.

- Opening “Where are we?” immediately requests the first 20 eligible locations in the current warehouse. Blank search means browse all; it must never disable the query. Preserve the warehouse and permission boundary.
- Display a stable loading region from the first unresolved request, including the debounce interval. Maintain status through continuation requests. Keep the input usable, expose `aria-busy`, and announce settled updates politely.
- When the existing exact resolver returns a valid location for the current text/scope, show that location immediately as a selectable result. Deduplicate it by canonical location ID when the normal page arrives. Discard obsolete responses after edits, warehouse changes, cancellation, or a new scan.
- Keep the typed exact match separate from catalogue pagination so pinning it neither consumes a cursor row nor skips another result. A typed match is a suggestion, not automatic selection. Preserve barcode/QR validation and intentional scan auto-selection.
- For ordinary typing, show “No matching locations” only after the matching query is complete. Do not promote “not registered” or save-for-later above results merely because an incomplete prefix is not an exact code. A barcode-confirmed missing label may still offer immediate registration. This intentionally updates the existing test that requires registration before typed catalogue search completes.
- Scope loading retention carefully: retain rows during same-criteria page refresh if safe, with updating feedback; clear or disable rows when their search, tenant, warehouse, or building criteria are obsolete.
- Handle request failure, denied access, retry, stale/reset cursor, and scanning as distinct states. Reset once on cursor invalidation; show a recoverable failure if progress stalls instead of looping silently.
- Show the shared pager consistently once a list has loaded: page indicator, Previous/Next, and 20/50/100 page size. Disable invalid controls; do not invent an exact total/page count. Keep its footprint stable while another page loads.

### Building filter

Add **one icon-only filter button** beside the search/scan controls. Its accessible name is “Filter by building”; it opens a popover on desktop and an appropriately sized popover/sheet on narrow screens. Use the existing icon-button and field primitives, a 44px touch target, keyboard navigation, Escape dismissal, and focus restoration.

Default to “All buildings”. Show all authorized active buildings from an independent lightweight option query, not from the current location page. Select a building to apply immediately, reset to page 1, and retain the typed search. Include a clear action and an active indicator; the selected building should remain visible after closing the panel. The filter must affect blank browsing, prefix/name search, and displayed exact matches. An exact code outside the selected building must not silently bypass the filter. Preserve ticket drafts and existing scanner/photo controls.

The current scan-location endpoint does not accept `buildingId`; add and validate it. Reuse the existing building-option model where possible, but do not load every building's floors merely to render this filter. If options themselves exceed a page, provide a searchable paged selector.

## 2. Location query improvements — fast paths and complete search

Owner files: `convex/finishedGoods/jobScanLocations.ts`, `convex/finishedGoods/scanning.ts`, `convex/schema.ts`, `convex/lib/tenantDb.ts`, its adapter/index policy, and shared typed references.

1. Keep exact barcode/code resolution on the existing authorized code indexes. Remove repeated exact resolution from each catalogue continuation; establish it once per current text. Avoid repeat reads of a ledger row already loaded in the same request.
2. Use an indexed browse path that selects warehouse, eligible location kind/status, optional building, and deterministic code order **before** hydration. Fetch only the requested choices and their shared parent labels. Reuse parent reads within the request. Do not hydrate occupancy, geometry, movements, or all child positions for a location choice.
3. Add a normalized code-prefix range fast path for labels such as `F1-L30`. Extend the tenant database abstraction to support validated ranges after its tenant/equality prefix; keep tenant enforcement, warehouse scoping, read limits, and cursor checks in that abstraction. Do not bypass it with raw database access.
4. Complete the building/floor and normalization data needed by physical as well as named locations. `locations.buildingId` and `floorId` are optional today. Verify all layout/import/create/update/archive writers before relying on new indexes. Prefer completing this existing projection over an unrelated cache. If eligibility/search needs a dedicated choice projection, its schema, writers, and bounded backfill belong in this same slice.
5. Keep existing case-insensitive contains matching available. Present indexed exact/prefix matches promptly; any broader substring fallback remains explicitly searching and cancellable, with deduplication and a cursor scoped to the selected search phase. Never claim a complete empty result from only the fast path. Do not silently replace contains matching with token full-text search: hyphenated codes, interior substrings, and Thai names need contract tests. If the broad fallback remains expensive at 10,000 rows, add maintained search terms/projection as a measured follow-up.
6. Apply building and other selective filters before scanning wherever the schema can support them. If parent eligibility still requires post-filtering, return honest progress/short pages and preserve continuation; do not make page readiness depend on filling 20 matches across an entire warehouse.
7. Preserve one native pagination call per query, bounded reads, `SplitRequired` recovery, stable tie-breaking, and authorization on every retained ID. Keep 20/50/100 sizes and opaque cursors; no arbitrary page jumps that require traversing all earlier pages.

Convex provides cursor pagination and reactive pages, whose row counts can change. Its full-text search has token/prefix semantics and is not a replacement for arbitrary substring matching. These constraints support the separate exact/prefix path and explicit complete-search behavior above. [Pagination documentation](https://docs.convex.dev/database/pagination), [text-search documentation](https://docs.convex.dev/search/text-search).

### Migration and release

Add schema/indexes and compatible optional fields first. Backfill with bounded, resumable batches; cover physical zones, support positions, named locations, imports, renamed codes, and archived/draft parents. Record readiness per warehouse/generation and verify parity against authoritative location eligibility before activating the new path. Keep writes synchronized during backfill. Explicitly update or invalidate choices after building status/name changes, zone/position eligibility changes, parent relationship changes, and deletion. Reads must enforce current tenant/site visibility and must not present invalidated choices as currently eligible. Switch readers behind a reversible flag only after parity and latency checks; retain a safe fallback during rollout. Selection/save must still validate live eligibility, even if a choice projection is stale.

## 3. Pagination and filtering across the application

Use the [surface inventory](../reviews/filter-performance-2026-10-12/surface-inventory.md) as the rollout checklist. Every persisted record table/list needs pagination or an explicit, verified finite boundary. Local array slicing is acceptable only when the complete dataset is small and contractually bounded; it is not a database performance improvement.

| Priority          | Surface                                                                                           | Required work                                                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0                | Scan location picker and assignment dialogs                                                       | Default browse; exact result immediately; building filter; indexed choices; visible pager and loading states                                                                  |
| P1                | Scanned records                                                                                   | Replace full collection/filter/offset slicing with indexed cursor pages; include status/date/location search before paging; preserve selection and exports                    |
| P1                | Buildings, physical locations, named locations                                                    | Reuse current pager; push building/floor/status to indexes; remove one-zone-at-a-time search where indexed data can answer it; paginate options independently                 |
| P1                | Finished-goods catalogue, product batches, legacy units                                           | Keep existing paging; eliminate full scans for supported sorts/search by maintained sort/search data; separate summary totals from page readiness                             |
| P1                | HR employees                                                                                      | Replace the 99-row first-page cap per authorized site with searchable, filtered cursor traversal and explicit overflow handling                                               |
| P1                | HR review and periods                                                                             | Page employees/review groups before day hydration; replace 200-period slice and broad collections; preserve period completeness and immutable exports                         |
| P2                | HR request lists and employee audit/history lists                                                 | Standardize pager/state restoration; add continuation for audit history; retain correct indexed request queries                                                               |
| P2                | Holiday/settings record lists                                                                     | Paginate administrative holiday/member-access lists where growth is possible; replace per-day employee holiday queries with a bounded date-range query                        |
| P2                | Floor table and building editor lists                                                             | Page the table query at its source; load only needed floor/detail data. Separate table data from the complete authoritative geometry used for editing/collision decisions     |
| P2                | Destination picker and other record selectors                                                     | Page or progressively retrieve eligible choices; preserve globally correct recommendation and selected destination. UI paging alone does not reduce recommendation-query work |
| Verify at rollout | AI usage observed in deployed navigation but absent as a standalone route in this source snapshot | Establish matching source/deployment, then add their real record lists to the same checklist; do not mark them audited from sidebar labels                                    |

Additional explicit rollout items: **P1 period-detail exceptions** currently use `open.slice(0, 200)` without continuation, so some period blockers are inaccessible. Page those exceptions independently of the period registry. **P2 member-access lists** currently cap at 200 with an overflow error; employee account/supervisor selectors, batch-unit browsing, stack choices, and pallet movement history also need reachable continuation where they grow. Employee schedules themselves are form fields, not a separate administrative catalogue. Standalone admin/inventory routes were not found in this source audit and were not independently observed in deployment.

Finite exceptions are deliberate: navigation links, shortcut choices, a single edited draft's fields, a selected batch's bounded ticket editor, and a 31-day month/365-day calendar are not open-ended record catalogues. Page the surrounding employee/period/history datasets and bound the data queries without splitting one task's editor or calendar into arbitrary record pages. When a “finite” assumption can overflow, expose a continuation or an explicit limit; never silently hide records.

### Shared behavior contract

- Reuse `CursorPagination`, `PaginationFooter`, `PageSizeSelect`, `useCursorPagination`, and the catalogue lifecycle where they fit. Add query adapters rather than parallel per-page pagination state machines. Respect endpoint sizes: HR requests support at most 50 (currently 20 in UI), while the local floor table uses 25/50/100. Make allowed sizes configurable or deliberately update the API; never send an unsupported 100-row request.
- Search, building, status, sort, site/warehouse, and page size changes reset pagination. Include every criterion plus tenant/user scope in cursor validation and client cache identity. Clear remembered positions on identity/permission boundary changes.
- Preserve criteria and position through detail → Back, refresh where supported, and browser Back/Forward. Audit both URL criteria and saved history metadata; storing a cursor does not restore lost filters.
- Only show exact totals when independently available and correct for those criteria. Prefer “Page 2” and returned-row counts over scanning the dataset for a total. Summary aggregates must not block visible results.
- Keep desktop tables and mobile lists on the same query/filter/page state. Empty/error/loading feedback and keyboard access must work in Thai and English and both themes.
- Search the entire authorized dataset, not just the loaded page. Filtering after a capped `.take()` or showing the first 99/200 records without continuation is not complete search. Here `.all(n)` detects overflow and throws `CAPACITY_DATA_LIMIT`; it does not silently truncate. Those complete reads still create scaling/capacity problems.
- Export and bulk actions must declare their scope. Paginating a visible list must not accidentally export only that page or apply an operation to hidden, stale selections.

## 4. Tests and acceptance gates

The research probes are intentionally separate from the normal Vitest project and include expected failures documenting desired behavior. See [the diagnosis](../reviews/filter-performance-2026-10-12/location-tests.md) for exact commands and results; turn the agreed probes into normal regression tests during implementation.

| Area                     | Acceptance                                                                                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default browse           | First page loads without typing; no production query-skip gate; explicit initial loading, true-empty, denial, retry                                                         |
| Exact lookup             | Known named/physical/support location visible after its direct resolver returns, independent of catalogue completion; no automatic typed selection                          |
| Prefix/name search       | `F1-L30` returns matching locations; code case/whitespace/NFC, Thai names and existing interior-substring semantics remain covered                                          |
| Building filter          | All/selected/clear paths; matching and no-match buildings; no cross-warehouse results; filter survives typing and resets page; options beyond first page reachable          |
| Paging                   | 0, 1, 20, 21, 50, 51, 100, 101, 121, 1,000, and 10,000 fixtures as appropriate; traversal without loss/duplicates; previous/next and page-size changes                      |
| Concurrent changes       | Insert/archive/move/rename during paging; expired, malformed, foreign and old-generation cursors; permission revocation; short/reactively expanded pages and split recovery |
| Request races            | Rapid typing, clearing, changing building/warehouse, barcode resolution, cancelling camera, manual selection, and Back while earlier responses are in flight                |
| Authoritative operations | No reduction in collision/occupancy correctness, recommendation coverage, period completeness, export scope, or tenant isolation                                            |
| UX                       | Keyboard and screen-reader filter/pager use; 44px touch targets; narrow/wide screens; Thai/English; no stale “not registered” state while ordinary search is pending        |

Proposed performance budgets, to verify after implementation rather than claim now:

- Input and loading/filter feedback within 100 ms; keep text search debounce around the existing 250 ms unless measurement supports a change.
- Under a documented warm-session profile with 150 ms RTT, p95 ≤1 s for exact result, blank first page, building-filtered first page, and Next page; p95 ≤1.5 s for indexed code-prefix search. Collect at least 30 runs per scenario, with cold auth/navigation measured separately.
- Exact lookup uses one bounded resolver request and no catalogue scan to display its match. Indexed browse/filter/prefix work scales with page size and shared parents, not total warehouse size; assert read/query counts across 121/1,000/10,000-row fixtures.
- Log time-to-first-usable-result and time-to-complete-search separately. Track continuation count, database reads, response bytes, and render commits. Do not record raw search strings or location IDs in general telemetry.

Run targeted checks for each slice, plus relevant tenant isolation and public-function contract checks when changing backend schemas/references. Final release verification uses an isolated production build and the deployed build marker, not only a fast local mock. A skeleton is feedback; it is not a passing result-latency measurement.

## Delivery slices

1. **Reconcile deployment and adopt the reproduction tests.** Record frontend/backend versions; retain the measured baseline and production blank-search gate evidence.
2. **Location UX and exact lookup.** Default list, initial status, exact row, truthful missing-state behavior, consistent pager. No database migration required for the immediate exact-match fix.
3. **Tenant-safe indexed location queries and building filter.** Range adapter, data/index migration, lightweight options, filter UI, and full search/paging contracts.
4. **Scanned records and storage catalogue queries.** Highest adjacent operational value; validate end-to-end search completeness and read counts.
5. **Finished-goods sorting and HR pagination.** Split by domain so each has its own fixtures, authorizations, export checks, and rollback.
6. **Remaining list inputs and coverage gate.** Destination/building/holiday costs; a maintained surface checklist prevents future tables/lists from reintroducing silent caps or unbounded collection queries.

Each slice is independently reviewable, includes only relevant regression checks, and is released only after its measurement and correctness gates pass. Product source, commits, PRs, and deployment are outside this research-only change.
