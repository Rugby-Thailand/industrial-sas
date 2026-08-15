# Integration contracts

Status: **contracts with incremental implementations.** Clerk and Convex now have
implemented adapters and application wiring, although no live Clerk instance is
connected. File storage and the remaining vendors stay specifications. These
documents define and track those boundaries per
[ADR-0008](../adr/0008-adapter-ports-and-release-gates.md).

## Contracts

| ID       | Contract                                                | Capability                                   | Vendor today                     | Gates                        |
| -------- | ------------------------------------------------------- | -------------------------------------------- | -------------------------------- | ---------------------------- |
| `INT-01` | [Clerk identity](./clerk-identity.md)                   | Identity, organizations, membership webhooks | Clerk                            | `RG-011`, `RG-030`           |
| `INT-02` | [Convex hosting](./convex-hosting.md)                   | Data plane, transactions, region, self-host  | Convex Cloud                     | `RG-002`, `RG-010`, `RG-036` |
| `INT-03` | [`FileStoragePort`](./file-storage-port.md)             | Private tenant files and signed URLs         | UploadThing (+ Convex internal)  | `RG-035`, `RG-006`           |
| `INT-04` | [`PrinterTransportPort`](./printer-transport-port.md)   | ZPL/PDF delivery to a printer                | Zebra Browser Print class bridge | `RG-004`, `RG-029`           |
| `INT-05` | [`ObservabilityPort`](./observability-port.md)          | Logs, errors, SLIs, alerts, analytics        | Undecided                        | `RG-045`, `RG-071`           |
| `INT-06` | [`JobQueuePort`](./job-queue-port.md)                   | Durable and bounded async work               | Convex Workflow/Workpool/crons   | `RG-018`, `RG-037`           |
| `INT-07` | [`RollupPort`](./rollup-port.md)                        | Aggregated counters for dashboards           | Convex Aggregate                 | `RG-046`                     |
| `INT-08` | [Device capture adapters](./device-capture-adapters.md) | Scanner, camera, GPS, signature, photo       | Browser and device APIs          | `RG-003`, `RG-005`           |

## Rules every contract obeys

1. **The port is ours.** Its operations describe the capability the domain needs, not
   the vendor's API surface (`INV-0008-01`).
2. **Timeouts are explicit.** Every operation states a timeout. There is no unbounded
   wait anywhere in the system (`INV-0008-03`).
3. **Retries require idempotency.** Any operation the caller may retry takes an
   idempotency key and is safe to repeat (`INV-0008-04`).
4. **Failures are typed.** Each contract enumerates its failure modes and what the
   caller must do for each. A vendor error never reaches the client verbatim.
5. **No external call inside a transaction.** Port calls happen in Convex actions or
   jobs, never inside a mutation (`INV-0008-07`).
6. **A fake exists.** Every port has an in-memory adapter, so the whole test suite
   runs with no credentials (`INV-0008-05`).
7. **Privacy is stated.** Each contract names the personal or tenant data that
   crosses the boundary, its lawful-basis note, and its retention, feeding the ROPA
   (`RG-057`).
8. **Configuration is environmental.** Names live in `.env.example`; values never
   enter the repository (`INV-0008-08`).

## Shared failure taxonomy

Every port maps vendor errors onto this closed set, so callers can be written once.

| Failure          | Meaning                       | Caller obligation                                       |
| ---------------- | ----------------------------- | ------------------------------------------------------- |
| `unavailable`    | Transport or vendor outage    | Retry with backoff; surface degraded state after budget |
| `timeout`        | Operation exceeded its budget | Retry if idempotent; otherwise fail the intent visibly  |
| `unauthorized`   | Credential or grant problem   | Do not retry; alert; treat as configuration incident    |
| `invalidRequest` | Our payload is wrong          | Do not retry; fail loudly; this is a bug                |
| `rejected`       | Vendor understood and refused | Surface a translatable, actionable message              |
| `conflict`       | Idempotency or state conflict | Resolve by reading current state; never double-apply    |
| `rateLimited`    | Quota exceeded                | Backoff with jitter; shed non-interactive work first    |

## Standard timeout budgets

Interactive operations must fit inside the scan-to-ack target of under 800 ms at the
pilot site (§5 Q5); anything slower belongs in a job.

| Class                              | Budget          | Retries                          |
| ---------------------------------- | --------------- | -------------------------------- |
| Interactive read (scan lookup)     | 1 s             | 1 immediate retry                |
| Interactive write (post a receipt) | 3 s             | Caller-driven, same `requestId`  |
| Token or signed-URL issuance       | 2 s             | 2 with backoff                   |
| Print transport                    | 5 s             | 1, then offer reprint            |
| File upload                        | 60 s            | Resumable, client-driven         |
| Job step                           | Per job, ≤ 60 s | Job-level backoff to dead letter |
| Webhook acknowledgement (ours)     | 5 s             | Sender retries; we deduplicate   |

## Adding a contract

Copy an existing document and keep the sections: capability, direction and trust
boundary, port operations, timeouts and retries, idempotency, data and privacy,
failure semantics, configuration, verification, release gates, and open questions.
Register the new `INT-xx` ID in the table above and reference it from the ADR that
justifies the dependency.
