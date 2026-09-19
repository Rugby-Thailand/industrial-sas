import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";

import type { DataModel } from "../../convex/schema";
import {
  listStorageBuildings,
  getStorageBuilding,
} from "../../convex/storageLayouts/catalogue";
import { list as listLocations } from "../../convex/storageLayouts/locationCatalogue";
import {
  activateStorageBuilding,
  archiveStorageBuilding,
  changeStorageFloorCount,
  createStorageBuilding,
  saveStorageFloor,
  updateStorageBuilding,
} from "../../convex/storageLayouts/writes";
import {
  archiveStoragePosition,
  archiveStorageZone,
  createStoragePosition,
  createStorageZone,
  resolveStorageAddress,
  updateStoragePosition,
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
async function call(
  world: ConvexTenantWorld,
  fn: unknown,
  args: unknown,
  org: "a" | "b" = "a",
) {
  return (await world.t
    .withIdentity({ subject: "user_fixture_a", org_id: `org_fixture_${org}` })
    .run(async (ctx) =>
      (fn as RuntimeFunction)._handler(
        ctx as GenericMutationCtx<DataModel>,
        args,
      ),
    )) as Record<string, unknown>;
}
function value(outcome: Record<string, unknown>) {
  expect(outcome["ok"], JSON.stringify(outcome)).toBe(true);
  return outcome["value"] as Record<string, unknown>;
}

async function occupiedWorld(status: "RESERVED" | "STORED" = "RESERVED") {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, {
    roleA: "ORG_ADMIN",
    roleB: "ORG_ADMIN",
  });
  const warehouseId = world.warehouses.alphaA;
  value(
    await call(world, createStorageBuilding, {
      warehouseId,
      requestId: "building",
      code: "SAFETY",
      name: "Safety",
      widthMm: 10_000,
      depthMm: 10_000,
      defaultFloorHeightMm: 4_000,
      floorCount: 1,
    }),
  );
  const building = await world.t.run(
    async (ctx) => (await ctx.db.query("storageBuildings").collect())[0]!,
  );
  value(
    await call(world, createStorageZone, {
      warehouseId,
      buildingId: building._id,
      floorNumber: 1,
      requestId: "zone",
      label: "FG-1",
      storageCondition: " DRY ",
      mode: "FLOOR_POSITIONS",
      xMm: 500,
      yMm: 500,
      widthMm: 6_000,
      depthMm: 6_000,
      maxStackHeightMm: 4_000,
    }),
  );
  const zone = await world.t.run(
    async (ctx) => (await ctx.db.query("storageZones").collect())[0]!,
  );
  for (let index = 0; index < 2; index += 1)
    value(
      await call(world, createStoragePosition, {
        warehouseId,
        zoneId: zone._id,
        requestId: `position-${index}`,
        code: `P${index}`,
        label: `Position ${index}`,
        xMm: 500 + index * 2_000,
        yMm: 500,
        widthMm: 2_000,
        depthMm: 2_000,
      }),
    );
  const position = await world.t.run(async (ctx) =>
    (await ctx.db.query("storagePositions").collect()).find(
      (item) => !item.isDefault,
    )!,
  );
  value(
    await call(world, activateStorageBuilding, {
      warehouseId,
      buildingId: building._id,
      requestId: "activate",
      expectedVersion: 1,
    }),
  );
  const placementId = await world.t.run(async (ctx) => {
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
      code: "PAL-001",
      quantity: 500,
      lengthMm: 1_200,
      widthMm: 1_000,
      heightMm: 1_400,
      status,
    });
    return await ctx.db.insert("finishedGoodsPlacements", {
      ...audit,
      palletId,
      buildingId: building._id,
      floorId: zone.floorId,
      zoneId: zone._id,
      locationId: position.locationId,
      supportPositionId: position._id,
      positionCode: "EXACT-001",
      qrValue: "EXACT-QR",
      xMm: 100,
      yMm: 200,
      zMm: 0,
      widthMm: 1_000,
      depthMm: 1_200,
      heightMm: 1_400,
      rotation: 0,
      status,
    });
  });
  const floor = await world.t.run(
    async (ctx) => (await ctx.db.query("storageFloors").collect())[0]!,
  );
  return { world, warehouseId, building, zone, position, placementId, floor };
}

describe("planner protects finished goods occupancy", () => {
  it("projects both move holds, one physical pallet and union area, marking in-transit sources honestly", async () => {
    const { world, warehouseId, building, placementId } =
      await occupiedWorld("STORED");
    const moveId = await world.t.run(async (ctx) => {
      const source = (await ctx.db.get(placementId))!;
      const { _id, _creationTime, ...document } = source;
      void _id;
      void _creationTime;
      const targetPlacementId = await ctx.db.insert("finishedGoodsPlacements", {
        ...document,
        xMm: source.xMm + 500,
        status: "RESERVED",
        positionCode: "EXACT-002",
      });
      return await ctx.db.insert("finishedGoodsMoves", {
        orgId: world.orgA,
        warehouseId,
        palletId: source.palletId,
        sourcePlacementId: placementId,
        targetPlacementId,
        sourceUpdatedAt: 1,
        targetUpdatedAt: 1,
        palletUpdatedAt: 1,
        ownerUserId: world.userA,
        status: "IN_TRANSIT",
        pickedUpAt: 2,
        createdAt: 1,
        updatedAt: 2,
        createdByUserId: world.userA,
        updatedByUserId: world.userA,
      });
    });
    const detail = value(
      await call(world, getStorageBuilding, {
        warehouseId,
        buildingId: building._id,
      }),
    );
    const floors = detail["floors"] as {
      storageZones: {
        placements: unknown[];
        palletCount: number;
        occupiedFootprintAreaSqMm: number;
      }[];
    }[];
    const zone = floors[0]!.storageZones[0]!;
    expect(zone).toMatchObject({
      palletCount: 1,
      occupiedFootprintAreaSqMm: 1_800_000,
    });
    expect(zone.placements).toHaveLength(2);
    expect(zone.placements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          placementId,
          moveId,
          moveRole: "SOURCE",
          moveState: "IN_TRANSIT",
          status: "STORED",
        }),
        expect.objectContaining({
          moveRole: "TARGET",
          moveState: "IN_TRANSIT",
          status: "RESERVED",
        }),
      ]),
    );
    const catalogue = (await call(world, listLocations, { warehouseId }))[
      "value"
    ] as Record<string, unknown>[];
    expect(catalogue[0]).toMatchObject({
      palletCount: 1,
      occupiedFootprintAreaSqMm: 1_800_000,
    });
    expect(catalogue[0]!["placements"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          moveRole: "SOURCE",
          moveState: "IN_TRANSIT",
        }),
        expect.objectContaining({
          moveRole: "TARGET",
          moveState: "IN_TRANSIT",
        }),
      ]),
    );
    expect(
      value(
        await call(world, archiveStorageBuilding, {
          warehouseId,
          buildingId: building._id,
          expectedVersion: 2,
          requestId: "move-holds-block",
        }),
      ),
    ).toMatchObject({ written: false, error: { code: "LOCATION_OCCUPIED" } });
    await world.t.run(async (ctx) => {
      const move = (await ctx.db.get(moveId))!;
      await ctx.db.patch(move.targetPlacementId, { status: "RELEASED" });
      await ctx.db.patch(moveId, { status: "RETURNED" });
    });
    const returned = value(
      await call(world, getStorageBuilding, {
        warehouseId,
        buildingId: building._id,
      }),
    );
    const returnedZone = (returned["floors"] as typeof floors)[0]!
      .storageZones[0]!;
    expect(returnedZone).toMatchObject({
      palletCount: 1,
      occupiedFootprintAreaSqMm: 1_200_000,
    });
    expect(returnedZone.placements).toHaveLength(1);
    expect(returnedZone.placements[0]).not.toHaveProperty("moveRole");
  });
  it.each(["RESERVED", "STORED"] as const)(
    "refuses structural edits and archives with %s pallets, including override attempts",
    async (status) => {
      const {
        world,
        warehouseId,
        building,
        zone,
        position,
        placementId,
        floor,
      } = await occupiedWorld(status);
      const actions: readonly [unknown, Record<string, unknown>][] = [
        [
          archiveStorageBuilding,
          { buildingId: building._id, expectedVersion: 2 },
        ],
        [
          updateStorageBuilding,
          {
            buildingId: building._id,
            expectedVersion: 2,
            name: "Safety",
            widthMm: 10_000,
            depthMm: 10_000,
            defaultFloorHeightMm: 5_000,
          },
        ],
        [
          saveStorageFloor,
          {
            buildingId: building._id,
            expectedBuildingVersion: 2,
            expectedFloorVersion: floor.version,
            floor: {
              floorNumber: 1,
              widthMm: 9_000,
              depthMm: 9_000,
              heightMm: 4_000,
              reservedBlocks: [],
            },
          },
        ],
        [
          saveStorageFloor,
          {
            buildingId: building._id,
            expectedBuildingVersion: 2,
            expectedFloorVersion: floor.version,
            floor: {
              floorNumber: 1,
              reservedBlocks: [
                {
                  id: "new",
                  label: "Block",
                  xMm: 8_000,
                  yMm: 8_000,
                  widthMm: 1_000,
                  depthMm: 1_000,
                },
              ],
            },
          },
        ],
        [
          updateStorageZone,
          {
            zoneId: zone._id,
            label: "FG-1",
            xMm: 600,
            yMm: 500,
            widthMm: 6_000,
            depthMm: 6_000,
            maxStackHeightMm: 4_000,
            confirmOccupiedChange: true,
          },
        ],
        [
          updateStorageZone,
          {
            zoneId: zone._id,
            label: "FG-1",
            xMm: 500,
            yMm: 500,
            widthMm: 5_000,
            depthMm: 6_000,
            maxStackHeightMm: 3_000,
            confirmOccupiedChange: true,
          },
        ],
        [
          updateStorageZone,
          {
            zoneId: zone._id,
            label: "FG-1",
            mode: "PLATFORM",
            baseElevationMm: 500,
            xMm: 500,
            yMm: 500,
            widthMm: 6_000,
            depthMm: 6_000,
            maxStackHeightMm: 3_000,
            confirmOccupiedChange: true,
          },
        ],
        [archiveStorageZone, { zoneId: zone._id }],
        [
          updateStoragePosition,
          {
            positionId: position._id,
            label: position.label,
            xMm: 700,
            yMm: 500,
            widthMm: 1_800,
            depthMm: 2_000,
            confirmOccupiedChange: true,
          },
        ],
        [archiveStoragePosition, { positionId: position._id }],
      ];
      for (const [index, [fn, args]] of actions.entries())
        expect(
          value(
            await call(world, fn, {
              ...args,
              warehouseId,
              requestId: `blocked-${index}`,
            }),
          ),
        ).toMatchObject({
          written: false,
          error: { code: "LOCATION_OCCUPIED" },
        });
      const unchanged = await world.t.run(async (ctx) => ({
        building: await ctx.db.get(building._id),
        zone: await ctx.db.get(zone._id),
        position: await ctx.db.get(position._id),
        placement: await ctx.db.get(placementId),
        blocks: await ctx.db.query("storageFloorReservedBlocks").collect(),
      }));
      expect(unchanged.building).toMatchObject({
        status: "ACTIVE",
        widthMm: 10_000,
        version: 2,
      });
      expect(unchanged.zone).toMatchObject({
        status: "ACTIVE",
        xMm: 500,
        widthMm: 6_000,
      });
      expect(unchanged.position).toMatchObject({
        status: "ACTIVE",
        xMm: 500,
        widthMm: 2_000,
      });
      expect(unchanged.placement).toMatchObject({ status, xMm: 100, yMm: 200 });
      expect(unchanged.blocks).toHaveLength(0);
    },
  );

  it("exposes exact local coordinates and only active occupancy in zone and position catalogues", async () => {
    const { world, warehouseId, building, placementId } = await occupiedWorld();
    const detail = value(
      await call(world, getStorageBuilding, {
        warehouseId,
        buildingId: building._id,
      }),
    );
    const floors = detail["floors"] as {
      storageZones: {
        placements: unknown[];
        positions: { placements: unknown[] }[];
      }[];
    }[];
    const zone = floors[0]!.storageZones[0]!;
    expect(zone.placements).toEqual([
      expect.objectContaining({
        lpn: "PAL-001",
        xMm: 100,
        yMm: 200,
        zMm: 0,
        status: "RESERVED",
        positionCode: "EXACT-001",
      }),
    ]);
    expect(
      zone.positions.flatMap((position) => position.placements),
    ).toHaveLength(1);
    await world.t.run(async (ctx) =>
      ctx.db.patch(placementId, { status: "RELEASED" }),
    );
    const after = value(
      await call(world, getStorageBuilding, {
        warehouseId,
        buildingId: building._id,
      }),
    );
    expect(
      (after["floors"] as typeof floors)[0]!.storageZones[0]!.placements,
    ).toEqual([]);
  });

  it("persists normalized conditions, retains omitted values, clears unknowns, and blocks occupied changes", async () => {
    const { world, warehouseId, zone, placementId } = await occupiedWorld();
    expect(zone.storageCondition).toBe("DRY");
    const args = {
      warehouseId,
      zoneId: zone._id,
      label: zone.label,
      xMm: zone.xMm,
      yMm: zone.yMm,
      widthMm: zone.widthMm,
      depthMm: zone.depthMm,
      maxStackHeightMm: zone.maxStackHeightMm,
    };
    await world.t.run(async (ctx) =>
      ctx.db.patch(zone._id, { storageCondition: "Dry" }),
    );
    expect(
      value(
        await call(world, updateStorageZone, {
          ...args,
          requestId: "same-condition-case",
          storageCondition: " DRY ",
        }),
      ),
    ).toMatchObject({ written: true });
    expect(
      value(
        await call(world, updateStorageZone, {
          ...args,
          requestId: "occupied-condition",
          storageCondition: "COLD",
        }),
      ),
    ).toMatchObject({ written: false, error: { code: "LOCATION_OCCUPIED" } });
    await world.t.run(async (ctx) =>
      ctx.db.patch(placementId, { status: "RELEASED" }),
    );
    expect(
      value(
        await call(world, updateStorageZone, {
          ...args,
          requestId: "long-condition",
          storageCondition: "x".repeat(101),
        }),
      ),
    ).toMatchObject({
      written: false,
      error: { code: "TEXT_TOO_LONG", field: "storageCondition" },
    });
    expect(
      value(
        await call(world, updateStorageZone, {
          ...args,
          requestId: "set-condition",
          storageCondition: " COLD ",
        }),
      ),
    ).toMatchObject({ written: true });
    expect(
      value(
        await call(world, updateStorageZone, {
          ...args,
          requestId: "retain-condition",
        }),
      ),
    ).toMatchObject({ written: true });
    expect(
      await world.t.run(async (ctx) => ctx.db.get(zone._id)),
    ).toMatchObject({ storageCondition: "COLD" });
    expect(
      value(
        await call(world, updateStorageZone, {
          ...args,
          requestId: "clear-condition",
          storageCondition: "  ",
        }),
      ),
    ).toMatchObject({ written: true });
    expect(
      (await world.t.run(async (ctx) => ctx.db.get(zone._id)))
        ?.storageCondition,
    ).toBeUndefined();
  });

  it("allows widening an occupied building while blocking floor-height changes", async () => {
    const { world, warehouseId, building, zone, position } =
      await occupiedWorld("STORED");
    expect(
      value(
        await call(world, updateStorageBuilding, {
          warehouseId,
          buildingId: building._id,
          requestId: "rename-building",
          expectedVersion: 2,
          name: "Renamed",
          widthMm: 11_000,
          depthMm: 10_000,
          defaultFloorHeightMm: 4_000,
        }),
      ),
    ).toMatchObject({ written: true });
    expect(
      value(
        await call(world, updateStorageBuilding, {
          warehouseId,
          buildingId: building._id,
          requestId: "blocked-height",
          expectedVersion: 3,
          name: "Renamed",
          widthMm: 11_000,
          depthMm: 10_000,
          defaultFloorHeightMm: 5_000,
        }),
      ),
    ).toMatchObject({ written: false, error: { code: "LOCATION_OCCUPIED" } });
    expect(
      value(
        await call(world, updateStorageZone, {
          warehouseId,
          zoneId: zone._id,
          requestId: "rename-zone",
          label: "FG renamed",
          xMm: 500,
          yMm: 500,
          widthMm: 6_000,
          depthMm: 6_000,
          maxStackHeightMm: 4_000,
        }),
      ),
    ).toMatchObject({ written: true });
    expect(
      value(
        await call(world, updateStoragePosition, {
          warehouseId,
          positionId: position._id,
          requestId: "rename-position",
          label: "Renamed",
          xMm: position.xMm,
          yMm: position.yMm,
          widthMm: position.widthMm,
          depthMm: position.depthMm,
        }),
      ),
    ).toMatchObject({ written: true });
    expect(
      value(
        await call(world, changeStorageFloorCount, {
          warehouseId,
          buildingId: building._id,
          requestId: "add-floor",
          expectedVersion: 3,
          floorCount: 2,
        }),
      ),
    ).toMatchObject({ written: true });
  });

  it("allows archive after hold release, disables all child locations, and rejects archived QR addresses", async () => {
    const { world, warehouseId, building, zone, position, placementId } =
      await occupiedWorld();
    await world.t.run(async (ctx) =>
      ctx.db.patch(placementId, { status: "RELEASED" }),
    );
    expect(
      value(
        await call(world, resolveStorageAddress, {
          warehouseId,
          scan: position.qrValue,
        }),
      ),
    ).toMatchObject({ found: true });
    expect(
      value(
        await call(world, archiveStorageBuilding, {
          warehouseId,
          buildingId: building._id,
          requestId: "archive-released",
          expectedVersion: 2,
        }),
      ),
    ).toMatchObject({ written: true });
    for (const scan of [zone.qrValue, position.qrValue])
      expect(
        value(await call(world, resolveStorageAddress, { warehouseId, scan })),
      ).toMatchObject({ found: false });
    const locations = await world.t.run(async (ctx) =>
      Promise.all([
        ctx.db.get(zone.locationId),
        ctx.db.get(position.locationId),
      ]),
    );
    expect(locations).toEqual([
      expect.objectContaining({ status: "INACTIVE" }),
      expect.objectContaining({ status: "INACTIVE" }),
    ]);
    expect(
      value(
        await call(world, activateStorageBuilding, {
          warehouseId,
          buildingId: building._id,
          expectedVersion: 3,
          requestId: "reactivate",
        }),
      ),
    ).toMatchObject({ written: true });
    expect(
      value(
        await call(world, resolveStorageAddress, {
          warehouseId,
          scan: position.qrValue,
        }),
      ),
    ).toMatchObject({ found: true });
    expect(
      await world.t.run(async (ctx) => ctx.db.get(position.locationId)),
    ).toMatchObject({ status: "ACTIVE" });
  });

  it("keeps stored pallets blocking after a different reservation is released", async () => {
    const { world, warehouseId, building, placementId } =
      await occupiedWorld("STORED");
    await world.t.run(async (ctx) => {
      const placement = (await ctx.db.get(placementId))!;
      const { _id, _creationTime, ...document } = placement;
      void _id;
      void _creationTime;
      await ctx.db.insert("finishedGoodsPlacements", {
        ...document,
        status: "RELEASED",
        positionCode: "OLD-HOLD",
      });
    });
    expect(
      value(
        await call(world, archiveStorageBuilding, {
          warehouseId,
          buildingId: building._id,
          expectedVersion: 2,
          requestId: "archive-mixed",
        }),
      ),
    ).toMatchObject({ written: false, error: { code: "LOCATION_OCCUPIED" } });
  });

  it("does not resolve draft location or position QR codes", async () => {
    const { world, warehouseId, building, zone, position } =
      await occupiedWorld();
    await world.t.run(async (ctx) =>
      ctx.db.patch(building._id, { status: "DRAFT" }),
    );
    for (const scan of [zone.qrValue, position.qrValue]) {
      expect(
        value(await call(world, resolveStorageAddress, { warehouseId, scan })),
      ).toMatchObject({ found: false });
    }
  });

  it("does not reveal or mutate tenant A occupancy under tenant B", async () => {
    const { world, building, zone, placementId } = await occupiedWorld();
    const read = await call(
      world,
      getStorageBuilding,
      { warehouseId: world.warehouses.alphaB, buildingId: building._id },
      "b",
    );
    expect(value(read)).toMatchObject({ found: false });
    expect(JSON.stringify(read)).not.toContain("PAL-001");
    const write = await call(
      world,
      archiveStorageZone,
      {
        warehouseId: world.warehouses.alphaB,
        zoneId: zone._id,
        requestId: "cross-tenant",
      },
      "b",
    );
    expect(value(write)).toMatchObject({
      written: false,
      error: { code: "NOT_FOUND" },
    });
    expect(
      await world.t.run(async (ctx) => ctx.db.get(placementId)),
    ).toMatchObject({ status: "RESERVED" });
  });
});

it("updates building free-space inputs after reserve, store and release without editing the building", async () => {
  const { world, warehouseId, placementId } = await occupiedWorld("RESERVED");
  const read = async () =>
    value(await call(world, listStorageBuildings, { warehouseId }))["0"];
  expect(await read()).toMatchObject({
    storedFootprintAreaSqMm: 0,
    heldFootprintAreaSqMm: 1_200_000,
  });
  await world.t.run(async (ctx) => {
    await ctx.db.patch(placementId, { status: "STORED" });
  });
  expect(await read()).toMatchObject({
    storedFootprintAreaSqMm: 1_200_000,
    heldFootprintAreaSqMm: 0,
  });
  await world.t.run(async (ctx) => {
    await ctx.db.patch(placementId, { status: "RELEASED" });
  });
  expect(await read()).toMatchObject({
    storedFootprintAreaSqMm: 0,
    heldFootprintAreaSqMm: 0,
  });
});

it("includes product and quantity details for building inventory drilldown", async () => {
  const { world, warehouseId, building } = await occupiedWorld("STORED");
  const detail = value(
    await call(world, getStorageBuilding, {
      warehouseId,
      buildingId: building._id,
    }),
  );
  expect(detail).toMatchObject({
    found: true,
    floors: [
      {
        storageZones: [
          {
            placements: [
              {
                lpn: "PAL-001",
                productName: "Boxes",
                productSku: "SKU",
                quantity: 500,
                unit: "pieces",
                positionCode: "EXACT-001",
              },
            ],
          },
        ],
      },
    ],
  });
});
