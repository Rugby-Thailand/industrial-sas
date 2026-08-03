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
| `guards.ts`                     | Structural guards and the frozen containers that make immutability a fact    |
| `uom/quantity.ts`               | Quantity as integer thousandths of a base UOM, and its total arithmetic      |
| `uom/ratio.ts`                  | Exact reduced rationals, composition, and exact integer scaling              |
| `uom/itemUom.ts`                | One item's base UOM plus alternate conversions, and item-scoped quantities   |
| `gs1/checkDigit.ts`             | The GS1 modulo-10 check digit (GTIN, SSCC)                                   |
| `gs1/date.ts`                   | `YYMMDD` with the GS1 century rule and explicit month-precision policy       |
| `gs1/elementString.ts`          | Element-string parsing for nine Application Identifiers, FNC1 placement      |
| `identifiers/normalization.ts`  | Raw scan, SKU, lot code, and GTIN normalization                              |
| `identifiers/lpn.ts`            | LPN namespaces, internal LPN generation and validation, SSCC as LPN          |
| `identifiers/scanResolution.ts` | The GS1 → LPN → GTIN → SKU precedence ladder with explicit rejection         |
| `time/businessDate.ts`          | Business date in a fixed-offset organization zone; Buddhist Era for display  |
| `rotation/stockRotation.ts`     | FIFO/FEFO total order with stable tie-breakers and per-candidate explanation |

## The boundary a cast cannot walk through

Every type here is an interface or a `string` alias, and TypeScript erases both.
These modules will be fed by Convex documents, HTTP bodies, and scanners, so the
values they meet are exactly the values a cast can forge:

```ts
const factor = { numerator: 1, denominator: 0 } as Ratio; // compiles
const day = { year: 2026, month: 13, day: 40 } as BusinessDate; // compiles
(scan.byAi as Map<string, string>).set("01", "…"); // compiled, and mutated
```

So four rules hold across the directory, and are tested rather than asserted:

1. **Every public function re-validates what it is handed** and returns a
   `Result`. That is why `compareRatios`, `formatQuantity`, `businessDateToIso`,
   and `compareBusinessDates` answer a result instead of a bare value: an
   unvalidated operand would otherwise sort by `NaN` or render `NaN.NaN` onto an
   operator's screen. `alternateUoms` answers one for the same reason at one
   remove — its declared `readonly UomCode[]` is an alias for `readonly string[]`,
   so a forged profile made it hand back a number or an object as a UOM code, and
   an entry it could not read was dropped rather than named. The argument the
   caller chose is validated too, and first: `formatQuantity`'s options bag and
   `formatBusinessDate`'s `DisplayCalendar` are both forgeable, and blaming the
   value would send the caller looking in the wrong place.
2. **Nothing throws, and nothing loops.** A domain error is a value. The one
   non-obvious case: Euclid's algorithm exits on `b !== 0`, and every remainder of
   a non-finite operand is `NaN`, so a forged conversion factor that reached the
   gcd never returned. `greatestCommonDivisor` is therefore private and every
   caller validates first.
3. **Every value these modules construct is frozen, and `Object.freeze` is
   shallow.** `readonly` and `ReadonlyMap` are compile-time claims; a `Map` typed
   `ReadonlyMap` is still a `Map`. So the supported-AI table, the timezone
   registry, an item's conversion table, and a parsed scan's values are frozen
   null-prototype records or frozen arrays, and `ok`/`fail` freeze the wrapper.
   Shallowness is the limit, and it is worth stating rather than implying:
   `ok(value)` freezes `{ ok, value }` and nothing under `value`, so a returned
   value is immutable all the way down only because whatever built it froze its own
   output too. The discriminated outcome envelopes are the deliberate exception —
   `ScaledInteger` and `UomConversionOutcome` are plain objects around frozen
   payloads, because a caller reads `kind` at the call site and keeps the
   `Quantity` or the `ExactFraction`, never the envelope. Null prototypes matter
   for the lookups keyed on scanned input: with `Object.prototype` in the chain,
   `byAi["toString"]` answers a function while the type promises a string.
4. **An injected dependency that misbehaves is a `Result`.** A clock outside the
   representable window, an entropy source that throws, returns the wrong number
   of bytes, returns something that is not a `Uint8Array` at all, is a
   `Uint8Array`-shaped `Proxy` whose reads throw, or is not a function at all —
   each is a named error from `generateInternalLpn` rather than an exception
   crossing the boundary.

Two semantic rules exist for the same reason — a plausible reading is not an
acceptable answer:

- **Expired means the expiration date has passed**, whatever `rotationDateSource`
  a tenant configures (§5 Q23). The rotation source chooses the _order_; reading
  expiry off it made an old manufacture date look like an expiry and, worse, made a
  passed expiry look fine.
- **A scan is classified or refused, never guessed.** A valid bare SSCC with the
  tenant's `bareSscc` off, an internal LPN with no namespace policy to judge it by,
  and a scan matching a registered prefix whose check character is wrong are each a
  named rejection — not a lot code, a GTIN, or a SKU. The policy that decides all
  of that is itself refused if a prefix is claimed twice: the rung that answers
  whose pallet a scan is matches a registered prefix and nothing else, so a table
  holding one prefix for two organization keys would make that answer meaningless.
  Overlapping prefixes are not the same thing and stay legal — `PA` and `PAB` imply
  different scan lengths, so they claim different scans and declaration order cannot
  change the answer.

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

- Values are immutable and frozen at run time, not only `readonly` in the type;
  constructors validate and return a `Result`, and so does every operation that
  could be handed a forged value. `Object.freeze` is shallow, so each constructor
  freezes its own output rather than trusting that its caller will.
- Errors are structured codes with fields, never prose: the UI owns translation
  (D-06), so an English sentence baked into an error is untranslatable.
- Nothing rounds. A conversion that does not land on a whole minor unit reports
  the exact fraction and lets the caller decide (`INV-0004-05`).
- No `Date` parsing, no `Intl`, no `localeCompare`, no floats in arithmetic, and
  no `BigInt` — a `BigInt` cannot be stored in a Convex document, so it would
  only move the rounding decision to the boundary.
- No unbounded loop, and no comparator exported without validation: `sort` calls a
  comparator with whatever the array holds, and one `NaN` comparison makes a
  "total" order silently intransitive.
- Every module states its own implementation status in its header, including what
  it does **not** support. A parser that claims an unimplemented format is worse
  than one that rejects it.
