# RB-03 — Ledger and projection drift

Status: **skeleton, never executed.** No ledger, projection, reconciliation job, or alert
exists. Evidence gates: `RG-018` (zero drift in soak), `RG-041` (zero drift across the
pilot).

## Trigger

The reconciliation job reports any inequality between a balance projection or rollup and a
ledger replay (`INV-0003-10`). Drift is always at least P1, and P0 if operators are acting
on the affected balances.

## Principle

The ledger is the source of truth. Projections and rollups are derived and rebuildable.
Therefore:

- **Never** edit a projection by hand to make a number look right.
- **Never** patch or delete a ledger line or transaction (`INV-0003-07`).
- Fix the ledger's _future_ with reversals and corrections; fix the projection by
  rebuilding it from the ledger.

## Preconditions

- `TODO` Reconciliation job exists and its output format is known — blocked by Phase 2.
- `TODO` Drift alert routed to on-call — blocked by `RG-045`.
- `TODO` Projection rebuild procedure implemented and tested — blocked by Phase 2.

## Procedure

1. **Capture the report.** Record affected organizations, warehouses, buckets, the
   ledger-derived value, the projected value, and the run timestamp. Do not rerun the job
   before capturing.
2. **Contain.** If operators are making decisions on the affected buckets, mark the
   affected screens as unreliable. `TODO` mechanism for flagging a bucket — blocked by
   Phase 2.
3. **Classify the drift.**

   | Pattern                                         | Likely cause                                               |
   | ----------------------------------------------- | ---------------------------------------------------------- |
   | One bucket, one transaction's worth of quantity | A projection write that did not accompany its ledger lines |
   | Many buckets, same warehouse and time window    | A code path bypassing the posting service                  |
   | Rollup drifts but the projection matches        | Rollup delta arithmetic defect (`RollupPort`)              |
   | Drift appears only after a reversal             | Reversal compensation defect                               |
   | Drift grows continuously                        | A job double-posting or a retry without idempotency        |

4. **Prove the ledger is internally consistent** before touching projections: every
   transaction balances, no zero-quantity line, no orphan reference
   (`INV-0003-02`…`INV-0003-05`). If the ledger itself is inconsistent, this is a P0
   design defect — stop postings on the affected flow before doing anything else.
5. **Rebuild the projection** for the affected scope from the ledger, then re-run
   reconciliation and confirm zero drift.
6. **Rebuild affected rollups** (`RollupPort.rebuild`) and verify.
7. **Find the write path** that produced the drift. Every drift event is a missing test:
   add a property or integration test that reproduces it before the fix.
8. **Correct real-world quantity differences separately.** If physical stock does not
   match the ledger, that is a counting matter, corrected by an audited adjustment
   transaction with a reason code — not by a rebuild.
9. **Report.** Drift is tenant-visible: the affected tenant is told what was wrong, for how
   long, and what was corrected.

## Never do

- Recompute a projection from another projection.
- Delete and re-create a "clean" transaction to make totals agree.
- Suppress the drift alert threshold to stop the paging.
- Use support access to poke at tenant data without an approved grant
  ([`RB-04`](./support-access.md)).

## Evidence to record

Drift report, affected scope, root cause, the test added, rebuild timings, tenant
communication, and confirmation of zero drift on the following scheduled run.

## References

- [ADR-0003 — append-only inventory ledger](../adr/0003-append-only-inventory-ledger.md)
- [RollupPort](../integration-contracts/rollup-port.md)
- [JobQueuePort](../integration-contracts/job-queue-port.md)
- Plan §7.5, §10 Phase 2 gate, §13
