# ADR-0006 — Permission-based authorization, warehouse scope, maker-checker, and disabled support grants

- ID: `ADR-0006`
- Status: **Accepted**
- Date: 2026-08-03
- Decision baseline: [PROJECT_PLAN.md](../../PROJECT_PLAN.md) §3.2 (D-17), §5 Q14,
  Q15, Q16, §6.1, §7.1
- Covers plan ADR backlog (§11) items: 4, 5
- Implementation status: **Not implemented.** No permission catalogue, role seed,
  policy evaluator, support-grant table, or step-up integration exists. The
  [permission catalogue](../permissions.md) is a specification of intended code,
  not a description of shipped code.

## Decision

1. **Permissions, not roles, are the unit of enforcement.** Every protected
   operation names a permission code from a code-owned catalogue. Roles are
   org-editable compositions over that catalogue (D-17, §7.1). The catalogue is
   versioned in the repository, not tenant data
   ([docs/permissions.md](../permissions.md)).
2. **Server-side only.** Convex is the single enforcement point. UI permission
   checks exist for usability and are never relied upon (§6.1).
3. **Warehouse scope is part of every decision.** A permission grant is evaluated
   against the target warehouse. An organization-wide membership may act in all
   warehouses; a warehouse-scoped membership may not act outside its warehouses
   ([ADR-0001](./0001-multi-tenant-saas-and-identity-ownership.md), §5 Q13).
4. **Contextual policies layer on top.** Beyond a permission check, an operation
   may require a threshold policy (quantity/value above a limit), separation of
   duties, or step-up reverification (D-17, §5 Q14, Q16).
5. **Maker-checker.** For designated operations — QC disposition, over-receipt
   above tolerance, ledger reversal, master-data destructive change — the actor who
   submits cannot be the actor who approves. Approval is a distinct audited
   transaction (§5 Q27, plan §10 Phase 3).
6. **Step-up for privileged actions.** Privileged operations require MFA and Clerk
   reverification within a bounded freshness window; a shared handheld session can
   never carry a privileged action implicitly (§5 Q16, plan §13).
7. **Support grants exist in the model but ship disabled.** There is no ambient
   cross-tenant access. `supportGrants` is schema-ready with reason, ticket,
   approval, and expiry, and the capability is **disabled by default**: with no
   enabled grant, no platform operator can read tenant data through the
   application. Enabling it for a tenant requires the documented approval path,
   read-only default, two-person approval for any write, tenant-visible audit, and
   automatic expiry (§5 Q15).
8. **Shared-device actors are always identified.** Device context is recorded, and
   there is no communal privileged account (plan §13).

## Invariants

### Code-owned guarantees

- `INV-0006-01` Every exported mutation and every non-public query declares a
  required permission code; an undeclared operation fails closed.
- `INV-0006-02` Permission codes are code-owned; a tenant cannot invent a
  permission, only compose roles from the catalogue.
- `INV-0006-03` Authorization decisions are made server-side inside the same
  transaction as the write they guard.
- `INV-0006-04` Every decision is evaluated against `(orgId, warehouseId?)`; a
  warehouse-scoped actor is rejected outside scope.
- `INV-0006-05` Maker-checker operations reject an approval whose actor equals the
  submitting actor.
- `INV-0006-06` Threshold policies are evaluated on server-computed values, never
  on client-supplied totals.
- `INV-0006-07` Privileged operations require a reverification whose freshness is
  verified server-side.
- `INV-0006-08` With no enabled support grant, no cross-tenant read or write path
  exists in application code.
- `INV-0006-09` A support grant is time-boxed, carries reason and ticket, is
  read-only unless two approvals exist, expires automatically, and every access
  under it is audited and visible to the tenant.
- `INV-0006-10` Denials are audited with actor, permission, target, and reason.
- `INV-0006-11` Seeded roles are created idempotently and are editable by the
  tenant without code changes.

### Operational assumptions

- `OPS-0006-01` The permission catalogue is reviewed with the pilot tenant before
  Phase 1 completion (§5 Q14, `RG-024`).
- `OPS-0006-02` The support-access policy — including whether grants are enabled at
  all for the pilot — is confirmed by the product owner and the tenant (§5 Q15,
  `RG-015`).
- `OPS-0006-03` Session lifetimes are set to shift-compatible values in the Clerk
  dashboard; that configuration lives outside this repository (§5 Q16).
- `OPS-0006-04` Customers operate shared handhelds with real user switching rather
  than a shared login; the system can identify actors but cannot prevent badge
  sharing.
- `OPS-0006-05` Emergency (break-glass) access, if ever needed, follows the
  documented review process ([runbook](../runbooks/support-access.md)).

## Consequences

- Every new operation costs a catalogue entry and a role-mapping decision, which
  is what makes the model auditable.
- Maker-checker requires at least two staffed roles per shift for QC release and
  reversals; a single-operator site cannot use those flows without an explicit,
  audited policy exception.
- Step-up reverification adds friction on handhelds; privileged flows are therefore
  steered to desktop (D-02, plan §5 Q10).
- Support cannot "just look" at tenant data. Diagnosis relies on tenant-provided
  evidence, logs without tenant payloads, and — only if enabled — an approved
  grant.
- The permission catalogue becomes an API-shaped contract: renaming a code is a
  migration, not a refactor.

## Rejected alternatives

| Alternative                                        | Why rejected                                                                                        |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Fixed role checks in function bodies               | Cannot express warehouse scope or thresholds; every policy change becomes a code change.            |
| Clerk organization roles as WMS permissions        | Coarse, external to the transaction, and unable to carry warehouse or threshold context (ADR-0001). |
| Tenant-defined permission codes                    | Makes enforcement points unverifiable and breaks static checks.                                     |
| Client-side permission enforcement                 | The browser is untrusted (§6.1).                                                                    |
| Ambient support access for the platform team       | Unbounded cross-tenant exposure; incompatible with PDPA processor posture (§5 Q15, §14).            |
| Support grants enabled by default                  | Default-on standing access is the risk this ADR exists to remove; disabled-by-default fails safe.   |
| Maker-checker as a UI convention                   | Trivially bypassed by direct API calls; must be a server-side invariant.                            |
| Long-lived privileged sessions on shared handhelds | Any passer-by inherits privilege; step-up reverification is the mitigation (plan §13).              |

## Verification

Planned, not present.

- Integration tests: permission-required matrix per exported function; warehouse
  scope rejection; threshold policy boundaries; maker equals checker rejection;
  stale reverification rejection; denial audit rows.
- Isolation tests: no cross-tenant read/write path with support grants disabled;
  with a fixture grant enabled, read-only enforcement and expiry.
- Property tests: role composition never grants a permission absent from the
  catalogue; scope resolution is monotone (adding a warehouse never removes
  access).
- Unit tests: pure policy evaluation over fixture memberships and catalogue.
- E2E: QC hold and release performed by two different users.

## Release gates

- `RG-015` Support-access policy confirmed (including grant enablement).
- `RG-024` Permission catalogue reviewed with the pilot tenant.
- `RG-026` Unauthorized warehouse actions fail server-side (plan §10 Phase 3).
- `RG-030` Shared-device and privileged-session policy confirmed.
- Register: [release gates](../release-gates.md).

## References

- Plan §3.2 (D-17), §3.3, §5 Q12, Q13, Q14, Q15, Q16, Q27, §6.1, §7.1, §10
  Phase 1 and Phase 3, §12, §13, §14.
- [Permission catalogue and seeded roles](../permissions.md)
- [ADR-0001 — Multi-tenant SaaS and identity ownership](./0001-multi-tenant-saas-and-identity-ownership.md)
- [ADR-0002 — Convex tenant boundary](./0002-convex-tenant-boundary-and-index-discipline.md)
- [Support access runbook](../runbooks/support-access.md)
