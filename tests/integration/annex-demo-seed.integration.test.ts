import type { GenericMutationCtx } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";

import * as annex from "../../convex/staging/annexDemo";
import schema, { type DataModel } from "../../convex/schema";

const modules = { "../convex/_generated/server.js": () => Promise.resolve({}) };
type Harness = ReturnType<typeof convexTest>;
type RuntimeFunction = {
  _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
};

async function call(world: Harness, fn: unknown, args: unknown) {
  return world.run((ctx) =>
    (fn as RuntimeFunction)._handler(
      ctx as GenericMutationCtx<DataModel>,
      args,
    ),
  );
}

const identity = {
  clerkUserId: "user_local_seed",
  clerkOrganizationId: "org_local_seed",
  displayName: "Local Seed User",
  email: "local.seed@example.com",
  confirmation: "SEED_DEMO_ANNEX_REALISTIC_2026_09",
  allowLocalTestSeed: true as const,
};

async function bootstrap(world: Harness) {
  return call(world, annex.bootstrapLocalDemo, identity);
}

describe("local annex demo seed", () => {
  it("rejects when the local seed environment flag is absent", async () => {
    vi.stubEnv("ALLOW_LOCAL_TEST_SEED", "false");
    const world = convexTest(schema, modules);
    await expect(bootstrap(world)).rejects.toThrow(
      "ALLOW_LOCAL_TEST_SEED=true",
    );
    vi.unstubAllEnvs();
  });

  it("bootstraps an empty database idempotently", async () => {
    vi.stubEnv("ALLOW_LOCAL_TEST_SEED", "true");
    const world = convexTest(schema, modules);
    const first = (await bootstrap(world)) as Record<string, unknown>;
    const second = await bootstrap(world);
    expect(second).toMatchObject({
      organizationId: first.organizationId,
      userId: first.userId,
      warehouseId: first.warehouseId,
      buildingId: first.buildingId,
    });
    const counts = await world.run(async (ctx) => ({
      organizations: (await ctx.db.query("organizations").collect()).length,
      users: (await ctx.db.query("users").collect()).length,
      warehouses: (await ctx.db.query("warehouses").collect()).length,
      buildings: (await ctx.db.query("storageBuildings").collect()).length,
      floors: (await ctx.db.query("storageFloors").collect()).length,
      zones: (await ctx.db.query("storageZones").collect()).length,
    }));
    expect(counts).toEqual({
      organizations: 1,
      users: 1,
      warehouses: 1,
      buildings: 2,
      floors: 3,
      zones: 3,
    });
    vi.unstubAllEnvs();
  });

  it("configures workflow fixtures idempotently and creates a valid stack", async () => {
    vi.stubEnv("ALLOW_LOCAL_TEST_SEED", "true");
    const world = convexTest(schema, modules);
    const seeded = (await bootstrap(world)) as {
      warehouseId: string;
      userId: string;
    };
    const configureArgs = {
      warehouseId: seeded.warehouseId,
      actorUserId: seeded.userId,
      confirmation: identity.confirmation,
    };
    await call(world, annex.configure, configureArgs);
    await call(world, annex.seedWorkflowScenarios, configureArgs);
    await call(world, annex.configure, configureArgs);
    await call(world, annex.seedWorkflowScenarios, configureArgs);
    const rows = await world.run(async (ctx) => ({
      products: await ctx.db.query("finishedGoodsProducts").collect(),
      batches: await ctx.db.query("finishedGoodsBatches").collect(),
      pallets: await ctx.db.query("finishedGoodsPallets").collect(),
      placements: await ctx.db.query("finishedGoodsPlacements").collect(),
      buildings: await ctx.db.query("storageBuildings").collect(),
    }));
    expect(rows.products).toHaveLength(5);
    expect(rows.batches).toHaveLength(2);
    expect(
      rows.pallets.filter((p) => p.code.startsWith("DEMO-R26-STACK-")),
    ).toHaveLength(2);
    expect(
      rows.placements.filter((p) => p.positionCode.includes("STACK")),
    ).toHaveLength(2);
    const upper = rows.placements.find((p) =>
      p.positionCode.endsWith("STACK-UP"),
    );
    const lower = rows.placements.find((p) =>
      p.positionCode.endsWith("STACK-LOW"),
    );
    expect(upper).toMatchObject({
      supportPalletId: lower?.palletId,
      zMm: 1_000,
      status: "STORED",
    });
    expect(rows.buildings.filter((b) => b.code === "LOCAL-DRAFT")).toHaveLength(
      1,
    );
    vi.unstubAllEnvs();
  });
});
