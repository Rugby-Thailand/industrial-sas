import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";

import { getStorageBuilding } from "../../convex/storageLayouts/catalogue";
import { postTransaction } from "../../convex/inventory/ledger";
import {
  activateStorageBuilding,
  createStorageBuilding,
  saveStorageFloor,
} from "../../convex/storageLayouts/writes";
import {
  createStorageZone,
  placeHandlingUnit,
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

    const withZone = value(
      await call(world, getStorageBuilding, { warehouseId, buildingId }),
    );
    const withZoneFloors = withZone["floors"] as Record<string, unknown>[];
    expect(withZoneFloors[0]?.["storageZones"]).toEqual([
      expect.objectContaining({
        code: "BLDG-A-F01-Z01",
        placements: [
          expect.objectContaining({ lpn: "INV-0001-01", levelIndex: 1 }),
        ],
      }),
    ]);
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

    const activated = value(
      await call(world, activateStorageBuilding, {
        warehouseId,
        buildingId,
        requestId: "storage-activate-1",
        expectedVersion: 2,
      }),
    );
    expect(activated["written"]).toBe(true);
    const active = await world.t.run(async (ctx) =>
      ctx.db.get(buildingId as never),
    );
    expect(active).toMatchObject({ status: "ACTIVE", version: 3 });
  });
});
