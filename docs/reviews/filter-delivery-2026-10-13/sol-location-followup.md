# Sol backend location follow-up

Provisional backend audit on October 13, 2026 (Bangkok), against `/Users/macbook/Development/industrial-sas-filter-locations`, baseline `11c8c2cc`. Kiro was still finishing UI/tests. This pass rechecks backend fixes only; it does not approve deployment or the unfinished UI recovery work.

## Disposition

No unresolved shipping backend defect was established in the fixes audited here. The legacy/backfill omission, global legacy ordering, unbounded descendant evaluation, and terminal 1,000-row history cap are resolved in the tested source. A newly reproduced Unicode-normalization gap was corrected by the parent and is covered by a new authorized regression file.

Raw building-code rekeys remain a limited robustness case: two-page suppression works and a moved boundary resets, but a row from page 1 can still repeat on page 4. No supported writer that changes a building's code was found, so this is **not a shipping rename blocker** and does not justify broad new revision machinery for this delivery.

## Rechecked implementation

- `pickerSegments` now uses one segment merging populated-building and missing-building index prefixes by code/creation-time/ID. Filling legacy parent metadata no longer moves a row behind a visited segment boundary. Prefix/contains phases remain separate, intentionally ordered search phases.
- `keysetScan` checks work between evaluation chunks; the physical catalogue uses sequential evaluation and configured `maxWork: 1_200`. Its `KeysetSuspend` carries a descendant position and only the search tail, so an unfinished area's history resumes without repeating its entire history. There is no fixed history cardinality cap.
- Physical catalogue row hydration excludes positions/occupancy. Parent reads are shared within the query. Descendant text is read in bounded index chunks and can suspend inside a single area's growing history.
- Picker/options lookahead distinguishes a full page from complete search exhaustion. A `ready` page may still have `isDone: false`; only exhausted search establishes absence of later matches.
- Cursor scope includes organization, actor, criteria, page size, and keyset version. Scan continuation validates its starting page position. Retained IDs are re-read through tenant access and re-evaluated for current eligibility.

## Executed reproductions

The original complete backend script is retained in `sol-location-initial.md`. It was rerun against the fixes without product/test edits.

| Reproduction                                                                         | Fixed-source result                                                                                                                                            |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One legacy physical `AUD-F01-Z01` plus 20 named `ZZ-*` choices, building filtered    | First page now starts with `AUD-F01-Z01`, then `ZZ-00`–`ZZ-18`; Next returns `ZZ-19` both before and after parent-field backfill; no omitted or repeated row   |
| 12 zones, each with 120 inactive descendants, sparse nonmatch                        | Initial response suspends after 1,151 position rows / 1,172 total index rows; continuation reads 313 position rows / 326 total rows and returns complete empty |
| Exactly 1,000 inactive descendants, match at index 999                               | Original public `INTERNAL_ERROR` no longer occurs; the dedicated performance regression follows continuation to the correct ready result                       |
| 1,501 inactive descendants, match at index 1,000, plus the other 11 zones' histories | Three responses read 1,165 / 1,151 / 128 position rows (1,186 / 1,172 / 140 total index rows), then return exactly the matching zone, `ready`, `isDone: true`  |
| Previous page's first building raw-patched after its boundary                        | Two-page original probe no longer repeats it on Next                                                                                                           |
| 161 buildings; raw rekey from page 1 beyond three later boundaries                   | Page lengths 50 / 50 / 50 / 12: 162 emitted IDs, 161 unique, moved building appears twice; unsupported raw-rekey limitation described below                    |
| Raw patch of the page-boundary building's code                                       | Existing cursor returns `reset`                                                                                                                                |

The sparse traversal read 1,464 position rows in total for 1,452 fixture positions, including small boundary re-reads. It advances rather than restarting each area's history. The measured per-request maxima are below the actual physical request budget of 1,200, before fixed authentication/document-read overhead. The earlier helper default of 400 is not used as this caller's acceptance threshold.

For the extended probe, adapt the original backend script as follows: seed 160 additional buildings instead of 50; follow `buildingOptions.continueCursor` until done after the raw rename and count IDs across every page. For history, extend one zone to 1,501 inactive positions, put the unique matching label at index 1,000, and repeatedly call physical catalogue `page` with its emitted `scanCursor` while `status === "scanning"`, using the original query-result row proxy on every call. Retain the original query/page criteria across those calls. These are actual authenticated local handlers, actual tenant accessors/storage adapters, and actual emulator index queries, not a mock query builder.

### Cursor identity and retained authorization probe

An additional actual authenticated picker probe created 1,020 named rows in one building, with a single early matching label `needle`. The first sparse response was `scanning`, retained that one matching location ID, and emitted a scan cursor. Before resuming, the probe archived that location and inserted a same-tenant other-warehouse ID and a foreign-tenant ID into the retained ID array. Continuation returned `ready` with no items: archived/out-of-scope/foreign retained rows were not presented.

Changing the cursor's actor scope or reusing it with a different text criterion both returned `reset`. This verifies local cursor-scope validation and retained eligibility; scoped unsigned JSON is still continuation state, not an authorization credential. No HMAC requirement is inferred.

Existing focused tests also exercise changes to text/building/page size, mismatched page base, malformed cursors, tenant/warehouse refusal, inserts before an existing boundary, archival around a boundary, mixed legacy order, actual backfill, contains fragments, canonical QR, support choices, and 20/50/100 traversal. These tests/probes do not establish deployed identity transitions.

## Building-code mutation contract and tie limits

The public `createStorageBuilding` checks unique code within warehouse. `updateBuilding` accepts name/geometry and patches no code. Geometry, activation/archive writers, FG1/PD import patches, and the inspected staging seeds preserve an existing building code. Import rollback restores the digest-bound original building snapshot; a normal import does not rekey it. No supported live path that changes `building.code` was found.

Accordingly, the raw four-page rename result remains genuine generic helper behavior, but it is not a reproduced supported product operation. Stable immutable codes are sufficient for this delivery. Do not describe previous-page ID exclusion as complete arbitrary-rekey deduplication; it only excludes the preceding page's IDs.

Positions now include document ID; equal keys are sorted by creation time, and exact key/time ties are compared by ID. The existing equal-code test passes four rows across a boundary with emulator-generated creation times. This does **not** prove arbitrary large exact key/time tie groups: `readRange` fetches an inclusive time window, and source explicitly permits a repeated scan cursor if all fetched tied rows were already consumed. Current supported writers enforce unique codes in each queried domain, so no valid-domain counterexample requiring a broader tie traversal was established. No unconditional exact-tie completeness claim is made here.

## Unicode correction and regression

The parent was notified of a concrete NFC acceptance gap: public creation of a building named `Cafe\u0301` succeeds and preserves the decomposed text; physical catalogue query `Café` previously returned complete empty, while `Cafe\u0301` returned its zone. `normalizeDisplayName` trims but does not normalize stored names, so this was reachable through a supported writer, not an operator rewrite. This was a pre-existing matching gap exposed during follow-up, not a regression introduced by the keyset fixes.

The parent corrected physical query text, heading text, and joined descendant text to NFC before case folding. Added only the explicitly authorized new file:

`tests/integration/location-unicode-search.integration.test.ts`

Its three cases create buildings/zones through actual authenticated public handlers, preserve decomposed stored building/zone names, and query uppercase NFC and NFD equivalents. The descendant case seeds a distinct inactive historical ledger/position fixture and executes the actual public catalogue query. All three cases pass. The case selection independently verifies building heading, zone heading, and archived descendant matching.

No product file or Kiro-owned test file was edited by this audit. The only worker write was this new test file; review reports were written in the integration worktree.

## Validation and snapshot limits

Commands:

```sh
pnpm exec vitest run tests/integration/location-search-performance.integration.test.ts tests/integration/location-unicode-search.integration.test.ts tests/integration/storage-location-catalogue.integration.test.ts tests/integration/finished-goods-job-scans.integration.test.ts tests/integration/tenant-storage.integration.test.ts tests/isolation/tenant-storage.isolation.test.ts tests/isolation/tenant-document-access.isolation.test.ts
pnpm exec prettier --check tests/integration/location-unicode-search.integration.test.ts
pnpm exec eslint tests/integration/location-unicode-search.integration.test.ts --max-warnings=0
```

Final focused batch: **7 files passed, 136 tests passed**, 11.07 seconds. Kiro added further tests between the earlier 126-test run and this final batch. The new Unicode suite independently passed 3 tests. Its formatting and lint checks passed.

Latest snapshot reconciled at `2026-10-12T19:27:54Z` (October 13 in Bangkok):

| Source                                       | SHA-256                                                            |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `convex/lib/keysetScan.ts`                   | `2bc8cf91b6a27effac54fa2c0c35aadc94f2c0606023fba31dd304a6e034b9ef` |
| `convex/finishedGoods/jobScanLocations.ts`   | `fa62b760e5e12c1f5aa9796be018e905d7a2b7c5c65d843ff287409958596cbf` |
| `convex/storageLayouts/locationCatalogue.ts` | `1065be7a2ffd49617ecb4bd7ead896a617a1d3dd998688329811db131212e8a7` |
| New Unicode regression file                  | `f2d83b724aaa5e07561a6db4b44fb90f85c056a1aedea0cfc912c34d9ee25ee4` |

- All row/read counts are local `convex-test` observations; they are not hosted billing units, production latency, or the plan's 30-run warm-session measurements.
- No browser, production call/write, commit, or deployment was performed.
- Final integrated writer/backfill/recovery review, completed UI audit, generated/public-contract checks, deployment alignment, and release performance evidence remain parent-owned or pending. This report addresses the backend fixes above, not the complete all-list rollout.
- Source was changing during review. The audited backend algorithms were re-read after hash changes and targeted validation was repeated after the Unicode correction. Final hashes delimit the reported snapshot; subsequent changes require reconciliation.

### Latest concurrent NFC edit reconciled

After the 136-test batch, Kiro adjusted descendant normalization to normalize the **carried tail plus the joined new text**, then case-fold. Query and heading normalization remain present. The latest catalogue hash is the one in the table above, replacing the earlier `804e87...` snapshot. The dedicated Unicode suite was rerun against this latest source: **3 passed**, 519 ms. The changed expression was inspected and introduces no unbounded reads or new cursor algorithm; prior backend count evidence remains applicable. This resolves the concurrent edit uncertainty rather than treating the older hash as final.

## Completed picker recovery follow-up

Parent subsequently authorized review of the completed picker changes. This section audits that later UI snapshot; it does not change the initial backend-only scope of the preceding work. No unresolved production UI defect was established in the specifically requested recovery/denial/prefix/sizing paths.

### Earlier UI findings resolved

| Earlier concern                                                  | Current source and executed result                                                                                                                                                                                                        |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Held rows stay enabled after read denial                         | Denial clears held state and hides exact/list choices. Original React/jsdom transition now reports `denialShown: true`, `heldChoiceShown: false`, `heldChoiceEnabled: false`                                                              |
| Building options remain stuck loading after reset                | One safe automatic restart drops accumulated pages/cursors; a reset on the restarted first page reports failure/Retry. Independent probe: `loading: false`, `hasMore: false`, no old cursor in args, one Retry, no selectable old options |
| Filter Retry repaints without changing subscription identity     | Independent probe after the preceding reset: args become `{ warehouseId: "warehouse-a", attempt: 1 }`; ready option becomes enabled                                                                                                       |
| Location first-page reset falls through silently                 | Independent actual component/hook probe: initial args `{ warehouseId: "warehouse-a", text: "", pageSize: 20 }`, visible Retry, no `aria-busy`; click sends the same criteria with `attempt: 1`, shows enabled ready choice, removes alert |
| Ready prefix page offers registration/unmapped before exhaustion | Exact miss for settled `F1-L30` plus a ready `isDone: false` page now reports `addLocationShown: false`, `unmappedShown: false`, `prefixChoiceEnabled: true`                                                                              |
| No stalled/long-scan recovery                                    | `useScanRecovery` suppresses missing/repeated continuation cursors and exposes Retry; after 50 automatic steps it pauses with Keep searching. Completed tests exercise both paths and check serialized Retry arguments                    |
| Thrown building-options query kills surrounding draft            | Building filter now has its own query error boundary and local retry. Completed test simulates a thrown query, recovers the filter, and preserves typed text                                                                              |
| Filter target may shrink below 44px under dense styling          | Trigger uses explicit `size-12 dense:size-11`; at default root scale that is 48px/44px, overriding shared 36px dense minimum. Class regression passes. Browser/computed-layout measurement is not claimed                                 |

The original UI reproduction script in `sol-location-initial.md` was adapted only in memory to report absence of the now-removed old buttons rather than throw when querying them. A follow-up click on building Retry captured the actual new argument object. The independent first-page location probe mocked `reset` for attempt zero and ready for attempt one, then captured the actual outgoing args. The prefix probe returned an exact miss and a valid ready/not-done matching choice page. These use actual component/hook code under React/jsdom; Convex results, translations, and unrelated registration/pager rendering are mocked as described in the initial report. They are not browser or deployed authentication tests.

### UI checks and limits

```sh
pnpm exec vitest run src/features/finishedGoods/jobScan/LocationPicker.test.tsx src/features/finishedGoods/jobScan/LocationPicker.ai.test.tsx src/features/finishedGoods/jobScan/LocationPicker.image.test.tsx
```

Result: **3 files passed, 64 tests passed**, 4.66 seconds. Coverage includes first-page and repeated resets, changed Retry args, independent filter reset/stall/denial/error recovery, barcode-confirmed missing registration, pending-scan cancellation, typed prefix exhaustion, canonical exact deduplication, and fixed filter sizing. The current impeccable mechanical detector returned `[]`.

The picker still relies on its parent/provider for identity-boundary remounting: local session/cache keys are warehouse/criteria based. `JobScanScreen` additionally keys by actor-scoped `useDraftKey`; the records picker and complete provider/org-switch lifecycle were not browser-tested here. No universal auth-switch isolation claim is made. Current query denial explicitly clears rendered retained choices, and the backend independently revalidates tenant/actor/criteria/retained IDs as recorded above.

No browser, rendered geometry, real keyboard/Escape focus restoration, native mobile touch, or production session transition was exercised by this sub-audit. Parent-owned DOM/browser evidence must retain its own tool limitations. No UI/product or Kiro-owned test edits were made.

UI snapshot hashes at `2026-10-12T19:27:54Z`:

- `src/features/finishedGoods/jobScan/LocationPicker.tsx`: `005ea86b5bacc85435fdc8439674dbc7f4b7784930e0ff6d4019e5329d9d802b`
- `src/hooks/useScanRecovery.ts`: `3e8e052eec13ee19cbe7f45b8761cab3519d02c3c8ce5875db859978c734db19`
