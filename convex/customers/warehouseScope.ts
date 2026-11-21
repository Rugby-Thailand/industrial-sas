import type { Doc, Id } from "../_generated/dataModel";
import { grantedPermissionsAmong } from "../lib/navigationGrants";
import type { TenantFunctionContext } from "../lib/tenantFunctions";
import { NAVIGATION_PERMISSION } from "../model/authorization/navigationPermissions";

const MAX_WAREHOUSES = 100;

export interface AllowedCustomerWarehouses {
  readonly hasWarehouseRead: boolean;
  readonly hasWarehouseManage: boolean;
  readonly orgWide: boolean;
  readonly warehouses: readonly Doc<"warehouses">[];
  readonly byId: ReadonlyMap<Id<"warehouses">, Doc<"warehouses">>;
  readonly complete: boolean;
}

/**
 * Active warehouses the current member may read or manage for linked jobs and
 * products. Customers themselves are organization records; linked warehouse
 * data is shown only when the member also holds storage-layout access.
 */
export async function allowedCustomerWarehouses(
  ctx: TenantFunctionContext,
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

  if (ctx.tenant.membership.scopeMode === "ORG_WIDE") {
    const warehouses = await ctx.tenantDb
      .byIndex<Doc<"warehouses">>("warehouses", "by_orgId_status_code", [
        { field: "status", value: "ACTIVE" },
      ])
      .take(MAX_WAREHOUSES);
    return {
      hasWarehouseRead,
      hasWarehouseManage,
      orgWide: true,
      warehouses,
      byId: new Map(warehouses.map((warehouse) => [warehouse._id, warehouse])),
      complete: warehouses.length < MAX_WAREHOUSES,
    };
  }

  const scope = await ctx.tenantDb
    .byIndex<Doc<"membershipWarehouses">>(
      "membershipWarehouses",
      "by_orgId_membershipId_warehouseId",
      [{ field: "membershipId", value: ctx.tenant.membership._id }],
    )
    .take(MAX_WAREHOUSES);
  const docs = await Promise.all(
    scope.map((entry) =>
      ctx.tenantDb.get<Doc<"warehouses">>("warehouses", entry.warehouseId),
    ),
  );
  const warehouses = docs
    .filter(
      (warehouse): warehouse is Doc<"warehouses"> =>
        warehouse !== null && warehouse.status === "ACTIVE",
    )
    .sort((left, right) => left.code.localeCompare(right.code));
  return {
    hasWarehouseRead,
    hasWarehouseManage,
    orgWide: false,
    warehouses,
    byId: new Map(warehouses.map((warehouse) => [warehouse._id, warehouse])),
    complete: scope.length < MAX_WAREHOUSES,
  };
}
