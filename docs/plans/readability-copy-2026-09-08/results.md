# Readability and quieter information layout — 2026-09-08

Implemented in `codex/storage-planner`. App remains on port 3100.

## Changes

- Removed decorative panels around pallet summaries, the move route, destination confirmation, the outer floor map, location inspector, building facts and building capacity summary. Maps, inputs, actionable unit rows, dialogs and mobile sticky controls retain their boundaries.
- Added a concise move progress indicator. Same-location moves show source/target position codes; cross-location routes retain building/floor/location context.
- Kept pallet identity and quantity visible; dimensions, lot and duplicate status are available under Details on the active move page.
- Destination name is prominent, building/floor secondary, coordinates and orientation remain visible. Coordinate instructions are expandable.
- Shortened pickup, placement and return acknowledgement copy in Thai/English. Confirmation precedes optional QR controls. Removed the ordinary warning banner; actual movement issues still show a warning.
- Pallet-scene text scales with the measured SVG viewport to target 12 CSS pixels. Optional labels/dimensions can be toggled with a labelled icon; the selected pallet remains visible. Floor-map metadata is 13px and legend 14px.
- Reused existing color tokens. Previously sampled muted/body contrast was already sufficient; this change addresses size, hierarchy and redundant copy rather than indiscriminately brightening every element.

## Verification

- TypeScript, ESLint, full Vitest suite and production build run; see logs in `artifacts/readability-2026-09-08`.
- Live browser: Thai/English desktop move page; 390 CSS pixel mobile layouts with document scrollWidth exactly 390; English confirmation button remains within the viewport.
- Checkbox enables confirmation; switching to optional QR clears acknowledgement and disables confirmation. Returning to checkbox mode also resets acknowledgement. Refresh leaves it unchecked.
- Opened return dialog, checked its source identity/coordinates and disabled confirmation; closed without submitting.
- Exercised 2D/3D and optional map labels. Inspected persisted building BLDG-A, floor 4, location FG-1; tested empty location search and restored results.
- A batch test had a timing race: the success text could render before the effect removed the unload guard. The test now waits for observable unload behavior rather than assuming the success text guarantees the effect has completed. No batch production behavior changed.

## Evidence and limits

`ui-actions.mp4` is a 31.5-second walkthrough assembled from nine real UI captures at 3.5 seconds per action, not a continuous real-time screen recording. `actions.json` lists the frames. Screenshots include desktop Thai/English, mobile Thai/English, optional QR, return dialog, 2D labels, building/floor inspectors and empty search. The mobile capture provider includes unused background; DOM dimensions were checked separately.

No live inventory movement was submitted: P-000001 remains in transit. Backend move/stack/batch behavior is covered by the automated suite. Manual visual checks were in the current dark theme; a complete light-theme and every-screen visual audit is not claimed. Decorative panel removal does not change saved product quantities, reservations or support locks.

## User correction: restore section structure

The user found the panel removal excessive. Restored subtle bordered surface cards for the shared pallet summary, active move confirmation, outer floor-map section, building facts and capacity. Inner coordinate data, the route and location inspector remain unboxed to avoid nested cards. Retained the shorter copy and larger text. Verified the live move screen; latest screenshot is `balanced-panels.png`. Earlier screenshots/video show the prior, more stripped-back iteration.

## Pallet visibility correction

Surrounding stored/reserved pallets now render with transparent faces and status-colored outlines in the shared PalletScene (2D and 3D). The selected pallet keeps its opaque carton rendering and placement coordinates. Updated legend swatches to outlines. Inspected real pallet P-000005 in both modes; screenshots `wireframe-2d.png` and `wireframe-3d.png`. Scene and accessibility tests recorded in `wireframe-test.log`.
