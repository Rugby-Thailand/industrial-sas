import { type GenericMutationCtx } from "convex/server";
import type { GenericId } from "convex/values";

import type { DataModel } from "../schema";
import { DEFAULT_ROLES, PERMISSION_CATALOGUE } from "./permissions";

export interface AuthorizationSeedResult {
  readonly permissionsInserted: number;
  readonly permissionsUpdated: number;
  readonly rolesInserted: number;
  readonly rolePermissionsInserted: number;
}

export async function seedAuthorizationForOrganization(
  ctx: GenericMutationCtx<DataModel>,
  orgId: GenericId<"organizations">,
): Promise<AuthorizationSeedResult> {
  let permissionsInserted = 0;
  let permissionsUpdated = 0;
  let rolesInserted = 0;
  let rolePermissionsInserted = 0;

  for (const definition of PERMISSION_CATALOGUE) {
    const existing = await ctx.db
      .query("permissions")
      .withIndex("by_code", (query) => query.eq("code", definition.code))
      .unique();
    const fields = {
      scope: definition.scope,
      requiresStepUp: definition.requiresStepUp,
      requiresMakerChecker: definition.requiresMakerChecker,
      requiresThreshold: definition.requiresThreshold,
    };
    if (existing === null) {
      await ctx.db.insert("permissions", { code: definition.code, ...fields });
      permissionsInserted += 1;
    } else if (
      existing.scope !== fields.scope ||
      existing.requiresStepUp !== fields.requiresStepUp ||
      existing.requiresMakerChecker !== fields.requiresMakerChecker ||
      existing.requiresThreshold !== fields.requiresThreshold
    ) {
      await ctx.db.patch("permissions", existing._id, fields);
      permissionsUpdated += 1;
    }
  }

  for (const definition of DEFAULT_ROLES) {
    const existing = await ctx.db
      .query("roles")
      .withIndex("by_orgId_key", (query) =>
        query.eq("orgId", orgId).eq("key", definition.key),
      )
      .unique();
    if (existing !== null) continue;

    const roleId = await ctx.db.insert("roles", {
      orgId,
      key: definition.key,
      name: definition.name,
      description: definition.description,
      status: "ACTIVE",
      seeded: true,
    });
    rolesInserted += 1;
    for (const permissionCode of definition.permissionCodes) {
      await ctx.db.insert("rolePermissions", {
        orgId,
        roleId,
        permissionCode,
      });
      rolePermissionsInserted += 1;
    }
  }

  return {
    permissionsInserted,
    permissionsUpdated,
    rolesInserted,
    rolePermissionsInserted,
  };
}
