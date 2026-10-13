import type { Doc } from "../_generated/dataModel";
import {
  NAVIGATION_PERMISSION_CODES,
  type NavigationPermissionCode,
} from "../model/authorization/navigationPermissions";

import {
  MEMBERSHIP_ROLE_LIMIT,
  type AuthorizationFactLookups,
} from "./authorization";
import type { ActiveTenantContext } from "./tenantContext";
import type { TenantFunctionContext } from "./tenantFunctions";

type MembershipRoleDocument = Doc<"membershipRoles">;
type RoleDocument = Doc<"roles">;
type RolePermissionDocument = Doc<"rolePermissions">;

export async function grantedNavigationPermissions(
  ctx: TenantFunctionContext,
): Promise<NavigationPermissionCode[]> {
  return grantedPermissionsAmong(ctx, NAVIGATION_PERMISSION_CODES);
}

/** Scoped capability: callers cannot supply another tenant, member or role. */
export function createPermissionGrants(
  tenant: ActiveTenantContext,
  lookups: AuthorizationFactLookups,
) {
  return async (codes: readonly string[]): Promise<readonly string[]> => {
    const orgId = tenant.organization._id;
    const membershipId = tenant.membership._id;
    const grants = await lookups.listMembershipRoles({
      orgId,
      membershipId,
      limit: MEMBERSHIP_ROLE_LIMIT,
    });
    const roles = await Promise.all(
      grants.map((grant) =>
        grant.orgId === orgId && grant.membershipId === membershipId
          ? lookups.findRole({ orgId, roleId: grant.roleId })
          : null,
      ),
    );
    const active = roles.filter(
      (role): role is NonNullable<typeof role> =>
        role !== null && role.orgId === orgId && role.status === "ACTIVE",
    );
    const result: string[] = [];
    // At most 32 independent role lookups at once, even for a long code list.
    for (const permissionCode of codes) {
      const rows = await Promise.all(
        active.map((role) =>
          lookups.findRolePermission({
            orgId,
            roleId: role._id,
            permissionCode,
          }),
        ),
      );
      if (rows.some((row) => row?.permissionCode === permissionCode))
        result.push(permissionCode);
    }
    return result;
  };
}

/** The subset of `codes` the actor holds through an active role. */
export async function grantedPermissionsAmong<Code extends string>(
  ctx: TenantFunctionContext,
  codes: readonly Code[],
): Promise<Code[]> {
  if (ctx.permissionGrants) {
    const granted = new Set(await ctx.permissionGrants(codes));
    return codes.filter((code) => granted.has(code));
  }
  const membershipId = ctx.tenant.membership._id;
  const grants = await ctx.tenantDb
    .byIndex<MembershipRoleDocument>(
      "membershipRoles",
      "by_orgId_membershipId_roleId",
      [{ field: "membershipId", value: membershipId }],
    )
    .take(MEMBERSHIP_ROLE_LIMIT);
  const roles = await Promise.all(
    grants.map(async (grant) => {
      if (grant.membershipId !== membershipId) return null;
      return ctx.tenantDb.get<RoleDocument>("roles", grant.roleId);
    }),
  );
  const activeRoles = roles.filter(
    (role): role is NonNullable<typeof role> =>
      role !== null && role.status === "ACTIVE",
  );
  const granted = await Promise.all(
    codes.map(async (permissionCode) => {
      const permissions = await Promise.all(
        activeRoles.map((role) =>
          ctx.tenantDb
            .byIndex<RolePermissionDocument>(
              "rolePermissions",
              "by_orgId_roleId_permissionCode",
              [
                { field: "roleId", value: role._id },
                { field: "permissionCode", value: permissionCode },
              ],
            )
            .unique(),
        ),
      );
      return permissions.some((row) => row?.permissionCode === permissionCode);
    }),
  );
  return codes.filter((_, index) => granted[index]);
}
