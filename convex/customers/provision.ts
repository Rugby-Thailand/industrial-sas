import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "../_generated/server";
import {
  readSeededOrgAdminGrants,
  seedPermissionDefinitions,
  upgradeSeededOrgAdmin,
} from "../lib/authorizationSeedConvex";
import {
  CUSTOMER_PERMISSION_CODES,
  PERMISSIONS_BY_CODE,
} from "../lib/permissions";

const BATCH_SIZE = 50;
const CUSTOMER_DEFINITIONS = CUSTOMER_PERMISSION_CODES.map((code) =>
  PERMISSIONS_BY_CODE.get(code)!,
);
const batchArgs = { cursor: v.optional(v.string()) };
const batchCursor = { isDone: v.boolean(), continueCursor: v.string() };

function organizationPage(ctx: QueryCtx, cursor: string | undefined) {
  return ctx.db
    .query("organizations")
    .withIndex("by_clerkOrganizationId")
    .paginate({ cursor: cursor ?? null, numItems: BATCH_SIZE });
}

/** Run after deployment. Pass continueCursor back in as cursor until isDone. */
export const upgradeOrgAdminRoles = internalMutation({
  args: batchArgs,
  returns: v.object({
    upgraded: v.number(),
    current: v.number(),
    customized: v.number(),
    missing: v.number(),
    customizedOrgIds: v.array(v.id("organizations")),
    missingOrgIds: v.array(v.id("organizations")),
    ...batchCursor,
  }),
  handler: async (ctx, { cursor }) => {
    await seedPermissionDefinitions(ctx, CUSTOMER_DEFINITIONS);
    const { page, isDone, continueCursor } = await organizationPage(
      ctx,
      cursor,
    );
    const counts = { UPGRADED: 0, CURRENT: 0 };
    const customizedOrgIds: Id<"organizations">[] = [];
    const missingOrgIds: Id<"organizations">[] = [];
    for (const { _id: orgId } of page) {
      const outcome = await upgradeSeededOrgAdmin(
        ctx,
        orgId,
        CUSTOMER_PERMISSION_CODES,
      );
      if (outcome === "CUSTOMIZED") customizedOrgIds.push(orgId);
      else if (outcome === "MISSING") missingOrgIds.push(orgId);
      else counts[outcome] += 1;
    }
    return {
      upgraded: counts.UPGRADED,
      current: counts.CURRENT,
      customized: customizedOrgIds.length,
      missing: missingOrgIds.length,
      customizedOrgIds,
      missingOrgIds,
      isDone,
      continueCursor,
    };
  },
});

async function verifyAdmin(ctx: QueryCtx, orgId: Id<"organizations">) {
  const admin = await readSeededOrgAdminGrants(ctx, orgId);
  if (admin.status === "MISSING")
    return { orgId, status: "missing" as const, hasCustomerGrants: false };
  if (admin.status === "SEEDED") {
    const hasCustomerGrants = CUSTOMER_PERMISSION_CODES.every((code) =>
      admin.codes.has(code),
    );
    return {
      orgId,
      status: hasCustomerGrants ? ("current" as const) : ("eligible" as const),
      hasCustomerGrants,
    };
  }

  // Customized roles can have more grants than the bounded eligibility read.
  const grants = await Promise.all(
    CUSTOMER_PERMISSION_CODES.map((permissionCode) =>
      ctx.db
        .query("rolePermissions")
        .withIndex("by_orgId_roleId_permissionCode", (q) =>
          q
            .eq("orgId", orgId)
            .eq("roleId", admin.roleId)
            .eq("permissionCode", permissionCode),
        )
        .first(),
    ),
  );
  return {
    orgId,
    status: "customized" as const,
    hasCustomerGrants: grants.every((grant) => grant !== null),
  };
}

export const verifyOrgAdminGrants = internalQuery({
  args: batchArgs,
  returns: v.object({
    ...batchCursor,
    page: v.array(
      v.object({
        orgId: v.id("organizations"),
        status: v.union(
          v.literal("current"),
          v.literal("eligible"),
          v.literal("customized"),
          v.literal("missing"),
        ),
        hasCustomerGrants: v.boolean(),
      }),
    ),
  }),
  handler: async (ctx, { cursor }) => {
    const { page, isDone, continueCursor } = await organizationPage(
      ctx,
      cursor,
    );
    return {
      isDone,
      continueCursor,
      page: await Promise.all(page.map(({ _id }) => verifyAdmin(ctx, _id))),
    };
  },
});
