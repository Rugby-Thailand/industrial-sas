# ADR-0015 — QR-addressable storage stacks

- ID: `ADR-0015`
- Status: **Accepted**
- Date: 2026-08-21
- Decision baseline: user-approved storage-zone and finished-good scan workflow
- Implementation status: **Implemented**

## Context

The storage planner already models building and floor geometry, while the
inventory ledger models the physical location of stock. Operators need to draw
usable storage positions, print or display a machine-readable identifier, scan a
finished good into one of those positions, and know the vertical order of units
in a stack. A parallel stock-location field inside the drawing would let the map
and the ledger disagree.

## Decision

1. One storage zone is one rectangular, QR-addressable vertical stack in the
   first release.
2. Creating a zone also creates an active `FLOOR_BLOCK` inventory location. The
   QR payload identifies that location with the versioned value
   `ISAS:LOCATION:1:<locationId>`.
3. Finished goods are placed as handling units identified by LPN/SSCC.
4. Placing a handling unit posts a balanced `MOVE` transaction for all its
   positive balance buckets and records the stack level in the same Convex
   transaction.
5. Level 1 is the bottom. New units are appended at the top. Footprint fit is a
   hard constraint; maximum stack height produces a visible warning so a
   supervisor can correct the physical plan without losing the stock movement.
6. The overview remains semantic SVG; QR rendering is a deterministic client
   representation of the stored payload.

## Invariants

### Code-owned guarantees

- `INV-0015-01` A zone is inside its floor and overlaps neither reserved space
  nor another active zone.
- `INV-0015-02` Each zone owns exactly one warehouse location and one stable QR
  payload.
- `INV-0015-03` A handling unit footprint fits directly or after a 90-degree
  rotation before placement.
- `INV-0015-04` Stack levels are contiguous and increase bottom-to-top.
- `INV-0015-05` The inventory ledger move and stack placement commit atomically.
- `INV-0015-06` A non-empty zone cannot be archived.

### Operational assumptions

- Each physical unit has a unique, scannable LPN/SSCC before placement.
- Captured width, depth, and height are the handling unit's actual outside
  dimensions.
- Operators place new units on the physical top of the selected stack.

## Consequences

- Inventory screens and the floor visualization resolve the same physical
  location.
- The product can answer which unit is topmost or bottommost without inferring
  from timestamps.
- Side-by-side bins inside one drawn rectangle require separate zones; arbitrary
  3D bin packing is intentionally not implied.
- Existing handling units gain optional outside dimensions that survive later
  ledger-maintained location moves.

## Rejected alternatives

- **QR payload containing building, floor, and coordinates:** moving or renaming
  geometry would invalidate printed labels.
- **Product-to-zone row without a ledger move:** creates a competing, eventually
  inconsistent stock system.
- **Free-form stack rank:** permits gaps, duplicates, and physically impossible
  ordering.
- **Automatic 3D bin packing:** gives false precision without weight,
  crushability, support-area, and orientation rules.

## Verification

- Pure unit tests cover bounds, overlap, rotation, sequence, identifiers, and
  capacity warnings.
- Convex integration tests cover idempotent zone creation, QR lookup, ledger
  movement, handling-unit dimensions, and stack readback.
- Schema-policy and tenant-boundary guards classify both new tenant tables and
  require organization-first indexed access.

## Release gates

Existing authorization, tenant isolation, accessibility, type-checking, and
inventory-ledger gates apply. No external release gate is introduced.

## References

- [ADR-0003](./0003-append-only-inventory-ledger.md)
- [ADR-0005](./0005-warehouse-location-and-stock-identity.md)
- [ADR-0014](./0014-storage-building-layout-rendering.md)
- [Domain context](../../CONTEXT.md)
