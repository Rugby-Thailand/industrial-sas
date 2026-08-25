# Topic 3 — Identity and tenant fixtures

## First-slice actor

Create one synthetic actor, `e2e-inbound-operator`, in the dedicated Clerk test
instance. The actor belongs to one synthetic organization and one warehouse and
receives only the permissions required by the ordinary inbound path.

The fixture must prove the same provisioning route used by the product:

```text
Clerk user + organization membership
  → signed webhook mirror
  → organization/user/membership rows
  → active tenant and warehouse resolution
  → code-owned permission evaluation
```

Do not insert an identity directly into the database if doing so would skip the
webhook or provisioning seam under test.

## Required fixture facts

| Fact            | Requirement                                                                       |
| --------------- | --------------------------------------------------------------------------------- |
| Organization    | Synthetic, test-only, stable external identity                                    |
| User            | Synthetic name/email; no real person data                                         |
| Membership      | Active membership in exactly the test organization                                |
| Warehouse scope | Exactly one active warehouse for the first slice                                  |
| Role            | Least-privilege role for PO, receipt, handling-unit, putaway, and inventory reads |
| Locale          | Thai primary; English remains covered by the credential-free routing suite        |

The implementation must derive the precise permission list from
[`docs/permissions.md`](../../permissions.md) and the permission constants in the
called Convex modules. Do not use an all-powerful administrator merely to make the
test pass.

## Provisioning strategy

1. A setup command verifies the Clerk user, organization, and membership exist.
2. It creates missing test facts idempotently through supported provider APIs.
3. It delivers or verifies the signed identity mirror event.
4. It waits through a bounded poll for tenant resolution to become ready.
5. It verifies the warehouse and role assignment through an authenticated read.

Every setup operation must be safe to replay. Provider object IDs are configuration,
not assertions embedded in the spec.

## Future second actor

The later QC slice adds `e2e-quality-approver` with a distinct identity and
maker-checker permission. It must use a separate browser context and must not
approve its own disposition. That actor is deliberately excluded from the first
merge gate.

## Exit criteria

- Sign-in succeeds without a manually prepared local browser profile.
- The server resolves the expected organization and warehouse.
- Removing one required permission makes the relevant UI action unavailable or
  refused and creates no stock fact.
- The actor cannot read a second synthetic organization's data.
