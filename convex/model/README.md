# `convex/model` — pure domain modules

Plan §6.2 draws the line this directory enforces: **`convex/model/**` is pure
TypeScript domain logic with no Convex imports.** No `ctx`, no `db`, no
`v.object`, no document ids, no clock, and no randomness. Everything a function
needs arrives as an argument.

That is not stylistic. Three things depend on it:

- **Testability.** Every rule here is decidable from values, so the suites are
  ordinary function calls with no `convex-test` world and no fixtures.
- **Determinism inside a mutation.** A Convex mutation may be re-executed. A
  module that reads `Date.now()` or `Math.random()` cannot be replayed, which is
  why the clock and the entropy source are injected parameters
  (`identifiers/lpn.ts`) and why the GS1 parser takes a `referenceYear`
  (`gs1/date.ts`).
- **Lock-in containment** (§5 Q49). Convex is the deepest vendor dependency in
  the project. The algebra that decides what a quantity is, what a scan means,
  and which lot rotates first is the part that must survive a change of backend.

## What is here

| Module                          | Owns                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `result.ts`                     | The `Result<T, E>` every module returns; no exceptions for invalid input     |
| `uom/quantity.ts`               | Quantity as integer thousandths of a base UOM, and its total arithmetic      |
| `uom/ratio.ts`                  | Exact reduced rationals, composition, and exact integer scaling              |
| `uom/itemUom.ts`                | One item's base UOM plus alternate conversions, and item-scoped quantities   |
| `gs1/checkDigit.ts`             | The GS1 modulo-10 check digit (GTIN, SSCC)                                   |
| `gs1/date.ts`                   | `YYMMDD` with the GS1 century rule and explicit month-precision policy       |
| `gs1/elementString.ts`          | Element-string parsing for nine Application Identifiers, FNC1 handling       |
| `identifiers/normalization.ts`  | Raw scan, SKU, lot code, and GTIN normalization                              |
| `identifiers/lpn.ts`            | LPN namespaces, internal LPN generation and validation, SSCC as LPN          |
| `identifiers/scanResolution.ts` | The GS1 → LPN → GTIN → SKU precedence ladder with explicit rejection         |
| `time/businessDate.ts`          | Business date in a fixed-offset organization zone; Buddhist Era for display  |
| `rotation/stockRotation.ts`     | FIFO/FEFO total order with stable tie-breakers and per-candidate explanation |

## What is deliberately absent

- **The ledger.** `model/ledger/` in plan §8 does not exist. No posting, no
  balance, no reversal, no idempotency. These modules are the arithmetic the
  ledger will be built from, not a ledger.
- **Persistence of any kind.** No table stores a quantity, a business date, an
  LPN, or a parsed scan. Uniqueness (`INV-0005-05`), never-reuse, and
  item-to-GTIN resolution are all owed by mutations that do not exist yet.
- **Money.** THB minor units are a separate type with a separate scale
  (`INV-0004-07`) and are not modelled here.
- **Serial flows.** AI 21 parses; nothing consumes a serial while D-09 keeps the
  feature off.

## Conventions

- Values are immutable and frozen; constructors validate and return a `Result`.
- Errors are structured codes with fields, never prose: the UI owns translation
  (D-06), so an English sentence baked into an error is untranslatable.
- Nothing rounds. A conversion that does not land on a whole minor unit reports
  the exact fraction and lets the caller decide (`INV-0004-05`).
- No `Date` parsing, no `Intl`, no `localeCompare`, no floats in arithmetic, and
  no `BigInt` — a `BigInt` cannot be stored in a Convex document, so it would
  only move the rounding decision to the boundary.
- Every module states its own implementation status in its header, including what
  it does **not** support. A parser that claims an unimplemented format is worse
  than one that rejects it.
