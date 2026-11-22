# Customers v1 — rollout and rollback

**Applies to:** the PR that adds `convex/customers/*` and `/master-data/customers`.

## What changes on deploy

- Additive schema only: the new `customers` table (four indexes) and `customerCatalogueSignals` (one small row per organization, which advances when list order or membership can change). No existing table, index or document changes.
- Two new organization-level permissions: `masterData.customer.read` and `masterData.customer.manage`. The release seed updates the global permission catalogue. **New** organizations get both grants on their seeded `ORG_ADMIN` role.
- Existing organizations receive no grants on deploy, because seeding skips roles that already exist. Their admins don't see **ลูกค้า / Customers** until step 3 runs. The pages also refuse anyone without the grants. The feature stays hidden for those organizations until the upgrade, which is safe.

## Access needed

Every `convex run --prod` command below needs the production deployment's deploy key in `CONVEX_DEPLOY_KEY`, run from a clean checkout of the merged commit. The key lives with the Vercel production project, not in CI secrets.

## Release order

1. Merge the PR. The `Planner quality` workflow releases the merge commit automatically: CI, then staging when it is enabled, then a production backup, then deploy.
2. Wait for the `Production release` job to succeed. Confirm the live app loads and the sidebar is unchanged for an existing organization.
3. Upgrade the seeded admin roles of existing organizations. This needs deployment administration access:

   ```sh
   pnpm exec convex run --prod customers/provision:upgradeOrgAdminRoles '{}'
   # Repeat with the returned cursor until "isDone": true:
   pnpm exec convex run --prod customers/provision:upgradeOrgAdminRoles '{"cursor":"<continueCursor>"}'
   ```

   Each call checks up to 50 organizations. Write down every `continueCursor` as a checkpoint. After an interruption, resume from the last checkpoint. A rerun is idempotent, so an organization that was already upgraded reports `current`. Batches also list the organization IDs counted as `customized` or `missing`.

4. Verify the grants. The check is read-only:

   ```sh
   pnpm exec convex run --prod customers/provision:verifyOrgAdminGrants '{}'
   # Page with "cursor" until "isDone": true.
   ```

   Every organization should report its seeded admin as granted, customized or missing.

## Customized or missing administrators

- **`customized`**: the organization changed its `ORG_ADMIN` grants, so the upgrade left the role alone on purpose. Ask that organization's owner whether its admins should manage customers, then grant `masterData.customer.read` and `masterData.customer.manage` deliberately. Don't edit the role to look seeded.
- **`missing`**: the organization has no seeded `ORG_ADMIN`. No action is needed unless the organization asks for customers.

## Rollback

Both new tables, `customers` and `customerCatalogueSignals` (one generation counter per organization), are additive. No existing table changes. Choose the smallest step that fixes the problem.

1. **Hide the feature for seeded administrators, without a deploy.** Revoke the grants that the seed and the upgrade gave:

   ```sh
   pnpm exec convex run --prod customers/provision:revokeOrgAdminGrants '{}'
   # Repeat with the returned cursor until "isDone": true.
   pnpm exec convex run --prod customers/provision:verifyOrgAdminGrants '{}'
   # Page through it, and note every organization still reporting
   # hasCustomerRead: true or hasCustomerManage: true. Either grant alone
   # still opens (read) or writes (manage) customer records.
   ```

   This removes both customer grants from seeded administrators whose grants are exactly the current default. Within seconds those members lose the sidebar entry, and the pages and functions refuse them. Customer records stay untouched. The revoker is conservative: it does not touch any role it reports as `customized`. Such a role may still hold customer access, either granted by hand or granted by the upgrade before the organization renamed or changed it. The verify pass lists those organizations. It checks each organization's `ORG_ADMIN` role, the only role the seed and the upgrade ever grant. A customer grant added to some other role by hand has to be found and removed by hand. Remove their grants deliberately, or go to step 2 if every write must stop now. To switch the feature back on, run `upgradeOrgAdminRoles` again. New organizations are still seeded with the grants until the code is reverted.

2. **Remove the code and keep the data.** This step stops all customer reads and writes. Revert the PR's merge commit with `git revert -m 1 <merge-sha>` and merge the revert. The release pipeline backs up production, then deploys. On a local Convex backend holding documents in both tables, pushing the baseline schema succeeded (`Schema validation complete.`). The push deleted the five customer indexes, and both documents stayed readable. Customer data survives a code rollback and comes back when the change is applied again. Permission rows already granted are inert once the code is gone.

Deleting customer data is not part of rollback. Steps 1 and 2 never need it, and the release pipeline's pre-deploy backup covers the period. If records ever must be erased, for example on a data-subject request, handle that as a separate reviewed data task with a rehearsed restore. Do not delete tables from the dashboard during an incident.

An already open tab is affected on its next server call. After step 1, members whose grants were revoked are refused. Members listed by the verify pass keep whatever their remaining grant allows. After step 2 the functions no longer exist for anyone, and the page shows its load error.

## v2 Linking and historical backfill

- **Additive schema only:** `customerAliases` and `customerWarehouseActivity` tables, optional `aliasSearchText` on `customers`, optional `customerId` and `customerLinkSource` on `finishedGoodsProducts` and `finishedGoodsJobScans`, optional `customerReviewPending` on `finishedGoodsJobScans`, and reverse lookup indexes. No existing fields or captured text (`customer`, `customerReference`) are modified or overwritten.
- **Live auto-linking:** starts automatically on new job scans once customers and approved aliases exist. Blank, unmatched, ambiguous, or archived matches continue saving without a link and mark `customerReviewPending: true` when non-blank.
- **Historical job-scan backfill (per warehouse):** after customer records exist, run a **complete** dry-run pass through `isDone: true` first to inspect warehouse totals, then restart from the beginning for the apply pass:

  ```sh
  # Pass 1 — complete read-only preview across the warehouse:
  pnpm exec convex run --prod customers/backfill:backfillJobScanCustomers '{"warehouseId":"<warehouseId>","dryRun":true}'
  # Repeat passing the returned "continueCursor" as "cursor" until "isDone": true:
  pnpm exec convex run --prod customers/backfill:backfillJobScanCustomers '{"warehouseId":"<warehouseId>","dryRun":true,"cursor":"<continueCursor>"}'

  # Pass 2 — restart from the beginning to apply matches and index pending review rows:
  pnpm exec convex run --prod customers/backfill:backfillJobScanCustomers '{"warehouseId":"<warehouseId>","dryRun":false}'
  # Checkpoint every returned "continueCursor" and pass it back as "cursor" until "isDone": true:
  pnpm exec convex run --prod customers/backfill:backfillJobScanCustomers '{"warehouseId":"<warehouseId>","dryRun":false,"cursor":"<continueCursor>"}'
  ```

  Backfill skips voided scans and any row that already has a link decision (`AUTO`, `MANUAL`, or `UNLINKED`). The `updated` total includes both newly linked tickets and newly marked pending tickets. On apply (`dryRun: false`), exact unique matches link with `customerLinkSource: "AUTO"` and update `customerWarehouseActivity`; ambiguous, archived, and unmatched non-blank scans are stamped with `customerReviewPending: true` so they appear in the indexed review queue.

### v2 Rollback

1. Pause automatic assignments on the production deployment with `pnpm exec convex env set --prod CUSTOMER_AUTO_LINK_PAUSED true`. New scans retain the captured name. Historical dry runs remain available and apply runs refuse while paused.
2. To hide the module and its manual link actions, revoke customer grants as described above and verify the target administrators. Review custom roles individually. Keep the v2 backend, schema, and activity maintenance deployed. Warehouse operators can still correct or delete tickets while paused. Those changes continue to update the derived activity rows.
3. To resume, remove the pause with `pnpm exec convex env remove --prod CUSTOMER_AUTO_LINK_PAUSED` and restore the intended grants. Inspect the latest job for a customer whose ticket changed during the pause, then dry-run the backfill for paused-period tickets. The queue also pages historical undecided tickets before backfill.
4. A permanent removal needs a separately reviewed migration of populated optional fields and projections before dropping schema support. Rolling the backend back to the v1 implementation after v2 writes would leave stale summaries and can fail schema validation.

## Data handled

The detail query returns customer contact, address and tax ID, and only to members holding `masterData.customer.read`. The list query returns summary fields only: code, name, status and province; per-page product counts and latest-job summaries are fetched separately for members who also hold `masterData.storageLayout.read`. On finished-goods products and job-scan lists/corrections, `customerId`, `customerLinkSource`, `customerName`, `customerCode`, and link-change history entries are returned only to members holding `masterData.customer.read`. Audit records name changed contact, address, tax ID, notes, and alias fields without storing raw sensitive values.

Browser storage and URLs:

- Request identities live in memory, and the list status filter is the only customer-list preference saved between visits.
- Customer list search stays in the page URL and browser history so Back can restore it (an exact tax-ID search is therefore visible in that URL).
- Opening “Create new customer” from review stores the captured name in this tab’s session storage and passes an opaque prefill token to the form. The URL contains only the token.
- While editing an unsaved finished-goods product, the product form stores `customerId` (an opaque Convex document ID, not customer PII) alongside the other draft fields in local browser draft storage until saved or discarded.
