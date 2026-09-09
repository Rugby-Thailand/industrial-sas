# Finished goods backend implementation

Implemented in `convex/finishedGoods/workflow.ts`; frontend bindings and inferred types are in `src/lib/convex/finishedGoodsApi.ts` (`fgRefs`). The existing tenant wrappers produce `{ok:true,value,...}` or authorization denials. Mutations return `value: {written:true,documentId,replayed}` or `{written:false,error:{code,field?,reason?}}`.

## Records and state

- `finishedGoodsProducts`: warehouse-scoped SKU/product definition, draft or active. Blank fields are allowed in drafts; advancing requires SKU, name, unit, default quantity, and storage condition. Nonblank normalized SKUs are unique within the warehouse.
- `finishedGoodsPallets`: physical units with `P-000001` identifiers, quantity, optional lot, measured outside dimensions in integer millimetres and optional kilograms. States are awaiting measurement, awaiting placement, reserved, stored.
- `finishedGoodsPlacements`: distinct `POS-000001` identity and QR. Contains local location X/Y, supporting elevation Z, rotated footprint, height, support identity, held/stored/released status, actor and destination verification. A recommendation never writes occupancy.
- `finishedGoodsCounters`: transactional per-warehouse display identifier allocation.

Creation is two pages. Save product then create a pallet; retry each request with the same request ID and unchanged arguments. Saving measurement with omitted dimensions clears those dimensions and leaves a resumable draft. A complete measurement moves to awaiting placement. Stored or reserved dimensions cannot be edited until a hold is released (stored units cannot be released by this workflow).

## Exact placement and concurrency

The pure geometry implementation is `convex/model/finishedGoods/placement.ts`. It considers two footprint rotations and bottom-left candidates along obstacle edges. All output positions are integers in millimetres. Candidate and destination payloads include the selected support label/code when configured, so multiple shelves under one location remain distinguishable. The local X axis follows measured width; the local Y axis follows measured length. Rotation90 swaps these footprint axes, matching the shared 3D control. Coordinate contact is permitted; volume overlap is not. Pallets sit only on the floor or configured supporting surfaces. Rack headroom stops at the next overlapping shelf or the location/floor ceiling. Goods-on-goods stacking is intentionally absent.

Destinations require an active building, zone, referenced location, and supporting position location. The current floor is authoritative. Reserved blocks prevent use at any elevation. Existing held and stored placement volumes are the occupancy source of truth. Storage-condition compatibility is `UNKNOWN` when the location is not configured, `MATCH` only for an actual case-insensitive equality, and incompatible locations are excluded. Product `ANY` means no special condition; a known location then matches, while an unconfigured location remains unknown. The existing location add/edit dialog can configure Dry or Cool, or clear the value to unknown.

Reservation reads the complete location occupancy inside the same Convex mutation that inserts the hold. Convex transaction conflict retries ensure two overlapping claims cannot both succeed. Changing a spot creates the new hold and releases the prior hold atomically, after all validations succeed. Failed replacement leaves the original hold intact. Reservation has no invented timeout; explicit cancellation releases it.

Send `expectedMeasurementUpdatedAt: pallet.updatedAt` to reserve to reject a stale measurement snapshot. Location and occupancy geometry are always revalidated at reservation, verification, and final storage confirmation.

## Destination verification

Scanned code must be the selected location QR, selected configured support QR, or the exact reserved position QR. Manual mode additionally accepts the exact location/support/position code (never a fuzzy display-name match). Method is persisted as `SCAN` or `MANUAL`. A wrong code clears any prior verification. Final confirmation requires a matching verification by the current operator and rechecks availability. A location QR verifies location identity; it does not independently prove the physical coordinates.

Repeated storage confirmation does not create another placement or quantity. Successful command request IDs persist an argument hash and result identity; changed arguments with a reused request ID are rejected. Domain refusals and successful writes are audited. Auth failures follow the existing tenant-wrapper audit policy.

## Tenant access and bounded reads

For the extracted product, existing `masterData.storageLayout.read` and `masterData.storageLayout.manage` permissions authorize finished goods. Supervisors remain read-only; tenant/warehouse isolation is enforced server-side. Dedicated warehouse permissions can replace these later when the role model grows. Workspace `navigationPermissions` now includes the actual manage grant for UI affordances; this value is resolved from active role assignments, and supervisor tests confirm it is absent for read-only users.

`tenantDb.byIndex(...).all(limit)` was added for complete transactional reads. It uses indexed `take(limit + 1)` rather than repeated native pagination (Convex permits only one pagination call per function). Every row's tenant is checked. Exceeding the explicit bound throws `CAPACITY_DATA_LIMIT` and never returns a truncated occupancy view. Workflow complete-read bound is 10,000 rows per indexed range. Larger warehouses require a dedicated paginated list and partitioned recommendation strategy.

## Test evidence

`tests/integration/finished-goods.integration.test.ts` covers the full lifecycle, incomplete drafts, normalization/duplicates, replay and changed request arguments, invalid numbers, cancellation/replacement, overlapping concurrent claims, active destinations, configured conditions, warehouse/tenant/anonymous/read-only isolation, stale measurement snapshots, >100 blockers, rack elevation/verification, and explicit batch overflow.

`convex/model/finishedGoods/placement.test.ts` covers rotation-only fit, touching edges, elevated supports, no-fit height/unavailable area, and 300 randomized geometry checks.

Earlier focused checkpoint: 15 integration tests and 7 geometry tests passed, with a passing TypeScript check. Later coverage and validation are recorded in `final-backend-review-2026-09-06.md` and the work log; these counts are not the final suite total. The review also added occupied-product condition protection, exact-search/exhaustive-search equivalence properties, and a dense blocker sweep regression. See `backend-review.md` for review findings and performance evidence. Root task performs UI/browser end-to-end verification and broader regression checks separately.
