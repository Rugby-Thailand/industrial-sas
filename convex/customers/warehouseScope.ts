import type { Doc, Id } from "../_generated/dataModel";
import { grantedPermissionsAmong } from "../lib/navigationGrants";
import { TENANT_INDEX_MAX_PAGE_SIZE } from "../lib/tenantDb";
import type { TenantFunctionContext } from "../lib/tenantFunctions";
import { NAVIGATION_PERMISSION } from "../model/authorization/navigationPermissions";

// Reserve one row for lookahead within the tenant accessor's take limit.
const MAX_WAREHOUSES = TENANT_INDEX_MAX_PAGE_SIZE - 1;

export interface CustomerWarehouseStart {
  readonly key: string;
}

export interface AllowedCustomerWarehouses {
  readonly hasWarehouseRead: boolean;
  readonly hasWarehouseManage: boolean;
  readonly orgWide: boolean;
  readonly warehouses: readonly Doc<"warehouses">[];
  readonly byId: ReadonlyMap<Id<"warehouses">, Doc<"warehouses">>;
  readonly complete: boolean;
  readonly nextStart?: CustomerWarehouseStart;
}

/** Whether the current member holds `masterData.customer.read`. */
export async function canReadCustomers(
  ctx: TenantFunctionContext,
): Promise<boolean> {
  const grants = await grantedPermissionsAmong(ctx, [
    NAVIGATION_PERMISSION.customers,
  ]);
  return grants.includes(NAVIGATION_PERMISSION.customers);
}

/**
 * Strip customer-link metadata from a finished-goods product document when the
 * caller does not hold `masterData.customer.read`. Keeps `customerReference`
 * untouched for warehouse staff.
 */
export function projectProductCustomerFields<
  T extends {
    customerId?: Id<"customers">;
    customerLinkSource?: "AUTO" | "MANUAL" | "UNLINKED";
  },
>(product: T, allowCustomerRead: boolean): T {
  if (allowCustomerRead) return product;
  const {
    customerId: _customerId,
    customerLinkSource: _customerLinkSource,
    ...rest
  } = product;
  return rest as T;
}

/**
 * Exact warehouse access check for mutations and single-record validation.
 * Works independently of the bounded warehouse inventory.
 */
export async function canAccessWarehouse(
  ctx: TenantFunctionContext,
  warehouseId: Id<"warehouses">,
): Promise<boolean> {
  const warehouse = await ctx.tenantDb.get<Doc<"warehouses">>(
    "warehouses",
    warehouseId,
  );
  if (!warehouse || warehouse.status !== "ACTIVE") return false;
  if (ctx.tenant.membership.scopeMode === "ORG_WIDE") return true;
  const membershipWarehouse = await ctx.tenantDb
    .byIndex<Doc<"membershipWarehouses">>(
      "membershipWarehouses",
      "by_orgId_membershipId_warehouseId",
      [
        { field: "membershipId", value: ctx.tenant.membership._id },
        { field: "warehouseId", value: warehouseId },
      ],
    )
    .unique();
  return membershipWarehouse !== null;
}

/**
 * Active warehouses the current member may read or manage for linked jobs and
 * products. Customers themselves are organization records; linked warehouse
 * data is shown only when the member also holds storage-layout access.
 * Inventory keys are warehouse codes for organization-wide access and
 * warehouse IDs for scoped access. Continuations include the lookahead key.
 */
export async function allowedCustomerWarehouses(
  ctx: TenantFunctionContext,
  start?: CustomerWarehouseStart,
  /** Narrow the inventory to this one warehouse when the member may access it. */
  only?: Id<"warehouses">,
): Promise<AllowedCustomerWarehouses> {
  const grants = await grantedPermissionsAmong(ctx, [
    NAVIGATION_PERMISSION.storageLayouts,
    NAVIGATION_PERMISSION.storageLayoutManage,
  ]);
  const hasWarehouseRead = grants.includes(
    NAVIGATION_PERMISSION.storageLayouts,
  );
  const hasWarehouseManage = grants.includes(
    NAVIGATION_PERMISSION.storageLayoutManage,
  );
  if (!hasWarehouseRead && !hasWarehouseManage) {
    return {
      hasWarehouseRead: false,
      hasWarehouseManage: false,
      orgWide: ctx.tenant.membership.scopeMode === "ORG_WIDE",
      warehouses: [],
      byId: new Map(),
      complete: true,
    };
  }

  if (only !== undefined) {
    const warehouse = (await canAccessWarehouse(ctx, only))
      ? await ctx.tenantDb.get<Doc<"warehouses">>("warehouses", only)
      : null;
    const warehouses = warehouse ? [warehouse] : [];
    return {
      hasWarehouseRead,
      hasWarehouseManage,
      orgWide: ctx.tenant.membership.scopeMode === "ORG_WIDE",
      warehouses,
      byId: new Map(warehouses.map((row) => [row._id, row])),
      complete: true,
    };
  }

  if (ctx.tenant.membership.scopeMode === "ORG_WIDE") {
    const rows = await ctx.tenantDb
      .byIndex<Doc<"warehouses">>(
        "warehouses",
        "by_orgId_status_code",
        [{ field: "status", value: "ACTIVE" }],
        start && {
          field: "code",
          lower: { value: start.key, inclusive: true },
        },
      )
      .take(MAX_WAREHOUSES + 1);
    const warehouses = rows.slice(0, MAX_WAREHOUSES);
    const next = rows[MAX_WAREHOUSES];
    return {
      hasWarehouseRead,
      hasWarehouseManage,
      orgWide: true,
      warehouses,
      byId: new Map(warehouses.map((warehouse) => [warehouse._id, warehouse])),
      complete: next === undefined,
      ...(next && { nextStart: { key: next.code } }),
    };
  }

  const scope = await ctx.tenantDb
    .byIndex<Doc<"membershipWarehouses">>(
      "membershipWarehouses",
      "by_orgId_membershipId_warehouseId",
      [{ field: "membershipId", value: ctx.tenant.membership._id }],
      start && {
        field: "warehouseId",
        lower: { value: start.key, inclusive: true },
      },
    )
    .take(MAX_WAREHOUSES + 1);
  const next = scope[MAX_WAREHOUSES];
  const docs = await Promise.all(
    scope
      .slice(0, MAX_WAREHOUSES)
      .map((entry) =>
        ctx.tenantDb.get<Doc<"warehouses">>("warehouses", entry.warehouseId),
      ),
  );
  const warehouses = docs.filter(
    (warehouse): warehouse is Doc<"warehouses"> =>
      warehouse !== null && warehouse.status === "ACTIVE",
  );
  return {
    hasWarehouseRead,
    hasWarehouseManage,
    orgWide: false,
    warehouses,
    byId: new Map(warehouses.map((warehouse) => [warehouse._id, warehouse])),
    complete: next === undefined,
    ...(next && { nextStart: { key: next.warehouseId } }),
  };
}
