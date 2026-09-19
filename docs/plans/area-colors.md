# Area colors implementation plan

Date: 2026-09-19

Status: Planned; application implementation has not started.

## Outcome

Users can choose a color when adding or editing an unavailable floor area. That color survives saving and reloading and appears consistently wherever the area is displayed: dialog previews, floor plans, isometric views, lists, legends, and applicable goods-placement views.

The first release covers unavailable areas (`storageFloorReservedBlocks`). Usable storage zones, racks, and inventory status colors retain their existing behavior. Color is presentation metadata and does not change placement permissions, blocked geometry, or capacity calculations.

## Design references and interpretation

The supplied images are visual references, not instructions embedded in the product. Their copy, sample dimensions, architectural illustrations, and differing palettes do not independently define requirements.

| Reference | Adopt | Do not infer as a requirement |
| --- | --- | --- |
| [Add area](area-colors-references/01-add-area.png) | Labeled preset swatches, selected checkmark and outline, form beside a live preview, clear footer actions | New architectural floor-plan rendering or a new name-length limit |
| [Custom color](area-colors-references/02-custom-color.png) | “More colors” control, visual picker, hex entry, selected-color preview, explicit Apply action | L-shaped or polygon area support |
| [Floor overview](area-colors-references/03-floor-overview.png) | Matching color in the plan, area list, and legend; hatch texture; distinct selection and invalid-position outlines | A full floor-page redesign, reorder support, or a new area-type database |
| [Edit area](area-colors-references/04-edit-area.png) | Preselected saved color, readable label, live preview, Save/Cancel actions | Locking names, dimensions, or positions; the existing edit capabilities remain available |

The earlier warehouse color chart is the palette reference. The newer images guide interaction and layout. Where colors or names conflict, use one shared palette based on the warehouse chart rather than mixing the mockups. Swatch labels are suggested uses, not a new classification system. Exact palette hex values should be defined once during implementation; screenshot colors are visual samples, not authoritative numeric values.

## User experience

### Add and edit dialog

- Add **สีพื้นที่ / Area color** immediately below the area name.
- Use a compact, wrapping swatch grid with text labels. Show both a checkmark and a visible focus/selection outline.
- Include suggested colors for common unavailable spaces such as walkways, offices, stairs, lift clearance, worktables, and equipment parking, plus a neutral/default option and **สีเพิ่มเติม / More colors**.
- Reuse the same base colors as the chart without offering usable-storage presets as if they made an unavailable area usable.
- On desktop, use a two-column form and preview when space permits. On smaller screens, stack the sections and retain accessible scrolling and reachable actions.
- Keep the current preview controls, coordinate fields, dimension fields, drag/resize behavior, and save flow.
- New areas start with the shared unavailable-area fallback. Existing areas load their saved color or the same fallback.
- Preset selection updates the draft and preview immediately. It must not change the area name or dimensions.
- Closing or cancelling the area dialog discards uncommitted dialog changes. Applying the dialog updates the floor draft; the existing floor Save action persists it.

### Custom color

- Open a popover with a visual color picker, selected-color chip, editable hex value, and **ใช้สีนี้ / Use this color** action.
- Accept six-digit hexadecimal RGB values, with an optional leading `#` in the input; normalize persisted values to uppercase `#RRGGBB`.
- Show an inline error for invalid input and disable Apply until valid. Do not accept arbitrary CSS values, alpha colors, or gradients.
- Keep changes local to the picker until Apply. Escape/close cancels the picker and restores focus to its trigger.
- Reuse an existing suitable picker if available; otherwise prefer a native color input plus hex entry over introducing a large dependency solely for this feature.

### Consistent display

- Draw each unavailable area with its resolved base color, a contrasting border, and existing unavailable-area hatching where applicable.
- In isometric views, derive face shading from the same base color; do not replace it with a fixed generic fill.
- Keep selection and collision states as separate outlines/overlays. A user-selected red or blue must not be the only indication of an error or selection.
- Use a readable label treatment, including a contrasting backing when needed for very light or dark custom colors.
- Add a matching swatch next to the area name in lists and read-only details.
- Build legend entries from areas actually visible in the current floor/view. Use area names and swatches; do not infer area types from hex values. Keep status/selection legend entries separate.
- Provide accessible names and textual labels; color alone must not communicate meaning.
- Support Thai and English and the app's existing light/dark styling.

## Current implementation findings

- `convex/schema.ts` defines `storageFloorReservedBlocks` with label and rectangle dimensions but no color.
- `convex/storageLayouts/writes.ts` validates block inputs, reconstructs floor data, and replaces reserved-block records when saving a floor. Every explicit mapping must carry the color to avoid dropping it.
- `convex/storageLayouts/catalogue.ts` returns reserved blocks through another explicit mapping.
- `src/lib/convex/storageLayoutApi.ts` defines the client reserved-block shape.
- `src/features/storageLayouts/StorageLayoutScreens.tsx` owns the reserved-area dialog, floor draft, list, and several render paths. Its `blockShape` comparison currently ignores color, so color-only changes would not be detected without an update.
- `StorageZoneDraftPreview.tsx` and `StorageZoneVisualizer.tsx` have additional block mappings and rendering paths.
- `convex/finishedGoods/workflow.ts` projects overlapping blocks into unavailable geometry consumed by goods-placement views. Audit the associated API types and rendering before adding presentation fields.
- `src/components/storageScene/sceneColors.ts` already supplies shared semantic colors. Preserve their status meanings and introduce one unavailable-area fallback/resolver rather than duplicating fallback values across views.

These findings were checked against the working tree. Recheck relevant files before implementation because the workspace contains ongoing changes.

## Implementation sequence

### 1. Persist color without breaking existing data

Files: `convex/schema.ts`, `convex/model/storageLayout/storageLayout.ts`, `convex/storageLayouts/writes.ts`, `convex/storageLayouts/catalogue.ts`, and `src/lib/convex/storageLayoutApi.ts`.

- Add optional `color` to the database record, block input, validator, and response types.
- Validate and normalize supplied colors on the server, with an understandable error response for malformed values.
- Preserve color in layout reconstruction, save/insert, and response mappings.
- Keep missing colors valid for older records and callers. Resolve missing values through a shared visual fallback; no bulk backfill is required.
- Deploy the compatible optional schema/backend changes before the frontend begins sending color.
- Preserve current authorization, version checks, and request replay behavior. Include color in any relevant change/request comparisons.

### 2. Add shared presentation helpers and selector

Suggested new files: `src/lib/storageLayouts/areaColors.ts` and `src/components/storageLayouts/AreaColorPicker.tsx`; adjust names to repository conventions during implementation.

- Define palette entries, fallback resolution, and presentation helpers once.
- Keep backend color validation in a backend-safe shared/domain module; backend code must not import client components.
- Implement keyboard-accessible preset selection and custom color entry with localized labels.
- Add color to dialog draft initialization, editing, preview values, and apply/cancel handling.
- Include normalized effective color in the floor dirty-state comparison so merely opening a legacy area does not create a false change, while a real color-only edit does.

### 3. Propagate color to every display surface

| Files/surface | Work |
| --- | --- |
| `src/features/storageLayouts/StorageLayoutScreens.tsx` | Dialog preview, floor render paths, reserved-area list, draft mappings, and legends |
| `src/components/storageLayouts/StorageZoneDraftPreview.tsx` | Selected area and surrounding unavailable areas; preserve color through nested visualizer mappings |
| `src/components/storageLayouts/StorageZoneVisualizer.tsx` | Extend visual-area metadata and use resolved colors in both plan and isometric rendering |
| `src/components/storageScene/sceneColors.ts` | Shared fallback and clear separation from inventory status colors |
| `convex/finishedGoods/workflow.ts`, `src/lib/convex/finishedGoodsApi.ts`, `src/features/finishedGoods/PalletScene.tsx` | Carry optional color, and label if needed, through unavailable-area projections and draw matching swatches/fills where those areas are shown |
| `src/i18n/messages.ts` and actual locale resources | Add matching Thai/English labels, help text, and validation messages using the existing translation structure |

Audit all consumers of reserved blocks and unavailable geometry, including read-only building/floor views. Change only views that actually display the area; geometry-only placement algorithms should remain unaffected.

### 4. Verify behavior and appearance

- Extend storage-layout integration tests to cover saving/reloading color, replacing block records without losing color, legacy records, invalid values, and existing write protections.
- Extend component tests for preset selection, custom-color validation, picker cancellation, dialog cancellation, edit initialization, and color-only dirty-state detection.
- Add rendering checks for two areas with different colors in plan and isometric modes and verify color survives projection into goods-placement data.
- Verify that changing color does not alter blocked bounds, usable area totals, overlap outcomes, or occupancy status meanings.
- Check keyboard navigation, focus restoration, accessible swatch names, and contrast for pale/dark custom colors.
- Manually inspect desktop and narrow layouts, both themes, Thai/English, long labels, and selection/error overlays against the references.
- Run the relevant tests, type checking, and lint checks. Read applicable installed Next.js guides before any framework-dependent implementation, per `AGENTS.md`.

## Acceptance criteria

- [ ] A user can choose a preset or valid custom color when adding or editing an unavailable area.
- [ ] A color-only edit is recognized as a change and can be saved.
- [ ] Saved color survives reload and subsequent edits to other floor fields.
- [ ] Each rendered occurrence of the area uses the same resolved base color, with only intentional shading/opacity differences.
- [ ] Dialog, list, and legend agree with the plan and isometric views.
- [ ] Existing records without color render consistently and remain editable.
- [ ] Invalid color input cannot be persisted through the UI or API.
- [ ] Cancel behavior, edit permissions, geometry validation, and capacity calculations remain correct.
- [ ] Selection/errors remain distinguishable from user-chosen colors.
- [ ] Thai/English and keyboard interactions work on desktop and narrow screens.

## Explicitly deferred

- Color editing for usable storage zones and racks.
- Configurable area-type master data or organization-wide palette administration.
- Polygon/L-shaped areas, architectural drawing imports, and a complete page redesign.
- Global recoloring of previously saved areas when preset definitions change; saved hex values remain stable.

If formal area types are needed later, add a separate type identifier and define its relationship to default colors. Do not use the selected hex value as a type identifier.
