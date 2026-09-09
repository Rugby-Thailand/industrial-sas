# Building map using persisted data — 2026-09-08

## Problem and change
The building overview still rendered only the old slab model, while the interactive floor map was behind Edit floor. The dense demo page used fixtures. The building overview now defaults to the same interactive FloorMap used by the real floor editor. A separate Building model toggle preserves the structural view and settings.

The existing warehouse-scoped Convex building query supplies floor dimensions, reserved blocks, storage zones, placements and saved coordinates. No fixtures, additional query, inventory writes or seeded inventory are involved. The initially selected floor prefers one with placements, then one with locations. Users can switch floors, search, inspect 2D/3D, open a real pallet, enter its existing move workflow, or jump directly to its location editor. Removed the demo link from operational maps to avoid confusing example data with saved inventory.

## Verified saved records
- Warehouse: QA-MAIN.
- Building: DEMO-BLDG / อาคารตัวอย่างสำหรับเรียนรู้ระบบ, ID rs74sq726gj60r4z6nqbsw4e9h8d689p. Despite its existing name, this is a persisted building record, distinct from the static /demo URL.
- Floor 1: 30 × 20 × 4 m; 4 storage locations.
- Reserved block: สำนักงานและทางหนีไฟ, 5 × 4 m at X24/Y0; 20 m².
- Location สินค้าสำเร็จรูป A: 5 stored units: P-000001, P-000005, P-000020, P-000018, P-000019. Occupied footprint 4.92 m² of 16 m², displayed 31%.
- P-000001: POS-000001 at X0.2/Y0.3/Z0 m. Opened its actual pallet page from map search and cross-checked its destination and coordinates.
- Floor 2: zero storage locations, displayed as empty.
- Location B has “เต็ม” in its saved name but currently zero units. The UI displays the actual zero count, not a fabricated full status.

## Validation
- pnpm check: typecheck and lint passed; 689 tests across 66 files passed.
- Production build passed with isolated NEXT_DIST_DIR=.cache/real-map-build; the live server remains on 3100.
- New tests cover persisted aisles/placements, live prop updates removing placements, floor switching, empty floors, no demo links, real pallet link and direct edit route, plus the model toggle.
- Browser: actual building reload, floor switching, 2D/3D, selected location inspector, search, no-match state, real pallet navigation, direct location edit dialog and cancel/return.
- Desktop: 1742 CSS pixels, no horizontal overflow. Native viewport 1119 pixels also checked.
- Mobile: 390 CSS pixels in Thai and English, no horizontal overflow or off-screen main buttons.
- Mobile screenshots from the browser viewport override include extra background in the capture; layout width was additionally checked against the DOM.
- No live records were modified during verification. Full movement/placement mutations are covered by the existing regression suite; this change adds entry points, not new mutation rules.

## Evidence
- artifacts/storage-spots-ui-2026-09-08/real-building-map-2d.jpg
- artifacts/storage-spots-ui-2026-09-08/real-building-map-3d.jpg
- artifacts/storage-spots-ui-2026-09-08/real-map-mobile-th.jpg
- artifacts/storage-spots-ui-2026-09-08/real-map-mobile-en.jpg
- artifacts/storage-spots-ui-2026-09-08/real-map-focused-tests.log
- artifacts/storage-spots-ui-2026-09-08/real-map-check.log
- artifacts/storage-spots-ui-2026-09-08/real-map-build.log
