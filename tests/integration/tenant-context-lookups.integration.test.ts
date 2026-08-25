import type { UserIdentity } from "convex/server";
import type { GenericId } from "convex/values";
import { describe, expect, it } from "vitest";

import {
  resolveTenantContext,
  type TenantContextLookups,
  type WarehouseId,
} from "../../convex/lib/tenantContext";
import {
  createConvexTenantContextLookups,
  type TenantContextLookupContext,
} from "../../convex/lib/tenantContextLookups";
import {
  TENANT_DB_ERROR_MESSAGE,
  TenantDbError,
} from "../../convex/lib/tenantDb";
import {
  FIXTURE_REQUEST_ID as REQUEST_ID,
  createConvexTenantWorld,
  seedConvexTenantIdentities,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";

async function withLookups<Result>(
  world: ConvexTenantWorld,
  use: (lookups: TenantContextLookups) => Promise<Result>,
): Promise<Result> {
  return await world.t.run(
    async (ctx) => await use(createConvexTenantContextLookups(ctx, REQUEST_ID)),
  );
}

const id = <Table extends string>(value: string): GenericId<Table> =>
  value as GenericId<Table>;

function guarded<Shape extends object>(shape: Shape): Shape {
  return new Proxy(shape, {
    get: (target, property, receiver): unknown => {
      if (typeof property === "string" && !(property in target)) {
        throw new Error(`Unbounded Convex API reached: ${property}`);
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

function stubDatabase(answer: {
  readonly rows?: unknown;
  readonly document?: unknown;
}): {
  readonly context: TenantContextLookupContext;
  readonly reads: readonly string[];
} {
  const reads: string[] = [];
  const db = guarded({
    normalizeId: (_table: string, value: string): string => value,
    get: (): Promise<unknown> => Promise.resolve(answer.document ?? null),
    query: (table: string) =>
      guarded({
        withIndex: (index: string, range: (q: unknown) => unknown): unknown => {
          const fields: string[] = [];
          const builder: unknown = guarded({
            eq: (field: string): unknown => {
              fields.push(field);
              return builder;
            },
          });
          range(builder);
          return guarded({
            take: (count: number): Promise<unknown> => {
              reads.push(`${table}.${index}(${fields.join(",")})#${count}`);
              return Promise.resolve(answer.rows ?? []);
            },
          });
        },
      }),
  });

  return {
    context: { db: db as unknown as TenantContextLookupContext["db"] },
    reads,
  };
}

/** The rejection of a call that must not resolve. */
async function refusal(call: () => Promise<unknown>): Promise<TenantDbError> {
  const outcome = await call().then(
    () => new Error("The call resolved instead of refusing."),
    (reason: unknown) => reason,
  );
  if (!(outcome instanceof TenantDbError)) {
    throw new Error(`Expected a TenantDbError, received ${String(outcome)}.`);
  }
  return outcome;
}

describe("the Convex tenant-context lookups adapter", () => {
  it("resolves a mirrored user and organization by external key", async () => {
    const world = await createConvexTenantWorld();

    const found = await withLookups(world, async (lookups) => ({
      user: await lookups.findUserByClerkUserId("user_fixture_a"),
      absentUser: await lookups.findUserByClerkUserId("user_absent"),
      org: await lookups.findOrganizationByClerkOrganizationId("org_fixture_a"),
      absentOrg:
        await lookups.findOrganizationByClerkOrganizationId("org_absent"),
    }));

    expect(found.user?._id).toBe(world.userA);
    expect(found.org?._id).toBe(world.orgA);
    expect(found.absentUser).toBeNull();
    expect(found.absentOrg).toBeNull();
  });

  it("keeps two tenants apart when the external membership ID collides", async () => {
    const world = await createConvexTenantWorld();
    const seeded = await seedConvexTenantIdentities(world);

    const found = await withLookups(world, async (lookups) => ({
      inA: await lookups.findMembershipByOrganizationAndUser({
        orgId: world.orgA,
        userId: world.userA,
      }),
      inB: await lookups.findMembershipByOrganizationAndUser({
        orgId: world.orgB,
        userId: world.userA,
      }),
    }));

    expect(found.inA?._id).toBe(seeded.membershipA);
    expect(found.inB?._id).toBe(seeded.membershipB);
    expect(found.inA?.clerkMembershipId).toBe(seeded.sharedClerkMembershipId);
    expect(found.inB?.clerkMembershipId).toBe(seeded.sharedClerkMembershipId);
  });

  it("answers null for every unusable warehouse ID, identically", async () => {
    const world = await createConvexTenantWorld();

    const found = await withLookups(world, async (lookups) => {
      const find = async (orgId: GenericId<"organizations">, value: string) =>
        await lookups.findWarehouseByOrganizationAndId({
          orgId,
          warehouseId: value as WarehouseId,
        });
      return {
        own: await find(world.orgA, world.warehouses.alphaA),
        foreignTenant: await find(world.orgB, world.warehouses.alphaA),
        otherTenantsRow: await find(world.orgA, world.warehouses.alphaB),
        deleted: await find(world.orgA, world.vanishedWarehouse),
        malformed: await find(world.orgA, "not-an-id"),
        otherTable: await find(world.orgA, world.userA),
      };
    });

    expect(found.own?._id).toBe(world.warehouses.alphaA);
    expect(found.foreignTenant).toBeNull();
    expect(found.otherTenantsRow).toBeNull();
    expect(found.deleted).toBeNull();
    expect(found.malformed).toBeNull();
    expect(found.otherTable).toBeNull();
  });

  it("reads a scope row by the full tenant-first triple", async () => {
    const world = await createConvexTenantWorld();
    const seeded = await seedConvexTenantIdentities(world);

    const found = await withLookups(world, async (lookups) => ({
      inA: await lookups.findMembershipWarehouse({
        orgId: world.orgA,
        membershipId: seeded.membershipA,
        warehouseId: world.warehouses.alphaA,
      }),

      inB: await lookups.findMembershipWarehouse({
        orgId: world.orgB,
        membershipId: seeded.membershipA,
        warehouseId: world.warehouses.alphaA,
      }),
      ungranted: await lookups.findMembershipWarehouse({
        orgId: world.orgA,
        membershipId: seeded.membershipA,
        warehouseId: world.warehouses.bravoA,
      }),
    }));

    expect(found.inA?._id).toBe(seeded.scopeA);
    expect(found.inB?._id).toBe(seeded.scopeB);
    expect(found.ungranted).toBeNull();
  });

  it("denies rather than choosing when a by-contract unique key repeats", async () => {
    const world = await createConvexTenantWorld();
    const seeded = await seedConvexTenantIdentities(world);

    await world.t.run(async (ctx) => {
      await ctx.db.insert("users", {
        clerkUserId: "user_fixture_a",
        displayName: "Duplicate A",
        status: "ACTIVE",
      });
      await ctx.db.insert("memberships", {
        orgId: world.orgA,
        userId: world.userA,
        clerkMembershipId: "orgmem_duplicate",
        status: "ACTIVE",
        scopeMode: "ORG_WIDE",
        effectiveFrom: 0,
      });
      await ctx.db.insert("membershipWarehouses", {
        orgId: world.orgA,
        membershipId: seeded.membershipA,
        warehouseId: world.warehouses.alphaA,
      });
    });

    const found = await withLookups(world, async (lookups) => ({
      user: await lookups.findUserByClerkUserId("user_fixture_a"),
      membership: await lookups.findMembershipByOrganizationAndUser({
        orgId: world.orgA,
        userId: world.userA,
      }),
      scope: await lookups.findMembershipWarehouse({
        orgId: world.orgA,
        membershipId: seeded.membershipA,
        warehouseId: world.warehouses.alphaA,
      }),
    }));

    expect(found.user).toBeNull();
    expect(found.membership).toBeNull();
    expect(found.scope).toBeNull();
  });

  it("names every exact index and its equality fields in declared order", async () => {
    const { context, reads } = stubDatabase({ rows: [] });
    const lookups = createConvexTenantContextLookups(context, REQUEST_ID);

    await lookups.findUserByClerkUserId("user_x");
    await lookups.findOrganizationByClerkOrganizationId("org_x");
    await lookups.findMembershipByOrganizationAndUser({
      orgId: id("orgs_x"),
      userId: id("users_x"),
    });
    await lookups.findMembershipWarehouse({
      orgId: id("orgs_x"),
      membershipId: id("memberships_x"),
      warehouseId: id("warehouses_x"),
    });

    expect(reads).toEqual([
      "users.by_clerkUserId(clerkUserId)#2",
      "organizations.by_clerkOrganizationId(clerkOrganizationId)#2",
      "memberships.by_orgId_userId(orgId,userId)#2",
      "membershipWarehouses.by_orgId_membershipId_warehouseId(orgId,membershipId,warehouseId)#2",
    ]);
  });

  it("cannot reach an unbounded Convex API", () => {
    const initializer = stubDatabase({}).context.db.query(
      "users",
    ) as unknown as Record<string, unknown>;

    for (const unbounded of ["filter", "collect", "order", "unique", "first"]) {
      expect(() => initializer[unbounded]).toThrow(/Unbounded Convex API/);
    }
  });

  it("refuses an answer Convex's own types call impossible", async () => {
    const lookups = (answer: Parameters<typeof stubDatabase>[0]) =>
      createConvexTenantContextLookups(
        stubDatabase(answer).context,
        REQUEST_ID,
      );

    for (const call of [
      async () =>
        await lookups({ rows: "two rows, honestly" }).findUserByClerkUserId(
          "user_x",
        ),
      async () => await lookups({ rows: [null] }).findUserByClerkUserId("u"),
      async () =>
        await lookups({
          document: { _id: "warehouses_other", orgId: "orgs_x" },
        }).findWarehouseByOrganizationAndId({
          orgId: id("orgs_x"),
          warehouseId: id("warehouses_x"),
        }),
    ]) {
      const error = await refusal(call);
      expect(error.code).toBe("INVALID_INDEX_RESULT");
      expect(error.requestId).toBe(REQUEST_ID);

      expect(error.message).toBe(TENANT_DB_ERROR_MESSAGE);
    }
  });

  it("feeds the resolver: a context for the owner, a denial for a foreign warehouse", async () => {
    const world = await createConvexTenantWorld();
    await seedConvexTenantIdentities(world);
    const identity = {
      subject: "user_fixture_a",
      org_id: "org_fixture_a",
    } as unknown as UserIdentity;

    const results = await withLookups(world, async (lookups) => ({
      granted: await resolveTenantContext({
        requestId: REQUEST_ID,
        identity,
        warehouseId: world.warehouses.alphaA,
        lookups,
      }),
      foreign: await resolveTenantContext({
        requestId: REQUEST_ID,
        identity,
        warehouseId: world.warehouses.alphaB,
        lookups,
      }),
    }));

    expect(results.granted.ok).toBe(true);
    expect(results.foreign).toEqual({
      ok: false,
      denial: {
        code: "WAREHOUSE_UNKNOWN",
        cause: "WAREHOUSE_LOOKUP_EMPTY",
        requestId: REQUEST_ID,
      },
    });
  });
});
