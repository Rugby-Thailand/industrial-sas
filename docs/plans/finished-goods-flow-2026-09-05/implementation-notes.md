# Finished-goods implementation notes

Updated 2026-09-06. This is the implementation handoff, separate from the [historical design proposal](design-proposal.md). The [current flow](flow.md) specifies visible behavior; the [developer guide](../../development-setup.md) covers isolated local setup.

## Domain and authorization decisions

Product definitions, physical pallets, and exact positions have separate records and identities. The four new tables are `finishedGoodsProducts`, `finishedGoodsPallets`, `finishedGoodsPlacements`, and `finishedGoodsCounters`. Product SKU uniqueness is warehouse-scoped; pallet and position display codes are allocated transactionally per warehouse. A proposed candidate is computed and has no occupancy until reserved.

The extracted app uses the existing `masterData.storageLayout.read/manage` permissions for finished goods. Active role assignments determine the actual UI manage grant; backend tenant wrappers authorize every operation. This preserves existing extracted roles without silently granting new access. A dedicated finished-goods permission family can be introduced with a deliberate role migration later.

The app and isolated local Convex deployment run on ports 3100 and 3320/3321. Clerk development identity remains shared with the configured development instance; application records are local. Original inventory records were not imported. No cloud deployment or original-webhook replacement is part of this work.

## State and command integrity

- Products can be draft or active. A valid active product is required before creating its physical pallet.
- Physical pallets progress from awaiting measurement to awaiting placement to reserved to stored. Partial measurement saves remain resumable.
- Released placements are retained as history. Replacing a hold reserves the new position and releases the old one in one transaction; failure preserves the old hold.
- Request IDs bind successful commands to argument hashes and saved result identities. Unchanged retries replay success; changed arguments with the same ID are rejected. UI operation scopes clear completed requests before a new logical action.
- Reservation checks the measurement revision, complete current occupancy, destination activity, support geometry, boundary/height, excluded blocks, and condition compatibility in the write transaction. Verification and final confirmation revalidate the destination as well.
- Two concurrent overlapping reservations cannot both succeed. Existing planner edits/archives and reservation writes participate in authoritative occupancy validation.
- Verification belongs to the current operator. `destinationVerifiedForCurrentUser` is serialized for the UI; one user's scan or replay cannot authorize another user's physical confirmation.
- Domain failures and successful writes use the existing audit conventions. Repeated final confirmation cannot add another placement or quantity.

## Coordinate and geometry contract

All saved physical measurements and placement coordinates are integer millimetres. At rotation 0, local X follows measured `widthMm` and local Y follows measured `lengthMm`; rotation 90 swaps the footprint. Placement X/Y are relative to the selected location's origin. Floor rendering adds the location's floor offset. Z is the selected support elevation, not an arbitrary draggable height.

Floor and configured support surfaces are eligible. On racks, headroom ends at the next overlapping shelf or the location/floor ceiling. Placement rectangles may touch edges but cannot overlap in three-dimensional volume. Floor excluded blocks apply at every elevation. The same physical convention is shared by the API, recommendation geometry, interactive scene, and planner overlays.

Candidates include support label/code/elevation so different shelves within one named location are distinguishable. The first-fit search checks two footprint rotations and obstacle boundaries; it is a deterministic geometric placement recommendation, not a travel-distance or warehouse-wide utilization optimizer.

Measurements must be positive safe integer millimetres and no dimension may exceed 100,000 mm. Quantity is positive and bounded at 1,000,000,000; optional weight is positive and bounded at 1,000,000 kg. Weight is recorded metadata, not a shelf-load-capacity check.

## Conditions and occupancy

Locations can be unconfigured or carry a condition such as DRY or COOL. Matching is case-insensitive. Product ANY means no special requirement. An unconfigured location remains UNKNOWN, rather than falsely passing a condition check; a known incompatible location is excluded. Occupied location conditions and the requirements of products with held/stored pallets cannot be changed incompatibly through the current editors.

Held and stored placement volumes are authoritative occupancy. Complete indexed tenant reads have an explicit 10,000-row bound per range and fetch one additional row to detect overflow. `CAPACITY_DATA_LIMIT` refuses the operation rather than silently omitting blockers. Scaling beyond this bound requires partitioned occupancy queries and paginated catalogue design, not a larger frontend preview limit.

## QR and recovery

A scanned destination must match the chosen location, configured support, or exact reserved position QR. Manual verification additionally accepts the corresponding exact code and is recorded as MANUAL. Neither path accepts an unrelated display name. Location-level verification identifies the destination; physical X/Y placement still requires the operator to follow the visible guide and confirm storage.

Camera access is opt-in. Stream controls stop on successful scan, stop, and unmount, including late startup handling. Manual entry remains usable if camera access or decoding is unavailable. Scanner tests use mocked camera/decoder behavior. **A real physical camera and printed QR were not tested in this development run**; manual/browser interaction evidence must not be represented as physical scanning evidence.

Unsaved form recovery is scoped to Clerk actor, warehouse, and record. Completed workflow state is stored on the backend and survives refresh. Read-only users receive inspection affordances; direct mutations remain denied server-side.

## Current boundaries and deferred work

- No full inventory ledger, receiving/shipping, sales/purchasing, production, allocation, or financial stock valuation workflow.
- No goods-on-goods stacking, free vertical placement, forklift route planning, clearance certification, or shelf weight/load rules.
- No automatic reservation expiry. Holds require explicit cancellation or replacement.
- No move, unstore, stock adjustment, or deletion of an already stored pallet in this workflow.
- No full offline synchronization, printer integration, or automatic physical-position sensing.
- Dedicated finished-goods permissions and very large warehouse partitioning are future changes requiring explicit domain design.

These boundaries do not prevent the implemented create → measure → recommend → reserve → verify → confirm flow. They identify behavior the app does not currently claim to provide.

## Dependency review

The [dependency review](dependency-review.md) records retained runtime dependencies and potential development-tool cleanup. No package or lockfile changes were made in that review.

## Evidence and review records

Automated coverage includes drafts, wrong input, normalization and duplicates, stale measurements, retries, concurrent claims, tenant/warehouse and read-only isolation, support/headroom constraints, condition compatibility, planner edit guards, actor-specific verification, interactive geometry, accessibility, and scanner lifecycle. See `backend-notes.md`, `final-backend-review-2026-09-06.md`, `frontend-final-review.md`, and `qa-matrix.md` for individual review details.

Final full-suite results, final screen captures, and the final walkthrough recording are maintained by the main task in its QA/work-log artifacts. This document does not claim that final evidence has completed. Generated images 01–08 are design concepts only.
