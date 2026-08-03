# ADR-0005 — Warehouse and location model, stock identity, handling units, and identifiers

- ID: `ADR-0005`
- Status: **Accepted**
- Date: 2026-08-03
- Decision baseline: [PROJECT_PLAN.md](../../PROJECT_PLAN.md) §3.2 (D-09, D-10,
  D-11, D-13, D-15), §4 (B-06), §5 Q17, Q19, Q22, Q23, Q24, Q29, §7.2, §7.4
- Covers plan ADR backlog (§11) items: 9, 10, 13
- Implementation status: **Partial, and only for identifiers and rotation
  ordering.** No location, lot, or handling-unit schema exists. A `warehouses`
  table is declared in `convex/schema.ts`, reduced to tenant-scoped identity and
  status, because warehouse scope is an input to every authorization decision; none
  of the hierarchy, capacity, or storage-class model in this ADR is present.

  What is implemented, as pure modules with no Convex imports:

  - `convex/model/gs1/checkDigit.ts` — the GS1 modulo-10 check digit.
  - `convex/model/gs1/date.ts` — `YYMMDD` with the century rule against an injected
    reference year, and an explicit policy for a `00` day.
  - `convex/model/gs1/elementString.ts` — element-string parsing for nine AIs (00,
    01, 10, 11, 15, 17, 21, 30, 37) with fail-closed FNC1 placement. Every other AI
    is rejected as unknown, and a separator in a position the specification has no
    reading for — leading, doubled, trailing, or after a predefined-length field —
    is `UNEXPECTED_SEPARATOR` rather than a skipped character.
  - `convex/model/identifiers/normalization.ts` — raw scan, SKU, lot code, and GTIN
    normalization, with leading zeros preserved and lot case preserved.
  - `convex/model/identifiers/lpn.ts` — LPN namespaces, internal LPN generation and
    validation with an internal check character, and SSCC as LPN (D-15). A clock or
    entropy source that misbehaves — one that throws, one that returns the wrong
    number of bytes, and one that returns any value this module will not read as a
    `Uint8Array` — is a named error, not an exception at the boundary. An
    organization key goes through the same normalizer a SKU does, so a key carrying
    internal whitespace or a category-C code point cannot become a second key for
    one tenant.
  - `convex/model/identifiers/scanResolution.ts` — the parser precedence of §13,
    with ambiguity, foreign namespaces, and GS1 content errors all rejected
    explicitly (`INV-0005-11`). Three further readings are refusals rather than
    fall-throughs: a valid bare SSCC while the tenant has not enabled bare SSCCs
    (`10` + 16 digits is both a lot element string and, for some digit strings, a
    valid SSCC), a well-formed internal LPN with no namespace policy to say whose it
    is, and a scan matching a registered prefix and length whose check character is
    wrong. A policy claiming one prefix for two organization keys is refused before
    it classifies anything, because matching a prefix is the whole basis of the
    foreign-namespace answer.
  - `convex/model/rotation/stockRotation.ts` — FIFO/FEFO as a strict total order
    with documented tie-breakers and a per-candidate explanation
    (`INV-0005-10`). Expiry is the candidate's **expiration date** against an
    explicit `asOf`, independent of the configured rotation date source: the source
    (§5 Q23) decides the order, and deriving expiry from it both called an old
    manufacture date an expiry and let a passed expiry rank as usable.

  Everything above validates the values it is handed and returns a `Result`; a
  `BusinessDate`, a `Gs1Scan`, an `LpnNamespace`, and a rotation candidate are all
  interfaces, so a cast or a document read is exactly the value that reaches them.
  Nothing these modules return is mutable at run time either — a parsed scan's
  `byAi` and the supported-AI table are frozen null-prototype records rather than
  `ReadonlyMap`s a cast can reopen.

  What is **not** implemented: `INV-0005-01` through `INV-0005-09` and
  `INV-0005-12` all need tables or mutations that do not exist. In particular LPN
  uniqueness and never-reuse (`INV-0005-05`) cannot be enforced by a value module —
  it can only make a collision unlikely and a typo detectable — and the raw scan is
  returned for persistence rather than persisted. Serial parsing (AI 21) exists;
  serial _flows_ remain off (D-09).

## Context

Bucket identity decides what the ledger can express, and it is the most expensive
thing to change after real receipts exist — hence B-06 is a Phase 0 blocking
decision. The same choice determines whether FEFO, quarantine, consignment, and
pallet moves are natural operations or workarounds.

Physical warehouses also need a location vocabulary the pilot site recognises, and
identifiers that survive both GS1-licensed suppliers and unlabelled internal
pallets.

## Decision

### Locations

1. **Materialized hierarchy.** Locations form a tree with a materialized path and
   semantic location types (receiving dock, staging, rack bin, floor block,
   quarantine, overflow, virtual boundary) (§5 Q22).
2. **Capacity is advisory; compatibility is hard.** Volumetric/weight capacity
   warns but does not block in the MVP. Storage-class incompatibility and
   prohibited locations are hard constraints (D-13).
3. **Re-parenting is rare and audited.** Moving a location within the hierarchy is
   an explicit audited operation, not a routine edit (§5 Q22).
4. **Virtual boundary locations** represent everything outside the warehouse
   (supplier, scrap, adjustment counterparty) so the ledger balances
   ([ADR-0003](./0003-append-only-inventory-ledger.md)).

### Stock identity

5. **Tracking modes.** `NONE`, `LOT`, `LOT_SERIAL` are modeled; `NONE` and `LOT`
   are implemented, and serial flows stay feature-disabled with a serial-ready
   schema (D-09, B-06).
6. **Lots.** Uniqueness is item + lot code. Lots carry manufacture, expiry, and
   best-before business dates; the rotation date is configurable; FEFO
   tie-breakers are deterministic; shelf-life exceptions are captured at receipt
   (§5 Q23).
7. **Status and owner are orthogonal.** `stockStatus` (for example `AVAILABLE`,
   `QC_HOLD`, `QUARANTINE`, `REJECTED`, `SCRAP`) and optional `ownerId` are
   independent bucket dimensions. Client-owned/consigned stock stays disabled
   unless a launch tenant needs it (D-11).
8. **Reclassification is a movement.** Changing status or owner is a paired ledger
   posting, never a row edit. Expiry becomes an explicit scheduled status
   transaction (§5 Q19).

### Handling units

9. **Pallets are handling units** with immutable LPN history. Split, merge,
   relabel, nest, and unnest are explicit audited transactions; a handling unit
   never occupies two locations at once (D-10, §5 Q24).
10. **Mixed SKU/lot is modeled but off by default**, and one nesting level is
    schema-ready (D-10).
11. **Identifiers are never reused.** An LPN, once issued, is never reissued for a
    different handling unit (§5 Q24).

### Identifiers and barcodes

12. **GS1 when licensed, internal otherwise.** Use GS1-128/SSCC where the tenant
    has a GS1 prefix; otherwise use an internal check-digit LPN encoded in Code
    128 (D-15, §5 Q24).
13. **Parser precedence.** Parse GS1 Application Identifiers first, then internal
    LPN, then GTIN/SKU, and otherwise reject explicitly with the raw scan
    retained (§5 Q29).
14. **Raw scan capture.** The raw scanned string is stored alongside the parsed
    interpretation so a mis-parse is diagnosable after the fact (plan §3.3).

## Invariants

### Code-owned guarantees

- `INV-0005-01` A location belongs to exactly one warehouse, and its warehouse
  never changes.
- `INV-0005-02` A lot is unique within `(orgId, itemId, lotCode)` and belongs to
  its item.
- `INV-0005-03` Stock status and owner are independent bucket dimensions; changing
  either requires a balanced paired posting, never a document update.
- `INV-0005-04` A handling unit has at most one current location; contents and
  location changes are recorded as transactions.
- `INV-0005-05` LPNs are unique per organization and never reused.
- `INV-0005-06` Mixed SKU/lot content in one handling unit is rejected unless the
  tenant setting is enabled.
- `INV-0005-07` Nesting depth never exceeds one level.
- `INV-0005-08` Serial-tracked flows are rejected while the serial feature flag is
  off, and enabling it later does not change ledger line identity.
- `INV-0005-09` Storage-class incompatibility and prohibited-location rules block
  a posting; capacity overflow only warns (D-13).
- `INV-0005-10` FEFO ordering is deterministic, with documented tie-breakers.
- `INV-0005-11` An ambiguous or invalid barcode is rejected explicitly; it never
  falls through to a guessed interpretation.
- `INV-0005-12` The raw scan string is persisted with every parsed scan.

### Operational assumptions

- `OPS-0005-01` The pilot site's location vocabulary is reviewed and accepted
  before master data is loaded (§5 Q22).
- `OPS-0005-02` The tenant's GS1 prefix status is confirmed before label design
  (`RG-005`, D-15).
- `OPS-0005-03` Supplier labels are inconsistent, so a real sample corpus is
  required to trust the parser (plan §3.3, `RG-005`).
- `OPS-0005-04` The rotation-date policy per item class is confirmed with the
  pilot tenant (§5 Q23).
- `OPS-0005-05` Physical pallets are labelled and handled so that LPN history
  reflects reality; the system cannot detect an unlabelled physical merge.

## Consequences

- The bucket key has nine dimensions, which keeps buckets narrow (good for
  contention) but makes balance queries index-sensitive.
- Serial readiness costs schema fields that stay unused in the MVP; that is the
  agreed price of not re-keying the ledger later (B-06).
- Advisory capacity means the system can suggest a location that physically does
  not fit; putaway must surface the warning clearly
  ([ADR-0007](./0007-inbound-slice-scope.md)).
- Consignment stays modeled-but-off, so enabling it is a settings change plus
  tests, not a schema migration.
- Explicit barcode rejection will feel strict at go-live; the sample corpus is what
  keeps rejection rare.

## Rejected alternatives

| Alternative                                 | Why rejected                                                                                          |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Status as a mutable field on a balance row  | Loses the movement history and lets quarantine happen without evidence (§5 Q19).                      |
| Owner folded into status                    | Conflates a legal dimension with a quality dimension; blocks 3PL/consignment later (D-11).            |
| Serial tracking implemented in MVP          | Large UI and volume cost with no launch requirement (D-09); schema readiness is enough.               |
| Pallets as a location subtype               | Handling units move between locations; modelling them as locations breaks the hierarchy and capacity. |
| Unlimited nesting                           | Query and UI complexity grows fast with no pilot need (D-10).                                         |
| Reusing LPNs after a pallet is consumed     | Destroys traceability; a rescan of an old label would resolve to new stock (§5 Q24).                  |
| Hard capacity enforcement in MVP            | Requires trustworthy dimensional master data that the pilot will not have (D-13).                     |
| Best-effort barcode guessing                | Silently posts stock against the wrong item or lot; explicit rejection is safer (§5 Q29).             |
| Adjacency-list-only hierarchy without paths | Makes zone/subtree queries recursive and slow for dashboards and putaway filters.                     |

## Verification

Partly present for identifiers and rotation; everything else is planned.

Implemented now:

- Unit tests (`convex/model/gs1/*.test.ts`, `convex/model/identifiers/*.test.ts`,
  `convex/model/rotation/stockRotation.test.ts`): check digits against
  hand-computed GS1 examples; the parser's rejections (unknown AI, truncated fixed
  field, over-long variable field, bad check digit, impossible date, duplicate AI,
  character outside AI encodable set 82, separator in an impossible position);
  normalization that preserves leading zeros and lot case; LPN generation from an
  injected clock and entropy, including a source that throws; rotation
  tie-breakers, exclusions, and explanations; expiry decided by the expiration date
  under every rotation source; and the scan refusals that used to be
  fall-throughs — a disabled bare SSCC, an LPN with no namespace policy, and a
  damaged LPN under a registered prefix. Forged values get their own cases: a
  parsed scan and the supported-AI table cannot be mutated through a cast, and an
  impossible `BusinessDate` is an error rather than a sort key.
- Property tests (`tests/properties/identifiers.property.test.ts`,
  `tests/properties/stock-rotation.property.test.ts`): normalization is idempotent
  and keeps zero-padded codes distinct; a computed GS1 check digit always verifies
  and every single-digit error is caught; element strings round-trip; the LPN check
  character catches **every** single-character substitution and **every**
  transposition of two different characters, which is provable because the alphabet
  has 31 symbols and 31 is prime; the rotation comparator is irreflexive,
  antisymmetric, transitive, and total, and ordering is invariant under input
  permutation; expiry equals "the expiration date is before `asOf`" for every
  strategy and rotation source; and every separator position outside the grammar is
  refused. Negative controls assert the suite fails against a constant check
  character, an unweighted checksum, a zero-trimming normalizer, an unverified
  GTIN, a comparator with no final tie-breaker, and expiry read off the configured
  rotation date.
- Integration tests (`tests/integration/inbound-primitives.integration.test.ts`):
  a scanned label resolved, converted, dated, and rotated; a neighbouring tenant's
  LPN refused; expired stock kept out under every rotation source; and a valid bare
  SSCC and a policy-less internal LPN both refused instead of reinterpreted.
- Isolation tests (`tests/isolation/tenant-boundary-guard.isolation.test.ts`): the
  `model-purity` rule fires on a static import, a re-export, a dynamic import, a
  dynamic specifier the guard cannot read, `require`, and `import x = require(…)`.

Still planned:

- Everything requiring persistence: location path maintenance, lot uniqueness,
  storage-class compatibility, handling-unit split/merge/relabel/nest/unnest
  postings, scheduled expiry reclassification, mixed-content rejection, and serial
  rejection while flagged off.
- The physical corpus: real supplier labels parsed against fixtures, and printed
  labels rescanned (`RG-004`, `RG-005`). The parser's known limitation — a
  variable-length field that the supplier did not terminate with FNC1 absorbs the
  rest of the string — is documented in the module and is what that corpus exists to
  measure.

## Release gates

- `RG-004` Physical ZPL label printed in Thai and English and rescanned.
- `RG-005` Sample supplier barcode corpus and parser test fixtures exist.
- `RG-021` Pilot location vocabulary reviewed and accepted.
- `RG-022` Tenant GS1 prefix status confirmed.
- `RG-023` Lot rotation policy confirmed with the pilot tenant.
- Register: [release gates](../release-gates.md).

## References

- Plan §3.2 (D-09, D-10, D-11, D-13, D-15), §3.3, §3.4, §4 (B-06), §5 Q17, Q19,
  Q22, Q23, Q24, Q29, §7.2, §7.4, §7.5, §10 Phase 2, §12.
- [ADR-0003 — Append-only balanced inventory ledger](./0003-append-only-inventory-ledger.md)
- [ADR-0004 — Exact quantities and UOM](./0004-exact-quantities-and-uom.md)
- [ADR-0007 — Inbound slice scope](./0007-inbound-slice-scope.md)
- [Device capture adapters](../integration-contracts/device-capture-adapters.md)
