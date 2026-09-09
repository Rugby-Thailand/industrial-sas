# Shared storage scene: 3D outlines and rendering refactor

Status: implemented on 2026-09-08. See results.md for validation and remaining verification limits.
Worktree: industrial-sas-storage-planner, branch codex/storage-planner.

## Intended visual behavior

- Storage locations represent empty capacity, not physical packages. Show every location as a full 3D wireframe using its actual width, depth and maximum stacking height. Selected/edited location remains transparent but has a stronger blue outline and visible name/height. Do not invent shelf frames.
- Physical packages other than the currently selected package have transparent faces and status-colored edges. The selected physical package retains opaque carton faces and a clear identity label.
- In the location editor, no package is selected by default: all existing packages are wireframes, including packages inside the edited location.
- 2D uses matching footprints, roles and selection. 3D preserves all box edges (12 edges; deduplicate shared edges), with subdued rear edges if necessary for depth. Selected physical packages render on top for inspection without changing their real coordinates.
- Stored: solid outline; reserved/moving destination: dashed amber outline. Preserve source/target role and last-confirmed-position meanings. Selection is conveyed by line weight/label as well as color.
- Aisles/unavailable areas remain hatched floor regions, not fabricated full-height boxes. Floor grid is subdued; objects and real constraints stay visible.
- Invalid selected location/placement: error outline plus a specific reason; saving remains blocked by existing validation. No changes to coordinates, quantity, capacity or reservation rules just to improve the drawing.

## Current implementation findings

1. `src/features/finishedGoods/PalletScene.tsx`: local `paintBox`, camera projection, selected carton rendering and occupied-pallet rendering. Other packages already have transparent faces after the preceding change; it currently draws visible faces rather than a complete twelve-edge wireframe.
2. `src/features/storageLayouts/StorageLayoutScreens.tsx`: `StorageZoneDraftPreview` starts around line 2683; neighboring zones are drawn only as floor polygons around line 2974. Only the draft has height faces. The editor passes `zones={otherZones}`, so current-location placements are absent from its placement layer. Separate collision exclusions from visual context.
3. `src/components/storageLayouts/StorageZoneVisualizer.tsx`: has shared `StoragePlacementLayer` and `StorageViewModeToggle`, but placement faces still use independent fills. `StorageVisualArea` does not carry a zone height, while `StorageVisualSelection` does.
4. `src/components/storageLayouts/FloorMap.tsx`: `MapDrawing` owns another projection, box rendering, labels and picking implementation. It already consumes exact placement geometry and supports rotation.
5. `src/lib/storageLayouts/storagePlacementGeometry.ts`: reuse placement conversion and corner geometry, including local-to-floor offsets and explicit-vs-legacy coordinates. `isometricGeometry.ts` already provides projection helpers. Do not duplicate those calculations.

No existing graphify-out/graph.json was found. Findings above come from direct source inspection, not an inferred dependency graph.

## Shared module design

Create a small presentation module under `src/components/storageScene/` with pure geometry/style helpers under `src/lib/storageScene/` if needed. Final filenames may be adjusted during implementation.

- Normalized scene items: stable render ID, business ID, kind (`location` or `package`), x/y/z and width/depth/height in millimetres, visual role, status and accessible label. Use placement ID for rendered holds: one handling unit can legitimately have two reserved positions during a move.
- A shared visual policy resolves opaque selected package vs context wireframe, selected-location outline, status dash/color and invalid state. The screens pass intent, not per-face fill values.
- A shared `SceneBox` renders a cuboid/footprint through a supplied projection. It owns edges, face visibility and stroke sizing, retaining transparent hit areas where selection/dragging requires them. Full wireframe edges are independent of solid-face rendering; avoid double-strength seams.
- Keep camera adapters and each screen's pointer/keyboard business interactions initially. They have different coordinate origins, snapping and drag constraints; unify rendering first rather than forcing every workflow into one oversized scene module.
- Keep the carton's visual detailing in PalletScene as a selected-package renderer. Do not lose pallet base/carton appearance during extraction.
- Centralize legend swatches with the visual policy so outline status and legend cannot drift apart again.
- Do not use global CSS selectors targeting all SVG polygons; floors, QR images, selected packages and unavailable areas need different treatments.

## Staged implementation

### 1. Capture and geometry baseline
Record current pallet detail/move/storage, location editor, floor map and building map in 2D/3D. Note current selections, rotation and viewport. Add focused geometry fixtures with differing zone heights, floor offsets, rotated packages, elevated stacks and both relocation holds. Preserve dirty worktree changes.

### 2. Extract shared box rendering
Port the already-approved pallet context outlines first. Keep selected packages opaque. Validate all twelve edges, 2D footprints, rotation, stable strokes during zoom, source/target styles and selected-package visibility. Compare before/after positions, not only color snapshots.

### 3. Fix the location editor
Extract StorageZoneDraftPreview from the large screen file. Supply complete scene context plus the edited zone ID; exclude that ID only from self-collision checks. Pass actual maxStackHeightMm to neighboring location boxes and include the full vertical extents when fitting the view.

Include edited-location contents at their persisted coordinates. Do not make stored packages silently move with a dragged draft; saved inventory positions remain authoritative and existing repositioning constraints still determine whether a change is allowed. Preserve stable QR/location identity, form fields, keyboard 0.1m steps, pointer capture and validation.

### 4. Migrate remaining renderers
Use the shared rendering policy in StoragePlacementLayer, StorageZoneVisualizer and FloorMap, including the building map that reuses FloorMap. In an overview with no package selected, all packages remain outlined; selecting a package fills that package only. Selecting a location strengthens its outline without making every package inside opaque. Keep search, labels, quick edit, QR and move links functional.

Remove superseded face/edge/style code after each migration. Keep structural building slab rendering separate: this change concerns storage locations and packages, not replacing the building model with a package renderer.

### 5. Test and review
- Unit tests: projection/12 unique edges, exact x/y/z and dimensions, floor offsets applied once, rotations, selection roles, reserved/move styling and invalid states.
- Integration/component tests: other-location heights shown, edited-location contents present, self-collision exclusion preserved, protected occupied location edits rejected, both move holds retained, selecting one package leaves others transparent.
- Interaction: pointer and keyboard drag, full-face hit targets despite transparent fill, rotation, zoom, fit, 2D/3D switch, search, clear selection, dialogs, refresh and cancel without writes.
- Visual fixtures: empty floor, crowded floor, narrow aisles, tall boxes behind/over the selected package, stacked packages, long labels, unsupported/invalid placement and reserved/source/target positions.
- Desktop/mobile, Thai/English, light/dark; readable labels and essential outlines. No reliance on opacity to indicate availability or disabled interaction.
- Run typecheck, lint, relevant tests at each migration; full tests and production build at the end. Keep app on port 3100. Save actual screenshots/video and honest test results.

## Completion criteria

The same actual location/package has matching dimensions, position, visual role and status in every operational view. All neighboring locations show actual 3D height instead of flat tiles. Only a selected physical package is opaque; locations are wireframes even when selected. The location editor shows existing contents without moving inventory or hiding conflicts. Rendering rules and cuboid edges are maintained once, and current packing, stacking, movement and reservation tests still pass. No weight-rule or backend scope expansion.
