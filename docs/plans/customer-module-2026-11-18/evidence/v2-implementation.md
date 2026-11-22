# Customers v2 — Implementation & Verification Evidence

**Baseline commit on `main`:** `574b9d42`
**Feature branch:** `feat/customers-v2-linking`

## 1. Scope & Architecture Decisions

- **Additive schema only (`convex/schema.ts`, `convex/lib/schemaPolicy.ts`):**
  - Added `customerAliases` (unique per `(orgId, customerId, normalizedAlias)` and lookup index `by_orgId_normalizedAlias`).
  - Added `customerWarehouseActivity` (compact materialized per-`(orgId, customerId, warehouseId)` summary holding `linkedProductCount`, `latestJobScanId`, `latestJobFactoryOrder`, and `latestJobCreatedAt`).
  - Added optional `aliasSearchText` on `customers` (maintained incrementally on alias add/remove without paginated mutation scans) so `listCustomersPage` searches aliases with zero extra table reads.
  - Added optional `customerId`, `customerLinkSource` on `finishedGoodsProducts` and `finishedGoodsJobScans`, plus optional boolean `customerReviewPending` and indexed ranges for pending and unclassified tickets on `finishedGoodsJobScans`.
  - A link decision preserves the captured ticket text and product reference. A deliberate ticket text correction trims the replacement and clears a blank value, consistent with the previous correction API. Products link only through an explicit customer selection.
- **Reverse permission isolation:**
  - Warehouse-only members (without `masterData.customer.read`) never receive `customerId`, `customerLinkSource`, `customerName`, `customerCode`, or customer-link correction diffs from `listJobScans`, `listJobScanCorrections`, `getProduct`, `getPallet`, `catalogue.findSku`, `catalogue.page`, `batches.getBatch`, or `batchManagement.get`.
  - Both `SET` and `CLEAR` on `saveProduct` and `updateJobScan` use the same target and permission checks. An unrelated edit preserves the link.
- **Out-of-scope warehouse & review hardening:**
  - Exact warehouse scope checks (`canAccessWarehouse`) are enforced before writes and before idempotency replay in `resolveUnresolvedScans`, and on `addCustomerAlias(exampleJobScanId)`.
  - `resolveUnresolvedScans` validates single-name group membership (`MIXED_NAME_GROUP`), pending state (`ALREADY_RESOLVED`), version match (`STALE_REVISION`), and `aliasText` alignment before writing; records per-ticket `auditEvents` with `warehouseId`; and returns the original `aliasId` on idempotent replay.
  - `removeCustomerAlias` uses `checkIdempotency` + `verifiedResultIdentity` so idempotent replays return `{ ok: true, aliasId, replayed: true }` after deletion, and both alias add/remove redact raw alias text in `auditEvents`.
  - `getCustomerActivity` omits `exampleJobScanId` from public aliases and pairs with customer-specific jobs, products and alias queries for bounded continuation beyond the preview. Jobs and products page through authorized warehouse indexes.

## 2. Measured Whole-Query Read Budget (Baseline `574b9d42` vs HEAD)

Measured via `tests/fixtures/query-read-stats.ts` (`measured`) in `tests/integration/customers-linking.integration.test.ts` on a tenant with 105 active customers and 106 aliases on customer #1:

| Query                                                                          | Table                                             | Baseline (`574b9d42`) | HEAD (`feat/customers-v2-linking`) | Delta |
| ------------------------------------------------------------------------------ | ------------------------------------------------- | --------------------: | ---------------------------------: | ----: |
| `customers/catalogue:listCustomersPage` (`pageSize: 20, status: "ACTIVE"`)     | `customers`                                       |                    20 |                                 20 |     0 |
| `customers/catalogue:listCustomersPage` (`pageSize: 20, status: "ACTIVE"`)     | `customerAliases`                                 |                     0 |                                  0 |     0 |
| `customers/catalogue:listCustomersPage` (`pageSize: 20, status: "ACTIVE"`)     | `finishedGoodsProducts`                           |                     0 |                                  0 |     0 |
| `customers/catalogue:listCustomersPage` (`pageSize: 20, status: "ACTIVE"`)     | `finishedGoodsJobScans`                           |                     0 |                                  0 |     0 |
| `customers/catalogue:listCustomersPage` (`pageSize: 20, status: "ACTIVE"`)     | `customerWarehouseActivity`                       |                   N/A |                                  0 |     0 |
| `customers/catalogue:listCustomersPage` (`pageSize: 20, status: "ACTIVE"`)     | `warehouses`                                      |                     0 |                                  0 |     0 |
| `customers/linking:listCustomerActivitySummaries` (20 zero-activity customers) | `customerWarehouseActivity`                       |                   N/A |                                  0 |     0 |
| `customers/linking:listCustomerActivitySummaries` (20 zero-activity customers) | `finishedGoodsProducts` / `finishedGoodsJobScans` |                   N/A |                                  0 |     0 |

The baseline measurement was replayed in an isolated export of `574b9d42` using its `measured` and `seedCustomerSearch` fixtures with 105 active customers. Its 53 existing catalogue integration tests also passed.

To reproduce from the feature checkout, export the original fixture into a temporary directory and attach the measurement to its own test file. Both commits use the same pinned dependencies.

```sh
baseline_dir=$(mktemp -d)
git archive 574b9d42 | tar -x -C "$baseline_dir"
ln -s "$PWD/node_modules" "$baseline_dir/node_modules"
cat >> "$baseline_dir/tests/integration/customers.integration.test.ts" <<'TEST'

it("measures the v1 unfiltered read budget at the v2 fixture cardinality", async () => {
  const world = await seedCustomerSearch(() => false, undefined, 105);
  const { stats } = await measured(world, listCustomersPage, {
    pageSize: 20, status: "ACTIVE",
  });
  const reads = [stats.rangeDocs.customers, stats.rangeDocs.finishedGoodsProducts ?? 0,
    stats.rangeDocs.finishedGoodsJobScans ?? 0, stats.rangeDocs.warehouses ?? 0];
  expect(reads).toEqual([20, 0, 0, 0]);
});
TEST
(cd "$baseline_dir" && pnpm exec vitest run tests/integration/customers.integration.test.ts)
```

Separating `listCustomerActivitySummaries` onto the compact `customerWarehouseActivity` table keeps `listCustomersPage` at **0% read-budget regression** relative to `574b9d42`, while zero-activity customers incur zero extra document reads and the populated 100-customer regression with three warehouse activity rows per customer reads 300 activity documents in 100 index ranges, with zero raw product or scan reads. A customer whose complete summary exceeds the request budget has an unavailable count.

## 3. Scale & Edge-Case Verification

Verified in `tests/integration/customers-linking.integration.test.ts` and `src/features/customers/CustomerScreens.test.tsx`:

- **Blank-scan immunity:** 105 blank scans created after 1 older unresolved named scan do not hide the unresolved scan in `reviewSummary` or `listUnresolvedNames` (backed by sparse `by_orgId_warehouseId_customerReviewPending_createdAt`).
- **Blank tickets leave the legacy stream:** 150 blank tickets saved through `saveJobScans` are stamped `customerReviewPending: false`. The banner reports one named ticket with `hasMore: false`, and the queue is one page. Backfill retires 150 historical blank/voided tickets, leaving `listCustomerBackfillWarehouses` at `legacyRemaining: false` and one queue page. A retired blank ticket named later auto-links or enters review (`tests/integration/customer-review-queue.integration.test.ts`).
- **Picker scale:** Customer #105 is returned on page 1 of `searchCustomerOptions` by exact code/name/alias and reachable by substring via `scanCursor` continuation.
- **Alias scale:** Alias #106 on a customer is indexed into `aliasSearchText` without calling `.paginate()` inside a mutation, matches `listCustomersPage` search, and paginates via `listCustomerAliasesPage`.
- **UI regression coverage:** Preselected review candidate overridden by `CustomerPickerDialog` submits the chosen customer; empty review queue "Back to list" calls `returnFromTask` and restores filtered origin; cross-warehouse product and scan links carry `?warehouseId=`; `ProductScreen` freezes `customerLink` and `requestId` across lost-response retries even if live subscriptions advance.

The scoped paging regression places 520 hidden products and 320 newer hidden jobs ahead of visible records. Another case exercises tied jobs over a 105-warehouse scope. The detail preview checks up to 99 authorized warehouses. It can read one job range and one product range per warehouse. Paging then follows the warehouse indexes. The UI labels the warehouse ordering and fetches each page live when the user moves forward or back.

The mixed-upgrade regression visits both incoming and legacy pending tickets exactly once. Two further cases place a ticket beyond the first 100 warehouses and drain the queue as an organization-wide and a warehouse-scoped reader. Alias additions that would exceed 16,000 normalized characters are refused before the link decision or alias changes. Removing an existing alias frees space for a retry. Both alias entry points refuse a name claimed by another customer, and an alias saved from review receives its own redacted audit event.

To reproduce the data and permission checks:

```sh
pnpm exec vitest run tests/integration/customers-linking.integration.test.ts tests/integration/customer-review-queue.integration.test.ts tests/integration/customer-activity-reads.integration.test.ts
```

## 4. Pause and recovery

The rollout guide documents the production automatic-link pause and grant changes. The registered-handler regression populates a linked ticket, pauses matching, saves an unmatched ticket, deletes the original, verifies the empty latest-job summary, then resumes and verifies the new latest ticket. Existing projections are maintained through the pause.

The same sequence passed on a disposable local Convex deployment with the real deployment environment variable toggled during the rehearsal. The test account could continue saving and deleting tickets while matching was paused.

The real local Clerk and Convex browser suite runs with `pnpm test:e2e:hr:local customers.spec.ts`. Mobile and desktop Chromium each passed the name-only save and reload, refused-edit draft protection, and review → remember alias → next ticket auto-link workflows.

The local rollback rehearsal now runs directly through the isolated HR test harness with a real authenticated caller. Its environment check requires the worktree-owned loopback deployment and refuses production keys. Prepare the local harness as described in `tests/e2e/hr-local/README.md`, then run:

```sh
pnpm test:e2e:hr:local customers.spec.ts --grep 'pausing and resuming' --project hr-desktop
```

Recorded on 22 November 2026: `[hr-e2e] passed: 1 passed, 0 failed, 0 skipped`. The case creates a customer, confirms exact linking, changes the deployment flag, saves another ticket, deletes the original, checks the live summary and confirms a new ticket links after resuming.

On 22 November 2026, the full customer browser suite reported `4 passed, 0 failed, 0 skipped` on each of `hr-desktop` and `hr-mobile` for the implementation at `33353153`. This includes the pause, deletion and resume case.
