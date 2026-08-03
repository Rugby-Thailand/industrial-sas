# ADR-0001 — Multi-tenant SaaS with Clerk-owned identity and Convex-owned authorization

- ID: `ADR-0001`
- Status: **Accepted**
- Date: 2026-08-03
- Decision baseline: [PROJECT_PLAN.md](../../PROJECT_PLAN.md) §1, §2, §3.1, §4, §5,
  §6.1, §7.1
- Covers plan ADR backlog (§11) items: 1 (partly, see
  [ADR-0002](./0002-convex-tenant-boundary-and-index-discipline.md)), 3
- Implementation status: **Not implemented.** No identity, tenancy, membership,
  or webhook code exists in this repository. `@clerk/nextjs` and `convex` are
  installed and unwired. This ADR records the decision, not a shipped
  capability.

## Context

The product is a multi-tenant B2B SaaS WMS for Thai manufacturing companies
(C-01, D-01). A person may work for more than one customer organization and must
be able to switch the active organization (C-02). The launch customer is a Thai
mid-market manufacturer that is neither pharma/cold-chain regulated nor a 3PL
(B-01), provisioned by sales rather than self-service, with billing handled
off-platform during the pilot (B-02, D-30).

Two systems could plausibly own access control. Clerk offers organizations,
roles, and permissions; Convex holds the domain data. Splitting ownership
ambiguously would produce two half-authoritative permission models, and identity
revocation would race domain authorization.

## Decision

1. **Tenant identity.** One Clerk organization is exactly one WMS tenant. The
   Convex `organizations` document mirrors it and carries WMS configuration and
   entitlements (§7.1). The Clerk organization identifier is the external
   correlation key; the Convex document ID is the internal key.
2. **Clerk owns identity.** Credentials, MFA, sessions, reverification,
   organization membership existence, and organization switching are Clerk's
   (C-03, §5 Q12). No credential material is stored in Convex.
3. **Convex owns authorization and domain data.** WMS roles, permissions,
   warehouse scope, policy evaluation, and every domain invariant live in Convex
   (C-03, D-17, and [ADR-0006](./0006-authorization-and-support-access.md)).
   Clerk organization roles are not used as WMS permissions.
4. **Membership is mirrored, not trusted from the client.** Clerk
   organization/user/membership webhooks are verified (`svix`) and applied
   idempotently to Convex `memberships`, so revocation is prompt and every
   request can recheck an active membership locally (§5 Q12, Q13, §10 Phase 1).
5. **Warehouse-scoped membership.** A membership row is scoped to an
   organization and optionally to a warehouse, so one user can hold different
   roles in different warehouses of the same tenant (§5 Q13, §7.1).
6. **Provisioning is idempotent.** Sales-provisioned onboarding and webhook
   replay converge on the same organization state; a replayed provisioning event
   never creates a second tenant (B-02, §5 Q2).
7. **Entitlements are server-enforced.** Plan/entitlement checks run in Convex
   even while billing is manual, so enabling billing later does not require a
   new enforcement point (D-30).

## Invariants

### Code-owned guarantees (must be enforced by code and proven by tests)

- `INV-0001-01` Every tenant-scoped document carries `orgId`; no domain document
  is reachable without one (see
  [ADR-0002](./0002-convex-tenant-boundary-and-index-discipline.md)).
- `INV-0001-02` The active `orgId` is derived server-side from the verified Clerk
  token and an active mirrored membership. A client-supplied `orgId` is never
  authoritative (§6.1).
- `INV-0001-03` A domain operation fails if the actor has no active membership in
  the resolved organization at the moment of the operation.
- `INV-0001-04` Clerk webhook handlers verify the signature before any state
  change and are idempotent on `(eventId)`.
- `INV-0001-05` One Clerk organization maps to at most one Convex
  `organizations` document, and the mapping is unique in both directions.
- `INV-0001-06` No Convex table stores passwords, MFA secrets, or session
  tokens.
- `INV-0001-07` Entitlement checks are evaluated server-side; a disabled
  entitlement cannot be bypassed by the client.

### Operational assumptions (not enforceable by code)

- `OPS-0001-01` Clerk remains the contracted identity provider and its
  organization feature stays available on the purchased plan.
- `OPS-0001-02` Sales/onboarding staff follow the tenant-onboarding runbook, so
  tenants are created through the supported flow only
  ([runbook](../runbooks/tenant-onboarding.md)).
- `OPS-0001-03` Billing is reconciled off-platform during the pilot (D-30).
- `OPS-0001-04` The launch tenant matches B-01; a pharma or 3PL customer
  invalidates this ADR's scope assumptions.

## Consequences

- Clerk becomes a hard availability dependency for sign-in; a Clerk outage stops
  new sessions even though Convex data is intact.
- Membership drift between Clerk and Convex is a real failure mode and needs a
  scheduled reconciliation plus per-request recheck (plan §13).
- WMS roles are not visible in Clerk's dashboard; support staff must read them in
  the WMS administration screens.
- Self-service signup, trials, abuse controls, and in-product billing are out of
  scope and would each be new work (B-02).
- A user's organization switch changes the entire authorization context, so
  caches and queries must be keyed by `orgId`.

## Rejected alternatives

| Alternative                                          | Why rejected                                                                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Database-per-tenant                                  | Operationally heavy on Convex, multiplies deployment/migration cost, and is unjustified at the D-01/B-11 scale envelope. |
| Clerk organization roles as the WMS permission model | Too coarse for warehouse-scoped and maker-checker policies, and it would place authorization outside the transaction.    |
| Convex owning identity and credentials               | Rebuilds MFA, session, and invitation flows with no product benefit and more security surface.                           |
| Single-organization users                            | Contradicts C-02 and blocks consultants, group companies, and shared supervisors.                                        |
| Self-service tenant signup at launch                 | Adds trial, abuse, entitlement, and billing lifecycle work before any pilot evidence exists (B-02).                      |
| Trusting a client-supplied `orgId` header            | The browser is untrusted (§6.1); this is the classic cross-tenant leak.                                                  |

## Verification

Planned, not present. Each item lands with the code it verifies.

- Integration tests (`tests/integration/`): token verification, membership
  resolution, revoked-membership rejection, organization switch, idempotent
  Clerk webhook replay.
- Isolation tests (`tests/isolation/`): two-tenant fixtures prove that a
  document ID from tenant A is rejected while acting as tenant B — a blocking
  merge gate (plan §12, `RG-031`).
- Property tests: none specific to this ADR.
- E2E (`tests/e2e/`): sign-in, organization switch, warehouse-restricted
  navigation.

## Release gates

- `RG-001` Written acceptance of B-01…B-12.
- `RG-011` Organization creation, user invitation, organization switch, and
  warehouse restriction demonstrated in staging (plan §10 Phase 1 gate).
- `RG-012` Every exported tenant Convex function uses the auth/tenant wrapper.
- `RG-014` No secret or real tenant data exists in demo/preview environments.
- See the [release gate register](../release-gates.md) for owner, evidence, and
  status.

## References

- Plan §1, §2.1, §3.1 (C-01…C-03, C-07), §3.2 (D-01, D-17, D-18, D-30), §4
  (B-01, B-02), §5 Q1, Q2, Q12, Q13, Q15, Q16, §6.1, §7.1, §10 Phase 1, §13.
- [ADR-0002 — Convex tenant boundary and index discipline](./0002-convex-tenant-boundary-and-index-discipline.md)
- [ADR-0006 — Authorization, warehouse policy, maker-checker, and support access](./0006-authorization-and-support-access.md)
- [Integration contract INT-01 — Clerk](../integration-contracts/clerk-identity.md)
- [Domain glossary](../domain-glossary.md)
