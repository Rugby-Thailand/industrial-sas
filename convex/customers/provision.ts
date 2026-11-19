import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import {
  seedPermissionDefinitions,
  withoutCustomerAdminGrants,
} from "../lib/authorizationSeedConvex";
import {
  CUSTOMER_PERMISSION_CODES,
  HR_ADMIN_PERMISSION_CODES,
  PERMISSIONS_BY_CODE,
  PLANNER_PERMISSION_CODES,
} from "../lib/permissions";

const BATCH_SIZE = 50;
const PLANNER_AND_HR = [
  ...PLANNER_PERMISSION_CODES,
  ...HR_ADMIN_PERMISSION_CODES,
];
const PRE_CUSTOMERS_ADMIN = [
  ...PLANNER_AND_HR,
  "aiUsage.read",
  "aiUsage.configure",
];
const BASELINES = [
  PLANNER_PERMISSION_CODES,
  PLANNER_AND_HR,
  PRE_CUSTOMERS_ADMIN,
];
const CUSTOMER_DEFINITIONS = CUSTOMER_PERMISSION_CODES.map((code) =>
  PERMISSIONS_BY_CODE.get(code)!,
);

async function upgradeAdmin(ctx: MutationCtx, orgId: Id<"organizations">) {
  const role = await ctx.db
    .query("roles")
    .withIndex("by_orgId_key", (q) =>
      q.eq("orgId", orgId).eq("key", "ORG_ADMIN"),
    )
    .unique();
  if (!role) return "missing";
  if (
    !role.seeded ||
    role.status !== "ACTIVE" ||
    role.name !== "Organization administrator" ||
    (role.description !== "Manages building and storage plans." &&
      role.description !==
        "Manages building and storage plans and HR attendance.")
  ) {
    return "customized";
  }

  const grants = await ctx.db
    .query("rolePermissions")
    .withIndex("by_orgId_roleId_permissionCode", (q) =>
      q.eq("orgId", orgId).eq("roleId", role._id),
    )
    .take(PRE_CUSTOMERS_ADMIN.length + CUSTOMER_PERMISSION_CODES.length + 1);
  const codes = new Set(grants.map((grant) => grant.permissionCode));
  const baselineCodes = withoutCustomerAdminGrants(codes);
  if (
    grants.length !== codes.size ||
    !BASELINES.some(
      (baseline) =>
        baseline.length === baselineCodes.size &&
        baseline.every((code) => baselineCodes.has(code)),
    )
  ) {
    return "customized";
  }
  if (baselineCodes !== codes) return "current";

  for (const permissionCode of CUSTOMER_PERMISSION_CODES) {
    await ctx.db.insert("rolePermissions", {
      orgId,
      roleId: role._id,
      permissionCode,
    });
  }
  return "upgraded";
}

/** Run after deployment. Pass continueCursor back in as cursor until isDone. */
export const upgradeOrgAdminRoles = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({
    upgraded: v.number(),
    current: v.number(),
    customized: v.number(),
    missing: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { cursor }) => {
    await seedPermissionDefinitions(ctx, CUSTOMER_DEFINITIONS);
    const { page, isDone, continueCursor } = await ctx.db
      .query("organizations")
      .withIndex("by_clerkOrganizationId")
      .paginate({ cursor: cursor ?? null, numItems: BATCH_SIZE });
    const counts = { upgraded: 0, current: 0, customized: 0, missing: 0 };
    for (const organization of page) {
      const outcome = await upgradeAdmin(ctx, organization._id);
      counts[outcome] += 1;
    }
    return { ...counts, isDone, continueCursor };
  },
});
