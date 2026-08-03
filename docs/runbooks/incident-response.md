# RB-01 — Incident response

Status: **skeleton, never executed.** No production environment, alerting, or on-call
rotation exists (`RG-045`, `RG-059`). Evidence gate: `RG-060`.

## Scope

Any event degrading warehouse operations or risking data integrity or confidentiality:
tenant-isolation suspicion, ledger drift, data loss, outage, or a suspected personal-data
breach under Thai PDPA.

## Severity

| Level | Definition                                                                       | Response                            |
| ----- | -------------------------------------------------------------------------------- | ----------------------------------- |
| P0    | Warehouse cannot receive or put away; data loss; suspected cross-tenant exposure | Immediate, all hands, notify tenant |
| P1    | Major function degraded with a workaround; ledger drift detected; backup failure | Same business day                   |
| P2    | Single tenant or single screen impaired                                          | Next business day                   |
| P3    | Cosmetic or low-impact defect                                                    | Normal backlog                      |

Cross-tenant exposure is P0 regardless of scale. So is any drift between ledger and
projections ([`RB-03`](./ledger-drift.md)).

## Preconditions

- `TODO` On-call rotation and contact list — blocked by `RG-045`.
- `TODO` Tenant escalation contacts per organization — blocked by `RG-063`.
- `TODO` Status-page or notification channel decision — blocked by `RG-066`.
- `TODO` PDPA breach-notification thresholds and timelines confirmed by counsel — blocked
  by `RG-048`.

## Procedure

1. **Acknowledge.** Record the alert, time, and reporter. Assign an incident lead.
2. **Classify.** Assign severity. When uncertain between two levels, take the higher.
3. **Stabilize before diagnosing.** Prefer reversible mitigation: disable a feature flag,
   pause a job, or block a specific operation. Do not repair data yet.
4. **Preserve evidence.** Capture audit events, job-run records, request IDs, and
   telemetry before anything is changed. `TODO` evidence-capture commands — blocked by
   `RG-045`.
5. **Assess data integrity.** For anything touching inventory, run the reconciliation
   check and follow [`RB-03`](./ledger-drift.md) if drift exists.
6. **Assess confidentiality.** If cross-tenant exposure is possible, treat it as a
   personal-data incident until proven otherwise and start the PDPA assessment.
   `TODO` assessment template — blocked by `RG-048`.
7. **Communicate.** Notify affected tenants with what is known, what is unknown, and the
   next update time. `TODO` templates in Thai and English — blocked by `RG-056`.
8. **Correct.** Fix forward. Inventory corrections are reversals with reason codes, never
   direct edits (`INV-0003-07`). Destructive steps require a named approver.
9. **Verify.** Confirm the SLIs return to normal, drift is zero, and the affected tenant
   confirms operations resumed.
10. **Close and learn.** Write the timeline, root cause, and follow-up actions. Add a
    regression test for the defect class. Update this runbook with what actually happened.

## Data-integrity incidents

- Never `patch` or `delete` a ledger or audit document, even during an incident
  (`INV-0003-07`, `INV-0012-06`).
- A wrong posting is corrected by a reversal plus a correct posting, both with reason
  codes.
- If a projection is wrong but the ledger is right, rebuild the projection from the
  ledger.
- If the ledger itself is wrong, that is a P0 design defect: stop the affected operation
  before adding more transactions.

## Confidentiality incidents

- Assume exposure until the audit trail proves otherwise.
- Do not use support access to investigate unless a grant is enabled and approved
  ([`RB-04`](./support-access.md)); an investigation must not become a second exposure.
- Record the affected organizations, data classes, and time window for the PDPA
  assessment.

## Evidence to record per incident

Timeline, severity, affected tenants, affected data classes, mitigation, root cause,
customer communications, follow-up items with owners, and whether the runbook was accurate.

`TODO` Incident log location — blocked by `RG-059`.

## References

- [ADR-0003 — ledger invariants](../adr/0003-append-only-inventory-ledger.md)
- [ADR-0012 — DR and quality gates](../adr/0012-delivery-release-and-quality-gates.md)
- [ObservabilityPort — required alerts](../integration-contracts/observability-port.md)
- Plan §13 risks, §14 legal and operational checklist
