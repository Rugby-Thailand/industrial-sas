# Roles, permissions, authorization, and audit manual

Status: **Backend enforcement; no administration UI.** The code-owned catalogue,
eight default roles, server-side authorization decision, warehouse scope, step-up,
maker-checker evaluation, and mutation/action audit append are implemented. Tenant
policy values and role-management screens are not implemented.

## Who this is for

- Organization administrators and warehouse managers
- Security reviewers and auditors
- Developers declaring permissions on new operations

## The model

- Permission codes are owned by application code and use
  `domain.subject.action` names.
- Tenant roles compose those codes. A tenant may edit roles but cannot invent a
  permission code.
- Membership-role assignments connect an active membership to one or more roles.
- The operation's declared scope is either organization, warehouse, or platform.
- Platform permissions are never granted to tenant roles.

## Seeded roles

1. `ORG_ADMIN`
2. `WAREHOUSE_MANAGER`
3. `SUPERVISOR`
4. `RECEIVER`
5. `QC_INSPECTOR`
6. `PUTAWAY_OPERATOR`
7. `INVENTORY_ANALYST`
8. `VIEWER`

The seed is an initial template, not a permanent override. Reprovisioning must leave
an existing tenant's edited role names and permission composition unchanged.

## Authorization flow

1. A protected function declares one catalogue permission.
2. Tenant and warehouse context resolve from verified identity.
3. The server reads active membership roles and role permissions using bounded
   tenant indexes.
4. Entitlement, device, threshold, maker-checker, and step-up facts are computed
   server-side.
5. The policy evaluator allows or denies.
6. Mutations and actions append the attempt to `auditEvents`; queries cannot append.
7. Only an allowed request reaches the feature handler.

## Extra policy meanings

- **Step-up:** the actor needs a recent qualifying authentication event. The current
  code-owned maximum age is 10 minutes.
- **Maker-checker:** the actor who performs/approves a sensitive action must differ
  from the maker when the operation requires separation of duties.
- **Threshold:** a tenant-configured magnitude may require extra approval. The
  catalogue marks these operations, but tenant threshold values are still pending.

Inventory reversal requires all three. Its current threshold fact is explicitly
provisional because no threshold policy table exists.

## Administrative procedure

Until a role UI exists, use only controlled provisioning/migration code or test
fixtures—never ad hoc raw writes.

1. Start from a seeded role whose purpose matches the job.
2. Apply least privilege and preserve warehouse scope separately.
3. Review all added/removed permission codes.
4. Use a second approver for sensitive role changes.
5. Record the change request and verify the resulting audit trail.
6. Test an allowed and a denied action with representative users.

## Reading denials

Keep these categories distinct:

- authentication/tenant denial: identity or active scope could not be established;
- authorization denial: the actor lacks permission or an extra policy fact;
- domain refusal: permission passed, but the requested business change is invalid.

Do not convert every failure to “permission denied”; doing so hides data errors and
makes support investigation much harder.

## Support grants

Support access is disabled by default and is not an operating workflow yet. Tenant
roles cannot receive platform permissions. Do not simulate support access by adding
cross-tenant reads or assigning an organization administrator role to support staff.
Follow the support-access runbook when the grant workflow is implemented.

## Troubleshooting

- Role contains a code but access is denied: check membership lifecycle, warehouse
  scope, entitlement, step-up freshness, maker-checker identity, and device state.
- New permission is not in existing tenants' roles: expected; ship an explicit
  migration instead of rerunning the seed.
- An authorization attempt is missing from audit: determine whether it was a query;
  query-denial auditing remains an open design gate.
- Build guard rejects a permission: use a literal, non-platform code from
  `PERMISSION_CATALOGUE`.

## Implementation references

- `convex/lib/permissions.ts`
- `convex/lib/authorization.ts`
- `convex/lib/authorizationLookupsConvex.ts`
- `convex/lib/authorizationSeedConvex.ts`
- [Full permission catalogue](../permissions.md)
- [Support access runbook](../runbooks/support-access.md)
