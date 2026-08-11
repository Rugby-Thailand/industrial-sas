# Inventory maintenance jobs

**Current availability: Callable drivers; no schedule registered.** Both jobs are
public Convex queries with checkpoints, budgets, and structured outcomes, proved
by integration and two-tenant isolation suites. **Nothing runs them on a
schedule**, because scheduling needs a deployed backend — see "Registering a
schedule" for the exact gate.

## The two jobs

| Function                            | What it does                                        | Writes |
| ----------------------------------- | --------------------------------------------------- | ------ |
| `inventory/jobs:reconcileWarehouse` | Replays each bucket's ledger lines, reports drift   | never  |
| `inventory/jobs:planExpiry`         | Finds stock whose lot expired as of a business date | never  |

Both declare `inventory.balance.read` and are warehouse-scoped, so the server
revalidates the warehouse against the actor's membership before the handler runs
(`INV-0006-04`).

### Why both are queries

**Reconciliation must not repair.** A job that could write could quietly make a
balance agree with a wrong replay (`OPS-0003-02`). A Convex query cannot write,
so that is the runtime's guarantee rather than a reviewer's.

**Expiry plans; posting is separate.** `planExpiry` reports which buckets have
expired and what would move. The compensating `STATUS_CHANGE` is
`inventory.transaction.post`, with its own permission, its own idempotency, and
its own audit row — because moving stock into `EXPIRED` is a ledger transaction
(§5 Q19), not a side effect of a scan.

## One page per call

**Convex permits one paginated query per function execution.** That platform rule
decides the whole shape:

- Each invocation reads exactly **one** bounded page of balances and returns the
  checkpoint to resume from. The caller loops.
- Per-bucket reconciliation therefore cannot page a second time. It uses
  `reconcileBucketBounded`, a non-paginated `take` capped at
  `MAX_BOUNDED_RECONCILE_LINES` (99 — one below the accessor's own cap, so the
  read can ask for one extra row and tell "exactly this many" from "at least
  this many").

A bucket with 100 or more ledger lines is reported as drift of kind
`RECONCILE_INCOMPLETE`. That is the honest answer: the sweep did not finish
checking it. Such a bucket needs the resumable `reconcileBucketPage` path driven
by a caller that spends its own pagination budget on that one bucket.

## Driving a sweep

```
checkpoint = undefined
loop:
  result = reconcileWarehouse({ warehouseId, checkpoint, maxPageSize })
  if !result.ok: stop and report result.error
  accumulate result.drift
  if result.status == "COMPLETE": done
  if result.status == "FAILED": stop; result.checkpoint is safe to retry from
  checkpoint = result.checkpoint          // status == "BUDGET_EXHAUSTED"
```

`status` is three values and they mean different things:

| Status             | Meaning                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `COMPLETE`         | The index is exhausted. `checkpoint.cursor` is `null`.                                                                                |
| `BUDGET_EXHAUSTED` | One page done, more to do. Call again with the checkpoint.                                                                            |
| `FAILED`           | A page could not be read or processed. The checkpoint points at the page that failed, so a retry re-reads it rather than skipping it. |

Collapsing the first two would make "the job finished" indistinguishable from
"the job gave up", which is the one thing an operator watching a nightly
reconciliation needs to know.

## The checkpoint

`{ cursor, pagesRead, itemsProcessed }`. It carries the reader's own opaque
cursor and two counters, and deliberately **not** a document ID, a timestamp, or
a "last key" — those are recoverable-looking values that go wrong when rows are
inserted or deleted between runs.

It is validated on the way in (`validateCheckpoint`): a checkpoint crosses the
wire from a scheduler or a client, so it is exactly the kind of value that
satisfies the interface structurally and not actually.

## What `planExpiry` considers

- **Physical buckets only.** A virtual boundary is a counterparty outside the
  warehouse (`G-023`); its balance is routinely negative because a `SOURCE`
  boundary supplies rather than holds, and planning a movement out of one would
  be planning to move stock that is not there.
- **`AVAILABLE` stock only.** The set is imported from
  `EXPIRY_SOURCE_STATUSES` rather than restated, so the driver and the kernel
  cannot drift. Quarantined, rejected, and scrapped stock is already withheld
  from use.
- **Non-zero balances only.** A zero balance has nothing to move; posting one
  would be an audited no-op.
- **Lots with an expiration date.** A bucket with no lot — an item tracked
  `NONE` — has no expiry.

`asOf` defaults to today **in the organization's timezone**, never the host's
(D-05). A supplied date is parsed by the strict business-date kernel, so
`2026-8-11` is refused rather than shifted.

## Registering a schedule

Not done, and the gate is precise:

1. A Convex deployment must exist (`RG-002`), because a cron is registered
   against one.
2. `convex/crons.ts` would name these functions. Both are **queries**, and a
   Convex cron calls a mutation or an action — so the scheduled entry point is a
   thin action that loops the driver and reports through `ObservabilityPort`
   (`INT-05`), which needs a sink nobody has approved yet.
3. The loop needs a per-tenant fan-out: these functions are tenant-bound and
   resolve their organization from a verified token, so a scheduler needs a
   system-actor path that does not exist (`INV-0006-08` reserves `SYSTEM` for
   scheduled work and nothing implements it).

Until all three land, the drivers are called by a client or a test. That is why
they are complete and their schedule is not.

## Verification

- `convex/model/inventory/jobRun.test.ts` — 18 unit tests over the pure driver:
  resume equivalence, interruption at every page boundary, checkpoint not
  advancing past a failed page, a reader whose cursor does not advance, budget
  and checkpoint validation.
- `tests/integration/inventory-jobs.integration.test.ts` — 16 tests over real
  ledger rows: drift detection against a deliberately corrupted balance,
  resumability, one-page-per-call, read-only-ness, expiry over physical buckets.
- `tests/isolation/inventory-jobs.isolation.test.ts` — 7 two-tenant tests,
  including one that resumes tenant B's sweep from **tenant A's checkpoint** and
  proves it cannot read more rows than tenant B owns.

## Related

- [ADR-0003 — Append-only inventory ledger](../adr/0003-append-only-inventory-ledger.md)
- [ADR-0011 — Async jobs, reporting, and observability](../adr/0011-async-jobs-reporting-and-observability.md)
- [Inventory ledger](./inventory-ledger.md)
- [Stock rotation and expiry](./stock-rotation-and-expiry.md)
- [Observability and SLIs](./observability-and-slis.md)
