# ADR-0004 — Exact quantities: integer base-UOM minor units and rational conversions

- ID: `ADR-0004`
- Status: **Accepted**
- Date: 2026-08-03
- Decision baseline: [PROJECT_PLAN.md](../../PROJECT_PLAN.md) §3.2 (D-07, D-08),
  §4 (B-12), §5 Q4, Q18, §12
- Covers plan ADR backlog (§11) items: 8
- Implementation status: **Not implemented.** No UOM model, conversion module, or
  quantity type exists.

## Context

Inventory arithmetic must be exact. Floating-point quantities accumulate error
across thousands of postings, and a ledger that must balance to zero cannot
tolerate `0.30000000000000004`. Suppliers deliver in cases, pallets, and rolls
while stock is counted in a base unit, so conversion is unavoidable — and a
lossy conversion silently invents or destroys stock.

The launch scope excludes catch-weight products and caps quantity precision at
three decimals (B-12).

## Decision

1. **One base UOM per item.** Every item declares exactly one base UOM. All
   ledger lines and balances are expressed in integer minor units of that base
   UOM (D-08).
2. **Integers only in the ledger.** No inventory quantity is stored as a
   floating-point number anywhere in the ledger, balances, or aggregates.
   Precision is at most three decimals, represented as a fixed integer scale
   (B-12).
3. **Exact rational conversions.** An alternate UOM declares a conversion as an
   exact rational (`numerator` / `denominator`) to the base UOM. Conversion is
   performed with integer arithmetic (§5 Q18).
4. **Reject non-exact entry.** If a captured quantity in an alternate UOM does not
   convert to a whole number of base minor units, the entry is rejected with an
   explanatory error. The system never rounds an input quantity into the ledger
   (§5 Q18).
5. **Rounding is display-only.** Presentation may round for readability; the
   underlying value is never mutated by formatting.
6. **Metric plus count UOMs.** The MVP UOM set is metric measures plus count
   units (D-08). No unit-system conversion (imperial) is offered.
7. **Money is separate and also integral.** THB with integer minor units, single
   currency per organization (D-07). Money never shares a type with quantity.
8. **No catch-weight.** Actual-weight capture per item or handling unit is out of
   scope; if a launch tenant needs it, B-12 must be reopened before the ledger
   schema is fixed.

## Invariants

### Code-owned guarantees

- `INV-0004-01` Inventory quantities are integers in base-UOM minor units;
  no float type appears in ledger, balance, or aggregate documents.
- `INV-0004-02` Each item has exactly one base UOM, and it is immutable once any
  ledger line references the item.
- `INV-0004-03` Every alternate UOM conversion is an exact rational with a
  non-zero denominator.
- `INV-0004-04` Conversion is exact and reversible: converting to base and back
  yields the original quantity, or the input is rejected.
- `INV-0004-05` An entry that does not convert to a whole number of base minor
  units is rejected, never rounded.
- `INV-0004-06` Quantity precision never exceeds three decimals (B-12).
- `INV-0004-07` Monetary amounts are integer THB minor units and are never mixed
  with quantity values in arithmetic.
- `INV-0004-08` Zero-quantity postings are impossible
  (`INV-0003-03` in [ADR-0003](./0003-append-only-inventory-ledger.md)).

### Operational assumptions

- `OPS-0004-01` Master-data owners define correct base UOMs before receiving
  begins; a wrong base UOM is expensive to correct after postings exist.
- `OPS-0004-02` Supplier pack quantities are exact multiples of the base unit for
  MVP items (B-12).
- `OPS-0004-03` Operators are trained that a rejected quantity means a data or
  packaging problem, not a system fault.

## Consequences

- Some legitimate supplier packs cannot be received until master data declares an
  exact conversion. This is deliberate friction with a clear error message.
- Three decimals plus an integer scale bounds the representable range; the
  chosen scale must be documented per UOM and verified against the B-11 volume
  envelope.
- Reporting must format quantities through one shared formatter to avoid
  divergent rounding across screens and exports.
- Adding catch-weight later means an additional actual-weight dimension, not a
  change to the base-UOM ledger, provided this ADR holds.

## Rejected alternatives

| Alternative                        | Why rejected                                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| Floating-point quantities          | Accumulates error; makes a balanced ledger impossible to prove (§5 Q18).                       |
| Decimal strings parsed at each use | Pushes precision decisions into every call site and invites inconsistent rounding.             |
| Rounding non-exact conversions     | Silently creates or destroys stock; the loss surfaces later as unexplainable drift.            |
| Multiple base UOMs per item        | Makes bucket identity ambiguous and breaks balance comparison.                                 |
| Free-form UOM text                 | Unqueryable, untranslatable, and impossible to convert.                                        |
| Catch-weight support in MVP        | Requires per-unit actual weight capture, new capture UI, and different ledger identity (B-12). |
| Multi-currency in MVP              | No pilot requirement; adds rate sourcing, revaluation, and reporting complexity (D-07).        |

## Verification

Planned, not present.

- Property tests: conversion round-trips exactly for all generated rational
  conversions; no accumulated error across long posting sequences; rejection of
  non-exact conversions; precision never exceeds three decimals.
- Unit tests: base/alternate UOM definition rules, immutability of base UOM,
  formatter behaviour, THB minor-unit arithmetic.
- Integration tests: receipt capture in an alternate UOM posts exact base
  quantities; rejected conversions produce a structured, translatable error.
- Static checks: quantity fields typed as integer minor units; no float literals
  in ledger paths.

## Release gates

- `RG-016` Ledger replay equals projection (depends on exact arithmetic).
- `RG-020` UOM conversion property suite green (plan §12 unit/property tests).
- Register: [release gates](../release-gates.md).

## References

- Plan §3.2 (D-07, D-08), §4 (B-12), §5 Q4, Q18, §7.4, §10 Phase 2, §12.
- [ADR-0003 — Append-only balanced inventory ledger](./0003-append-only-inventory-ledger.md)
- [ADR-0005 — Warehouse, location, and stock identity](./0005-warehouse-location-and-stock-identity.md)
- [Domain glossary](../domain-glossary.md)
