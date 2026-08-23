/** Bounded workspace context for the signed-in membership. */
import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import { MEMBERSHIP_ROLE_LIMIT } from "../lib/authorization";
import type { TenantFunctionContext } from "../lib/tenantFunctions";
import { queryWithOrg } from "../lib/tenantFunctions";
import {
  NAVIGATION_PERMISSION_CODES,
  type NavigationPermissionCode,
} from "../model/authorization/navigationPermissions";

const MAX_WORKSPACES = 100;

type WarehouseDocument = Doc<"warehouses">;
type MembershipWarehouseDocument = Doc<"membershipWarehouses">;
type MembershipRoleDocument = Doc<"membershipRoles">;
type RoleDocument = Doc<"roles">;
type RolePermissionDocument = Doc<"rolePermissions">;

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

/**
 * Resolve only the small, code-owned set needed by the two navigation shells.
 * Exact grant reads avoid enumerating a tenant-editable role whose composition
 * may be larger than one database page.
 */
async function grantedNavigationPermissions(
  ctx: TenantFunctionContext,
): Promise<NavigationPermissionCode[]> {
  const grants = await ctx.tenantDb
    .byIndex<MembershipRoleDocument>(
      "membershipRoles",
      "by_orgId_membershipId_roleId",
      [{ field: "membershipId", value: ctx.tenant.membership._id }],
    )
    .take(MEMBERSHIP_ROLE_LIMIT);

  const activeRoles: RoleDocument[] = [];
  for (const grant of grants) {
    if (grant.membershipId !== ctx.tenant.membership._id) continue;
    const role = await ctx.tenantDb.get<RoleDocument>("roles", grant.roleId);
    if (role?.status === "ACTIVE") activeRoles.push(role);
  }

  const permissionCodes: NavigationPermissionCode[] = [];
  for (const permissionCode of NAVIGATION_PERMISSION_CODES) {
    for (const role of activeRoles) {
      const row = await ctx.tenantDb
        .byIndex<RolePermissionDocument>(
          "rolePermissions",
          "by_orgId_roleId_permissionCode",
          [
            { field: "roleId", value: role._id },
            { field: "permissionCode", value: permissionCode },
          ],
        )
        .unique();
      if (row?.permissionCode === permissionCode) {
        permissionCodes.push(permissionCode);
        break;
      }
    }
  }
  return permissionCodes;
}

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
