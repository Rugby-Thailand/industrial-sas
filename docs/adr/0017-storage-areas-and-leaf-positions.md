# ADR-0017 — Storage areas and exact leaf positions

- ID: `ADR-0017`
- Status: **Accepted**
- Date: 2026-08-27
- Decision baseline: approved storage-location evolution
- Implementation status: **Implemented as an incremental end-to-end slice**
- Evolved by: [ADR-0018](./0018-general-area-stock-and-fg-putaway-confidence.md).
  Exact child positions remain available, but are no longer mandatory for every
  open-area ledger posting.

## Context

ADR-0015 made every storage zone one final QR-addressable stack. That works for a
small floor stack but forces a planner to draw dozens of artificial zones for a
large bulk area and cannot express rack bays/levels or a raised platform. Making
the parent area itself a stock address would instead leave balances ambiguous.
Existing location IDs, ledger history, and printed QR labels must survive the
change.

## Decision

1. A **Storage Area** (the evolved meaning of the persisted `storageZones` row)
   is a large bounded floor region, not an ambiguous final stock address.
2. A **Storage Position** is the leaf address whose `locationId` is used by the
   ledger and balance projection.
3. Every area selects `SIMPLE`, `FLOOR_POSITIONS`, `RACK`, or `PLATFORM`.
   Missing mode is read as `SIMPLE`, and a simple area automatically owns one
   default position.
4. Floor positions carry named X/Y markers or grid cells. Ordinary floor stacks
   have no arbitrary free-form Z.
5. Rack positions are generated from stable fixture identity, bay, level, and
   slot. Elevation is derived from the rack level. Platform positions use the
   area's explicit base elevation.
6. An area scan auto-selects its sole active leaf. When several leaves are
   active, the operator must scan or choose an exact child.
7. Existing zones are backfilled with a default position that reuses their
   existing `locationId`, code, and `ISAS:LOCATION:1:<locationId>` QR payload.
8. Position identity is separate from geometry. Quick Change may move markers;
   occupied changes list affected LPNs and require confirmation, while occupied
   leaf deletion is refused.
9. Capacity remains advisory. Footprint fit and prohibited-location/storage-class
   compatibility remain hard constraints.

## Invariants

### Code-owned guarantees

- `INV-0017-01` Every new physical storage posting resolves to exactly one active
  leaf position.
- `INV-0017-02` Missing area mode means `SIMPLE`; simple creation also creates its
  default leaf.
- `INV-0017-03` Backfill reuses the historical location ID, code, and QR payload.
- `INV-0017-04` An area scan with multiple active leaves never guesses a child.
- `INV-0017-05` Floor positions cannot carry free-form elevation; rack and
  platform elevation is derived.
- `INV-0017-06` Geometry edits do not mutate leaf identity or QR values.
- `INV-0017-07` Occupied leaf deletion is hard-blocked.
- `INV-0017-08` Every table and index is organization-first and every function
  revalidates warehouse scope.

### Operational assumptions

- Rack bay, level, and slot numbering matches the physical labels installed at
  the site.
- A supervisor checks the named affected LPNs before confirming an occupied
  geometry change.
- Physical relocation is completed before its corresponding ledger movement.

## Consequences

- Existing sites keep working without rack setup or relabelling.
- A large area can be legible on the plan while inventory remains exact.
- The zone's historical location remains the default leaf; therefore an old QR
  scanned after more leaves are added deliberately opens exact-position choice.
- Inventory and movement views can render a breadcrumb resolved from the leaf.
- Generated rack positions add rows, but their count is bounded per area.

## Rejected alternatives

- **Make rack mandatory:** creates setup work for every simple floor stack.
- **Store stock on the area parent:** cannot answer where stock is inside a large
  area and makes scanning unsafe.
- **Encode geometry in QR:** moving a marker invalidates printed labels and
  history.
- **Free-form Z on every position:** implies unsupported 3D packing precision and
  allows impossible ordinary floor stacks.
- **Replace existing locations during migration:** breaks immutable history and
  deployed labels.

## Verification

- Pure tests cover legacy defaulting, floor elevation refusal, rack generation,
  and derived levels.
- Integration tests cover default-position creation/backfill, multi-position scan
  refusal, exact ledger movement, identity-stable geometry edits, rack generation,
  and occupied deletion refusal.
- Isolation/schema tests classify `storagePositions` and enforce organization-first
  indexes and warehouse scope.
- Component/accessibility tests cover the mode selector, position editor, and
  exact-position chooser in English and Thai.

## Release gates

Existing tenant isolation, authorization, ledger, Thai accessibility, and storage
layout gates apply. Pilot rack labels must be compared with generated breadcrumbs
before production use.

## References

- [ADR-0005](./0005-warehouse-location-and-stock-identity.md)
- [ADR-0015](./0015-qr-addressable-storage-stacks.md)
- [Storage planner requirements](../product/storage-building-planner/requirements.md)
- [Domain context](../../CONTEXT.md)
