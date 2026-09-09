# Exact pallet occupancy in the storage planner

The existing planner now consumes canonical placement X/Y/Z instead of inventing vertical stack levels for new finished-goods records.

- `storagePlacementGeometry.ts` distinguishes exact rows by finite X/Y coordinates. Exact width/depth already include orientation, so they are not rotated twice. Z remains the stored support elevation. Legacy rows without coordinates retain the previous stacking interpretation.
- The shared `StoragePlacementLayer` draws each reserved/stored pallet at its exact footprint. Reserved pallets have amber dashed edges; stored pallets use solid green edges. Floor 2D, floor 3D, and storage-zone previews reuse the same geometry.
- Floor 2D applies location origin plus current floor offset exactly once. Floor 3D anchors pallets to the existing planner working plane and includes pallet corners in its viewBox so elevated goods cannot be clipped.
- Impact summaries show the highest occupied point rather than adding the heights of side-by-side pallets.
- Location cards list pallet links, exact position codes, local X/Y/Z, and reserved/stored status. Existing square QR wrappers and their padding are unchanged.
- English and Thai occupancy errors now explain that held/stored pallets need reassignment before structural changes. They do not suggest that a generic confirmation bypasses the backend guard.

Validation: 23 focused geometry/component/accessibility tests pass across four files. Tests cover two same-level pallets, exact elevated placement, legacy fallback, no double rotation, distinct status rendering, floor/local offset translation, SVG point containment with a narrow responsive wrapper, and pallet links/QR-square classes. Full typecheck and targeted ESLint passed before the final rendering tests. Real browser/mobile review remains with the root agent; jsdom geometry checks are not claimed as screenshots or a real mobile render.

## Occupied impact review regression

The live review exposed an enabled confirmation after the impact summary already said a structural change was blocked. Location and building dimension confirmation now stays disabled for known reserved/stored occupancy. Floor review includes all building occupancy, matching the conservative backend guard. Returning to edit permits safe label-only changes. Concurrent server refusals display localized reassignment guidance, and version conflicts explain refresh/review recovery. Dialog errors are rendered once rather than duplicated behind the dialog.

Condition comparison now treats casing and surrounding spaces semantically, so a label edit that normalizes an existing `Dry` condition to `DRY` is allowed even when occupied. Actual condition changes remain blocked. Focused UI/integration tests cover blocked confirmation, return-to-edit and label save, concurrent occupancy refusal, building dimensions, and occupied condition case equivalence. English location pallet counts use ICU singular/plural forms.

Final validation after this fix: full `pnpm check` passed (TypeScript, zero-warning ESLint, **341 tests across 45 files**). Output is saved to `artifacts/finished-goods/check-occupied-impact-fix.log`. The narrower messages/planner/occupancy run passed all 35 tests.
