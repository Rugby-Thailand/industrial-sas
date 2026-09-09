# Catalogue context persistence

## Issue and change

Search, status, product/unit tab and card/table layout previously reset whenever the catalogue remounted after opening a detail page or refreshing. They now persist in browser local storage scoped to the signed-in actor and selected warehouse using `useDraftKey("fg-catalogue")`.

Actor or warehouse changes remount the catalogue with only that scope's preferences. The catalogue waits for an authenticated actor scope before reading preferences. Thai and English share that actor/warehouse preference. Invalid saved values recover to safe defaults; status is validated against the selected tab. If browser storage throws, the current catalogue still works in memory.

Clear filters persists empty search and all statuses without changing the selected tab or layout. Switching the product/unit tab continues to reset status to avoid an incompatible status filter.

## Validation actually run

- `pnpm exec vitest run src/features/finishedGoods/ProductScreens.test.tsx src/features/finishedGoods/ProductScreens.a11y.test.tsx`: **57 tests passed, 2 files**.
- `pnpm typecheck`: passed.
- Scoped ESLint on the changed product screen, tests and catalogue view helper: passed.
- `git diff --check` for the changed catalogue files: passed.

New behaviour coverage: remount restores all four settings; actor and warehouse switching isolates preferences; auth loading hides previous scope; malformed JSON/null/array/invalid fields recover; clear filters remains cleared on remount; English → Thai retains context; read/write storage failures do not prevent filtering.

## Flow improvement and limits

After returning from details, users no longer need to repeat their search, status, tab and layout selection (up to four repeated interactions avoided). Local storage persistence is tested through component remounts, not a browser reload in this subtask. Browser navigation, refresh, mobile and real rendered contrast checks remain with the main agent's combined UX inspection. No backend, inventory quantity, weight, stacking or browser changes were made by this subtask.
