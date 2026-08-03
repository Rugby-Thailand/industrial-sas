# ADR-0003 — Append-only, balanced, idempotent inventory ledger

- ID: `ADR-0003`
- Status: **Accepted**
- Date: 2026-08-03
- Decision baseline: [PROJECT_PLAN.md](../../PROJECT_PLAN.md) §3.1 (C-05), §3.2
  (D-12), §5 Q20, Q21, Q30, Q37, §7.4, §7.5, §12
- Covers plan ADR backlog (§11) items: 6, 7, 11, 20
- Implementation status: **Not implemented.** No schema, no ledger algebra, no
  projection, no audit table, and no reconciliation job exist.

## Context

Inventory truth is the product. Editing a balance row in place destroys the
evidence of how it got there, and warehouse work generates duplicates: a scan
fires twice, a handheld retries a mutation after a Wi-Fi stall, an operator taps
confirm again because the screen did not repaint. The plan therefore commits to
an append-only ledger with compensating reversals and materialized balances
(C-05).

Two failure modes dominate: double-posted stock from retries, and silent drift
between the ledger and the balances that screens read.

## Decision

1. **Transaction header plus immutable lines.** `inventoryTransactions` records
   who/what/when/why; `inventoryLedgerLines` holds the postings (§7.4). Neither
   is updated or deleted by application code.
2. **Double entry with virtual boundary locations.** Every transaction balances to
   zero per item/lot/bucket dimension. Flows crossing the warehouse boundary
   (supplier receipt, scrap, adjustment) post against virtual boundary locations
   rather than being unbalanced (§5 Q20).
3. **Bucket identity.** A ledger line's bucket is
   `(orgId, warehouseId, itemId, locationId, lotId?, serialId?, handlingUnitId?, stockStatus, ownerId?)`
   (§7.4, and [ADR-0005](./0005-warehouse-location-and-stock-identity.md)).
4. **Request-ID idempotency.** Every posting carries a client-generated
   `requestId` (UUIDv7) unique within the organization. A replay returns the
   original result and posts nothing new (§7.5, §5 Q30).
5. **Correction by reversal only.** A mistake is corrected by a reversal
   transaction that references exactly one original, posts compensating lines,
   carries a reason code, and cannot itself be reversed (§7.5).
6. **Same-transaction projections.** Narrow balance documents are updated in the
   same mutation as the ledger lines, so a reader never sees lines without the
   balance they imply (§5 Q21).
7. **Independent reconciliation.** A scheduled job replays the ledger and proves
   projections equal it, alerting on any drift (§7.5, §5 Q21).
8. **Non-negative available stock.** A transaction that would drive available
   balance negative is rejected. Any exception is an explicit tenant setting, is
   never silent, and is audited (D-12).
9. **Same-transaction audit.** Domain writes append audit events in the same
   mutation, with actor, action, entity, request ID, device, and support context
   (§5 Q37). Ledger and audit retention defaults to seven years, pending legal
   review (D-27, [ADR-0012](./0012-delivery-release-and-quality-gates.md)).
10. **Aggregates for rollups.** Dashboard and reporting totals come from the
    Convex Aggregate component or pre-aggregated documents, never from scanning
    ledger lines (§5 Q21, and
    [ADR-0011](./0011-async-jobs-reporting-and-observability.md)).

## Invariants

These restate plan §7.5. They are the acceptance criteria for the ledger.

### Code-owned guarantees

- `INV-0003-01` `requestId` is unique per organization; replay returns the
  original transaction result.
- `INV-0003-02` Lines balance to zero within each transaction, including external
  boundaries modeled as virtual locations.
- `INV-0003-03` No ledger line has zero quantity.
- `INV-0003-04` Every referenced item, lot, location, handling unit, owner, and
  warehouse belongs to the active organization.
- `INV-0003-05` Lots belong to their items; locations belong to their warehouses;
  a handling unit cannot occupy two locations simultaneously.
- `INV-0003-06` Resulting available balance is never negative unless an explicit
  tenant policy permits it.
- `INV-0003-07` Transaction and ledger-line documents are never updated or
  deleted by application code.
- `INV-0003-08` A reversal references exactly one original transaction, posts
  compensating lines, cannot reverse a reversal, and leaves the original intact.
- `INV-0003-09` Balance projections are written in the same mutation as the
  ledger lines.
- `INV-0003-10` A scheduled replay proves projections equal the ledger and raises
  an alert on drift.
- `INV-0003-11` There is no API that sets a balance directly.
- `INV-0003-12` Audit events are appended in the same mutation as the domain
  write and are never updated or deleted.

### Operational assumptions

- `OPS-0003-01` Convex transaction serializability holds; the design relies on
  OCC rather than application locks (§5 Q30).
- `OPS-0003-02` Drift alerts are monitored and acted on; the reconciliation job
  detects drift but cannot repair intent
  ([runbook](../runbooks/ledger-drift.md)).
- `OPS-0003-03` Clients generate a stable `requestId` per user intent and reuse it
  across retries (contract, not enforceable server-side).
- `OPS-0003-04` Seven-year retention survives legal review (D-27, `RG-006`).

## Consequences

- Storage grows monotonically: roughly 1M ledger lines per tenant per year at the
  B-11 envelope. Pagination and aggregation are mandatory, not optional.
- No "fix the number" path exists for support. Every correction is a visible,
  reasoned reversal — which is the intended operational discipline.
- Hot buckets (one location, one fast-moving item) are the contention risk;
  buckets must stay narrow and global counter documents are forbidden (plan §13).
- The bucket key is expensive to change once real receipts exist, which is why
  B-06 is a Phase 0 decision.
- Reconciliation is a real workload that must fit inside platform limits and be
  chunked/resumable.

## Rejected alternatives

| Alternative                                  | Why rejected                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Mutable balance rows as the source of truth  | No history, no explainability, no audit; a bad write is unrecoverable.                     |
| Single-sided movements without balancing     | Cannot detect lost or duplicated quantity; boundary flows become unverifiable.             |
| Hard delete or edit of a wrong transaction   | Destroys audit evidence and breaks replay; conflicts with D-27 retention.                  |
| Eventually-consistent projections            | Operators would scan against stale balances and create phantom shortages; violates §5 Q21. |
| Server-generated idempotency keys            | Cannot deduplicate a client retry, which is the actual failure mode on warehouse Wi-Fi.    |
| Allowing negative available stock by default | Hides real losses and corrupts putaway/FEFO decisions (D-12).                              |
| Application-level locks for hot buckets      | Convex offers OCC/serializability; locks add deadlock risk and latency (§5 Q30).           |
| Nightly-only balance recomputation           | Leaves a day-long window of wrong numbers on the screens operators trust.                  |

## Verification

Planned, not present. This ADR carries the heaviest test obligation in the
project (plan §12).

- Property tests (`tests/properties/`): any valid transaction sequence balances;
  replay of the ledger equals the projection; reversal restores the exact prior
  projection; negative stock is rejected; cross-tenant references are rejected;
  duplicate `requestId` is a no-op returning the original result.
- Unit tests: pure ledger algebra, reason-code requirements, reversal rules.
- Integration tests (`convex-test`): same-transaction ledger + projection + audit
  writes; OCC contention on a hot bucket; duplicate request behaviour; scheduled
  reconciliation and expiry jobs.
- Static checks: no mutation patches or deletes ledger/audit tables; no direct
  balance-write API.
- Soak: seven-day automated run with zero drift (plan §10 Phase 2 gate).

## Release gates

- `RG-016` Random valid transaction sequences always replay to the projection.
- `RG-017` Reversal restores exact prior balances.
- `RG-018` Ledger/projection drift is zero during a seven-day automated soak.
- `RG-019` No direct inventory-balance edit path exists.
- `RG-025` Duplicate scans and retries never duplicate stock (pilot hardware).
- `RG-041` Zero ledger/projection drift across the pilot window.
- Register: [release gates](../release-gates.md).

## References

- Plan §3.1 (C-05), §3.2 (D-12, D-21, D-27), §4 (B-06, B-11), §5 Q19, Q20, Q21,
  Q30, Q37, §7.4, §7.5, §10 Phase 2, §12, §13.
- [ADR-0004 — Exact quantity and UOM representation](./0004-exact-quantities-and-uom.md)
- [ADR-0005 — Warehouse, location, and stock identity](./0005-warehouse-location-and-stock-identity.md)
- [ADR-0011 — Bounded async jobs, reporting, and observability](./0011-async-jobs-reporting-and-observability.md)
- [Ledger drift runbook](../runbooks/ledger-drift.md)
