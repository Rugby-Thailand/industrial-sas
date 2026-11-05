import { describe, expect, it } from "vitest";
import type { GenericMutationCtx } from "convex/server";
import type { DataModel } from "../../convex/schema";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";
import {
  measured,
  recordWrites,
  rerunsOn,
  type ReadSet,
} from "../fixtures/query-read-stats";
import {
  buildingOccupancy,
  getStorageBuildingInventory,
} from "../../convex/storageLayouts/catalogue";
import {
  health as zoneOccupancyHealth,
  invalidate as invalidateZoneOccupancyMutation,
  recheckOverflow,
  recheckZone,
  run as backfillZoneOccupancy,
  sweep as sweepZoneOccupancy,
} from "../../convex/storageLayouts/zoneOccupancyBackfill";
import { trackFinishedGoodsWrites } from "../../convex/lib/finishedGoodsSummary";
import {
  createTenantDocumentAccess,
  type TenantDocumentAccess,
} from "../../convex/lib/tenantDb";
import { createMutationTenantStorage } from "../../convex/lib/tenantStorage";
import {
  MAX_ZONE_OCCUPANCY_ENTRIES,
  palletFacts,
} from "../../convex/lib/zoneOccupancy";
import {
  SURFACE_REFRESH_LOCATION_BUDGET,
  SURFACE_REFRESH_ZONE_BUDGET,
} from "../../convex/lib/zoneSurfaces";
import { ZONE_PREVIEW_FIELDS } from "../../convex/model/finishedGoods/recommendationView";
import {
  createStorageBuilding,
  activateStorageBuilding,
} from "../../convex/storageLayouts/writes";
import { createStorageZone } from "../../convex/storageLayouts/zones";
import { backfillBuildingIndexes } from "../../convex/finishedGoods/moveBuildingMigration";
import {
  cancelMove,
  cancelReservation,
  confirmStored,
  recommend,
  recommendationZone,
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
type CandidateRecord = Record<string, unknown> & { zoneId: string };
type RecommendationPayload = {
  candidates: CandidateRecord[];
  previewCandidates?: CandidateRecord[];
  reasons: string[];
};
const payloadBytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length;
const docsRead = (stats: {
  rangeDocs: Record<string, number>;
  gets: Record<string, number>;
}) =>
  [stats.rangeDocs, stats.gets]
    .flatMap((counts) => Object.values(counts))
    .reduce((sum, count) => sum + count, 0);
const bytesRead = (stats: { bytes: Record<string, number> }) =>
  Object.values(stats.bytes).reduce((sum, count) => sum + count, 0);
/**
 * The split recommendation on one snapshot: the ranked list (`view: "list"`)
 * plus `recommendationZone` for every zone it lists must reproduce the full
 * original payload exactly, and list items carry no per-zone preview field.
 */
async function expectSplitParity(
  seed: { world: ConvexTenantWorld; warehouseId: string },
  palletId: string,
  fn: unknown = recommend,
) {
  const args = { warehouseId: seed.warehouseId, palletId };
  const full = await measured<RecommendationPayload>(seed.world, fn, args);
  const list = await measured<RecommendationPayload>(seed.world, fn, {
    ...args,
    view: "list",
  });
  const listed = [
    ...list.value.candidates,
    ...(list.value.previewCandidates ?? []),
  ];
  for (const item of listed)
    for (const field of ZONE_PREVIEW_FIELDS)
      expect(item, field).not.toHaveProperty(field);
  const zones = new Map<
    string,
    Awaited<ReturnType<typeof measured<Record<string, unknown> | null>>>
  >();
  for (const zoneId of new Set(listed.map((item) => item.zoneId)))
    zones.set(
      zoneId,
      await measured<Record<string, unknown> | null>(
        seed.world,
        recommendationZone,
        { ...args, zoneId },
      ),
    );
  const assemble = (item: CandidateRecord) => {
    const zone = zones.get(item.zoneId)!.value;
    expect(zone, item.zoneId).not.toBeNull();
    return { ...item, ...zone };
  };
  // The zones a screen opens on ride along with the list, exactly as the
  // zone query would return them.
  const { openingZones, ...rest } = list.value as RecommendationPayload & {
    openingZones?: { zoneId: string }[];
  };
  expect(openingZones).toBeDefined();
  for (const opening of openingZones!)
    expect(opening).toEqual(zones.get(opening.zoneId)!.value);
  const opened = [
    list.value.candidates[0],
    list.value.candidates.find((c) => !c.supportPalletId),
    list.value.previewCandidates?.[0],
  ].flatMap((c) => (c ? [c.zoneId] : []));
  expect(openingZones!.map((zone) => zone.zoneId)).toEqual([
    ...new Set(opened),
  ]);
  expect({
    ...rest,
    candidates: list.value.candidates.map(assemble),
    ...(list.value.previewCandidates
      ? { previewCandidates: list.value.previewCandidates.map(assemble) }
      : {}),
  }).toEqual(full.value);
  const details = [...zones.values()];
  return {
    full,
    list,
    zones,
    values: {
      list: list.value,
      zones: Object.fromEntries(
        [...zones].map(([zoneId, zone]) => [zoneId, zone.value]),
      ),
    },
    docs: {
      full: docsRead(full.stats),
      list: docsRead(list.stats),
      zoneMax: Math.max(0, ...details.map((zone) => docsRead(zone.stats))),
    },
    returned: {
      full: payloadBytes(full.value),
      list: payloadBytes(list.value),
      zoneMax: Math.max(0, ...details.map((zone) => payloadBytes(zone.value))),
    },
  };
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
    const split = await expectSplitParity(seed, seed.palletId);
    expect(split.list.value.candidates).toHaveLength(101);
  }, 60000);
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
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    "preserves ordered reasons and geometry-unknown precedence (unknown first=%s, derived occupancy=%s)",
    async (unknownFirst, derived) => {
      const seed = await scaleWorld();
      await addZones(seed, 2);
      const zones = await seed.world.t.run(async (ctx) => {
        await ctx.db.patch(seed.zone._id, { storageCondition: "COLD" });
        return ctx.db.query("storageZones").collect();
      });
      await addLocationOnly(seed, zones[unknownFirst ? 0 : 1]!);
      if (derived) expect((await backfillOccupancy(seed)).ready).toBe(true);
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
      // Mismatched zones need only their unmeasured count: with derived rows
      // that is the small summary row, never the entries row.
      if (derived) {
        expect(result.stats.ranges["storageZoneOccupancyEntries"] ?? 0).toBe(0);
        expect(result.stats.ranges["storageZoneOccupancy"]).toBe(2);
      }
      await expectSplitParity(seed, seed.palletId);
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
    await expectSplitParity(seed, seed.palletId);
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
    await expectSplitParity(seed, seed.palletId);
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
    await expectSplitParity(seed, seed.palletId);
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
    await expectSplitParity(seed, upperId);
  }, 60000);
});

type ScaleSeed = Awaited<ReturnType<typeof scaleWorld>>;
type BackfillResult = {
  runId: string;
  superseded: boolean;
  isDone: boolean;
  ready: boolean;
  buildingReady: boolean;
  continueCursor: string;
};
const backfillStep = (seed: ScaleSeed, args: Record<string, unknown>) =>
  seed.world.t.run((ctx) =>
    (
      backfillZoneOccupancy as unknown as {
        _handler(
          ctx: GenericMutationCtx<DataModel>,
          args: unknown,
        ): Promise<BackfillResult>;
      }
    )._handler(ctx, { warehouseId: seed.warehouseId, batchSize: 2, ...args }),
  );
async function backfillOccupancy(seed: ScaleSeed) {
  let result = await backfillStep(seed, { restart: true });
  for (let batch = 0; batch < 100 && !result.isDone; batch++)
    result = await backfillStep(seed, {
      cursor: result.continueCursor,
      runId: result.runId,
    });
  if (!result.isDone) throw new Error("backfill did not finish");
  return result;
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
  const split = await expectSplitParity(seed, palletId);
  return {
    values: {
      recommendation: recommendation.value,
      recommendationList: split.values.list,
      recommendationZones: split.values.zones,
      inventory: inventory.value,
      occupancy: occupancy.value,
    },
    docs: {
      recommendationList: split.docs.list,
      recommendationZoneMax: split.docs.zoneMax,
      recommendation: documents(recommendation.stats),
      inventory: documents(inventory.stats),
      occupancy: documents(occupancy.stats),
    },
  };
}
/** Writes as a tracked mutation does: derived rows maintained in the same transaction. */
async function trackedWrite(
  seed: ScaleSeed,
  write: (db: TenantDocumentAccess) => Promise<unknown>,
) {
  await seed.world.t.run(async (ctx) => {
    const writes = trackFinishedGoodsWrites(
      createTenantDocumentAccess(
        { orgId: seed.world.orgA, requestId: "tracked" },
        createMutationTenantStorage(ctx, "tracked"),
      ),
    );
    await write(writes.db);
    await writes.flush();
  });
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
    await expectSplitParity(seed, moving._id, recommendMove);
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
    await expectSplitParity(seed, moving._id, recommendMove);
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
    await expectSplitParity(seed, moving._id, recommendMove);
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
    await expectSplitParity(seed, moving._id, recommendMove);
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
    expect(await backfillOccupancy(seed)).toMatchObject({
      ready: true,
      buildingReady: false,
    });
    const summary = await seed.world.t.run(
      async (ctx) => (await ctx.db.query("storageZoneOccupancy").collect())[0]!,
    );
    expect(summary).toMatchObject({ complete: false });
    const { raw, derived } = await expectOccupancyParity(seed, upper);
    // An overflowed zone sends building readers to the authoritative path
    // (plus the one zone row that shows why).
    expect(derived.docs.occupancy).toBe(raw.docs.occupancy + 1);
    const readiness = await seed.world.t.run(
      async (ctx) =>
        (await ctx.db.query("storageZoneOccupancyReadiness").collect())[0]!,
    );
    expect(readiness).toMatchObject({ ready: true, overflow: true });
    // A mismatched overflowed zone: its summary row is a marker, so the
    // unmeasured count is read from the placements, as without derived rows.
    await trackedWrite(seed, (db) =>
      db.patch("storageZones", seed.zone._id, { storageCondition: "COLD" }),
    );
    const mismatched = await expectOccupancyParity(seed, upper);
    expect(mismatched.derived.values.recommendation).toMatchObject({
      candidates: [],
      reasons: ["STORAGE_CONDITION_MISMATCH"],
    });
  }, 60000);

  it("does not let a backfill that was invalidated mid-run re-enable stale rows", async () => {
    const seed = await scaleWorld();
    await addZones(seed, 4);
    await addPallets(seed, 3);
    await linkPlacements(seed);
    let result = await backfillStep(seed, { restart: true, batchSize: 1 });
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
      result = await backfillStep(seed, {
        cursor: result.continueCursor,
        runId: result.runId,
        batchSize: 1,
      });
    expect(result.ready).toBe(false);
    expect((await backfillOccupancy(seed)).ready).toBe(true);
  });

  it.each(["summary", "layout"] as const)(
    "rejects a backfill whose %s generation changes between pages",
    async (kind) => {
      const seed = await scaleWorld();
      await addZones(seed, 4);
      await addPallets(seed, 3);
      await linkPlacements(seed);
      // Exercise a replacement run as well as an initially empty readiness row.
      expect((await backfillOccupancy(seed)).ready).toBe(true);
      let result = await backfillStep(seed, { restart: true, batchSize: 1 });
      expect(result.isDone).toBe(false);
      await seed.world.t.run(async (ctx) => {
        const table =
          kind === "summary"
            ? "finishedGoodsSummaryReadiness"
            : "storageCatalogueSignals";
        const row = (await ctx.db.query(table).collect()).find(
          (row) => row.warehouseId === seed.warehouseId,
        )!;
        await ctx.db.patch(row._id, { generation: (row.generation ?? 0) + 1 });
      });
      while (!result.isDone)
        result = await backfillStep(seed, {
          cursor: result.continueCursor,
          runId: result.runId,
          batchSize: 1,
        });
      expect(result).toMatchObject({ ready: false, buildingReady: false });
      expect((await backfillOccupancy(seed)).ready).toBe(true);
    },
  );

  it("follows maintained layout writes between backfill pages", async () => {
    const seed = await scaleWorld();
    await addZones(seed, 4);
    let result = await backfillStep(seed, { restart: true, batchSize: 1 });
    expect(result.isDone).toBe(false);
    await trackedWrite(seed, (db) =>
      db.patch("storageZones", seed.zone._id, { storageCondition: "COLD" }),
    );
    while (!result.isDone)
      result = await backfillStep(seed, {
        cursor: result.continueCursor,
        runId: result.runId,
        batchSize: 1,
      });
    expect(result.ready).toBe(true);
    const upper = await measuredPallet(seed, "PAL-MID-BACKFILL");
    await expectOccupancyParity(seed, upper);
  });

  it.each([501, 16000, 0, 1.5])(
    "rejects unsafe backfill read budget %s",
    async (budget) => {
      const seed = await scaleWorld();
      await expect(
        backfillStep(seed, { restart: true, budget }),
      ).rejects.toThrow("budget must be an integer from 1 to 500");
    },
  );

  it("refuses an older run's continuation once a newer run has started", async () => {
    const seed = await scaleWorld();
    await addZones(seed, 4);
    await addPallets(seed, 3);
    await linkPlacements(seed);
    const a = await backfillStep(seed, { restart: true, batchSize: 1 });
    const b = await backfillStep(seed, { restart: true, batchSize: 1 });
    expect(b.runId).not.toBe(a.runId);
    // Run A's next page must neither rebuild nor declare readiness.
    expect(
      await backfillStep(seed, {
        cursor: a.continueCursor,
        runId: a.runId,
        batchSize: 50,
      }),
    ).toMatchObject({ superseded: true, ready: false, rebuilt: 0 });
    let result = b;
    while (!result.isDone)
      result = await backfillStep(seed, {
        cursor: result.continueCursor,
        runId: result.runId,
        batchSize: 1,
      });
    expect(result).toMatchObject({ superseded: false, ready: true });
  });

  it("keeps building readers on placements while a placement names another building", async () => {
    const seed = await scaleWorld();
    await addPallets(seed, 3);
    await linkPlacements(seed);
    const upper = await measuredPallet(seed, "PAL-UPPER");
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
    // Zone-scoped rows are still exact; building-scoped readers fall back.
    expect(await backfillOccupancy(seed)).toMatchObject({
      ready: true,
      buildingReady: false,
    });
    const readiness = await seed.world.t.run(
      async (ctx) =>
        (await ctx.db.query("storageZoneOccupancyReadiness").collect())[0]!,
    );
    expect(readiness).toMatchObject({ ready: true, blocked: true });
    const { raw, derived } = await expectOccupancyParity(seed, upper);
    expect(derived.docs.recommendation).toBeLessThan(raw.docs.recommendation);
    // Building readers take the authoritative path in both modes (plus the
    // one zone row that shows why).
    expect(derived.docs.occupancy).toBe(raw.docs.occupancy + 1);
  });

  it("distrusts rows after writes by code that does not maintain them", async () => {
    const seed = await scaleWorld();
    await addPallets(seed, 3);
    await linkPlacements(seed);
    const upper = await measuredPallet(seed, "PAL-UPPER");
    expect((await backfillOccupancy(seed)).ready).toBe(true);
    const ready = await occupancyReaders(seed, upper);
    // Pre-change code bumps the legacy generation on every write (rollback).
    await seed.world.t.run(async (ctx) => {
      const row = (
        await ctx.db.query("finishedGoodsSummaryReadiness").collect()
      )[0]!;
      await ctx.db.patch(row._id, { generation: (row.generation ?? 0) + 1 });
    });
    const distrusted = await occupancyReaders(seed, upper);
    expect(distrusted.values).toEqual(ready.values);
    expect(distrusted.docs.recommendation).toBeGreaterThan(
      ready.docs.recommendation,
    );
    // The hourly sweep restarts it; a finished backfill trusts the rows again.
    const started = await seed.world.t.run((ctx) =>
      (
        sweepZoneOccupancy as unknown as {
          _handler(
            ctx: GenericMutationCtx<DataModel>,
            args: unknown,
          ): Promise<{ started: number }>;
        }
      )._handler(ctx, {}),
    );
    expect(started.started).toBeGreaterThan(0);
    expect((await backfillOccupancy(seed)).ready).toBe(true);
    expect((await occupancyReaders(seed, upper)).docs.recommendation).toBe(
      ready.docs.recommendation,
    );
  });

  it("serves building readers again once a cross-building placement is gone, without a restart", async () => {
    const seed = await scaleWorld();
    await addPallets(seed, 3);
    await linkPlacements(seed);
    const upper = await measuredPallet(seed, "PAL-UPPER");
    const placement = await seed.world.t.run(async (ctx) => {
      const otherBuilding = await ctx.db.insert("storageBuildings", {
        ...fields(seed.building),
        code: "OTHER",
      });
      const placement = (
        await ctx.db.query("finishedGoodsPlacements").collect()
      )[0]!;
      await ctx.db.patch(placement._id, { buildingId: otherBuilding });
      return placement;
    });
    expect(await backfillOccupancy(seed)).toMatchObject({
      buildingReady: false,
    });
    const blocked = await expectOccupancyParity(seed, upper);
    expect(blocked.derived.docs.occupancy).toBe(blocked.raw.docs.occupancy + 1);
    // A tracked write puts the placement back in its zone's building.
    await seed.world.t.run(async (ctx) => {
      const writes = trackFinishedGoodsWrites(
        createTenantDocumentAccess(
          { orgId: seed.world.orgA, requestId: "repair" },
          createMutationTenantStorage(ctx, "repair"),
        ),
      );
      await writes.db.patch("finishedGoodsPlacements", placement._id, {
        buildingId: placement.buildingId,
      });
      await writes.flush();
    });
    const healed = await expectOccupancyParity(seed, upper);
    expect(healed.derived.docs.occupancy).toBeLessThan(
      healed.raw.docs.occupancy,
    );
    expect(healed.derived.docs.inventory).toBeLessThan(
      healed.raw.docs.inventory,
    );
  });

  it("re-checks overflowed zones hourly and serves building readers once under the cap", async () => {
    const seed = await scaleWorld();
    await addPallets(seed, MAX_ZONE_OCCUPANCY_ENTRIES + 1);
    await linkPlacements(seed);
    const upper = await measuredPallet(seed, "PAL-UPPER");
    expect(await backfillOccupancy(seed)).toMatchObject({
      ready: true,
      buildingReady: false,
    });
    // Release one hold with a tracked write: overflowed zones get no per-write
    // work, so the zone stays a marker until it is re-checked.
    await seed.world.t.run(async (ctx) => {
      const writes = trackFinishedGoodsWrites(
        createTenantDocumentAccess(
          { orgId: seed.world.orgA, requestId: "release" },
          createMutationTenantStorage(ctx, "release"),
        ),
      );
      const placement = (
        await ctx.db.query("finishedGoodsPlacements").collect()
      )[0]!;
      await writes.db.patch("finishedGoodsPlacements", placement._id, {
        status: "RELEASED",
      });
      await writes.flush();
    });
    const run = <T>(fn: unknown, args: unknown) =>
      seed.world.t.run(
        (ctx) =>
          (
            fn as {
              _handler(
                ctx: GenericMutationCtx<DataModel>,
                args: unknown,
              ): Promise<T>;
            }
          )._handler(ctx, args) as Promise<T>,
      );
    const before = await run<{ overflowedZoneIds: string[] }>(
      zoneOccupancyHealth,
      { warehouseId: seed.warehouseId },
    );
    expect(before.overflowedZoneIds).toHaveLength(1);
    await run(sweepZoneOccupancy, {});
    const jobs = async (name: string) =>
      (
        await seed.world.t.run((ctx) =>
          ctx.db.system.query("_scheduled_functions").collect(),
        )
      ).filter((job) => job.name.includes(name));
    expect(await jobs("recheckOverflow")).toHaveLength(1);
    await run(recheckOverflow, { warehouseId: seed.warehouseId });
    expect(await jobs("recheckZone")).toHaveLength(1);
    expect(
      await run(recheckZone, { zoneId: before.overflowedZoneIds[0] }),
    ).toEqual({ complete: true });
    expect(
      await run<{ overflowedZoneIds: string[] }>(zoneOccupancyHealth, {
        warehouseId: seed.warehouseId,
      }),
    ).toMatchObject({ ready: true, overflowedZoneIds: [] });
    const { raw, derived } = await expectOccupancyParity(seed, upper);
    expect(derived.docs.occupancy).toBeLessThan(raw.docs.occupancy);
  }, 60000);

  it("re-checks every overflowed zone each sweep, not only the first page", async () => {
    const seed = await scaleWorld();
    await addZones(seed, 11);
    await addPallets(seed, 3);
    await linkPlacements(seed);
    expect((await backfillOccupancy(seed)).ready).toBe(true);
    // Eleven zones marked overflowed: more than one page of the walk.
    const zones = await seed.world.t.run(async (ctx) => {
      const zones = await ctx.db.query("storageZones").collect();
      for (const zone of zones) {
        const row = await ctx.db
          .query("storageZoneOccupancy")
          .withIndex("by_orgId_zoneId", (q) =>
            q.eq("orgId", zone.orgId).eq("zoneId", zone._id),
          )
          .unique();
        if (row) await ctx.db.patch(row._id, { complete: false });
        else
          await ctx.db.insert("storageZoneOccupancy", {
            orgId: zone.orgId,
            warehouseId: zone.warehouseId,
            buildingId: zone.buildingId,
            zoneId: zone._id,
            version: 1,
            complete: false,
            held: 0,
            unmeasured: 0,
            buildingMismatch: false,
            storedFootprintAreaSqMm: 0,
            heldFootprintAreaSqMm: 0,
          });
      }
      return zones.map((zone) => zone._id as string);
    });
    expect(zones.length).toBeGreaterThan(10);
    const walk = (args: Record<string, unknown>) =>
      seed.world.t.run((ctx) =>
        (
          recheckOverflow as unknown as {
            _handler(
              ctx: GenericMutationCtx<DataModel>,
              args: unknown,
            ): Promise<{ isDone: boolean; continueCursor: string }>;
          }
        )._handler(ctx, { warehouseId: seed.warehouseId, ...args }),
      );
    let page = await walk({});
    while (!page.isDone) page = await walk({ cursor: page.continueCursor });
    const rechecked = (
      await seed.world.t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").collect(),
      )
    )
      .filter((job) => job.name.includes("recheckZone"))
      .map((job) => (job.args[0] as { zoneId: string }).zoneId);
    expect(new Set(rechecked)).toEqual(new Set(zones));
  });

  it("backfills two dense zones in one page within the transaction read limit", async () => {
    // Under the deployed limits (4,096 reads): each dense zone costs ~2,300
    // reads (450 pallets, 5 each with stack facts); two in one page did not
    // fit the old document budget.
    const seed = await scaleWorld();
    await addZones(seed, 2);
    await addPallets(seed, 450);
    await seed.world.t.run(async (ctx) => {
      const other = (await ctx.db.query("storageZones").collect()).find(
        (zone) => zone._id !== seed.zone._id,
      )!;
      for (let i = 0; i < 450; i++) {
        const palletId = await ctx.db.insert("finishedGoodsPallets", {
          ...seed.audit,
          productId: seed.productId,
          code: `DENSE-${i}`,
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
          floorId: other.floorId,
          zoneId: other._id,
          locationId: other.locationId,
          positionCode: `DENSE-POS-${i}`,
          qrValue: `DENSE-QR-${i}`,
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
    await linkPlacements(seed);
    let result = await backfillStep(seed, { restart: true, batchSize: 50 });
    let steps = 1;
    while (!result.isDone) {
      result = await backfillStep(seed, {
        cursor: result.continueCursor,
        runId: result.runId,
        batchSize: 50,
      });
      steps++;
    }
    expect(result).toMatchObject({ ready: true });
    // The dense zones were rebuilt in separate transactions.
    expect(steps).toBeGreaterThan(1);
  }, 300000);

  it("stops a backfill page at its read budget and resumes the same page", async () => {
    const seed = await scaleWorld();
    await addZones(seed, 4);
    await addPallets(seed, 6);
    await linkPlacements(seed);
    const upper = await measuredPallet(seed, "PAL-UPPER");
    let result = await backfillStep(seed, { restart: true, budget: 1 });
    let steps = 1;
    let rebuilt = (result as unknown as { rebuilt: number }).rebuilt;
    while (!result.isDone) {
      expect((result as unknown as { rebuilt: number }).rebuilt).toBe(1);
      result = await backfillStep(seed, {
        cursor: result.continueCursor,
        runId: result.runId,
        budget: 1,
      });
      rebuilt += (result as unknown as { rebuilt: number }).rebuilt;
      steps++;
    }
    const zones = await seed.world.t.run((ctx) =>
      ctx.db.query("storageZones").collect(),
    );
    // One zone per transaction, each zone exactly once.
    expect(rebuilt).toBe(zones.length);
    expect(steps).toBeGreaterThanOrEqual(zones.length);
    expect(result).toMatchObject({ ready: true, buildingReady: true });
    await expectOccupancyParity(seed, upper);
    await expect(
      backfillStep(seed, {
        cursor: '{"resume":null,"done":[1]}',
        runId: result.runId,
      }),
    ).rejects.toThrow("Invalid backfill cursor");
  });

  it("does no full-range work when writing into an overflowed zone", async () => {
    const seed = await scaleWorld();
    await addPallets(seed, MAX_ZONE_OCCUPANCY_ENTRIES + 1);
    await linkPlacements(seed);
    const upper = await measuredPallet(seed, "PAL-UPPER");
    expect(await backfillOccupancy(seed)).toMatchObject({
      ready: true,
      buildingReady: false,
    });
    const before = await seed.world.t.run((ctx) =>
      ctx.db.query("storageZoneOccupancyEntries").collect(),
    );
    // A tracked write to a pallet held in that zone (stacking limits).
    accepted(
      await call(seed.world, saveStackingLimits, {
        warehouseId: seed.warehouseId,
        palletId: seed.palletId,
        requestId: "overflow-write",
        stackable: true,
        maxStackLevels: 2,
        expectedStackable: false,
      }),
    );
    const after = await seed.world.t.run((ctx) =>
      ctx.db.query("storageZoneOccupancyEntries").collect(),
    );
    expect(after).toEqual(before);
    await expectOccupancyParity(seed, upper);
  }, 60000);
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
    await expectSplitParity(seed, tall);
  });
});

/**
 * A warehouse shaped like the profiling tenant, small enough for convex-test:
 * four active buildings, each with plain floor areas holding stored pallets
 * (half of them stackable, so they offer stack surfaces), racks of exact
 * positions, a stocked cold area (a mismatch for the dry probe), an area with
 * an unmeasured unit and a reserved floor block; plus a draft building that
 * can never be a candidate.
 */
async function warehouseWorld(stocked = true) {
  const seed = await scaleWorld();
  const layout = await seed.world.t.run(async (ctx) => {
    const floor = (await ctx.db.get(seed.zone.floorId))!;
    const now = { createdAt: 1, updatedAt: 1 };
    const users = {
      createdByUserId: seed.world.userA,
      updatedByUserId: seed.world.userA,
    };
    const location = (code: string) =>
      ctx.db.insert("locations", { ...fields(seed.location), code });
    const simple: Id<"storageZones">[] = [];
    const cold: Id<"storageZones">[] = [];
    const racks: {
      zoneId: Id<"storageZones">;
      positions: Doc<"storagePositions">[];
    }[] = [];
    const zoneIn = async (
      buildingId: Id<"storageBuildings">,
      floorId: Id<"storageFloors">,
      code: string,
      extra: Partial<Doc<"storageZones">> = {},
    ) =>
      ctx.db.insert("storageZones", {
        ...fields(seed.zone),
        buildingId,
        floorId,
        locationId: await location(`L-${code}`),
        code,
        label: code,
        qrValue: `QR-${code}`,
        ...extra,
      });
    const buildings: Id<"storageBuildings">[] = [seed.building._id];
    for (const code of ["B2", "B3", "B4"])
      buildings.push(
        await ctx.db.insert("storageBuildings", {
          ...fields(seed.building),
          code,
          name: code,
          status: "ACTIVE",
        }),
      );
    for (const [index, buildingId] of buildings.entries()) {
      const code = index === 0 ? "B1" : `B${index + 1}`;
      const floorId =
        index === 0
          ? seed.zone.floorId
          : await ctx.db.insert("storageFloors", {
              ...fields(floor),
              buildingId,
            });
      for (let i = 0; i < 4; i++)
        simple.push(
          index === 0 && i === 0
            ? seed.zone._id
            : await zoneIn(buildingId, floorId, `${code}-S${i}`),
        );
      for (let r = 0; r < 2; r++) {
        const zoneId = await zoneIn(buildingId, floorId, `${code}-R${r}`, {
          mode: "RACK",
          widthMm: 4000,
          depthMm: 2600,
        });
        const positions: Doc<"storagePositions">[] = [];
        for (let bay = 0; bay < 3; bay++)
          for (let slot = 0; slot < 2; slot++)
            for (let level = 0; level < 2; level++) {
              const positionCode = `${code}-R${r}-${bay}${slot}${level}`;
              const id = await ctx.db.insert("storagePositions", {
                orgId: seed.world.orgA,
                warehouseId: seed.warehouseId,
                buildingId,
                floorId,
                zoneId,
                locationId: await location(`L-${positionCode}`),
                code: positionCode,
                label: positionCode,
                qrValue: `QR-${positionCode}`,
                kind: "RACK_SLOT",
                isDefault: false,
                xMm: bay * 1300,
                yMm: slot * 1300,
                widthMm: 1200,
                depthMm: 1200,
                elevationMm: level * 1500,
                status: "ACTIVE",
                ...now,
                ...users,
              });
              positions.push((await ctx.db.get(id))!);
            }
        racks.push({ zoneId, positions });
      }
      cold.push(
        await zoneIn(buildingId, floorId, `${code}-COLD`, {
          storageCondition: "COLD",
        }),
      );
      await ctx.db.insert("storageFloorReservedBlocks", {
        orgId: seed.world.orgA,
        warehouseId: seed.warehouseId,
        buildingId,
        floorId,
        label: `${code} aisle`,
        xMm: 5000,
        yMm: 0,
        widthMm: 1000,
        depthMm: 6000,
        ...now,
      });
    }
    const draftId = await ctx.db.insert("storageBuildings", {
      ...fields(seed.building),
      code: "DRAFT",
      status: "DRAFT",
    });
    for (let i = 0; i < 5; i++)
      await zoneIn(draftId, seed.zone.floorId, `DRAFT-${i}`);
    return { simple, cold, racks, buildings };
  });
  // Stored pallets: 8 per floor area (every other one stackable), one in a
  // third of the rack positions.
  if (stocked)
    await seed.world.t.run(async (ctx) => {
      let n = 0;
      const store = async (
        zoneId: Id<"storageZones">,
        place: { xMm: number; yMm: number; zMm: number },
        extra: Partial<Doc<"finishedGoodsPallets">> = {},
        supportPositionId?: Id<"storagePositions">,
      ) => {
        const zone = (await ctx.db.get(zoneId))!;
        const palletId = await ctx.db.insert("finishedGoodsPallets", {
          ...seed.audit,
          productId: seed.productId,
          code: `PAL-W${n}`,
          quantity: 1,
          lengthMm: 1000,
          widthMm: 1000,
          heightMm: 1000,
          status: "STORED",
          ...extra,
        });
        const placementId = await ctx.db.insert("finishedGoodsPlacements", {
          ...seed.audit,
          palletId,
          buildingId: zone.buildingId,
          floorId: zone.floorId,
          zoneId,
          locationId: zone.locationId,
          ...(supportPositionId ? { supportPositionId } : {}),
          positionCode: `POS-W${n++}`,
          qrValue: `QR-W${n}`,
          ...place,
          widthMm: 1000,
          depthMm: 1000,
          heightMm: 1000,
          rotation: 0,
          status: "STORED",
        });
        await ctx.db.patch(palletId, { placementId });
      };
      for (const zoneId of [...layout.simple, ...layout.cold])
        for (let k = 0; k < 8; k++)
          await store(
            zoneId,
            { xMm: (k % 4) * 1100, yMm: Math.floor(k / 4) * 1100, zMm: 0 },
            k % 2 ? { stackable: true, maxStackLevels: 3 } : {},
          );
      for (const { zoneId, positions } of layout.racks)
        for (const position of positions.filter((_, i) => i % 3 === 0))
          await store(
            zoneId,
            {
              xMm: position.xMm!,
              yMm: position.yMm!,
              zMm: position.elevationMm!,
            },
            {},
            position._id,
          );
    });
  // The original pallet of scaleWorld is held nowhere; give one area an
  // unmeasured unit instead.
  await addLocationOnly(
    seed,
    (await seed.world.t.run((ctx) => ctx.db.get(layout.simple[5]!)))!,
  );
  const probe = await measuredPallet(seed, "PAL-PROBE");
  const other = await measuredPallet(seed, "PAL-OTHER");
  return { ...seed, ...layout, probe, other };
}

const reserveArgs = (
  seed: ScaleSeed,
  palletId: string,
  requestId: string,
  target: Recommended["candidates"][number],
) => ({
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
});
const summary = (
  label: string,
  stats: Parameters<typeof docsRead>[0] & {
    bytes: Record<string, number>;
    ranges: Record<string, number>;
  },
  value: unknown,
) =>
  `${label}: ${docsRead(stats)} docs, ${Object.values(stats.ranges).reduce((sum, n) => sum + n, 0)} index ranges, ${(bytesRead(stats) / 1024).toFixed(1)} KB read, ${(payloadBytes(value) / 1024).toFixed(1)} KB returned`;

describe("recommendation list and zone detail", () => {
  it.each([true, false])(
    "reproduce the full payload and read only the viewed zone (derived occupancy=%s)",
    async (derived) => {
      const seed = await warehouseWorld();
      if (derived) expect((await backfillOccupancy(seed)).ready).toBe(true);
      const split = await expectSplitParity(seed, seed.probe);
      const { full, list } = split;
      expect(list.value.candidates.length).toBeGreaterThan(20);
      expect(list.value.candidates.some((c) => c.supportPalletId)).toBe(true);
      expect(list.value.candidates.some((c) => c.supportPositionId)).toBe(true);
      // The viewed zone: the default (first) candidate's.
      const viewed = list.value.candidates[0]!.zoneId;
      const zone = split.zones.get(viewed)!;
      console.info(
        [
          `derived occupancy=${derived}`,
          summary("full recommend", full.stats, full.value),
          summary("list", list.stats, list.value),
          summary("zone detail (viewed)", zone.stats, zone.value),
          `largest zone detail: ${split.docs.zoneMax} docs, ${(split.returned.zoneMax / 1024).toFixed(1)} KB returned`,
        ].join("\n"),
      );
      // Mismatched (cold) zones cost the list a summary row, not entries.
      if (derived)
        expect(list.stats.rangeDocs["storageZoneOccupancyEntries"]).toBe(
          seed.simple.length + seed.racks.length,
        );
      // The list returns no per-zone geometry: a fraction of the full payload.
      expect(split.returned.list * 3).toBeLessThan(split.returned.full);
      // A zone detail reads one zone, not the warehouse: with derived rows,
      // its surface and entries rows, no zone, position or location document.
      if (derived) {
        expect(zone.stats.rangeDocs["storageZoneSurfaces"]).toBe(1);
        expect(zone.stats.rangeDocs["storageZoneOccupancyEntries"]).toBe(1);
        expect(zone.stats.ranges["storagePositions"] ?? 0).toBe(0);
        expect(zone.stats.gets["locations"] ?? 0).toBe(0);
        expect(zone.stats.gets["storageZones"] ?? 0).toBe(0);
      } else
        expect(docsRead(zone.stats) * 5).toBeLessThan(docsRead(full.stats));
      expect(zone.stats.rangeDocs["storageZones"] ?? 0).toBe(0);
      expect(zone.stats.ranges["storageBuildings"] ?? 0).toBe(0);
      // Zones the list does not show have no detail.
      const unlisted = await seed.world.t.run(async (ctx) =>
        (await ctx.db.query("storageZones").collect())
          .map((z) => z._id as string)
          .filter((id) => !split.zones.has(id)),
      );
      expect(unlisted.length).toBeGreaterThan(0);
      for (const zoneId of unlisted)
        expect(
          (
            await measured(seed.world, recommendationZone, {
              warehouseId: seed.warehouseId,
              palletId: seed.probe,
              zoneId,
            })
          ).value,
        ).toBeNull();
    },
    120000,
  );

  it("re-runs a zone detail only for writes to that zone", async () => {
    const seed = await warehouseWorld();
    expect((await backfillOccupancy(seed)).ready).toBe(true);
    const args = { warehouseId: seed.warehouseId, palletId: seed.probe };
    const before = await expectSplitParity(seed, seed.probe);
    const zoneIds = [...before.zones.keys()];
    const [viewed, elsewhere] = [zoneIds[0]!, zoneIds[zoneIds.length - 1]!];
    expect(viewed).not.toBe(elsewhere);
    const readSets = {
      full: before.full.readSet,
      list: before.list.readSet,
      viewed: before.zones.get(viewed)!.readSet,
      elsewhere: before.zones.get(elsewhere)!.readSet,
    };
    // Another operator reserves a different pallet in another zone.
    const target = (
      await measured<Recommended>(seed.world, recommend, {
        ...args,
        palletId: seed.other,
      })
    ).value.candidates.find((c) => c.zoneId === elsewhere)!;
    expect(target).toBeDefined();
    const { writes } = await recordWrites(
      seed.world,
      reserve,
      reserveArgs(seed, seed.other, "reserve-elsewhere", target),
    );
    const tables = (readSet: ReadSet) =>
      [...new Set(rerunsOn(readSet, writes).map((w) => w.table))].sort();
    const reruns = {
      full: tables(readSets.full),
      list: tables(readSets.list),
      viewed: tables(readSets.viewed),
      elsewhere: tables(readSets.elsewhere),
    };
    console.info(`re-run on reserve elsewhere: ${JSON.stringify(reruns)}`);
    // The viewed zone's detail does not depend on the other zone.
    expect(reruns.viewed).toEqual([]);
    // The list shows every zone, including the written one, so it re-runs, as
    // the full payload did; the written zone's own detail re-runs too.
    expect(reruns.list).toEqual(["storageZoneOccupancyEntries"]);
    expect(reruns.full).toEqual(["storageZoneOccupancyEntries"]);
    expect(reruns.elsewhere.length).toBeGreaterThan(0);
    const after = await expectSplitParity(seed, seed.probe);
    expect(after.zones.get(viewed)!.value).toEqual(
      before.zones.get(viewed)!.value,
    );
    // What one such write costs a screen that shows this pallet's list and
    // one zone: the old payload re-ran whole; now the list re-runs alone.
    console.info(
      [
        `reserve elsewhere, screen re-run before: ${docsRead(after.full.stats)} docs, ${(payloadBytes(after.full.value) / 1024).toFixed(1)} KB returned`,
        `reserve elsewhere, screen re-run after: ${docsRead(after.list.stats)} docs, ${(payloadBytes(after.list.value) / 1024).toFixed(1)} KB returned (zone detail: not re-run)`,
      ].join("\n"),
    );
    // Positive control: a write into the viewed zone re-runs its detail.
    const inViewed = (
      await measured<Recommended>(seed.world, recommend, {
        ...args,
        palletId: seed.other,
      })
    ).value.candidates.find((c) => c.zoneId === viewed);
    accepted(
      await call(seed.world, cancelReservation, {
        ...args,
        palletId: seed.other,
        requestId: "cancel-elsewhere",
      }),
    );
    expect(inViewed).toBeDefined();
    const viewedWrite = await recordWrites(
      seed.world,
      reserve,
      reserveArgs(seed, seed.other, "reserve-viewed", inViewed!),
    );
    expect(
      rerunsOn(readSets.viewed, viewedWrite.writes).length,
    ).toBeGreaterThan(0);
  }, 120000);

  it("refuses zones of another warehouse or organization and unmeasured pallets", async () => {
    const seed = await warehouseWorld();
    const listed = await expectSplitParity(seed, seed.probe);
    const zoneId = [...listed.zones.keys()][0]!;
    const preview = (args: Record<string, unknown>) =>
      measured(seed.world, recommendationZone, {
        warehouseId: seed.warehouseId,
        palletId: seed.probe,
        zoneId,
        ...args,
      });
    expect((await preview({})).value).not.toBeNull();
    // Same tenant, another warehouse's zone id.
    const foreignZone = await seed.world.t.run(async (ctx) => {
      const zone = (await ctx.db.get(zoneId as Id<"storageZones">))!;
      return ctx.db.insert("storageZones", {
        ...fields(zone),
        warehouseId: seed.world.warehouses.bravoA,
        code: "FOREIGN",
      });
    });
    expect((await preview({ zoneId: foreignZone })).value).toBeNull();
    // Another organization's zone.
    const otherOrgZone = await seed.world.t.run(async (ctx) => {
      const zone = (await ctx.db.get(zoneId as Id<"storageZones">))!;
      return ctx.db.insert("storageZones", {
        ...fields(zone),
        orgId: seed.world.orgB,
        warehouseId: seed.world.warehouses.alphaB,
        code: "OTHER-ORG",
      });
    });
    expect((await preview({ zoneId: otherOrgZone })).value).toBeNull();
    // An unmeasured pallet has no recommendation and no zone detail.
    await seed.world.t.run((ctx) =>
      ctx.db.patch(seed.probe as Id<"finishedGoodsPallets">, {
        heightMm: undefined,
      }),
    );
    expect((await preview({})).value).toBeNull();
    await expectSplitParity(seed, seed.probe);
  }, 120000);
});

/** A document's fields as a tenant write takes them (no system fields, no orgId). */
function tenantFieldsOf<
  T extends { _id: unknown; _creationTime: number; orgId: unknown },
>(doc: T) {
  const { orgId, ...rest } = fields(doc);
  void orgId;
  return rest;
}
/** Every surface row without its run stamp and system fields, by zone. */
const surfaceRows = (seed: ScaleSeed) =>
  seed.world.t.run(async (ctx) =>
    (await ctx.db.query("storageZoneSurfaces").collect())
      .map((row) => {
        const { _id, _creationTime, runId, ...fields } = row;
        void _id;
        void _creationTime;
        void runId;
        return fields;
      })
      .sort((a, b) => a.zoneId.localeCompare(b.zoneId)),
  );
const readinessRow = (seed: ScaleSeed) =>
  seed.world.t.run(
    async (ctx) =>
      (await ctx.db.query("storageZoneOccupancyReadiness").collect())[0]!,
  );
/**
 * The recommendation path without zone surfaces on the same snapshot:
 * occupancy rows, the layout read from its documents (surface rows out of
 * step), as code before surface rows read it.
 */
async function withoutSurfaces<T>(seed: ScaleSeed, read: () => Promise<T>) {
  const row = await readinessRow(seed);
  await seed.world.t.run((ctx) =>
    ctx.db.patch(row._id, { layoutGeneration: -1 }),
  );
  try {
    return await read();
  } finally {
    await seed.world.t.run((ctx) =>
      ctx.db.patch(row._id, { layoutGeneration: row.layoutGeneration }),
    );
  }
}
const listArgs = (seed: ScaleSeed, palletId: string) => ({
  warehouseId: seed.warehouseId,
  palletId,
  view: "list",
});
/** Rebuild every zone's rows in one run, 50 zones per transaction. */
async function rebuildAll(seed: ScaleSeed) {
  let result = await backfillStep(seed, { restart: true, batchSize: 50 });
  while (!result.isDone)
    result = await backfillStep(seed, {
      cursor: result.continueCursor,
      runId: result.runId,
      batchSize: 50,
    });
  expect(result.ready).toBe(true);
}
/**
 * The maintained rows equal rows rebuilt from scratch, readers use them, and
 * the full and list recommendations equal the authoritative path's (the full
 * payload carries every zone's preview fields).
 */
async function expectSurfaceParity(seed: ScaleSeed, palletId: string) {
  const read = async () => ({
    full: await measured(seed.world, recommend, {
      warehouseId: seed.warehouseId,
      palletId,
    }),
    list: await measured(seed.world, recommend, listArgs(seed, palletId)),
  });
  const derived = await read();
  expect(derived.list.stats.ranges["storageZoneSurfaces"] ?? 0).toBeGreaterThan(
    0,
  );
  await setOccupancyReady(seed, false);
  const raw = await read();
  await setOccupancyReady(seed, true);
  expect(derived.full.value).toEqual(raw.full.value);
  expect(derived.list.value).toEqual(raw.list.value);
  const maintained = await surfaceRows(seed);
  await rebuildAll(seed);
  expect(await surfaceRows(seed)).toEqual(maintained);
  return {
    derived: { full: derived.full.value, list: derived.list.value },
    raw: { full: raw.full.value, list: raw.list.value },
  };
}

describe("zone surfaces", () => {
  it("stay exact through every kind of tracked layout write", async () => {
    // Layout only: stock adds nothing to these rows and slows every step.
    const seed = await warehouseWorld(false);
    expect(seed.simple.length).toBeGreaterThan(2);
    expect((await backfillOccupancy(seed)).ready).toBe(true);
    await expectSurfaceParity(seed, seed.probe);
    const rack = seed.racks[0]!;
    const zoneOf = (id: string) =>
      seed.world.t.run(
        async (ctx) => (await ctx.db.get(id as Id<"storageZones">))!,
      );
    const simple = await zoneOf(seed.simple[2]!);
    const simpleLocation = await seed.world.t.run(
      async (ctx) => (await ctx.db.get(simple.locationId))!,
    );
    const added: { zoneId?: Id<"storageZones"> } = {};
    const steps: [string, (db: TenantDocumentAccess) => Promise<unknown>][] = [
      [
        "a cold area becomes dry and wider",
        (db) =>
          db.patch("storageZones", seed.cold[0]!, {
            storageCondition: " dry ",
            widthMm: 7000,
          }),
      ],
      [
        "an area is deactivated",
        (db) =>
          db.patch("storageZones", seed.simple[1]!, { status: "INACTIVE" }),
      ],
      [
        "it is reactivated",
        (db) => db.patch("storageZones", seed.simple[1]!, { status: "ACTIVE" }),
      ],
      [
        "a rack position moves",
        (db) =>
          db.patch("storagePositions", rack.positions[1]!._id, { xMm: 2600 }),
      ],
      [
        "a rack position is deactivated",
        (db) =>
          db.patch("storagePositions", rack.positions[4]!._id, {
            status: "INACTIVE",
          }),
      ],
      [
        "a rack position is added",
        (db) =>
          db.insert("storagePositions", {
            ...tenantFieldsOf(rack.positions[0]!),
            code: `${rack.positions[0]!.code}-NEW`,
            label: `${rack.positions[0]!.code}-NEW`,
            xMm: 2600,
            yMm: 1300,
            elevationMm: 1500,
          }),
      ],
      [
        "a position's location is deactivated",
        (db) =>
          db.patch("locations", rack.positions[2]!.locationId, {
            status: "INACTIVE",
          }),
      ],
      [
        "an area's location is deactivated",
        (db) =>
          db.patch("locations", simple.locationId, { status: "INACTIVE" }),
      ],
      [
        "a building is archived",
        (db) =>
          db.patch("storageBuildings", seed.buildings[1]!, {
            status: "ARCHIVED",
          }),
      ],
      [
        "it is activated again",
        (db) =>
          db.patch("storageBuildings", seed.buildings[1]!, {
            status: "ACTIVE",
          }),
      ],
      [
        "an area is added",
        async (db) => {
          const locationId = await db.insert("locations", {
            ...tenantFieldsOf(simpleLocation),
            code: "L-ADDED",
            status: "ACTIVE",
          });
          added.zoneId = (await db.insert("storageZones", {
            ...tenantFieldsOf(simple),
            locationId,
            code: "A-ADDED",
            label: "A-ADDED",
            qrValue: "QR-ADDED",
          })) as Id<"storageZones">;
        },
      ],
      ["it is deleted", (db) => db.delete("storageZones", added.zoneId!)],
    ];
    const listed = async () =>
      (
        await measured<RecommendationPayload>(
          seed.world,
          recommend,
          listArgs(seed, seed.probe),
        )
      ).value;
    for (const [label, write] of steps) {
      const before = await listed();
      await trackedWrite(seed, write);
      const { derived } = await expectSurfaceParity(seed, seed.probe);
      // Every step changes what the probe is offered.
      expect(derived.list, label).not.toEqual(before);
    }
    await expectSplitParity(seed, seed.probe);
  }, 300000);

  it("read one surface row and one entries row per compatible zone", async () => {
    const seed = await warehouseWorld();
    expect((await backfillOccupancy(seed)).ready).toBe(true);
    const args = listArgs(seed, seed.probe);
    const after = await measured<RecommendationPayload>(
      seed.world,
      recommend,
      args,
    );
    const before = await withoutSurfaces(seed, () =>
      measured<RecommendationPayload>(seed.world, recommend, args),
    );
    expect(after.value).toEqual(before.value);
    // The dry probe: cold areas cannot match, so they are not read at all.
    const compatible = seed.simple.length + seed.racks.length;
    expect(after.stats.rangeDocs["storageZoneSurfaces"]).toBe(compatible);
    expect(after.stats.rangeDocs["storageZoneOccupancyEntries"]).toBe(
      compatible,
    );
    expect(after.stats.ranges["storageZoneOccupancy"] ?? 0).toBe(0);
    expect(after.stats.ranges["storageZones"] ?? 0).toBe(0);
    expect(after.stats.ranges["storagePositions"] ?? 0).toBe(0);
    expect(after.stats.gets["locations"] ?? 0).toBe(0);
    expect(before.stats.rangeDocs["storageZones"]).toBeGreaterThan(compatible);
    // Nothing fits a pallet taller than every surface: reasons need every
    // zone, mismatched ones included, and stay identical.
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
    const tallAfter = await measured<RecommendationPayload>(
      seed.world,
      recommend,
      listArgs(seed, tall),
    );
    const tallBefore = await withoutSurfaces(seed, () =>
      measured<RecommendationPayload>(
        seed.world,
        recommend,
        listArgs(seed, tall),
      ),
    );
    expect(tallAfter.value).toEqual(tallBefore.value);
    expect(tallAfter.value.candidates).toEqual([]);
    expect(tallAfter.value.reasons).toContain("STORAGE_CONDITION_MISMATCH");
    expect(tallAfter.stats.rangeDocs["storageZoneSurfaces"]).toBe(
      compatible * 2 + seed.cold.length,
    );
    const zone = await measured(seed.world, recommendationZone, {
      warehouseId: seed.warehouseId,
      palletId: seed.probe,
      zoneId: seed.racks[0]!.zoneId,
    });
    const zoneBefore = await withoutSurfaces(seed, () =>
      measured(seed.world, recommendationZone, {
        warehouseId: seed.warehouseId,
        palletId: seed.probe,
        zoneId: seed.racks[0]!.zoneId,
      }),
    );
    expect(zone.value).toEqual(zoneBefore.value);
    console.info(
      [
        summary("list, layout documents", before.stats, before.value),
        summary("list, zone surfaces", after.stats, after.value),
        summary(
          "nothing fits, layout documents",
          tallBefore.stats,
          tallBefore.value,
        ),
        summary(
          "nothing fits, zone surfaces",
          tallAfter.stats,
          tallAfter.value,
        ),
        summary(
          "rack zone detail, layout documents",
          zoneBefore.stats,
          zoneBefore.value,
        ),
        summary("rack zone detail, zone surfaces", zone.stats, zone.value),
      ].join("\n"),
    );
    expect(docsRead(after.stats) * 2).toBeLessThan(docsRead(before.stats));
    expect(docsRead(zone.stats)).toBeLessThan(docsRead(zoneBefore.stats));
  }, 120000);

  it("re-run the list for writes in zones that can hold the pallet, not in mismatched ones", async () => {
    const seed = await warehouseWorld();
    expect((await backfillOccupancy(seed)).ready).toBe(true);
    const args = listArgs(seed, seed.probe);
    const after = await measured(seed.world, recommend, args);
    const before = await withoutSurfaces(seed, () =>
      measured(seed.world, recommend, args),
    );
    // A cold product's pallet, reserved into a cold area.
    const coldPallet = await seed.world.t.run(async (ctx) => {
      const productId = await ctx.db.insert("finishedGoodsProducts", {
        ...seed.audit,
        sku: "SKU-COLD",
        name: "Cold boxes",
        unit: "pieces",
        storageFormat: "PALLET",
        storageCondition: "COLD",
        status: "ACTIVE",
      });
      return ctx.db.insert("finishedGoodsPallets", {
        ...seed.audit,
        productId,
        code: "PAL-COLD",
        quantity: 1,
        lengthMm: 1000,
        widthMm: 1000,
        heightMm: 1000,
        status: "AWAITING_PLACEMENT",
      });
    });
    const coldTarget = (
      await measured<Recommended>(seed.world, recommend, {
        warehouseId: seed.warehouseId,
        palletId: coldPallet,
      })
    ).value.candidates.find((c) => (seed.cold as string[]).includes(c.zoneId))!;
    expect(coldTarget).toBeDefined();
    const cold = await recordWrites(
      seed.world,
      reserve,
      reserveArgs(seed, coldPallet, "reserve-cold", coldTarget),
    );
    // A dry pallet reserved into an area the probe can use.
    const dryTarget = (
      await measured<Recommended>(seed.world, recommend, {
        warehouseId: seed.warehouseId,
        palletId: seed.other,
      })
    ).value.candidates.find((c) => c.zoneId === (seed.simple[3] as string))!;
    const dry = await recordWrites(
      seed.world,
      reserve,
      reserveArgs(seed, seed.other, "reserve-dry", dryTarget),
    );
    const tables = (readSet: ReadSet, writes: typeof cold.writes) =>
      [...new Set(rerunsOn(readSet, writes).map((w) => w.table))].sort();
    const reruns = {
      coldBefore: tables(before.readSet, cold.writes),
      coldAfter: tables(after.readSet, cold.writes),
      dryBefore: tables(before.readSet, dry.writes),
      dryAfter: tables(after.readSet, dry.writes),
    };
    console.info(`list re-runs by write: ${JSON.stringify(reruns)}`);
    // Iteration 7 read every zone's occupancy, so a reservation in a cold
    // area re-ran the dry list; it no longer does.
    expect(reruns.coldBefore).toEqual(["storageZoneOccupancy"]);
    expect(reruns.coldAfter).toEqual([]);
    // A reservation in an area the probe can use changes what it is offered.
    expect(reruns.dryBefore).toEqual(["storageZoneOccupancyEntries"]);
    expect(reruns.dryAfter).toEqual(["storageZoneOccupancyEntries"]);
  }, 120000);

  it("are distrusted after layout writes by code that does not maintain them", async () => {
    const seed = await warehouseWorld();
    expect((await backfillOccupancy(seed)).ready).toBe(true);
    const args = listArgs(seed, seed.probe);
    const trusted = await measured<RecommendationPayload>(
      seed.world,
      recommend,
      args,
    );
    // Code that predates surface rows: its tracked layout write advances the
    // layout generation but leaves the surface rows as they were.
    await seed.world.t.run(async (ctx) => {
      await ctx.db.patch(seed.cold[0]!, { storageCondition: "DRY" });
      const signal = (
        await ctx.db.query("storageCatalogueSignals").collect()
      ).find((row) => row.warehouseId === seed.warehouseId)!;
      await ctx.db.patch(signal._id, { generation: signal.generation + 1 });
    });
    const distrusted = await measured<RecommendationPayload>(
      seed.world,
      recommend,
      args,
    );
    expect(distrusted.stats.ranges["storageZoneSurfaces"] ?? 0).toBe(0);
    expect(distrusted.value).not.toEqual(trusted.value);
    expect(
      distrusted.value.candidates.some(
        (c) => c.zoneId === (seed.cold[0] as string),
      ),
    ).toBe(true);
    await expectOccupancyParity(seed, seed.probe);
    // The hourly sweep restarts the backfill; then the rows are trusted again.
    const started = await seed.world.t.run((ctx) =>
      (
        sweepZoneOccupancy as unknown as {
          _handler(
            ctx: GenericMutationCtx<DataModel>,
            args: unknown,
          ): Promise<{ started: number }>;
        }
      )._handler(ctx, {}),
    );
    expect(started.started).toBeGreaterThan(0);
    expect((await backfillOccupancy(seed)).ready).toBe(true);
    const rebuilt = await expectSurfaceParity(seed, seed.probe);
    expect(rebuilt.derived.list).toEqual(distrusted.value);
  }, 120000);

  it("defer a layout change too large for one transaction, exact meanwhile", async () => {
    const seed = await scaleWorld();
    await addZones(seed, SURFACE_REFRESH_ZONE_BUDGET + 5);
    await addPallets(seed, 3);
    await linkPlacements(seed);
    const upper = await measuredPallet(seed, "PAL-UPPER");
    expect((await backfillOccupancy(seed)).ready).toBe(true);
    await expectSurfaceParity(seed, upper);
    const zones = await seed.world.t.run((ctx) =>
      ctx.db.query("storageZones").collect(),
    );
    expect(zones.length).toBeGreaterThan(SURFACE_REFRESH_ZONE_BUDGET);
    // One mutation relabels every area and dries the cold ones.
    await trackedWrite(seed, async (db) => {
      for (const zone of zones)
        await db.patch("storageZones", zone._id, {
          label: `${zone.label}!`,
          storageCondition: "DRY",
        });
    });
    expect(await readinessRow(seed)).toMatchObject({
      ready: false,
      stale: true,
    });
    // Readers use the layout until the rebuild: exact, and the change shows.
    const meanwhile = await measured<RecommendationPayload>(
      seed.world,
      recommend,
      listArgs(seed, upper),
    );
    expect(meanwhile.stats.ranges["storageZoneSurfaces"] ?? 0).toBe(0);
    expect(meanwhile.value.candidates.length).toBe(zones.length);
    expect((await backfillOccupancy(seed)).ready).toBe(true);
    await expectSurfaceParity(seed, upper);
    // Likewise a mutation writing more locations than the budget.
    const locations = await seed.world.t.run((ctx) =>
      ctx.db.query("locations").collect(),
    );
    expect(locations.length).toBeLessThanOrEqual(
      SURFACE_REFRESH_LOCATION_BUDGET,
    );
  }, 300000);

  it("serve stack facts from occupancy, exact for moving and occupied supports", async () => {
    const seed = await scaleWorld();
    await addZones(seed, 2);
    const target = await seed.world.t.run(async (ctx) => {
      const zone = (await ctx.db.query("storageZones").collect())[1]!;
      await ctx.db.patch(zone._id, { storageCondition: "DRY" });
      return zone;
    });
    await addPallets(seed, 5);
    await linkPlacements(seed);
    const pallets = new Map(
      (
        await seed.world.t.run(async (ctx) => {
          const all = await ctx.db.query("finishedGoodsPallets").collect();
          for (const pallet of all)
            await ctx.db.patch(pallet._id, {
              stackable: true,
              maxStackLevels: 3,
            });
          return all;
        })
      ).map((pallet) => [pallet.code, pallet]),
    );
    const probe = await measuredPallet(seed, "PAL-PROBE");
    const other = await measuredPallet(seed, "PAL-OTHER");
    expect((await backfillOccupancy(seed)).ready).toBe(true);
    const blockedReasons = (value: unknown) =>
      new Set(
        (
          value as {
            candidates: { previewSupports: { blockedReason?: string }[] }[];
          }
        ).candidates.flatMap((c) =>
          c.previewSupports.flatMap((s) =>
            s.blockedReason ? [s.blockedReason] : [],
          ),
        ),
      );
    // PAL-4 starts moving to the other area.
    const moving = pallets.get("PAL-4")!;
    const destination = (
      await measured<Recommended>(seed.world, recommendMove, {
        warehouseId: seed.warehouseId,
        palletId: moving._id,
      })
    ).value.candidates.find((c) => c.zoneId === target._id)!;
    accepted(
      await call(seed.world, reserveMove, {
        warehouseId: seed.warehouseId,
        palletId: moving._id,
        requestId: "facts-move",
        zoneId: destination.zoneId,
        xMm: destination.xMm,
        yMm: destination.yMm,
        rotation: destination.rotation,
        expectedSourcePlacementId: moving.placementId,
      }),
    );
    // Another pallet is reserved on top of PAL-3.
    const onTop = (
      await measured<Recommended>(seed.world, recommend, {
        warehouseId: seed.warehouseId,
        palletId: other,
      })
    ).value.candidates.find(
      (c) => c.supportPalletId === pallets.get("PAL-3")!._id,
    )!;
    expect(onTop).toBeDefined();
    accepted(
      await call(
        seed.world,
        reserve,
        reserveArgs(seed, other, "facts-stack", onTop),
      ),
    );
    const blocked = await expectOccupancyParity(seed, probe);
    const reasons = blockedReasons(blocked.derived.values.recommendation);
    expect(reasons).toContain("STACK_SUPPORT_MOVING");
    expect(reasons).toContain("STACK_SUPPORT_OCCUPIED");
    // The list asks no move or stack range of the supports in derived rows.
    const args = listArgs(seed, probe);
    const derived = await measured(seed.world, recommend, args);
    await setOccupancyReady(seed, false);
    const raw = await measured(seed.world, recommend, args);
    await setOccupancyReady(seed, true);
    expect(derived.value).toEqual(raw.value);
    expect(derived.stats.ranges["finishedGoodsMoves"] ?? 0).toBe(0);
    expect(raw.stats.ranges["finishedGoodsMoves"]).toBeGreaterThan(4);
    console.info(
      `stack facts: list index ranges ${JSON.stringify({
        raw: {
          finishedGoodsMoves: raw.stats.ranges["finishedGoodsMoves"],
          finishedGoodsPlacements: raw.stats.ranges["finishedGoodsPlacements"],
        },
        derived: {
          finishedGoodsMoves: derived.stats.ranges["finishedGoodsMoves"] ?? 0,
          finishedGoodsPlacements:
            derived.stats.ranges["finishedGoodsPlacements"] ?? 0,
        },
      })}`,
    );
    // Both clear through tracked writes, and the facts follow.
    const move = await seed.world.t.run(
      async (ctx) => (await ctx.db.query("finishedGoodsMoves").collect())[0]!,
    );
    accepted(
      await call(seed.world, cancelMove, {
        warehouseId: seed.warehouseId,
        palletId: moving._id,
        requestId: "facts-move-cancel",
        moveId: move._id,
      }),
    );
    accepted(
      await call(seed.world, cancelReservation, {
        warehouseId: seed.warehouseId,
        palletId: other,
        requestId: "facts-stack-cancel",
      }),
    );
    const cleared = await expectOccupancyParity(seed, probe);
    const after = blockedReasons(cleared.derived.values.recommendation);
    expect(after).not.toContain("STACK_SUPPORT_MOVING");
    expect(after).not.toContain("STACK_SUPPORT_OCCUPIED");
  }, 120000);

  it("ignore entries rows of an earlier version and rebuild them on the next write", async () => {
    const seed = await scaleWorld();
    await addZones(seed, 2);
    await addPallets(seed, 6);
    await linkPlacements(seed);
    const upper = await measuredPallet(seed, "PAL-UPPER");
    expect((await backfillOccupancy(seed)).ready).toBe(true);
    const current = await expectOccupancyParity(seed, upper);
    const entries = await seed.world.t.run(async (ctx) =>
      (await ctx.db.query("storageZoneOccupancyEntries").collect()).find(
        (row) => row.zoneId === seed.zone._id,
      ),
    );
    // A row as code before the projection wrote it: whole placement copies.
    await seed.world.t.run(async (ctx) => {
      const placements = await ctx.db
        .query("finishedGoodsPlacements")
        .withIndex("by_orgId_zoneId_status", (q) =>
          q.eq("orgId", seed.world.orgA).eq("zoneId", seed.zone._id),
        )
        .collect();
      await ctx.db.replace(entries!._id, {
        orgId: entries!.orgId,
        warehouseId: entries!.warehouseId,
        zoneId: entries!.zoneId,
        version: 1,
        complete: true,
        placements,
        pallets: entries!.pallets,
      });
    });
    const old = await expectOccupancyParity(seed, upper);
    expect(old.derived.values).toEqual(current.derived.values);
    expect(old.derived.docs.inventory).toBeGreaterThan(
      current.derived.docs.inventory,
    );
    await reserveFirst(seed, upper, "reserve-after-old-row");
    expect(
      await seed.world.t.run(async (ctx) => ctx.db.get(entries!._id)),
    ).toMatchObject({ version: 2, buildingId: seed.building._id });
    await expectOccupancyParity(seed, upper);
  }, 120000);

  it("cut the bytes of entries rows, the inventory and a reservation's writes", async () => {
    const seed = await warehouseWorld();
    expect((await backfillOccupancy(seed)).ready).toBe(true);
    const building = {
      warehouseId: seed.warehouseId,
      buildingId: seed.building._id,
    };
    const derived = await measured(
      seed.world,
      getStorageBuildingInventory,
      building,
    );
    // The same rows as version 1 stored them: whole placement copies and
    // full pallet facts.
    type EntriesLike = Record<string, unknown> & {
      placements: { _id: string }[];
      pallets: { _id: string }[];
    };
    const versionOne = async (
      ctx: GenericMutationCtx<DataModel>,
      row: EntriesLike,
    ) =>
      payloadBytes({
        ...row,
        placements: await Promise.all(
          row.placements.map((p) =>
            ctx.db.get(p._id as Id<"finishedGoodsPlacements">),
          ),
        ),
        pallets: await Promise.all(
          row.pallets.map(async (p) =>
            palletFacts(
              (await ctx.db.get(p._id as Id<"finishedGoodsPallets">))!,
            ),
          ),
        ),
      });
    const { projected, copies } = await seed.world.t.run(async (ctx) => {
      let projected = 0;
      let copies = 0;
      for (const row of await ctx.db
        .query("storageZoneOccupancyEntries")
        .collect()) {
        projected += payloadBytes(row);
        copies += await versionOne(ctx, row as unknown as EntriesLike);
      }
      return { projected, copies };
    });
    await setOccupancyReady(seed, false);
    const raw = await measured(
      seed.world,
      getStorageBuildingInventory,
      building,
    );
    await setOccupancyReady(seed, true);
    expect(derived.value).toEqual(raw.value);
    console.info(
      [
        `entries rows: ${(projected / 1024).toFixed(1)} KB (version 1: ${(copies / 1024).toFixed(1)} KB)`,
        summary("inventory, placements", raw.stats, raw.value),
        summary("inventory, entries rows", derived.stats, derived.value),
      ].join("\n"),
    );
    expect(projected * 10).toBeLessThan(copies * 6);
    // A reservation rewrites its zone's rows: the entries row is the bulk.
    const target = (
      await measured<Recommended>(seed.world, recommend, {
        warehouseId: seed.warehouseId,
        palletId: seed.other,
      })
    ).value.candidates.find((c) => c.zoneId === (seed.simple[3] as string))!;
    const { writes } = await recordWrites(
      seed.world,
      reserve,
      reserveArgs(seed, seed.other, "reserve-bytes", target),
    );
    const written = writes.find(
      (w) => w.table === "storageZoneOccupancyEntries",
    )!;
    const asCopies = await seed.world.t.run((ctx) =>
      versionOne(ctx, written.after as EntriesLike),
    );
    console.info(
      `reservation's entries write: ${(payloadBytes(written.after) / 1024).toFixed(1)} KB (version 1: ${(asCopies / 1024).toFixed(1)} KB)`,
    );
    expect(payloadBytes(written.after) * 10).toBeLessThan(asCopies * 6);
  }, 120000);
});
