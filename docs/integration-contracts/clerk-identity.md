# INT-01 — Clerk identity, organizations, and membership sync

Status: **partial implementation.** The pure normalized-event kernel in
`convex/lib/identityWebhook.ts` applies organization, user, and membership upserts
and tombstones with entity-local event watermarks. Replays and equal or older
deliveries do not write, new memberships default to warehouse-scoped, and raw Clerk
payloads are outside the kernel's accepted shape. The mirror schema carries only the
minimal correlation, display, status, and watermark fields. The signed HTTP ingress,
Convex transaction adapter, auth configuration, and live Clerk instance remain
unimplemented.

Owner ADRs:
[ADR-0001](../adr/0001-multi-tenant-saas-and-identity-ownership.md),
[ADR-0006](../adr/0006-authorization-and-support-access.md).

## 1. Capability

Clerk provides authentication, MFA, session management, reverification,
organizations, and organization membership existence (C-03). It provides **no**
warehouse authorization: WMS roles, permissions, and warehouse scope are Convex's
(`ADR-0006`).

## 2. Direction and trust boundary

| Flow                       | Direction        | Trust                                                                     |
| -------------------------- | ---------------- | ------------------------------------------------------------------------- |
| Sign-in and session        | Browser ↔ Clerk  | Clerk is authoritative for identity                                       |
| Token presentation         | Browser → Convex | Token verified server-side; claims trusted only after verification (§6.1) |
| Membership events          | Clerk → Convex   | Webhook signature verified before any state change                        |
| Reverification check       | Convex → Clerk   | Freshness verified server-side at write time (`INV-0006-07`)              |
| Invitations and user admin | App → Clerk      | Requires an admin permission in our catalogue first                       |

The browser never supplies `orgId`, role, or permission. The active organization is
resolved from the verified token plus an active mirrored membership
(`INV-0001-02`, `INV-0001-03`).

## 3. Port operations

Planned shape, subject to Phase 1 implementation:

```ts
type IdentityPort = {
  verifySessionToken(token: string): Promise<VerifiedActor>;
  requireFreshReverification(
    actor: VerifiedActor,
    maxAgeSeconds: number,
  ): Promise<void>;
  inviteMember(input: InviteMemberInput): Promise<InviteResult>;
  revokeMembership(input: RevokeMembershipInput): Promise<void>;
};
```

`VerifiedActor` carries the external user ID, the external organization ID, the
reverification timestamp, and nothing else. Mapping to internal IDs is a Convex
lookup, not a claim.

## 4. Timeouts and retries

| Operation                  | Timeout | Retries                      | On exhaustion                                   |
| -------------------------- | ------- | ---------------------------- | ----------------------------------------------- |
| Token verification         | 1 s     | 0 (fail the request)         | Return `unauthorized`; the user retries         |
| Reverification check       | 2 s     | 1                            | Deny the privileged operation                   |
| Invite / revoke            | 5 s     | 2 with backoff               | Surface `unavailable`; the admin retries        |
| Webhook handling (inbound) | 5 s ack | Clerk retries per its policy | Our handler stays idempotent, so replay is safe |

Token verification uses cached signing keys so the common path needs no network
round trip.

## 5. Idempotency

- Every webhook is keyed on the Clerk event ID and applied at most once
  (`INV-0001-04`).
- Provisioning is idempotent: replaying an organization-created event converges on
  one tenant (`INV-0001-05`).
- Out-of-order events are handled by comparing event timestamps; an older event never
  overwrites newer state.
- The future HTTP ingress will acknowledge unsupported event types without invoking
  the mirror mutation, so Clerk does not retry them forever.

## 6. Data and privacy

| Data                                  | Direction      | Notes                                                       |
| ------------------------------------- | -------------- | ----------------------------------------------------------- |
| Display name and external user ID     | Clerk → Convex | Mirrored as a profile reference; no email address is stored |
| Organization name and external ID     | Clerk → Convex | Tenant identity                                             |
| Password, MFA secrets, session tokens | Never stored   | `INV-0001-06`                                               |
| Audit actor reference                 | Convex only    | Retained with audit events (seven years provisional, D-27)  |

Clerk is a subprocessor and must appear in the subprocessor register (`RG-048`).
Personal data crossing the boundary is limited to identity attributes needed for
attribution and notification. Erasure requests distinguish profile data from
retained business records (`RG-058`).

## 7. Failure semantics

| Situation                                 | Behaviour                                                                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Clerk unavailable                         | Existing verified sessions continue for domain operations that need no reverification; new sign-ins fail with a clear message |
| Invalid or expired token                  | `unauthorized`; no domain operation proceeds                                                                                  |
| Webhook signature invalid                 | Reject with no state change; record a security event; alert                                                                   |
| Webhook delivery gap                      | Scheduled membership reconciliation detects drift (plan §13)                                                                  |
| Membership revoked in Clerk, mirror stale | Per-request membership recheck denies the operation once the mirror updates; reconciliation bounds the window                 |
| Reverification unavailable                | Privileged operations are denied, never allowed by default                                                                    |

Membership drift is treated as a real risk, not an edge case: signed idempotent
webhooks, a per-request recheck, short privileged sessions, and scheduled
reconciliation are all required (plan §13).

## 8. Configuration

Names only; values live outside the repository ([`.env.example`](../../.env.example)).
Separate Clerk instances per environment (`RG-059`). Session lifetimes and MFA
requirements are dashboard configuration, recorded in the Phase 1 environment design
(`OPS-0006-03`).

## 9. Verification

- Integration tests with a fake identity adapter: verified actor resolution, revoked
  membership rejection, organization switch, reverification freshness.
- Implemented kernel tests: replay is a no-op; out-of-order delivery cannot regress
  state; membership identity is organization-keyed; malformed, unbounded, and
  PII-bearing normalized objects are rejected before storage.
- Pending ingress tests: a valid signature invokes the mutation once; an invalid
  signature is rejected before any state change; unsupported types are acknowledged.
- Isolation tests: an actor of tenant A cannot resolve tenant B under any token
  manipulation the client controls.
- No test requires a Clerk account or network access (`INV-0008-05`).

## 10. Release gates

`RG-011` staging walkthrough, `RG-030` shared-device and session policy, `RG-059`
environment separation, `RG-048` subprocessor register entry. See the
[register](../release-gates.md).

## 11. Open questions

- Session lifetime values compatible with warehouse shifts (§5 Q16, `RG-030`).
- Which operations require step-up, beyond the ones marked in the
  [permission catalogue](../permissions.md).
- Whether Clerk's data region matters for the PDPA transfer basis (`RG-006`).

## 12. Authoritative integration references

- [Clerk `verifyWebhook()` reference](https://clerk.com/docs/reference/backend/verify-webhook)
- [Clerk webhook synchronization guide](https://clerk.com/docs/guides/development/webhooks/syncing)
- [Clerk backend organization-membership type](https://clerk.com/docs/reference/backend/types/backend-organization-membership)
