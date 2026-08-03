import {
  internalMutationGeneric,
  type GenericMutationCtx,
} from "convex/server";
import { v } from "convex/values";

import type { DataModel } from "../schema";
import { seedAuthorizationForOrganization } from "./authorizationSeedConvex";
import { DEFAULT_ORGANIZATION_SETTINGS } from "./organizationDefaults";
import {
  applyIdentityWebhookEvent,
  type IdentityMirrorPort,
} from "./identityWebhook";

const locale = v.union(v.literal("th"), v.literal("en"));
const organizationIdentity = {
  clerkOrganizationId: v.string(),
  name: v.string(),
};
const userIdentity = {
  clerkUserId: v.string(),
  displayName: v.string(),
  preferredLocale: v.optional(locale),
};
const membershipIdentity = {
  ...organizationIdentity,
  ...userIdentity,
  clerkMembershipId: v.string(),
};

export const identityWebhookEventValidator = v.union(
  v.object({
    eventId: v.string(),
    eventAt: v.number(),
    type: v.literal("organization.upsert"),
    data: v.object(organizationIdentity),
  }),
  v.object({
    eventId: v.string(),
    eventAt: v.number(),
    type: v.literal("organization.delete"),
    data: v.object({ clerkOrganizationId: v.string() }),
  }),
  v.object({
    eventId: v.string(),
    eventAt: v.number(),
    type: v.literal("user.upsert"),
    data: v.object(userIdentity),
  }),
  v.object({
    eventId: v.string(),
    eventAt: v.number(),
    type: v.literal("user.delete"),
    data: v.object({ clerkUserId: v.string() }),
  }),
  v.object({
    eventId: v.string(),
    eventAt: v.number(),
    type: v.literal("membership.upsert"),
    data: v.object(membershipIdentity),
  }),
  v.object({
    eventId: v.string(),
    eventAt: v.number(),
    type: v.literal("membership.delete"),
    data: v.object(membershipIdentity),
  }),
);

function createConvexIdentityMirrorPort(
  ctx: GenericMutationCtx<DataModel>,
): IdentityMirrorPort {
  const organization = async (clerkOrganizationId: string) =>
    await ctx.db
      .query("organizations")
      .withIndex("by_clerkOrganizationId", (query) =>
        query.eq("clerkOrganizationId", clerkOrganizationId),
      )
      .unique();
  const user = async (clerkUserId: string) =>
    await ctx.db
      .query("users")
      .withIndex("by_clerkUserId", (query) =>
        query.eq("clerkUserId", clerkUserId),
      )
      .unique();

  return {
    findOrganization: async (clerkOrganizationId) => {
      const found = await organization(clerkOrganizationId);
      return found === null
        ? null
        : {
            clerkOrganizationId: found.clerkOrganizationId,
            name: found.name,
            status: found.status,
            ...(found.clerkLastEventId === undefined
              ? {}
              : { clerkLastEventId: found.clerkLastEventId }),
            ...(found.clerkLastEventAt === undefined
              ? {}
              : { clerkLastEventAt: found.clerkLastEventAt }),
          };
    },
    putOrganization: async (value) => {
      const found = await organization(value.clerkOrganizationId);
      const mirrored = {
        name: value.name,
        status: value.status,
        ...(value.clerkLastEventId === undefined
          ? {}
          : { clerkLastEventId: value.clerkLastEventId }),
        ...(value.clerkLastEventAt === undefined
          ? {}
          : { clerkLastEventAt: value.clerkLastEventAt }),
      };
      if (found === null) {
        const orgId = await ctx.db.insert("organizations", {
          clerkOrganizationId: value.clerkOrganizationId,
          ...mirrored,
          settings: DEFAULT_ORGANIZATION_SETTINGS,
        });
        await seedAuthorizationForOrganization(ctx, orgId);
      } else {
        await ctx.db.patch("organizations", found._id, mirrored);
      }
    },
    findUser: async (clerkUserId) => {
      const found = await user(clerkUserId);
      return found === null
        ? null
        : {
            clerkUserId: found.clerkUserId,
            displayName: found.displayName,
            status: found.status,
            ...(found.preferredLocale === undefined
              ? {}
              : { preferredLocale: found.preferredLocale }),
            ...(found.clerkLastEventId === undefined
              ? {}
              : { clerkLastEventId: found.clerkLastEventId }),
            ...(found.clerkLastEventAt === undefined
              ? {}
              : { clerkLastEventAt: found.clerkLastEventAt }),
          };
    },
    putUser: async (value) => {
      const found = await user(value.clerkUserId);
      const mirrored = {
        displayName: value.displayName,
        status: value.status,
        ...(value.preferredLocale === undefined
          ? {}
          : { preferredLocale: value.preferredLocale }),
        ...(value.clerkLastEventId === undefined
          ? {}
          : { clerkLastEventId: value.clerkLastEventId }),
        ...(value.clerkLastEventAt === undefined
          ? {}
          : { clerkLastEventAt: value.clerkLastEventAt }),
      };
      if (found === null) {
        await ctx.db.insert("users", {
          clerkUserId: value.clerkUserId,
          ...mirrored,
        });
      } else {
        await ctx.db.patch("users", found._id, mirrored);
      }
    },
    findMembership: async ({ clerkOrganizationId, clerkMembershipId }) => {
      const foundOrganization = await organization(clerkOrganizationId);
      if (foundOrganization === null) return null;
      const found = await ctx.db
        .query("memberships")
        .withIndex("by_orgId_clerkMembershipId", (query) =>
          query
            .eq("orgId", foundOrganization._id)
            .eq("clerkMembershipId", clerkMembershipId),
        )
        .unique();
      if (found === null) return null;
      const foundUser = await ctx.db.get("users", found.userId);
      if (foundUser === null)
        throw new Error("Identity mirror is inconsistent.");
      return {
        clerkOrganizationId,
        clerkUserId: foundUser.clerkUserId,
        clerkMembershipId: found.clerkMembershipId,
        status: found.status,
        scopeMode: found.scopeMode,
        effectiveFrom: found.effectiveFrom,
        ...(found.effectiveTo === undefined
          ? {}
          : { effectiveTo: found.effectiveTo }),
        ...(found.clerkLastEventId === undefined
          ? {}
          : { clerkLastEventId: found.clerkLastEventId }),
        ...(found.clerkLastEventAt === undefined
          ? {}
          : { clerkLastEventAt: found.clerkLastEventAt }),
      };
    },
    putMembership: async (value) => {
      const foundOrganization = await organization(value.clerkOrganizationId);
      const foundUser = await user(value.clerkUserId);
      if (foundOrganization === null || foundUser === null) {
        throw new Error("Identity mirror references are missing.");
      }
      const found = await ctx.db
        .query("memberships")
        .withIndex("by_orgId_clerkMembershipId", (query) =>
          query
            .eq("orgId", foundOrganization._id)
            .eq("clerkMembershipId", value.clerkMembershipId),
        )
        .unique();
      const mirrored = {
        userId: foundUser._id,
        status: value.status,
        scopeMode: value.scopeMode,
        effectiveFrom: value.effectiveFrom,
        ...(value.effectiveTo === undefined
          ? {}
          : { effectiveTo: value.effectiveTo }),
        ...(value.clerkLastEventId === undefined
          ? {}
          : { clerkLastEventId: value.clerkLastEventId }),
        ...(value.clerkLastEventAt === undefined
          ? {}
          : { clerkLastEventAt: value.clerkLastEventAt }),
      };
      if (found === null) {
        await ctx.db.insert("memberships", {
          orgId: foundOrganization._id,
          clerkMembershipId: value.clerkMembershipId,
          ...mirrored,
        });
      } else {
        await ctx.db.patch("memberships", found._id, mirrored);
      }
    },
  };
}

/** The sole raw-database path for signature-verified Clerk mirror events. */
export const applyClerkIdentityEvent = internalMutationGeneric({
  args: { event: identityWebhookEventValidator },
  returns: v.object({
    outcome: v.union(
      v.literal("APPLIED"),
      v.literal("REPLAY"),
      v.literal("STALE"),
    ),
    entityKind: v.union(
      v.literal("ORGANIZATION"),
      v.literal("USER"),
      v.literal("MEMBERSHIP"),
    ),
    externalId: v.string(),
  }),
  handler: async (ctx, { event }) =>
    await applyIdentityWebhookEvent(
      event,
      createConvexIdentityMirrorPort(ctx as GenericMutationCtx<DataModel>),
    ),
});
