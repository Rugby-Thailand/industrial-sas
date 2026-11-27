import { v } from "convex/values";

import { internalMutation } from "../_generated/server";
import { seedPermissionDefinitions } from "../lib/authorizationSeedConvex";
import {
  CUSTOMER_LINE_PERMISSION_CODES,
  CUSTOMER_PERMISSION_CODES,
  PERMISSIONS_BY_CODE,
} from "../lib/permissions";

const LINE_DEFINITIONS = CUSTOMER_LINE_PERMISSION_CODES.map((code) =>
  PERMISSIONS_BY_CODE.get(code)!,
);

/**
 * Opt one organization into customer LINE groups: add the LINE grants to its
 * seeded, active ORG_ADMIN role when that role already holds both customer
 * grants. Other roles and customized administrators are reported, never
 * broadened. Idempotent; run per pilot organization after deployment.
 */
export const grantOrgAdminLineAccess = internalMutation({
  args: { orgId: v.id("organizations") },
  returns: v.object({
    status: v.union(
      v.literal("upgraded"),
      v.literal("current"),
      v.literal("customized"),
      v.literal("missing"),
    ),
    added: v.number(),
  }),
  handler: async (ctx, { orgId }) => {
    await seedPermissionDefinitions(ctx, LINE_DEFINITIONS);
    const role = await ctx.db
      .query("roles")
      .withIndex("by_orgId_key", (q) =>
        q.eq("orgId", orgId).eq("key", "ORG_ADMIN"),
      )
      .unique();
    if (role === null) return { status: "missing" as const, added: 0 };
    const grantOf = (permissionCode: string) =>
      ctx.db
        .query("rolePermissions")
        .withIndex("by_orgId_roleId_permissionCode", (q) =>
          q
            .eq("orgId", orgId)
            .eq("roleId", role._id)
            .eq("permissionCode", permissionCode),
        )
        .first();
    const customer = await Promise.all(CUSTOMER_PERMISSION_CODES.map(grantOf));
    if (
      !role.seeded ||
      role.status !== "ACTIVE" ||
      customer.some((grant) => grant === null)
    )
      return { status: "customized" as const, added: 0 };
    let added = 0;
    for (const permissionCode of CUSTOMER_LINE_PERMISSION_CODES) {
      if ((await grantOf(permissionCode)) !== null) continue;
      await ctx.db.insert("rolePermissions", {
        orgId,
        roleId: role._id,
        permissionCode,
      });
      added += 1;
    }
    return {
      status: added > 0 ? ("upgraded" as const) : ("current" as const),
      added,
    };
  },
});

/** Withdraw the LINE grants from an organization's ORG_ADMIN role. */
export const revokeOrgAdminLineAccess = internalMutation({
  args: { orgId: v.id("organizations") },
  returns: v.object({ removed: v.number() }),
  handler: async (ctx, { orgId }) => {
    const role = await ctx.db
      .query("roles")
      .withIndex("by_orgId_key", (q) =>
        q.eq("orgId", orgId).eq("key", "ORG_ADMIN"),
      )
      .unique();
    if (role === null) return { removed: 0 };
    let removed = 0;
    for (const permissionCode of CUSTOMER_LINE_PERMISSION_CODES) {
      const grant = await ctx.db
        .query("rolePermissions")
        .withIndex("by_orgId_roleId_permissionCode", (q) =>
          q
            .eq("orgId", orgId)
            .eq("roleId", role._id)
            .eq("permissionCode", permissionCode),
        )
        .first();
      if (grant === null) continue;
      await ctx.db.delete("rolePermissions", grant._id);
      removed += 1;
    }
    return { removed };
  },
});
