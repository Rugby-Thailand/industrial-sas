# ADR-0018 — General-area stock and confidence-aware FG putaway

- ID: `ADR-0018`
- Status: **Accepted**
- Date: 2026-08-28
- Decision baseline: operator feedback after storage-location browser QA and
  primary-source WMS research
- Implementation status: **Not implemented**
- Evolves: [ADR-0017](./0017-storage-areas-and-leaf-positions.md)

## Context

ADR-0017 protects exact stock identity by requiring every balance to resolve to
a child Storage Position. In practice that makes a site configure positions even
when a bounded open Area is already a sufficient operational address. Finished
goods also need a destination recommendation immediately after completion,
including when the current LPN has not been measured.

The system must preserve truthful traceability without implying precision it does
not have. It also must not make racks, platforms, grids, or one artificial
default Position prerequisites for ordinary open-area putaway.

## Decision

1. Every active Storage Area owns a stable general-storage stock address using
   its existing location ID and QR. It is usable without selecting an area mode
   or creating a child Position.
2. A Storage Position is optional additional precision. Rack bay/level/slot
   destinations are exact Positions; open floor and platform Positions are
   created only when the site needs them.
3. Every physical balance and ledger line resolves to exactly one **stock
   address**, which may be the Area or a child Position. An Area balance means
   “somewhere in this Area” and is not an aggregate of its child balances.
4. Areas may hold general-area stock and exact child-position stock at the same
   time. A site may enable `exact child required` for future putaways without
   invalidating existing Area stock, history, IDs, or labels.
5. Putaway builds eligible destinations by applying known hard constraints
   first. It then ranks by same production order, same customer order, same
   customer, same finished-good item/package, usable-space fit, travel, and
   fragmentation. The persisted trace explains every applied signal.
6. A recommendation carries measurement provenance, `HIGH`/`MEDIUM`/`LOW`
   confidence, and `VERIFIED_FIT`/`ESTIMATED_FIT`/`FIT_UNKNOWN` fit status.
7. For a measured LPN, exact dimensions, weight, compatibility, and trusted
   destination capacity can be eligibility filters. Aggregate free floor area is
   only advisory unless contiguous free geometry is known.
8. For an unmeasured LPN, the fallback order is a verified matching package/HU
   measurement, a coarse handling-unit class, a low-confidence general-Area
   suggestion with visual confirmation, then FG staging/measurement when no safe
   general destination is available.
9. Confirmation revalidates the destination. A preference may be overridden
   with an audited reason; a known prohibition, quality block, physical-fit
   failure, clearance violation, or engineered load violation may not.

## Invariants

### Code-owned guarantees

- `INV-0018-01` A ledger line names one stock address and never double-posts the
  same quantity to both an Area and its child.
- `INV-0018-02` Area-level balances and child-position balances are distinct;
  hierarchy rollups are computed reads, not duplicate physical balances.
- `INV-0018-03` Existing Area location IDs, QR payloads, balances, and history
  remain stable.
- `INV-0018-04` Unknown measurement or capacity data is never converted to zero
  or presented as a verified fit.
- `INV-0018-05` Known hard constraints filter candidates before affinity scoring.
- `INV-0018-06` Recommendation confirmation rechecks eligibility against current
  stock and configuration.
- `INV-0018-07` The recommendation, score reasons, confidence, chosen address,
  and override reason are tenant-scoped audit evidence.

### Operational assumptions

- Production-order, customer-order, and customer relationships on completed
  finished goods are accurate enough to support co-location preferences.
- A verified reusable package measurement names the same item/design, package or
  HU type, pack quantity, and relevant revision.
- Visual confirmation means the operator checks the actual footprint and safe
  access; it is not engineering approval for an unrated rack or platform.

## Consequences

- A site can draw an Area and immediately store finished goods there; detailed
  structure remains progressive setup.
- Traceability is honest but variable in precision: Area-level stock is known to
  the Area, while rack/child stock is known to its exact address.
- Same-order/customer grouping improves outbound consolidation but stays a soft,
  explainable preference.
- “Available area” must be labelled verified, estimated, or unknown. A simple
  square-metre subtraction cannot prove that a rectangular LPN fits fragmented
  free space.
- The implemented ADR-0017 position-only mutation and scan behavior must be
  migrated before this decision is shipped.

## Rejected alternatives

- **Require a default Position for every Area:** preserves artificial precision
  but adds setup and an extra concept with no operational value for open storage.
- **Treat the Area balance as a rollup of child balances:** double-counts physical
  stock when stored and computed representations are confused.
- **Require measurement before every putaway:** blocks low-risk general storage
  even when order/customer grouping and visual confirmation are useful.
- **Assume an unmeasured LPN fits:** turns missing evidence into a false safety
  claim.
- **Rank same customer or order ahead of hard compatibility:** creates unsafe or
  prohibited placements.
- **Use aggregate free square metres as exact fit:** ignores fragmented geometry.

## Verification

- Model tests cover Area and child stock-address posting without duplication,
  stable migration IDs, hard-filter precedence, deterministic affinity ranking,
  measurement provenance, confidence, and fragmented-area behavior.
- Integration tests cover measured and unmeasured LPN recommendations, stale
  recommendation revalidation, audited override, general-Area scan completion,
  and exact-child-required policy.
- Tenant isolation tests cover candidate facts, recommendation traces, balances,
  and audit reads.
- Thai/English component and accessibility tests cover confidence, fit status,
  reasons, alternatives, Measure now, visual confirmation, and FG staging.

## Release gates

Existing inventory-ledger, tenant-isolation, authorization, Thai accessibility,
and storage-layout gates apply. Pilot operations must validate the default
affinity order and the policy for allowing low-confidence general-Area putaway.

## References

- [ADR-0003](./0003-append-only-inventory-ledger.md)
- [ADR-0005](./0005-warehouse-location-and-stock-identity.md)
- [ADR-0017](./0017-storage-areas-and-leaf-positions.md)
- [Finished-goods putaway research](../research/fg-putaway-recommendation-measured-and-unmeasured.md)
- [Domain context](../../CONTEXT.md)
