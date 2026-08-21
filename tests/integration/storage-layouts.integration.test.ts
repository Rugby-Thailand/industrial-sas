import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";

import { getStorageBuilding } from "../../convex/storageLayouts/catalogue";
import {
  activateStorageBuilding,
  createStorageBuilding,
  saveStorageFloor,
} from "../../convex/storageLayouts/writes";
import type { DataModel } from "../../convex/schema";
import {
  createConvexInventoryWorld,
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
