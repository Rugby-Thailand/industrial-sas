import { describe, expect, it } from "vitest";
import type { GenericMutationCtx } from "convex/server";
import type { DataModel } from "../../convex/schema";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";
import { measured } from "../fixtures/query-read-stats";
import {
  buildingOccupancy,
  getStorageBuildingInventory,
} from "../../convex/storageLayouts/catalogue";
import {
  invalidate as invalidateZoneOccupancyMutation,
  run as backfillZoneOccupancy,
} from "../../convex/storageLayouts/zoneOccupancyBackfill";
import { MAX_ZONE_OCCUPANCY_ENTRIES } from "../../convex/lib/zoneOccupancy";
import {
  createStorageBuilding,
  activateStorageBuilding,
} from "../../convex/storageLayouts/writes";
import { createStorageZone } from "../../convex/storageLayouts/zones";
import { backfillBuildingIndexes } from "../../convex/finishedGoods/moveBuildingMigration";
import {
  cancelReservation,
  confirmStored,
  recommend,
  reserve,
  completeMove,
  recommendMove,
  reserveMove,
  saveStackingLimits,
  startMove,
  verifyDestination,
  verifyMoveDestination,
} from "../../convex/finishedGoods/workflow";
import type { ReadStats } from "../fixtures/query-read-stats";

async function call(world: ConvexTenantWorld, fn: unknown, args: unknown) {
  return world.t
    .withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_a" })
    .run(async (ctx) => {
      const result = await (
        fn as {
          _handler(
            ctx: GenericMutationCtx<DataModel>,
            args: unknown,
          ): Promise<{ ok: boolean; value: unknown }>;
        }
      )._handler(ctx, args);
      expect(result.ok, JSON.stringify(result)).toBe(true);
      return result.value;
    });
}
function fields<T extends { _id: unknown; _creationTime: number }>(
  doc: T,
): Omit<T, "_id" | "_creationTime"> {
  const { _id, _creationTime, ...rest } = doc;
  void _id;
  void _creationTime;
  return rest;
}
async function scaleWorld(limits = true) {
  const world = await createConvexTenantWorld(
    {},
    { transactionLimits: limits },
  );
  await seedConvexAuthorization(world, {
    roleA: "ORG_ADMIN",
    roleB: "ORG_ADMIN",
  });
  const warehouseId = world.warehouses.alphaA;
  await call(world, createStorageBuilding, {
    warehouseId,
    requestId: "building",
    code: "SCALE",
    name: "Scale",
    widthMm: 10000,
    depthMm: 10000,
    defaultFloorHeightMm: 4000,
    floorCount: 1,
  });
  const building = await world.t.run(
    async (ctx) => (await ctx.db.query("storageBuildings").collect())[0]!,
  );
  await call(world, createStorageZone, {
    warehouseId,
    buildingId: building._id,
    floorNumber: 1,
    requestId: "zone",
    label: "ZONE",
    storageCondition: "DRY",
    mode: "SIMPLE",
    xMm: 0,
    yMm: 0,
    widthMm: 6000,
    depthMm: 6000,
    maxStackHeightMm: 4000,
  });
  await call(world, activateStorageBuilding, {
    warehouseId,
    buildingId: building._id,
    requestId: "activate",
    expectedVersion: 1,
  });
  const data = await world.t.run(async (ctx) => {
    const zone = (await ctx.db.query("storageZones").collect())[0]!;
    const location = (await ctx.db.get(zone.locationId))!;
    const audit = {
      orgId: world.orgA,
      warehouseId,
      createdAt: 1,
      updatedAt: 1,
      createdByUserId: world.userA,
      updatedByUserId: world.userA,
    };
    const productId = await ctx.db.insert("finishedGoodsProducts", {
      ...audit,
      sku: "SKU",
      name: "Boxes",
      unit: "pieces",
      storageFormat: "PALLET",
      storageCondition: "DRY",
      status: "ACTIVE",
    });
    const palletId = await ctx.db.insert("finishedGoodsPallets", {
      ...audit,
      productId,
      code: "PAL-0",
      quantity: 1,
      lengthMm: 1000,
      widthMm: 1000,
      heightMm: 1000,
      status: "STORED",
    });
    return { zone, location, audit, productId, palletId };
  });
  return { world, warehouseId, building, ...data };
}
async function addPallets(
  seed: Awaited<ReturnType<typeof scaleWorld>>,
  count: number,
  distinctProducts = false,
) {
  for (let start = 0; start < count; start += 250)
    await seed.world.t.run(async (ctx) => {
      for (let i = start; i < Math.min(start + 250, count); i++) {
        const productId =
          distinctProducts && i !== 0
            ? await ctx.db.insert("finishedGoodsProducts", {
                ...seed.audit,
                sku: `SKU-${i}`,
                name: `Product ${i}`,
                unit: "pieces",
                storageFormat: "PALLET",
                storageCondition: "DRY",
                status: "ACTIVE",
              })
            : seed.productId;
        const palletId =
          i === 0
            ? seed.palletId
            : await ctx.db.insert("finishedGoodsPallets", {
                ...seed.audit,
                productId,
                code: `PAL-${i}`,
                quantity: 1,
                lengthMm: 1000,
                widthMm: 1000,
                heightMm: 1000,
                status: "STORED",
              });
        await ctx.db.insert("finishedGoodsPlacements", {
          ...seed.audit,
          palletId,
          buildingId: seed.building._id,
          floorId: seed.zone.floorId,
          zoneId: seed.zone._id,
          locationId: seed.zone.locationId,
          positionCode: `POS-${i}`,
          qrValue: `QR-${i}`,
          xMm: i,
          yMm: 0,
          zMm: 0,
          widthMm: 1000,
          depthMm: 1000,
          heightMm: 1000,
          rotation: 0,
          status: "STORED",
        });
      }
    });
}
async function addZones(
  seed: Awaited<ReturnType<typeof scaleWorld>>,
  count: number,
) {
  for (let start = 1; start < count; start += 250)
    await seed.world.t.run(async (ctx) => {
      for (let i = start; i < Math.min(start + 250, count); i++) {
        const locationId = await ctx.db.insert("locations", {
          ...fields(seed.location),
          code: `L-${i}`,
        });
        await ctx.db.insert("storageZones", {
          ...fields(seed.zone),
          locationId,
          code: `Z-${String(i).padStart(4, "0")}`,
          storageCondition: i < 1100 ? "COLD" : "DRY",
        });
      }
    });
}
describe("storage query scale envelope", () => {
  it.each([false, true])(
    "returns all 1500 held pallets within transaction limits (distinct products=%s)",
    async (distinctProducts) => {
      const seed = await scaleWorld();
      await addPallets(seed, 1500, distinctProducts);
      const result = await measured<{
        found: boolean;
        zones: { placements: unknown[] }[];
      }>(seed.world, getStorageBuildingInventory, {
        warehouseId: seed.warehouseId,
        buildingId: seed.building._id,
      });
      expect(result.value.found).toBe(true);
      expect(
        result.value.zones.flatMap((zone) => zone.placements),
      ).toHaveLength(1500);
      expect(result.stats.ranges["finishedGoodsMoves"]).toBe(6);
      expect(result.stats.gets["finishedGoodsProducts"]).toBe(
        distinctProducts ? 1500 : 1,
      );
    },
    30000,
  );
  it("ranks every compatible candidate among 1200 zones within transaction limits", async () => {
    const seed = await scaleWorld();
    await addZones(seed, 1200);
    const result = await measured<{ candidates: unknown[]; reasons: string[] }>(
      seed.world,
      recommend,
      { warehouseId: seed.warehouseId, palletId: seed.palletId },
    );
    expect(result.value.candidates).toHaveLength(101);
    expect(result.value.reasons).toEqual([]);
  }, 30000);
});

type Inventory = {
  found: boolean;
  zones: {
    placements: {
      placementId: string;
      moveRole?: string;
      moveState?: string;
    }[];
    locationOnlyPlacements: unknown[];
    palletCount: number;
  }[];
};
const inventory = (
  seed: Awaited<ReturnType<typeof scaleWorld>>,
  buildingId = seed.building._id,
) =>
  measured<Inventory>(seed.world, getStorageBuildingInventory, {
    warehouseId: seed.warehouseId,
    buildingId,
  });
async function migrate(
  seed: Awaited<ReturnType<typeof scaleWorld>>,
  args: { cursor?: string; dryRun?: boolean; batchSize?: number } = {},
) {
  return seed.world.t.run((ctx) =>
    (
      backfillBuildingIndexes as unknown as {
        _handler(
          ctx: GenericMutationCtx<DataModel>,
          args: unknown,
        ): Promise<{
          updated: number;
          pending: number;
          invalidMoveIds: string[];
          isDone: boolean;
          continueCursor: string;
          hasLegacyActiveMoves: boolean;
        }>;
      }
    )._handler(ctx, {
      orgId: seed.world.orgA,
      warehouseId: seed.warehouseId,
      ...args,
    }),
  );
}
async function crossBuildingMove(seed: Awaited<ReturnType<typeof scaleWorld>>) {
  await addPallets(seed, 1);
  return seed.world.t.run(async (ctx) => {
    const source = (
      await ctx.db.query("finishedGoodsPlacements").collect()
    )[0]!;
    if (source.mode === "LOCATION_ONLY")
      throw new Error("Expected geometric source");
    const buildingId = await ctx.db.insert("storageBuildings", {
      ...fields(seed.building),
      code: "OTHER",
      status: "ACTIVE",
    });
    const floor = (await ctx.db.get(seed.zone.floorId))!;
    const floorId = await ctx.db.insert("storageFloors", {
      ...fields(floor),
      buildingId,
    });
    const locationId = await ctx.db.insert("locations", {
      ...fields(seed.location),
      code: "OTHER-ZONE",
    });
    const zoneId = await ctx.db.insert("storageZones", {
      ...fields(seed.zone),
      buildingId,
      floorId,
      locationId,
      code: "OTHER-ZONE",
    });
    const targetId = await ctx.db.insert("finishedGoodsPlacements", {
      ...fields(source),
      buildingId,
      floorId,
      zoneId,
      locationId,
      status: "RESERVED",
      positionCode: "TARGET",
    });
    const moveId = await ctx.db.insert("finishedGoodsMoves", {
      ...seed.audit,
      palletId: seed.palletId,
      sourcePlacementId: source._id,
      targetPlacementId: targetId,
      sourceUpdatedAt: 1,
      targetUpdatedAt: 1,
      palletUpdatedAt: 1,
      ownerUserId: seed.world.userA,
      status: "IN_TRANSIT",
    });
    return { buildingId, moveId, source, targetId };
  });
}
describe("building move index rollout", () => {
  it("preserves cross-building source and target holds before, during and after resumable backfill", async () => {
    const seed = await scaleWorld();
    const move = await crossBuildingMove(seed);
    // Indexed and legacy rows coexist, including a same-building source/target.
    await seed.world.t.run(async (ctx) => {
      const palletId = await ctx.db.insert("finishedGoodsPallets", {
        ...fields((await ctx.db.get(seed.palletId))!),
        code: "SECOND",
      });
      const sourceId = await ctx.db.insert("finishedGoodsPlacements", {
        ...fields(move.source),
        palletId,
        positionCode: "SECOND-SOURCE",
      });
      const targetId = await ctx.db.insert("finishedGoodsPlacements", {
        ...fields(move.source),
        palletId,
        status: "RESERVED",
        positionCode: "SECOND-TARGET",
      });
      await ctx.db.insert("finishedGoodsMoves", {
        ...seed.audit,
        palletId,
        sourcePlacementId: sourceId,
        targetPlacementId: targetId,
        sourceUpdatedAt: 1,
        targetUpdatedAt: 1,
        palletUpdatedAt: 1,
        ownerUserId: seed.world.userA,
        status: "RESERVED",
        sourceBuildingId: seed.building._id,
        targetBuildingId: seed.building._id,
        buildingIndexVersion: 1,
      });
    });
    const before = await inventory(seed);
    const targetBefore = await inventory(seed, move.buildingId);
    expect(
      before.value.zones.flatMap((z) => z.placements).map((p) => p.moveRole),
    ).toEqual(["TARGET", "SOURCE", "SOURCE"]);
    expect(targetBefore.value.zones.flatMap((z) => z.placements)).toMatchObject(
      [{ moveRole: "TARGET", moveState: "IN_TRANSIT" }],
    );
    const dry = await migrate(seed, { dryRun: true, batchSize: 1 });
    expect(dry.updated).toBe(0);
    expect(dry.hasLegacyActiveMoves).toBe(true);
    let page = await migrate(seed, { batchSize: 1 });
    expect((await inventory(seed)).value).toEqual(before.value);
    while (!page.isDone)
      page = await migrate(seed, { batchSize: 1, cursor: page.continueCursor });
    expect(page.hasLegacyActiveMoves).toBe(false);
    expect((await inventory(seed)).value).toEqual(before.value);
    expect((await inventory(seed, move.buildingId)).value).toEqual(
      targetBefore.value,
    );
    const verified = await migrate(seed, { dryRun: true });
    expect(verified).toMatchObject({
      updated: 0,
      pending: 0,
      invalidMoveIds: [],
      hasLegacyActiveMoves: false,
      isDone: true,
    });
    expect(
      (await inventory(seed, move.buildingId)).stats.rangeDocs[
        "finishedGoodsMoves"
      ],
    ).toBe(1);
  });
  it("repairs stale building metadata and refuses to certify malformed or foreign placement links", async () => {
    const seed = await scaleWorld();
    const move = await crossBuildingMove(seed);
    await seed.world.t.run((ctx) =>
      ctx.db.patch(move.moveId, {
        sourceBuildingId: move.buildingId,
        targetBuildingId: seed.building._id,
        buildingIndexVersion: 1,
      }),
    );
    expect(await migrate(seed, { dryRun: true })).toMatchObject({
      pending: 1,
      updated: 0,
    });
    expect(await migrate(seed)).toMatchObject({ pending: 1, updated: 1 });
    expect((await inventory(seed)).value.zones[0]!.placements[0]).toMatchObject(
      { moveRole: "SOURCE" },
    );
    await seed.world.t.run((ctx) =>
      ctx.db.patch(move.targetId, { orgId: seed.world.orgB }),
    );
    expect(await migrate(seed)).toMatchObject({
      invalidMoveIds: [move.moveId],
      hasLegacyActiveMoves: true,
    });
    expect(
      await seed.world.t.run((ctx) => ctx.db.get(move.moveId)),
    ).toMatchObject({
      sourceBuildingId: seed.building._id,
      targetBuildingId: move.buildingId,
    });
    expect(
      (await seed.world.t.run((ctx) => ctx.db.get(move.moveId)))!
        .buildingIndexVersion,
    ).toBeUndefined();
  });
});

async function addLocationOnly(
  seed: Awaited<ReturnType<typeof scaleWorld>>,
  zone: typeof seed.zone,
) {
  await seed.world.t.run(async (ctx) => {
    const assignmentId = await ctx.db.insert("finishedGoodsScanAssignments", {
      orgId: seed.world.orgA,
      warehouseId: seed.warehouseId,
      requestId: "unknown",
      orderedUnitIds: [seed.palletId],
      placementIds: [],
      sameSize: true,
      fillPercents: [100],
      zoneId: zone._id,
      locationId: zone.locationId,
      buildingId: zone.buildingId,
      floorId: zone.floorId,
      locationCode: zone.code,
      locationName: zone.label,
      locationVersion: "1",
      verificationMethod: "MANUAL",
      verifiedCode: zone.code,
      createdAt: 1,
      createdByUserId: seed.world.userA,
    });
    const placementId = await ctx.db.insert("finishedGoodsPlacements", {
      ...seed.audit,
      palletId: seed.palletId,
      zoneId: zone._id,
      locationId: zone.locationId,
      buildingId: zone.buildingId,
      floorId: zone.floorId,
      positionCode: "UNKNOWN",
      qrValue: "UNKNOWN",
      status: "STORED",
      mode: "LOCATION_ONLY",
      assignmentId,
      sequence: 0,
    });
    await ctx.db.patch(assignmentId, { placementIds: [placementId] });
  });
}
describe("recommendation reason and ranking parity", () => {
  it.each([false, true])(
    "preserves ordered reasons and geometry-unknown precedence (unknown first=%s)",
    async (unknownFirst) => {
      const seed = await scaleWorld();
      await addZones(seed, 2);
      const zones = await seed.world.t.run(async (ctx) => {
        await ctx.db.patch(seed.zone._id, { storageCondition: "COLD" });
        return ctx.db.query("storageZones").collect();
      });
      await addLocationOnly(seed, zones[unknownFirst ? 0 : 1]!);
      const result = await measured<{
        candidates: unknown[];
        reasons: string[];
      }>(seed.world, recommend, {
        warehouseId: seed.warehouseId,
        palletId: seed.palletId,
      });
      expect(result.value).toMatchObject({
        candidates: [],
        reasons: unknownFirst
          ? ["LOCATION_GEOMETRY_UNKNOWN", "STORAGE_CONDITION_MISMATCH"]
          : ["STORAGE_CONDITION_MISMATCH", "LOCATION_GEOMETRY_UNKNOWN"],
      });
      expect(result.stats.ranges["storagePositions"] ?? 0).toBe(0);
      const contents = await inventory(seed);
      expect(
        contents.value.zones.flatMap((z) => z.locationOnlyPlacements),
      ).toHaveLength(1);
      expect(contents.value.zones[0]!.placements).toEqual([]);
    },
  );
  it("ranks exact matches before ANY and unknown conditions and ignores inactive parents", async () => {
    const seed = await scaleWorld();
    await addZones(seed, 4);
    const zones = await seed.world.t.run(async (ctx) => {
      const zones = await ctx.db.query("storageZones").collect();
      await ctx.db.patch(zones[0]!._id, { storageCondition: "ANY" });
      await ctx.db.patch(zones[1]!._id, { storageCondition: " DRY " });
      await ctx.db.patch(zones[2]!._id, { storageCondition: "" });
      await ctx.db.patch(zones[3]!.locationId, { status: "INACTIVE" });
      return zones;
    });
    const result = await measured<{
      candidates: { zoneId: string; storageConditionCheck: string }[];
      reasons: string[];
    }>(seed.world, recommend, {
      warehouseId: seed.warehouseId,
      palletId: seed.palletId,
    });
    expect(result.value.candidates.map((c) => c.zoneId)).toEqual([
      zones[1]!._id,
      zones[0]!._id,
      zones[2]!._id,
    ]);
    expect(result.value.reasons).toEqual([]);
    // Archived parents do not contribute a mismatch reason.
    await seed.world.t.run(async (ctx) => {
      await ctx.db.patch(seed.building._id, { status: "ARCHIVED" });
    });
    expect(
      (
        await measured(seed.world, recommend, {
          warehouseId: seed.warehouseId,
          palletId: seed.palletId,
        })
      ).value,
    ).toMatchObject({ candidates: [], reasons: ["NO_ACTIVE_LOCATIONS"] });
  });
});

describe("recommendation read budget", () => {
  it("never reads zones of draft buildings and keeps the active result identical", async () => {
    const seed = await scaleWorld();
    await addZones(seed, 3);
    const before = await measured<{ candidates: unknown[]; reasons: string[] }>(
      seed.world,
      recommend,
      { warehouseId: seed.warehouseId, palletId: seed.palletId },
    );
    // 60 zones in a draft building in the same warehouse: none can be a candidate.
    await seed.world.t.run(async (ctx) => {
      const buildingId = await ctx.db.insert("storageBuildings", {
        ...fields(seed.building),
        code: "DRAFT",
        status: "DRAFT",
      });
      for (let i = 0; i < 60; i++) {
        const locationId = await ctx.db.insert("locations", {
          ...fields(seed.location),
          code: `DRAFT-L-${i}`,
        });
        await ctx.db.insert("storageZones", {
          ...fields(seed.zone),
          buildingId,
          locationId,
          code: `A-DRAFT-${String(i).padStart(2, "0")}`,
        });
      }
    });
    const after = await measured<{ candidates: unknown[]; reasons: string[] }>(
      seed.world,
      recommend,
      { warehouseId: seed.warehouseId, palletId: seed.palletId },
    );
    expect(after.value).toEqual(before.value);
    expect(after.stats.rangeDocs["storageZones"]).toBe(
      before.stats.rangeDocs["storageZones"],
    );
    expect(after.stats.gets["locations"] ?? 0).toBe(
      before.stats.gets["locations"] ?? 0,
    );
  });

  it("checks the placed pallet once, not once per pallet support", async () => {
    const seed = await scaleWorld();
    await addPallets(seed, 200);
    // Link pallets to their placements, as real STORED pallets are.
    await seed.world.t.run(async (ctx) => {
      for (const placement of await ctx.db
        .query("finishedGoodsPlacements")
        .collect())
        await ctx.db.patch(placement.palletId, { placementId: placement._id });
    });
    const upperId = await seed.world.t.run((ctx) =>
      ctx.db.insert("finishedGoodsPallets", {
        ...seed.audit,
        productId: seed.productId,
        code: "PAL-UPPER",
        quantity: 1,
        lengthMm: 1000,
        widthMm: 1000,
        heightMm: 1000,
        status: "AWAITING_PLACEMENT",
      }),
    );
    const result = await measured<{
      candidates: unknown[];
      previewCandidates: { previewSupports: { blockedReason?: string }[] }[];
      reasons: string[];
    }>(seed.world, recommend, {
      warehouseId: seed.warehouseId,
      palletId: upperId,
    });
    // Every stored pallet is offered as a (blocked) support surface.
    const supports = [
      ...result.value.candidates,
      ...result.value.previewCandidates,
    ].flatMap(
      (candidate) =>
        (candidate as { previewSupports: { blockedReason?: string }[] })
          .previewSupports,
    );
    expect(supports.filter((s) => s.blockedReason).length).toBeGreaterThan(0);
    // One product read for the request plus one shared stack-format read,
    // and each lower pallet read once, however many supports exist.
    expect(result.stats.gets["finishedGoodsProducts"]).toBeLessThanOrEqual(2);
    expect(result.stats.gets["finishedGoodsPallets"]).toBeLessThanOrEqual(
      200 + 1,
    );
  }, 30000);
});

type ScaleSeed = Awaited<ReturnType<typeof scaleWorld>>;
async function backfillOccupancy(seed: ScaleSeed) {
  let cursor: string | undefined;
  for (let batch = 0; batch < 100; batch++) {
    const result = await seed.world.t.run((ctx) =>
      (
        backfillZoneOccupancy as unknown as {
          _handler(
            ctx: GenericMutationCtx<DataModel>,
            args: unknown,
          ): Promise<{
            isDone: boolean;
            ready: boolean;
            continueCursor: string;
          }>;
        }
      )._handler(ctx, {
        warehouseId: seed.warehouseId,
        ...(cursor ? { cursor } : { restart: true }),
        batchSize: 2,
      }),
    );
    if (result.isDone) return result;
    cursor = result.continueCursor;
  }
  throw new Error("backfill did not finish");
}
async function setOccupancyReady(seed: ScaleSeed, ready: boolean) {
  await seed.world.t.run(async (ctx) => {
    const row = (
      await ctx.db.query("storageZoneOccupancyReadiness").collect()
    )[0]!;
    await ctx.db.patch(row._id, { ready });
  });
}
const documents = (stats: ReadStats) =>
  [stats.rangeDocs, stats.gets]
    .flatMap((counts) => Object.values(counts))
    .reduce((sum, count) => sum + count, 0);
async function occupancyReaders(seed: ScaleSeed, palletId: string) {
  const building = {
    warehouseId: seed.warehouseId,
    buildingId: seed.building._id,
  };
  const recommendation = await measured(seed.world, recommend, {
    warehouseId: seed.warehouseId,
    palletId,
  });
  const inventory = await measured(
    seed.world,
    getStorageBuildingInventory,
    building,
  );
  const occupancy = await measured(seed.world, buildingOccupancy, building);
  return {
    values: {
      recommendation: recommendation.value,
      inventory: inventory.value,
      occupancy: occupancy.value,
    },
    docs: {
      recommendation: documents(recommendation.stats),
      inventory: documents(inventory.stats),
      occupancy: documents(occupancy.stats),
    },
  };
}
/** Same snapshot, authoritative reads versus derived rows: outputs must be identical. */
async function expectOccupancyParity(seed: ScaleSeed, palletId: string) {
  await setOccupancyReady(seed, false);
  const raw = await occupancyReaders(seed, palletId);
  await setOccupancyReady(seed, true);
  const derived = await occupancyReaders(seed, palletId);
  expect(derived.values).toEqual(raw.values);
  return { raw, derived };
}
async function measuredPallet(
  seed: ScaleSeed,
  code: string,
  status: "AWAITING_PLACEMENT" = "AWAITING_PLACEMENT",
) {
  return seed.world.t.run((ctx) =>
    ctx.db.insert("finishedGoodsPallets", {
      ...seed.audit,
      productId: seed.productId,
      code,
      quantity: 1,
      lengthMm: 1000,
      widthMm: 1000,
      heightMm: 1000,
      status,
    }),
  );
}
async function linkPlacements(seed: ScaleSeed) {
  await seed.world.t.run(async (ctx) => {
    for (const placement of await ctx.db
      .query("finishedGoodsPlacements")
      .collect())
      await ctx.db.patch(placement.palletId, { placementId: placement._id });
  });
}
const accepted = (result: unknown) => {
  expect(result, JSON.stringify(result)).not.toHaveProperty("error");
  return result as Record<string, unknown>;
};
type Recommended = {
  candidates: {
    zoneId: string;
    xMm: number;
    yMm: number;
    rotation: 0 | 90;
    supportPositionId?: string;
    supportPalletId?: string;
  }[];
};
async function reserveFirst(
  seed: ScaleSeed,
  palletId: string,
  requestId: string,
) {
  const { value } = await measured<Recommended>(seed.world, recommend, {
    warehouseId: seed.warehouseId,
    palletId,
  });
  const target = value.candidates[0]!;
  accepted(
    await call(seed.world, reserve, {
      warehouseId: seed.warehouseId,
      palletId,
      requestId,
      zoneId: target.zoneId,
      xMm: target.xMm,
      yMm: target.yMm,
      rotation: target.rotation,
      ...(target.supportPositionId
        ? { supportPositionId: target.supportPositionId }
        : {}),
      ...(target.supportPalletId
        ? { supportPalletId: target.supportPalletId }
        : {}),
    }),
  );
}

describe("derived zone occupancy", () => {
  it("matches authoritative reads after backfill and after every tracked write", async () => {
    const seed = await scaleWorld();
    await addZones(seed, 3);
    await addPallets(seed, 30);
    await linkPlacements(seed);
    const zones = await seed.world.t.run((ctx) =>
      ctx.db.query("storageZones").collect(),
    );
    await addLocationOnly(seed, zones[1]!);
    const upper = await measuredPallet(seed, "PAL-UPPER");
    const other = await measuredPallet(seed, "PAL-OTHER");
    expect((await backfillOccupancy(seed)).ready).toBe(true);

    const first = await expectOccupancyParity(seed, upper);
    expect(first.derived.docs.recommendation).toBeLessThan(
      first.raw.docs.recommendation,
    );
    expect(first.derived.docs.inventory).toBeLessThan(first.raw.docs.inventory);
    expect(first.derived.docs.occupancy).toBeLessThan(first.raw.docs.occupancy);

    // Each tracked write keeps the derived rows exact (incremental path).
    await reserveFirst(seed, upper, "reserve-upper");
    await expectOccupancyParity(seed, other);
    const qrValue = await seed.world.t.run(async (ctx) => {
      const pallet = (await ctx.db.get(upper))!;
      return (await ctx.db.get(pallet.placementId!))!.qrValue;
    });
    accepted(
      await call(seed.world, verifyDestination, {
        warehouseId: seed.warehouseId,
        palletId: upper,
        requestId: "verify-upper",
        code: qrValue,
        method: "MANUAL",
      }),
    );
    await expectOccupancyParity(seed, other);
    accepted(
      await call(seed.world, confirmStored, {
        warehouseId: seed.warehouseId,
        palletId: upper,
        requestId: "confirm-upper",
        physicalConfirmed: true,
      }),
    );
    await expectOccupancyParity(seed, other);
    await reserveFirst(seed, other, "reserve-other");
    await expectOccupancyParity(seed, upper);
    accepted(
      await call(seed.world, cancelReservation, {
        warehouseId: seed.warehouseId,
        palletId: other,
        requestId: "cancel-other",
      }),
    );
    await expectOccupancyParity(seed, other);
    // A pallet-only change refreshes the facts held on its placement's zone.
    accepted(
      await call(seed.world, saveStackingLimits, {
        warehouseId: seed.warehouseId,
        palletId: upper,
        requestId: "stack-upper",
        stackable: true,
        maxStackLevels: 3,
        expectedStackable: false,
      }),
    );
    const last = await expectOccupancyParity(seed, other);
    expect(
      (
        last.derived.values.recommendation as {
          candidates: { supportPalletId?: string }[];
        }
      ).candidates.some((candidate) => candidate.supportPalletId === upper),
    ).toBe(true);
  }, 60000);

  it("stays exact while a move holds a source and a target in two zones", async () => {
    const seed = await scaleWorld();
    await addZones(seed, 2);
    const target = await seed.world.t.run(async (ctx) => {
      const zone = (await ctx.db.query("storageZones").collect())[1]!;
      await ctx.db.patch(zone._id, { storageCondition: "DRY" });
      return zone;
    });
    await addPallets(seed, 5);
    await linkPlacements(seed);
    const probe = await measuredPallet(seed, "PAL-PROBE");
    const moving = await seed.world.t.run(async (ctx) =>
      (await ctx.db.query("finishedGoodsPallets").collect()).find(
        (pallet) => pallet.code === "PAL-4",
      )!,
    );
    expect((await backfillOccupancy(seed)).ready).toBe(true);
    await expectOccupancyParity(seed, probe);
    const { value } = await measured<Recommended>(seed.world, recommendMove, {
      warehouseId: seed.warehouseId,
      palletId: moving._id,
    });
    const destination = value.candidates.find((c) => c.zoneId === target._id)!;
    const base = { warehouseId: seed.warehouseId, palletId: moving._id };
    accepted(
      await call(seed.world, reserveMove, {
        ...base,
        requestId: "move-reserve",
        zoneId: destination.zoneId,
        xMm: destination.xMm,
        yMm: destination.yMm,
        rotation: destination.rotation,
        expectedSourcePlacementId: moving.placementId,
      }),
    );
    await expectOccupancyParity(seed, probe);
    const move = await seed.world.t.run(
      async (ctx) => (await ctx.db.query("finishedGoodsMoves").collect())[0]!,
    );
    accepted(
      await call(seed.world, startMove, {
        ...base,
        requestId: "move-start",
        moveId: move._id,
        confirmationMethod: "ACKNOWLEDGEMENT",
        physicalConfirmed: true,
      }),
    );
    await expectOccupancyParity(seed, probe);
    const targetQr = await seed.world.t.run(
      async (ctx) => (await ctx.db.get(move.targetPlacementId))!.qrValue,
    );
    accepted(
      await call(seed.world, verifyMoveDestination, {
        ...base,
        requestId: "move-verify",
        moveId: move._id,
        code: targetQr,
        method: "MANUAL",
      }),
    );
    accepted(
      await call(seed.world, completeMove, {
        ...base,
        requestId: "move-complete",
        moveId: move._id,
        physicalConfirmed: true,
      }),
    );
    const done = await expectOccupancyParity(seed, probe);
    expect(
      (
        done.derived.values.inventory as { zones: { zoneId: string }[] }
      ).zones.map((zone) => zone.zoneId),
    ).toContain(target._id);
  }, 60000);

  it("keeps a full entries row far below the 1 MiB document limit", async () => {
    const seed = await scaleWorld();
    await addPallets(seed, MAX_ZONE_OCCUPANCY_ENTRIES);
    await linkPlacements(seed);
    expect((await backfillOccupancy(seed)).ready).toBe(true);
    const bytes = await seed.world.t.run(async (ctx) => {
      const row = (
        await ctx.db.query("storageZoneOccupancyEntries").collect()
      )[0]!;
      expect(row).toMatchObject({ complete: true });
      expect(row.placements).toHaveLength(MAX_ZONE_OCCUPANCY_ENTRIES);
      return new TextEncoder().encode(JSON.stringify(row)).length;
    });
    // Measured ~0.8 KB per held placement including pallet facts.
    expect(bytes).toBeLessThan(600 * 1024);
    console.info(`entries row at cap: ${bytes} bytes`);
  }, 60000);

  it("reads overflowed zones directly and stays exact", async () => {
    const seed = await scaleWorld();
    await addPallets(seed, MAX_ZONE_OCCUPANCY_ENTRIES + 1);
    await linkPlacements(seed);
    const upper = await measuredPallet(seed, "PAL-UPPER");
    expect((await backfillOccupancy(seed)).ready).toBe(true);
    const summary = await seed.world.t.run(
      async (ctx) => (await ctx.db.query("storageZoneOccupancy").collect())[0]!,
    );
    expect(summary).toMatchObject({
      complete: false,
      held: MAX_ZONE_OCCUPANCY_ENTRIES + 1,
    });
    const { raw, derived } = await expectOccupancyParity(seed, upper);
    // Only the small summary helps; entries fall back to the placements.
    expect(derived.docs.occupancy).toBeLessThan(raw.docs.occupancy);
  }, 60000);

  it("does not let a backfill that was invalidated mid-run re-enable stale rows", async () => {
    const seed = await scaleWorld();
    await addZones(seed, 4);
    await addPallets(seed, 3);
    await linkPlacements(seed);
    const step = (args: Record<string, unknown>) =>
      seed.world.t.run((ctx) =>
        (
          backfillZoneOccupancy as unknown as {
            _handler(
              ctx: GenericMutationCtx<DataModel>,
              args: unknown,
            ): Promise<{
              isDone: boolean;
              ready: boolean;
              continueCursor: string;
            }>;
          }
        )._handler(ctx, {
          warehouseId: seed.warehouseId,
          batchSize: 1,
          ...args,
        }),
      );
    let result = await step({ restart: true });
    // A raw writer invalidates while the backfill is still paging.
    await seed.world.t.run((ctx) =>
      (
        invalidateZoneOccupancyMutation as unknown as {
          _handler(
            ctx: GenericMutationCtx<DataModel>,
            args: unknown,
          ): Promise<unknown>;
        }
      )._handler(ctx, { warehouseId: seed.warehouseId }),
    );
    while (!result.isDone)
      result = await step({ cursor: result.continueCursor });
    expect(result.ready).toBe(false);
    expect((await backfillOccupancy(seed)).ready).toBe(true);
  });

  it("refuses readiness while a placement names another building than its zone", async () => {
    const seed = await scaleWorld();
    await addPallets(seed, 3);
    await linkPlacements(seed);
    await seed.world.t.run(async (ctx) => {
      const otherBuilding = await ctx.db.insert("storageBuildings", {
        ...fields(seed.building),
        code: "OTHER",
      });
      const placement = (
        await ctx.db.query("finishedGoodsPlacements").collect()
      )[0]!;
      await ctx.db.patch(placement._id, { buildingId: otherBuilding });
    });
    expect((await backfillOccupancy(seed)).ready).toBe(false);
    const readiness = await seed.world.t.run(
      async (ctx) =>
        (await ctx.db.query("storageZoneOccupancyReadiness").collect())[0]!,
    );
    expect(readiness).toMatchObject({ ready: false, blocked: true });
  });
});

describe("recommendation order across active buildings", () => {
  it("keeps the warehouse zone-code order when zone codes interleave across buildings", async () => {
    const seed = await scaleWorld();
    // A second ACTIVE building whose zones interleave with the first one's codes.
    await seed.world.t.run(async (ctx) => {
      const buildingId = await ctx.db.insert("storageBuildings", {
        ...fields(seed.building),
        code: "SECOND",
        status: "ACTIVE",
      });
      const floor = (await ctx.db.get(seed.zone.floorId))!;
      const floorId = await ctx.db.insert("storageFloors", {
        ...fields(floor),
        buildingId,
      });
      await ctx.db.patch(seed.zone._id, { code: "Z-01" });
      for (const [code, inSecond] of [
        ["Z-02", true],
        ["Z-03", false],
        ["Z-04", true],
        ["Z-00", true],
      ] as const) {
        const locationId = await ctx.db.insert("locations", {
          ...fields(seed.location),
          code: `L-${code}`,
        });
        await ctx.db.insert("storageZones", {
          ...fields(seed.zone),
          ...(inSecond ? { buildingId, floorId } : {}),
          locationId,
          code,
        });
      }
    });
    // Too tall for every surface: each zone yields an ordered preview, no candidate.
    const tall = await seed.world.t.run((ctx) =>
      ctx.db.insert("finishedGoodsPallets", {
        ...seed.audit,
        productId: seed.productId,
        code: "PAL-TALL",
        quantity: 1,
        lengthMm: 1000,
        widthMm: 1000,
        heightMm: 9000,
        status: "AWAITING_PLACEMENT",
      }),
    );
    const { value } = await measured<{
      candidates: unknown[];
      previewCandidates: { locationCode: string; buildingCode: string }[];
      reasons: string[];
    }>(seed.world, recommend, {
      warehouseId: seed.warehouseId,
      palletId: tall,
    });
    expect(value.candidates).toEqual([]);
    expect(value.reasons).toEqual(["HEIGHT_EXCEEDED"]);
    expect(value.previewCandidates.map((c) => c.locationCode)).toEqual([
      "Z-00",
      "Z-01",
      "Z-02",
      "Z-03",
      "Z-04",
    ]);
    expect(new Set(value.previewCandidates.map((c) => c.buildingCode))).toEqual(
      new Set(["SCALE", "SECOND"]),
    );
  });
});
