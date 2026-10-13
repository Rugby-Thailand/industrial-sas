import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";

import {
  create as registerNamedLocation,
  page as namedLocationPage,
  resolve as resolveJobLocation,
} from "../../convex/finishedGoods/jobScanLocations";
import type { DataModel } from "../../convex/schema";
import { getStorageBuilding } from "../../convex/storageLayouts/catalogue";
import { completeNamedLocationLayout } from "../../convex/storageLayouts/namedLayout";
import {
  activateStorageBuilding,
  archiveStorageBuilding,
  buildingLifecycleImpact,
  createStorageBuilding,
  layoutReadiness,
  removeTopStorageFloor,
  returnStorageBuildingToDraft,
  saveStorageFloor,
} from "../../convex/storageLayouts/writes";
import {
  createStoragePosition,
  createStorageZone,
  generateRackStoragePositions,
  resolveStorageAddress,
  updateStorageZone,
} from "../../convex/storageLayouts/zones";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";

interface RuntimeFunction {
  readonly _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
}
type Outcome = Record<string, unknown>;

async function call(world: ConvexTenantWorld, fn: unknown, args: unknown) {
  return (await world.t
    .withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_a" })
    .run(async (ctx) =>
      (fn as RuntimeFunction)._handler(
        ctx as GenericMutationCtx<DataModel>,
        args,
      ),
    )) as Outcome;
}
function value(outcome: Outcome) {
  expect(outcome["ok"], JSON.stringify(outcome)).toBe(true);
  return outcome["value"] as Outcome;
}

async function plannerWorld(floorCount = 2) {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
  const warehouseId = world.warehouses.alphaA;
  const buildingId = value(
    await call(world, createStorageBuilding, {
      warehouseId,
      requestId: "create-building",
      code: "PD",
      name: "PD",
      widthMm: 20_000,
      depthMm: 11_960,
      defaultFloorHeightMm: 4_000,
      floorCount,
    }),
  )["documentId"] as string;
  return { world, warehouseId, buildingId };
}

async function zone(
  context: Awaited<ReturnType<typeof plannerWorld>>,
  requestId: string,
  extra: Record<string, unknown> = {},
) {
  return value(
    await call(context.world, createStorageZone, {
      warehouseId: context.warehouseId,
      buildingId: context.buildingId,
      floorNumber: 1,
      requestId,
      label: requestId,
      xMm: 0,
      yMm: 0,
      widthMm: 2_000,
      depthMm: 2_000,
      maxStackHeightMm: 3_000,
      ...extra,
    }),
  );
}

async function building(context: Awaited<ReturnType<typeof plannerWorld>>) {
  const detail = value(
    await call(context.world, getStorageBuilding, {
      warehouseId: context.warehouseId,
      buildingId: context.buildingId,
    }),
  ) as {
    building: { version: number; floorCount: number; status: string };
    floors: {
      floorNumber: number;
      version: number;
      storageZones: {
        zoneId: string;
        revision: string;
        positions: { kind: string; qrValue: string }[];
      }[];
    }[];
  };
  return detail;
}

describe("storage layout action safety", () => {
  it("replays a lost-response floor save instead of reporting a version conflict", async () => {
    const context = await plannerWorld();
    const before = await building(context);
    const save = {
      warehouseId: context.warehouseId,
      buildingId: context.buildingId,
      requestId: "save-floor-once",
      expectedBuildingVersion: before.building.version,
      expectedFloorVersion: before.floors[0]!.version,
      floor: {
        floorNumber: 1,
        reservedBlocks: [
          {
            id: "aisle",
            label: "Aisle",
            areaKind: "AISLE",
            displayHeightMm: 0,
            xMm: 10_000,
            yMm: 0,
            widthMm: 1_960,
            depthMm: 11_960,
          },
        ],
      },
    };
    expect(
      value(await call(context.world, saveStorageFloor, save)),
    ).toMatchObject({ written: true, replayed: false });
    expect(
      value(await call(context.world, saveStorageFloor, save)),
    ).toMatchObject({ written: true, replayed: true });
  });

  it("rejects a stale spot draft and replays the same accepted request", async () => {
    const context = await plannerWorld();
    const created = await zone(context, "A");
    const revision = (await building(context)).floors[0]!.storageZones[0]!
      .revision;
    const edit = (requestId: string, label: string) => ({
      warehouseId: context.warehouseId,
      zoneId: created["documentId"],
      requestId,
      expectedRevision: revision,
      label,
      xMm: 0,
      yMm: 0,
      widthMm: 2_000,
      depthMm: 2_000,
      maxStackHeightMm: 3_000,
    });
    const first = edit("rename-1", "First manager");
    expect(
      value(await call(context.world, updateStorageZone, first)),
    ).toMatchObject({ written: true });
    expect(
      value(await call(context.world, updateStorageZone, first)),
    ).toMatchObject({ written: true, replayed: true });
    expect(
      value(
        await call(context.world, updateStorageZone, edit("rename-2", "Stale")),
      ),
    ).toMatchObject({ written: false, error: { code: "VERSION_CONFLICT" } });
  });

  it("reports server readiness and blocks a rack spot without exact positions", async () => {
    const context = await plannerWorld();
    const empty = value(
      await call(context.world, layoutReadiness, {
        warehouseId: context.warehouseId,
        buildingId: context.buildingId,
      }),
    );
    expect(empty).toMatchObject({ ready: false, zoneCount: 0 });
    expect(empty["issues"]).toContainEqual(
      expect.objectContaining({
        code: "STORAGE_STACK_REQUIRED",
        blocking: true,
      }),
    );
    const rack = await zone(context, "Rack", { mode: "RACK" });
    const blocked = value(
      await call(context.world, activateStorageBuilding, {
        warehouseId: context.warehouseId,
        buildingId: context.buildingId,
        requestId: "activate-early",
        expectedVersion: (await building(context)).building.version,
      }),
    );
    expect(blocked).toMatchObject({
      written: false,
      error: { code: "AREA_REQUIRES_LEAF_POSITION" },
    });
    const generate = {
      warehouseId: context.warehouseId,
      zoneId: rack["documentId"],
      requestId: "rack-r1",
      fixtureCode: "R1",
      bayCount: 2,
      levelCount: 2,
      slotsPerBay: 1,
      bayWidthMm: 1_000,
      rackDepthMm: 1_000,
      levelHeightMm: 1_000,
    };
    expect(
      value(await call(context.world, generateRackStoragePositions, generate)),
    ).toMatchObject({ written: true, createdCount: 4, replayed: false });
    // A retried command replays rather than refusing at the position limit.
    expect(
      value(await call(context.world, generateRackStoragePositions, generate)),
    ).toMatchObject({ written: true, createdCount: 4, replayed: true });
    // A different command for the same rack identity writes nothing.
    expect(
      value(
        await call(context.world, generateRackStoragePositions, {
          ...generate,
          requestId: "rack-r1-again",
        }),
      ),
    ).toMatchObject({
      written: false,
      error: { code: "RACK_CODE_CONFLICT" },
    });
    const ready = value(
      await call(context.world, layoutReadiness, {
        warehouseId: context.warehouseId,
        buildingId: context.buildingId,
      }),
    );
    expect(ready).toMatchObject({ ready: true, zoneCount: 1 });
    expect(ready["issues"]).toContainEqual(
      expect.objectContaining({ code: "FLOOR_HAS_NO_STORAGE", floorNumber: 2 }),
    );
    expect(
      (await building(context)).floors[0]!.storageZones[0]!.positions,
    ).toHaveLength(4);
  });

  it("retires the automatic leaf on a mode change and keeps the spot QR", async () => {
    const context = await plannerWorld();
    const created = await zone(context, "Grid");
    const current = (await building(context)).floors[0]!.storageZones[0]!;
    const base = {
      warehouseId: context.warehouseId,
      zoneId: created["documentId"],
      label: "Grid",
      xMm: 0,
      yMm: 0,
      widthMm: 2_000,
      depthMm: 2_000,
      maxStackHeightMm: 3_000,
    };
    value(
      await call(context.world, updateStorageZone, {
        ...base,
        requestId: "to-grid",
        mode: "FLOOR_POSITIONS",
        expectedRevision: current.revision,
      }),
    );
    expect(
      (await building(context)).floors[0]!.storageZones[0]!.positions,
    ).toHaveLength(0);
    value(
      await call(context.world, createStoragePosition, {
        warehouseId: context.warehouseId,
        zoneId: created["documentId"],
        requestId: "p1",
        code: "P1",
        label: "P1",
        xMm: 0,
        yMm: 0,
        widthMm: 1_000,
        depthMm: 1_000,
      }),
    );
    const withPosition = (await building(context)).floors[0]!.storageZones[0]!;
    expect(
      value(
        await call(context.world, updateStorageZone, {
          ...base,
          requestId: "back-simple",
          mode: "SIMPLE",
          expectedRevision: withPosition.revision,
        }),
      ),
    ).toMatchObject({
      written: false,
      error: { code: "AREA_HAS_EXACT_POSITIONS" },
    });
    expect(created["qrValue"]).toBe(current.positions[0]!.qrValue);
  });

  it("removes only an empty top floor and refuses floors with spots or registrations", async () => {
    const context = await plannerWorld(3);
    const remove = async (floorNumber: number, requestId: string) =>
      value(
        await call(context.world, removeTopStorageFloor, {
          warehouseId: context.warehouseId,
          buildingId: context.buildingId,
          requestId,
          expectedVersion: (await building(context)).building.version,
          floorNumber,
        }),
      );
    expect(await remove(2, "not-top")).toMatchObject({
      error: { code: "FLOOR_NOT_TOP" },
    });
    expect(await remove(3, "remove-3")).toMatchObject({ written: true });
    const after = await building(context);
    expect(after.building.floorCount).toBe(2);
    expect(after.floors.map((floor) => floor.floorNumber)).toEqual([1, 2]);
    await zone(context, "Ground");
    // Floor 1 now has a spot; with floor 2 removed it would be the top floor.
    expect(await remove(2, "remove-2")).toMatchObject({ written: true });
    expect(await remove(1, "remove-1")).toMatchObject({
      error: { code: "FLOOR_COUNT_MINIMUM" },
    });
  });

  it("refuses removing a top floor named by a registered location", async () => {
    const context = await plannerWorld(2);
    await zone(context, "Ground");
    value(
      await call(context.world, activateStorageBuilding, {
        warehouseId: context.warehouseId,
        buildingId: context.buildingId,
        requestId: "activate",
        expectedVersion: (await building(context)).building.version,
      }),
    );
    const floor2 = await context.world.t.run(async (ctx) =>
      (await ctx.db.query("storageFloors").collect()).find(
        (row) => row.floorNumber === 2,
      ),
    );
    value(
      await call(context.world, registerNamedLocation, {
        warehouseId: context.warehouseId,
        requestId: "register-upper",
        code: "UPPER SHELF",
        buildingId: context.buildingId,
        floorId: floor2!._id,
      }),
    );
    expect(
      value(
        await call(context.world, removeTopStorageFloor, {
          warehouseId: context.warehouseId,
          buildingId: context.buildingId,
          requestId: "remove-upper",
          expectedVersion: (await building(context)).building.version,
          floorNumber: 2,
        }),
      ),
    ).toMatchObject({ error: { code: "FLOOR_HAS_REGISTRATIONS" } });
  });

  it("completes the layout of a registered location without changing its identity", async () => {
    const context = await plannerWorld(1);
    await zone(context, "Existing");
    value(
      await call(context.world, activateStorageBuilding, {
        warehouseId: context.warehouseId,
        buildingId: context.buildingId,
        requestId: "activate",
        expectedVersion: (await building(context)).building.version,
      }),
    );
    const registered = value(
      await call(context.world, registerNamedLocation, {
        warehouseId: context.warehouseId,
        requestId: "register",
        code: "Dock shelf",
        name: "Dock shelf",
        buildingId: context.buildingId,
      }),
    );
    const locationId = registered["documentId"] as string;
    const complete = (overrides: Record<string, unknown>) => ({
      warehouseId: context.warehouseId,
      locationId,
      buildingId: context.buildingId,
      requestId: "complete",
      expectedVersion: 1,
      floorNumber: 1,
      xMm: 4_000,
      yMm: 0,
      widthMm: 1_200,
      depthMm: 1_000,
      maxStackHeightMm: 2_500,
      ...overrides,
    });
    expect(
      value(
        await call(
          context.world,
          completeNamedLocationLayout,
          complete({ requestId: "overlap", xMm: 0 }),
        ),
      ),
    ).toMatchObject({ error: { code: "ZONE_OVERLAPS_STORAGE_ZONE" } });
    expect(
      value(
        await call(
          context.world,
          completeNamedLocationLayout,
          complete({ requestId: "stale", expectedVersion: 7 }),
        ),
      ),
    ).toMatchObject({ error: { code: "VERSION_CONFLICT" } });
    const done = value(
      await call(context.world, completeNamedLocationLayout, complete({})),
    );
    expect(done).toMatchObject({
      written: true,
      code: "DOCK SHELF",
      qrValue: `ISAS:LOCATION:1:${locationId}`,
    });
    expect(
      value(
        await call(context.world, completeNamedLocationLayout, complete({})),
      ),
    ).toMatchObject({ written: true, replayed: true });
    const location = await context.world.t.run(async (ctx) =>
      ctx.db.get(locationId as never),
    );
    expect(location).toMatchObject({
      _id: locationId,
      code: "DOCK SHELF",
      locationType: "FLOOR_BLOCK",
      status: "ACTIVE",
      version: 2,
    });
    // The same QR now resolves to a mapped physical spot.
    expect(
      await call(context.world, resolveJobLocation, {
        warehouseId: context.warehouseId,
        code: `ISAS:LOCATION:1:${locationId}`,
      }),
    ).toMatchObject({
      ok: true,
      value: { ok: true, location: { locationId, layoutPending: false } },
    });
    expect(
      value(
        await call(context.world, resolveStorageAddress, {
          warehouseId: context.warehouseId,
          scan: `ISAS:LOCATION:1:${locationId}`,
        }),
      ),
    ).toMatchObject({ found: true, resolution: "AREA_AUTO" });
    const named = value(
      await call(context.world, namedLocationPage, {
        warehouseId: context.warehouseId,
        pageSize: 20,
      }),
    );
    expect(named["items"]).toEqual([]);
  });

  it("keeps lifecycle changes whole-building, counted, and non-repeating", async () => {
    const context = await plannerWorld(1);
    await zone(context, "Only");
    const version = async () => (await building(context)).building.version;
    value(
      await call(context.world, activateStorageBuilding, {
        warehouseId: context.warehouseId,
        buildingId: context.buildingId,
        requestId: "activate",
        expectedVersion: await version(),
      }),
    );
    expect(
      value(
        await call(context.world, buildingLifecycleImpact, {
          warehouseId: context.warehouseId,
          buildingId: context.buildingId,
        }),
      ),
    ).toMatchObject({
      status: "ACTIVE",
      zoneCount: 1,
      positionCount: 0,
      occupied: false,
    });
    value(
      await call(context.world, returnStorageBuildingToDraft, {
        warehouseId: context.warehouseId,
        buildingId: context.buildingId,
        requestId: "draft",
        expectedVersion: await version(),
      }),
    );
    expect(
      value(
        await call(context.world, archiveStorageBuilding, {
          warehouseId: context.warehouseId,
          buildingId: context.buildingId,
          requestId: "archive",
          expectedVersion: await version(),
        }),
      ),
    ).toMatchObject({ written: true });
    expect(
      value(
        await call(context.world, archiveStorageBuilding, {
          warehouseId: context.warehouseId,
          buildingId: context.buildingId,
          requestId: "archive-twice",
          expectedVersion: await version(),
        }),
      ),
    ).toMatchObject({ error: { code: "LAYOUT_NOT_EDITABLE" } });
    expect(
      value(
        await call(context.world, returnStorageBuildingToDraft, {
          warehouseId: context.warehouseId,
          buildingId: context.buildingId,
          requestId: "draft-archived",
          expectedVersion: await version(),
        }),
      ),
    ).toMatchObject({ error: { code: "LAYOUT_NOT_EDITABLE" } });
  });
});
