import type { Doc } from "../_generated/dataModel";
import {
  NAVIGATION_PERMISSION_CODES,
  type NavigationPermissionCode,
} from "../model/authorization/navigationPermissions";

import { MEMBERSHIP_ROLE_LIMIT } from "./authorization";
import type { TenantFunctionContext } from "./tenantFunctions";

type MembershipRoleDocument = Doc<"membershipRoles">;
type RoleDocument = Doc<"roles">;
type RolePermissionDocument = Doc<"rolePermissions">;

/** Resolve the bounded route grant snapshot for the active membership. */
export async function grantedNavigationPermissions(
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
