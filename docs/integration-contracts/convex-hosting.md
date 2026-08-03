# INT-02 — Convex hosting, region, and self-host escape hatch

Status: **specification.** `convex` 1.43.0 and `convex-test` are installed and
unused. There is no `convex/` directory, no deployment, and no cloud resource created
by this repository.

Owner ADRs:
[ADR-0002](../adr/0002-convex-tenant-boundary-and-index-discipline.md),
[ADR-0008](../adr/0008-adapter-ports-and-release-gates.md),
[ADR-0011](../adr/0011-async-jobs-reporting-and-observability.md).

## 1. Capability

Convex is the data plane: serializable transactions, reactive queries, scheduled
functions, components (Workflow, Workpool, Aggregate, Rate Limiter, Migrations), file
storage for internal artifacts, and HTTP endpoints for webhooks. It is also the
deepest lock-in in the stack (§5 Q49).

## 2. Direction and trust boundary

| Flow                  | Direction         | Trust                                                           |
| --------------------- | ----------------- | --------------------------------------------------------------- |
| Queries and mutations | Browser → Convex  | Convex verifies the identity token and enforces every invariant |
| Domain writes         | Convex only       | Next.js never writes domain state (D-19)                        |
| Webhooks              | Vendor → Convex   | Signature and idempotency verified before work is scheduled     |
| Outbound events       | Convex → external | Transactional outbox, at-least-once (`ADR-0011`)                |
| Backups and exports   | Convex → storage  | Encrypted independent exports (`ADR-0012`)                      |

Convex is the enforcement point. The browser is untrusted (§6.1).

## 3. Constraints that shape the design

- **No Asian region.** Convex Cloud offers US East and EU West. A deployment's region
  cannot be changed in place, so the region decision precedes production creation
  (B-03, §5 Q3, `RG-002`).
- **Server-transaction-oriented.** Convex is not offline-first, which is why the
  connectivity contract is degraded-online
  ([ADR-0009](../adr/0009-degraded-online-connectivity.md)).
- **OCC, not locks.** Concurrency is handled by serializable transactions with
  optimistic concurrency; hot documents are the contention risk (§5 Q30, plan §13).
- **Platform limits apply** to document size, transaction size, index count, and
  function duration; the B-11 envelope must be validated against them (`RG-069`).
- **Paid tier sized from evidence** rather than assuming a free tier (D-25,
  `RG-036`).

## 4. Timeouts and retries

| Operation                         | Budget                    | Notes                                                 |
| --------------------------------- | ------------------------- | ----------------------------------------------------- |
| Interactive query                 | 1 s target                | Above this, the scan-to-ack target is at risk (§5 Q5) |
| Interactive mutation              | 3 s target                | Client retries with the same `requestId`              |
| Mutation OCC conflict             | Platform retry, then fail | Narrow buckets keep conflicts rare (`ADR-0003`)       |
| Action calling an external vendor | Per port budget           | Never inside a mutation (`INV-0008-07`)               |
| Scheduled job step                | ≤ 60 s, chunked           | Bounded and resumable (`INV-0011-01`, `INV-0011-02`)  |

## 5. Idempotency

- Domain postings are idempotent on `requestId`, unique per organization
  (`INV-0003-01`).
- Inbound webhooks are idempotent on the sender's event ID (`INV-0011-06`).
- Migrations and seeds are idempotent and resumable (`INV-0012-06`,
  `INV-0012-07`).
- Outbound deliveries are at-least-once with an idempotency key; consumers must
  deduplicate (`INV-0011-05`).

## 6. Data and privacy

- All tenant business data lives here, including audit events and ledger history.
- Cross-border transfer is the central PDPA question: the region will be outside
  Thailand, so a lawful transfer basis and safeguards are required before production
  (§5 Q43, `RG-006`, `RG-048`).
- Convex is a subprocessor and appears in the subprocessor register.
- Internal-only artifacts may use Convex file storage; tenant-visible evidence uses
  the [`FileStoragePort`](./file-storage-port.md) (D-20).
- Retention: ledger and audit default to seven years pending review (D-27,
  `RG-049`).

## 7. Failure semantics

| Situation                          | Behaviour                                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------------------------- |
| Deployment unavailable             | The client shows a degraded state; correctness-sensitive operations are blocked (`ADR-0009`) |
| Elevated latency                   | Interactive flows degrade toward the latency SLI alert threshold (`RG-038`)                  |
| OCC conflict storm on a hot bucket | Alert, then investigate bucket width and job concurrency (plan §13)                          |
| Platform limit exceeded            | Treated as a design defect: chunk the work rather than raise the limit                       |
| Region proves too slow for Bangkok | `RG-002` fails; escalate to the self-host decision before production is created              |
| Vendor pricing change              | Unit-economics worksheet re-run (`RG-007`)                                                   |

## 8. Escape hatch

The mitigation for lock-in is kept live rather than theoretical (§5 Q49, plan §13):

1. Domain algebra stays pure and Convex-free (`INV-0002-05`).
2. Logical, documented exports of every tenant table exist and are exercised
   (`RG-065`).
3. Convex self-hosting remains a costed alternative, and it is also the contingency
   if PDPA requires in-country hosting (`RG-006`).
4. Restore rehearsals prove the exports are usable, not merely produced (`RG-047`).

## 9. Configuration

Deployment URLs and keys are environment variables per environment class; only names
appear in [`.env.example`](../../.env.example). Separate deployments for developer,
preview, staging, and production (`RG-059`). No deployment is created by this
repository at this commit.

## 10. Verification

- `convex-test` integration tier for functions, wrappers, jobs, and webhooks.
- Isolation tier for tenant boundaries (`RG-031`).
- Load tests for hot-bucket contention and job concurrency (`RG-037`).
- Latency measurement from the pilot network for both candidate regions (`RG-002`).
- Restore rehearsal against a real backup and a real export (`RG-047`).

## 11. Release gates

`RG-002` region benchmark, `RG-010` latency target, `RG-036` tier sizing, `RG-037`
concurrency ceiling, `RG-047` restore within RTO, `RG-065` backups and exports,
`RG-006`/`RG-048` PDPA transfer basis. See the [register](../release-gates.md).

## 12. Open questions

- Which region wins on the combination of latency and legal basis (`RG-002`,
  `RG-006`).
- Measured platform-limit headroom at the B-11 envelope.
- Whether any component (Workflow, Workpool, Aggregate, Rate Limiter, Migrations)
  carries a pricing or availability constraint at the chosen tier.
