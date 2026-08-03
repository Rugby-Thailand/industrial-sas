# ADR-0011 — Bounded asynchronous work, pre-aggregated reporting, and observability

- ID: `ADR-0011`
- Status: **Accepted**
- Date: 2026-08-03
- Decision baseline: [PROJECT_PLAN.md](../../PROJECT_PLAN.md) §3.2 (D-21, D-28),
  §4 (B-08, B-11), §5 Q21, Q33, Q34, Q35, Q39, Q41, Q48, §10 Phase 4
- Covers plan ADR backlog (§11) items: 17, 18, 25
- Implementation status: **Not implemented.** No jobs, crons, outbox, aggregates,
  report jobs, dashboards, occupancy map, logging, or error tracking exist. No
  observability vendor has been selected.

## Context

Three workloads can each take down a warehouse system: unbounded background jobs
that saturate the backend during a receiving peak, dashboard queries that scan the
ledger, and outbound integrations that either lose events or deliver them twice.
At the B-11 envelope — 5–40 concurrent scanners, 3,000 inbound lines/day, roughly
1M ledger lines/year/tenant — none of these can be left to chance.

The plan also requires that operations be observable enough to prove the pilot
gates: latency, drift, dead letters, and error rates (§5 Q39).

## Decision

### Asynchronous work

1. **Durable orchestration uses Convex Workflow**; bounded concurrency uses
   Workpool; scheduled work uses crons (D-21, §5 Q34). All of it sits behind
   `JobQueuePort`
   ([INT-06](../integration-contracts/job-queue-port.md)).
2. **Every job is bounded and observable.** A job declares a concurrency limit, a
   chunk size, a retry policy with backoff, and a dead-letter destination. Job runs
   are visible records, not log lines (§5 Q34).
3. **Scheduled jobs for the MVP** are: nightly ledger/projection reconciliation
   ([ADR-0003](./0003-append-only-inventory-ledger.md)), expiry reclassification,
   backup/export triggering, and drift alerting (§5 Q21, Q34, Q42).
4. **Outbound integrations use a transactional outbox** written in the same mutation
   as the domain change, delivered at least once, with recorded delivery and
   idempotency keys. Inbound webhooks verify signatures, record idempotency, and
   acknowledge quickly (D-21, §5 Q35).
5. **Ingestion is rate-limited** so an ERP or import burst cannot starve
   interactive scanning (§5 Q34).

### Reporting

6. **Dashboard widgets are bounded or pre-aggregated.** No dashboard query scans
   ledger lines; rollups come from the Aggregate component or maintained rollup
   documents behind `RollupPort`
   ([INT-07](../integration-contracts/rollup-port.md), §5 Q21, Q48).
7. **Exports are asynchronous, indexed jobs** producing private artifacts delivered
   through short-lived signed URLs (§5 Q48,
   [ADR-0008](./0008-adapter-ports-and-release-gates.md)).
8. **Occupancy is a 2D SVG map, not Three.js.** Three.js is removed from the MVP
   bundle; the occupancy visualization is an accessible 2D SVG heat map. Three.js
   must not be added unless B-08/D-28 is explicitly reversed (B-08, D-28, §5 Q33).

### Observability

9. **All telemetry goes through `ObservabilityPort`** — structured logs, error
   reporting, domain SLIs, and privacy-controlled product analytics — so the vendor
   choice can be deferred (§5 Q39,
   [INT-05](../integration-contracts/observability-port.md)).
10. **Request IDs propagate end to end**, from client intent through Convex
    functions, jobs, and logs, so one warehouse action is traceable (§5 Q39).
11. **Domain SLIs are first-class**: scan-to-ack latency, receipt completion rate,
    ledger/projection drift, job dead-letter count, and QC backlog age. Alerts
    exist for drift, dead letters, latency breaches, and error spikes (§5 Q39).
12. **No tenant payloads in telemetry.** Logs and error reports carry identifiers
    and codes, not item descriptions, photos, or personal data
    ([ADR-0012](./0012-delivery-release-and-quality-gates.md), plan §14).

## Invariants

### Code-owned guarantees

- `INV-0011-01` Every background job declares a bounded concurrency limit and a
  bounded chunk size; no job iterates an unbounded result set in one step.
- `INV-0011-02` Every job is idempotent per chunk and resumable after failure.
- `INV-0011-03` Failed jobs land in a dead-letter record with cause and payload
  reference; failures are never silently dropped.
- `INV-0011-04` Outbox rows are written in the same mutation as the domain change
  they describe.
- `INV-0011-05` Outbound delivery is at least once with an idempotency key, and
  consumers are told so in the contract.
- `INV-0011-06` Inbound webhooks verify signature and idempotency before any state
  change.
- `INV-0011-07` No dashboard or report query scans ledger lines; every widget reads
  a bounded index or a rollup.
- `INV-0011-08` Report artifacts are private and delivered only through short-lived
  signed URLs after a permission check.
- `INV-0011-09` Rollups are derivable from the ledger, so a rebuild can restore them
  exactly.
- `INV-0011-10` Every log entry and error report carries the request ID and `orgId`
  and contains no tenant business payload or personal data.
- `INV-0011-11` `three` is absent from the dependency graph and the client bundle
  (D-28).

### Operational assumptions

- `OPS-0011-01` Observability and analytics vendors are selected before staging is
  used for pilot rehearsal (§5 Q39).
- `OPS-0011-02` Alerts have a named on-call recipient; an unrouted alert is not a
  control ([incident runbook](../runbooks/incident-response.md)).
- `OPS-0011-03` Convex component availability (Workflow, Workpool, Aggregate,
  Rate Limiter, Migrations) continues on the purchased plan (§15).
- `OPS-0011-04` The B-11 volume envelope holds; higher peaks require earlier
  performance work (`RG-037`).
- `OPS-0011-05` Rollup retention and report-artifact retention are set alongside the
  audit retention decision (D-27, `RG-006`).

## Consequences

- Rollups are a second representation of truth and can drift; they must be
  rebuildable and reconciled, like balance projections.
- Bounded jobs mean long work takes longer by design; UI must show job progress
  rather than block.
- At-least-once delivery pushes deduplication onto consumers, which the contract
  must state explicitly.
- Dropping Three.js reduces bundle size and accessibility risk, and it means no 3D
  demo is available without reopening B-08.
- Deferring the observability vendor keeps the port honest but means alerting is not
  proven until the adapter exists.

## Rejected alternatives

| Alternative                                         | Why rejected                                                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Ad-hoc `setTimeout`/fire-and-forget background work | No durability, no retry, no visibility; work vanishes on failure (D-21).                            |
| Unbounded parallel job fan-out                      | Saturates the deployment during receiving peaks and starves interactive scans (§5 Q34).             |
| Live aggregate queries over ledger lines            | Cost grows with history; dashboards degrade exactly as the tenant becomes valuable (§5 Q21).        |
| Dual-write to external systems without an outbox    | Loses events on failure between the write and the send (§5 Q35).                                    |
| Exactly-once outbound delivery guarantees           | Not achievable across an unreliable boundary; at-least-once plus idempotency is honest (§5 Q35).    |
| Synchronous report generation                       | Ties a user request to an unbounded query and times out at real data volumes (§5 Q48).              |
| Public export URLs                                  | Tenant data leakage through link sharing (D-20).                                                    |
| Three.js occupancy visualization in MVP             | No justified MVP use, needs 3D master data, adds bundle weight and accessibility risk (B-08, D-28). |
| Vendor SDKs called directly for logging/errors      | Couples every module to a vendor and blocks credential-free tests (ADR-0008).                       |
| Full-payload logging for debuggability              | Copies tenant and personal data into third-party systems; conflicts with PDPA posture (§14).        |

## Verification

Planned, not present.

- Integration tests: job chunking and resumption, dead-letter routing, cron
  scheduling, outbox write atomicity, webhook idempotency, rate-limit behaviour.
- Property tests: rollups recomputed from the ledger equal maintained rollups;
  at-least-once replay does not double-count.
- Unit tests: SLI computation, request-ID propagation helpers, redaction of
  payloads before telemetry.
- Static checks: `three` absent from dependencies; no ledger scan in report paths;
  no vendor SDK outside adapters.
- Load tests: hot-bucket contention and job load at the B-11 envelope (plan §12).

## Release gates

- `RG-018` Zero ledger/projection drift during the seven-day soak (depends on the
  reconciliation job).
- `RG-036` Production Convex tier sized from load-test evidence.
- `RG-037` Measured concurrency ceiling safely exceeds the pilot peak.
- `RG-045` Observability vendors selected and alerts routed.
- `RG-046` Aggregate-backed dashboard and accessible 2D occupancy map delivered.
- Register: [release gates](../release-gates.md).

## References

- Plan §3.2 (D-20, D-21, D-27, D-28), §4 (B-08, B-11), §5 Q21, Q33, Q34, Q35, Q39,
  Q41, Q48, §10 Phase 4, §12, §13, §15.
- [ADR-0003 — Append-only balanced inventory ledger](./0003-append-only-inventory-ledger.md)
- [ADR-0008 — Adapter ports and release gates](./0008-adapter-ports-and-release-gates.md)
- [Job queue port](../integration-contracts/job-queue-port.md)
- [Rollup port](../integration-contracts/rollup-port.md)
- [Observability port](../integration-contracts/observability-port.md)
