import { v } from "convex/values";

import { internalMutation } from "../_generated/server";
import {
  seedAuthorizationForOrganization,
  upgradeSeededOrgAdmin,
} from "../lib/authorizationSeedConvex";
import { AI_USAGE_PERMISSION_CODES } from "../lib/permissions";

/** Explicit, idempotent upgrade. A customized administrator role needs a deliberate grant. */
export const organization = internalMutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    if (!(await ctx.db.get("organizations", args.orgId)))
      throw new Error("NOT_FOUND");
    await seedAuthorizationForOrganization(ctx, args.orgId);
    return upgradeSeededOrgAdmin(ctx, args.orgId, AI_USAGE_PERMISSION_CODES);
  },
});
