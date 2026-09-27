import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

import { seedAuthorizationForOrganization } from "../lib/authorizationSeedConvex";

const warehouseInput = v.object({
  code: v.string(),
  name: v.string(),
});

function requiredText(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

/**
 * Privileged tenant bootstrap for an organization that has already arrived
 * through the signed Clerk webhook. It is internal-only: callers must have
 * deployment administration access and cannot use it from the browser.
 */
export const grantFirstAdminAndCreateWarehouse = internalMutation({
  args: {
    clerkOrganizationId: v.string(),
    clerkMembershipId: v.string(),
    requestId: v.string(),
    warehouse: warehouseInput,
  },
  returns: v.object({
    organizationId: v.id("organizations"),
    membershipId: v.id("memberships"),
    warehouseId: v.id("warehouses"),
    adminGranted: v.boolean(),
    warehouseCreated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const clerkOrganizationId = requiredText(
      args.clerkOrganizationId,
      "clerkOrganizationId",
    );
    const clerkMembershipId = requiredText(
      args.clerkMembershipId,
      "clerkMembershipId",
    );
    const requestId = requiredText(args.requestId, "requestId");
    const code = requiredText(
      args.warehouse.code,
      "warehouse.code",
    ).toUpperCase();
    const name = requiredText(args.warehouse.name, "warehouse.name");

    const organization = await ctx.db
      .query("organizations")
      .withIndex("by_clerkOrganizationId", (query) =>
        query.eq("clerkOrganizationId", clerkOrganizationId),
      )
      .unique();
    if (!organization || organization.status !== "ACTIVE") {
      throw new Error(
        "Active organization was not found in the identity mirror.",
      );
    }

    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_orgId_clerkMembershipId", (query) =>
        query
          .eq("orgId", organization._id)
          .eq("clerkMembershipId", clerkMembershipId),
      )
      .unique();
    if (!membership || membership.status !== "ACTIVE") {
      throw new Error(
        "Active membership was not found in the identity mirror.",
      );
    }

    await seedAuthorizationForOrganization(ctx, organization._id);
    const adminRole = await ctx.db
      .query("roles")
      .withIndex("by_orgId_key", (query) =>
        query.eq("orgId", organization._id).eq("key", "ORG_ADMIN"),
      )
      .unique();
    if (!adminRole || adminRole.status !== "ACTIVE") {
      throw new Error("Organization administrator role is unavailable.");
    }

    const existingGrant = await ctx.db
      .query("membershipRoles")
      .withIndex("by_orgId_membershipId_roleId", (query) =>
        query
          .eq("orgId", organization._id)
          .eq("membershipId", membership._id)
          .eq("roleId", adminRole._id),
      )
      .unique();
    const now = Date.now();
    if (!existingGrant) {
      await ctx.db.insert("membershipRoles", {
        orgId: organization._id,
        membershipId: membership._id,
        roleId: adminRole._id,
        grantedAt: now,
      });
    }

    let warehouse = await ctx.db
      .query("warehouses")
      .withIndex("by_orgId_code", (query) =>
        query.eq("orgId", organization._id).eq("code", code),
      )
      .unique();
    let warehouseCreated = false;
    if (!warehouse) {
      const warehouseId = await ctx.db.insert("warehouses", {
        orgId: organization._id,
        code,
        name,
        status: "ACTIVE",
      });
      warehouse = await ctx.db.get(warehouseId);
      warehouseCreated = true;
    } else if (warehouse.name !== name || warehouse.status !== "ACTIVE") {
      throw new Error(
        "Warehouse code is already used by a different warehouse.",
      );
    }
    if (!warehouse) throw new Error("Warehouse creation failed.");

    const existingScope = await ctx.db
      .query("membershipWarehouses")
      .withIndex("by_orgId_membershipId_warehouseId", (query) =>
        query
          .eq("orgId", organization._id)
          .eq("membershipId", membership._id)
          .eq("warehouseId", warehouse._id),
      )
      .unique();
    if (!existingScope) {
      await ctx.db.insert("membershipWarehouses", {
        orgId: organization._id,
        membershipId: membership._id,
        warehouseId: warehouse._id,
      });
    }

    const existingAudit = await ctx.db
      .query("auditEvents")
      .withIndex("by_orgId_requestId", (query) =>
        query.eq("orgId", organization._id).eq("requestId", requestId),
      )
      .unique();
    if (!existingAudit) {
      await ctx.db.insert("auditEvents", {
        orgId: organization._id,
        occurredAt: now,
        actorKind: "SYSTEM",
        actorPlatformRef: "organization-onboarding",
        action: "organization.bootstrap",
        entityTable: "warehouses",
        entityId: warehouse._id,
        warehouseId: warehouse._id,
        outcome: "ALLOWED",
        requestId,
      });
    }

    return {
      organizationId: organization._id,
      membershipId: membership._id,
      warehouseId: warehouse._id,
      adminGranted: !existingGrant,
      warehouseCreated,
    };
  },
});
