# Operational runbooks

Status: **skeletons.** These are procedure outlines, not rehearsed procedures. Every step
that depends on infrastructure, a vendor console, or a rehearsal that has not happened is
marked `TODO`. A runbook is only trustworthy once it has been executed end to end and its
`TODO` markers are replaced with what actually happened.

There is no production, staging, or preview environment at this commit, so **no runbook in
this directory can currently be executed**.

## Index

| ID      | Runbook                                                | Trigger                                     | Evidence gate      |
| ------- | ------------------------------------------------------ | ------------------------------------------- | ------------------ |
| `RB-01` | [Incident response](./incident-response.md)            | Any P0/P1 incident or alert page            | `RG-060`           |
| `RB-02` | [Backup, export, and restore](./backup-and-restore.md) | Quarterly rehearsal or data-loss incident   | `RG-047`, `RG-065` |
| `RB-03` | [Ledger drift](./ledger-drift.md)                      | Reconciliation reports non-zero drift       | `RG-018`, `RG-041` |
| `RB-04` | [Support access](./support-access.md)                  | A support case needs tenant data            | `RG-015`, `RG-060` |
| `RB-05` | [Tenant onboarding](./tenant-onboarding.md)            | A new pilot or customer tenant              | `RG-011`, `RG-060` |
| `RB-06` | [Tenant offboarding](./tenant-offboarding.md)          | Tenant termination or data deletion request | `RG-058`           |
| `RB-07` | [Key and secret rotation](./key-rotation.md)           | Scheduled rotation or suspected exposure    | `RG-060`           |
| `RB-08` | [Release and rollback](./release-and-rollback.md)      | Every production release                    | `RG-060`           |
| `RB-09` | [Printer and scanner failure](./device-failure.md)     | Hardware fails at the pilot site            | `RG-003`, `RG-004` |

## Conventions

- **Stable IDs.** `RB-04` stays `RB-04`. Steps are numbered within a runbook and cited as
  `RB-04.3`.
- **Every runbook states its preconditions** and refuses to proceed if they are unmet.
  Half-executed operational procedures cause the second incident.
- **`TODO` markers are load-bearing.** Each one names the missing artefact and the gate
  that closes it. Removing a `TODO` without the artefact is a documentation defect.
- **Destructive steps are called out** and require a named approver.
- **Evidence is recorded** after every execution: who, when, what happened, what differed
  from the runbook. That record is what turns a skeleton into a runbook.
- **No secrets in runbooks.** Reference credentials by name and location, never by value.

## What must be true before these are usable

| Prerequisite                                                | Gate               |
| ----------------------------------------------------------- | ------------------ |
| Staging and production environments exist and are separated | `RG-059`           |
| Backups and independent encrypted exports run on schedule   | `RG-065`           |
| Alert routing reaches a named on-call recipient             | `RG-045`           |
| A restore has been rehearsed within the RTO                 | `RG-047`           |
| Support-access policy is confirmed                          | `RG-015`           |
| PDPA incident and erasure obligations are documented        | `RG-048`, `RG-058` |
