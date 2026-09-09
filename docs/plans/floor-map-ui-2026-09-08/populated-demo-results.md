# Populated floor / aisle readability demonstration

Route: http://localhost:3100/th/master-data/storage-layouts/demo

Interactive fixture, separate from live inventory; not seeded into the database. Supports selection, search, QR display, camera rotation, zoom and2D/3D. Inventory navigation/move/save actions are deliberately absent for sample IDs and the page explains this.

- 24×18m floor with clear2m cross aisles.
- Mixed scenario:62 units; full, partial, reserved and empty zones.
- Full scenario:120 units, including6 reserved units, filling all four9×6m storage footprints. Aisles remain clear; full describes location footprint usage, not floor-wide or volumetric capacity.
- Aisles use slate diagonal hatching rather than reservation amber.
- Individual pallet borders strengthened for dense scenes.
- Callouts choose nearest clear positions and avoid both pallet volumes and aisle labels/areas. Regression verifies all four2D labels remain outside the aisles.
- Map layout now responds to its actual container width rather than viewport width so sidebar presence cannot squeeze it beside the inspector.
- Inspector shows union footprint usage; exact pallet search highlights the unit and places its details first.

Verification: typecheck, lint,687 tests across66 files, and isolated production build passed. Fixture tests verify counts, bounds, no pallet overlaps, no aisle overlaps, mixed/full independence, and100% union area in every full zone. UI tests verify no sample inventory links or writes. Live demo checked full/mixed,2D/3D, search DEMO-P-030, and1041px desktop no overflow.

Evidence: artifacts/storage-spots-ui-2026-09-08/populated-full-2d.jpg, populated-full-3d.jpg, populated-mixed-3d.jpg, populated-map-check.log and populated-map-build.log.

Assessment:2D is clearest for aisles and free/reserved footprints;3D is helpful for height and actual volumes. This is a structured four-location example, not a claim of testing every possible warehouse layout.
