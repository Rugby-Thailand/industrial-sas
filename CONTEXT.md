# Domain Context

## Storage layout and stack placement

- **Storage building** — a warehouse-bound planning envelope containing numbered
  floors.
- **Storage floor** — one editable floor envelope. Its width, depth, height, and
  offset are integer millimetres.
- **Reserved block** — floor area that cannot hold stock. It is geometry only and
  never becomes an inventory location.
- **Storage area / storage zone** — one mode-less bounded planning and policy
  region on a storage floor. It may contain open floor, racks, shelving, and
  raised platforms together. Without extra setup it is also a general-storage
  stock address meaning “somewhere in this area.”
- **Support surface** — a plane that can support storage positions or fixtures:
  the floor at Z = 0 or an approved raised-platform deck.
- **Storage fixture** — a physical rack, shelving system, or raised platform
  inside an area. It has its own geometry, engineering/inspection state, and
  lifecycle but is not itself a stock address.
- **Stock address** — the one location ID to which a physical balance and ledger
  posting resolve. It may be an area's general-storage address or an optional
  exact child position; an area balance is not an aggregate of its children.
- **Storage position** — an optional stable, more precise stock address inside a
  storage area. It is required for rack bays/levels/slots and whenever the site
  enables exact-child addressing, but not for undivided open-area storage.
- **Open-floor position** — a named marker or grid cell such as `P-12` or
  `GRID-B4` placed directly on a support surface without a rack or shelf.
- **Rack position** — a generated fixture/rack + bay + level + slot leaf. Its
  elevation is derived from its support surface and approved rack level.
- **Raised storage platform** — a fixture that creates an elevated support
  surface. Its approved classification, loads, access, guarding, and fire
  clearances are part of the fixture configuration, not an area mode.
- **Clearance/access zone** — geometry reserved for aisles, exits, stairs,
  guards, gates, fire protection, equipment turns, or inspection access. It is
  never a stock position.
- **Zone code** — a readable warehouse location code such as
  `BLDG-A-F04-Z03`.
- **Area/position QR value** — the stable machine identifier
  `ISAS:LOCATION:1:<locationId>`. Printed QR labels remain valid when a zone's
  display label or geometry changes. An area scan selects general-area storage
  unless that area explicitly requires an exact child; rack/slot scans always
  resolve to their exact position.
- **Handling unit** — the LPN/SSCC-labelled physical unit placed into a zone. A
  finished good enters this workflow as a handling unit, not as a second stock
  representation.
- **Stack placement** — the current vertical order of handling units at one leaf
  position. Level 1 is the bottom; increasing levels are above it.

## Invariants

1. A storage area fits inside its floor and cannot overlap a reserved block or
   another active area. Every fixture fits its parent support surface and area;
   every position fits its surface or fixture.
2. Solid fixtures with overlapping elevation ranges cannot intersect. Required
   clearance/access zones are hard no-overlap geometry.
3. Ordinary position Z is derived from its support surface. Rack/shelf position
   Z is derived from the surface plus its approved level; operators do not type
   arbitrary leaf elevation.
4. A handling unit footprint must fit its leaf position directly or after an
   allowed 90-degree rotation.
5. Stack level is derived from the active placements below it; operators do not
   type a level.
6. Planned utilization and stack height are advisory. Approved rack/platform
   loads, physical fit, prohibited storage classes, and life-safety clearances
   are hard limits.
7. The inventory ledger is authoritative for physical stock location. A stack
   placement is written only in the same Convex transaction that moves every
   positive balance bucket on the handling unit to one stock address. General
   area balances and child-position balances are separate, never double-counted.
8. An occupied stock address cannot be archived. Geometry or configuration
   changes affecting occupied addresses name the affected LPNs and require
   confirmation.
9. Position identity is independent of geometry. Moving a marker never changes
   its location ID, QR payload, ledger history, or printed label.
10. Existing area modes are migration input only. Historical leaf location IDs,
    QR values, placements, and history survive conversion to mode-less areas and
    child fixtures/support surfaces.

## Relationships

```text
Storage building
  └─ Storage floor
       ├─ Reserved / clearance zone (geometry only)
       └─ Storage area / zone (mode-less)
            └─ Floor support surface (Z = 0)
                 ├─ Open-floor position
                 ├─ Rack / shelving fixture → bay → level → leaf position
                 └─ Raised storage platform
                      └─ Platform support surface
                           ├─ Open-floor position
                           └─ Approved rack / shelving → leaf position

Storage area ── owns ── General-storage inventory location
  ├─ optional Storage position ── owns ── Exact inventory location
  └─ Stack placement at one chosen stock address
       └─ Handling unit ── groups ── Inventory balance buckets
```

## Finished-goods putaway recommendation

- **Production order affinity** — preference for an area already containing
  finished-good LPNs produced by the same production order.
- **Customer-order affinity** — preference for an area already containing LPNs
  for the same customer order. A customer order is the customer PO and internal
  sales order represented by one document; it is not a production order.
- **Customer affinity** — a weaker preference for an area containing other open
  finished goods for the same customer.
- **Recommendation confidence** — `HIGH`, `MEDIUM`, or `LOW`, derived from the
  provenance of item measurements and the reliability of destination occupancy
  and capacity data. Unknown is never treated as zero or as a verified fit.
- **Fit status** — `VERIFIED_FIT`, `ESTIMATED_FIT`, or `FIT_UNKNOWN`. Aggregate
  free square metres are only an estimate unless the system knows contiguous
  free geometry.

### Recommendation rules

1. Known storage-class, quality, prohibition, structural-load, clearance, and
   exact dimensional violations filter candidates before ranking.
2. Eligible destinations rank by same production order, same customer order,
   same customer, same finished-good item/package, usable space, then travel and
   fragmentation. These preferences never override a known hard violation.
3. A measured LPN may receive a verified-fit recommendation only when both its
   measurements and the destination geometry/capacity needed for that claim are
   trusted.
4. An unmeasured LPN falls back from a verified matching package/HU measurement,
   to a coarse handling-unit class, to a low-confidence general-area suggestion
   requiring visual confirmation, and finally to FG staging/measurement.
5. Confirmation revalidates the destination. Operator overrides preserve the
   recommendation, chosen address, confidence, and reason in the audit trail.

## Customer-order fulfillment routing

- **Released customer-product design** — the approved immutable design revision
  identified by the exact customer and customer product code. A merely similar
  design is not this design.
- **Design-required line** — a customer-order line for which no released
  customer-product design exists and Engineering must create or explicitly
  resolve one.
- **Customer-specific finished good** — a finished item identified for the
  customer's product and approved design, not any physically similar item.
- **Finished-goods availability** — the uncommitted quantity of that finished good
  eligible to satisfy a customer-order line. Physical on-hand already promised to
  other demand is not available.
- **Production shortage** — the part of a customer-order line not covered by
  available finished goods and therefore requiring production.
- **Material shortage** — the part of the production requirement not covered by
  eligible ingredient or raw-material inventory and therefore requiring
  purchasing demand.
