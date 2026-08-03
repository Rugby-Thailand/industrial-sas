# RB-02 — Backup, independent export, and restore

Status: **skeleton, never executed.** No deployment, backup schedule, export target, or
rehearsal exists. Evidence gates: `RG-065` (backups and exports operating), `RG-047`
(restore within RTO).

## Targets

| Objective | Initial target | Source                                      |
| --------- | -------------- | ------------------------------------------- |
| RPO       | 24 hours       | D-26 (`TODO` confirm with the pilot tenant) |
| RTO       | 8 hours        | D-26 (`TODO` confirm with the pilot tenant) |

Two mechanisms exist because one is insufficient: platform periodic backups cover recent
recovery, and independent encrypted logical exports cover the seven-year ledger/audit
retention the backup window does not reach (D-27, plan §13).

Point-in-time recovery is **not** claimed. Contracts must not promise it (plan §14,
`RG-061`).

## Preconditions

- `TODO` Paid Convex tier with periodic backups enabled — blocked by `RG-036`.
- `TODO` Durable export destination selected, with its region cleared for PDPA transfer —
  blocked by `RG-006`.
- `TODO` Encryption key management and rotation defined — see [`RB-07`](./key-rotation.md).
- `TODO` Retention schedule per data class confirmed — blocked by `RG-049`.

## Backup procedure (scheduled)

1. Platform periodic backups run on the deployment schedule. `TODO` schedule and retention
   values.
2. A scheduled job produces an independent logical export per tenant table, encrypted at
   rest, written to the durable destination
   ([`JobQueuePort`](../integration-contracts/job-queue-port.md)).
3. The job records an export manifest: tables, row counts, byte sizes, checksum, and the
   business date covered.
4. Failure of either mechanism alerts immediately; a silent backup failure is the failure
   mode this step exists to prevent (`RG-045`).

## Verification procedure (monthly)

1. Read the latest manifest and confirm row counts are plausible against the rollups
   (`RU-01`, `RU-09`).
2. Verify checksums and that the artefact decrypts with the current key.
3. Confirm the oldest retained export still satisfies the retention decision.
4. Record the check. `TODO` verification log location.

## Restore rehearsal (quarterly)

1. Announce the rehearsal; it runs against a scratch environment, never production.
2. Record the start time — RTO measurement begins here.
3. Restore the platform backup into the scratch deployment. `TODO` exact commands —
   blocked by `RG-059`.
4. Restore the independent export into the same scratch environment and compare the two
   sources for consistency.
5. Verify integrity: ledger replay equals projections (`INV-0003-10`), audit events are
   present and unmodified, and sampled receipts match their original history.
6. Verify a tenant boundary: a restored tenant's data is not visible to another tenant.
7. Record the completion time and compare with the RTO target (`RG-047`).
8. Record what differed from this runbook and correct it.

## Restore during an incident (destructive)

**Requires a named approver.** A production restore can discard work committed after the
backup point.

1. Follow [`RB-01`](./incident-response.md) first: classify, stabilize, preserve evidence.
2. Quantify the loss window and identify the warehouse work that would be discarded.
3. Prefer a targeted correction (reversals, projection rebuild) over a full restore.
   Restoring is the last resort.
4. If a restore is unavoidable: get written approval, notify affected tenants **before**
   restoring, then execute the rehearsed procedure.
5. After restore, reconcile physical stock with the restored ledger at the pilot site;
   discarded transactions must be re-entered as new postings with reason codes, never by
   editing history.

## Evidence to record

Rehearsal date, operator, start and completion times, RTO comparison, integrity checks
performed, discrepancies found, and runbook corrections.

## References

- [ADR-0012 — delivery, DR, and quality gates](../adr/0012-delivery-release-and-quality-gates.md)
- [Convex hosting contract](../integration-contracts/convex-hosting.md)
- Plan §3.2 (D-26, D-27), §5 Q42, §10 Phase 4, §13, §14
