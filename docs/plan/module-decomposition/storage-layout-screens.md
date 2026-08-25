# Storage-layout screens decomposition

Status: **Candidate 1 — proposed**
Source: [`StorageLayoutScreens.tsx`](../../../src/features/storageLayouts/StorageLayoutScreens.tsx)

## Current module and interface

The source mixes catalogue search, building creation/settings, isometric
visualization, floor editing, reserved blocks, zone drafting, and review in one
client file. It exports twelve React functions, but application routes use only
five route-level screens:

- `StorageBuildingCatalogue`
- `NewStorageBuildingForm`
- `StorageBuildingEditor`
- `StorageFloorEditor`
- `StorageBuildingReview`

The other exports primarily exist because the current component test imports
implementation pieces directly. That is a sign that the test surface is wider
than the route interface.

## Target seam

Make each route-level workflow a module with one screen interface. Share only the
isometric visualization used by both editor and review. Keep floor drawing,
reserved-block editing, and zone drafting internal to the floor-editor module.

Proposed shape:

```text
src/features/storageLayouts/
  catalogue/StorageBuildingCatalogue.tsx
  create/NewStorageBuildingForm.tsx
  building/StorageBuildingEditor.tsx
  building/BuildingVisualization.tsx
  floor/StorageFloorEditor.tsx
  floor/FloorPlan.tsx
  floor/ReservedBlocks.tsx
  floor/StorageZones.tsx
  review/StorageBuildingReview.tsx
  editorState.ts
```

Route files import the five route-level interfaces directly. Internal files export
only within the feature cluster; no catch-all barrel is required.

## Dependency category

The UI is in-process. Convex hooks are existing runtime dependencies, not a reason
to invent a new adapter. The pure geometry and `editorState` modules already form
useful seams and retain their direct tests.

## Small-commit sequence

1. Add route-level characterization tests for catalogue, create, building editor,
   floor editor, and review outcomes.
2. Extract shared status/unit presentation helpers only where two route modules
   use them; keep single-use helpers local.
3. Move `BuildingVisualization` and its two-caller interface with no markup change.
4. Move the floor workflow as one module; keep plan drawing, reserved blocks, and
   zone drafting private inside that implementation.
5. Move catalogue/create/building/review modules one at a time and update their
   route imports in the same commit.
6. Replace tests that import accidental internals with route-interface tests or
   focused tests of a genuine shared visualization/pure module.
7. Delete `StorageLayoutScreens.tsx` only after it has no route or test callers.

## Verification

- Existing storage-layout integration, component, and editor-state tests.
- Native-select and accessibility guards.
- Thai/English catalogue parity and route rendering.
- Production build of every storage-layout route.
- Credential-free E2E routing and authenticated staging smoke after the lane exists.

## Stop conditions

- Do not create one file per React function.
- Do not add a generic form/drawing interface used by only one workflow.
- Do not move JSX while also changing layout, copy, behavior, or visual design.
- Stop when each route workflow is local and shared visualization/geometry has a
  genuine second caller.

## Project benefit

Changes to one storage-layout journey become local to that journey, route callers
learn only one screen interface, and tests stop depending on incidental JSX
structure. Review size and merge conflicts fall without redesigning the feature.
