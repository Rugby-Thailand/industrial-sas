# Shared storage scene — implementation results

Implemented in `codex/storage-planner`, 2026-09-08. App remains on port 3100.

## Changes

- Added shared SceneBox and role/status/legend policy. Context boxes render all 12 distinct edges; 2D uses four footprint edges. Transparent faces retain hit targets.
- Locations remain transparent, including the selected location; only the selected physical package is opaque. Reserved destinations retain amber dashed edges; move-source context remains distinct.
- Migrated FloorMap (also used by the building view), StorageZoneVisualizer, StoragePlacementLayer, and pallet context rendering. Retained detailed selected-carton rendering and existing camera/interaction adapters.
- Extracted StorageZoneDraftPreview from StorageLayoutScreens. All neighboring zones show their actual maximum height. The edited zone's existing packages are included at persisted coordinates, independently of the dragged draft.
- Preserved occupied-edit protections, source/target holds, batch and stacking rules. No backend or weight-rule changes and no inventory mutations during browser inspection.

## Verification

- `pnpm check`: typecheck, lint, **67 test files / 704 tests passed**. Includes geometry, selection, move holds, occupied editing, packing and stacking regression coverage.
- Production build passed using isolated `.cache/shared-scene-build-20260908`; generated tsconfig include additions removed afterward.
- `git diff --check`: passed.
- Real authenticated DEMO-BLDG data: four zones and five stored units in zone A. Inspected Thai/English editor, 2D/3D switching, full-height neighboring zones, selected-package-only fill, keyboard selection, rotation, navigation and cancel.
- Editor keyboard movement changed draft X by 0.1m while stored package coordinates remained unchanged; occupied-edit protection appeared. Cancelled without saving.
- Responsive DOM check at 390 × 844: document width 390, dialog width 358, dialog top 16 / bottom 827.75, overflow auto. Browser viewport override restored.

## Evidence and limits

Evidence directory: `artifacts/shared-storage-scene-2026-09-08/`.

- `editor-3d-th.png`, `editor-2d-th.png`, `editor-3d-en.png`: real editor views.
- `occupied-edit-blocked.png`: protected occupied edit.
- `floor-p000005-selected.png`, `floor-location-only.png`: selection roles.
- `pallet-3d-en.png`, `pallet-2d-en.png`, `pallet-rotated-en.png`: physical package context.
- `ui-actions.mp4`: 42-second walkthrough assembled from 12 real browser captures, not a continuous screen recording. Frame manifest in actions.json.
- `check.log`, `build.log`, `video.log`: validation output.

Mobile screenshot capture under the browser viewport override rendered an inconsistent image despite correct DOM bounds; `editor-mobile-en.png` is diagnostic only and is not visual acceptance evidence. Desktop visual review is complete; mobile visual acceptance and light-theme manual review remain unverified. Automated interaction tests passed, but a native center click on overlapping 3D hit areas selected a foreground neighbor; exact keyboard selection was verified. This is a remaining usability consideration for dense scenes, not a change to stored coordinates.
