import { type GenericMutationCtx } from "convex/server";
import type { GenericId } from "convex/values";

import type { DataModel } from "../schema";
import {
  DEFAULT_ROLES,
  HR_ADMIN_PERMISSION_CODES,
  PERMISSION_CATALOGUE,
  PLANNER_PERMISSION_CODES,
} from "./permissions";

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

export type HrRoleUpgrade = "UPGRADED" | "CURRENT" | "CUSTOMIZED" | "MISSING";

export interface HrProvisioningResult extends AuthorizationSeedResult {
  /** What happened to the existing organization administrator role. */
  readonly orgAdmin: HrRoleUpgrade;
  readonly hrPermissionsAdded: number;
}

/**
 * Idempotent HR provisioning for an organization created before HR existed.
 *
 * Inserts the permission catalogue and any missing default roles (including
 * the HR roles), then upgrades ORG_ADMIN only when it is still the untouched
 * seeded planner role: a seeded, active role whose grants are exactly the
 * legacy planner set. A role an organization customized is reported, never
 * silently broadened. Warehouse managers are never given HR codes.
 */
export async function provisionHrForOrganization(
  ctx: GenericMutationCtx<DataModel>,
  orgId: GenericId<"organizations">,
): Promise<HrProvisioningResult> {
  const seeded = await seedAuthorizationForOrganization(ctx, orgId);
  const role = await ctx.db
    .query("roles")
    .withIndex("by_orgId_key", (query) =>
      query.eq("orgId", orgId).eq("key", "ORG_ADMIN"),
    )
    .unique();
  if (role === null)
    return { ...seeded, orgAdmin: "MISSING", hrPermissionsAdded: 0 };
  const grants = await ctx.db
    .query("rolePermissions")
    .withIndex("by_orgId_roleId_permissionCode", (query) =>
      query.eq("orgId", orgId).eq("roleId", role._id),
    )
    .take(200);
  const codes = new Set(grants.map((grant) => grant.permissionCode));
  const target = [...PLANNER_PERMISSION_CODES, ...HR_ADMIN_PERMISSION_CODES];
  if (target.every((code) => codes.has(code)) && codes.size === target.length)
    return { ...seeded, orgAdmin: "CURRENT", hrPermissionsAdded: 0 };
  const legacyDefault =
    role.seeded &&
    role.status === "ACTIVE" &&
    codes.size === PLANNER_PERMISSION_CODES.length &&
    PLANNER_PERMISSION_CODES.every((code) => codes.has(code));
  if (!legacyDefault)
    return { ...seeded, orgAdmin: "CUSTOMIZED", hrPermissionsAdded: 0 };
  let added = 0;
  for (const permissionCode of HR_ADMIN_PERMISSION_CODES) {
    await ctx.db.insert("rolePermissions", {
      orgId,
      roleId: role._id,
      permissionCode,
    });
    added += 1;
  }
  return { ...seeded, orgAdmin: "UPGRADED", hrPermissionsAdded: added };
}
