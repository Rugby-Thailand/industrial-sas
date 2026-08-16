/** Bounded workspace context for the signed-in membership. */
import { v, type GenericId } from "convex/values";

import type { TenantFunctionContext } from "../lib/tenantFunctions";
import { queryWithOrg } from "../lib/tenantFunctions";
import type { TenantOrgId, TenantOwnedDocument } from "../lib/tenantDb";

const MAX_WORKSPACES = 100;

interface WarehouseDocument extends TenantOwnedDocument {
  readonly _id: GenericId<"warehouses">;
  readonly orgId: TenantOrgId;
  readonly code: string;
  readonly name: string;
  readonly status: "ACTIVE" | "INACTIVE";
}

interface MembershipWarehouseDocument extends TenantOwnedDocument {
  readonly _id: GenericId<"membershipWarehouses">;
  readonly orgId: TenantOrgId;
  readonly membershipId: GenericId<"memberships">;
  readonly warehouseId: GenericId<"warehouses">;
}

const workspaceValidator = v.object({
  organization: v.object({ id: v.id("organizations"), name: v.string() }),
  warehouses: v.array(
    v.object({
      id: v.id("warehouses"),
      code: v.string(),
      name: v.string(),
    }),
  ),
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
    const allowed = await allowedWarehouses(ctx);
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
      complete: allowed.complete,
    };
  },
});
