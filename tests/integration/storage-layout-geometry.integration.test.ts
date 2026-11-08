import type { GenericMutationCtx } from "convex/server";
import { expect, it } from "vitest";
import type { Doc } from "../../convex/_generated/dataModel";
import type { DataModel } from "../../convex/schema";
import {
  storageRecordRevision,
  storageRectanglesOverlap,
} from "../../convex/model/storageLayout/storageZone";
import {
  activateStorageBuilding,
  createStorageBuilding,
  layoutReadiness,
  saveStorageFloor,
  updateStorageBuilding,
} from "../../convex/storageLayouts/writes";
import {
  createStoragePosition,
  createStorageZone,
  generateRackStoragePositions,
  updateStoragePosition,
} from "../../convex/storageLayouts/zones";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";

async function call(world: ConvexTenantWorld, fn: unknown, args: unknown) {
  const result = await world.t
    .withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_a" })
    .run((ctx) =>
      (
        fn as {
          _handler: (
            ctx: GenericMutationCtx<DataModel>,
            args: unknown,
          ) => Promise<{ ok: boolean; value: Record<string, unknown> }>;
        }
      )._handler(ctx as GenericMutationCtx<DataModel>, args),
    );
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return result.value;
}

function footprint(position: Doc<"storagePositions">) {
  return {
    xMm: position.xMm ?? NaN,
    yMm: position.yMm ?? NaN,
    widthMm: position.widthMm ?? NaN,
    depthMm: position.depthMm ?? NaN,
  };
}

async function setup(mode: "PLATFORM" | "FLOOR_POSITIONS") {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
  const warehouseId = world.warehouses.alphaA;
  const created = await call(world, createStorageBuilding, {
    warehouseId,
    requestId: "building",
    code: "PROBE",
    name: "Probe",
    widthMm: 10_000,
    depthMm: 10_000,
    defaultFloorHeightMm: 4_000,
    floorCount: 1,
  });
  expect(created.written).toBe(true);
  const buildingId = created.documentId;
  const zone = await call(world, createStorageZone, {
    warehouseId,
    buildingId,
    requestId: "zone",
    floorNumber: 1,
    label: "Area",
    mode,
    xMm: 0,
    yMm: 0,
    widthMm: 8_000,
    depthMm: 8_000,
    maxStackHeightMm: 2_000,
    ...(mode === "PLATFORM" ? { baseElevationMm: 1_500 } : {}),
  });
  expect(zone.written).toBe(true);
  const position = await call(world, createStoragePosition, {
    warehouseId,
    zoneId: zone.documentId,
    requestId: "position-a",
    code: "A",
    label: "A",
    xMm: 0,
    yMm: 0,
    widthMm: 2_000,
    depthMm: 2_000,
  });
  expect(position.written).toBe(true);
  expect(
    await call(world, activateStorageBuilding, {
      warehouseId,
      buildingId,
      requestId: "activate",
      expectedVersion: 1,
    }),
  ).toMatchObject({ written: true });
  return {
    world,
    warehouseId,
    buildingId,
    zoneId: zone.documentId,
    positionId: position.documentId,
  };
}

it.each(["floor", "building"] as const)(
  "%s height edits preserve platform vertical containment",
  async (kind) => {
    const { world, warehouseId, buildingId } = await setup("PLATFORM");
    const result =
      kind === "floor"
        ? await call(world, saveStorageFloor, {
            warehouseId,
            buildingId,
            requestId: "lower-floor",
            expectedBuildingVersion: 2,
            expectedFloorVersion: 1,
            floor: { floorNumber: 1, heightMm: 2_500, reservedBlocks: [] },
          })
        : await call(world, updateStorageBuilding, {
            warehouseId,
            buildingId,
            requestId: "lower-building",
            expectedVersion: 2,
            name: "Probe",
            widthMm: 10_000,
            depthMm: 10_000,
            defaultFloorHeightMm: 2_500,
          });
    const overflow = await world.t.run(async (ctx) => {
      const building = (await ctx.db.query("storageBuildings").collect())[0]!;
      const floor = (await ctx.db.query("storageFloors").collect())[0]!;
      const zone = (await ctx.db.query("storageZones").collect())[0]!;
      return Math.max(
        0,
        zone.baseElevationMm! +
          zone.maxStackHeightMm -
          (floor.heightMm ?? building.defaultFloorHeightMm),
      );
    });
    const readiness = await call(world, layoutReadiness, {
      warehouseId,
      buildingId,
    });
    expect(result).toMatchObject({
      written: false,
      error: { code: "ZONE_OUT_OF_BOUNDS" },
    });
    expect(readiness).toMatchObject({
      issues: [],
      status: "ACTIVE",
      version: 2,
    });
    expect(overflow, "active platform exceeds the floor ceiling in mm").toBe(0);
    const boundary =
      kind === "floor"
        ? await call(world, saveStorageFloor, {
            warehouseId,
            buildingId,
            requestId: "ceiling-floor",
            expectedBuildingVersion: 2,
            expectedFloorVersion: 1,
            floor: { floorNumber: 1, heightMm: 3_500, reservedBlocks: [] },
          })
        : await call(world, updateStorageBuilding, {
            warehouseId,
            buildingId,
            requestId: "ceiling-building",
            expectedVersion: 2,
            name: "Probe",
            widthMm: 10_000,
            depthMm: 10_000,
            defaultFloorHeightMm: 3_500,
          });
    expect(boundary).toMatchObject({ written: true });
  },
);

it.each([
  ["create", "FLOOR_POSITIONS"],
  ["update", "FLOOR_POSITIONS"],
  ["create", "PLATFORM"],
  ["update", "PLATFORM"],
] as const)(
  "%s cannot leave two active %s positions on the same footprint",
  async (kind, mode) => {
    const { world, warehouseId, zoneId } = await setup(mode);
    const second = await call(world, createStoragePosition, {
      warehouseId,
      zoneId,
      requestId: "position-b",
      code: "B",
      label: "B",
      xMm: kind === "create" ? 0 : 3_000,
      yMm: 0,
      widthMm: 2_000,
      depthMm: 2_000,
    });
    if (kind === "update") {
      expect(second.written).toBe(true);
      const revision = await world.t.run(async (ctx) =>
        storageRecordRevision(
          (await ctx.db.query("storagePositions").collect()).find(
            (p) => p._id === second.documentId,
          )!,
        ),
      );
      expect(
        await call(world, updateStoragePosition, {
          warehouseId,
          positionId: second.documentId,
          requestId: "overlap-edit",
          expectedRevision: revision,
          label: "B",
          xMm: 0,
          yMm: 0,
          widthMm: 2_000,
          depthMm: 2_000,
        }),
      ).toMatchObject({
        written: false,
        error: { code: "POSITION_OVERLAPS_POSITION" },
      });
    } else {
      expect(second).toMatchObject({
        written: false,
        error: { code: "POSITION_OVERLAPS_POSITION" },
      });
    }
    const rows = await world.t.run((ctx) =>
      ctx.db.query("storagePositions").collect(),
    );
    const active = rows.filter((p) => p.status === "ACTIVE" && !p.isDefault);
    const overlappingPairs = active.flatMap((a, index) =>
      active
        .slice(index + 1)
        .filter((b) => storageRectanglesOverlap(footprint(a), footprint(b))),
    ).length;
    expect(
      overlappingPairs,
      "distinct active floor addresses with overlapping footprints",
    ).toBe(0);
  },
);

it.each(["FLOOR_POSITIONS", "PLATFORM"] as const)(
  "renames legacy overlapping %s positions but refuses overlapping moves",
  async (mode) => {
    const { world, warehouseId, positionId } = await setup(mode);
    const original = await world.t.run(async (ctx) => {
      const first = (await ctx.db.query("storagePositions").collect()).find(
        (row) => row._id === positionId,
      )!;
      const { _id, _creationTime, ...row } = first;
      // Bypass today's creation checks to represent a pre-fix saved layout.
      await ctx.db.insert("storagePositions", {
        ...row,
        code: `${row.code}-B`,
      });
      return first;
    });
    const edit = {
      warehouseId,
      positionId,
      label: "Renamed legacy position",
      ...footprint(original),
    };
    expect(
      await call(world, updateStoragePosition, {
        ...edit,
        requestId: "legacy-rename",
        expectedRevision: storageRecordRevision(original),
      }),
    ).toMatchObject({ written: true });
    const renamed = await world.t.run((ctx) => ctx.db.get(original._id));
    expect(renamed).toMatchObject({
      label: edit.label,
      ...footprint(original),
    });
    expect(
      await call(world, updateStoragePosition, {
        ...edit,
        requestId: "legacy-overlapping-move",
        expectedRevision: storageRecordRevision(renamed!),
        xMm: 500,
      }),
    ).toMatchObject({
      written: false,
      error: { code: "POSITION_OVERLAPS_POSITION" },
    });
    expect(await world.t.run((ctx) => ctx.db.get(original._id))).toEqual(
      renamed,
    );
  },
);

it.each(["floor", "building"] as const)(
  "%s edits preserve legacy over-ceiling platforms unless effective height changes",
  async (kind) => {
    const { world, warehouseId, buildingId, zoneId } = await setup("PLATFORM");
    await world.t.run(async (ctx) => {
      const zone = (await ctx.db.query("storageZones").collect()).find(
        (row) => row._id === zoneId,
      )!;
      await ctx.db.patch(zone._id, { baseElevationMm: 2_500 });
    });
    const edit = (requestId: string, version: number, heightMm: number) =>
      kind === "building"
        ? call(world, updateStorageBuilding, {
            warehouseId,
            buildingId,
            requestId,
            expectedVersion: version,
            name: "Renamed legacy building",
            widthMm: 10_000,
            depthMm: 10_000,
            defaultFloorHeightMm: heightMm,
          })
        : call(world, saveStorageFloor, {
            warehouseId,
            buildingId,
            requestId,
            expectedBuildingVersion: version,
            expectedFloorVersion: version - 1,
            floor: {
              floorNumber: 1,
              heightMm,
              reservedBlocks: [
                {
                  id: "legacy-aisle",
                  label: "Aisle",
                  xMm: 8_000,
                  yMm: 0,
                  widthMm: 1_000,
                  depthMm: 10_000,
                },
              ],
            },
          });
    // An explicit override equal to the inherited height is not a height change.
    expect(await edit("legacy-metadata", 2, 4_000)).toMatchObject({
      written: true,
    });
    const snapshot = () =>
      world.t.run(async (ctx) => ({
        buildings: await ctx.db.query("storageBuildings").collect(),
        floors: await ctx.db.query("storageFloors").collect(),
        blocks: await ctx.db.query("storageFloorReservedBlocks").collect(),
      }));
    const before = await snapshot();
    expect(before.buildings[0]).toMatchObject({ status: "ACTIVE", version: 3 });
    expect(await edit("legacy-lower-height", 3, 3_500)).toMatchObject({
      written: false,
      error: { code: "ZONE_OUT_OF_BOUNDS" },
    });
    expect(await snapshot()).toEqual(before);
    // Ignoring the legacy vertical overflow must not bypass planar validation.
    const planar =
      kind === "building"
        ? await call(world, updateStorageBuilding, {
            warehouseId,
            buildingId,
            requestId: "legacy-narrow-building",
            expectedVersion: 3,
            name: "Renamed legacy building",
            widthMm: 7_000,
            depthMm: 10_000,
            defaultFloorHeightMm: 4_000,
          })
        : await call(world, saveStorageFloor, {
            warehouseId,
            buildingId,
            requestId: "legacy-narrow-floor",
            expectedBuildingVersion: 3,
            expectedFloorVersion: 2,
            floor: { floorNumber: 1, widthMm: 7_000, reservedBlocks: [] },
          });
    expect(planar).toMatchObject({
      written: false,
      error: { code: "ZONE_OUT_OF_BOUNDS" },
    });
    expect(await snapshot()).toEqual(before);
  },
);

it("uses effective floor height for legacy platforms when defaults and overrides change", async () => {
  const { world, warehouseId, buildingId, zoneId } = await setup("PLATFORM");
  await world.t.run(async (ctx) => {
    const zone = (await ctx.db.query("storageZones").collect()).find(
      (row) => row._id === zoneId,
    )!;
    const floor = (await ctx.db.query("storageFloors").collect())[0]!;
    await ctx.db.patch(zone._id, { baseElevationMm: 2_500 });
    await ctx.db.patch(floor._id, { heightMm: 4_000 });
  });
  // The explicit floor override keeps its ceiling despite a lower default.
  expect(
    await call(world, updateStorageBuilding, {
      warehouseId,
      buildingId,
      requestId: "lower-unused-default",
      expectedVersion: 2,
      name: "Probe",
      widthMm: 10_000,
      depthMm: 10_000,
      defaultFloorHeightMm: 3_500,
    }),
  ).toMatchObject({ written: true });
  const floorArgs = {
    warehouseId,
    buildingId,
    expectedBuildingVersion: 3,
    expectedFloorVersion: 2,
  };
  // Removing the override really does lower the ceiling, so it must fail.
  expect(
    await call(world, saveStorageFloor, {
      ...floorArgs,
      requestId: "inherit-lower-default",
      floor: { floorNumber: 1, reservedBlocks: [] },
    }),
  ).toMatchObject({ written: false, error: { code: "ZONE_OUT_OF_BOUNDS" } });
  expect(
    await call(world, saveStorageFloor, {
      ...floorArgs,
      requestId: "retain-floor-override",
      floor: { floorNumber: 1, heightMm: 4_000, reservedBlocks: [] },
    }),
  ).toMatchObject({ written: true });
});

it("checks duplicate codes and legacy creation replays before position overlap", async () => {
  const { world, warehouseId, zoneId } = await setup("FLOOR_POSITIONS");
  const args = {
    warehouseId,
    zoneId,
    requestId: "legacy-position-b",
    code: "B",
    label: "B",
    xMm: 3_000,
    yMm: 0,
    widthMm: 2_000,
    depthMm: 2_000,
  };
  const created = await call(world, createStoragePosition, args);
  expect(created).toMatchObject({ written: true, replayed: false });
  await world.t.run(async (ctx) => {
    const position = (await ctx.db.query("storagePositions").collect()).find(
      (row) => row._id === created.documentId,
    )!;
    const { _id, _creationTime, ...row } = position;
    await ctx.db.insert("storagePositions", { ...row, code: `${row.code}-C` });
    // Older deployments wrote per-row receipts without a command receipt.
    for (const receipt of await ctx.db.query("idempotencyRecords").collect()) {
      if (
        receipt.operation === "storageLayout.position.createCommand" &&
        receipt.requestId === args.requestId
      )
        await ctx.db.delete(receipt._id);
    }
  });
  const before = await world.t.run((ctx) =>
    ctx.db.query("storagePositions").collect(),
  );
  expect(
    await call(world, createStoragePosition, {
      ...args,
      requestId: "duplicate-position-b",
      xMm: 0,
    }),
  ).toMatchObject({ written: false, error: { code: "DUPLICATE_KEY" } });
  expect(await call(world, createStoragePosition, args)).toMatchObject({
    ...created,
    replayed: true,
  });
  expect(
    await world.t.run((ctx) => ctx.db.query("storagePositions").collect()),
  ).toEqual(before);
});

it("generating another fixture cannot duplicate a rack footprint at the same elevation", async () => {
  const { world, warehouseId, buildingId } = await setup("FLOOR_POSITIONS");
  const zone = await call(world, createStorageZone, {
    warehouseId,
    buildingId,
    requestId: "rack-area",
    floorNumber: 1,
    label: "Rack",
    mode: "RACK",
    xMm: 8_000,
    yMm: 0,
    widthMm: 2_000,
    depthMm: 4_000,
    maxStackHeightMm: 3_000,
  });
  expect(zone.written).toBe(true);
  for (const fixtureCode of ["R1", "R2"]) {
    expect(
      await call(world, generateRackStoragePositions, {
        warehouseId,
        zoneId: zone.documentId,
        requestId: `rack-${fixtureCode}`,
        fixtureCode,
        bayCount: 1,
        levelCount: 1,
        slotsPerBay: 1,
        bayWidthMm: 1_000,
        rackDepthMm: 1_000,
        levelHeightMm: 1_000,
      }),
    ).toMatchObject({ written: true, createdCount: 1 });
  }
  const rows = await world.t.run((ctx) =>
    ctx.db.query("storagePositions").collect(),
  );
  const active = rows.filter(
    (p) => p.zoneId === zone.documentId && p.status === "ACTIVE",
  );
  const overlappingPairs = active.flatMap((a, index) =>
    active
      .slice(index + 1)
      .filter(
        (b) =>
          a.elevationMm === b.elevationMm &&
          storageRectanglesOverlap(footprint(a), footprint(b)),
      ),
  ).length;
  expect(
    overlappingPairs,
    "different fixtures occupy the same rack surface",
  ).toBe(0);
});

it("allows touching edges, self updates and reuse of an inactive footprint", async () => {
  const { world, warehouseId, zoneId, positionId } =
    await setup("FLOOR_POSITIONS");
  const args = {
    warehouseId,
    zoneId,
    code: "B",
    label: "B",
    xMm: 2_000,
    yMm: 0,
    widthMm: 2_000,
    depthMm: 2_000,
  };
  const second = await call(world, createStoragePosition, {
    ...args,
    requestId: "adjacent",
  });
  expect(second).toMatchObject({ written: true });
  const revision = await world.t.run(async (ctx) =>
    storageRecordRevision(
      (await ctx.db.query("storagePositions").collect()).find(
        (p) => p._id === second.documentId,
      )!,
    ),
  );
  expect(
    await call(world, updateStoragePosition, {
      warehouseId,
      positionId: second.documentId,
      requestId: "self-update",
      expectedRevision: revision,
      label: "Renamed",
      xMm: 2_000,
      yMm: 0,
      widthMm: 2_000,
      depthMm: 2_000,
    }),
  ).toMatchObject({ written: true });
  await world.t.run(async (ctx) => {
    const first = (await ctx.db.query("storagePositions").collect()).find(
      (p) => p._id === positionId,
    )!;
    await ctx.db.patch(first._id, { status: "INACTIVE" });
    // A migrated automatic leaf covers the whole area without reserving a cell.
    const { _id: _id, _creationTime: _creationTime, ...row } = first;
    await ctx.db.insert("storagePositions", {
      ...row,
      code: "DEFAULT",
      kind: "DEFAULT",
      isDefault: true,
      status: "ACTIVE",
      widthMm: 8_000,
      depthMm: 8_000,
    });
  });
  expect(
    await call(world, createStoragePosition, {
      ...args,
      requestId: "reuse-inactive",
      code: "C",
      xMm: 0,
    }),
  ).toMatchObject({ written: true });
});

it("fills rack space across rows and refuses a full area without partial writes", async () => {
  const { world, warehouseId, buildingId } = await setup("FLOOR_POSITIONS");
  const zone = await call(world, createStorageZone, {
    warehouseId,
    buildingId,
    requestId: "small-rack-area",
    floorNumber: 1,
    label: "Rack",
    mode: "RACK",
    xMm: 8_000,
    yMm: 0,
    widthMm: 2_000,
    depthMm: 2_000,
    maxStackHeightMm: 3_000,
  });
  expect(zone).toMatchObject({ written: true });
  const args = {
    warehouseId,
    zoneId: zone.documentId,
    bayCount: 1,
    levelCount: 2,
    slotsPerBay: 1,
    bayWidthMm: 1_000,
    rackDepthMm: 1_000,
    levelHeightMm: 1_000,
  };
  for (const fixtureCode of ["R1", "R2", "R3", "R4"]) {
    expect(
      await call(world, generateRackStoragePositions, {
        ...args,
        fixtureCode,
        requestId: `fill-${fixtureCode}`,
      }),
    ).toMatchObject({ written: true, createdCount: 2 });
  }
  const snapshot = () =>
    world.t.run(async (ctx) => ({
      positions: await ctx.db.query("storagePositions").collect(),
      locations: await ctx.db.query("locations").collect(),
      receipts: await ctx.db.query("idempotencyRecords").collect(),
      audits: (await ctx.db.query("auditEvents").collect()).filter((event) =>
        event.action.startsWith("storageLayout."),
      ),
    }));
  const before = await snapshot();
  const active = before.positions.filter(
    (p) => p.zoneId === zone.documentId && p.status === "ACTIVE",
  );
  expect(active).toHaveLength(8);
  expect(
    active.filter((p) => p.elevationMm === 0).map((p) => [p.xMm, p.yMm]),
  ).toEqual([
    [8_000, 0],
    [9_000, 0],
    [8_000, 1_000],
    [9_000, 1_000],
  ]);
  const overlappingPairs = active.flatMap((a, index) =>
    active
      .slice(index + 1)
      .filter(
        (b) =>
          a.elevationMm === b.elevationMm &&
          storageRectanglesOverlap(footprint(a), footprint(b)),
      ),
  ).length;
  expect(overlappingPairs).toBe(0);
  expect(
    await call(world, generateRackStoragePositions, {
      ...args,
      fixtureCode: "R5",
      requestId: "full-rack",
    }),
  ).toMatchObject({
    written: false,
    error: { code: "RACK_DOES_NOT_FIT_AREA" },
  });
  expect(await snapshot()).toEqual(before);

  const upper = active.find(
    (p) => p.fixtureCode === "R1" && p.elevationMm === 1_000,
  )!;
  const edit = {
    warehouseId,
    positionId: upper._id,
    label: "Upper",
    xMm: 9_000,
    yMm: 0,
    widthMm: 1_000,
    depthMm: 1_000,
    expectedRevision: storageRecordRevision(upper),
  };
  expect(
    await call(world, updateStoragePosition, {
      ...edit,
      requestId: "overlap-upper",
    }),
  ).toMatchObject({
    written: false,
    error: { code: "POSITION_OVERLAPS_POSITION" },
  });
  const adjacentUpper = active.find(
    (p) => p.fixtureCode === "R2" && p.elevationMm === 1_000,
  )!;
  await world.t.run((ctx) =>
    ctx.db.patch(adjacentUpper._id, { status: "INACTIVE" }),
  );
  expect(
    await call(world, updateStoragePosition, {
      ...edit,
      requestId: "above-lower",
    }),
  ).toMatchObject({ written: true });
});
