import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import { grantedNavigationPermissions } from "../lib/navigationGrants";
import type { TenantFunctionContext } from "../lib/tenantFunctions";
import { queryWithOrg } from "../lib/tenantFunctions";

const MAX_WORKSPACES = 100;

type WarehouseDocument = Doc<"warehouses">;
type MembershipWarehouseDocument = Doc<"membershipWarehouses">;

const workspaceValidator = v.object({
  organization: v.object({ id: v.id("organizations"), name: v.string() }),
  warehouses: v.array(
    v.object({
      id: v.id("warehouses"),
      code: v.string(),
      name: v.string(),
    }),
  ),
  navigationPermissions: v.array(v.string()),
  complete: v.boolean(),
});

async function allowedWarehouses(ctx: TenantFunctionContext): Promise<{
  readonly warehouses: readonly WarehouseDocument[];
  readonly complete: boolean;
}> {
  if (ctx.tenant.membership.scopeMode === "ORG_WIDE") {
    const page = await ctx.tenantDb
      .byIndex<WarehouseDocument>("warehouses", "by_orgId_status_code", [
        { field: "status", value: "ACTIVE" },
      ])
      .page({ limit: MAX_WORKSPACES });

    return { warehouses: page.page, complete: page.isDone };
  }

  const scope = await ctx.tenantDb
    .byIndex<MembershipWarehouseDocument>(
      "membershipWarehouses",
      "by_orgId_membershipId_warehouseId",
      [{ field: "membershipId", value: ctx.tenant.membership._id }],
    )
    .page({ limit: MAX_WORKSPACES });

  const documents = await Promise.all(
    scope.page.map((entry) =>
      ctx.tenantDb.get<WarehouseDocument>("warehouses", entry.warehouseId),
    ),
  );
  const warehouses = documents
    .filter(
      (warehouse): warehouse is WarehouseDocument =>
        warehouse !== null && warehouse.status === "ACTIVE",
    )
    .sort((left, right) => left.code.localeCompare(right.code));

  return { warehouses, complete: scope.isDone };
}

export const readCurrent = queryWithOrg({
  args: {},
  returns: workspaceValidator,
  permissionCode: "masterData.warehouse.read",
  target: { table: "warehouses" },
  handler: async (ctx) => {
    const [allowed, navigationPermissions] = await Promise.all([
      allowedWarehouses(ctx),
      grantedNavigationPermissions(ctx),
    ]);
    return {
      organization: {
        id: ctx.tenant.organization._id,
        name: ctx.tenant.organization.name,
      },
      warehouses: allowed.warehouses.map((warehouse) => ({
        id: warehouse._id,
        code: warehouse.code,
        name: warehouse.name,
      })),
      navigationPermissions,
      complete: allowed.complete,
    };
  },
});
