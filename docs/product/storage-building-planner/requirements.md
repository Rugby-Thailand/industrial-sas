# Storage Building Planner — Product Requirements

Status: Implemented and verified
Scope: Desktop-first, warehouse-scoped master data
Goal: Let an authorized user create a simple 3D representation of a storage building, change its dimensions and floor count, and give each floor a different usable footprint.

Implementation details, module seams, tests, and the definition of done are in the [Implementation Specification](./implementation-spec.md).

## 1. Product decision and architecture gate

The five-page design direction is approved. The current project plan still explicitly defers three-dimensional warehouse visualization (`B-08`, `D-28`, and ADR-0011), so implementation must begin by adding ADR-0014. That ADR will approve this isometric planning view while retaining the prohibition on Three.js and live 3D occupancy in this release.

The approved design set is documented in [Complete Page Flow](./pages/README.md):

- [Storage layouts overview](./pages/01-storage-layouts-overview.png)
- [New building setup](./pages/02-new-building-setup.png)
- [3D building editor](./pages/03-building-editor.png)
- [Floor-space editor](./pages/04-floor-space-editor.png)
- [Review and activate](./pages/05-review-activate.png)

## 2. User and job

Primary user: warehouse administrator, facility planner, or operations manager.

Job to be done: “For the warehouse I am currently managing, let me describe the building’s basic shape and floors so the team can understand how much space each floor offers.”

This is planning master data, not the source of truth for inventory balances. Existing `locations` remain the scannable ledger identity. A future release may link locations or zones to a floor.

## 3. MVP scope

### 3.1 Building

An authorized user can:

- Create one or more buildings within the selected warehouse.
- Set a unique building code and a display name.
- Set maximum building width and depth in metres.
- Set a default floor-to-floor height in metres.
- Increase or decrease the number of floors with an integer stepper.
- See calculated total height and gross footprint area.
- Rotate, pan, zoom, reset, and fit the 3D preview.
- Select a floor directly from the model or from an accessible floor list.
- Save changes with server-side authorization, idempotency, audit evidence, and optimistic version checking.

Width, depth, and floor height are stored as positive integer millimetres and displayed in metres. Total height is derived from the sum of floor heights; it is not an independently editable source of truth.

### 3.2 Per-floor space

Each floor has:

- Floor number and optional name.
- Inherit-building-footprint switch, enabled by default.
- Floor width and depth overrides when inheritance is disabled.
- Floor height override when the default height is unsuitable.
- Up to 20 labelled, axis-aligned rectangular reserved blocks.
- Calculated gross area and usable area.
- A short note explaining an exception, such as offices, utilities, or a setback.

MVP usable area is:

`floor width × floor depth − sum of non-overlapping reserved-block areas`

The 3D model shows each floor plate at its real relative width, depth, and height. A smaller upper floor therefore appears as a setback. Reserved blocks are drawn in the top-down floor editor with a hatch and text label. Complex polygons, rotated blocks, columns, rooms, aisles, and arbitrary holes are later work.

### 3.3 Floor-count behavior

- Increasing the count appends floors using the building defaults.
- Decreasing the count shows exactly which upper floors will be removed.
- Removal requires confirmation when any removed floor has overrides, notes, or linked records.
- The application never silently renumbers a persisted floor that has linked records.

### 3.4 Editing behavior

- Global dimension changes update only floors that still inherit the corresponding value.
- If a building is shrunk below an overridden floor footprint, saving is blocked and the conflicting floors are named.
- Numeric inputs and direct-manipulation handles represent the same values; either interaction updates the other.
- Undo and redo cover changes made since the last save.
- Unsaved changes are clearly indicated before navigation.

## 4. Information architecture

Recommended route: `/master-data/storage-layouts`.

Recommended navigation label: `Storage layouts`, next to `Locations` under Master data.

The route is warehouse-scoped and must use the warehouse selected in the existing shell. It must never default silently to the first warehouse.

Screen structure:

1. Page header and selected-warehouse context.
2. Building switcher and actions (`New building`, `Duplicate`, `Archive`).
3. Main editor: floor navigator, 3D preview, and property inspector.
4. Accessible floor table containing the same dimensions and usable-space values.
5. Save status, validation summary, and audit metadata.

The full editor is desktop/tablet-first. Handheld devices get a read-only building and floor summary; geometry editing is not an operator task.

## 5. Proposed domain model

### `storageBuildings`

| Field                  | Rule                                                                  |
| ---------------------- | --------------------------------------------------------------------- |
| `orgId`                | First tenant discriminator, matching project convention.              |
| `warehouseId`          | Required and immutable; revalidated against membership on every call. |
| `code`                 | Normalized, unique within the warehouse.                              |
| `name`                 | Required display name.                                                |
| `widthMm`              | Positive integer; maximum envelope width.                             |
| `depthMm`              | Positive integer; maximum envelope depth.                             |
| `defaultFloorHeightMm` | Positive integer.                                                     |
| `floorCount`           | Derived/validated against floor rows.                                 |
| `status`               | `DRAFT`, `ACTIVE`, or `ARCHIVED`.                                     |
| `version`              | Monotonic optimistic-concurrency version.                             |

### `storageFloors`

| Field                | Rule                                                                          |
| -------------------- | ----------------------------------------------------------------------------- |
| `orgId`              | First tenant discriminator.                                                   |
| `warehouseId`        | Duplicated scope key for bounded warehouse reads.                             |
| `buildingId`         | Required parent.                                                              |
| `floorNumber`        | Positive integer, unique within the building.                                 |
| `name`               | Optional display label.                                                       |
| `inheritsFootprint`  | Controls whether building dimensions are used.                                |
| `widthMm`, `depthMm` | Required override values when footprint is not inherited.                     |
| `heightMm`           | Optional override; otherwise building default.                                |
| `reservedAreaSqMm`   | Transactionally maintained summary of reserved-block area.                    |
| `note`               | Optional short explanation; must not contain sensitive payloads in telemetry. |

### `storageFloorReservedBlocks`

| Field                   | Rule                                                  |
| ----------------------- | ----------------------------------------------------- |
| `orgId`                 | First tenant discriminator.                           |
| `warehouseId`           | Duplicated warehouse scope for bounded reads.         |
| `buildingId`, `floorId` | Required parent references.                           |
| `label`                 | Required bounded display label.                       |
| `xMm`, `yMm`            | Non-negative origin inside the floor.                 |
| `widthMm`, `depthMm`    | Positive dimensions; block must fit inside the floor. |

Suggested indexes start with `orgId` and support bounded reads by warehouse/building, ordered floor number, and floor blocks. A future release may add an optional `locationId` link. It is deliberately outside this MVP so building geometry cannot accidentally redefine current inventory identity.

## 6. Validation rules

- Width, depth, and height must be finite positive values after conversion to millimetres.
- Floor count must be an integer from 1 to an agreed product limit; use 50 as the planning default until a customer envelope is confirmed.
- Floor footprint may not exceed the building envelope.
- Reserved blocks must fit inside the floor, may not overlap, and may not exceed 20 per floor.
- Reserved area may not exceed gross floor area.
- Duplicate floor numbers are rejected transactionally.
- Building code is unique within `(orgId, warehouseId)`.
- Cross-tenant and unauthorized warehouse IDs return the same not-found/refusal shape used elsewhere in the app.
- Save rejects stale versions and asks the user to reload or reconcile; it never overwrites another editor silently.

## 7. Accessibility and localization

- The 3D canvas is supplementary. Every value and action is available through labelled inputs and a semantic floor table.
- Selection, validation, and usable-space state are never communicated by color alone.
- Keyboard users can select floors, change stepper values, save, undo, reset view, and move between editor regions.
- A “reduce motion” preference disables animated floor expansion and camera transitions.
- Touch targets remain at least 48 × 48 CSS pixels.
- Thai is the layout baseline, with English fallback and unit abbreviations that remain readable in both locales.
- The preview exposes a concise text summary, for example: “Building A, 4 floors, Floor 3 selected, 620 m² usable.”

## 8. Performance and resilience

- Initial editor interaction should be responsive at 50 floors on a normal business laptop.
- 3D code is route-level lazy loaded and excluded from handheld routes.
- The preview degrades to the accessible table and a static isometric outline if WebGL is unavailable.
- No editor read scans ledger lines or derives live inventory occupancy.
- Draft changes stay local until explicit save; failed saves preserve the draft and show a request ID.

## 9. Permissions and audit

Proposed warehouse-scoped permissions:

- `masterData.storageLayout.read`
- `masterData.storageLayout.manage`
- `masterData.storageLayout.activate`

Audit events record building/floor identifiers, changed field names, previous and new scalar values, actor, warehouse, request ID, and timestamp. Notes are not copied into telemetry.

## 10. Acceptance criteria

1. With a warehouse selected, an authorized user can create a building with width, depth, default floor height, and one or more floors.
2. Increasing floor count adds visible floor plates using inherited defaults.
3. Changing building width or depth updates every inheriting floor and leaves explicit overrides unchanged.
4. A floor can be narrower or shallower than the building envelope and the 3D preview shows the difference.
5. Each floor displays gross, reserved, and usable area, and calculations remain exact after save/reload.
6. Invalid dimensions, excessive reserved area, conflicting overrides, and stale versions block save with actionable messages.
7. Every canvas interaction has a keyboard/input/table equivalent.
8. English and Thai layouts pass at 768 px and 1280 px widths; handheld presents a read-only summary.
9. Another tenant’s building or another unauthorized warehouse’s building cannot be discovered by ID.
10. Saving is idempotent, audited, and safe to retry.

## 11. Explicit non-goals for the first release

- Live inventory occupancy inside the 3D model.
- Rack/bin modelling, slotting optimization, travel-path routing, or automated putaway decisions.
- CAD/BIM import or export.
- Free-form polygon drawing, room design, doors, windows, stairs, elevators, or structural engineering.
- Physics, collision detection, photorealistic rendering, or digital-twin sensor feeds.
- Multi-user live cursors or simultaneous collaborative editing.
- Editing on scanner-sized handheld devices.

## 12. Delivery sequence

1. Decision gate: add ADR-0014 approving SVG isometric planning while retaining the Three.js prohibition.
2. Prototype spike: prove the SVG projection, keyboard fallback, 50-floor performance, and route-level bundle cost.
3. Domain slice: add tenant-safe building/floor validators, tables, functions, permissions, audits, and property/integration tests.
4. Editor slice: building switcher, input/table editor, save/conflict behavior, localization, and accessibility tests.
5. Visual slice: add the selected 3D renderer as a progressive enhancement over the complete table/input workflow.
6. Pilot validation: test with representative buildings and confirm whether rectangular floor plates are sufficient before adding zones or location links.

## 13. Deferred product decisions

- Who is the named customer/user making 3D a committed requirement?
- What is the real maximum floor count and dimension envelope?
- When should floors link to current scan locations, and can one location span floors?
