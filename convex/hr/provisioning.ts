/**
 * Operator bootstrap of HR access for organizations created before HR.
 *
 * Internal only: run with deployment administration access, e.g.
 * `pnpm exec convex run hr/provisioning:provisionOrganization \
 *   '{"clerkOrganizationId":"org_…"}'`. Re-running is safe.
 */
import { v } from "convex/values";

import { internalMutation } from "../_generated/server";
import { provisionHrForOrganization } from "../lib/authorizationSeedConvex";

export const provisionOrganization = internalMutation({
  args: {
    clerkOrganizationId: v.string(),
    /** Optionally grant the HR administrator role to one existing member. */
    grantHrAdminToClerkMembershipId: v.optional(v.string()),
    requestId: v.optional(v.string()),
  },
  returns: v.object({
    organizationId: v.id("organizations"),
    orgAdmin: v.union(
      v.literal("UPGRADED"),
      v.literal("CURRENT"),
      v.literal("CUSTOMIZED"),
      v.literal("MISSING"),
    ),
    rolesInserted: v.number(),
    hrPermissionsAdded: v.number(),
    hrAdminGranted: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const organization = await ctx.db
      .query("organizations")
      .withIndex("by_clerkOrganizationId", (query) =>
        query.eq("clerkOrganizationId", args.clerkOrganizationId.trim()),
      )
      .unique();
    if (organization === null || organization.status !== "ACTIVE")
      throw new Error("Active organization was not found.");
    const result = await provisionHrForOrganization(ctx, organization._id);

    let hrAdminGranted = false;
    if (args.grantHrAdminToClerkMembershipId !== undefined) {
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_orgId_clerkMembershipId", (query) =>
          query
            .eq("orgId", organization._id)
            .eq("clerkMembershipId", args.grantHrAdminToClerkMembershipId!),
        )
        .unique();
      if (membership === null || membership.status !== "ACTIVE")
        throw new Error("Active membership was not found.");
      const role = await ctx.db
        .query("roles")
        .withIndex("by_orgId_key", (query) =>
          query.eq("orgId", organization._id).eq("key", "HR_ADMIN"),
        )
        .unique();
      if (role === null) throw new Error("HR administrator role is missing.");
      const existing = await ctx.db
        .query("membershipRoles")
        .withIndex("by_orgId_membershipId_roleId", (query) =>
          query
            .eq("orgId", organization._id)
            .eq("membershipId", membership._id)
            .eq("roleId", role._id),
        )
        .unique();
      if (existing === null) {
        await ctx.db.insert("membershipRoles", {
          orgId: organization._id,
          membershipId: membership._id,
          roleId: role._id,
          grantedAt: Date.now(),
        });
        hrAdminGranted = true;
      }
    }
    await ctx.db.insert("auditEvents", {
      orgId: organization._id,
      occurredAt: Date.now(),
      actorKind: "SYSTEM",
      actorPlatformRef: "hr-provisioning",
      action: "hr.provision",
      entityTable: "roles",
      outcome: "ALLOWED",
      requestId: args.requestId ?? `hr-provision-${Date.now()}`,
      changes: [
        { field: "orgAdmin", to: result.orgAdmin },
        { field: "rolesInserted", to: String(result.rolesInserted) },
        { field: "hrAdminGranted", to: String(hrAdminGranted) },
      ],
    });
    return {
      organizationId: organization._id,
      orgAdmin: result.orgAdmin,
      rolesInserted: result.rolesInserted,
      hrPermissionsAdded: result.hrPermissionsAdded,
      hrAdminGranted,
    };
  },
});
