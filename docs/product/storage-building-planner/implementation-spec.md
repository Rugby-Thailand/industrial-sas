# Storage Building Planner — Approved Design Requirements and Implementation Specification

Status: Implemented and verified
Approved design set: 2026-08-21
Product area: Warehouse-scoped master data
Related requirements: [Product Requirements](./requirements.md)

## 1. Decision summary

Implement the approved five-page Storage Building Planner flow as a desktop-first master-data feature. The feature lets an authorized warehouse administrator describe one or more buildings, change building width, depth, floor height, and floor count, override the footprint of individual floors, and mark simple rectangular areas as unavailable.

The implementation will use an accessible SVG isometric renderer rather than Three.js or another WebGL dependency. The approved images require stacked rectangular floor plates, selection, dimension guides, exploded floors, zoom, pan, and discrete rotation; all of those can be implemented with deterministic SVG geometry. This keeps `three` absent from the dependency graph, preserves the current bundle and accessibility constraints, and avoids introducing a renderer seam before a second adapter exists.

ADR-0011 and project-plan decisions B-08/D-28 must be amended before application implementation. The amendment should approve an isometric planning visualization while retaining the prohibition on Three.js and live 3D occupancy for this release.

## 2. Approved design references

The local PNG is the implementation reference. The public link is for browser review. Where a generated image and this document disagree, this document is authoritative for behavior, data, accessibility, and calculations.

| Page                     | Route                                                            | Local design reference                                                     | Public preview                                                                             |
| ------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Storage layouts overview | `/master-data/storage-layouts`                                   | [01-storage-layouts-overview.png](./pages/01-storage-layouts-overview.png) | [Open image](https://xmg3wzgzff.ufs.sh/f/uUcqkd0R76kDltbc1SDdP0ghkClqt1SLazZvJyB7AYnWMR43) |
| New building setup       | `/master-data/storage-layouts/new`                               | [02-new-building-setup.png](./pages/02-new-building-setup.png)             | [Open image](https://xmg3wzgzff.ufs.sh/f/uUcqkd0R76kDjauHteUFMJmvu67Q2V0ELofsHi4UAKeBqdOz) |
| 3D building editor       | `/master-data/storage-layouts/[buildingId]`                      | [03-building-editor.png](./pages/03-building-editor.png)                   | [Open image](https://xmg3wzgzff.ufs.sh/f/uUcqkd0R76kDnYCIgNXYe18uAD2aycxiIVBqUX7QkZvlpOgt) |
| Floor-space editor       | `/master-data/storage-layouts/[buildingId]/floors/[floorNumber]` | [04-floor-space-editor.png](./pages/04-floor-space-editor.png)             | [Open image](https://xmg3wzgzff.ufs.sh/f/uUcqkd0R76kDlrXP4mDdP0ghkClqt1SLazZvJyB7AYnWMR43) |
| Review and activate      | `/master-data/storage-layouts/[buildingId]/review`               | [05-review-activate.png](./pages/05-review-activate.png)                   | [Open image](https://xmg3wzgzff.ufs.sh/f/uUcqkd0R76kD9FfxtqEXbGfTnpi4DaE5WyNBkJxPKocz8el0) |

The [exploded floor selector](./concepts/02-exploded-floor-selector.png) is a mode inside the building editor, not a separate route.

## 3. Product requirements

### 3.1 Users and scope

- Primary users are organization administrators and warehouse managers.
- Every read and write is scoped to the warehouse selected in the existing workspace shell.
- The client never silently selects the first warehouse.
- A building belongs to exactly one warehouse, and its `warehouseId` never changes.
- Multiple buildings per warehouse are supported from the first release.
- Storage layouts are planning master data. They do not move stock, rewrite inventory locations, or become ledger bucket identity.

### 3.2 Measurement model

- Users enter and see metric values in metres and square metres.
- Lengths are persisted as positive integer millimetres.
- Areas are calculated and persisted as non-negative integer square millimetres where a stored projection is required.
- Width and depth have a technical range of 100 mm through 10,000,000 mm; floor height has a range of 100 mm through 100,000 mm. Customer-specific limits may be narrower.
- Building width and depth define the maximum envelope.
- Default floor-to-floor height is editable; total building height is derived from floor heights.
- Floor count is an integer from 1 through 50.
- User input supports at most three decimal places so every displayed metre value converts exactly to millimetres.

### 3.3 Floor model

- New floors inherit building width, depth, and default height.
- A floor may disable footprint inheritance and set a smaller width or depth.
- A floor footprint may not exceed the building envelope.
- A floor may override its height.
- A floor has a stable positive `floorNumber` unique inside its building.
- Increasing floor count appends inherited floors.
- Decreasing floor count removes only the highest floor numbers after a confirmation that lists affected floors.
- A floor with saved overrides or reserved blocks is never removed silently.

### 3.4 Reserved-space model

- A floor may contain up to 20 axis-aligned rectangular reserved blocks.
- Each reserved block has a label, X/Y origin, width, and depth in millimetres.
- A block must fit completely inside its floor footprint.
- Reserved blocks may not overlap. Rejecting overlap keeps usable-area calculation exact and understandable.
- Gross area equals floor width multiplied by floor depth.
- Reserved area equals the sum of reserved-block areas.
- Usable area equals gross area minus reserved area.
- Free-form polygons, rotated rectangles, columns, room walls, doors, stairs, and structural design remain out of scope.

### 3.5 Lifecycle

- A building starts in `DRAFT`.
- Drafts may be edited and saved repeatedly.
- `ACTIVE` means the layout passed validation and is the current approved planning representation.
- Activation does not affect locations or stock and does not require maker-checker in this release.
- An active layout may return to draft when edited; the application must label unsaved or draft changes clearly.
- `ARCHIVED` buildings remain readable and auditable but cannot be edited until restored.
- Hard deletion is not exposed.

### 3.6 Concurrency and retry

- Building and floor records carry monotonic versions.
- Every update submits the version the editor loaded.
- A stale version returns a named conflict; it never overwrites another editor.
- Every mutation carries a client-minted request ID and uses the existing idempotency implementation.
- A network retry reuses the same request ID until the server returns a terminal result.

## 4. Page requirements

### 4.1 Page 1 — Storage layouts overview

Design: [overview image](./pages/01-storage-layouts-overview.png)

- Show only buildings in the selected warehouse.
- Provide search by normalized code or display name.
- Filter by `DRAFT`, `ACTIVE`, and `ARCHIVED`.
- Return a bounded, cursor-paged list ordered by code.
- Cards summarize the first three results at desktop width; the semantic table is the complete data surface.
- Display code, name, dimensions, floor count, usable area, status, and last update time.
- `New building` opens Page 2.
- `Open layout` opens Page 3.
- If the selected warehouse changes, discard list cursors and reload from the first page.
- On narrow desktop/tablet layouts, cards become a horizontal/stacked list and the table uses the existing horizontal-scroll affordance.

### 4.2 Page 2 — New building setup

Design: [new-building image](./pages/02-new-building-setup.png)

- Step 1 collects code, name, width, depth, default floor height, and floor count.
- Step 2 shows the generated floor defaults and allows names and inheritance settings to be reviewed.
- Step 3 shows calculated footprint, total height, gross area, and floor count.
- The live isometric preview updates from local form state and performs no server write.
- `Create draft` performs one mutation that creates the building and initial floor rows atomically.
- Duplicate building code within the warehouse blames the code field without exposing another tenant's values.
- Successful creation navigates to Page 3 using the returned building ID.

### 4.3 Page 3 — 3D building editor

Design: [building-editor image](./pages/03-building-editor.png)

- Show the building as stacked SVG floor plates with relative width, depth, and vertical spacing.
- Select a floor from either its rendered plate or the labelled floor list.
- Provide normal and exploded modes. Exploded mode follows the [approved interaction reference](./concepts/02-exploded-floor-selector.png).
- Provide fit, reset, zoom in/out, pan, and 90-degree rotate controls.
- Pointer gestures are enhancements; every view action has a button and keyboard equivalent.
- Building-level edits include name, width, depth, default floor height, and floor count.
- A global dimension change updates only inheriting floors.
- Shrinking the envelope below an override blocks save and names each conflicting floor.
- The editor maintains local undo/redo history since the last successful save.
- Navigating away with local changes presents a persistent confirmation.
- Saving updates the building aggregate summary transactionally.

### 4.4 Page 4 — Floor-space editor

Design: [floor-editor image](./pages/04-floor-space-editor.png)

- Show a top-down SVG floor plate on a metre grid inside the dashed maximum building envelope.
- Allow footprint inheritance, width, depth, height, name, and note to be edited.
- Allow reserved blocks to be added, labelled, moved, resized, and removed.
- Numeric fields are the authoritative edit interface; pointer drag/resize updates those same fields.
- Reserved blocks use a hatch plus a text label, never color alone.
- Display gross, reserved, usable, and available percentage values calculated from the current local draft.
- Repeat the calculation in a semantic table outside the SVG.
- `Apply floor changes` saves one floor and its reserved blocks atomically.
- `Revert floor` restores the last server-confirmed state.

### 4.5 Page 5 — Review and activate

Design: [review image](./pages/05-review-activate.png)

- Re-read the current server version rather than trusting editor-only state.
- Validate all building, floor, reserved-block, numbering, and summary invariants.
- Show the building preview, validation checklist, building totals, and complete floor table.
- Any failure links back to the exact floor or building field that must change.
- `Save as draft` leaves lifecycle status unchanged.
- `Activate layout` performs server-side validation again in the activation mutation.
- Show the persistent warning: activation does not change inventory locations or stock.

## 5. Domain model

### 5.1 `storageBuildings`

| Field                  | Type and rule                                            |
| ---------------------- | -------------------------------------------------------- |
| `orgId`                | Tenant discriminator added with `tenantFields`.          |
| `warehouseId`          | Required immutable warehouse reference.                  |
| `code`                 | Normalized string; unique within `(orgId, warehouseId)`. |
| `name`                 | Required Unicode display name.                           |
| `widthMm`              | Positive safe integer.                                   |
| `depthMm`              | Positive safe integer.                                   |
| `defaultFloorHeightMm` | Positive safe integer.                                   |
| `floorCount`           | Integer 1–50, consistent with floor rows.                |
| `totalHeightMm`        | Transactionally maintained derived summary.              |
| `grossAreaSqMm`        | Transactionally maintained building total.               |
| `reservedAreaSqMm`     | Transactionally maintained building total.               |
| `usableAreaSqMm`       | Transactionally maintained building total.               |
| `status`               | `DRAFT`, `ACTIVE`, or `ARCHIVED`.                        |
| `version`              | Positive monotonic integer.                              |
| `updatedAt`            | Server timestamp in milliseconds.                        |

Indexes:

- `by_orgId_warehouseId_code`
- `by_orgId_warehouseId_status_code`
- uniqueness contract on `(orgId, warehouseId, code)`

### 5.2 `storageFloors`

| Field               | Type and rule                                            |
| ------------------- | -------------------------------------------------------- |
| `orgId`             | Tenant discriminator.                                    |
| `warehouseId`       | Duplicated warehouse scope for bounded reads.            |
| `buildingId`        | Required parent.                                         |
| `floorNumber`       | Positive integer unique within the building.             |
| `name`              | Optional Unicode display label.                          |
| `inheritsFootprint` | Boolean.                                                 |
| `widthMm`           | Optional; required exactly when footprint is overridden. |
| `depthMm`           | Optional; required exactly when footprint is overridden. |
| `heightMm`          | Optional override; building default when absent.         |
| `note`              | Optional bounded text.                                   |
| `grossAreaSqMm`     | Transactionally maintained floor summary.                |
| `reservedAreaSqMm`  | Transactionally maintained floor summary.                |
| `usableAreaSqMm`    | Transactionally maintained floor summary.                |
| `version`           | Positive monotonic integer.                              |

Indexes:

- `by_orgId_buildingId_floorNumber`
- `by_orgId_warehouseId_buildingId_floorNumber`
- uniqueness contract on `(orgId, buildingId, floorNumber)`

### 5.3 `storageFloorReservedBlocks`

| Field                | Type and rule                                     |
| -------------------- | ------------------------------------------------- |
| `orgId`              | Tenant discriminator.                             |
| `warehouseId`        | Duplicated warehouse scope.                       |
| `buildingId`         | Required building reference.                      |
| `floorId`            | Required floor reference.                         |
| `label`              | Required bounded display label.                   |
| `xMm`, `yMm`         | Non-negative safe integers from the floor origin. |
| `widthMm`, `depthMm` | Positive safe integers.                           |

Index:

- `by_orgId_floorId`

All three tables must be added to `TENANT_TABLES`; every index begins with `orgId`. Schema-policy, uniqueness-contract, lookup-contract, and isolation tests must be updated in the same change.

## 6. Module design and seams

The implementation will use deep modules with small interfaces. Internal calculation details stay behind those interfaces; callers and tests use the same seams.

### 6.1 Pure domain module

Location: `convex/model/storageLayout/storageLayout.ts`

Interface:

```ts
validateAndSummarizeStorageLayout(
  draft: StorageLayoutDraft,
): Result<ValidatedStorageLayout, StorageLayoutError>
```

This one operation owns measurement validation, inheritance resolution, floor ordering, reserved-block bounds and overlap, total-height calculation, floor/building area summaries, lifecycle validation, and immutable output. This concentrates the core complexity in one test surface.

### 6.2 Editor-state module

Location: `src/features/storageLayouts/editorState.ts`

Interface:

```ts
reduceStorageLayoutEditor(
  state: StorageLayoutEditorState,
  command: StorageLayoutEditorCommand,
): StorageLayoutEditorState
```

The reducer owns local drafts, selected floor, view mode, undo/redo, dirty state, inheritance propagation, conflict markers, and restoration after save. React pages render the returned state and dispatch commands; they do not duplicate editor rules.

### 6.3 SVG geometry module

Locations:

- `src/lib/storageLayouts/isometricGeometry.ts`
- `src/features/storageLayouts/StorageBuildingScene.tsx`
- `src/features/storageLayouts/FloorPlanScene.tsx`

Interfaces:

```ts
projectStorageBuilding(
  layout: ResolvedStorageLayout,
  view: IsometricView,
): StorageBuildingScene

projectFloorPlan(
  floor: ResolvedStorageFloor,
  view: FloorPlanView,
): FloorPlanScene
```

The projection functions are pure and return polygons, guides, labels, and hit regions. React only turns the scene into SVG elements and dispatches selection/view commands. There is no generic renderer port in this release: one SVG implementation means a renderer seam would be hypothetical. If a real WebGL adapter is later approved, introduce the seam then.

### 6.4 Convex storage-layout modules

Locations:

- `convex/storageLayouts/catalogue.ts` — bounded reads only.
- `convex/storageLayouts/writes.ts` — idempotent audited mutations only.
- `convex/lib/storageLayoutStore.ts` — tenant-bound persistence implementation and transactional summary maintenance.
- `src/lib/convex/storageLayoutApi.ts` — typed client function references and wire types.

Do not add these functions to `convex/masterData/catalogue.ts` or `convex/masterData/writes.ts`. Those modules already own another entity family; a dedicated slice keeps layout invariants local and prevents a broad shallow interface.

The storage implementation uses existing `TenantDocumentAccess`, `queryWithOrg`, `mutationWithOrg`, and idempotency/audit machinery directly. No additional storage port is introduced because there is only one production adapter and the existing test fixture already substitutes tenant storage.

## 7. Server function interface

All functions declare code-owned warehouse-scoped permissions and provide `warehouseId: ({ warehouseId }) => warehouseId` so membership scope is revalidated before the handler runs.

Reads:

- `storageLayouts/catalogue:listStorageBuildings`
- `storageLayouts/catalogue:getStorageBuilding`
- `storageLayouts/catalogue:getStorageFloor`
- `storageLayouts/catalogue:getStorageBuildingReview`

Mutations:

- `storageLayouts/writes:createStorageBuilding`
- `storageLayouts/writes:updateStorageBuilding`
- `storageLayouts/writes:changeStorageFloorCount`
- `storageLayouts/writes:saveStorageFloor`
- `storageLayouts/writes:activateStorageBuilding`
- `storageLayouts/writes:archiveStorageBuilding`

`createStorageBuilding` creates the building and initial floors atomically. `saveStorageFloor` replaces that floor's bounded reserved-block set and updates floor/building summaries in the same transaction. `activateStorageBuilding` re-reads and validates the complete aggregate before changing status.

## 8. Authorization and audit

Add these code-owned `WAREHOUSE` permissions:

- `masterData.storageLayout.read`
- `masterData.storageLayout.manage`
- `masterData.storageLayout.activate`

Recommended default-role mapping:

- Organization administrator: all three.
- Warehouse manager: all three for assigned warehouses.
- Inventory controller: read only.
- Operator roles: none by default.

Every mutation declares an audit target in one of the new tenant tables. Mutation audit and domain audit must record request ID, actor, warehouse, operation, target ID, changed scalar field names, prior version, resulting version, and lifecycle transition. Notes and labels must not be copied to telemetry.

## 9. Routes, navigation, and localization

Add `ROUTES.storageLayouts` and helper functions for building, floor, and review paths in `src/lib/navigation.ts`. Add `Storage layouts` next to `Locations` under Master data and map it to a building/layers icon in `DesktopShell`.

Add English and Thai namespaces:

- `StorageLayout`
- `StorageLayoutStatus`
- `StorageLayoutError`

Add a nested route-message layout for the storage-layout subtree so the large editor vocabulary is not shipped to every master-data page. Let `src/i18n/clientMessages.test.ts` report the exact shared namespace set reached by the new client import graph; do not guess or widen `SHELL_NAMESPACES`.

Thai is the layout baseline. Test real Thai strings at 768 px and 1280 px. Codes remain monospaced and untranslated; status values use closed-set translations.

## 10. Visual implementation rules

- Use existing semantic Tailwind tokens only; do not copy literal colors from the PNGs into components.
- Use `PageHeader`, `Notice`, `StatusBadge`, `Button`, `SelectControl`, `TableScroller`, and existing form primitives where their interfaces fit.
- Keep one `<h1>` per page and ordered `<h2>` sections.
- Use flat borders and restrained elevation consistent with the current application.
- Use the images for composition and hierarchy, not for invented navigation or authorization behavior.
- The SVG is supplementary and `aria-hidden`. A sibling live text summary announces building, floor count, selected floor, and usable area.
- Every visual status has an icon, outline, hatch, or text label in addition to color.
- Controls remain at least 48 × 48 CSS pixels.
- Honor `prefers-reduced-motion`; exploded floors and camera changes become immediate.

## 11. Performance requirements

- Route-level code splitting keeps the editor and SVG geometry out of unrelated routes and handheld bundles.
- The overview reads no more than the existing bounded page maximum.
- A building detail read is bounded at 50 floors; a floor detail read is bounded at 20 reserved blocks.
- The building editor performs no ledger or live occupancy read.
- Projecting and rendering 50 floors must remain responsive on a normal business laptop; the verification target is under 16 ms for a pure projection and under 100 ms for a full React update in the test environment.
- SVG element count is bounded. Hidden floor details are not rendered in the main isometric scene.

## 12. Verification plan

### Pure/domain tests

- Unit tests for measurement parsing, inheritance, total height, gross/reserved/usable calculations, lifecycle transitions, and version conflicts.
- Property tests for arbitrary valid floor stacks and non-overlapping reserved rectangles.
- Guard tests proving invalid dimensions, overlap, out-of-bounds blocks, duplicate floors, unsafe integers, and summary drift are rejected.

### Integration tests

- Schema classification, `orgId`-first indexes, uniqueness contracts, and bounded lookups.
- Create/update/floor-count/save-floor/activate/archive happy paths.
- Idempotent replay and mismatched-fingerprint refusal.
- Permission enforcement and audit outcomes.
- Typed client function-path drift.

### Isolation tests

- Cross-tenant building, floor, reserved-block, and warehouse IDs are indistinguishable from missing IDs.
- Warehouse membership scope is enforced on every read and write.
- Same building code may exist in different tenants or warehouses without collision.

### UI and accessibility tests

- Reducer tests for undo/redo, inheritance propagation, dirty state, and save reconciliation.
- English and Thai page/component tests.
- `jest-axe` checks for every page and both editor scenes.
- Keyboard tests for floor selection, view controls, form editing, dialogs, and activation.
- Navigation tests prove every static link resolves and dynamic helpers encode IDs.

### End-to-end and visual tests

- Create a four-floor building, override Floor 3, add a Utilities block, save, review, activate, reload, and verify exact totals.
- Change warehouse and prove the former warehouse's layouts disappear.
- Simulate a stale version and verify no overwrite.
- Capture 1280 px and 768 px English/Thai screenshots for the five approved pages.

## 13. Delivery sequence

1. Add ADR-0014 approving the SVG isometric planning visualization and retaining the Three.js prohibition.
2. Add the pure domain module and its unit/property tests.
3. Add validators, schema tables, schema policy, indexes, uniqueness contracts, and isolation guards.
4. Add permissions, default-role mappings, Convex read/write modules, audit/idempotency behavior, and integration tests.
5. Add typed client references, routes, navigation helpers, and English/Thai messages.
6. Build Page 1 and Page 2 with the static SVG preview.
7. Build the editor-state and SVG geometry modules, then Page 3 and exploded mode.
8. Build Page 4 reserved-block editing and accessible summary table.
9. Build Page 5 server-backed review and activation.
10. Run formatting, lint, typecheck, unit/property/integration/isolation/a11y tests, build, and targeted E2E/visual checks.

Each step should be a reviewable commit that leaves existing inventory and location behavior unchanged.

## 14. Definition of done

- All five pages match the approved design hierarchy and use repository semantic tokens.
- Every functional and acceptance requirement in this document is implemented.
- Building/floor/reserved-block data is tenant- and warehouse-confined.
- All mutations are authorized, idempotent, audited, and conflict-safe.
- Area and height calculations are exact and consistent after save/reload.
- The complete workflow is usable without interacting with SVG.
- Thai and English pass accessibility and responsive checks.
- Three.js remains absent from dependencies and generated bundles.
- The new ADR, schema policy, permissions documentation, user manual, and release-gate coverage are updated.
