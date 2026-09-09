# Finished-goods column filters

Implemented in `codex/finished-goods-column-filters`, feature commit `f247ddb`.
Integrated into the existing `codex/storage-planner` working tree using a reviewed, feature-only patch. The destination already contained extensive uncommitted work; its index and branch history were left intact. Concurrent catalogue view-persistence changes and tests were incorporated before integration.

## UI behavior

- Each data-column header has a filter/sort popover. The action column is unchanged.
- Products: name/SKU, quantity and counting unit, actual storage formats, progress, product status.
- Storage units: code/name/SKU, quantity and counting unit, measured dimensions in metres, lot, operational status including moves.
- Different columns combine with AND; selections in a column combine with OR. Product progress matches at least one active unit. Retired units do not affect totals.
- Quantity ranges require a counting unit. Sorting groups unlike counting units separately. Bounds are inclusive; zero and decimal values work. Invalid/negative/reversed ranges block Apply.
- Apply saves the draft; Cancel discards it; Reset clears the current editor. Chips remove filters and Clear all resets the current tab's filters and sort.
- Cards and tables share results. Each tab retains its own filters. Compact URL state supports reload, browser Back and shared links. Local preferences are scoped by signed-in actor and warehouse, including migration of the previous single-status preference.
- Mobile uses the full-width filter sheet. Tall desktop popovers scroll their fields while keeping actions visible within the available viewport.

## Verification

- Isolated `pnpm check`: typecheck, zero-warning lint, 568 tests passing across 61 files.
- New model/UI coverage: AND/OR combinations, actual quantities, retired units, empty states, mixed progress, moving status, unit-aware ranges, decimals/zero, sorting, dimensions, malformed URLs, draft apply/cancel, chips, layout sharing, legacy preferences, account/warehouse separation, unavailable localStorage, refresh/back restoration and Next history synchronization.
- English and Thai accessibility checks cover both tables, column popovers and the shared sheet.
- Real Chrome QA against the existing local test warehouse: product format reduced 10 products to one; dimensions at most 0.5 m reduced 18 units to three; sorting and lot no-match recovery verified. No inventory writes were made.
- At 390 × 844, checked mobile sheet, fixed visible Apply/Cancel, invalid ranges, combined filters and filtered cards.
- Browser review found and fixed two issues: tall dimension popover extending below the viewport, and Next's internal history markers preventing router synchronization.
- Browser log inspection showed no application JavaScript errors. Clerk's development-key warning and an existing favicon 404 were observed.

## Evidence

- `desktop-column-popover.png`: format filter and active result.
- `desktop-dimension-popover.png`: corrected tall popover with visible actions.
- `desktop-dimension-results.png`: measured dimension results.
- `mobile-filter-sheet.png`: mobile controls.
- `mobile-invalid-range.png`: invalid-input feedback.
- `mobile-filtered-cards.png`: shared card results on mobile.
- `isolated-check.log`: complete isolated checks.
- `integrated-first-check.log`: post-integration typecheck/lint passed; three test timeouts occurred during the initial parallel run.
- `integrated-tests.log`: full post-integration rerun with two workers passed all 573 tests across 62 files. No test assertions or timeouts were relaxed.

Only catalogue presentation and local view preferences change. Existing backend permissions, queries, inventory and storage operations are unchanged.

## Final integration check

The destination passed type checking and lint. A full test rerun with `pnpm exec vitest run --maxWorkers=2` passed 573 tests (62 files); the first fully parallel run had three timeout failures in existing packing/storage-location tests during a heavily delayed browser/server session.

The feature was visually verified in the isolated app before integration. A final main-server tab on port 3100 loaded the application shell, but catalogue data could not load: the shared local Convex endpoint at `127.0.0.1:3320` refused connections. The shared backend was not restarted from this side conversation. The isolated web-only server on port 3103 was stopped after testing.
