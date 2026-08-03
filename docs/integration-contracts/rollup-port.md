# INT-07 — `RollupPort` (aggregated counters for dashboards and reports)

Status: **specification.** No rollups, aggregates, dashboard queries, or occupancy map
exist. The Convex Aggregate component is not installed.

Owner ADRs:
[ADR-0011](../adr/0011-async-jobs-reporting-and-observability.md),
[ADR-0003](../adr/0003-append-only-inventory-ledger.md).

## 1. Capability

Provide the small number of aggregate figures the dashboard and reports need, without
scanning ledger lines (`INV-0011-07`): receiving volume, open QC count, putaway backlog,
occupancy by zone, low-stock counts, and reconciliation status (§2.1).

Backed by the Convex Aggregate component or by maintained rollup documents, chosen per
figure.

## 2. Direction and trust boundary

| Flow      | Direction                | Trust                                                       |
| --------- | ------------------------ | ----------------------------------------------------------- |
| Increment | Convex mutation → rollup | Written in the same transaction as the domain change        |
| Read      | Convex query → dashboard | Permission-checked like any tenant read (`ADR-0002`)        |
| Rebuild   | Job → rollup             | Recomputed from the ledger, which stays authoritative       |
| Verify    | Job → comparison         | Drift between rollup and ledger is an alert (`INV-0003-10`) |

Rollups are derived data. The ledger is the source of truth; a rollup is always
rebuildable (`INV-0011-09`).

## 3. Port operations

```ts
type RollupPort = {
  apply(delta: RollupDelta): Promise<void>;
  read(query: RollupQuery): Promise<RollupValue>;
  rebuild(scope: RollupScope): Promise<RollupRebuildResult>;
  verify(scope: RollupScope): Promise<RollupVerification>;
};
```

`apply` is called inside the mutation that changes the domain, so it must be pure
document arithmetic with no external I/O (`INV-0008-07`).

## 4. Rollup catalogue

Stable IDs so dashboards, tests, and rebuild jobs agree on what each figure means.

| Rollup ID | Figure                             | Dimensions                          | Backing    |
| --------- | ---------------------------------- | ----------------------------------- | ---------- |
| `RU-01`   | Receipt lines posted               | org, warehouse, business date       | Aggregate  |
| `RU-02`   | Received base quantity             | org, warehouse, business date, item | Aggregate  |
| `RU-03`   | Open QC inspections                | org, warehouse                      | Rollup doc |
| `RU-04`   | `QC_HOLD` quantity                 | org, warehouse, item                | Rollup doc |
| `RU-05`   | Putaway backlog (unclaimed tasks)  | org, warehouse                      | Rollup doc |
| `RU-06`   | Putaway overrides                  | org, warehouse, business date       | Aggregate  |
| `RU-07`   | Occupancy by zone                  | org, warehouse, zone                | Rollup doc |
| `RU-08`   | Low-stock item count               | org, warehouse                      | Rollup doc |
| `RU-09`   | Reconciliation status and last run | org                                 | Rollup doc |
| `RU-10`   | Dead-letter count                  | org, job type                       | Rollup doc |

Occupancy (`RU-07`) feeds the accessible 2D SVG map. Three.js is not used (D-28,
B-08).

## 5. Timeouts and retries

`apply` is in-transaction document arithmetic with no network call and therefore no
timeout of its own; it shares the mutation's budget. `read` follows the interactive query
budget of 1 s. `rebuild` and `verify` run as bounded, chunked jobs
([`JobQueuePort`](./job-queue-port.md)).

## 6. Idempotency

- `apply` is called exactly once per domain change because it is inside the same
  transaction: a rolled-back mutation rolls back the rollup.
- `rebuild` is idempotent: recomputing yields the same value.
- `verify` is read-only.
- No rollup is ever incremented from a job that also posts the ledger change, which would
  risk double counting.

## 7. Data and privacy

Rollups hold counts and quantities keyed by tenant, warehouse, item, and date. They
contain no personal data. They are tenant data and are exported and deleted with the
tenant (`RG-058`). Rollup retention is set alongside audit retention (`RG-049`).

## 8. Failure semantics

| Situation                       | Behaviour                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------- |
| Rollup document contention      | Keep dimensions narrow; a hot global counter is forbidden (plan §13)            |
| Rollup drifts from the ledger   | Alert; the dashboard shows a stale-data warning; rebuild is an operator action  |
| Rebuild interrupted             | Resumable per chunk; partial rebuild never publishes a half-computed figure     |
| Dashboard read while rebuilding | Serves the last consistent value with its `asOf` timestamp                      |
| Missing rollup for a new figure | Dashboard widget is absent rather than showing zero, because zero reads as fact |

A rollup discrepancy is never fixed by editing the rollup by hand; it is fixed by
rebuilding from the ledger ([runbook](../runbooks/ledger-drift.md)).

## 9. Configuration

Rollup definitions are code-owned. Low-stock thresholds and occupancy zone groupings are
tenant configuration.

## 10. Verification

- Property tests: for random valid transaction sequences, `rebuild` equals the maintained
  rollup for every catalogue entry.
- Integration tests: rollback of a mutation rolls back the rollup; contention on the
  hottest rollup under concurrent postings.
- Unit tests: delta arithmetic per rollup, including reversals and status
  reclassification.
- Static checks: no dashboard query reads ledger lines (`INV-0011-07`).
- Accessibility: the occupancy map has a non-visual equivalent (`RG-042`).

## 11. Release gates

`RG-046` aggregate-backed dashboard and accessible occupancy map, `RG-041` zero drift
across the pilot, `RG-042` accessibility audit. See the
[register](../release-gates.md).

## 12. Open questions

- Which figures need per-item dimensions at the B-11 volume without exceeding index or
  document limits.
- Occupancy definition: volumetric, footprint, or handling-unit count, given that
  capacity is advisory (D-13).
- Low-stock threshold source: item master, warehouse policy, or both.
