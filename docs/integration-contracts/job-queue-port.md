# INT-06 — `JobQueuePort` (durable, bounded asynchronous work)

Status: **specification.** No jobs, crons, workflows, outbox, or dead-letter handling
exist. Convex Workflow, Workpool, and Rate Limiter components are not installed.

Owner ADR:
[ADR-0011](../adr/0011-async-jobs-reporting-and-observability.md).

## 1. Capability

Run work that must survive a page close, a deployment, or a failure: reconciliation,
expiry reclassification, imports, exports, outbox delivery, backups, and membership
sync. Backed by Convex Workflow (resumable orchestration), Workpool (bounded
concurrency), and crons (schedules) (D-21).

## 2. Direction and trust boundary

| Flow              | Direction               | Trust                                                        |
| ----------------- | ----------------------- | ------------------------------------------------------------ |
| Enqueue           | Convex mutation → queue | Enqueued inside the transaction that justifies the work      |
| Execution         | Queue → Convex action   | Runs with a system actor plus the originating tenant context |
| External delivery | Job → vendor            | At-least-once, idempotency key required                      |
| Dead letters      | Job → durable record    | Visible to operators (`reporting.jobRun.read`)               |

A job always carries its `orgId`; there is no cross-tenant job. Jobs run under a system
actor whose actions are audited as such, not attributed to a user.

## 3. Port operations

```ts
type JobQueuePort = {
  enqueue(input: EnqueueInput): Promise<JobRunId>;
  schedule(input: ScheduleInput): Promise<JobRunId>;
  cancel(input: { jobRunId: JobRunId; reason: string }): Promise<void>;
  status(jobRunId: JobRunId): Promise<JobRunStatus>;
};
```

`EnqueueInput` names the job type, its tenant context, a bounded payload reference (not
a large payload), an idempotency key, and a priority class.

## 4. Bounds every job declares

No job is accepted without all five (`INV-0011-01`):

| Property           | Rule                                                                  |
| ------------------ | --------------------------------------------------------------------- |
| Concurrency limit  | Per job type and per tenant, so one tenant cannot starve another      |
| Chunk size         | Fixed maximum documents per step; steps stay under the platform limit |
| Retry policy       | Bounded attempts with exponential backoff and jitter                  |
| Dead-letter target | Durable record with cause and payload reference                       |
| Priority class     | `interactive-support`, `batch`, or `maintenance`                      |

Interactive scanning is never behind a job. If a job is on the critical path of a scan,
that is a design defect.

## 5. Timeouts and retries

| Class                   | Step budget | Attempts | Notes                                           |
| ----------------------- | ----------- | -------- | ----------------------------------------------- |
| Reconciliation          | ≤ 60 s      | 3        | Chunked by bucket range; resumable cursor       |
| Expiry reclassification | ≤ 60 s      | 3        | Posts ledger transactions; idempotent per lot   |
| Import (CSV/XLSX)       | ≤ 60 s      | 3        | Resumable per row range; idempotent per row ref |
| Export                  | ≤ 60 s      | 2        | Produces a private artifact                     |
| Outbox delivery         | ≤ 10 s      | 5        | Backoff to dead letter; consumer deduplicates   |
| Membership sync         | ≤ 30 s      | 3        | Reconciles Clerk mirror drift                   |
| Backup / logical export | Job-defined | 2        | Failure alerts immediately (`RG-065`)           |

## 6. Idempotency

- Every enqueue carries an idempotency key; enqueueing the same key twice yields one
  run (`INV-0011-02`).
- Every step is idempotent per chunk, so a retried step cannot double-post.
- Ledger-affecting jobs use the standard `requestId` mechanism, derived
  deterministically from the job run and chunk, so a retry replays rather than
  duplicates (`INV-0003-01`).
- Cancellation is idempotent and never leaves half-applied chunks: a cancelled job stops
  between chunks.

## 7. Data and privacy

- Payloads carry references, not tenant business data, so a queue record is not a second
  copy of the ledger.
- Job-run records include actor, tenant, timings, and outcome; they are audit-adjacent
  and follow the operational-log retention class rather than the seven-year ledger class
  (D-27).
- Dead-letter records may include a failure payload reference; they must not embed
  personal data (`INV-0011-10`).

## 8. Failure semantics

| Situation                          | Behaviour                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------ |
| Step fails transiently             | Retry with backoff inside the attempt budget                                               |
| Attempts exhausted                 | Dead letter with cause; alert if the type is critical (reconciliation, backup)             |
| Job type saturated                 | Queue depth grows; alert on depth, shed `maintenance` before `batch`                       |
| Tenant floods ingestion            | Rate limiter rejects with `rateLimited`; interactive work is unaffected                    |
| Deployment during a run            | Workflow resumes from its cursor; steps are idempotent so replay is safe                   |
| Cron misses a window               | Next run detects the gap and processes it; gaps are visible, never silent                  |
| Reconciliation finds drift         | Alert immediately; do not auto-repair (`ADR-0003`, [runbook](../runbooks/ledger-drift.md)) |
| Outbox consumer permanently broken | Dead letters accumulate and alert; delivery is never dropped to clear the queue            |

## 9. Configuration

Concurrency limits, chunk sizes, and schedules are code-owned defaults with per-tenant
overrides where justified. No vendor credentials are involved; the components run inside
the Convex deployment.

## 10. Verification

- Integration tests: chunk resumption after an injected failure, dead-letter routing,
  cancellation between chunks, idempotent enqueue, cron gap handling.
- Property tests: replaying any step sequence yields the same end state; a retried
  ledger-affecting chunk posts once.
- Load tests: queue depth and interactive latency under a receiving peak plus a large
  import (`RG-037`).

## 11. Release gates

`RG-018` seven-day zero-drift soak, `RG-037` concurrency ceiling, `RG-045` dead-letter
alerting, `RG-065` backup and export jobs operating. See the
[register](../release-gates.md).

## 12. Open questions

- Per-tenant concurrency defaults that keep 40 concurrent scanners unaffected during a
  large import.
- Whether reconciliation runs nightly per tenant or continuously in rotation at higher
  tenant counts.
- Dead-letter retention window.
