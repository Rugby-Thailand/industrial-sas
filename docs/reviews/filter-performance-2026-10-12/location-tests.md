# Location picker research and regression probes

Date: 2026-10-12. Research only; no product behavior changed. Worktree: `/Users/macbook/Development/industrial-sas-filter-research`, copied from the current dirty workspace. The deployed picker is not the same version as this snapshot.

## Findings

1. **Blank search is deliberately skipped in production, but the current source already requests the first page.** The parent investigator captured the deployed public chunk with `browseWithoutSearch` defaulting to `false`, followed by `Q=N||!!K.trim()` and `useQuery(..., Q ? args : "skip")`. See [deployed-picker-snippets.json](deployed-picker-snippets.json). In the current source, [LocationPicker.tsx:79](../../../src/features/finishedGoods/jobScan/LocationPicker.tsx) always requests the catalogue with `text: ""`. A passing component probe and an actual backend handler test verify that a valid blank first page shows 20 locations. This difference explains why simply reading current source cannot explain the user's blank screenshot. The deployment/version difference must be reconciled before releasing a fix.

2. **Exact typed codes still wait for a catalogue scan even though the exact destination is already known.** The actual `searchPage` handler performs `lookupJobLocation`, then scans the active location index and hydrates rows before checking the match. Its exact answer only affects the predicate; it does not become a result immediately. At 121 locations, an exact code, a prefix, and a missing code each required 7 sequential requests. Responses 1–6 exposed no items. The independent `resolve` endpoint returned the same exact destination in one request. The component subscribes to this endpoint too, but consumes only its negative answer to offer registration; a successful exact answer does not appear in `zones`.

3. **Query transitions can show an entirely blank result region.** With the real component and `useQuery` returning `undefined`, there is no loading/status element. The component shows “Checking location…” only when a catalogue response has `status: "scanning"`, and suppresses even that when `canCreate` is true. New query arguments are sent on each continuation; pending responses therefore need explicit feedback, not only the scanning response itself.

4. **A prefix can show “not registered yet” before its matching catalogue scan completes.** Exact lookup of `F1-L30` legitimately says that exact code is absent, while the catalogue is still looking for `F1-L30-16`. The component treats the first answer as permission to show registration and unmapped-save actions. This is misleading search feedback, not proof the exact resolver is wrong. An existing test deliberately expects this early action for typed text; changing it is a product behavior decision. Preserve immediate registration for a scan that confirms a missing complete label, while giving typed prefix searches appropriate pending/matching feedback.

5. **Pagination already exists in the current picker.** Actual handler traversal returned all 121 rows without duplicates or gaps at page sizes 20, 50, and 100. The component renders Previous/Next and page-size controls once a ready response has additional pages. A component probe verified that a nonempty last page remains visible and changing search resets the cursor. Controls are absent while the response is pending/scanning, and are hidden for a one-page result. Building filtering is absent from `searchPage` arguments and picker criteria/UI, so adding only an icon would not implement the requested filter.

6. **Physical location hydration repeats significantly more database work than named registrations.** For a blank 20-row page, the named fixture used 24 document gets and 11 index terminal calls; the physical fixture used 102 gets and 51 terminal calls. Named parent documents are cached within the query reader; physical hydration goes through `targetContext`, which reads building, floor, zone location and destination location for each candidate (and reads the same location twice for an ordinary zone). Filtering should happen before expensive hydration where the schema permits it, with authorized snapshot-scoped parent reuse for remaining reads.

## Feedback loop and measurements

The first command executed before backend hypothesis testing was:

```sh
pnpm exec vitest run --config docs/reviews/filter-performance-2026-10-12/vitest.research.config.mts --project research-ui
```

Initial outcome: 3 failed, 1 passed, 2.24 s. The minimized failures directly render the actual `LocationPicker`, with only Convex transport responses controlled: missing initial loading status; known exact destination not selectable during catalogue scan; early prefix registration message. A later pagination probe brought the suite to **3 expected failures, 2 passes**; the final repeat took 2.30 s. Full diagnostic output: [location-picker-results.txt](location-picker-results.txt).

The backend harness invokes actual authorized query handlers against `convex-test` and wraps only database operations to count them. All fixtures are local and deterministic; they do not alter any remote data.

```sh
pnpm exec vitest run --config docs/reviews/filter-performance-2026-10-12/vitest.research.config.mts --project research-backend --silent=false --reporter=verbose
```

Outcome: **1 expected failure, 5 passes**, initially 0.59 s and 0.783 s on the final repeat. The failing desired-behavior assertion expects the known exact code to appear in the first request. Full trace: [location-backend-results.txt](location-backend-results.txt).

| Local fixture / action                        | Requests to ready result | Shown before final response | Total document gets | Total index terminal calls |
| --------------------------------------------- | -----------------------: | --------------------------: | ------------------: | -------------------------: |
| 121 named registrations, blank, first 20 rows |                        1 |                           — |                  24 |                         11 |
| 121 physical zones, blank, first 20 rows      |                        1 |                           — |                 102 |                         51 |
| 121 named registrations, exact `F1-L30-16`    |                        7 |                           0 |                 163 |                        119 |
| 121 physical zones, exact `F1-L30-16`         |                        7 |                           0 |                 647 |                        389 |
| 121 named registrations, prefix `F1-L30`      |                        7 |                           0 |                 149 |                        119 |
| 121 physical zones, prefix `F1-L30`           |                        7 |                           0 |                 619 |                        361 |
| Named registration, direct exact resolver     |                        1 |                           — |                   4 |                         16 |
| Physical zone, direct exact resolver          |                        1 |                           — |                   6 |                         20 |

These counts include tenant, user, permission and warehouse checks. “Index terminal calls” means executed `first`, `collect`, `take`, `unique`, or `paginate` calls, not a claim about the hosted database's billed read units. The trace separately records rows returned by those calls. Local `localMs` fields measure the in-memory emulator plus instrumentation and are **not production latency benchmarks**. The parent investigator's live browser traces are the production timing evidence.

A separate blank-search fixture put 120 active location rows under a draft building ahead of one eligible destination: six empty scanning responses, then the destination on request 7. This demonstrates the cost of post-hydration eligibility filtering; it is not asserted to describe the production data and is not needed to explain the production blank gate.

Traversal totals: 121 unique rows in 7 requests at size 20, 8 requests at size 50, 7 requests at size 100. The API reads at most 20 candidates per continuation even when the visible page size is 50 or 100. A larger visible page is not a search-performance fix.

Additional passing backend checks reject out-of-scope warehouses, foreign-tenant warehouses and a cursor reused after the search criterion changes. The named catalogue's building criterion excludes rows from another building; the picker API has no corresponding building argument yet.

## Existing targeted tests

```sh
pnpm exec vitest run \
  src/features/finishedGoods/jobScan/LocationPicker.test.tsx \
  src/hooks/useCatalogueSync.test.tsx \
  src/hooks/useCursorPagination.test.tsx \
  src/hooks/useScanContinuation.test.tsx \
  tests/integration/finished-goods-job-scans.integration.test.ts \
  tests/integration/storage-location-catalogue.integration.test.ts
```

Result: **53 passed across 6 files**, 1.99 s. Output: [existing-targeted-results.txt](existing-targeted-results.txt). Existing tests protect late scan cancellation, permissions, ambiguous identity refusal, warehouse isolation, QR aliases, canonical registration, and cursor traversal. They did not cover a pending typed search with a successful exact answer or blank initial loading feedback.

`useCatalogueSync`'s default row detector checks `page`, `products`, and `pallets`, not `items`. This is **not** a picker rewind bug: `searchPage` preserves `page` while adding `items`; the new component test verifies this end to end through the real hook. Other consumers that return only `items` need their own row detector.

## Source anchors and ranked causes

| Source                                                          | Evidence                                                                                              |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `convex/finishedGoods/jobScanLocations.ts:270–311`              | Active location index, no text/building index narrowing, max 20 candidates, full hydration then match |
| `convex/finishedGoods/jobScanLocations.ts:491–524`              | Exact resolution repeated per search continuation, then catalogue scan; no building argument          |
| `convex/lib/cataloguePagination.ts:192–237`                     | Hydrates incoming/saved candidates; exposes empty page until full or exhausted                        |
| `src/features/finishedGoods/jobScan/LocationPicker.tsx:70–110`  | Blank query enabled locally; separate exact result only used for missing/creation state               |
| `src/features/finishedGoods/jobScan/LocationPicker.tsx:301–374` | Ready-only empty state/pagination; scanning-only status; result rendering uses catalogue items        |
| `convex/finishedGoods/scanning.ts:132–150`                      | Per-physical-destination building, floor and location document reads                                  |
| `src/hooks/useScanContinuation.ts:24`                           | 250 ms debounce, not sufficient to explain a multi-second scan                                        |
| `src/hooks/useCatalogueSync.ts:31`                              | Generic row detector; picker remains safe because backend includes `page`                             |

The ranked hypotheses communicated before backend probes were: catalogue continuation latency; unused successful exact lookup; blank eligibility/migration filtering; cursor/context reset defects. Tests support the first two, establish a conditional eligibility cost, and do not reproduce a current-source picker cursor-reset defect. Live deployment evidence subsequently identifies a separate deliberate blank-search gate. No product implementation or rollout is included in this research.

## Plan implications

Start with a fast authorized exact result and an indexed code-prefix path, keeping broader label/substring semantics explicit. Return a first blank page, then apply the same tenant/warehouse/building criteria to browse, exact results, prefix results, cursors, and pagination resets. Do not allow a building filter to be merely a client-side filter over one retrieved page. Preserve ambiguity, inactive-hierarchy and wrong-entity checks from the current resolver.

Add persistent loading and pending search feedback; keep safe prior results only while clearly identified as pending. Show typed-search registration after a coherent search outcome or through an explicitly separate create action. Keep working pagination and improve its visibility during transitions. Use these failing research probes as the acceptance starting point, then measure the real deployed user journey again after a scoped implementation.
