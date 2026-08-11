# Quantities and unit-of-measure manual

Status: **Domain library, used by the inventory ledger.** Exact quantity arithmetic,
item-specific UOM profiles, rational conversions, parsing, comparison, and formatting
are implemented. Master-data screens for editing UOM profiles are not implemented.

## Who this is for

- Item master-data owners
- Developers building receipt, ledger, and reporting workflows
- Auditors reviewing quantity calculations

## Storage model

A quantity is `{ minorUnits, uom }` where `minorUnits` is a safe integer. One base
unit equals 1,000 minor units, so the supported precision is three decimal places.

Examples:

| Display              | Stored value                       |
| -------------------- | ---------------------------------- |
| `1 PCS`              | `{ minorUnits: 1000, uom: "PCS" }` |
| `0.125 KG`           | `{ minorUnits: 125, uom: "KG" }`   |
| `-2.5 L` ledger line | `{ minorUnits: -2500, uom: "L" }`  |

Do not store floating-point quantities. Do not round a conversion silently.

## Base and alternate UOMs

Each item has one base UOM. Alternate UOM conversion factors are exact reduced
rationals, for example one carton equals `12/1` base pieces.

The library can:

- convert alternate units to base;
- convert base units to an alternate;
- convert between two alternates through the base;
- compose or invert ratios;
- return an exact fraction when a result does not land on a whole minor unit.

UOM conversions are item-specific. Never apply an item's carton ratio to another
item that happens to use the same UOM code.

## Input procedure

1. Normalize the UOM code.
2. Parse the operator-entered decimal with `parseDecimalQuantity`; accept at most
   three fractional digits.
3. Validate the item UOM profile and requested alternate.
4. Convert exactly.
5. If the result is a whole minor unit, continue.
6. If the result is fractional, stop and ask the owning workflow/policy to resolve
   it. The library intentionally does not choose a rounding rule.

## Arithmetic rules

- Add/subtract only quantities with the same normalized UOM.
- Reject non-finite, non-integer, or out-of-range minor units.
- Reject overflow instead of wrapping or losing precision.
- Ledger transactions reject zero-quantity lines.
- Ledger line UOM must match the item's base UOM after validation.
- Formatting is presentation only; never parse a formatted locale string back into
  storage.

## Common errors

- invalid/empty/overlong UOM code;
- more than three decimal places;
- UOM mismatch during arithmetic;
- alternate UOM missing from the item profile;
- zero or invalid ratio denominator;
- conversion overflow;
- inexact result that requires an explicit business decision.

Map structured error codes to Thai/English messages in the client. Do not replace
the exact error with a rounded number.

## Master-data checklist

- Choose the smallest operationally meaningful base UOM.
- Keep all ledger posting quantities in that base UOM.
- Define each alternate factor as an exact ratio to the base.
- Test both conversion directions and a representative fractional edge case.
- Treat changes to a live item's conversion profile as controlled master-data
  changes because historical interpretation must remain explainable.

## Implementation references

- `convex/model/uom/quantity.ts`
- `convex/model/uom/ratio.ts`
- `convex/model/uom/itemUom.ts`
- `convex/model/inventory/ledgerTransaction.ts`
- [Exact quantity and UOM ADR](../adr/0004-exact-quantities-and-uom.md)
