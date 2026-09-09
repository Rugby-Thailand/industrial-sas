# Final backend/data-integrity review — 2026-09-06

This pass re-reviewed the finished-goods workflow after UI integration and exact planner occupancy rendering. No frontend PalletScreens/PalletScene files were edited in this review.

## Result

No new high-severity backend defect was found in the reviewed reservation, placement, tenant authorization, or geometry paths. Three new integration tests close gaps in operator identity and concurrent planner interactions.

### Operator-scoped verification

The UI previously needed a reliable way to distinguish “someone scanned this reservation” from “the current operator scanned it.” The backend agent added `destinationVerifiedForCurrentUser` to the detail serializer and the root agent wired its UI behavior. This review added an integration test proving:

1. An unverified reservation reports false.
2. Operator A's matching scan reports true to A and false to B.
3. Replaying A's successful scan request ID as B does not transfer verification identity; B's physical-storage confirmation is refused.
4. B's fresh matching scan reports true to B and false to A, then B can confirm storage.

The server still checks the recorded operator during the final mutation; the serializer boolean only informs the UI.

### Planner mutation races

Added concurrent integration tests for:

- A zone move racing a reservation: either the move commits before the hold is created at the current location, or the new hold blocks the move. Local pallet coordinates remain valid; an existing hold is never moved by the structural edit.
- Building archive racing a reservation: only one operation can succeed. An archived building never finishes with a newly reserved pallet.

These complement the existing race test where two overlapping reservations compete and only one succeeds.

## Rechecked invariants

- Replacement reservation validates the new destination before releasing the old one; mutations remain atomic.
- Tenant-scoped reads and warehouse checks apply to products, pallets, locations, supports and reservations. No cross-org ID or unauthorized warehouse shortcut was found.
- All workflow writes require the manage permission; read-only roles only receive read endpoints.
- Missing measurements do not produce candidates. Measurements require positive integer millimetres and bounded positive quantities/weight.
- Exact X/Y are location-local. Supporting planner positions are translated from floor coordinates. Z is assigned by the configured support and checked again on verify/confirm.
- Rack clearance is capped by the next overlapping shelf, zone allowance and floor ceiling. Pallets on distinct configured elevations are checked as volumes.
- Held and stored pallets both count as occupancy. Structural planner edits, support changes, zone conditions and product requirements cannot invalidate current holdings.
- Indexed complete reads fail explicitly above their configured 10,000-row limit; blockers are not silently dropped after a page.
- The exact-fit sweep preserves both rotations, edge-touch semantics and earliest valid placement; it matches exhaustive integer search in randomized tests.
- Request IDs retain payload fingerprints and persisted result identities. Replay cannot duplicate a physical pallet/placement or transfer the verification actor.
- The catalogue exposes exact coordinates and status. Planner rendering applies origin/floor offsets once, does not double-rotate canonical footprints, and only uses legacy stacking when coordinates are absent.

## Validation

Command:

```sh
pnpm exec vitest run tests/integration/finished-goods.integration.test.ts tests/integration/storage-occupancy.integration.test.ts convex/model/finishedGoods/placement.test.ts tests/isolation/storage-positions.isolation.test.ts src/lib/storageLayouts/storagePlacementGeometry.test.ts
```

Result: **40 tests passed across 5 files** (18 workflow integration, 9 planner occupancy, 7 placement model, 2 storage isolation, 4 renderer geometry).

Targeted ESLint for workflow, model, planner guards/catalogue, the renderer geometry helper, and the affected integration tests passed.

The initial final typecheck found one UI test fixture missing the new operator-verification boolean. Its owner corrected it. A subsequent full `pnpm typecheck` passed after the occupied-impact UI fixes.

## Known capacity/product limits

The workflow intentionally has no automatic hold expiry, goods-on-goods stacking, or unsupported weight-capacity claims. Large catalogues beyond the bounded-complete query limit need pagination/partitioning. Browser/mobile screenshots, real UI navigation and the final video are checked by the root agent separately; this report does not substitute unit tests for those observations.
