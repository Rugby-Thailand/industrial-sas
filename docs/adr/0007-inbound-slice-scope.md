# ADR-0007 — Inbound vertical slice scope: receipt, QC, handling units, labels, putaway

- ID: `ADR-0007`
- Status: **Accepted**
- Date: 2026-08-03
- Decision baseline: [PROJECT_PLAN.md](../../PROJECT_PLAN.md) §1, §2.1, §2.3, §3.2
  (D-14, D-16), §4 (B-05, B-07), §5 Q9, Q10, Q26, Q27, Q28, §7.3, §10 Phase 3
- Covers plan ADR backlog (§11) items: 10 (policy), 14
- Implementation status: **Not implemented.** No PO, receipt, QC, handling-unit,
  label, or putaway code exists. `pdf-lib`, `exceljs`, and `papaparse` are
  installed and unused.

## Context

The first release is one production-grade vertical slice rather than shallow
coverage of fifteen modules (C-04): `PO → Receive → QC → Build pallet/lot → Print
label → Putaway → Inventory ledger`. Every standing non-goal in plan §2.3 stays
out, including picking, packing, shipping, returns, manufacturing, reservations,
and statistical AQL sampling.

Receiving is where messy reality meets the ledger: partial deliveries,
over-shipments, unexpected items, unreadable supplier labels, and duplicate
scans.

## Decision

### Purchase orders

1. **In-app authoring plus previewed import.** POs are authored in the app and
   imported from CSV/XLSX with a preview and stable external references. No
   launch-critical live ERP synchronization; no direct ERP database access (B-07,
   §5 Q25).
2. **Versioned integration contracts now.** The PO and inventory-event contracts
   are defined during the MVP so a later ERP integration reuses them
   ([ADR-0011](./0011-async-jobs-reporting-and-observability.md), plan §3.4).

### Receipt rules

3. Partial receipt is normal. Over-receipt requires configured tolerance and
   approval above it. Under-close requires a reason. Unexpected, cancelled, and
   blind receipts are explicit exception flows. Duplicate submissions are defended
   by request IDs plus a plausible-duplicate warning. Large batches are chunked and
   resumable (§5 Q26, §5 Q30).
4. **Capture at receipt** includes quantity and UOM
   ([ADR-0004](./0004-exact-quantities-and-uom.md)), lot code, manufacture/expiry
   dates, and shelf-life exceptions
   ([ADR-0005](./0005-warehouse-location-and-stock-identity.md)).

### Quality control

5. **Simple sampling only.** All, fixed-count, or percentage sampling. Statistical
   AQL/ISO 2859 is deferred (§5 Q27, §2.3).
6. **QC-controlled stock lands in `QC_HOLD`** and leaves only through an explicit
   disposition: release, quarantine, reject, scrap, or rework. Each disposition is
   a balanced ledger transition, not a status edit (§2.1,
   [ADR-0003](./0003-append-only-inventory-ledger.md)).
7. **Maker-checker on dispositions**, with evidence attachments stored privately
   ([ADR-0006](./0006-authorization-and-support-access.md),
   [ADR-0008](./0008-adapter-ports-and-release-gates.md)).
8. QC applicability is configured per item and supplier; not every receipt is
   QC-blocked (plan §3.3).

### Handling units and labels

9. **Pallet construction is part of receiving**: the receiver builds a handling
   unit from received lines under the mixed-content policy of ADR-0005.
10. **Labels are server-generated and versioned.** ZPL is the primary payload, PDF
    is the preview/fallback, and the label template version plus payload hash are
    retained as audit evidence. Reprints are audited (D-16, §5 Q9).
11. **Printing goes through a transport port** — a local print bridge such as Zebra
    Browser Print where the customer permits installation — behind
    `PrinterTransportPort`
    ([ADR-0008](./0008-adapter-ports-and-release-gates.md), B-05).

### Putaway

12. **Deterministic, explainable recommendation.** Hard constraints filter first
    (compatibility, prohibited locations, tenant rules), then preference (same
    item/lot, configured home or preferred zone), then scoring (capacity, travel,
    fragmentation), with an overflow fallback (D-14, §5 Q28).
13. **Every recommendation is explainable.** The stored recommendation records the
    filters applied and the score components, so an operator or auditor can see why
    a location was proposed.
14. **Override is permitted and audited**, with override analytics available for
    tuning (D-14).
15. **Task claiming is compare-and-set**, with no reservations in the MVP (§5 Q30,
    §2.3).

## Invariants

### Code-owned guarantees

- `INV-0007-01` A receipt posting is idempotent on `requestId`; a retry or double
  scan never posts twice (`INV-0003-01`).
- `INV-0007-02` Over-receipt beyond configured tolerance is rejected without an
  approval that satisfies maker-checker.
- `INV-0007-03` Under-close requires a reason code.
- `INV-0007-04` Unexpected, cancelled, and blind receipts are distinct, audited
  exception types — never silent normal receipts.
- `INV-0007-05` QC-controlled receipts post to `QC_HOLD`, and `QC_HOLD` stock
  cannot be putaway to an available bucket without a disposition.
- `INV-0007-06` Every QC disposition is a balanced transaction with a reason code
  and, where required, a distinct approver.
- `INV-0007-07` A printed label is always generated from a specific
  `labelTemplateVersion`; the payload hash and print job are recorded.
- `INV-0007-08` A putaway confirmation posts a balanced movement and cannot target
  a location that fails a hard constraint.
- `INV-0007-09` A putaway override records the recommended location, the chosen
  location, the actor, and a reason.
- `INV-0007-10` Putaway scoring is deterministic: identical inputs yield an
  identical ordered recommendation list.
- `INV-0007-11` A task can be claimed by exactly one actor (compare-and-set).
- `INV-0007-12` Bulk import is chunked, resumable, and idempotent per source row
  reference.
- `INV-0007-13` No outbound, manufacturing, returns, or reservation operation
  exists in the MVP surface (plan §2.3).

### Operational assumptions

- `OPS-0007-01` The customer permits a local print bridge on at least one
  workstation, or supplies another supported printer route (B-05, plan §3.3).
- `OPS-0007-02` Over-receipt tolerance and blind-receipt policy are confirmed with
  the pilot tenant (§5 Q26, `RG-027`).
- `OPS-0007-03` QC gating expectations (which items/suppliers, and that AQL is out
  of scope) are confirmed (§5 Q27, `RG-028`).
- `OPS-0007-04` Supplier label samples and label stock are supplied by the pilot
  tenant (`RG-005`, `RG-004`).
- `OPS-0007-05` A warehouse map and baseline receiving measurements exist for
  putaway configuration and benefit measurement (`RG-008`).
- `OPS-0007-06` Operators are trained on exception flows; the system makes
  exceptions explicit but cannot force correct human judgement.

## Consequences

- Receiving carries most of the product's exception surface, so its UI complexity
  exceeds every other MVP screen.
- Explainable putaway means storing recommendation traces, which adds write volume
  per task and requires a retention decision alongside audit retention (D-27).
- Deferring AQL keeps QC simple but means regulated customers cannot be served
  without new work (B-01).
- Without reservations, two operators can putaway toward the same location; scoring
  and OCC must handle the race without blocking.
- Import previews add a step, but they prevent an unreviewed spreadsheet from
  creating thousands of PO lines.

## Rejected alternatives

| Alternative                                 | Why rejected                                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Shallow coverage of all fifteen modules     | Produces a demo, not a usable warehouse system (C-04, §1).                                     |
| Live ERP synchronization at launch          | A separate Phase 1 workstream with external dependencies (B-07).                               |
| Direct ERP database access                  | Couples to a schema outside our control and bypasses contracts (§5 Q25).                       |
| Blocking all over-receipt                   | Real deliveries exceed POs; a hard block pushes work off-system.                               |
| Allowing over-receipt silently              | Hides supplier and reconciliation problems (§5 Q26).                                           |
| Status flag for QC hold instead of a bucket | Bypasses the ledger and makes held stock invisible to balance queries (ADR-0005).              |
| Statistical AQL sampling in MVP             | Requires sampling-plan tables, review, and validation with no launch requirement (§2.3).       |
| Client-side label rendering                 | Payload could differ from the audited version; server generation keeps evidence authoritative. |
| Direct network printing without a port      | Ties the domain to one vendor and one network topology (ADR-0008).                             |
| Machine-learning putaway suggestions        | Unexplainable to operators and auditors; deterministic scoring is required (D-14).             |
| Reservations to prevent putaway races       | Outbound concept, deliberately deferred (§2.3, §5 Q30).                                        |

## Verification

Planned, not present.

- Unit/property tests: receipt tolerance arithmetic, deterministic putaway
  scoring and explanation, FEFO interaction, chunked import idempotency.
- Integration tests: receipt variants (partial, over, under, unexpected,
  cancelled, blind), QC transitions and dispositions, duplicate request behaviour,
  task claim contention, print job records.
- E2E: handheld PO receipt with synthetic HID scan events; QC hold/release with
  two users; pallet creation, print, rescan, relabel, putaway.
- Physical acceptance: real scanner, printer, label stock, gloves, lighting, and
  warehouse Wi-Fi (plan §12).

## Release gates

- `RG-003` Scanner spike on the actual rugged device and browser/WebView.
- `RG-004` Physical ZPL label printed in Thai and English and rescanned.
- `RG-051` A real PO completes receive → QC → pallet → print → putaway → inventory
  history on pilot hardware.
- `RG-025` Duplicate scans and retries never duplicate stock.
- `RG-026` Unauthorized warehouse actions fail server-side.
- `RG-027` Over-receipt tolerance and blind-receipt policy confirmed.
- `RG-028` QC gating and AQL expectations confirmed.
- `RG-029` Printed labels remain scannable and Thai text correct after handling.
- Register: [release gates](../release-gates.md).

## References

- Plan §1, §2.1, §2.3, §3.2 (D-14, D-16), §3.3, §4 (B-05, B-07), §5 Q9, Q10, Q25,
  Q26, Q27, Q28, Q29, Q30, §7.3, §10 Phase 3, §12.
- [ADR-0003 — Append-only balanced inventory ledger](./0003-append-only-inventory-ledger.md)
- [ADR-0005 — Warehouse, location, and stock identity](./0005-warehouse-location-and-stock-identity.md)
- [ADR-0008 — Adapter ports and release gates](./0008-adapter-ports-and-release-gates.md)
- [ADR-0009 — Degraded-online connectivity contract](./0009-degraded-online-connectivity.md)
- [Printer transport port](../integration-contracts/printer-transport-port.md)
