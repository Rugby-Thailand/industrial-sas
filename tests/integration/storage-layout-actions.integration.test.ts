import type { Doc } from "../../convex/_generated/dataModel";
import {
  listJobScans,
  saveJobScans,
} from "../../convex/finishedGoods/jobScans";
import { trackDocumentReads } from "../fixtures/document-reads";
import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it, vi } from "vitest";

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
  archiveStoragePosition,
  updateStoragePosition,
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
  it("parent audit: refuses changed rack input under an already committed request identity", async () => {
    const context = await plannerWorld();
    const rack = await zone(context, "Rack", { mode: "RACK" });
    const args = {
      warehouseId: context.warehouseId,
      zoneId: rack["documentId"],
      requestId: "same-rack-command",
      fixtureCode: "R1",
      bayCount: 1,
      levelCount: 1,
      slotsPerBay: 1,
      bayWidthMm: 1000,
      rackDepthMm: 1000,
      levelHeightMm: 1000,
    };
    expect(
      value(await call(context.world, generateRackStoragePositions, args)),
    ).toMatchObject({ written: true, createdCount: 1 });
    const changed = value(
      await call(context.world, generateRackStoragePositions, {
        ...args,
        bayCount: 2,
      }),
    );
    expect(changed).toMatchObject({ written: false });
    expect(
      (await building(context)).floors[0]!.storageZones[0]!.positions,
    ).toHaveLength(1);
  });

  it("parent audit: retains a floor referenced by an inactive named location", async () => {
    const context = await plannerWorld();
    const floor = await context.world.t.run(async (ctx) =>
      (await ctx.db.query("storageFloors").collect()).find(
        (row) => row.floorNumber === 2,
      )!,
    );
    await context.world.t.run((ctx) =>
      ctx.db.insert("locations", {
        orgId: context.world.orgA,
        warehouseId: context.warehouseId,
        buildingId: floor.buildingId,
        floorId: floor._id,
        code: "HISTORICAL-FLOOR-2",
        locationType: "NAMED_STORAGE",
        status: "INACTIVE",
      }),
    );
    expect(
      value(
        await call(context.world, removeTopStorageFloor, {
          warehouseId: context.warehouseId,
          buildingId: context.buildingId,
          requestId: "keep-referenced-floor",
          floorNumber: 2,
          expectedVersion: (await building(context)).building.version,
        }),
      ),
    ).toMatchObject({ written: false });
    expect(
      await context.world.t.run((ctx) => ctx.db.get(floor._id)),
    ).not.toBeNull();
  });

  it("parent audit: refuses a zone editor without a revision instead of overwriting another tab", async () => {
    const context = await plannerWorld();
    const created = await zone(context, "Original");
    expect(
      value(
        await call(context.world, updateStorageZone, {
          warehouseId: context.warehouseId,
          zoneId: created["documentId"],
          requestId: "old-client",
          label: "Stale overwrite",
          xMm: 0,
          yMm: 0,
          widthMm: 2000,
          depthMm: 2000,
          maxStackHeightMm: 3000,
        }),
      ),
    ).toMatchObject({ written: false, error: { code: "VERSION_CONFLICT" } });
  });

  it("parent audit: lifecycle impact uses at most one native pagination across a large named catalogue", async () => {
    const context = await plannerWorld();
    const floor = await context.world.t.run(
      async (ctx) => (await ctx.db.query("storageFloors").collect())[0]!,
    );
    await context.world.t.run(async (ctx) => {
      for (let index = 0; index < 201; index++)
        await ctx.db.insert("locations", {
          orgId: context.world.orgA,
          warehouseId: context.warehouseId,
          buildingId: floor.buildingId,
          floorId: floor._id,
          code: `NAMED-${index}`,
          locationType: "NAMED_STORAGE",
          status: "ACTIVE",
        });
    });
    let paginations = 0;
    const wrap = (query: object): object =>
      new Proxy(query, {
        get(target, key, receiver) {
          const member = Reflect.get(target, key, receiver);
          if (typeof member !== "function") return member;
          return (...args: unknown[]) => {
            if (key === "paginate") paginations++;
            const result: unknown = Reflect.apply(member, target, args);
            return result &&
              typeof result === "object" &&
              !(result instanceof Promise)
              ? wrap(result)
              : result;
          };
        },
      });
    await context.world.t
      .withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_a" })
      .run(async (ctx) => {
        const db = new Proxy(ctx.db, {
          get(target, key, receiver) {
            const member = Reflect.get(target, key, receiver);
            if (key === "query")
              return (table: string) =>
                wrap(Reflect.apply(member, target, [table]));
            return typeof member === "function" ? member.bind(target) : member;
          },
        });
        await (buildingLifecycleImpact as unknown as RuntimeFunction)._handler(
          { ...ctx, db } as GenericMutationCtx<DataModel>,
          {
            warehouseId: context.warehouseId,
            buildingId: context.buildingId,
          },
        );
      });
    expect(paginations).toBeLessThanOrEqual(1);
  });

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

async function rawZone(
  context: Awaited<ReturnType<typeof plannerWorld>>,
  zoneId: string,
) {
  return (await context.world.t.run((ctx) =>
    ctx.db.get(zoneId as never),
  )) as Doc<"storageZones">;
}
async function occupyZone(
  context: Awaited<ReturnType<typeof plannerWorld>>,
  zoneId: string,
) {
  const row = await rawZone(context, zoneId);
  await context.world.t.run(async (ctx) => {
    const stamps = {
      orgId: context.world.orgA,
      warehouseId: context.warehouseId,
      createdAt: 1,
      updatedAt: 1,
      createdByUserId: context.world.userA,
      updatedByUserId: context.world.userA,
    };
    const productId = await ctx.db.insert("finishedGoodsProducts", {
      ...stamps,
      sku: "SKU",
      name: "Boxes",
      unit: "pieces",
      storageFormat: "PALLET",
      storageCondition: "ANY",
      status: "ACTIVE",
    });
    const palletId = await ctx.db.insert("finishedGoodsPallets", {
      ...stamps,
      productId,
      code: "P-1",
      quantity: 1,
      status: "RESERVED",
    });
    await ctx.db.insert("finishedGoodsPlacements", {
      ...stamps,
      palletId,
      buildingId: row.buildingId,
      floorId: row.floorId,
      zoneId: row._id,
      locationId: row.locationId,
      positionCode: "TEST",
      qrValue: "TEST",
      status: "RESERVED",
      xMm: 0,
      yMm: 0,
      zMm: 0,
      widthMm: 500,
      depthMm: 500,
      heightMm: 500,
      rotation: 0,
    });
  });
}
it("rack receipt replays after later occupancy and mode changes without adding slots", async () => {
  const context = await plannerWorld();
  const rack = await zone(context, "Replay Rack", { mode: "RACK" });
  const zoneId = rack["documentId"] as string;
  const args = {
    warehouseId: context.warehouseId,
    zoneId,
    requestId: "rack-retry",
    fixtureCode: "R1",
    bayCount: 1,
    levelCount: 1,
    slotsPerBay: 1,
    bayWidthMm: 1000,
    rackDepthMm: 1000,
    levelHeightMm: 1000,
  };
  const first = value(
    await call(context.world, generateRackStoragePositions, args),
  );
  await occupyZone(context, zoneId);
  await context.world.t.run((ctx) =>
    ctx.db.patch(zoneId as never, { mode: "SIMPLE" }),
  );
  expect(
    value(await call(context.world, generateRackStoragePositions, args)),
  ).toMatchObject({ ...first, replayed: true });
  expect(
    await context.world.t.run((ctx) =>
      ctx.db.query("storagePositions").collect(),
    ),
  ).toHaveLength(1);
});
it("empty draft rack can retire its final leaf then return to SIMPLE while preserving leaf history", async () => {
  const context = await plannerWorld();
  const rack = await zone(context, "Convert Rack", { mode: "RACK" });
  const zoneId = rack["documentId"] as string;
  const generated = value(
    await call(context.world, generateRackStoragePositions, {
      warehouseId: context.warehouseId,
      zoneId,
      requestId: "one-leaf",
      fixtureCode: "R1",
      bayCount: 1,
      levelCount: 1,
      slotsPerBay: 1,
      bayWidthMm: 1000,
      rackDepthMm: 1000,
      levelHeightMm: 1000,
    }),
  );
  const positionId = (generated["positionIds"] as string[])[0]!;
  expect(
    value(
      await call(context.world, archiveStoragePosition, {
        warehouseId: context.warehouseId,
        positionId,
        requestId: "retire-final-leaf",
      }),
    ),
  ).toMatchObject({ written: true });
  const current = (await building(context)).floors[0]!.storageZones[0]!;
  expect(
    value(
      await call(context.world, updateStorageZone, {
        warehouseId: context.warehouseId,
        zoneId,
        requestId: "simple-again",
        expectedRevision: current.revision,
        label: "Convert Rack",
        mode: "SIMPLE",
        xMm: 0,
        yMm: 0,
        widthMm: 2000,
        depthMm: 2000,
        maxStackHeightMm: 3000,
      }),
    ),
  ).toMatchObject({ written: true });
  const archived = await context.world.t.run((ctx) =>
    ctx.db.get(positionId as never),
  );
  expect(archived).toMatchObject({ _id: positionId, status: "INACTIVE" });
  expect(
    (await building(context)).floors[0]!.storageZones[0]!.positions,
  ).toMatchObject([{ kind: "DEFAULT" }]);
});
it("occupied draft rack refuses final leaf retirement and conversion to SIMPLE", async () => {
  const context = await plannerWorld();
  const rack = await zone(context, "Occupied Rack", { mode: "RACK" });
  const zoneId = rack["documentId"] as string;
  const generated = value(
    await call(context.world, generateRackStoragePositions, {
      warehouseId: context.warehouseId,
      zoneId,
      requestId: "occupied-leaf",
      fixtureCode: "R1",
      bayCount: 1,
      levelCount: 1,
      slotsPerBay: 1,
      bayWidthMm: 1000,
      rackDepthMm: 1000,
      levelHeightMm: 1000,
    }),
  );
  await occupyZone(context, zoneId);
  expect(
    value(
      await call(context.world, archiveStoragePosition, {
        warehouseId: context.warehouseId,
        positionId: (generated["positionIds"] as string[])[0],
        requestId: "keep-final-leaf",
      }),
    ),
  ).toMatchObject({ written: false, error: { code: "LOCATION_OCCUPIED" } });
  const current = (await building(context)).floors[0]!.storageZones[0]!;
  expect(
    value(
      await call(context.world, updateStorageZone, {
        warehouseId: context.warehouseId,
        zoneId,
        requestId: "keep-rack",
        expectedRevision: current.revision,
        label: "Occupied Rack",
        mode: "SIMPLE",
        xMm: 0,
        yMm: 0,
        widthMm: 2000,
        depthMm: 2000,
        maxStackHeightMm: 3000,
      }),
    ),
  ).toMatchObject({ written: false, error: { code: "LOCATION_OCCUPIED" } });
});
it("same-clock parent geometry changes advance the automatic leaf revision and refuse stale leaf edits", async () => {
  const context = await plannerWorld();
  const created = await zone(context, "Versioned Simple");
  const zoneId = created["documentId"] as string;
  const before = await rawZone(context, zoneId);
  const leaf = await context.world.t.run(
    async (ctx) => (await ctx.db.query("storagePositions").collect())[0]!,
  );
  const revision = `${leaf.version ?? 0}:${leaf.updatedAt}`;
  const now = vi.spyOn(Date, "now").mockReturnValue(leaf.updatedAt);
  try {
    expect(
      value(
        await call(context.world, updateStorageZone, {
          warehouseId: context.warehouseId,
          zoneId,
          requestId: "parent-move",
          expectedRevision: `${before.version ?? 0}:${before.updatedAt}`,
          label: "Moved Simple",
          xMm: 1000,
          yMm: 0,
          widthMm: 2000,
          depthMm: 2000,
          maxStackHeightMm: 3000,
        }),
      ),
    ).toMatchObject({ written: true });
    const moved = await context.world.t.run((ctx) => ctx.db.get(leaf._id));
    expect(moved!.version).toBe((leaf.version ?? 0) + 1);
    expect(moved!.updatedAt).toBeGreaterThan(leaf.updatedAt);
    expect(
      value(
        await call(context.world, updateStoragePosition, {
          warehouseId: context.warehouseId,
          positionId: leaf._id,
          requestId: "stale-leaf",
          expectedRevision: revision,
          label: "Stale",
          xMm: 0,
          yMm: 0,
          widthMm: 2000,
          depthMm: 2000,
        }),
      ),
    ).toMatchObject({ written: false, error: { code: "VERSION_CONFLICT" } });
  } finally {
    now.mockRestore();
  }
});
it("a previously floor-scoped registration cannot move existing ticket references to another floor", async () => {
  const context = await plannerWorld(2);
  await zone(context, "Activate Ground");
  value(
    await call(context.world, activateStorageBuilding, {
      warehouseId: context.warehouseId,
      buildingId: context.buildingId,
      requestId: "activate-scope",
      expectedVersion: (await building(context)).building.version,
    }),
  );
  const floor = await context.world.t.run(async (ctx) =>
    (await ctx.db.query("storageFloors").collect()).find(
      (row) => row.floorNumber === 1,
    )!,
  );
  const registration = value(
    await call(context.world, registerNamedLocation, {
      warehouseId: context.warehouseId,
      requestId: "floor-scoped",
      code: "Scoped dock",
      buildingId: context.buildingId,
      floorId: floor._id,
    }),
  );
  expect(
    value(
      await call(context.world, completeNamedLocationLayout, {
        warehouseId: context.warehouseId,
        locationId: registration["documentId"],
        buildingId: context.buildingId,
        requestId: "different-floor",
        expectedVersion: 1,
        floorNumber: 2,
        xMm: 4000,
        yMm: 0,
        widthMm: 1000,
        depthMm: 1000,
        maxStackHeightMm: 3000,
      }),
    ),
  ).toMatchObject({
    written: false,
    error: { code: "NAMED_LOCATION_FLOOR_CONFLICT", field: "floorNumber" },
  });
  expect(
    await context.world.t.run((ctx) =>
      ctx.db.get(registration["documentId"] as never),
    ),
  ).toMatchObject({ floorId: floor._id, locationType: "NAMED_STORAGE" });
});
it.each(["geometry", "kind", "elevation"])(
  "activation preflight refuses invalid legacy leaf %s",
  async (problem) => {
    const context = await plannerWorld();
    const rack = await zone(context, "Legacy Rack", { mode: "RACK" });
    const generated = value(
      await call(context.world, generateRackStoragePositions, {
        warehouseId: context.warehouseId,
        zoneId: rack["documentId"],
        requestId: "legacy-rack",
        fixtureCode: "R1",
        bayCount: 1,
        levelCount: 1,
        slotsPerBay: 1,
        bayWidthMm: 1000,
        rackDepthMm: 1000,
        levelHeightMm: 1000,
      }),
    );
    await context.world.t.run((ctx) =>
      ctx.db.patch(
        (generated["positionIds"] as string[])[0] as never,
        problem === "geometry"
          ? { widthMm: 99999 }
          : problem === "kind"
            ? { kind: "FLOOR" }
            : { elevationMm: -1 },
      ),
    );
    expect(
      value(
        await call(context.world, layoutReadiness, {
          warehouseId: context.warehouseId,
          buildingId: context.buildingId,
        }),
      ),
    ).toMatchObject({ ready: false });
    expect(
      value(
        await call(context.world, activateStorageBuilding, {
          warehouseId: context.warehouseId,
          buildingId: context.buildingId,
          requestId: "invalid-leaf-activation",
          expectedVersion: (await building(context)).building.version,
        }),
      ),
    ).toMatchObject({ written: false });
  },
);

it("a position editor missing its revision fails closed while a fresh token edit succeeds", async () => {
  const context = await plannerWorld();
  const created = await zone(context, "Position Token");
  const leaf = await context.world.t.run(
    async (ctx) => (await ctx.db.query("storagePositions").collect())[0]!,
  );
  const args = {
    warehouseId: context.warehouseId,
    positionId: leaf._id,
    label: "Fresh label",
    xMm: 0,
    yMm: 0,
    widthMm: 2000,
    depthMm: 2000,
  };
  expect(
    value(
      await call(context.world, updateStoragePosition, {
        ...args,
        requestId: "missing-position-token",
      }),
    ),
  ).toMatchObject({ written: false, error: { code: "VERSION_CONFLICT" } });
  expect(
    value(
      await call(context.world, updateStoragePosition, {
        ...args,
        requestId: "fresh-position-token",
        expectedRevision: `${leaf.version ?? 0}:${leaf.updatedAt}`,
      }),
    ),
  ).toMatchObject({ written: true });
  expect(created["written"]).toBe(true);
});
it("mapped job tickets retain their original floor when a name registration gains geometry", async () => {
  const context = await plannerWorld(2);
  await zone(context, "Floor Context");
  value(
    await call(context.world, activateStorageBuilding, {
      warehouseId: context.warehouseId,
      buildingId: context.buildingId,
      requestId: "activate-ticket-floor",
      expectedVersion: (await building(context)).building.version,
    }),
  );
  const floor = await context.world.t.run(async (ctx) =>
    (await ctx.db.query("storageFloors").collect()).find(
      (row) => row.floorNumber === 1,
    )!,
  );
  const registered = value(
    await call(context.world, registerNamedLocation, {
      warehouseId: context.warehouseId,
      requestId: "register-ticket",
      code: "Ticket dock",
      buildingId: context.buildingId,
      floorId: floor._id,
    }),
  );
  const locationId = registered["documentId"] as string;
  value(
    await call(context.world, saveJobScans, {
      warehouseId: context.warehouseId,
      requestId: "save-floor-ticket",
      locationText: "Ticket dock",
      location: { locationId },
      items: [
        {
          factoryOrder: "ORDER-1",
          productBarcodeText: "BARCODE-1",
          source: "MANUAL",
        },
      ],
    }),
  );
  value(
    await call(context.world, completeNamedLocationLayout, {
      warehouseId: context.warehouseId,
      locationId,
      buildingId: context.buildingId,
      requestId: "complete-ticket-floor",
      expectedVersion: 1,
      floorNumber: 1,
      xMm: 4000,
      yMm: 0,
      widthMm: 1000,
      depthMm: 1000,
      maxStackHeightMm: 3000,
    }),
  );
  const scans = value(
    await call(context.world, listJobScans, {
      warehouseId: context.warehouseId,
      filter: "MAPPED",
      pageSize: 20,
    }),
  );
  expect(scans["items"]).toMatchObject([
    { factoryOrder: "ORDER-1", floorNumber: 1, locationCode: "TICKET DOCK" },
  ]);
  expect(
    await context.world.t.run((ctx) => ctx.db.get(locationId as never)),
  ).toMatchObject({ floorId: floor._id, locationType: "FLOOR_BLOCK" });
});
it("building impact counts its own named registrations without reading unrelated building rows", async () => {
  const context = await plannerWorld();
  const otherBuilding = value(
    await call(context.world, createStorageBuilding, {
      warehouseId: context.warehouseId,
      requestId: "other-building",
      code: "OTHER",
      name: "Other",
      widthMm: 10000,
      depthMm: 10000,
      defaultFloorHeightMm: 4000,
      floorCount: 1,
    }),
  )["documentId"];
  await context.world.t.run(async (ctx) => {
    const ownFloor = (await ctx.db.query("storageFloors").collect()).find(
      (floor) => floor.buildingId === context.buildingId,
    )!;
    for (let index = 0; index < 201; index++)
      await ctx.db.insert("locations", {
        orgId: context.world.orgA,
        warehouseId: context.warehouseId,
        buildingId: ownFloor.buildingId,
        floorId: ownFloor._id,
        code: `OWN-${index}`,
        locationType: "NAMED_STORAGE",
        status: "ACTIVE",
      });
    for (let index = 0; index < 500; index++)
      await ctx.db.insert("locations", {
        orgId: context.world.orgA,
        warehouseId: context.warehouseId,
        buildingId: otherBuilding as never,
        code: `OTHER-${index}`,
        locationType: "NAMED_STORAGE",
        status: "ACTIVE",
      });
  });
  await context.world.t
    .withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_a" })
    .run(async (ctx) => {
      const tracked = trackDocumentReads(ctx.db);
      const answer = value(
        (await (buildingLifecycleImpact as unknown as RuntimeFunction)._handler(
          { ...ctx, db: tracked.db } as GenericMutationCtx<DataModel>,
          { warehouseId: context.warehouseId, buildingId: context.buildingId },
        )) as Outcome,
      );
      expect(answer).toMatchObject({
        namedRegistrationCount: 201,
        namedRegistrationCountComplete: true,
      });
      expect(
        tracked.queryRows
          .filter((entry) => entry.table === "locations")
          .reduce((count, entry) => count + entry.count, 0),
      ).toBe(201);
    });
});

it("building named-registration overflow reports an explicit lower bound instead of failing confirmation", async () => {
  const context = await plannerWorld();
  await context.world.t.run(async (ctx) => {
    for (let index = 0; index < 1001; index++)
      await ctx.db.insert("locations", {
        orgId: context.world.orgA,
        warehouseId: context.warehouseId,
        buildingId: context.buildingId as never,
        code: `BOUNDED-${index}`,
        locationType: "NAMED_STORAGE",
        status: "ACTIVE",
      });
  });
  expect(
    value(
      await call(context.world, buildingLifecycleImpact, {
        warehouseId: context.warehouseId,
        buildingId: context.buildingId,
      }),
    ),
  ).toMatchObject({
    namedRegistrationCount: 1000,
    namedRegistrationCountComplete: false,
  });
});
it("an active rack keeps its final exact address until the empty building returns to draft", async () => {
  const context = await plannerWorld();
  const rack = await zone(context, "Active Rack", { mode: "RACK" });
  const generated = value(
    await call(context.world, generateRackStoragePositions, {
      warehouseId: context.warehouseId,
      zoneId: rack["documentId"],
      requestId: "active-final",
      fixtureCode: "R1",
      bayCount: 1,
      levelCount: 1,
      slotsPerBay: 1,
      bayWidthMm: 1000,
      rackDepthMm: 1000,
      levelHeightMm: 1000,
    }),
  );
  value(
    await call(context.world, activateStorageBuilding, {
      warehouseId: context.warehouseId,
      buildingId: context.buildingId,
      requestId: "activate-final",
      expectedVersion: (await building(context)).building.version,
    }),
  );
  expect(
    value(
      await call(context.world, archiveStoragePosition, {
        warehouseId: context.warehouseId,
        positionId: (generated["positionIds"] as string[])[0],
        requestId: "active-retire-refused",
      }),
    ),
  ).toMatchObject({
    written: false,
    error: { code: "AREA_REQUIRES_LEAF_POSITION" },
  });
});
