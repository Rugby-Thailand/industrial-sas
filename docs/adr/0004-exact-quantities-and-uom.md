# ADR-0004 — Exact quantities: integer base-UOM minor units and rational conversions

- ID: `ADR-0004`
- Status: **Accepted**
- Date: 2026-08-03
- Decision baseline: [PROJECT_PLAN.md](../../PROJECT_PLAN.md) §3.2 (D-07, D-08),
  §4 (B-12), §5 Q4, Q18, §12
- Covers plan ADR backlog (§11) items: 8
- Implementation status: **Partial.** The arithmetic exists and is pure:
  `convex/model/uom/quantity.ts` (integer thousandths of a base UOM, total
  arithmetic, a decimal parser that never uses a float, display formatting),
  `convex/model/uom/ratio.ts` (reduced rationals, exact composition, exact integer
  scaling with overflow reported rather than wrapped), and
  `convex/model/uom/itemUom.ts` (one base UOM per item, alternate conversions, and
  item-scoped quantities). `INV-0004-01`, `INV-0004-03`, `INV-0004-04`,
  `INV-0004-05`, and `INV-0004-06` hold for every path through those modules, and
  `convex/model/uom/quantity.ts` has no way to express a fraction of a minor unit.
  Those invariants hold **against a forged value as well as a constructed one**:
  every public function re-validates its operands and returns a `Result`, because
  `Ratio` and `Quantity` are interfaces and a factor read back from a document is
  exactly what a cast can produce. A zero, negative, non-integer, or non-finite
  factor is a named error rather than stock scaled to nothing, a flipped sign, or a
  non-terminating gcd; an item's conversion table is a frozen array rather than a
  `ReadonlyMap` that a cast can reopen; and `formatQuantity` returns a `Result`
  because "the digits shown are the digits stored" (§5) is only true of a validated
  value — and it validates its display options first, since a non-boolean
  `trimTrailingZeros` read as truthy is how two screens disagree about one
  quantity. `alternateUoms` returns a `Result` for the same reason: `UomCode` is an
  alias for `string`, so an unvalidated profile made it answer with values no
  normalizer would ever have issued.
  What is **not** implemented: no table stores a quantity or a conversion
  (`itemUoms` does not exist), so `INV-0004-02` — an immutable base UOM once
  ledger lines reference the item — has nothing to enforce it; there is no ledger,
  balance, or aggregate (`ADR-0003`); and money (`INV-0004-07`) is entirely absent,
  which currently satisfies "never mixed with quantity" by omission rather than by
  design. The zero-quantity gate (`INV-0004-08`) exists as
  `requireNonZeroQuantity`, with no posting to call it.

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

Partly present; the rest is planned.

Implemented now, over the pure modules:

- Unit tests (`convex/model/uom/*.test.ts`): scale and bounds, the decimal parser's
  rejections (a fourth decimal, an exponent, a thousands separator, non-ASCII
  digits), UOM mismatch, per-item conversion including alternate-to-alternate
  composition, and the `ITEM_MISMATCH` case that a UOM check alone cannot see. A
  block per module covers forged values specifically: a `1/0`, `0/1`, `1/-1`, or
  non-finite factor rejected rather than used (the last of which used to reach a gcd
  that never returned), a forged quantity refused by every arithmetic and formatting
  path, and an item profile whose conversion table cannot be rewritten through a
  cast.
- Property tests (`tests/properties/quantity-uom.property.test.ts`): reduction is
  canonical and produces coprime components; composition is commutative,
  associative where defined, and has the unit ratio as identity; an exact
  conversion round-trips; an inexact one reports a value equal to the true fraction
  by cross-multiplication; no path returns a non-safe integer; quantities
  round-trip through their decimal form. The reduction property uses a gcd written
  for the test rather than the module's own, which is no longer exported: a public
  gcd loops forever on a non-finite operand. Three negative controls assert that the
  suite fails against a rounding conversion, an unguarded multiply, and a
  truncating parser.
- Integration tests (`tests/integration/inbound-primitives.integration.test.ts`):
  conversion composed with a scanned GS1 label and a Bangkok business date, with no
  Convex.

Still planned, because the ledger does not exist:

- No accumulated-error test across a long posting sequence, no replay-equals-
  projection property, and no test that a receipt in an alternate UOM posts exact
  base quantities.
- No static check that ledger quantity fields are integers, because there are no
  ledger fields. `pnpm verify:tenant-boundary` does enforce that these modules stay
  free of Convex imports (`model-purity`).

## Release gates

- `RG-016` Ledger replay equals projection (depends on exact arithmetic).
- `RG-020` UOM conversion property suite green (plan §12 unit/property tests).
- Register: [release gates](../release-gates.md).

## References

- Plan §3.2 (D-07, D-08), §4 (B-12), §5 Q4, Q18, §7.4, §10 Phase 2, §12.
- [ADR-0003 — Append-only balanced inventory ledger](./0003-append-only-inventory-ledger.md)
- [ADR-0005 — Warehouse, location, and stock identity](./0005-warehouse-location-and-stock-identity.md)
- [Domain glossary](../domain-glossary.md)
