import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";

import {
  getStorageBuilding,
  getStorageLocationMap,
} from "../../convex/storageLayouts/catalogue";
import { postTransaction } from "../../convex/inventory/ledger";
import {
  activateStorageBuilding,
  createStorageBuilding,
  saveStorageFloor,
} from "../../convex/storageLayouts/writes";
import {
  archiveStoragePosition,
  backfillStoragePositions,
  createStoragePosition,
  createStorageZone,
  generateRackStoragePositions,
  placeHandlingUnit,
  resolveStorageAddress,
  updateStoragePosition,
  updateStorageZone,
} from "../../convex/storageLayouts/zones";
import type { DataModel } from "../../convex/schema";
import {
  createConvexInventoryWorld,
  FIXTURE_UOM,
  type ConvexInventoryWorld,
} from "../fixtures/convex-inventory-world";

interface RuntimeFunction {
  readonly _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
}

const run = (value: unknown) => value as RuntimeFunction;
const identity = { subject: "user_fixture_a", org_id: "org_fixture_a" };

async function call(
  world: ConvexInventoryWorld,
  fn: unknown,
  args: unknown,
): Promise<Record<string, unknown>> {
  return (await world.t
    .withIdentity(identity)
    .run(async (ctx) =>
      run(fn)._handler(ctx as GenericMutationCtx<DataModel>, args),
    )) as Record<string, unknown>;
}

function value(outcome: Record<string, unknown>): Record<string, unknown> {
  expect(outcome["ok"], JSON.stringify(outcome)).toBe(true);
  return outcome["value"] as Record<string, unknown>;
}

describe("storage building planner", () => {
  it("creates, edits, summarizes, replays, and activates a warehouse layout", async () => {
    const world = await createConvexInventoryWorld();
    const warehouseId = world.warehouses.alphaA;
    const createArgs = {
      warehouseId,
      requestId: "storage-create-1",
      code: " bldg-a ",
      name: " Main storage ",
      widthMm: 30_000,
      depthMm: 20_000,
      defaultFloorHeightMm: 4_000,
      floorCount: 4,
    };
    const first = value(await call(world, createStorageBuilding, createArgs));
    const replay = value(await call(world, createStorageBuilding, createArgs));

    expect(first).toMatchObject({ written: true, replayed: false });
    expect(replay).toMatchObject({
      written: true,
      replayed: true,
      documentId: first["documentId"],
    });
    const buildingId = first["documentId"] as string;

    const stored = await world.t.run(async (ctx) => ({
      buildings: await ctx.db.query("storageBuildings").collect(),
      floors: await ctx.db.query("storageFloors").collect(),
    }));
    expect(stored.buildings).toHaveLength(1);
    expect(stored.buildings[0]).toMatchObject({
      code: "BLDG-A",
      name: "Main storage",
      grossAreaSqMm: 2_400_000_000,
      usableAreaSqMm: 2_400_000_000,
      status: "DRAFT",
    });
    expect(stored.floors).toHaveLength(4);

    const floorOne = stored.floors.find((floor) => floor.floorNumber === 1)!;
    const saved = value(
      await call(world, saveStorageFloor, {
        warehouseId,
        buildingId,
        requestId: "storage-floor-1",
        expectedBuildingVersion: 1,
        expectedFloorVersion: floorOne.version,
        floor: {
          floorNumber: 1,
          heightMm: 4_500,
          reservedBlocks: [
            {
              id: "staging",
              label: "Staging",
              xMm: 0,
              yMm: 0,
              widthMm: 8_000,
              depthMm: 6_000,
            },
          ],
        },
      }),
    );
    expect(saved).toMatchObject({ written: true, replayed: false });

    const detail = value(
      await call(world, getStorageBuilding, { warehouseId, buildingId }),
    );
    expect(detail["found"]).toBe(true);
    expect(detail["building"]).toMatchObject({
      totalHeightMm: 16_500,
      reservedAreaSqMm: 48_000_000,
      usableAreaSqMm: 2_352_000_000,
      version: 2,
    });
    const detailFloors = detail["floors"] as Record<string, unknown>[];
    expect(detailFloors[0]).toMatchObject({
      heightMm: 4_500,
      reservedAreaSqMm: 48_000_000,
    });

    const zoneArgs = {
      warehouseId,
      buildingId,
      floorNumber: 1,
      requestId: "storage-zone-1",
      label: "Finished goods stack",
      xMm: 10_000,
      yMm: 0,
      widthMm: 2_000,
      depthMm: 2_000,
      maxStackHeightMm: 4_500,
    };
    const zone = value(await call(world, createStorageZone, zoneArgs));
    const zoneReplay = value(await call(world, createStorageZone, zoneArgs));
    expect(zone).toMatchObject({
      written: true,
      replayed: false,
      code: "BLDG-A-F01-Z01",
    });
    expect(zoneReplay).toMatchObject({
      written: true,
      replayed: true,
      documentId: zone["documentId"],
    });
    const updatedZone = value(
      await call(world, updateStorageZone, {
        warehouseId,
        zoneId: zone["documentId"],
        requestId: "storage-zone-update-1",
        label: "Finished goods priority stack",
        xMm: 12_000,
        yMm: 1_000,
        widthMm: 3_000,
        depthMm: 2_500,
        maxStackHeightMm: 4_000,
      }),
    );
    expect(updatedZone).toMatchObject({
      written: true,
      replayed: false,
      documentId: zone["documentId"],
    });
    const updatedStoredZone = await world.t.run(async (ctx) =>
      ctx.db.get(zone["documentId"] as never),
    );
    expect(updatedStoredZone).toMatchObject({
      code: "BLDG-A-F01-Z01",
      label: "Finished goods priority stack",
      qrValue: zone["qrValue"],
      xMm: 12_000,
      yMm: 1_000,
      widthMm: 3_000,
      depthMm: 2_500,
      maxStackHeightMm: 4_000,
    });
    const linkedLocationId = (updatedStoredZone as { locationId: string })
      .locationId;
    const draftLocation = await world.t.run(async (ctx) =>
      ctx.db.get(linkedLocationId as never),
    );
    expect(draftLocation).toMatchObject({
      locationType: "FLOOR_BLOCK",
      status: "INACTIVE",
    });

    const overlappingFloor = value(
      await call(world, saveStorageFloor, {
        warehouseId,
        buildingId,
        requestId: "storage-floor-overlap-1",
        expectedBuildingVersion: 2,
        expectedFloorVersion: 2,
        floor: {
          floorNumber: 1,
          heightMm: 4_500,
          reservedBlocks: [
            {
              id: "blocked-stack",
              label: "Blocked stack",
              xMm: 12_000,
              yMm: 1_000,
              widthMm: 3_000,
              depthMm: 2_500,
            },
          ],
        },
      }),
    );
    expect(overlappingFloor).toMatchObject({
      written: false,
      error: { code: "ZONE_OVERLAPS_RESERVED_SPACE" },
    });

    const receipt = value(
      await call(world, postTransaction, {
        warehouseId,
        requestId: "0193f2c1-0000-7000-8000-000000000021",
        type: "RECEIPT",
        source: {
          type: "TEST",
          id: "0193f2c1-0000-7000-8000-000000000021",
        },
        lines: [
          {
            itemId: world.a.item,
            locationKind: "PHYSICAL",
            locationId: world.a.rack,
            lotId: world.a.lot,
            handlingUnitId: world.a.pallet,
            stockStatus: "AVAILABLE",
            quantity: { uom: FIXTURE_UOM, minorUnits: 1_000 },
          },
          {
            itemId: world.a.item,
            locationKind: "VIRTUAL",
            virtualBoundary: "SUPPLIER_RECEIPT",
            lotId: world.a.lot,
            handlingUnitId: world.a.pallet,
            stockStatus: "AVAILABLE",
            quantity: { uom: FIXTURE_UOM, minorUnits: -1_000 },
          },
        ],
      }),
    );
    expect(receipt["posted"], JSON.stringify(receipt)).toBe(true);

    const placementWhileDraft = value(
      await call(world, placeHandlingUnit, {
        warehouseId,
        requestId: "0193f2c1-0000-7000-8000-000000000020",
        lpn: "inv-0001-01",
        zoneScan: zone["qrValue"],
        widthMm: 1_200,
        depthMm: 1_000,
        heightMm: 1_400,
      }),
    );
    expect(placementWhileDraft).toMatchObject({
      written: false,
      error: { code: "ZONE_NOT_FOUND" },
    });

    const activated = value(
      await call(world, activateStorageBuilding, {
        warehouseId,
        buildingId,
        requestId: "storage-activate-1",
        expectedVersion: 2,
      }),
    );
    expect(activated["written"]).toBe(true);
    const activatedRows = await world.t.run(async (ctx) => ({
      building: await ctx.db.get(buildingId as never),
      location: await ctx.db.get(linkedLocationId as never),
    }));
    expect(activatedRows.building).toMatchObject({
      status: "ACTIVE",
      version: 3,
    });
    expect(activatedRows.location).toMatchObject({ status: "ACTIVE" });

    const placed = value(
      await call(world, placeHandlingUnit, {
        warehouseId,
        requestId: "0193f2c1-0000-7000-8000-000000000022",
        lpn: "inv-0001-01",
        zoneScan: zone["qrValue"],
        widthMm: 1_200,
        depthMm: 1_000,
        heightMm: 1_400,
      }),
    );
    expect(placed).toMatchObject({
      written: true,
      replayed: false,
      levelIndex: 1,
      capacityWarning: false,
    });

    const activeQuickChangeNeedsReview = value(
      await call(world, updateStorageZone, {
        warehouseId,
        zoneId: zone["documentId"],
        requestId: "storage-zone-active-update-review-1",
        label: "Finished goods live stack",
        xMm: 13_000,
        yMm: 1_000,
        widthMm: 3_000,
        depthMm: 2_500,
        maxStackHeightMm: 1_000,
      }),
    );
    expect(activeQuickChangeNeedsReview).toMatchObject({
      written: false,
      error: {
        code: "OCCUPIED_AREA_CONFIRMATION_REQUIRED",
        affectedLpns: ["INV-0001-01"],
      },
    });

    const activeQuickChange = value(
      await call(world, updateStorageZone, {
        warehouseId,
        zoneId: zone["documentId"],
        requestId: "storage-zone-active-update-1",
        label: "Finished goods live stack",
        xMm: 13_000,
        yMm: 1_000,
        widthMm: 3_000,
        depthMm: 2_500,
        maxStackHeightMm: 1_000,
        confirmOccupiedChange: true,
      }),
    );
    expect(activeQuickChange).toMatchObject({
      written: true,
      replayed: false,
      documentId: zone["documentId"],
    });

    const impossibleQuickChange = value(
      await call(world, updateStorageZone, {
        warehouseId,
        zoneId: zone["documentId"],
        requestId: "storage-zone-active-update-2",
        label: "Finished goods live stack",
        xMm: 13_000,
        yMm: 1_000,
        widthMm: 500,
        depthMm: 500,
        maxStackHeightMm: 1_000,
        confirmOccupiedChange: true,
      }),
    );
    expect(impossibleQuickChange).toMatchObject({
      written: false,
      error: { code: "HANDLING_UNIT_DOES_NOT_FIT" },
    });

    const newActiveZone = value(
      await call(world, createStorageZone, {
        warehouseId,
        buildingId,
        floorNumber: 1,
        requestId: "storage-zone-active-create-1",
        label: "Live overflow stack",
        xMm: 20_000,
        yMm: 0,
        widthMm: 2_000,
        depthMm: 2_000,
        maxStackHeightMm: 4_000,
      }),
    );
    const newActiveZoneRows = await world.t.run(async (ctx) => {
      const storedActiveZone = await ctx.db.get(
        newActiveZone["documentId"] as never,
      );
      return {
        zone: storedActiveZone,
        location: await ctx.db.get(
          (storedActiveZone as { locationId: string }).locationId as never,
        ),
      };
    });
    expect(newActiveZoneRows.zone).toMatchObject({
      code: "BLDG-A-F01-Z02",
      status: "ACTIVE",
    });
    expect(newActiveZoneRows.location).toMatchObject({ status: "ACTIVE" });

    const withZone = value(
      await call(world, getStorageBuilding, { warehouseId, buildingId }),
    );
    const withZoneFloors = withZone["floors"] as Record<string, unknown>[];
    expect(withZoneFloors[0]?.["storageZones"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "BLDG-A-F01-Z01",
          placements: [
            expect.objectContaining({ lpn: "INV-0001-01", levelIndex: 1 }),
          ],
        }),
      ]),
    );
    const locationMap = value(
      await call(world, getStorageLocationMap, {
        warehouseId,
        locationId: linkedLocationId,
      }),
    );
    expect(locationMap).toMatchObject({
      found: true,
      building: { code: "BLDG-A" },
      floor: { floorNumber: 1 },
      zone: {
        code: "BLDG-A-F01-Z01",
        xMm: 13_000,
        yMm: 1_000,
      },
    });
    const movedUnit = await world.t.run(async (ctx) =>
      ctx.db.get(world.a.pallet),
    );
    const storedZone = await world.t.run(async (ctx) =>
      ctx.db.get(zone["documentId"] as never),
    );
    expect(movedUnit).toMatchObject({
      currentLocationId: (storedZone as { locationId: string }).locationId,
      widthMm: 1_200,
      depthMm: 1_000,
      heightMm: 1_400,
    });
  });

  it("refuses activation until the draft contains a storage stack", async () => {
    const world = await createConvexInventoryWorld();
    const warehouseId = world.warehouses.alphaA;
    const created = value(
      await call(world, createStorageBuilding, {
        warehouseId,
        requestId: "storage-empty-create-1",
        code: "EMPTY",
        name: "Empty layout",
        widthMm: 10_000,
        depthMm: 10_000,
        defaultFloorHeightMm: 4_000,
        floorCount: 1,
      }),
    );

    const activated = value(
      await call(world, activateStorageBuilding, {
        warehouseId,
        buildingId: created["documentId"],
        requestId: "storage-empty-activate-1",
        expectedVersion: 1,
      }),
    );

    expect(activated).toMatchObject({
      written: false,
      error: { code: "STORAGE_STACK_REQUIRED" },
    });
  });

  it("keeps area scans unambiguous while floor and rack leaves stay exact", async () => {
    const world = await createConvexInventoryWorld();
    const warehouseId = world.warehouses.alphaA;
    const building = value(
      await call(world, createStorageBuilding, {
        warehouseId,
        requestId: "position-building-1",
        code: "POSITION-BLDG",
        name: "Exact storage",
        widthMm: 30_000,
        depthMm: 20_000,
        defaultFloorHeightMm: 6_000,
        floorCount: 1,
      }),
    );
    const buildingId = building["documentId"] as string;
    const bulk = value(
      await call(world, createStorageZone, {
        warehouseId,
        buildingId,
        floorNumber: 1,
        requestId: "bulk-area-1",
        label: "BULK-A",
        mode: "FLOOR_POSITIONS",
        xMm: 0,
        yMm: 0,
        widthMm: 12_000,
        depthMm: 8_000,
        maxStackHeightMm: 6_000,
      }),
    );
    const defaultPosition = await world.t.run(async (ctx) =>
      ctx.db
        .query("storagePositions")
        .withIndex("by_orgId_zoneId_status_code", (query) =>
          query
            .eq("orgId", world.orgA)
            .eq("zoneId", bulk["documentId"] as never)
            .eq("status", "ACTIVE"),
        )
        .first(),
    );
    expect(defaultPosition).toBeNull();

    const p12 = value(
      await call(world, createStoragePosition, {
        warehouseId,
        zoneId: bulk["documentId"],
        requestId: "bulk-p12-1",
        code: "P-12",
        label: "P-12",
        xMm: 1_000,
        yMm: 1_000,
        widthMm: 2_000,
        depthMm: 2_000,
      }),
    );
    value(
      await call(world, createStoragePosition, {
        warehouseId,
        zoneId: bulk["documentId"],
        requestId: "bulk-grid-b4-1",
        code: "GRID-B4",
        label: "GRID-B4",
        xMm: 4_000,
        yMm: 2_000,
        widthMm: 2_000,
        depthMm: 2_000,
      }),
    );

    const resolvedArea = value(
      await call(world, resolveStorageAddress, {
        warehouseId,
        scan: bulk["qrValue"],
      }),
    );
    expect(resolvedArea).toMatchObject({
      found: true,
      resolution: "AREA_NEEDS_POSITION",
      area: { label: "BULK-A" },
    });
    expect(resolvedArea["positions"]).toHaveLength(2);

    const activated = value(
      await call(world, activateStorageBuilding, {
        warehouseId,
        buildingId,
        requestId: "position-building-activate-1",
        expectedVersion: 1,
      }),
    );
    expect(activated).toMatchObject({ written: true });

    const receipt = value(
      await call(world, postTransaction, {
        warehouseId,
        requestId: "0193f2c1-0000-7000-8000-000000000031",
        type: "RECEIPT",
        source: { type: "TEST", id: "position-receipt" },
        lines: [
          {
            itemId: world.a.item,
            locationKind: "PHYSICAL",
            locationId: world.a.rack,
            lotId: world.a.lot,
            handlingUnitId: world.a.pallet,
            stockStatus: "AVAILABLE",
            quantity: { uom: FIXTURE_UOM, minorUnits: 1_000 },
          },
          {
            itemId: world.a.item,
            locationKind: "VIRTUAL",
            virtualBoundary: "SUPPLIER_RECEIPT",
            lotId: world.a.lot,
            handlingUnitId: world.a.pallet,
            stockStatus: "AVAILABLE",
            quantity: { uom: FIXTURE_UOM, minorUnits: -1_000 },
          },
        ],
      }),
    );
    expect(receipt["posted"]).toBe(true);
    const ambiguous = value(
      await call(world, placeHandlingUnit, {
        warehouseId,
        requestId: "0193f2c1-0000-7000-8000-000000000032",
        lpn: "INV-0001-01",
        zoneScan: bulk["qrValue"],
        widthMm: 1_200,
        depthMm: 1_000,
        heightMm: 1_400,
      }),
    );
    expect(ambiguous).toMatchObject({
      written: false,
      error: { code: "EXACT_POSITION_REQUIRED" },
    });

    const placed = value(
      await call(world, placeHandlingUnit, {
        warehouseId,
        requestId: "0193f2c1-0000-7000-8000-000000000033",
        lpn: "INV-0001-01",
        zoneScan: "POSITION-BLDG-F01-Z01-P-12",
        positionId: p12["documentId"],
        widthMm: 1_200,
        depthMm: 1_000,
        heightMm: 1_400,
      }),
    );
    expect(placed).toMatchObject({
      written: true,
      positionCode: "POSITION-BLDG-F01-Z01-P-12",
    });

    const beforeEdit = await world.t.run(async (ctx) =>
      ctx.db.get(p12["documentId"] as never),
    );
    const needsConfirmation = value(
      await call(world, updateStoragePosition, {
        warehouseId,
        positionId: p12["documentId"],
        requestId: "p12-move-1",
        label: "P-12 moved",
        xMm: 2_000,
        yMm: 1_000,
        widthMm: 2_000,
        depthMm: 2_000,
      }),
    );
    expect(needsConfirmation).toMatchObject({
      written: false,
      error: {
        code: "OCCUPIED_POSITION_CONFIRMATION_REQUIRED",
        affectedLpns: ["INV-0001-01"],
      },
    });
    value(
      await call(world, updateStoragePosition, {
        warehouseId,
        positionId: p12["documentId"],
        requestId: "p12-move-2",
        label: "P-12 moved",
        xMm: 2_000,
        yMm: 1_000,
        widthMm: 2_000,
        depthMm: 2_000,
        confirmOccupiedChange: true,
      }),
    );
    const afterEdit = await world.t.run(async (ctx) =>
      ctx.db.get(p12["documentId"] as never),
    );
    expect(afterEdit).toMatchObject({
      locationId: (beforeEdit as { locationId: string }).locationId,
      qrValue: (beforeEdit as { qrValue: string }).qrValue,
      xMm: 2_000,
    });
    const occupiedDelete = value(
      await call(world, archiveStoragePosition, {
        warehouseId,
        positionId: p12["documentId"],
        requestId: "p12-archive-1",
      }),
    );
    expect(occupiedDelete).toMatchObject({
      written: false,
      error: { code: "POSITION_NOT_EMPTY" },
    });

    const rack = value(
      await call(world, createStorageZone, {
        warehouseId,
        buildingId,
        floorNumber: 1,
        requestId: "rack-area-1",
        label: "Finished goods rack",
        mode: "RACK",
        xMm: 14_000,
        yMm: 0,
        widthMm: 9_000,
        depthMm: 4_000,
        maxStackHeightMm: 6_000,
      }),
    );
    const generated = value(
      await call(world, generateRackStoragePositions, {
        warehouseId,
        zoneId: rack["documentId"],
        requestId: "rack-a-generate-1",
        fixtureCode: "RACK-A",
        bayCount: 3,
        levelCount: 2,
        slotsPerBay: 1,
        bayWidthMm: 3_000,
        rackDepthMm: 1_200,
        levelHeightMm: 1_800,
      }),
    );
    expect(generated).toMatchObject({ written: true, createdCount: 6 });
    const rackPositions = await world.t.run(async (ctx) =>
      ctx.db
        .query("storagePositions")
        .withIndex("by_orgId_zoneId_status_code", (query) =>
          query
            .eq("orgId", world.orgA)
            .eq("zoneId", rack["documentId"] as never)
            .eq("status", "ACTIVE"),
        )
        .collect(),
    );
    expect(rackPositions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fixtureCode: "RACK-A",
          bayIndex: 3,
          levelIndex: 2,
          elevationMm: 1_800,
        }),
      ]),
    );
  });

  it("backfills a legacy zone without changing its location or printed QR", async () => {
    const world = await createConvexInventoryWorld();
    const warehouseId = world.warehouses.alphaA;
    const building = value(
      await call(world, createStorageBuilding, {
        warehouseId,
        requestId: "legacy-building-1",
        code: "LEGACY-BLDG",
        name: "Legacy storage",
        widthMm: 10_000,
        depthMm: 10_000,
        defaultFloorHeightMm: 4_000,
        floorCount: 1,
      }),
    );
    const zone = value(
      await call(world, createStorageZone, {
        warehouseId,
        buildingId: building["documentId"],
        floorNumber: 1,
        requestId: "legacy-zone-1",
        label: "Legacy stack",
        xMm: 0,
        yMm: 0,
        widthMm: 4_000,
        depthMm: 4_000,
        maxStackHeightMm: 4_000,
      }),
    );
    const original = await world.t.run(async (ctx) => {
      const storedZone = await ctx.db.get(zone["documentId"] as never);
      const position = await ctx.db
        .query("storagePositions")
        .withIndex("by_orgId_zoneId_status_code", (query) =>
          query
            .eq("orgId", world.orgA)
            .eq("zoneId", zone["documentId"] as never)
            .eq("status", "ACTIVE"),
        )
        .unique();
      if (position !== null) await ctx.db.delete(position._id);
      return storedZone as { locationId: string; qrValue: string };
    });
    const backfilled = value(
      await call(world, backfillStoragePositions, {
        warehouseId,
        requestId: "legacy-backfill-1",
      }),
    );
    expect(backfilled).toMatchObject({ written: true, createdCount: 1 });
    const migrated = await world.t.run(async (ctx) =>
      ctx.db
        .query("storagePositions")
        .withIndex("by_orgId_locationId", (query) =>
          query
            .eq("orgId", world.orgA)
            .eq("locationId", original.locationId as never),
        )
        .unique(),
    );
    expect(migrated).toMatchObject({
      locationId: original.locationId,
      qrValue: original.qrValue,
      kind: "DEFAULT",
      isDefault: true,
    });
  });

  it("rejects a platform whose base plus stack height exceeds the floor", async () => {
    const world = await createConvexInventoryWorld();
    const warehouseId = world.warehouses.alphaA;
    const building = value(
      await call(world, createStorageBuilding, {
        warehouseId,
        requestId: "platform-height-building-1",
        code: "PLATFORM-BLDG",
        name: "Raised storage",
        widthMm: 20_000,
        depthMm: 20_000,
        defaultFloorHeightMm: 4_000,
        floorCount: 1,
      }),
    );

    const platform = value(
      await call(world, createStorageZone, {
        warehouseId,
        buildingId: building["documentId"],
        floorNumber: 1,
        requestId: "platform-height-zone-1",
        label: "Raised overflow",
        mode: "PLATFORM",
        baseElevationMm: 2_000,
        xMm: 0,
        yMm: 0,
        widthMm: 4_000,
        depthMm: 4_000,
        maxStackHeightMm: 3_000,
      }),
    );

    expect(platform).toMatchObject({
      written: false,
      error: { code: "BASE_ELEVATION_INVALID", field: "baseElevationMm" },
    });
  });
});
