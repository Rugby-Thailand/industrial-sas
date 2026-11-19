# Customers v1 — rollout and rollback

**Applies to:** the PR that adds `convex/customers/*` and `/master-data/customers`.

## What changes on deploy

- Additive schema only: the new `customers` table and its four indexes. No existing table, index or document changes.
- Two new organization-level permissions: `masterData.customer.read` and `masterData.customer.manage`. The release seed updates the global permission catalogue. **New** organizations get both grants on their seeded `ORG_ADMIN` role.
- Existing organizations receive no grants on deploy, because seeding skips roles that already exist. Their admins don't see **ลูกค้า / Customers** until step 3 runs. The pages also refuse anyone without the grants. The feature stays hidden for those organizations until the upgrade, which is safe.

## Release order

1. Merge the PR. The `Planner quality` workflow releases the merge commit automatically: CI, then staging when it is enabled, then a production backup, then deploy.
2. Wait for the `Production release` job to succeed. Confirm the live app loads and the sidebar is unchanged for an existing organization.
3. Upgrade the seeded admin roles of existing organizations. This needs deployment administration access:

   ```sh
   pnpm exec convex run --deployment prod customers/provision:upgradeOrgAdminRoles '{}'
   # Repeat with the returned cursor until "isDone": true:
   pnpm exec convex run --deployment prod customers/provision:upgradeOrgAdminRoles '{"cursor":"<continueCursor>"}'
   ```

   Each call checks up to 50 organizations. Write down every `continueCursor` as a checkpoint. After an interruption, resume from the last checkpoint. A rerun is idempotent, so an organization that was already upgraded reports `current`. Batches also list the organization IDs counted as `customized` or `missing`.

4. Verify the grants. The check is read-only:

   ```sh
   pnpm exec convex run --deployment prod customers/provision:verifyOrgAdminGrants '{}'
   # Page with "cursor" until "isDone": true.
   ```

   Every organization should report its seeded admin as granted, customized or missing.

## Customized or missing administrators

- **`customized`**: the organization changed its `ORG_ADMIN` grants, so the upgrade left the role alone on purpose. Ask that organization's owner whether its admins should manage customers, then grant `masterData.customer.read` and `masterData.customer.manage` deliberately. Don't edit the role to look seeded.
- **`missing`**: the organization has no seeded `ORG_ADMIN`. No action is needed unless the organization asks for customers.

## Rollback

The schema change is additive, and the feature stays off until someone holds the grants. Choose the smallest step that fixes the problem:

1. **Hide the feature.** Revert the UI commit (`feat(customers): customer list, detail, create and edit screens`) and merge the revert. The sidebar entry and routes disappear. Customer records, grants and the backend stay, so existing data is untouched and re-enabling is a plain re-revert.
2. **Stop writes but keep reads.** In the same revert, also remove the four mutations in `convex/customers/writes.ts`. Pages that are already open then fail closed on Save and show the generic save error. No records change.
3. **Full removal** only when no customer records need keeping. First export the records (`pnpm exec convex export` with the production backup flow), then delete the table's documents, then revert the backend commit. Convex refuses to drop a table definition that still holds documents, so the order matters.

Permission grants that already exist on roles are harmless after steps 1 and 2, because the permission codes stay in the catalogue. Pages already open after a frontend-only rollback keep working until the tab reloads. The backend they call is unchanged.

## Data handled

The detail query returns customer contact, address and tax ID, and only to members holding `masterData.customer.read`. The list query returns summary fields only: code, name, status and province. Audit records name changed contact, address, tax ID and notes fields without their values. The browser keeps no customer field values: request identities live in memory, and only the list's status filter is remembered between visits.
