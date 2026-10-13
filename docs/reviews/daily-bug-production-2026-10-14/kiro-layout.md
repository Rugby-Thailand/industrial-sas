# Storage layout daily bug fixes — production port report

Worktree: `/tmp/industrial-daily-prod-20261013` (base origin/main 59fb1d13). No commit, stage, push or deploy.
Owned files only: `convex/storageLayouts/writes.ts`, `convex/storageLayouts/zones.ts`,
`tests/integration/storage-layout-replay.integration.test.ts` (new). No schema, policy, auth or other-agent files edited. No new shared/exported helper.

## Bug mapping

| Approved behaviour                                                                           | Status on production                   | Code path                                                                                                                                        |
| -------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Building/floor/floor-count/top-floor/status exact retry before version/status checks         | Already fixed                          | `writes.ts` existing `replayed()` helper                                                                                                         |
| F1/F2 schematic approval exact retry before version check and zone scan                      | Ported (was red: `VERSION_CONFLICT`)   | `writes.ts` `approveF1F2Schematic` now calls `replayed()` first, same operation string as its commit                                             |
| Omitted inherited floor offsets clear stored overrides                                       | Ported (was red: old offsets retained) | `writes.ts` `saveStorageFloor` patch writes `offsetXMm/offsetYMm` directly (explicit `undefined` removes the field), matching validated geometry |
| Old zone update replay never reruns zone/default-position geometry writes                    | Already fixed                          | `zones.ts` `updateStorageZone` replay-first                                                                                                      |
| Position update replay after newer geometry/occupancy/archive                                | Already fixed                          | `zones.ts` `updateStoragePosition`                                                                                                               |
| Position archive replay after leaf/occupancy change                                          | Already fixed                          | `zones.ts` `archiveStoragePosition`                                                                                                              |
| Area archive replay after building archived; no archive of later-backfilled default position | Already fixed                          | `zones.ts` `archiveStorageZone`                                                                                                                  |

Authorization is unchanged: every replay still runs inside the `mutationWithOrg` wrapper (permission + warehouse + target checks happen before the handler). Fingerprint is the full `args`, so a reused request ID with different args still refuses with `REQUEST_ARGUMENT_CONFLICT`; stored receipt still verified by `replayTenantWriteIfPresent` (row + result digest).

## Optimization (duplication)

`zones.ts`: four identical 17-line replay adapters (zone update, position update, position archive, zone archive) replaced by one private, non-exported `replayedWrite(ctx, table, operation, args)` that mirrors the existing private `replayed()` in `writes.ts`. Table is typed `"storageZones" | "storagePositions"`, operation string stays explicit at each call site, return shape is identical (`{ written: true, documentId, replayed: true }`). `createStoragePosition`'s command replay was intentionally left inline because it adds the `code` readback. Diff: writes.ts +15/−8, zones.ts +70/−68 (mostly comments explaining why replay must precede the checks). No runtime performance change beyond the schematic retry now skipping the version check and zone-count scan on an exact retry.

Named-layout and other newer production behaviour untouched (`namedLayout.ts`, catalogue, occupancy not edited; only the hunks above changed).

## Tests (vitest, `--maxWorkers=2`)

Before (production base, recorded in `/tmp/prod-kiro.log` red run): replay suite 6 pass / 2 fail — schematic retry `VERSION_CONFLICT`, omitted offsets retained.

After:

- `storage-layout-replay.integration.test.ts`: 9/9 pass (includes an explicit-offset guard case).
- Storage backend set (replay, storage-layouts, storage-layout-actions, storage-location-catalogue, storage-occupancy, fg1-import, pd-import, location-unicode-search, isolation/storage-positions, public-api-registered-coverage): 10 files, 301/301 pass.
- `src/features/storageLayouts`, `src/components/storageLayouts`, location-search-performance, replay again: all pass.
- `staging-flow.integration.test.ts`: 2 fail at the "measure pallet" step with `VERSION_CONFLICT` from `finishedGoods/workflow:saveMeasurement`, after all layout steps succeed. That function is changed by another agent's uncommitted `convex/finishedGoods/workflow.ts` edit (new `expectedMeasurementUpdatedAt`); not in my scope and not caused by these storage changes. Coordinator should recheck it with the finished-goods owner.

## Static checks

- `eslint --max-warnings=0` on the three files: pass.
- `prettier --check` on the three files: pass (test file was reformatted with prettier --write).
- `tsc --noEmit -p .` (TS6, whole shared tree): exit 0.
- Not run: Bun TS7 checker, full `pnpm check`/build (coordinator's final validation).
