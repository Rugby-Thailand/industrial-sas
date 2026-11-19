import { type GenericMutationCtx, type GenericQueryCtx } from "convex/server";
import type { GenericId } from "convex/values";

import type { DataModel } from "../schema";
import {
  AI_USAGE_PERMISSION_CODES,
  CUSTOMER_PERMISSION_CODES,
  DEFAULT_ROLES,
  HR_ADMIN_PERMISSION_CODES,
  PERMISSION_CATALOGUE,
  PLANNER_PERMISSION_CODES,
  type PermissionDefinition,
} from "./permissions";

export interface AuthorizationSeedResult {
  readonly permissionsInserted: number;
  readonly permissionsUpdated: number;
  readonly rolesInserted: number;
  readonly rolePermissionsInserted: number;
}

export async function seedPermissionDefinitions(
  ctx: GenericMutationCtx<DataModel>,
  definitions: readonly PermissionDefinition[],
): Promise<
  Pick<AuthorizationSeedResult, "permissionsInserted" | "permissionsUpdated">
> {
  let permissionsInserted = 0;
  let permissionsUpdated = 0;

  for (const definition of definitions) {
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

  return { permissionsInserted, permissionsUpdated };
}

export async function seedAuthorizationForOrganization(
  ctx: GenericMutationCtx<DataModel>,
  orgId: GenericId<"organizations">,
): Promise<AuthorizationSeedResult> {
  const permissions = await seedPermissionDefinitions(
    ctx,
    PERMISSION_CATALOGUE,
  );
  let rolesInserted = 0;
  let rolePermissionsInserted = 0;

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
    ...permissions,
    rolesInserted,
    rolePermissionsInserted,
  };
}

// Each provisioner adds its entire grant set. Intermediate seeded roles can
// carry any of these exact combinations when operators run the jobs out of order.
const planner = PLANNER_PERMISSION_CODES;
const hr = HR_ADMIN_PERMISSION_CODES;
const ai = AI_USAGE_PERMISSION_CODES;
const customers = CUSTOMER_PERMISSION_CODES;
const seededOrgAdminGrantSets = [
  planner,
  [...planner, ...hr],
  [...planner, ...ai],
  [...planner, ...customers],
  [...planner, ...hr, ...ai],
  [...planner, ...hr, ...customers],
  [...planner, ...ai, ...customers],
  [...planner, ...hr, ...ai, ...customers],
];
const orgAdminGrantReadLimit =
  planner.length + hr.length + ai.length + customers.length + 1;

type OrgAdminGrantState =
  | { status: "MISSING" }
  | { status: "CUSTOMIZED"; roleId: GenericId<"roles"> }
  | {
      status: "SEEDED";
      roleId: GenericId<"roles">;
      codes: ReadonlySet<string>;
    };

export async function readSeededOrgAdminGrants(
  ctx: Pick<GenericQueryCtx<DataModel>, "db">,
  orgId: GenericId<"organizations">,
): Promise<OrgAdminGrantState> {
  const role = await ctx.db
    .query("roles")
    .withIndex("by_orgId_key", (query) =>
      query.eq("orgId", orgId).eq("key", "ORG_ADMIN"),
    )
    .unique();
  if (!role) return { status: "MISSING" };
  const roleId = role._id;
  if (
    !role.seeded ||
    role.status !== "ACTIVE" ||
    // A renamed administrator was customized. Descriptions are not compared:
    // seeds have shipped several, and older rows may have none.
    role.name !== "Organization administrator"
  )
    return { status: "CUSTOMIZED", roleId };

  const grants = await ctx.db
    .query("rolePermissions")
    .withIndex("by_orgId_roleId_permissionCode", (query) =>
      query.eq("orgId", orgId).eq("roleId", roleId),
    )
    .take(orgAdminGrantReadLimit);
  const codes = new Set(grants.map((grant) => grant.permissionCode));
  const seeded =
    grants.length === codes.size &&
    seededOrgAdminGrantSets.some(
      (baseline) =>
        baseline.length === codes.size &&
        baseline.every((code) => codes.has(code)),
    );
  return seeded
    ? { status: "SEEDED", roleId, codes }
    : { status: "CUSTOMIZED", roleId };
}

type OrgAdminRoleUpgrade = "UPGRADED" | "CURRENT" | "CUSTOMIZED" | "MISSING";

export async function upgradeSeededOrgAdmin(
  ctx: GenericMutationCtx<DataModel>,
  orgId: GenericId<"organizations">,
  permissionCodes: readonly string[],
): Promise<OrgAdminRoleUpgrade> {
  const admin = await readSeededOrgAdminGrants(ctx, orgId);
  if (admin.status !== "SEEDED") return admin.status;
  if (permissionCodes.every((code) => admin.codes.has(code))) return "CURRENT";

  for (const permissionCode of permissionCodes) {
    await ctx.db.insert("rolePermissions", {
      orgId,
      roleId: admin.roleId,
      permissionCode,
    });
  }
  return "UPGRADED";
}

export interface HrProvisioningResult extends AuthorizationSeedResult {
  readonly orgAdmin: OrgAdminRoleUpgrade;
  readonly hrPermissionsAdded: number;
}

/** Idempotent HR provisioning for an organization created before HR existed. */
export async function provisionHrForOrganization(
  ctx: GenericMutationCtx<DataModel>,
  orgId: GenericId<"organizations">,
): Promise<HrProvisioningResult> {
  const seeded = await seedAuthorizationForOrganization(ctx, orgId);
  const orgAdmin = await upgradeSeededOrgAdmin(ctx, orgId, hr);
  return {
    ...seeded,
    orgAdmin,
    hrPermissionsAdded: orgAdmin === "UPGRADED" ? hr.length : 0,
  };
}
