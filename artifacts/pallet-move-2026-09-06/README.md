# Stored pallet moves — implementation and evidence

Implemented on `codex/storage-planner` in `/Users/macbook/Development/industrial-sas-storage-planner`.

## Delivered

- Stored-pallet Move action and exact destination selection using existing 2D/3D controls, source outline, X/Y, supported elevation, and orientation.
- Review From/To, reserve target, replace target atomically before pickup, verify pallet and acknowledge physical pickup.
- Resume a move after refresh, verify destination and acknowledge exact physical placement, then atomically release source and store target.
- Cancel before pickup, report an issue without releasing either hold, or verify physical return to source after pickup.
- Operator ownership, tenant/warehouse boundaries, stale revision checks, collision/geometry validation, idempotent retries, and movement history.
- Both source and target block conflicting use while counting one physical pallet. Overlapping footprints use union area.
- Thai/English copy and moving status in the catalogue and detail.

## Final automated results

`pnpm check`: TypeScript passed, ESLint passed with zero warnings, **419 tests in 54 files passed**.

`pnpm build`: passed. `git diff --check`: passed.

Coverage includes move command integration, competing reservations, authorization/ownership, wrong codes, physical acknowledgements, stale source/target, atomic replacement, failed replacement, duplicate requests, cancellation, return with unavailable target, empty/read-only UI, and occupancy union/counting. Review notes are in `docs/plans/finished-goods-flow-2026-09-05/move-occupancy-review.md`.

## Browser verification

Only dedicated local QA pallet **P-000005**, 501 pieces, 1.2 × 1 × 1.5 m, was moved. User pallets P-000001 and P-000004 were not changed.

1. Reserved target X=2 m from POS-000004 at X=1.2 m; cancelled; original source remained stored.
2. Reserved again; wrong pallet code rejected; correct pallet QR plus pickup acknowledgement succeeded.
3. Refreshed during movement; source remained the last confirmed position and target remained reserved.
4. Wrong destination code rejected; exact target code plus placement acknowledgement completed the move to POS-000006 at X=2 m. Identity, quantity, dimensions, and product remained unchanged.
5. At 390 × 844, prepared another move, confirmed pickup, saved an issue, refreshed, then verified return to source. Source remained POS-000006; destination hold ended. Page width equalled viewport width (390 px).
6. Checked Thai and English pages, both 2D/3D modes, review dialog, mobile scrolling/return controls, and movement history.

During implementation a temporary duplicate variable compile error and an incorrect Stored badge during transit were found and fixed. Final console check after the fixes returned no errors (`final-console-errors.json`). `02-in-transit.png` is pre-fix evidence of that badge; use final images for current UI.

## Evidence files

- `08-final-thai.png`: final stored detail, Move action, completed/cancelled/returned history.
- `09-planner-thai.png`: exact move planner and source outline.
- `10-review-thai.png`: review dialog before reservation.
- `04-mobile-select.png`, `05-mobile-review.png`, `06-mobile-return.png`, `07-mobile-returned.png`: mobile flow evidence.
- `check.log`, `build.log`, `final-console-errors.json`: validation results.

## Limits

Moves are within the current warehouse. Manual code verification was exercised in the browser; physical camera scanning was not exercised with real hardware. History shows the newest 20 records; older records remain stored. These are simulated warehouse operations against local QA data, not physical pallet movements.

Screenshots are saved. A continuous screen-recording video was not captured: the available browser automation exposes screenshots and viewport controls, but no recording capability.

Dev server remains available at http://localhost:3100.
