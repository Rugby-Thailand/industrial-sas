/**
 * Integration tier — the authorization foundation seed against `convex-test`.
 *
 * Two things are being proved, and they are different claims:
 *
 * 1. The seed function itself: global for `permissions`, tenant-bound for `roles`
 *    and `rolePermissions`, idempotent on rerun, and non-destructive of a tenant
 *    edit (`INV-0006-11`).
 * 2. The provisioning path: an organization mirrored from Clerk is seeded in the
 *    *same* transaction as its insert, so no tenant exists without its roles.
 *
 * All data is synthetic (`tests/fixtures/README.md`).
 */
import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";

import { seedAuthorizationForOrganization } from "../../convex/lib/authorizationSeedConvex";
import { applyClerkIdentityEvent } from "../../convex/lib/identityMirrorConvex";
import type { IdentityWebhookEvent } from "../../convex/lib/identityWebhook";
import {
  DEFAULT_ROLES,
  PERMISSION_CATALOGUE,
} from "../../convex/lib/permissions";
import type { DataModel } from "../../convex/schema";
import { createConvexTenantWorld } from "../fixtures/convex-tenant-world";

const ROLE_PERMISSION_TOTAL = DEFAULT_ROLES.reduce(
  (total, role) => total + role.permissionCodes.length,
  0,
);

interface RuntimeMutation {
  readonly _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: { readonly event: IdentityWebhookEvent },
  ) => Promise<unknown>;
}

const runtimeMutation = applyClerkIdentityEvent as unknown as RuntimeMutation;

describe("authorization foundation seed", () => {
  it("is idempotent, global for permissions, tenant-bound for roles, and preserves edits", async () => {
    const world = await createConvexTenantWorld();
    const first = await world.t.run(
      async (ctx) => await seedAuthorizationForOrganization(ctx, world.orgA),
    );
    expect(first).toEqual({
      permissionsInserted: PERMISSION_CATALOGUE.length,
      permissionsUpdated: 0,
      rolesInserted: DEFAULT_ROLES.length,
      rolePermissionsInserted: ROLE_PERMISSION_TOTAL,
    });

    const admin = await world.t.run(
      async (ctx) =>
        await ctx.db
          .query("roles")
          .withIndex("by_orgId_key", (query) =>
            query.eq("orgId", world.orgA).eq("key", "ORG_ADMIN"),
          )
          .unique(),
    );
    if (admin === null) throw new Error("missing seeded admin role");

    // A tenant edit of a seeded role: renamed, disowned, and one grant removed.
    const removed = await world.t.run(async (ctx) => {
      await ctx.db.patch("roles", admin._id, {
        name: "ผู้ดูแลที่แก้ไขแล้ว",
        seeded: false,
      });
      const grant = await ctx.db
        .query("rolePermissions")
        .withIndex("by_orgId_roleId_permissionCode", (query) =>
          query
            .eq("orgId", world.orgA)
            .eq("roleId", admin._id)
            .eq("permissionCode", "inventory.negativeStock.override"),
        )
        .unique();
      if (grant === null) throw new Error("missing seeded grant");
      await ctx.db.delete("rolePermissions", grant._id);
      return grant.permissionCode;
    });

    const replay = await world.t.run(
      async (ctx) => await seedAuthorizationForOrganization(ctx, world.orgA),
    );
    const secondTenant = await world.t.run(
      async (ctx) => await seedAuthorizationForOrganization(ctx, world.orgB),
    );
    const state = await world.t.run(async (ctx) => ({
      permissions: await ctx.db.query("permissions").collect(),
      rolesA: await ctx.db
        .query("roles")
        .withIndex("by_orgId_status_key", (query) =>
          query.eq("orgId", world.orgA),
        )
        .collect(),
      rolesB: await ctx.db
        .query("roles")
        .withIndex("by_orgId_status_key", (query) =>
          query.eq("orgId", world.orgB),
        )
        .collect(),
      edited: await ctx.db.get("roles", admin._id),
      adminGrants: await ctx.db
        .query("rolePermissions")
        .withIndex("by_orgId_roleId_permissionCode", (query) =>
          query.eq("orgId", world.orgA).eq("roleId", admin._id),
        )
        .collect(),
    }));

    expect(replay).toEqual({
      permissionsInserted: 0,
      permissionsUpdated: 0,
      rolesInserted: 0,
      rolePermissionsInserted: 0,
    });
    expect(secondTenant).toEqual({
      permissionsInserted: 0,
      permissionsUpdated: 0,
      rolesInserted: DEFAULT_ROLES.length,
      rolePermissionsInserted: ROLE_PERMISSION_TOTAL,
    });
    expect(state.permissions).toHaveLength(PERMISSION_CATALOGUE.length);
    expect(state.rolesA).toHaveLength(DEFAULT_ROLES.length);
    expect(state.rolesB).toHaveLength(DEFAULT_ROLES.length);
    expect(state.edited).toMatchObject({
      name: "ผู้ดูแลที่แก้ไขแล้ว",
      seeded: false,
    });
    // The removed grant stays removed: a rerun repairs nothing it did not create.
    expect(
      state.adminGrants.map(({ permissionCode }) => permissionCode),
    ).not.toContain(removed);
  });

  it("writes every documented composition, tenant-scoped and platform-free", async () => {
    const world = await createConvexTenantWorld();
    await world.t.run(
      async (ctx) => await seedAuthorizationForOrganization(ctx, world.orgA),
    );
    await world.t.run(
      async (ctx) => await seedAuthorizationForOrganization(ctx, world.orgB),
    );

    const compositions = await world.t.run(async (ctx) => {
      const perTenant = async (orgId: typeof world.orgA) => {
        const roles = await ctx.db
          .query("roles")
          .withIndex("by_orgId_status_key", (query) => query.eq("orgId", orgId))
          .collect();
        return await Promise.all(
          roles.map(async (role) => ({
            key: role.key,
            orgId: role.orgId,
            seeded: role.seeded,
            codes: (
              await ctx.db
                .query("rolePermissions")
                .withIndex("by_orgId_roleId_permissionCode", (query) =>
                  query.eq("orgId", orgId).eq("roleId", role._id),
                )
                .collect()
            ).map(({ orgId: rowOrgId, permissionCode }) => ({
              rowOrgId,
              permissionCode,
            })),
          })),
        );
      };
      return { a: await perTenant(world.orgA), b: await perTenant(world.orgB) };
    });

    for (const [orgId, roles] of [
      [world.orgA, compositions.a],
      [world.orgB, compositions.b],
    ] as const) {
      expect(roles).toHaveLength(DEFAULT_ROLES.length);
      for (const definition of DEFAULT_ROLES) {
        const seeded = roles.find(({ key }) => key === definition.key);
        expect(seeded).toMatchObject({ orgId, seeded: true });
        expect(
          seeded?.codes.map(({ permissionCode }) => permissionCode).sort(),
        ).toEqual([...definition.permissionCodes].sort());
        // Every grant row carries the tenant it was seeded for, never the other.
        expect(seeded?.codes.every(({ rowOrgId }) => rowOrgId === orgId)).toBe(
          true,
        );
        expect(
          seeded?.codes.some(({ permissionCode }) =>
            permissionCode.startsWith("platform."),
          ),
        ).toBe(false);
      }
    }
  });

  it("seeds a Clerk-provisioned organization in the same transaction as its insert", async () => {
    const world = await createConvexTenantWorld();
    const event: IdentityWebhookEvent = {
      eventId: "evt_org_seeded",
      eventAt: 1_000,
      type: "organization.upsert",
      data: { clerkOrganizationId: "org_seeded", name: "โรงงานใหม่" },
    };

    await world.t.run(async (ctx) => runtimeMutation._handler(ctx, { event }));
    const provisioned = await world.t.run(async (ctx) => {
      const organization = await ctx.db
        .query("organizations")
        .withIndex("by_clerkOrganizationId", (query) =>
          query.eq("clerkOrganizationId", "org_seeded"),
        )
        .unique();
      if (organization === null) throw new Error("missing provisioned org");
      return {
        roles: await ctx.db
          .query("roles")
          .withIndex("by_orgId_status_key", (query) =>
            query.eq("orgId", organization._id),
          )
          .collect(),
        grants: await ctx.db
          .query("rolePermissions")
          .withIndex("by_orgId_permissionCode", (query) =>
            query.eq("orgId", organization._id),
          )
          .collect(),
        permissions: await ctx.db.query("permissions").collect(),
      };
    });

    expect(provisioned.roles.map(({ key }) => key).sort()).toEqual(
      DEFAULT_ROLES.map(({ key }) => key).sort(),
    );
    expect(provisioned.grants).toHaveLength(ROLE_PERMISSION_TOTAL);
    expect(provisioned.permissions).toHaveLength(PERMISSION_CATALOGUE.length);
  });

  it("rolls the seed back with the transaction that provisioned it", async () => {
    const world = await createConvexTenantWorld();
    // A second user row makes the mirror's exact user lookup ambiguous, so the
    // membership event throws after the organization insert and its seed.
    await world.t.run(async (ctx) => {
      for (const displayName of ["First", "Second"]) {
        await ctx.db.insert("users", {
          clerkUserId: "user_ambiguous",
          displayName,
          status: "ACTIVE",
        });
      }
    });

    await expect(
      world.t.run(async (ctx) =>
        runtimeMutation._handler(ctx, {
          event: {
            eventId: "evt_rollback",
            eventAt: 2_000,
            type: "membership.upsert",
            data: {
              clerkOrganizationId: "org_rolled_back",
              name: "Rolled back",
              clerkUserId: "user_ambiguous",
              displayName: "Ambiguous",
              clerkMembershipId: "mem_rolled_back",
            },
          },
        }),
      ),
    ).rejects.toThrow();

    const after = await world.t.run(async (ctx) => ({
      organizations: await ctx.db
        .query("organizations")
        .withIndex("by_clerkOrganizationId", (query) =>
          query.eq("clerkOrganizationId", "org_rolled_back"),
        )
        .collect(),
      roles: await ctx.db.query("roles").collect(),
      permissions: await ctx.db.query("permissions").collect(),
    }));

    expect(after.organizations).toEqual([]);
    expect(after.roles).toEqual([]);
    expect(after.permissions).toEqual([]);
  });
});
