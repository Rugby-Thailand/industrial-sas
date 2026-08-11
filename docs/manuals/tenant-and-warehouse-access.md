# Tenant and warehouse access manual

Status: **Backend foundation; no organization switcher UI.** Tenant resolution,
warehouse scoping, bounded storage access, and protected Convex wrappers are
implemented and tested. The client authentication/session shell is not implemented.

## Who this is for

- Tenant administrators assigning organization and warehouse access
- Developers adding protected Convex functions
- Support and security staff investigating access denials

## Access model

The verified Clerk identity supplies the actor and active organization claim. The
server then resolves:

1. the mirrored user;
2. the mirrored organization;
3. the active membership and its effective period;
4. organization-wide or warehouse-scoped access;
5. the requested warehouse, when the operation is warehouse-scoped.

The client never supplies `orgId` or `actorUserId`. A document fetched by ID is read
through tenant-bound storage, which rechecks its organization and, where required,
warehouse scope.

## Membership scope modes

- `ORG_WIDE`: the membership may act across the organization, subject to its roles
  and permissions.
- `WAREHOUSE_SCOPED`: the membership may act only in explicitly assigned warehouses.

A role permission does not widen warehouse scope. Both the permission and target
warehouse must pass.

## Normal request flow

1. The client authenticates with Clerk and selects an active organization.
2. It calls a public function registered with `queryWithOrg`, `mutationWithOrg`, or
   `actionWithOrg`.
3. The wrapper resolves tenant context from verified identity.
4. If the function targets a warehouse, the wrapper validates the warehouse against
   the membership.
5. The wrapper evaluates the declared permission.
6. The handler receives `tenant`, `tenantDb`, and the approved permission. It does
   not receive unrestricted database access.

## Denial handling

The public response uses a generic tenant-context denial message and a structured
code. Do not reveal whether a foreign organization, warehouse, or document exists.
Show a neutral message such as “You cannot access this organization or warehouse”
and log only the structured denial data allowed by the audit policy.

Common causes include:

- no verified identity;
- missing or invalid active organization claim;
- user, organization, or membership not mirrored/active;
- membership not yet effective or already expired;
- requested warehouse absent, inactive, foreign, or not assigned;
- request ID or external reference outside allowed bounds.

## Developer rules for a new feature function

1. Register only through a tenant wrapper.
2. Declare one code-owned, non-platform permission.
3. Declare the target table and warehouse resolver when warehouse-scoped.
4. Accept document IDs only when the handler reads them through `tenantDb`.
5. Use an `orgId`-first bounded index; do not use `.collect()`, a tenant `.filter()`,
   or a raw full-table scan.
6. Never import concrete tenant storage adapters into feature modules.
7. Run `pnpm verify:tenant-boundary`, integration tests, and isolation tests.

## Administrative checklist

- Confirm the Clerk user, organization, and membership are active.
- Confirm the membership scope mode matches the intended access.
- For warehouse-scoped membership, assign every required warehouse explicitly.
- Assign roles separately; warehouse assignment alone grants no action.
- Revoke access by changing membership lifecycle state rather than deleting audit
  history.

## Troubleshooting

- Access works in one warehouse but not another: inspect membership warehouse rows;
  do not broaden the permission role as a workaround.
- A foreign document ID returns “not found”: this is expected tenant-isolation
  behavior and must not be made more specific.
- A new function fails the boundary guard: move database work behind the approved
  tenant storage seam and add the required permission declaration.
- A query denial is absent from `auditEvents`: queries cannot write; this is the
  documented open limitation `RG-071`.

## Implementation references

- `convex/lib/tenantContext.ts`
- `convex/lib/tenantContextLookups.ts`
- `convex/lib/tenantDb.ts`
- `convex/lib/tenantStorage.ts`
- `convex/lib/tenantFunctions.ts`
- [Tenant boundary ADR](../adr/0002-convex-tenant-boundary-and-index-discipline.md)
