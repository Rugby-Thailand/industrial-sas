# Floor map UI proposal — 2026-09-08

Status: implemented and verified on 2026-09-08. See results.md for evidence and implementation details.
Scope: floor map on the storage floor editor, preserving existing storage, batch, stacking, QR and move rules. Do not add weight rules.

## Problem visible in the current screenshot
- Thick floor extrusion looks like occupied storage volume and dominates the map.
- Location limits and physical pallet volumes are difficult to distinguish.
- Z01/Z02 labels are small and overlap the geometry; location names are absent.
- Previous-floor reference grid competes with the active floor.
- Dragging the whole floor is the primary instruction, although the frequent task is inspecting or editing a location.

## Proposed presentation
- Render floor as a thin slab. Display floor height as a clearance dimension, not slab thickness.
- Keep stored coordinates and geometry unchanged. Fit the active floor to the available viewport on initial load.
- Draw every location as an outlined footprint with a subtle tint. Draw actual stored units separately at their saved positions and dimensions.
- Always label a location with its name and a short occupancy summary; show full code on selection. Use screen-aligned callouts and leader lines to avoid overlap.
- Show location height envelope as a dashed wireframe only on selection/edit. Do not render an empty location as a solid block.
- Previous-floor outline starts hidden behind a reference-layer toggle. Keep it available when editing floor offsets.

| State | Rendering | Action |
| --- | --- | --- |
| Empty location | Teal footprint outline, low-opacity floor tint, Empty label | Select opens location details |
| Stored unit | Tan solid pallet at actual X/Y/Z; location boundary stays visible | Select unit opens its summary and view/move shortcuts |
| Reservation | Amber dashed footprint/volume and Reserved label | Open unit to continue existing reservation flow |
| Selected location | Blue perimeter, selected label, optional height wireframe | Open, edit, QR and relevant unit shortcuts |
| Invalid edit | Red preview, warning icon and specific reason | Save disabled; original geometry retained |

Selection is an overlay state: selecting a reserved or occupied location must retain its original status cues. Never rely on color alone.

## Exact interaction flow
1. Open floor → fitted overview with 2D/3D toggle, search and compact view controls.
2. Search name/code/pallet → highlight matches and dim other locations without hiding surrounding obstacles. Show a count and clear control. Only auto-focus when exactly one match exists; no surprise camera motion while typing.
3. Click a location → highlight it and show a compact inspector with name, code, dimensions, occupancy and saved units. Another click selects another location; Escape clears selection.
4. Click a unit → show its identity, status and saved coordinates. Eye opens detail; move opens the existing move workflow. Respect permissions and active-move state.
5. Click pencil → explicit location edit mode with drag handles, snap feedback, size/position fields and Save/Cancel. Selecting or panning never moves storage geometry.
6. Invalid edit → preview remains visible in red with the current validation reason; Save remains disabled. Cancel restores the original map.
7. Save valid edit → use existing validation/mutation, preserve location identity and QR, refresh map and retain selection.
8. Switch 2D/3D → keep selected location, search and data. View rotation changes camera only.
9. Mobile → full-width map with a compact bottom inspector; use a single tap to select, no hover-only actions. Do not cover the selected location with the inspector.

## Implementation sequence
1. Correct floor visual thickness, clearance annotation and camera fit. Verify geometry and coordinate transforms are unchanged.
2. Separate location footprint, height envelope and stored/reserved-unit layers. Reuse current data/status rules.
3. Add stable readable labels, selection state, inspector and linked quick actions.
4. Connect search, view controls, reference-layer visibility and explicit edit entry.
5. Responsive and keyboard pass, then regression tests and saved desktop/mobile evidence.

## Acceptance checks
- FG-1 is visibly a 2×2m location with a 3m limit and one 1.2×1×1.4m pallet. Z02 is visibly empty with a 1m limit.
- A 10×10×3m floor does not look like a 3m-thick concrete block.
- Stored, reserved and selected states remain distinguishable in 2D and 3D.
- Labels remain readable with long Thai/English names, overlapping screen projections and many locations.
- Search supports names/codes/pallets, no matches and clear; context remains visible.
- Unit shortcuts respect status and permissions. Read-only users cannot enter edit mode.
- Test invalid placement, occupied-location constraints, Cancel, failed save, refresh and hash navigation.
- Test narrow mobile, desktop, keyboard focus and touch controls; no horizontal overflow or clipped inspector.
- Existing packing, stacking, inventory quantities and storage reservations remain unchanged.

## Deliverables
- concept.png: generated visual direction, illustrative only; not evidence of implementation.
- imagegen-prompt.txt: exact prompt, generated with the built-in imagegen tool.

## Mockup review / implementation corrections
The generated board communicates the intended visual hierarchy; it is not a scale-accurate map. Preserve actual location positions from the backend instead of copying the illustrative spacing. The inspector's coordinate origin must be labelled "within location" for the existing unit X/Y/Z values, not "floor origin" as the generated image says. Draw the 3m clearance dimension upward from the floor plane, not beside the decorative slab thickness. Keep edit handles exclusive to edit mode, and hide the unselected location's height envelope by default. These specification rules take precedence over image-generation artifacts.
