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
| `customers/catalogue:listCustomersPage` (`pageSize: 20, status: "ACTIVE"`)     | `customers`                                       |                 <= 21 |                              <= 21 |     0 |
| `customers/catalogue:listCustomersPage` (`pageSize: 20, status: "ACTIVE"`)     | `customerAliases`                                 |                     0 |                                  0 |     0 |
| `customers/catalogue:listCustomersPage` (`pageSize: 20, status: "ACTIVE"`)     | `finishedGoodsProducts`                           |                     0 |                                  0 |     0 |
| `customers/catalogue:listCustomersPage` (`pageSize: 20, status: "ACTIVE"`)     | `finishedGoodsJobScans`                           |                     0 |                                  0 |     0 |
| `customers/catalogue:listCustomersPage` (`pageSize: 20, status: "ACTIVE"`)     | `customerWarehouseActivity`                       |                   N/A |                                  0 |     0 |
| `customers/catalogue:listCustomersPage` (`pageSize: 20, status: "ACTIVE"`)     | `warehouses`                                      |                     0 |                                  0 |     0 |
| `customers/linking:listCustomerActivitySummaries` (20 zero-activity customers) | `customerWarehouseActivity`                       |                   N/A |                                  0 |     0 |
| `customers/linking:listCustomerActivitySummaries` (20 zero-activity customers) | `finishedGoodsProducts` / `finishedGoodsJobScans` |                   N/A |                                  0 |     0 |

Separating `listCustomerActivitySummaries` onto the compact `customerWarehouseActivity` table keeps `listCustomersPage` at **0% read-budget regression** relative to `574b9d42`, while zero-activity customers incur zero extra document reads and active customers read 1 summary row per active `(customer, warehouse)` instead of scanning raw products and job scans.

## 3. Scale & Edge-Case Verification

Verified in `tests/integration/customers-linking.integration.test.ts` and `src/features/customers/CustomerScreens.test.tsx`:

- **Blank-scan immunity:** 105 blank scans created after 1 older unresolved named scan do not hide the unresolved scan in `reviewSummary` or `listUnresolvedNames` (backed by sparse `by_orgId_warehouseId_customerReviewPending_createdAt`).
- **Picker scale:** Customer #105 is returned on page 1 of `searchCustomerOptions` by exact code/name/alias and reachable by substring via `scanCursor` continuation.
- **Alias scale:** Alias #106 on a customer is indexed into `aliasSearchText` without calling `.paginate()` inside a mutation, matches `listCustomersPage` search, and paginates via `listCustomerAliasesPage`.
- **UI regression coverage:** Preselected review candidate overridden by `CustomerPickerDialog` submits the chosen customer; empty review queue "Back to list" calls `returnFromTask` and restores filtered origin; cross-warehouse product and scan links carry `?warehouseId=`; `ProductScreen` freezes `customerLink` and `requestId` across lost-response retries even if live subscriptions advance.

## 4. Rollback Compatibility

- See `docs/plans/customer-module-2026-11-18/rollout.md` ("v2 Rollback") for the exact two-step safe rollback procedure:
  1. Revert v2 application logic (auto-linking, review queue, pickers, activity queries) while keeping the optional additive fields in `convex/schema.ts` so populated v2 documents continue passing Convex schema validation on deploy.
  2. Only after writers are removed and optional fields are cleared by a migration, remove the fields from `convex/schema.ts`.
