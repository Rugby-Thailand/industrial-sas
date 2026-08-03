/**
 * Organization provisioning seed for the authorization foundation.
 *
 * Called from the organization insert in `identityMirrorConvex.ts`, inside that
 * mutation's transaction, so a provisioned tenant either has its roles or does not
 * exist. There is no separate seed command and no scheduled follow-up: a tenant
 * that existed for one moment without roles is a tenant whose first privileged
 * request is decided against an empty composition.
 *
 * Two writes with different shapes:
 *
 * - `permissions` is global, code-owned reference data (`INV-0006-02`). Every
 *   organization's provisioning converges it on `PERMISSION_CATALOGUE`, inserting
 *   what is missing and patching a row whose policy flags have drifted from code.
 * - `roles` and `rolePermissions` are tenant rows, written once. A rerun that finds
 *   a role by `(orgId, key)` leaves it and its composition exactly as the tenant
 *   left them (`INV-0006-11`), which is why the compositions are not reconciled:
 *   a "repair" would silently undo an edit the tenant made deliberately.
 *
 * The consequence, stated because it is a real limit rather than an oversight: a
 * release that adds a catalogue code does not add it to the roles of an
 * organization that already exists. Distributing a new code to existing tenants is
 * a migration under D-22 (`convex/migrations/**`), not a reseed. Enforcement is
 * unaffected — the evaluator reads the code-owned catalogue, not this table.
 *
 * Raw `ctx.db` rather than the tenant accessor, and allowlisted in
 * `scripts/verify-tenant-boundary.mjs` for it: `permissions` is a global table the
 * tenant-bound accessor cannot address by construction, and this runs during
 * provisioning, before there is a tenant context to bind to.
 */
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

/** Seed code-owned permissions and create editable defaults without overwriting them. */
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
