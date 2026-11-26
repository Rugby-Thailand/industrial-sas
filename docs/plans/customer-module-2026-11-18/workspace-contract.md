# Customer workspace contract (v3, step 1 of 3)

The customer detail route becomes a workspace: a directory rail, an identity bar, section tabs, a warehouse scope, an overview with rollups and a "ต้องจัดการ" (attention) panel, plus jobs, products, stock and details. This document is the contract for steps 2 and 3. The data layer described here is merged with it. Nothing else in this contract is built yet.

Visual and behaviour reference: `customer-workspace-preview.html`, which is untracked and kept next to `plan.md` in the main checkout. Ignore its role, state and theme switchers, its research panel, its "ตัวอย่าง/ข้อมูลสมมติ" tags and its fake data. The preview opens job, product, review and scan "destinations" inside the page. Production links to the real routes listed in [Destinations](#destinations) instead.

## Queries

All three queries are in `convex/customers/workspace.ts` and run as `queryWithOrg` with `masterData.customer.read`. A missing or foreign customer returns `null`. Warehouse data appears only when the member holds `masterData.storageLayout.read`, and only for active warehouses inside the member's scope (`allowedCustomerWarehouses`). That holds for every argument combination: a forbidden or foreign `warehouseId` returns no rows. The client uses `FunctionReturnType<typeof api.customers.workspace.*>`. The types below mirror the validators.

```ts
type BoundedCount = { count: number; complete: boolean }; // complete=false → show "99+"/"≥ count"

type WorkspaceJob = {
  jobScanId: Id<"finishedGoodsJobScans">;
  factoryOrder: string; // ticket / job number (JO-…)
  partName?: string; // product name as read from the ticket
  productCode: string; // productBarcodeText (SKU-like ticket code)
  quantity?: number;
  warehouseId: Id<"warehouses">;
  warehouseName: string;
  createdAt: number; // scan date
  source: "AI" | "BARCODE" | "MANUAL"; // capture source
  mapped: boolean; // false = "รอผูกตำแหน่ง" (missing storage location)
  locationText: string; // typed location text (always present)
  locationCode?: string; // mapped location code
  locationName?: string;
  customerLinkSource?: "AUTO" | "MANUAL" | "UNLINKED";
  capturedName?: string; // customer text read from the ticket
};

type WorkspacePallet = {
  palletId: Id<"finishedGoodsPallets">;
  code: string;
  quantity: number;
  positionCode?: string; // held placement only
  zoneId?: Id<"storageZones">;
  zoneLabel?: string; // zone label, else zone code
};

type WorkspaceProduct = {
  productId: Id<"finishedGoodsProducts">;
  sku: string;
  name: string;
  unit: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  warehouseId: Id<"warehouses">;
  warehouseName: string;
  customerReference?: string;
  storedCount?: number; // STORED units from the product summary; absent while the summary builds
  totalQuantity?: number;
  pallets: WorkspacePallet[]; // first 10 STORED, non-retired units
  hasMorePallets: boolean; // → link to the product page for the rest
  zones: string[]; // distinct zone labels among `pallets`
};
```

### `getCustomerWorkspace({ customerId: string, warehouseId?: string, includeOverview?: boolean })`

This query returns the shell and the overview. Other sections pass `includeOverview: false` to skip job, stock and review rollups. A malformed warehouse URL value returns an unavailable scope. Omit `warehouseId` to mean "all permitted warehouses".

```ts
null | {
  access: {
    canManage: boolean;            // masterData.customer.manage
    canViewWarehouseData: boolean; // masterData.storageLayout.read
    canReview: boolean;            // customer.manage + storageLayout.read + storageLayout.manage
    canScan: boolean;              // storageLayout.manage and customer ACTIVE
  };
  warehouses: { warehouseId; code; name }[]; // scope selector: permitted warehouses with this customer's activity, by name
  warehousesComplete: boolean;     // false past 20 activity warehouses
  scopeAvailable: boolean;         // false when warehouseId is not permitted → no rollup
  rollup?: {                       // present when canViewWarehouseData && scopeAvailable
    linkedJobs: BoundedCount;      // live (non-voided) linked jobs, capped at 99
    linkedProducts: BoundedCount;  // exact, from customerWarehouseActivity
    storedPallets: BoundedCount;   // Σ product summary `stored`; incomplete if a summary is building or >99 products
    unmappedJobs: BoundedCount;    // linked live jobs with mapped=false, capped at 99
    pendingReview?: { names: number; scans: number; complete: boolean }; // only when canReview
  };
  latestJobs: WorkspaceJob[];      // newest 3 in scope
}
```

`pendingReview` counts names in "Names to review" that the queue would propose for this customer. A name qualifies when it matches the customer's canonical name or an approved alias exactly. It also qualifies through the queue's compact-stem similarity rule, which applies only when the customer is active and the name has no exact match anywhere. The count reads the same bounded window as `reviewSummary` (300 rows) and is filtered to the scope. `complete: false` means the window was truncated.

Archived customers keep their history. Show the archived notice and still load the rollup. `canScan` is false for them.

### `listCustomerWorkspaceJobs({ customerId, warehouseId?, filter?: "all" | "mapped" | "unmapped", cursor?, pageSize? })`

This query returns `null | { canViewWarehouseData, items: WorkspaceJob[], isDone, continueCursor }`. Rows come newest first within each warehouse, and warehouses come in inventory order, which is the same keyset pattern as `listCustomerJobsPage`. `pageSize` defaults to 20 and must be between 1 and 50. A cursor is bound to its customer, and a foreign cursor fails with `INVALID_CURSOR`. Never reuse a cursor after the scope or the filter changes: restart from the first page. `mapped`/`unmapped` read the new index `finishedGoodsJobScans.by_orgId_warehouseId_customerId_voided_mapped_createdAt`, so the filter is exact and paginated without a filtered scan.

### `listCustomerWorkspaceProducts({ customerId, warehouseId?, cursor?, pageSize? })`

This query returns `null | { canViewWarehouseData, items: WorkspaceProduct[], isDone, continueCursor }`. `pageSize` defaults to 10 and must be between 1 and 20. One read serves three views:

- **Overview** "สินค้าที่เชื่อม": `pageSize: 5`.
- **Products tab**: show `storedCount` ("N พาเลท") and `zones`.
- **Stock view**: list each product's `pallets` (position, zone and code) and link each one to its pallet page.

The stock view is supported cheaply because each product holds at most 10 STORED units in its row. The `storedPallets` rollup carries the exact total.

### Existing reads

- `customers/catalogue:getCustomer` provides identity and details. **Change in this PR:** `taxId` and `taxIdChecksumValid` are omitted unless the caller holds `masterData.customer.manage`.
- `customers/linking:getCustomerActivity` still provides aliases (`aliases`, `hasMoreAliases`). `listCustomerAliasesPage` pages them.
- `getCustomerActivity` jobs and products, `listCustomerJobsPage` and `listCustomerProductsPage` are superseded by the workspace queries. Keep them registered: old tabs still call them (`docs/operations/backend-compatibility.md`). Once the workspace replaces the old cards, step 2 or 3 stops calling them and removes the old card states from the inventory.
- The scope selector lists `getCustomerWorkspace().warehouses`. Labels come from `name`, or from `warehouseLabel` when the code helps.

## Permission matrix

Server keys: `masterData.customer.read` (R), `masterData.customer.manage` (M), `masterData.storageLayout.read` (WR), `masterData.storageLayout.manage` (WM).

| Preview case   | Real grants      | Sections                                                                    | Tax ID                   | Aliases | Edit / archive | Review entry                     | Scan                          |
| -------------- | ---------------- | --------------------------------------------------------------------------- | ------------------------ | ------- | -------------- | -------------------------------- | ----------------------------- |
| Manager        | R + M + WR (+WM) | overview, jobs, products, stock, details                                    | yes                      | yes     | yes            | if `access.canReview` (needs WM) | if `access.canScan`           |
| Read-only      | R + WR           | all five                                                                    | **no** (server-stripped) | yes     | no             | no                               | only if WM (`access.canScan`) |
| Catalogue-only | R, no WR         | overview (identity, delivery and contact, registration summary) and details | only with M              | no      | only with M    | no                               | no                            |

Gate each element on the `access` flags and the `viewer().canManage` flag, never on role names. A catalogue-only member gets `rollup` undefined, `warehouses: []`, and empty pages with `canViewWarehouseData: false`. The UI hides the warehouse sections, the scope selector and the attention panel. It shows no error.

## Data-field mapping (no new customer fields)

| Workspace label                                           | Source                                                                                          |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Site name (จุดรับสินค้า)                                  | `deliveryAddress.label`                                                                         |
| Address                                                   | `deliveryAddress.line`, `subdistrict`, `district`, `province`, `postcode`                       |
| Receiving hours, delivery instructions (คำแนะนำการจัดส่ง) | `notes` (free text; hours are not structured)                                                   |
| Contact                                                   | `contact.name`, `role`, `phone` (`telHref`), `email` (`mailtoHref`)                             |
| Identity bar                                              | `name`, `code`, `status`, `deliveryAddress.province`                                            |
| Registration                                              | `legalNameTh`, `legalNameEn`, `establishment` (HEAD_OFFICE / BRANCH + code), `taxId` (managers) |
| Approved ticket names                                     | aliases (above)                                                                                 |

## URL state and Back

The route is unchanged: `/[locale]/master-data/customers/[customerId]`. Its inventory policy stays `parent` → `/master-data/customers`. Mobile adds no route either: below the desktop breakpoint the rail is hidden with CSS, and the identity bar shows an "ลูกค้าทั้งหมด / All customers" link to `ROUTES.customers`. On desktop the same link focuses the rail search instead.

| Param       | Values                                                     | Default (omitted) | Change                                                   |
| ----------- | ---------------------------------------------------------- | ----------------- | -------------------------------------------------------- |
| `section`   | `overview` \| `jobs` \| `products` \| `stock` \| `details` | `overview`        | **push** (one Back step per section)                     |
| `warehouse` | warehouse ID \| `all`                                      | `all`             | **replace** (re-scopes the same view, as in the preview) |
| `filter`    | `mapped` \| `unmapped` (jobs only)                         | all               | **push**                                                 |

Helpers in `src/lib/navigation.ts`, unit-tested in `navigation.test.ts`:

- `readCustomerWorkspaceUrl(params, { canViewWarehouseData })` normalizes the URL. Unknown values and warehouse sections without WR map to `overview`/`all`. A `filter` outside `jobs` is dropped. When the normalized URL differs from the address bar, **replace** it so no dead Back step is left.
- `customerWorkspacePath(customerId, state)` builds the URL and omits defaults.
- If `getCustomerWorkspace` returns `scopeAvailable: false`, the warehouse is not permitted or no longer active. Show an inline notice with a "ทุกคลังที่มีสิทธิ์" action that **replaces** `warehouse` with `all`.

Back rules:

1. Section tabs and the jobs filter use `useUrlBackedState` for restoration plus `useGuardedUrl` in `push` mode. The scope selector uses `useGuardedUrl` in `replace` mode. Back walks through earlier sections and filters, then leaves for the real origin with its locale, query and hash intact. A directly opened workspace falls back to `/master-data/customers`.
2. `stock` is not a tab. It opens from the "พาเลทจัดเก็บ" rollup or from the products tab ("ดูพาเลทและโซนจัดเก็บ") as a push, and the products tab stays highlighted. It has no in-page "Back" link: native and header Back return to the origin section.
3. Choosing a customer in the rail is a `<Link>` push to `customerWorkspacePath(otherId, { warehouse })`. It keeps the scope and resets the section to overview. Rail search and status are ordinary local filters that never touch the URL or history. Seed the status from the catalogue's remembered status preference. Declare the rail filter as an audited presentation state.
4. Destinations are plain `<Link>` pushes, so Back from a product, pallet or record returns to the exact workspace URL.
5. No foreground overlay is added. If step 2 adds one, for example a contact sheet on mobile, use the shared `Sheet`/`Dialog`.

### Navigation inventory work (steps 2 and 3)

This PR adds no component, so the inventory has no new state or action to declare yet. Invented owners or evidence fail `pnpm check:navigation`. Each step that adds code must declare, in `docs/contracts/back-navigation.json`:

- **Route entry** for `[customerId]/page.tsx`: update `targets` if the rendered screen is no longer `CustomerDetail#CustomerDetail`, and add the workspace caller cases below.
- **States**: the URL-backed `section` and `filter` states, the scope value, the rail search/status filter as a presentation decision, and conditional renders such as archived, scope unavailable, loading, error and empty, plus any "show more" paging. Use exact semantic targets.
- **Actions**: each `useGuardedUrl` call. Section and filter pushes are `advance`. Scope replaces and URL normalization are `dispatch`.
- **Removals**: the `CustomerDetail.tsx#CustomerJobsCard:cursors` and `#CustomerProductsCard:cursors` states and any other old card states, once those components are deleted.
- **Destination builders**: add `customerWorkspacePath` to `destinationBuilders` only if it is used as a header parent or return destination.

The runtime cases (literal test titles in `CustomerScreens.test.tsx` or a new `CustomerWorkspace.test.tsx`) must cover:

- section push followed by native Back
- scope replace leaving no extra step
- filter Back
- direct link with section, warehouse and filter
- locale, query and hash preserved on leave
- rail navigation followed by Back
- destination link followed by Back to the same section
- catalogue-only normalization by replace
- Forward
- refresh and remount

## Destinations

| From                       | Link                                                            | Builder                                                                                                                                            |
| -------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Job row                    | Saved records in the job's warehouse, searched by ticket number | `jobScanRecordSearchPath(job.warehouseId, job.factoryOrder)` → `/finished-goods/scan/records?warehouseId=…&scans={"filter":"ALL","search":"JO-…"}` |
| Product row                | Product page                                                    | `productPath(productId, warehouseId)`                                                                                                              |
| Pallet row (stock)         | Pallet page                                                     | `palletPath(palletId)`                                                                                                                             |
| Attention: names to review | Review queue                                                    | `ROUTES.customerReview` (the queue has no per-customer filter; the count explains why the entry is there)                                          |
| Attention: unmapped jobs   | Same page                                                       | `customerWorkspacePath(id, { section: "jobs", filter: "unmapped", warehouse })` (push)                                                             |
| Edit                       | Editor                                                          | `customerEditPath(id)` (managers)                                                                                                                  |
| Scan job                   | Scan page                                                       | `customerJobScanPath(id)` → `/finished-goods/scan?customer=<id>` (see below)                                                                       |
| All customers              | List                                                            | `ROUTES.customers`                                                                                                                                 |

Job scans store no product ID, so a job row cannot link to a product. The ticket's `productCode` and `partName` are shown as text.

## Scan prefill (step 3; no server change)

`saveJobScans` already auto-links a ticket whose captured name exactly matches one active customer, by canonical name or alias. Every other named ticket goes to "Names to review", where this workspace's attention panel counts it for the customer. Prefill therefore never forces a link and never blocks a save.

1. **Warehouse.** The scan page uses the global workspace warehouse (`QueryGate scope="WAREHOUSE"`). When the workspace scope is a single warehouse that appears in `useWorkspace().warehouses`, the Scan button calls `workspace.selectWarehouse(warehouseId)` before it pushes `customerJobScanPath(id)`. With scope `all`, it only pushes, and the scan page keeps its current selection or shows its warehouse choice. The scan URL carries no warehouse parameter.
2. **Customer.** `JobScanScreen` reads `customer` with `useQueryParams()`. It accepts only a value matching `/^[A-Za-z0-9_-]{1,64}$/` and loads it with `api.customers.catalogue.getCustomer`. The parameter is ignored silently when the member lacks customer read, when the customer is missing, and when it is archived. A loaded customer shows a context line, "สแกนให้ลูกค้า {name} · {code}". New **manual-entry** tickets start with the ticket's `customer` field set to `customer.name`, which stays editable. AI and barcode values replace it as they do today.
3. **Mismatch.** When a ticket's `normalizeCustomerName(customer)` differs from the selected customer's normalized name, show an inline, non-blocking hint: "ชื่อบนใบต่างจากลูกค้าที่เลือก · จะส่งไปตรวจชื่อ". The save proceeds unchanged.
4. **After save.** The success panel adds a `<Link>` to `customerWorkspacePath(id, { section: "jobs" })`. Native Back from the scan page returns to the workspace.
5. **Inventory.** Declare the context line and the hint as presentation states with their exact targets, and add the scan caller cases.

## Step split

**Step 2 builds the workspace shell:**

- directory rail (search and status, desktop) and the mobile "All customers" link
- identity bar (name, code, status, province, Scan, Contact, All customers)
- section tabs with URL state and Back
- overview: delivery and contact, registration summary, rollup tiles, latest jobs, linked-products preview
- details: registration, tax for managers, aliases when `canViewWarehouseData`, notes
- warehouse scope selector, including `scopeAvailable: false`
- attention panel: review entry when `pendingReview.names > 0`, unmapped jobs when `unmappedJobs.count > 0`; omit the panel when empty
- archived notice
- loading, error and empty states
- permission gating per the matrix
- the inventory entries for everything above

**Step 3 builds the rest:**

- jobs tab with the mapped/unmapped filter and pagination
- products tab
- stock view with pallet links
- review-entry wiring
- scan prefill on the scan page as specified above
- complete Thai and English messages for all workspace and scan copy (`messages/*`)
- the runtime Back caller tests listed above
- removal of the superseded old cards and their inventory states

## Not in scope

Invoices, documents, multiple sites or contacts, and structured receiving hours. Add these only when staff can act on them.
