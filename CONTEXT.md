# Domain Context

## Storage layout and stack placement

- **Storage building** — a warehouse-bound planning envelope containing numbered
  floors.
- **Storage floor** — one editable floor envelope. Its width, depth, height, and
  offset are integer millimetres.
- **Reserved block** — floor area that cannot hold stock. It is geometry only and
  never becomes an inventory location.
- **Storage zone** — one QR-addressable rectangular position on a storage floor.
  In the first release, one zone represents one vertical stack and owns exactly
  one active `FLOOR_BLOCK` inventory location.
- **Zone code** — a readable warehouse location code such as
  `BLDG-A-F04-Z03`.
- **Zone QR value** — the stable machine identifier
  `ISAS:LOCATION:1:<locationId>`. Printed QR labels remain valid when a zone's
  display label changes.
- **Handling unit** — the LPN/SSCC-labelled physical unit placed into a zone. A
  finished good enters this workflow as a handling unit, not as a second stock
  representation.
- **Stack placement** — the current vertical position of one handling unit in a
  storage zone. Level 1 is the bottom; increasing levels are above it.

## Invariants

1. A storage zone fits inside its floor and cannot overlap a reserved block or
   another active storage zone.
2. A handling unit footprint must fit the zone directly or after a 90-degree
   rotation.
3. Stack level is derived from the active placements below it; operators do not
   type a level.
4. Exceeding planned stack height is an explicit capacity warning. Footprint
   overflow is a hard refusal.
5. The inventory ledger is authoritative for physical stock location. A stack
   placement is written only in the same Convex transaction that moves every
   positive balance bucket on the handling unit to the zone's location.
6. A zone with stock or active placements cannot be archived.

## Relationships

```text
Storage building
  └─ Storage floor
       ├─ Reserved block (geometry only)
       └─ Storage zone ── owns ── Inventory location
            └─ Stack placement (level 1 bottom → level N top)
                 └─ Handling unit ── groups ── Inventory balance buckets
```
