import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { seedAuthorizationForOrganization } from "../lib/authorizationSeedConvex";
import {
  CUSTOMER_PERMISSION_CODES,
  HR_ADMIN_PERMISSION_CODES,
  PLANNER_PERMISSION_CODES,
} from "../lib/permissions";

/** Explicit, idempotent upgrade. A customized administrator role needs a deliberate grant. */
export const organization = internalMutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    if (!(await ctx.db.get("organizations", args.orgId)))
      throw new Error("NOT_FOUND");
    await seedAuthorizationForOrganization(ctx, args.orgId);
    const role = await ctx.db
      .query("roles")
      .withIndex("by_orgId_key", (q) =>
        q.eq("orgId", args.orgId).eq("key", "ORG_ADMIN"),
      )
      .unique();
    if (!role) return "MISSING";
    const grants = await ctx.db
      .query("rolePermissions")
      .withIndex("by_orgId_roleId_permissionCode", (q) =>
        q.eq("orgId", args.orgId).eq("roleId", role._id),
      )
      .take(201);
    const codes = new Set(grants.map((g) => g.permissionCode));
    const legacy = [...PLANNER_PERMISSION_CODES, ...HR_ADMIN_PERMISSION_CODES];
    const target = [...legacy, "aiUsage.read", "aiUsage.configure"];
    // The customer pair affects CURRENT recognition only.
    const currentSize = CUSTOMER_PERMISSION_CODES.every((code) =>
      codes.has(code),
    )
      ? codes.size - CUSTOMER_PERMISSION_CODES.length
      : codes.size;
    if (currentSize === target.length && target.every((c) => codes.has(c)))
      return "CURRENT";
    if (
      !role.seeded ||
      role.status !== "ACTIVE" ||
      codes.size !== legacy.length ||
      !legacy.every((c) => codes.has(c))
    )
      return "CUSTOMIZED";
    for (const permissionCode of ["aiUsage.read", "aiUsage.configure"])
      await ctx.db.insert("rolePermissions", {
        orgId: args.orgId,
        roleId: role._id,
        permissionCode,
      });
    return "UPGRADED";
  },
});
