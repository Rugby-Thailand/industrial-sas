# Customers v2 — Implementation & Verification Evidence

**Baseline commit on `main`:** `574b9d42`
**Feature branch:** `feat/customers-v2-linking`

## 1. Scope & Architecture Decisions

- **Additive schema only (`convex/schema.ts`, `convex/lib/schemaPolicy.ts`):**
  - Added `customerAliases` (unique per `(orgId, customerId, normalizedAlias)` and lookup index `by_orgId_normalizedAlias`).
  - Added `customerWarehouseActivity` (compact materialized per-`(orgId, customerId, warehouseId)` summary holding `linkedProductCount`, `latestJobScanId`, `latestJobFactoryOrder`, and `latestJobCreatedAt`).
  - Added optional `aliasSearchText` on `customers` (maintained incrementally on alias add/remove without paginated mutation scans) so `listCustomersPage` searches aliases with zero extra table reads.
  - Added optional `customerId`, `customerLinkSource` on `finishedGoodsProducts` and `finishedGoodsJobScans`, plus sparse `customerReviewPending: v.optional(v.literal(true))` and index `by_orgId_warehouseId_customerReviewPending_createdAt` on `finishedGoodsJobScans`.
  - Raw captured text (`finishedGoodsJobScans.customer` and `finishedGoodsProducts.customerReference`) is preserved verbatim; product `customerReference` is never auto-linked.
- **Reverse permission isolation:**
  - Warehouse-only members (without `masterData.customer.read`) never receive `customerId`, `customerLinkSource`, `customerName`, `customerCode`, or customer-link correction diffs from `listJobScans`, `listJobScanCorrections`, `getProduct`, `getPallet`, `catalogue.findSku`, `catalogue.page`, `batches.getBatch`, or `batchManagement.get`.
  - Both `SET` and `CLEAR` on `saveProduct` and `updateJobScan` require `masterData.customer.read`; unrelated edits by warehouse-only staff preserve existing links.
- **Out-of-scope warehouse & review hardening:**
  - Exact warehouse scope checks (`canAccessWarehouse`) are enforced before writes and before idempotency replay in `resolveUnresolvedScans`, and on `addCustomerAlias(exampleJobScanId)`.
  - `resolveUnresolvedScans` validates single-name group membership (`MIXED_NAME_GROUP`), pending state (`ALREADY_RESOLVED`), version match (`STALE_REVISION`), and `aliasText` alignment before writing; records per-ticket `auditEvents` with `warehouseId`; and returns the original `aliasId` on idempotent replay.
  - `removeCustomerAlias` uses `checkIdempotency` + `verifiedResultIdentity` so idempotent replays return `{ ok: true, aliasId, replayed: true }` after deletion, and both alias add/remove redact raw alias text in `auditEvents`.
  - `getCustomerActivity` omits `exampleJobScanId` from public aliases and pairs with `listCustomerAliasesPage` and `listCustomerProductsPage` for bounded continuation past the preview cap.

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

Separating `listCustomerActivitySummaries` onto the compact `customerWarehouseActivity` table keeps `listCustomersPage` at **0% read-budget regression** relative to `574b9d42`, while zero-activity customers incur zero extra document reads and the populated 100-customer regression with three warehouse activity rows per customer reads 300 activity documents in 100 index ranges, with zero raw product or scan reads. A customer whose complete summary exceeds the request budget has an unavailable count.

## 3. Scale & Edge-Case Verification

Verified in `tests/integration/customers-linking.integration.test.ts` and `src/features/customers/CustomerScreens.test.tsx`:

- **Blank-scan immunity:** 105 blank scans created after 1 older unresolved named scan do not hide the unresolved scan in `reviewSummary` or `listUnresolvedNames` (backed by sparse `by_orgId_warehouseId_customerReviewPending_createdAt`).
- **Picker scale:** Customer #105 is returned on page 1 of `searchCustomerOptions` by exact code/name/alias and reachable by substring via `scanCursor` continuation.
- **Alias scale:** Alias #106 on a customer is indexed into `aliasSearchText` without calling `.paginate()` inside a mutation, matches `listCustomersPage` search, and paginates via `listCustomerAliasesPage`.
- **UI regression coverage:** Preselected review candidate overridden by `CustomerPickerDialog` submits the chosen customer; empty review queue "Back to list" calls `returnFromTask` and restores filtered origin; cross-warehouse product and scan links carry `?warehouseId=`; `ProductScreen` freezes `customerLink` and `requestId` across lost-response retries even if live subscriptions advance.

The mixed-upgrade regression visits both incoming and legacy pending tickets exactly once. Two further cases place a ticket beyond the first 100 warehouses and drain the queue as an organization-wide and a warehouse-scoped reader. Alias additions that would exceed 16,000 normalized characters are refused before the link decision or alias changes. Removing an existing alias frees space for a retry.

To reproduce the data and permission checks:

```sh
pnpm exec vitest run tests/integration/customers-linking.integration.test.ts tests/integration/customer-review-queue.integration.test.ts tests/integration/customer-activity-reads.integration.test.ts
```

## 4. Pause and recovery

The rollout guide documents the production automatic-link pause and grant changes. The registered-handler regression populates a linked ticket, pauses matching, saves an unmatched ticket, deletes the original, verifies the empty latest-job summary, then resumes and verifies the new latest ticket. Existing projections are maintained through the pause.

The same sequence passed on a disposable local Convex deployment with the real deployment environment variable toggled during the rehearsal. The test account could continue saving and deleting tickets while matching was paused.

The real local Clerk and Convex browser suite runs with `pnpm test:e2e:hr:local customers.spec.ts`. Mobile and desktop Chromium each passed the name-only save and reload, refused-edit draft protection, and review → remember alias → next ticket auto-link workflows.
