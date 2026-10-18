# FG implementation result — finished goods and scanning

Worktree: `/Users/macbook/Development/industrial-sas-ux-flow-20261015-fg` at `faca0cf5` (origin/main). Changes are uncommitted for Codex review. The three new files are marked intent-to-add (`git add -N`) so `pnpm ci:test-discovery` can see them. Nothing was committed or pushed, no browser was used, and no production or credential changes were made.

Each finding was rechecked against current source first. The audit's tree was 84 commits behind. Most of the reported behavior is already fixed on main by the ordered package-scan route (#91), the lifted photo selection, the `BarcodeCameraBox` feedback condition, and the guarded warehouse store.

## Findings

| ID       | Status                                             | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FG-UX-01 | Main path already fixed; residual dead end fixed   | `packageScanPath` now points to `/finished-goods/packages/scan` (`PackageScanScreen` → `confirmScanAssignment`). `unitNextAction`, `BatchManager`, `PackingCompletion`, `ProductBatches` and the pallet header all use it. Residual: the storage route for an unmeasured unit ("Measure before choosing storage") and the batch-unit measure route offered only the batch editor, which has no dimension fields for simple batches. Both now also offer **Scan Packages** for an eligible unit (awaiting measurement or placement, not moving, not retired). The batch-unit notice shows it only to managers; the storage notice already renders only for managers. |
| FG-UX-02 | Already fixed; regression tests added              | The photo selection lives in `JobScanWorkflow` (`usePhotoSelection`). `useNavigationDraft.dirty` includes `photos.photos.length`. Panel switches and Back only close the panel, and the photos are kept.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| FG-UX-03 | Already fixed; regression test added               | `BarcodeCameraBox` renders `feedback` whether or not the camera is on (`feedback \|\| (camera && ACTIVE)`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| FG-UX-04 | Fixed                                              | The client compared the pallet code exactly. Added a shared `convex/model/finishedGoods/palletIdentity.ts#identifiesPallet`, used by both `startMove` (same server semantics) and `MoveScreen.identify`. The QR identifies for either method. A plain code is accepted only for MANUAL, ignoring case and surrounding space. A camera read of the plain code is rejected with a specific EN/TH hint: "Scan the QR label on this pallet, or type its code in the field."                                                                                                                                                                                             |
| FG-UX-05 | Already fixed (cross-tab); caller regression added | `warehouseStore` sends `storage` events through `guardedNavigate` with a single intent owner. The tab keeps its accepted warehouse until the draft owner approves. Job tickets cannot move to another warehouse without a prompt. Per the parent's correction, no header selector was added. `WorkspaceContextBar`, `QueryGate` and the storage views were not touched. `PackageAssignment` drafts are keyed by warehouse, so they cannot move between warehouses.                                                                                                                                                                                                  |

## Files

Source:

- `convex/model/finishedGoods/palletIdentity.ts` (new)
- `convex/finishedGoods/workflow.ts`: `startMove` uses the helper, with no behavior change
- `src/features/finishedGoods/MoveScreen.tsx`
- `src/features/finishedGoods/PalletScreens.tsx`
- `docs/contracts/back-navigation.json`: evidence only, adding real caller case titles to `JobScanWorkflow:panel` and `JobScanWorkflow:locationStep`. No owners, actions or semantic targets changed.

Tests:

- `src/features/finishedGoods/jobScan/JobScanScreen.retention.test.tsx` (new). It runs the real JobScanScreen, PhotoCapture, BarcodeCameraBox/BarcodeImagePicker, WorkspaceProvider, QueryGate, warehouse store and NavigationGuardProvider. Only the camera hook, the image decoder and the Convex transport are substituted. Cases:
  - asks before leaving with collected photos that were not sent to AI, and Keep editing retains them
  - retains unsent photos when switching to Scan code and back to Photo AI
  - native Back closes Photo AI and then the ticket step without discarding unsent photos for the same location choice
  - announces the 50-ticket refusal and a successful read on the barcode image path
  - keeps unsent tickets in their warehouse when another tab switches warehouse until discarding is approved
  - protects a photo-only collection from a cross-tab warehouse switch
- `src/features/finishedGoods/jobScan/JobScanScreen.test.tsx`: Forward restores unsent Photo AI photos after Back returns to the location question
- `src/features/finishedGoods/MoveScreen.test.tsx`: a typed lowercase code identifies the pallet; a camera plain-code read is refused and the QR then identifies. Only the real camera hook's callback is captured.
- `src/features/finishedGoods/PalletScreens.test.tsx`: three cases, covering the storage route and measure route offers and no offer for moving or read-only units
- `src/features/finishedGoods/unitNextAction.test.ts`: a simple-packed dimensionless unit goes to package scan
- `tests/integration/finished-goods-scanning.integration.test.ts`: the real handlers run the whole path, `commitBatch` (simple, dimensionless) → `resolvePackageCode` (QR label) → `resolveLocationCode` → `confirmScanAssignment` → `STORED` with `LOCATION_ONLY` placements, quantities and fullness preserved, and the receipt read back
- `tests/integration/finished-goods-moves.integration.test.ts`: `startMove` rejects a SCAN plain code and accepts a MANUAL `" p-000001 "`
- `convex/model/finishedGoods/palletIdentity.test.ts` (new)

## Proof that the tests catch the defects

- FG-UX-04 and the FG-UX-01 residual: with the source change temporarily reverted, the new MoveScreen cases (2) and the PalletScreens offer cases (2) failed. They pass with the change.
- Already-fixed items, checked by temporarily reverting the original fix (each edit restored with `git checkout`):
  - Removing the photo count from the draft guard fails the two photo-guard cases.
  - Restoring the old `camera ? …` feedback condition fails the image-limit case.
  - Adopting `storage` events without `guardedNavigate` fails both cross-tab cases.

## Commands run (all exit 0)

- `pnpm exec vitest run src/features/finishedGoods src/components/providers src/components/navigation src/lib/workspace convex/model/finishedGoods tests/integration/finished-goods`: 82 files, 1137 tests passed
- `pnpm check:navigation`: 68/68 fixtures; contract OK (58 policies, 293 owners, 26 actions)
- `pnpm lint`
- `pnpm typecheck:ts6`
- `prettier --check` on the changed files
- `pnpm ci:test-discovery`: OK after `git add -N` on the new files

The parent still needs to run the pinned-Bun `pnpm typecheck` and the full `pnpm check`.

## Limitations

- No browser, device or physical camera checks. Camera and decoder behavior was substituted in the tests.
- When the real `NavigationGuardProvider` is mounted and the draft is dirty, its departure buffer replaces the forward history entry after Back to the location question. Forward with photos is therefore proven only without the guard, in the existing JobScanScreen harness. With the guard, the photos stay after choosing the location again. This is shared guard behavior, not photo-specific, and was left unchanged.
- FG-UX-01: the simple-batch editor still has no dimension fields. Label-based storage is the supported completion. Whether simple batches should also accept dimensions is a product decision.
- The return-to-source matcher in `MoveScreen` (already case-insensitive for MANUAL) was not changed.
