/**
 * Integration tier — the Convex authorization lookup adapter over `convex-test`.
 *
 * The kernel's suites prove the *decision* re-verifies whatever a lookup answered.
 * This suite proves the answers themselves, because this adapter is the only
 * module in the authorization path allowed to hold a raw database
 * (`scripts/verify-tenant-boundary.mjs`, rule `raw-database`), and what it must be
 * right about is Convex: index field order, `take` bounds, descending order,
 * `normalizeId`, and the difference between "no row" and "two rows under a key
 * that is unique by contract".
 *
 * Each case is stated as a claim about tenancy or about a bound, never about a
 * document's fields — those are the schema's business.
 *
 * All data is synthetic (`tests/fixtures/README.md`).
 */
import { describe, expect, it } from "vitest";

import {
  MEMBERSHIP_ROLE_LIMIT,
  STEP_UP_EVENT_LIMIT,
} from "../../convex/lib/authorization";
import { createConvexAuthorizationLookups } from "../../convex/lib/authorizationLookupsConvex";
import { TenantDbError } from "../../convex/lib/tenantDb";
import {
  createConvexTenantWorld,
  recordDevice,
  recordEntitlement,
  recordStepUp,
  seedConvexAuthorization,
  FIXTURE_REQUEST_ID,
} from "../fixtures/convex-tenant-world";

async function authorizationWorld() {
  const world = await createConvexTenantWorld();
  const seeded = await seedConvexAuthorization(world);
  return { world, seeded };
}

describe("Convex authorization lookups", () => {
  it("resolves a membership only for the tenant and actor asked for", async () => {
    const { world, seeded } = await authorizationWorld();
    const otherUser = await world.t.run(
      async (ctx) =>
        await ctx.db.insert("users", {
          clerkUserId: "user_fixture_other",
          displayName: "Other",
          status: "ACTIVE",
        }),
    );

    const found = await world.t.run(async (ctx) => {
      const lookups = createConvexAuthorizationLookups(ctx, FIXTURE_REQUEST_ID);
      return {
        mine:
          (
            await lookups.findMembership({
              orgId: world.orgA,
              userId: world.userA,
            })
          )?._id ?? null,
        theirs:
          (
            await lookups.findMembership({
              orgId: world.orgB,
              userId: world.userA,
            })
          )?._id ?? null,
        unknownActor:
          (
            await lookups.findMembership({
              orgId: world.orgA,
              userId: otherUser,
            })
          )?._id ?? null,
      };
    });

    expect(found.mine).toBe(seeded.identities.membershipA);
    expect(found.theirs).toBe(seeded.identities.membershipB);
    expect(found.unknownActor).toBeNull();
  });

  it("answers null when a key that is unique by contract has two rows", async () => {
    const { world } = await authorizationWorld();
    // Convex has no unique constraint, so this is storable — and a decision made
    // on "whichever row came first" is how a broken invariant stays invisible.
    await world.t.run(async (ctx) => {
      await ctx.db.insert("memberships", {
        orgId: world.orgA,
        userId: world.userA,
        clerkMembershipId: "orgmem_fixture_duplicate",
        status: "ACTIVE",
        scopeMode: "ORG_WIDE",
        effectiveFrom: 0,
      });
    });

    const found = await world.t.run(
      async (ctx) =>
        (
          await createConvexAuthorizationLookups(
            ctx,
            FIXTURE_REQUEST_ID,
          ).findMembership({ orgId: world.orgA, userId: world.userA })
        )?._id ?? null,
    );
    expect(found).toBeNull();
  });

  it("scopes a role read by tenant, and rejects every unusable ID the same way", async () => {
    const { world, seeded } = await authorizationWorld();
    const roleA = seeded.rolesA.get("SUPERVISOR")!;
    const vanished = await world.t.run(async (ctx) => {
      const id = await ctx.db.insert("roles", {
        orgId: world.orgA,
        key: "TEMPORARY",
        name: "Temporary",
        status: "ACTIVE",
        seeded: false,
      });
      await ctx.db.delete("roles", id);
      return id;
    });

    const found = await world.t.run(async (ctx) => {
      const lookups = createConvexAuthorizationLookups(ctx, FIXTURE_REQUEST_ID);
      return {
        own:
          (await lookups.findRole({ orgId: world.orgA, roleId: roleA }))?._id ??
          null,
        foreignTenant:
          (await lookups.findRole({ orgId: world.orgB, roleId: roleA }))?._id ??
          null,
        deleted:
          (await lookups.findRole({ orgId: world.orgA, roleId: vanished }))
            ?._id ?? null,
        // A well-formed ID of another table, and a string that is no ID at all.
        otherTable:
          (
            await lookups.findRole({
              orgId: world.orgA,
              roleId: world.userA as unknown as typeof roleA,
            })
          )?._id ?? null,
        nonsense:
          (
            await lookups.findRole({
              orgId: world.orgA,
              roleId: "not-an-id" as unknown as typeof roleA,
            })
          )?._id ?? null,
      };
    });

    expect(found.own).toBe(roleA);
    expect(found.foreignTenant).toBeNull();
    expect(found.deleted).toBeNull();
    expect(found.otherTable).toBeNull();
    expect(found.nonsense).toBeNull();
  });

  it("reads a grant as an exact triple, per tenant", async () => {
    const { world, seeded } = await authorizationWorld();
    const roleA = seeded.rolesA.get("SUPERVISOR")!;

    const found = await world.t.run(async (ctx) => {
      const lookups = createConvexAuthorizationLookups(ctx, FIXTURE_REQUEST_ID);
      const read = async (
        orgId: typeof world.orgA,
        permissionCode: string,
      ): Promise<string | null> =>
        (
          await lookups.findRolePermission({
            orgId,
            roleId: roleA,
            permissionCode,
          })
        )?.permissionCode ?? null;
      return {
        granted: await read(world.orgA, "receiving.receipt.post"),
        ungranted: await read(world.orgA, "admin.device.manage"),
        // The same role and code, asked for under the other tenant.
        foreign: await read(world.orgB, "receiving.receipt.post"),
      };
    });

    expect(found.granted).toBe("receiving.receipt.post");
    expect(found.ungranted).toBeNull();
    expect(found.foreign).toBeNull();
  });

  it("bounds every list read and refuses a page size outside the contract", async () => {
    const { world, seeded } = await authorizationWorld();

    const refusals = await world.t.run(async (ctx) => {
      const lookups = createConvexAuthorizationLookups(ctx, FIXTURE_REQUEST_ID);
      const codeOf = async (limit: number): Promise<string> => {
        try {
          await lookups.listMembershipRoles({
            orgId: world.orgA,
            membershipId: seeded.identities.membershipA,
            limit,
          });
          return "no-error";
        } catch (error) {
          return error instanceof TenantDbError ? error.code : "other";
        }
      };
      return {
        zero: await codeOf(0),
        overBound: await codeOf(MEMBERSHIP_ROLE_LIMIT + 1),
        fractional: await codeOf(1.5),
        atBound: await codeOf(MEMBERSHIP_ROLE_LIMIT),
      };
    });

    expect(refusals).toEqual({
      zero: "INVALID_LIMIT",
      overBound: "INVALID_LIMIT",
      fractional: "INVALID_LIMIT",
      atBound: "no-error",
    });
  });

  it("returns this tenant's session events newest first, inside the window", async () => {
    const { world } = await authorizationWorld();
    const now = 1_800_000_000_000;
    for (const [offset, orgId] of [
      [-30_000, world.orgA],
      [-10_000, world.orgA],
      [-20_000, world.orgA],
      [-5_000, world.orgB],
    ] as const) {
      await recordStepUp(world, {
        orgId,
        userId: world.userA,
        occurredAt: now + offset,
        reverifiedAt: now + offset,
      });
    }

    const read = await world.t.run(async (ctx) => {
      const lookups = createConvexAuthorizationLookups(ctx, FIXTURE_REQUEST_ID);
      const events = await lookups.listRecentSessionEvents({
        orgId: world.orgA,
        userId: world.userA,
        notBefore: now - 25_000,
        limit: STEP_UP_EVENT_LIMIT,
      });
      return {
        occurredAt: events.map((event) => event.occurredAt),
        orgIds: [...new Set(events.map((event) => event.orgId))],
      };
    });

    // Newest first, the row outside the window excluded, the other tenant's row
    // never in range at all.
    expect(read.occurredAt).toEqual([now - 10_000, now - 20_000]);
    expect(read.orgIds).toEqual([world.orgA]);
  });

  it("resolves an entitlement and a device by exact key within the tenant", async () => {
    const { world } = await authorizationWorld();
    await recordEntitlement(world, {
      orgId: world.orgA,
      key: "SERIAL_TRACKING",
      enabled: true,
    });
    const deviceA = await recordDevice(world, {
      orgId: world.orgA,
      installationId: "install-a",
    });
    await recordDevice(world, {
      orgId: world.orgB,
      installationId: "install-b",
    });

    const found = await world.t.run(async (ctx) => {
      const lookups = createConvexAuthorizationLookups(ctx, FIXTURE_REQUEST_ID);
      return {
        entitlement:
          (
            await lookups.findEntitlement({
              orgId: world.orgA,
              key: "SERIAL_TRACKING",
            })
          )?.enabled ?? null,
        entitlementForeign:
          (
            await lookups.findEntitlement({
              orgId: world.orgB,
              key: "SERIAL_TRACKING",
            })
          )?.enabled ?? null,
        entitlementOtherKey:
          (await lookups.findEntitlement({ orgId: world.orgA, key: "OTHER" }))
            ?.enabled ?? null,
        device:
          (
            await lookups.findDeviceByInstallationId({
              orgId: world.orgA,
              installationId: "install-a",
            })
          )?._id ?? null,
        deviceForeign:
          (
            await lookups.findDeviceByInstallationId({
              orgId: world.orgA,
              installationId: "install-b",
            })
          )?._id ?? null,
      };
    });

    expect(found).toEqual({
      entitlement: true,
      entitlementForeign: null,
      entitlementOtherKey: null,
      device: deviceA,
      deviceForeign: null,
    });
  });
});
