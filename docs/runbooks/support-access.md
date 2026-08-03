# RB-04 — Support access to tenant data

Status: **skeleton, never executed.** Support grants are **disabled by default** and no
grant mechanism exists in code
([ADR-0006](../adr/0006-authorization-and-support-access.md)). Evidence gates: `RG-015`
(policy confirmed), `RG-060` (rehearsed).

## Default position

There is no ambient cross-tenant access. With no enabled grant, a platform operator cannot
read tenant data through the application (`INV-0006-08`). That is the intended steady
state, and most support cases must be resolved without tenant data.

## Resolve without access first

1. Reproduce in a demo or staging tenant with synthetic data.
2. Use telemetry: request IDs, failure codes, job-run records, and dead letters carry no
   tenant payload but usually identify the defect
   ([`ObservabilityPort`](../integration-contracts/observability-port.md)).
3. Ask the tenant to supply evidence themselves — a screenshot, an export, a transaction
   ID. A tenant sharing their own data is not cross-tenant access.
4. Ask the tenant's administrator to read the audit trail, which they can see without any
   grant (`admin.audit.read`).

Only if these fail does a grant become a candidate.

## Preconditions for requesting a grant

- `TODO` Support-grant capability implemented and enabled for the tenant — blocked by
  `RG-015` and Phase 1.
- `TODO` Ticketing system of record identified.
- `TODO` Two named platform approvers designated.
- `TODO` Tenant contact authorized to approve grants recorded per organization.

## Procedure (when grants are enabled)

1. **Open a ticket.** No ticket, no grant. The ticket ID is recorded on the grant.
2. **Request.** State the tenant, the reason, the minimum data needed, the shortest
   workable expiry, and whether read-only suffices. Read-only is the default
   (`INV-0006-09`).
3. **Approve.** One platform approver for read-only. **Two** distinct platform approvers
   plus the tenant's `admin.supportGrant.approve` for any write capability. Self-approval is
   impossible (`INV-0006-05`).
4. **Notify the tenant** before access begins, unless the tenant themselves requested it in
   the ticket.
5. **Access minimally.** Read only what the ticket needs. Every access is audited and
   tenant-visible.
6. **Never mutate inventory under a grant** unless the ticket explicitly authorizes it and
   the change is a reversal or correction with a reason code — never a direct edit
   (`INV-0003-07`).
7. **Close early.** Revoke as soon as the diagnosis is complete; do not wait for expiry.
8. **Record.** Attach to the ticket: what was accessed, why, by whom, and the outcome.

## Emergency (break-glass)

`TODO` Emergency path not defined — blocked by `RG-015`. When defined it must retain:
time-boxing, mandatory reason and ticket, tenant notification within a stated window,
retrospective two-person review, and tenant-visible audit. An emergency path that skips
audit is not an emergency path; it is a backdoor.

## Prohibited

- Standing or recurring grants.
- Copying tenant data into telemetry, tickets, chat, or local files.
- Using a grant to explore rather than to answer a specific question.
- Extending a grant to cover a second, unrelated ticket.

## Evidence to record

Ticket ID, tenant, requester, approvers, scope, capability (read or write), start and end
times, what was accessed, and the outcome. Reviewed periodically as required by
`RG-015`.

## References

- [ADR-0006 — authorization and support access](../adr/0006-authorization-and-support-access.md)
- [Permission catalogue §4.5](../permissions.md)
- Plan §5 Q15, §7.1, §14
