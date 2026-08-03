# ADR-0005 — Warehouse and location model, stock identity, handling units, and identifiers

- ID: `ADR-0005`
- Status: **Accepted**
- Date: 2026-08-03
- Decision baseline: [PROJECT_PLAN.md](../../PROJECT_PLAN.md) §3.2 (D-09, D-10,
  D-11, D-13, D-15), §4 (B-06), §5 Q17, Q19, Q22, Q23, Q24, Q29, §7.2, §7.4
- Covers plan ADR backlog (§11) items: 9, 10, 13
- Implementation status: **Not implemented.** No warehouse, location, lot,
  handling-unit, or barcode schema exists. No GS1 or LPN parser exists.

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

Planned, not present.

- Property tests: FEFO determinism including tie-breakers; GS1/internal parser
  rejects ambiguous or invalid input; LPN check-digit correctness; nesting depth
  bound; status/owner reclassification always balanced.
- Unit tests: location path maintenance, storage-class compatibility, capacity
  advisory behaviour, lot uniqueness, rotation-date selection.
- Integration tests: handling-unit split/merge/relabel/nest/unnest posting sets;
  scheduled expiry reclassification; mixed-content rejection when disabled;
  serial rejection while flagged off.
- Physical tests: real supplier-label corpus parsed against fixtures; printed
  labels rescanned (see [ADR-0007](./0007-inbound-slice-scope.md)).

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
