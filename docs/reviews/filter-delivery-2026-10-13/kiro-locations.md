# Location search, filter and pagination slice: Kiro delivery

Date: 2026-10-13. Worktree `/Users/macbook/Development/industrial-sas-filter-locations`, based on `main` at `11c8c2cc`. Everything is uncommitted for parent review. Nothing was pushed or deployed, no remote data was touched, no browser was used, and `.env` files were not read.

This revision resumes a session that service throttling interrupted. It fixes every finding in `sol-location-initial.md` (backend follow-up and the appended picker UI audit) and the critical exact-miss regression from the parent brief.

## Ownership

Owned by this slice: the files listed under Changes below, plus this report, `kiro-locations-*.json` and `kiro-locations-measure.harness.ts.txt`.

Not owned, and excluded from this delivery:

- `src/hooks/useScanRecovery.ts`: the operations worker's helper, copied in by the parent. It is used here but was not edited.
- `src/hooks/useCursorPagination.ts`: the parent's concurrent multi-scope history fix.
- `.agents/`: present before this work started.
- `tests/integration/location-unicode-search.integration.test.ts` and the NFC normalisation lines in `convex/storageLayouts/locationCatalogue.ts`: they appeared in this worktree at 02:20–02:22 during this session, from outside it. I kept both. I changed one thing: normalisation now runs after the carried tail is joined to each chunk, so a combining mark at the start of a chunk still composes. The Unicode test passes.

## Review findings and fixes

| Finding (Sol / parent)                                                                                                       | Fix                                                                                                                                                                                                                                                                                                                                                                                                   | Regression evidence (actual handlers or React/jsdom)                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1: a legacy physical row whose `buildingId`/`floorId` is backfilled between picker pages is lost                            | `KeysetSegment.equalities`: the building prefix and the explicit-missing-`buildingId` prefix are one segment, merged in (code, creation time, ID) order. Backfilling changes only which prefix a row belongs to, never its traversal position, so no cursor can skip or repeat it. Completeness does not depend on the backfill.                                                                      | `searchPage` with the public building and zone writers: a legacy area sorts after a full page 1; a manual patch, and separately the real backfill handler, runs between pages; page 2 still returns it in code order. Global code order across legacy and current rows is also tested, fixing Sol's ordering observation.                 |
| P1: catalogue descendant search overran its budget (1,452 position rows in one request)                                      | The catalogue scan is `sequential`. `descendantsMatch` reads position history in bounded keyset chunks and returns `KeysetSuspend` with `{status, code, time, id, tail}` when the budget is spent. The scan resumes that same area on the next request, and suspended areas are not re-read.                                                                                                          | 12 zones × 120 inactive positions, `NEVER_MATCH`: 1,151 then 313 position rows (each request ≤ 1,200 + one chunk), `ready`, 12 rows re-read in total.                                                                                                                                                                                     |
| P1: exactly 1,000 inactive positions caused `INTERNAL_ERROR`                                                                 | The 10-read cap and `CATALOGUE_READ_CAPACITY_EXCEEDED` are removed. History is never capped or truncated. A match may span labels, codes and chunks through the carried `needle.length − 1` tail.                                                                                                                                                                                                     | 1,000 inactive positions with `late needle` on #999: found in 3 requests (1,161 / 1,153 / 39 position rows), no error. A needle spanning positions #99 and #100, across a chunk boundary, matches.                                                                                                                                        |
| P2: a renamed building repeats its ID across pages; tie/boundary semantics                                                   | Positions are (key, creation time, ID). Same-key reads include an equal creation time and order exact ties by ID, so ties are neither skipped nor repeated. The previous page's IDs are excluded from the next page. A boundary row whose key changed returns `reset`. `BuildingOptions` also de-duplicates accumulated pages by ID.                                                                  | `buildingOptions`: four buildings sharing code `TIE` across the 50-row boundary are each returned once (52/52). Renaming a page-1 row does not repeat it on Next. Renaming the boundary row resets. A fresh traversal lists 52 unique rows.                                                                                               |
| P2: building options reset or stalled scan had no usable retry; the query was outside an error boundary                      | `BuildingOptions` uses `useScanRecovery` with `useCatalogueSync`. A reset restarts once from the first page. A second reset, or a reset with nothing to drop, shows "Buildings could not be loaded." with Try again (`attempt`). A stalled scan shows an alert with Try again, and a paused scan shows Keep searching. A local `QueryErrorBoundary` offers Try again without losing the picker draft. | jsdom: More → reset → one restart without a cursor → reset again → alert, no loading → Try again sends `attempt: 1` → recovers. A stalled building scan shows the alert. A thrown query shows the local fallback with the typed text kept.                                                                                                |
| P1: a denied response kept earlier ready rows interactive                                                                    | A denial discards the held answer (`setHeld(undefined)`), hides the rows, the exact row, the skeleton and the pager, and clears `aria-busy`. Restored access shows only the new answer. `BuildingOptions` hides earlier options on denial.                                                                                                                                                            | jsdom: ready → same query denied → no choice buttons, denial alert, no pager → access restored → only the new row.                                                                                                                                                                                                                        |
| P2: an initial or repeated list reset had no Retry; a repeating scan cursor had no guard                                     | `useScanRecovery` replaces `useScanContinuation` in `LocationChoices`. `useResetEscalation` mirrors `useCatalogueSync`'s single automatic restart: a reset with nothing to drop, or any later reset before a ready answer, shows Retry. Stalled scans show "The search stopped making progress." with Retry. After 50 automatic steps the scan pauses with Keep searching.                            | jsdom: a page-1 reset → Retry with `attempt: 1` recovers. Next → reset → one restart → page-1 scan resets → alert → Try again recovers. A stalled scan shows the alert, makes no request loop, and Retry recovers. A pause happens at exactly 50 steps and resumes to 100.                                                                |
| Critical (parent/Sol): typed `F1-L30` with an exact miss and a ready, not-done prefix page offered Add location and unmapped | Picker `searchPage` and `buildingOptions` use `lookahead`: a full page is `ready` only after one further match is found (`isDone: false`) or every range is exhausted (`isDone: true`). The UI gates the Add and unmapped offers and "no match" on `ready && isDone && !typing`, not on `ready`. The barcode-confirmed missing path still offers Add immediately.                                     | jsdom: `F1-L30`, `LOCATION_NOT_FOUND`, a ready `isDone: false` page → no Add, no unmapped, no "not registered", no "no match"; an exhausted page → offers both. Handler: exactly 20 matches gives a ready `isDone: true` page 1; 21 matches gives `isDone: false` and a page 2 with 1 row. The existing scan-confirmed test still passes. |
| Browser: the filter trigger measured 36×36 on desktop                                                                        | The shared icon size's `dense:min-h-control` (36px) survived `twMerge`. The trigger now uses a fixed `size-12 dense:size-11` (48px, or 44px on dense pointers), which overrides the smaller minimum. The search input gets `dense:h-11` so it lines up.                                                                                                                                               | The class contract is asserted in jsdom. The rendered size was not re-measured, because no browser was used; parent T3 check pending.                                                                                                                                                                                                     |

## Changes (owned files)

- `convex/lib/keysetScan.ts` (new): bounded keyset traversal.
  - Multi-prefix merged segments.
  - Tie-safe reads. A pathological case, more than `limit` exact key/time ties, reports no progress instead of spinning; the client's stall guard handles it.
  - `sequential` evaluation with `KeysetSuspend` resume.
  - `lookahead`.
  - `readKeysetRange` helper.
  - Anchor reset and previous-page exclusion.
  - Cursor scope version `keyset:3` (`keyset:3+` with lookahead). Older cursors reset.
- `convex/finishedGoods/jobScanLocations.ts`:
  - Merged picker segments.
  - `lookahead` on `searchPage` and `buildingOptions`.
  - Optional ignored `attempt` on both. It is not part of the cursor scope, so Retry keeps cursors valid (tested).
- `convex/storageLayouts/locationCatalogue.ts`:
  - Resumable, uncapped `descendantsMatch`.
  - Sequential scan with a budget of 1,200.
  - Retained matches skip re-running text work but still re-check eligibility.
  - `detail`, `list` and `options` (authoritative geometry and occupancy) are unchanged.
- `src/features/finishedGoods/jobScan/LocationPicker.tsx`: everything in the table above.
- `messages/en.json`, `messages/th.json`: four new `JobScan` keys: `locationSearchStalled`, `locationSearchPaused`, `keepSearching`, `buildingsFailed`.
- `tests/fixtures/public-function-contract.json`: refreshed with `UPDATE_PUBLIC_CONTRACT=1`. Additions only (optional `attempt`).
- Unchanged from the first delivery: the tenant range adapter, schema indexes, backfill, writers, `scanning.ts`, API references and `_generated/api.d.ts`. `pnpm ci:codegen` now confirms the generated files match.

Compatibility:

- An older client still reading `canCreate` from `searchPage` gets `undefined`, so it does not offer Add.
- Old-format cursors return `reset`.
- Tenant, actor and warehouse authorisation, retained-ID re-evaluation and cursor scoping are unchanged.

## Measurements

These are local emulator counts only. They come from actual handlers in `convex-test`, counted by proxies on `db.get`, query terminal calls and `take()` result rows. They are not hosted billing units, and they are not latency. No hosted latency was measured. That needs the parent's T3 or staging run.

Picker and catalogue journeys use the same harness as before (`kiro-locations-measure.harness.ts.txt`). Results are in `kiro-locations-after-final.json`; `kiro-locations-before.json` is the baseline at `11c8c2cc`. Lookahead added 1–6 query calls per journey. Request counts and first-visible-request did not change:

| Journey (page size 20)    |           N | Requests before → now | First visible |      `get` |        queries |
| ------------------------- | ----------: | --------------------: | ------------: | ---------: | -------------: |
| Picker blank, page 1      | 121 / 1,000 |                 1 → 1 |             1 |   122 → 25 |        31 → 32 |
| Picker exact `F1-L30-16`  |       1,000 |                50 → 3 |             1 | 6,300 → 17 |  2,050 → 1,055 |
| Picker prefix `F1-L30`    |       1,000 |                50 → 3 |             1 | 6,100 → 17 |  1,850 → 1,055 |
| Picker sparse `NEEDLE`    |       1,000 |                50 → 3 |             3 |  6,100 → 9 |  1,850 → 1,057 |
| Picker miss               |       1,000 |                50 → 3 |             — |  6,100 → 6 |  1,850 → 1,057 |
| Picker empty building     |       1,000 |               n/a → 1 |             — |          3 |             12 |
| Catalogue sparse `needle` |       1,000 |             2,000 → 4 |             4 | 7,000 → 16 | 23,999 → 2,069 |
| Catalogue empty building  |       1,000 |                50 → 1 |             — |    200 → 3 |       600 → 12 |

Per-request index rows for Sol's descendant fixture (rerun of Sol's script with a scan loop, local only):

| Scenario                                                      | Requests | Position rows per request | All index rows per request |
| ------------------------------------------------------------- | -------: | ------------------------- | -------------------------- |
| 12 zones × 120 inactive positions, `NEVER_MATCH`              |        2 | 1,151 / 313               | 1,172 / 326                |
| One zone with exactly 1,000 inactive positions, `late needle` |        3 | 1,161 / 1,153 / 39        | 1,182 / 1,173 / 50         |

Sol's original backend script also runs unchanged against this code:

- The rename scenario returns 1 row on Next, with no duplicate.
- The sparse request is `scanning` after 1,151 position rows; it previously returned `ready` after 1,452.
- The exactly-1,000 scenario returns a successful envelope; it previously raised `INTERNAL_ERROR`.
- The legacy scenario no longer reaches its boundary, because merged order places the area on page 1. The boundary case is covered by the new test above.

Sol's UI script no longer starts under plain Node here: Node's ESM detection rejects `barcodeImage.ts`. Its two scenarios, and the critical `F1-L30` variant, are covered by the Vitest/jsdom tests.

## Checks (final)

```sh
pnpm exec vitest run   # pnpm test: 302 files, 3,932 tests passed
pnpm exec vitest run src/features/finishedGoods/jobScan/LocationPicker.test.tsx   # 41 passed (10 new)
pnpm exec vitest run tests/integration/location-search-performance.integration.test.ts \
  tests/integration/location-unicode-search.integration.test.ts \
  tests/integration/storage-location-catalogue.integration.test.ts   # 34 passed (7 new)
PATH=<pinned bun 1.4.3>:$PATH pnpm typecheck   # Bun checker (TS 7.0.2): no type errors in 913 files
pnpm exec tsc --noEmit -p tsconfig.json        # TS 6 fallback: clean
pnpm lint                                      # eslint . --max-warnings=0: clean
pnpm format:check                              # clean
pnpm ci:codegen                                # matches pinned Convex CLI output (throwaway loopback backend)
impeccable detect --json LocationPicker.tsx    # []
pnpm ci:test-discovery                         # only reports the two untracked integration test files
```

The Bun checker is the pinned binary in `industrial-sas-filter-implementation/.cache/bun-checker/`, put first on `PATH`. Nothing was downloaded.

## Remaining limits

1. Hosted latency, the rendered 44px trigger, mobile layout and narrow-popover placement are unverified here. They need the parent's browser and T3 checks.
2. Policy for keys that change:
   - Location codes are immutable in every writer.
   - For buildings, a row renamed to before the current boundary is found again from page 1, but not later in the same traversal.
   - A renamed boundary resets the traversal, and repeats are suppressed.
   - The catalogue additionally restarts on summary generation.
3. Contains search over a whole warehouse is still linear in warehouse size (about 3 requests per 1,000 physical rows). Lookahead can extend a full page's scan until one more match or the end of the ranges. Making it proportional to the page needs a maintained text projection.
4. Picker retention is scoped to the warehouse and criteria, and is cleared on denial. Actor and organisation switches rely on Convex re-subscription and `JobScanScreen`'s `useDraftKey` remount. A full auth-switch transition was not verified in a browser.
5. `JobScanRecords.tsx` still passes the no-op `browseWithoutSearch`, and `JobScanRecords.test.tsx` belongs to another worker. Check both at integration. If the parent's final `useScanRecovery` changes, re-run `LocationPicker.test.tsx`.
