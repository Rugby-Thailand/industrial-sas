import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "../_generated/server";
import { seedPermissionDefinitions } from "../lib/authorizationSeedConvex";
import {
  AI_USAGE_PERMISSION_CODES,
  CUSTOMER_PERMISSION_CODES,
  HR_ADMIN_PERMISSION_CODES,
  PERMISSIONS_BY_CODE,
  PLANNER_PERMISSION_CODES,
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

const PRE_CUSTOMER_ORG_ADMIN_GRANTS = [
  ...PLANNER_PERMISSION_CODES,
  ...HR_ADMIN_PERMISSION_CODES,
  ...AI_USAGE_PERMISSION_CODES,
];
const CUSTOMER_ORG_ADMIN_GRANT_COUNT =
  PRE_CUSTOMER_ORG_ADMIN_GRANTS.length + CUSTOMER_PERMISSION_CODES.length;
const SEEDED_ORG_ADMIN_DESCRIPTIONS = new Set([
  "Manages building and storage plans.",
  "Manages building and storage plans and HR attendance.",
  "Tenant administrator with every tenant permission.",
  "Tenant system administrator; sensitive team HR and payroll access is separate.",
]);

type OrgAdminGrantState =
  | { status: "missing" }
  | { status: "customized"; roleId: Id<"roles"> }
  | { status: "eligible"; roleId: Id<"roles"> }
  | { status: "current"; customerGrantIds: Id<"rolePermissions">[] };

async function readOrgAdminGrants(
  ctx: QueryCtx,
  orgId: Id<"organizations">,
): Promise<OrgAdminGrantState> {
  const role = await ctx.db
    .query("roles")
    .withIndex("by_orgId_key", (q) =>
      q.eq("orgId", orgId).eq("key", "ORG_ADMIN"),
    )
    .unique();
  if (!role) return { status: "missing" };

  const roleId = role._id;
  const customized = { status: "customized", roleId } as const;
  if (
    !role.seeded ||
    role.status !== "ACTIVE" ||
    role.name !== "Organization administrator" ||
    (role.description !== undefined &&
      !SEEDED_ORG_ADMIN_DESCRIPTIONS.has(role.description))
  )
    return customized;

  const grants = await ctx.db
    .query("rolePermissions")
    .withIndex("by_orgId_roleId_permissionCode", (q) =>
      q.eq("orgId", orgId).eq("roleId", roleId),
    )
    .take(CUSTOMER_ORG_ADMIN_GRANT_COUNT + 1);
  const codes = new Set(grants.map(({ permissionCode }) => permissionCode));
  if (
    grants.length !== codes.size ||
    !PRE_CUSTOMER_ORG_ADMIN_GRANTS.every((code) => codes.has(code))
  )
    return customized;
  if (codes.size === PRE_CUSTOMER_ORG_ADMIN_GRANTS.length)
    return { status: "eligible", roleId };
  if (
    codes.size === CUSTOMER_ORG_ADMIN_GRANT_COUNT &&
    CUSTOMER_PERMISSION_CODES.every((code) => codes.has(code))
  )
    return {
      status: "current",
      customerGrantIds: grants
        .filter(({ permissionCode }) =>
          CUSTOMER_PERMISSION_CODES.some((code) => code === permissionCode),
        )
        .map(({ _id }) => _id),
    };
  return customized;
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
    let upgraded = 0;
    let current = 0;
    const customizedOrgIds: Id<"organizations">[] = [];
    const missingOrgIds: Id<"organizations">[] = [];
    for (const { _id: orgId } of page) {
      const admin = await readOrgAdminGrants(ctx, orgId);
      if (admin.status === "customized") customizedOrgIds.push(orgId);
      else if (admin.status === "missing") missingOrgIds.push(orgId);
      else if (admin.status === "current") current += 1;
      else {
        for (const permissionCode of CUSTOMER_PERMISSION_CODES)
          await ctx.db.insert("rolePermissions", {
            orgId,
            roleId: admin.roleId,
            permissionCode,
          });
        upgraded += 1;
      }
    }
    return {
      upgraded,
      current,
      customized: customizedOrgIds.length,
      missing: missingOrgIds.length,
      customizedOrgIds,
      missingOrgIds,
      isDone,
      continueCursor,
    };
  },
});

/** Revoke the customer pair from exact seeded defaults. Resume until isDone. */
export const revokeOrgAdminGrants = internalMutation({
  args: batchArgs,
  returns: v.object({
    revoked: v.number(),
    revokedOrgIds: v.array(v.id("organizations")),
    unchanged: v.number(),
    unchangedOrgIds: v.array(v.id("organizations")),
    customized: v.number(),
    customizedOrgIds: v.array(v.id("organizations")),
    missing: v.number(),
    missingOrgIds: v.array(v.id("organizations")),
    ...batchCursor,
  }),
  handler: async (ctx, { cursor }) => {
    const { page, isDone, continueCursor } = await organizationPage(
      ctx,
      cursor,
    );
    const revokedOrgIds: Id<"organizations">[] = [];
    const unchangedOrgIds: Id<"organizations">[] = [];
    const customizedOrgIds: Id<"organizations">[] = [];
    const missingOrgIds: Id<"organizations">[] = [];
    for (const { _id: orgId } of page) {
      const admin = await readOrgAdminGrants(ctx, orgId);
      if (admin.status === "customized") customizedOrgIds.push(orgId);
      else if (admin.status === "missing") missingOrgIds.push(orgId);
      else if (admin.status === "eligible") unchangedOrgIds.push(orgId);
      else {
        for (const id of admin.customerGrantIds)
          await ctx.db.delete("rolePermissions", id);
        revokedOrgIds.push(orgId);
      }
    }
    return {
      revoked: revokedOrgIds.length,
      revokedOrgIds,
      unchanged: unchangedOrgIds.length,
      unchangedOrgIds,
      customized: customizedOrgIds.length,
      customizedOrgIds,
      missing: missingOrgIds.length,
      missingOrgIds,
      isDone,
      continueCursor,
    };
  },
});

async function verifyAdmin(ctx: QueryCtx, orgId: Id<"organizations">) {
  const admin = await readOrgAdminGrants(ctx, orgId);
  if (admin.status !== "customized")
    return {
      orgId,
      status: admin.status,
      hasCustomerGrants: admin.status === "current",
    };

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
