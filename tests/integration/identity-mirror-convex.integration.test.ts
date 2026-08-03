import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";

import { applyClerkIdentityEvent } from "../../convex/lib/identityMirrorConvex";
import { DEFAULT_ORGANIZATION_SETTINGS } from "../../convex/lib/organizationDefaults";
import type { IdentityWebhookEvent } from "../../convex/lib/identityWebhook";
import type { DataModel } from "../../convex/schema";
import { createConvexTenantWorld } from "../fixtures/convex-tenant-world";

interface RuntimeMutation {
  readonly _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: { readonly event: IdentityWebhookEvent },
  ) => Promise<unknown>;
}

const runtimeMutation = applyClerkIdentityEvent as unknown as RuntimeMutation;

const membershipEvent = (
  eventId: string,
  eventAt: number,
  clerkOrganizationId: string,
): IdentityWebhookEvent => ({
  eventId,
  eventAt,
  type: "membership.upsert",
  data: {
    clerkOrganizationId,
    name: `Organization ${clerkOrganizationId}`,
    clerkUserId: "user_shared_external",
    displayName: "Shared User",
    clerkMembershipId: "mem_shared_external",
  },
});

describe("atomic Convex Clerk mirror adapter", () => {
  it("provisions safe organization defaults and returns replay without rewriting", async () => {
    const world = await createConvexTenantWorld();
    const event: IdentityWebhookEvent = {
      eventId: "evt_org_create",
      eventAt: 1_000,
      type: "organization.upsert",
      data: { clerkOrganizationId: "org_new", name: "โรงงานใหม่" },
    };

    const first = await world.t.run(async (ctx) =>
      runtimeMutation._handler(ctx, { event }),
    );
    const replay = await world.t.run(async (ctx) =>
      runtimeMutation._handler(ctx, { event }),
    );
    const organization = await world.t.run(
      async (ctx) =>
        await ctx.db
          .query("organizations")
          .withIndex("by_clerkOrganizationId", (query) =>
            query.eq("clerkOrganizationId", "org_new"),
          )
          .unique(),
    );

    expect(first).toMatchObject({ outcome: "APPLIED" });
    expect(replay).toMatchObject({ outcome: "REPLAY" });
    expect(organization).toMatchObject({
      name: "โรงงานใหม่",
      status: "ACTIVE",
      settings: DEFAULT_ORGANIZATION_SETTINGS,
      clerkLastEventId: "evt_org_create",
      clerkLastEventAt: 1_000,
    });
  });

  it("keeps colliding membership IDs isolated by internal organization ID", async () => {
    const world = await createConvexTenantWorld();
    await world.t.run(async (ctx) =>
      runtimeMutation._handler(ctx, {
        event: membershipEvent("evt_a", 1_000, "org_external_a"),
      }),
    );
    await world.t.run(async (ctx) =>
      runtimeMutation._handler(ctx, {
        event: membershipEvent("evt_b", 2_000, "org_external_b"),
      }),
    );

    const mirrors = await world.t.run(async (ctx) => {
      const organizations = await Promise.all(
        ["org_external_a", "org_external_b"].map(
          async (clerkOrganizationId) =>
            await ctx.db
              .query("organizations")
              .withIndex("by_clerkOrganizationId", (query) =>
                query.eq("clerkOrganizationId", clerkOrganizationId),
              )
              .unique(),
        ),
      );
      return await Promise.all(
        organizations.map(async (organization) => {
          if (organization === null) throw new Error("missing fixture org");
          return await ctx.db
            .query("memberships")
            .withIndex("by_orgId_clerkMembershipId", (query) =>
              query
                .eq("orgId", organization._id)
                .eq("clerkMembershipId", "mem_shared_external"),
            )
            .unique();
        }),
      );
    });

    expect(mirrors).toHaveLength(2);
    expect(mirrors[0]?._id).not.toBe(mirrors[1]?._id);
    expect(mirrors.map((membership) => membership?.orgId)).toHaveLength(2);
  });

  it("rolls back earlier mirror writes when an exact membership lookup is ambiguous", async () => {
    const world = await createConvexTenantWorld();
    await world.t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        clerkOrganizationId: "org_duplicate",
        name: "Before",
        status: "ACTIVE",
        settings: DEFAULT_ORGANIZATION_SETTINGS,
      });
      const userId = await ctx.db.insert("users", {
        clerkUserId: "user_shared_external",
        displayName: "Before",
        status: "ACTIVE",
      });
      for (const scopeMode of ["ORG_WIDE", "WAREHOUSE_SCOPED"] as const) {
        await ctx.db.insert("memberships", {
          orgId,
          userId,
          clerkMembershipId: "mem_shared_external",
          status: "ACTIVE",
          scopeMode,
          effectiveFrom: 0,
        });
      }
    });

    await expect(
      world.t.run(async (ctx) =>
        runtimeMutation._handler(ctx, {
          event: membershipEvent("evt_ambiguous", 2_000, "org_duplicate"),
        }),
      ),
    ).rejects.toThrow();

    const state = await world.t.run(async (ctx) => {
      const organization = await ctx.db
        .query("organizations")
        .withIndex("by_clerkOrganizationId", (query) =>
          query.eq("clerkOrganizationId", "org_duplicate"),
        )
        .unique();
      const user = await ctx.db
        .query("users")
        .withIndex("by_clerkUserId", (query) =>
          query.eq("clerkUserId", "user_shared_external"),
        )
        .unique();
      return { organization, user };
    });

    expect(state.organization).toMatchObject({ name: "Before" });
    expect(state.organization?.clerkLastEventId).toBeUndefined();
    expect(state.user).toMatchObject({ displayName: "Before" });
    expect(state.user?.clerkLastEventId).toBeUndefined();
  });
});
