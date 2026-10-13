import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";

import { validateAndSummarizeStorageLayout } from "../../convex/model/storageLayout/storageLayout";
import { storageRecordRevision } from "../../convex/model/storageLayout/storageZone";
import type { DataModel } from "../../convex/schema";
import {
  activateStorageBuilding,
  approveF1F2Schematic,
  archiveStorageBuilding,
  changeStorageFloorCount,
  createStorageBuilding,
  removeTopStorageFloor,
  returnStorageBuildingToDraft,
  saveStorageFloor,
  updateStorageBuilding,
} from "../../convex/storageLayouts/writes";
import {
  archiveStoragePosition,
  archiveStorageZone,
  backfillStoragePositions,
  createStoragePosition,
  createStorageZone,
  updateStoragePosition,
  updateStorageZone,
} from "../../convex/storageLayouts/zones";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";
import { trackDocumentReads } from "../fixtures/document-reads";

interface RuntimeFunction {
  readonly _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
}

const orgA = { subject: "user_fixture_a", org_id: "org_fixture_a" };
const orgB = { subject: "user_fixture_a", org_id: "org_fixture_b" };

async function call(
  world: ConvexTenantWorld,
  fn: unknown,
  args: unknown,
  identity = orgA,
): Promise<Record<string, unknown>> {
  return (await world.t
    .withIdentity(identity)
    .run(async (ctx) =>
      (fn as RuntimeFunction)._handler(
        ctx as GenericMutationCtx<DataModel>,
        args,
      ),
    )) as Record<string, unknown>;
}

/** Run one call through a read-counting database; report query rows per table. */
async function callCountingRows(
  world: ConvexTenantWorld,
  fn: unknown,
  args: unknown,
) {
  const result = (await world.t.withIdentity(orgA).run(async (ctx) => {
    const tracked = trackDocumentReads(ctx.db);
    const outcome = await (fn as RuntimeFunction)._handler(
      { ...ctx, db: tracked.db } as GenericMutationCtx<DataModel>,
      args,
    );
    const rowsByTable: Record<string, number> = {};
    for (const entry of tracked.queryRows)
      rowsByTable[entry.table] = (rowsByTable[entry.table] ?? 0) + entry.count;
    return { outcome, rowsByTable } as never;
  })) as {
    outcome: Record<string, unknown>;
    rowsByTable: Record<string, number>;
  };
  return {
    outcome: result.outcome,
    rows: (table: string) => result.rowsByTable[table] ?? 0,
  };
}

function value(outcome: Record<string, unknown>): Record<string, unknown> {
  expect(outcome["ok"], JSON.stringify(outcome)).toBe(true);
  return outcome["value"] as Record<string, unknown>;
}

function refused(outcome: Record<string, unknown>, code: string) {
  expect(value(outcome)).toMatchObject({ written: false, error: { code } });
}

/** Every row a layout write or its replay could touch, plus domain audits. */
async function layoutState(world: ConvexTenantWorld) {
  return await world.t.run(async (ctx) => ({
    buildings: await ctx.db.query("storageBuildings").collect(),
    floors: await ctx.db.query("storageFloors").collect(),
    blocks: await ctx.db.query("storageFloorReservedBlocks").collect(),
    zones: await ctx.db.query("storageZones").collect(),
    positions: await ctx.db.query("storagePositions").collect(),
    locations: await ctx.db.query("locations").collect(),
    placements: await ctx.db.query("finishedGoodsPlacements").collect(),
    idempotency: await ctx.db.query("idempotencyRecords").collect(),
    domainAudits: (await ctx.db.query("auditEvents").collect()).filter(
      (event) => event.action.startsWith("storageLayout."),
    ),
  }));
}

async function plannerWorld() {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
  return { world, warehouseId: world.warehouses.alphaA };
}

async function createBuilding(
  world: ConvexTenantWorld,
  warehouseId: string,
  overrides: Record<string, unknown> = {},
) {
  return value(
    await call(world, createStorageBuilding, {
      warehouseId,
      requestId: "replay-building",
      code: "REPLAY",
      name: "Replay building",
      widthMm: 10_000,
      depthMm: 10_000,
      defaultFloorHeightMm: 4_000,
      floorCount: 1,
      ...overrides,
    }),
  )["documentId"] as string;
}

async function buildingVersion(world: ConvexTenantWorld, buildingId: string) {
  return await world.t.run(
    async (ctx) =>
      (await ctx.db.query("storageBuildings").collect()).find(
        (row) => row._id === buildingId,
      )!.version,
  );
}

/** The optimistic revision token a client would send for a zone or position. */
async function revisionOf(
  world: ConvexTenantWorld,
  table: "storageZones" | "storagePositions",
  id: string,
) {
  return await world.t.run(async (ctx) =>
    storageRecordRevision(
      (await ctx.db.query(table).collect()).find((row) => row._id === id)!,
    ),
  );
}

async function revokeLayoutManage(world: ConvexTenantWorld) {
  await world.t.run(async (ctx) => {
    for (const grant of await ctx.db.query("rolePermissions").collect()) {
      if (
        grant.orgId === world.orgA &&
        grant.permissionCode === "masterData.storageLayout.manage"
      )
        await ctx.db.delete(grant._id);
    }
  });
}

/**
 * Commit once, lose the reply, retry the identical request: the retry must
 * return the original receipt and leave every layout row untouched. Reusing
 * the request ID with different arguments must stay a fingerprint conflict.
 */
async function expectExactRetryRecoversReceipt(
  world: ConvexTenantWorld,
  fn: unknown,
  args: Record<string, unknown>,
  changedArgs: Record<string, unknown>,
) {
  const first = value(await call(world, fn, args));
  expect(first).toMatchObject({ written: true, replayed: false });
  const committed = await layoutState(world);

  expect(value(await call(world, fn, args))).toEqual({
    ...first,
    replayed: true,
  });
  expect(await layoutState(world)).toEqual(committed);

  refused(await call(world, fn, changedArgs), "REQUEST_ARGUMENT_CONFLICT");
  expect(await layoutState(world)).toEqual(committed);
  return first;
}

describe("storage layout write replay", () => {
  it("recovers building, floor, floor-count, top-floor and status receipts after their preconditions advanced", async () => {
    const { world, warehouseId } = await plannerWorld();
    const buildingId = await createBuilding(world, warehouseId);

    // Building update: the original advances version 1 -> 2.
    const buildingArgs = {
      warehouseId,
      buildingId,
      requestId: "lost-building-reply",
      expectedVersion: 1,
      name: "Renamed building",
      widthMm: 10_000,
      depthMm: 10_000,
      defaultFloorHeightMm: 4_000,
    };
    await expectExactRetryRecoversReceipt(
      world,
      updateStorageBuilding,
      buildingArgs,
      { ...buildingArgs, name: "Different name" },
    );
    // Fresh commands still need the current version.
    refused(
      await call(world, updateStorageBuilding, {
        ...buildingArgs,
        requestId: "fresh-stale-building",
      }),
      "VERSION_CONFLICT",
    );

    // Floor save: building 2 -> 3, floor 1 -> 2.
    const floorArgs = {
      warehouseId,
      buildingId,
      requestId: "lost-floor-reply",
      expectedBuildingVersion: 2,
      expectedFloorVersion: 2,
      floor: { floorNumber: 1, heightMm: 4_500, reservedBlocks: [] },
    };
    await expectExactRetryRecoversReceipt(world, saveStorageFloor, floorArgs, {
      ...floorArgs,
      floor: { ...floorArgs.floor, heightMm: 4_600 },
    });
    refused(
      await call(world, saveStorageFloor, {
        ...floorArgs,
        requestId: "fresh-stale-floor",
      }),
      "VERSION_CONFLICT",
    );

    // Floor-count increase: the retry's count no longer "increases".
    const countArgs = {
      warehouseId,
      buildingId,
      requestId: "lost-floor-count-reply",
      expectedVersion: 3,
      floorCount: 2,
    };
    await expectExactRetryRecoversReceipt(
      world,
      changeStorageFloorCount,
      countArgs,
      { ...countArgs, floorCount: 3 },
    );
    refused(
      await call(world, changeStorageFloorCount, {
        ...countArgs,
        requestId: "fresh-stale-floor-count",
        expectedVersion: 4,
      }),
      "FLOOR_COUNT_MUST_INCREASE",
    );
    expect(
      (await layoutState(world)).floors.map((floor) => floor.floorNumber),
    ).toEqual([1, 2]);

    // Top-floor removal: after the original, floor 2 no longer exists and the
    // version has advanced, so a retry that re-validated would be refused.
    const removeArgs = {
      warehouseId,
      buildingId,
      requestId: "lost-remove-top-reply",
      expectedVersion: 4,
      floorNumber: 2,
    };
    await expectExactRetryRecoversReceipt(
      world,
      removeTopStorageFloor,
      removeArgs,
      { ...removeArgs, floorNumber: 1 },
    );
    refused(
      await call(world, removeTopStorageFloor, {
        ...removeArgs,
        requestId: "fresh-remove-missing-top",
        expectedVersion: 5,
      }),
      "FLOOR_NOT_TOP",
    );
    expect(
      (await layoutState(world)).floors.map((floor) => floor.floorNumber),
    ).toEqual([1]);

    // Status changes: activation, return to draft and archive.
    value(
      await call(world, createStorageZone, {
        warehouseId,
        buildingId,
        floorNumber: 1,
        requestId: "replay-zone",
        label: "Replay zone",
        xMm: 0,
        yMm: 0,
        widthMm: 2_000,
        depthMm: 2_000,
        maxStackHeightMm: 3_000,
      }),
    );
    const statusVersion = await buildingVersion(world, buildingId);
    const activateArgs = {
      warehouseId,
      buildingId,
      requestId: "lost-activate-reply",
      expectedVersion: statusVersion,
    };
    await expectExactRetryRecoversReceipt(
      world,
      activateStorageBuilding,
      activateArgs,
      { ...activateArgs, expectedVersion: statusVersion + 1 },
    );
    const draftArgs = {
      ...activateArgs,
      requestId: "lost-draft-reply",
      expectedVersion: statusVersion + 1,
    };
    await expectExactRetryRecoversReceipt(
      world,
      returnStorageBuildingToDraft,
      draftArgs,
      { ...draftArgs, expectedVersion: statusVersion },
    );
    // A fresh return-to-draft from DRAFT is still refused by its lifecycle rule.
    refused(
      await call(world, returnStorageBuildingToDraft, {
        ...draftArgs,
        requestId: "fresh-draft-from-draft",
        expectedVersion: statusVersion + 2,
      }),
      "LAYOUT_NOT_EDITABLE",
    );
    const archiveArgs = {
      ...activateArgs,
      requestId: "lost-archive-reply",
      expectedVersion: statusVersion + 2,
    };
    await expectExactRetryRecoversReceipt(
      world,
      archiveStorageBuilding,
      archiveArgs,
      { ...archiveArgs, expectedVersion: statusVersion },
    );

    // The archived building now refuses fresh edits, but an exact retry of an
    // earlier committed edit still recovers its receipt without writing.
    const archived = await layoutState(world);
    refused(
      await call(world, updateStorageBuilding, {
        ...buildingArgs,
        requestId: "fresh-archived-building",
        expectedVersion: statusVersion + 3,
      }),
      "LAYOUT_NOT_EDITABLE",
    );
    expect(
      value(await call(world, updateStorageBuilding, buildingArgs)),
    ).toEqual({ written: true, documentId: buildingId, replayed: true });
    expect(value(await call(world, saveStorageFloor, floorArgs))).toMatchObject(
      { written: true, replayed: true },
    );
    expect(await layoutState(world)).toEqual(archived);

    // Replay never bypasses tenant isolation or authorization.
    await expect(
      call(world, updateStorageBuilding, buildingArgs, orgB),
    ).rejects.toThrow(/TENANT_CONTEXT_DENIED/);
    await revokeLayoutManage(world);
    expect(
      await call(world, updateStorageBuilding, buildingArgs),
    ).toMatchObject({ ok: false });
    expect(await layoutState(world)).toEqual(archived);
  });

  it("recovers an F1/F2 schematic approval receipt after the version advanced, without rereading zones", async () => {
    const { world, warehouseId } = await plannerWorld();
    const buildingId = await createBuilding(world, warehouseId, {
      requestId: "schematic-building",
      code: "F1-F2-SB",
      name: "F1 F2",
      widthMm: 600_000,
      floorCount: 2,
    });
    for (const floorNumber of [1, 2]) {
      value(
        await call(world, createStorageZone, {
          warehouseId,
          buildingId,
          floorNumber,
          requestId: `schematic-zone-${floorNumber}`,
          label: `Floor ${floorNumber}`,
          xMm: 0,
          yMm: 0,
          widthMm: 1_000,
          depthMm: 1_000,
          maxStackHeightMm: 3_000,
        }),
      );
    }
    // Clone enough active zones to satisfy the reference zone counts.
    await world.t.run(async (ctx) => {
      const originals = await ctx.db.query("storageZones").collect();
      const locations = await ctx.db.query("locations").collect();
      for (const original of originals) {
        const floor = await ctx.db.get(original.floorId);
        const clones = floor!.floorNumber === 1 ? 299 : 149;
        const { _id: zoneId, _creationTime: zoneTime, ...zone } = original;
        const {
          _id: locationId,
          _creationTime: locationTime,
          ...location
        } = locations.find((row) => row._id === original.locationId)!;
        void zoneId;
        void zoneTime;
        void locationId;
        void locationTime;
        for (let i = 1; i <= clones; i++) {
          const code = `${original.code}-${String(i).padStart(4, "0")}`;
          const cloned = await ctx.db.insert("locations", {
            ...location,
            code,
          });
          await ctx.db.insert("storageZones", {
            ...zone,
            locationId: cloned,
            code,
            label: code,
            qrValue: `zone:${cloned}`,
            xMm: i * 1_000,
          });
        }
      }
    });

    const approveArgs = {
      warehouseId,
      buildingId,
      requestId: "lost-schematic-reply",
      expectedVersion: 1,
    };
    const fresh = await callCountingRows(
      world,
      approveF1F2Schematic,
      approveArgs,
    );
    expect(value(fresh.outcome)).toEqual({
      written: true,
      documentId: buildingId,
      replayed: false,
    });
    // The fresh approval counts every active zone on both floors.
    expect(fresh.rows("storageZones")).toBe(450);
    const committed = await layoutState(world);

    // The lost-reply retry answers from its receipt: no VERSION_CONFLICT, and
    // no floor or zone scan for a decision that was already made.
    const retry = await callCountingRows(
      world,
      approveF1F2Schematic,
      approveArgs,
    );
    expect(value(retry.outcome)).toEqual({
      written: true,
      documentId: buildingId,
      replayed: true,
    });
    expect(retry.rows("storageZones")).toBe(0);
    expect(retry.rows("storageFloors")).toBe(0);
    expect(await layoutState(world)).toEqual(committed);

    refused(
      await call(world, approveF1F2Schematic, {
        ...approveArgs,
        expectedVersion: 2,
      }),
      "REQUEST_ARGUMENT_CONFLICT",
    );
    refused(
      await call(world, approveF1F2Schematic, {
        ...approveArgs,
        requestId: "fresh-stale-schematic",
      }),
      "VERSION_CONFLICT",
    );
    expect(await layoutState(world)).toEqual(committed);

    // Archived buildings refuse fresh approval; the exact retry still replays.
    value(
      await call(world, archiveStorageBuilding, {
        warehouseId,
        buildingId,
        requestId: "schematic-archive",
        expectedVersion: 2,
      }),
    );
    const archived = await layoutState(world);
    refused(
      await call(world, approveF1F2Schematic, {
        ...approveArgs,
        requestId: "fresh-archived-schematic",
        expectedVersion: 3,
      }),
      "LAYOUT_NOT_EDITABLE",
    );
    expect(
      value(await call(world, approveF1F2Schematic, approveArgs)),
    ).toMatchObject({ written: true, replayed: true });
    expect(await layoutState(world)).toEqual(archived);

    await expect(
      call(world, approveF1F2Schematic, approveArgs, orgB),
    ).rejects.toThrow(/TENANT_CONTEXT_DENIED/);
    await revokeLayoutManage(world);
    expect(await call(world, approveF1F2Schematic, approveArgs)).toMatchObject({
      ok: false,
    });
    expect(await layoutState(world)).toEqual(archived);
  });
});

describe("storage zone update replay", () => {
  it("replays an older zone update without rewriting the newer zone or its default position", async () => {
    const { world, warehouseId } = await plannerWorld();
    const buildingId = await createBuilding(world, warehouseId);
    const zoneId = value(
      await call(world, createStorageZone, {
        warehouseId,
        buildingId,
        floorNumber: 1,
        requestId: "zone-create",
        label: "Original zone",
        xMm: 0,
        yMm: 0,
        widthMm: 2_000,
        depthMm: 2_000,
        maxStackHeightMm: 3_000,
      }),
    )["documentId"] as string;
    const updateA = {
      warehouseId,
      zoneId,
      requestId: "zone-A",
      label: "Zone A",
      xMm: 1_000,
      yMm: 0,
      widthMm: 2_000,
      depthMm: 2_000,
      maxStackHeightMm: 3_000,
      expectedRevision: await revisionOf(world, "storageZones", zoneId),
    };
    const geometry = async () => {
      const state = await layoutState(world);
      return {
        zones: state.zones.map((zone) => [zone.label, zone.xMm]),
        positions: state.positions.map((position) => [
          position.label,
          position.xMm,
          position.isDefault,
        ]),
      };
    };

    expect(value(await call(world, updateStorageZone, updateA))).toEqual({
      written: true,
      documentId: zoneId,
      replayed: false,
    });
    expect(await geometry()).toEqual({
      zones: [["Zone A", 1_000]],
      positions: [["Zone A", 1_000, true]],
    });
    const updateB = {
      ...updateA,
      requestId: "zone-B",
      label: "Zone B",
      xMm: 2_000,
      expectedRevision: await revisionOf(world, "storageZones", zoneId),
    };
    expect(value(await call(world, updateStorageZone, updateB))).toEqual({
      written: true,
      documentId: zoneId,
      replayed: false,
    });
    const newer = await layoutState(world);
    const receipt = { written: true, documentId: zoneId, replayed: true };

    // The lost-reply retry of A after B committed: A's revision is stale,
    // yet the retry answers from its receipt and no child sync runs.
    expect(value(await call(world, updateStorageZone, updateA))).toEqual(
      receipt,
    );
    expect(await layoutState(world)).toEqual(newer);
    expect(await geometry()).toEqual({
      zones: [["Zone B", 2_000]],
      positions: [["Zone B", 2_000, true]],
    });

    // A reused request ID with changed arguments is still a conflict.
    refused(
      await call(world, updateStorageZone, { ...updateA, xMm: 3_000 }),
      "REQUEST_ARGUMENT_CONFLICT",
    );
    expect(await layoutState(world)).toEqual(newer);
    // A fresh command with A's stale revision is still a version conflict.
    refused(
      await call(world, updateStorageZone, {
        ...updateA,
        requestId: "zone-stale",
      }),
      "VERSION_CONFLICT",
    );
    expect(await layoutState(world)).toEqual(newer);

    // A fresh update still validates and synchronizes its default position.
    expect(
      value(
        await call(world, updateStorageZone, {
          ...updateA,
          requestId: "zone-C",
          label: "Zone C",
          xMm: 3_000,
          widthMm: 1_500,
          expectedRevision: await revisionOf(world, "storageZones", zoneId),
        }),
      ),
    ).toMatchObject({ written: true, replayed: false });
    expect(
      (await layoutState(world)).positions.map((position) => ({
        label: position.label,
        xMm: position.xMm,
        widthMm: position.widthMm,
      })),
    ).toEqual([{ label: "Zone C", xMm: 3_000, widthMm: 1_500 }]);
    const outOfFloor = value(
      await call(world, updateStorageZone, {
        ...updateA,
        requestId: "zone-out-of-floor",
        xMm: 9_000,
        expectedRevision: await revisionOf(world, "storageZones", zoneId),
      }),
    );
    expect(outOfFloor).toMatchObject({ written: false });
    expect(outOfFloor["error"]).not.toMatchObject({
      code: "VERSION_CONFLICT",
    });

    // After the building is archived, the exact retry of A still replays.
    value(
      await call(world, archiveStorageBuilding, {
        warehouseId,
        buildingId,
        requestId: "zone-building-archive",
        expectedVersion: await buildingVersion(world, buildingId),
      }),
    );
    const latest = await layoutState(world);
    expect(value(await call(world, updateStorageZone, updateA))).toEqual(
      receipt,
    );
    expect(await layoutState(world)).toEqual(latest);

    // Replay does not bypass tenant isolation or authorization.
    await expect(call(world, updateStorageZone, updateA, orgB)).rejects.toThrow(
      /TENANT_CONTEXT_DENIED/,
    );
    await revokeLayoutManage(world);
    expect(await call(world, updateStorageZone, updateA)).toMatchObject({
      ok: false,
    });
    expect(await layoutState(world)).toEqual(latest);
  });
});

describe("storage floor optional overrides", () => {
  function storedLayout(state: Awaited<ReturnType<typeof layoutState>>) {
    const building = state.buildings[0]!;
    return validateAndSummarizeStorageLayout({
      widthMm: building.widthMm,
      depthMm: building.depthMm,
      defaultFloorHeightMm: building.defaultFloorHeightMm,
      floors: state.floors.map((floor) => ({
        floorNumber: floor.floorNumber,
        ...(floor.widthMm === undefined ? {} : { widthMm: floor.widthMm }),
        ...(floor.depthMm === undefined ? {} : { depthMm: floor.depthMm }),
        ...(floor.heightMm === undefined ? {} : { heightMm: floor.heightMm }),
        ...(floor.offsetXMm === undefined
          ? {}
          : { offsetXMm: floor.offsetXMm }),
        ...(floor.offsetYMm === undefined
          ? {}
          : { offsetYMm: floor.offsetYMm }),
        reservedBlocks: [],
      })),
    });
  }

  it("stores omitted offsets as inherited, matching the geometry it validated", async () => {
    const { world, warehouseId } = await plannerWorld();
    const buildingId = await createBuilding(world, warehouseId);
    expect(
      value(
        await call(world, saveStorageFloor, {
          warehouseId,
          buildingId,
          requestId: "offset-override",
          expectedBuildingVersion: 1,
          expectedFloorVersion: 1,
          floor: {
            floorNumber: 1,
            widthMm: 6_000,
            depthMm: 8_000,
            offsetXMm: 2_000,
            offsetYMm: 1_000,
            reservedBlocks: [],
          },
        }),
      ),
    ).toMatchObject({ written: true });
    expect((await layoutState(world)).floors[0]).toMatchObject({
      widthMm: 6_000,
      offsetXMm: 2_000,
      offsetYMm: 1_000,
    });

    // Omit dimensions and offsets: both inherit, nothing old is retained.
    expect(
      value(
        await call(world, saveStorageFloor, {
          warehouseId,
          buildingId,
          requestId: "offset-inherit",
          expectedBuildingVersion: 2,
          expectedFloorVersion: 2,
          floor: { floorNumber: 1, reservedBlocks: [] },
        }),
      ),
    ).toMatchObject({ written: true });
    const inherited = await layoutState(world);
    for (const field of [
      "widthMm",
      "depthMm",
      "offsetXMm",
      "offsetYMm",
    ] as const)
      expect(inherited.floors[0]).not.toHaveProperty(field);
    const summary = storedLayout(inherited);
    expect(summary.ok).toBe(true);
    if (summary.ok)
      expect(summary.value.floors[0]).toMatchObject({
        widthMm: 10_000,
        depthMm: 10_000,
        offsetXMm: 0,
        offsetYMm: 0,
      });

    // Inherited geometry keeps following the building within its bounds.
    expect(
      value(
        await call(world, updateStorageBuilding, {
          warehouseId,
          buildingId,
          requestId: "offset-new-defaults",
          expectedVersion: 3,
          name: "Replay building",
          widthMm: 12_000,
          depthMm: 9_000,
          defaultFloorHeightMm: 4_000,
        }),
      ),
    ).toMatchObject({ written: true });
    const grown = storedLayout(await layoutState(world));
    expect(grown.ok).toBe(true);
    if (grown.ok)
      expect(grown.value.floors[0]).toMatchObject({
        widthMm: 12_000,
        depthMm: 9_000,
        offsetXMm: 0,
        offsetYMm: 0,
      });
  });

  it("keeps explicit offsets with inherited dimensions only when they fit the building", async () => {
    const { world, warehouseId } = await plannerWorld();
    const buildingId = await createBuilding(world, warehouseId);
    value(
      await call(world, saveStorageFloor, {
        warehouseId,
        buildingId,
        requestId: "explicit-override",
        expectedBuildingVersion: 1,
        expectedFloorVersion: 1,
        floor: {
          floorNumber: 1,
          widthMm: 6_000,
          offsetXMm: 2_000,
          reservedBlocks: [],
        },
      }),
    );
    const before = await layoutState(world);

    // Explicit offset 2000 with inherited width 10000 would exceed the building.
    refused(
      await call(world, saveStorageFloor, {
        warehouseId,
        buildingId,
        requestId: "explicit-offset-out-of-bounds",
        expectedBuildingVersion: 2,
        expectedFloorVersion: 2,
        floor: { floorNumber: 1, offsetXMm: 2_000, reservedBlocks: [] },
      }),
      "FLOOR_OUT_OF_BOUNDS",
    );
    expect(await layoutState(world)).toEqual(before);

    // Omitting only the offset after an offset floor resets it to inherited.
    expect(
      value(
        await call(world, saveStorageFloor, {
          warehouseId,
          buildingId,
          requestId: "omit-offset-keep-width",
          expectedBuildingVersion: 2,
          expectedFloorVersion: 2,
          floor: { floorNumber: 1, widthMm: 6_000, reservedBlocks: [] },
        }),
      ),
    ).toMatchObject({ written: true });
    const centered = await layoutState(world);
    expect(centered.floors[0]).toMatchObject({ widthMm: 6_000 });
    expect(centered.floors[0]).not.toHaveProperty("offsetXMm");
    const summary = storedLayout(centered);
    expect(summary.ok).toBe(true);
    if (summary.ok)
      expect(summary.value.floors[0]).toMatchObject({
        widthMm: 6_000,
        offsetXMm: 2_000,
      });

    // Explicit offsets inside the inherited footprint are stored as sent.
    expect(
      value(
        await call(world, saveStorageFloor, {
          warehouseId,
          buildingId,
          requestId: "explicit-zero-offset",
          expectedBuildingVersion: 3,
          expectedFloorVersion: 3,
          floor: {
            floorNumber: 1,
            offsetXMm: 0,
            offsetYMm: 0,
            reservedBlocks: [],
          },
        }),
      ),
    ).toMatchObject({ written: true });
    const explicit = (await layoutState(world)).floors[0];
    expect(explicit).toMatchObject({ offsetXMm: 0, offsetYMm: 0 });
    expect(explicit).not.toHaveProperty("widthMm");
  });
});

describe("storage position and area archive replay", () => {
  /** A FLOOR_POSITIONS area at 0/0, 6000 × 6000, with `count` positions. */
  async function positionedArea(
    world: ConvexTenantWorld,
    warehouseId: string,
    count: number,
  ) {
    const buildingId = await createBuilding(world, warehouseId);
    const zoneId = value(
      await call(world, createStorageZone, {
        warehouseId,
        buildingId,
        floorNumber: 1,
        requestId: "positions-zone",
        label: "Positions",
        mode: "FLOOR_POSITIONS",
        xMm: 0,
        yMm: 0,
        widthMm: 6_000,
        depthMm: 6_000,
        maxStackHeightMm: 3_000,
      }),
    )["documentId"] as string;
    const positionIds: string[] = [];
    for (let index = 0; index < count; index += 1)
      positionIds.push(
        value(
          await call(world, createStoragePosition, {
            warehouseId,
            zoneId,
            requestId: `position-${index}`,
            code: `P${index}`,
            label: `Position ${index}`,
            xMm: index * 2_000,
            yMm: 0,
            widthMm: 2_000,
            depthMm: 2_000,
          }),
        )["documentId"] as string,
      );
    return { buildingId, zoneId, positionIds };
  }

  /** Store one pallet on a position, the way a finished-goods move would. */
  async function occupy(world: ConvexTenantWorld, positionId: string) {
    return await world.t.run(async (ctx) => {
      const position = (await ctx.db.query("storagePositions").collect()).find(
        (row) => row._id === positionId,
      )!;
      const audit = {
        orgId: world.orgA,
        warehouseId: position.warehouseId,
        createdAt: 1,
        updatedAt: 1,
        createdByUserId: world.userA,
        updatedByUserId: world.userA,
      };
      const productId = await ctx.db.insert("finishedGoodsProducts", {
        ...audit,
        sku: `SKU-${position.code}`,
        name: "Boxes",
        unit: "pieces",
        storageFormat: "PALLET",
        storageCondition: "DRY",
        status: "ACTIVE",
      });
      const palletId = await ctx.db.insert("finishedGoodsPallets", {
        ...audit,
        productId,
        code: `PAL-${position.code}`,
        quantity: 10,
        lengthMm: 1_200,
        widthMm: 1_000,
        heightMm: 1_400,
        status: "STORED",
      });
      return await ctx.db.insert("finishedGoodsPlacements", {
        ...audit,
        palletId,
        buildingId: position.buildingId,
        floorId: position.floorId,
        zoneId: position.zoneId,
        locationId: position.locationId,
        supportPositionId: position._id,
        positionCode: position.code,
        qrValue: `PLACEMENT-${position.code}`,
        xMm: position.xMm ?? 0,
        yMm: position.yMm ?? 0,
        zMm: 0,
        widthMm: 1_000,
        depthMm: 1_200,
        heightMm: 1_400,
        rotation: 0,
        status: "STORED",
      });
    });
  }

  /**
   * Exact retry args aimed at another warehouse of the same organization are
   * denied by the wrapper while out of scope. Once the member may use that
   * warehouse, the org-scoped receipt sees different arguments for the same
   * request ID (a conflict), and a fresh request fails the handler's
   * identity check. None of these paths writes.
   */
  async function expectOtherWarehouseRefused(
    world: ConvexTenantWorld,
    fn: unknown,
    args: Record<string, unknown>,
  ) {
    const before = await layoutState(world);
    const elsewhere = { ...args, warehouseId: world.warehouses.bravoA };
    await expect(call(world, fn, elsewhere)).rejects.toThrow(
      /WAREHOUSE_OUT_OF_SCOPE/,
    );
    await world.t.run(async (ctx) => {
      const membership = (await ctx.db.query("memberships").collect()).find(
        (row) => row.orgId === world.orgA,
      )!;
      await ctx.db.insert("membershipWarehouses", {
        orgId: world.orgA,
        membershipId: membership._id,
        warehouseId: world.warehouses.bravoA,
      });
    });
    refused(await call(world, fn, elsewhere), "REQUEST_ARGUMENT_CONFLICT");
    refused(
      await call(world, fn, {
        ...elsewhere,
        requestId: `${String(args["requestId"])}-elsewhere`,
      }),
      "NOT_FOUND",
    );
    expect(await layoutState(world)).toEqual(before);
  }

  it("replays an older position update after newer geometry, occupancy and archive without writing", async () => {
    const { world, warehouseId } = await plannerWorld();
    const {
      positionIds: [p0],
    } = await positionedArea(world, warehouseId, 2);
    const updateA = {
      warehouseId,
      positionId: p0,
      requestId: "position-A",
      label: "Position A",
      xMm: 0,
      yMm: 0,
      widthMm: 1_800,
      depthMm: 2_000,
      expectedRevision: await revisionOf(world, "storagePositions", p0!),
    };
    expect(value(await call(world, updateStoragePosition, updateA))).toEqual({
      written: true,
      documentId: p0,
      replayed: false,
    });
    const updateB = {
      ...updateA,
      requestId: "position-B",
      label: "Position B",
      widthMm: 1_500,
      expectedRevision: await revisionOf(world, "storagePositions", p0!),
    };
    expect(value(await call(world, updateStoragePosition, updateB))).toEqual({
      written: true,
      documentId: p0,
      replayed: false,
    });
    const newer = await layoutState(world);
    const receipt = { written: true, documentId: p0, replayed: true };

    // A -> B -> lost-reply retry of A: receipt, and B's geometry survives.
    expect(value(await call(world, updateStoragePosition, updateA))).toEqual(
      receipt,
    );
    expect(await layoutState(world)).toEqual(newer);
    expect(
      newer.positions.find((position) => position._id === p0),
    ).toMatchObject({ label: "Position B", widthMm: 1_500 });

    // A's request ID with changed arguments stays a conflict.
    refused(
      await call(world, updateStoragePosition, { ...updateA, widthMm: 1_600 }),
      "REQUEST_ARGUMENT_CONFLICT",
    );
    expect(await layoutState(world)).toEqual(newer);

    // A pallet now occupies the area. The retry still recovers its receipt;
    // a fresh geometry change is still refused by the live occupancy check.
    const placementId = await occupy(world, p0!);
    const occupied = await layoutState(world);
    expect(value(await call(world, updateStoragePosition, updateA))).toEqual(
      receipt,
    );
    expect(await layoutState(world)).toEqual(occupied);
    refused(
      await call(world, updateStoragePosition, {
        ...updateA,
        requestId: "position-fresh-occupied",
        expectedRevision: await revisionOf(world, "storagePositions", p0!),
      }),
      "LOCATION_OCCUPIED",
    );
    expect(await layoutState(world)).toEqual(occupied);

    // After the position is archived, fresh updates are refused by the live
    // status check, while the exact retry still replays without writing.
    await world.t.run((ctx) =>
      ctx.db.patch(placementId, { status: "RELEASED" }),
    );
    expect(
      value(
        await call(world, archiveStoragePosition, {
          warehouseId,
          positionId: p0,
          requestId: "position-archive",
        }),
      ),
    ).toMatchObject({ written: true, replayed: false });
    const archived = await layoutState(world);
    expect(value(await call(world, updateStoragePosition, updateA))).toEqual(
      receipt,
    );
    expect(await layoutState(world)).toEqual(archived);
    refused(
      await call(world, updateStoragePosition, {
        ...updateB,
        requestId: "position-fresh-archived",
        expectedRevision: await revisionOf(world, "storagePositions", p0!),
      }),
      "NOT_FOUND",
    );

    // Warehouse, tenant and permission guards still apply to the replay.
    await expectOtherWarehouseRefused(world, updateStoragePosition, updateA);
    await expect(
      call(world, updateStoragePosition, updateA, orgB),
    ).rejects.toThrow(/TENANT_CONTEXT_DENIED/);
    await revokeLayoutManage(world);
    expect(await call(world, updateStoragePosition, updateA)).toMatchObject({
      ok: false,
    });
    expect(await layoutState(world)).toEqual(archived);
  });

  it("replays an earlier position archive after activation left one leaf or the area became occupied", async () => {
    const { world, warehouseId } = await plannerWorld();
    const {
      buildingId,
      positionIds: [p0, p1, p2],
    } = await positionedArea(world, warehouseId, 3);
    const archiveA = { warehouseId, positionId: p0, requestId: "archive-A" };
    expect(value(await call(world, archiveStoragePosition, archiveA))).toEqual({
      written: true,
      documentId: p0,
      replayed: false,
    });
    const receipt = { written: true, documentId: p0, replayed: true };
    expect(value(await call(world, archiveStoragePosition, archiveA))).toEqual(
      receipt,
    );
    expect(
      value(
        await call(world, archiveStoragePosition, {
          warehouseId,
          positionId: p1,
          requestId: "archive-B",
        }),
      ),
    ).toMatchObject({ written: true, replayed: false });
    // Activation makes the last leaf mandatory for fresh archives.
    value(
      await call(world, activateStorageBuilding, {
        warehouseId,
        buildingId,
        requestId: "archive-activate",
        expectedVersion: await buildingVersion(world, buildingId),
      }),
    );
    const newer = await layoutState(world);
    expect(
      newer.positions.map((position) => [position.code, position.status]),
    ).toEqual([
      ["REPLAY-F01-Z01-P0", "INACTIVE"],
      ["REPLAY-F01-Z01-P1", "INACTIVE"],
      ["REPLAY-F01-Z01-P2", "ACTIVE"],
    ]);

    // A -> B -> retry A: only p2 is left, yet the retry recovers A's receipt
    // and touches nothing.
    expect(value(await call(world, archiveStoragePosition, archiveA))).toEqual(
      receipt,
    );
    expect(await layoutState(world)).toEqual(newer);
    refused(
      await call(world, archiveStoragePosition, {
        ...archiveA,
        positionId: p2,
      }),
      "REQUEST_ARGUMENT_CONFLICT",
    );
    expect(await layoutState(world)).toEqual(newer);
    // A fresh archive of the last leaf is still refused.
    refused(
      await call(world, archiveStoragePosition, {
        warehouseId,
        positionId: p2,
        requestId: "archive-last-leaf",
      }),
      "AREA_REQUIRES_LEAF_POSITION",
    );
    expect(await layoutState(world)).toEqual(newer);

    // Occupancy: fresh archive refused, exact retry still replays.
    await occupy(world, p2!);
    const occupied = await layoutState(world);
    expect(value(await call(world, archiveStoragePosition, archiveA))).toEqual(
      receipt,
    );
    refused(
      await call(world, archiveStoragePosition, {
        warehouseId,
        positionId: p2,
        requestId: "archive-occupied",
      }),
      "LOCATION_OCCUPIED",
    );
    expect(await layoutState(world)).toEqual(occupied);

    await expectOtherWarehouseRefused(world, archiveStoragePosition, archiveA);
    await expect(
      call(world, archiveStoragePosition, archiveA, orgB),
    ).rejects.toThrow(/TENANT_CONTEXT_DENIED/);
    await revokeLayoutManage(world);
    expect(await call(world, archiveStoragePosition, archiveA)).toMatchObject({
      ok: false,
    });
    expect(await layoutState(world)).toEqual(occupied);
  });

  it("replays an area archive after its building was archived, keeping fresh guards", async () => {
    const { world, warehouseId } = await plannerWorld();
    const buildingId = await createBuilding(world, warehouseId);
    const zone = async (requestId: string, xMm: number) =>
      value(
        await call(world, createStorageZone, {
          warehouseId,
          buildingId,
          floorNumber: 1,
          requestId,
          label: requestId,
          xMm,
          yMm: 0,
          widthMm: 2_000,
          depthMm: 2_000,
          maxStackHeightMm: 3_000,
        }),
      )["documentId"] as string;
    const zone1 = await zone("area-1", 0);
    const zone2 = await zone("area-2", 3_000);
    const archiveA = { warehouseId, zoneId: zone1, requestId: "area-A" };
    expect(value(await call(world, archiveStorageZone, archiveA))).toEqual({
      written: true,
      documentId: zone1,
      replayed: false,
    });
    const receipt = { written: true, documentId: zone1, replayed: true };
    const committed = await layoutState(world);
    expect(value(await call(world, archiveStorageZone, archiveA))).toEqual(
      receipt,
    );
    expect(await layoutState(world)).toEqual(committed);
    refused(
      await call(world, archiveStorageZone, { ...archiveA, zoneId: zone2 }),
      "REQUEST_ARGUMENT_CONFLICT",
    );
    expect(await layoutState(world)).toEqual(committed);

    // A fresh archive of an occupied area is still refused.
    const zone2Default = committed.positions.find(
      (position) => position.zoneId === zone2,
    )!;
    const placementId = await occupy(world, zone2Default._id);
    refused(
      await call(world, archiveStorageZone, {
        warehouseId,
        zoneId: zone2,
        requestId: "area-occupied",
      }),
      "LOCATION_OCCUPIED",
    );
    await world.t.run((ctx) =>
      ctx.db.patch(placementId, { status: "RELEASED" }),
    );

    // B: the building is archived. A's exact retry still recovers its receipt.
    value(
      await call(world, archiveStorageBuilding, {
        warehouseId,
        buildingId,
        requestId: "area-building-archive",
        expectedVersion: await buildingVersion(world, buildingId),
      }),
    );
    const archived = await layoutState(world);
    expect(value(await call(world, archiveStorageZone, archiveA))).toEqual(
      receipt,
    );
    expect(await layoutState(world)).toEqual(archived);
    refused(
      await call(world, archiveStorageZone, {
        warehouseId,
        zoneId: zone2,
        requestId: "area-fresh-archived-building",
      }),
      "LAYOUT_NOT_EDITABLE",
    );
    expect(await layoutState(world)).toEqual(archived);

    await expectOtherWarehouseRefused(world, archiveStorageZone, archiveA);
    await expect(
      call(world, archiveStorageZone, archiveA, orgB),
    ).rejects.toThrow(/TENANT_CONTEXT_DENIED/);
    await revokeLayoutManage(world);
    expect(await call(world, archiveStorageZone, archiveA)).toMatchObject({
      ok: false,
    });
    expect(await layoutState(world)).toEqual(archived);
  });

  it("does not archive a default position that a later backfill created", async () => {
    const { world, warehouseId } = await plannerWorld();
    const buildingId = await createBuilding(world, warehouseId);
    const zoneId = value(
      await call(world, createStorageZone, {
        warehouseId,
        buildingId,
        floorNumber: 1,
        requestId: "legacy-area",
        label: "Legacy",
        xMm: 0,
        yMm: 0,
        widthMm: 2_000,
        depthMm: 2_000,
        maxStackHeightMm: 3_000,
      }),
    )["documentId"] as string;
    // Legacy layout data: the area predates storage positions.
    await world.t.run(async (ctx) => {
      for (const position of await ctx.db.query("storagePositions").collect())
        await ctx.db.delete(position._id);
    });
    const archiveA = { warehouseId, zoneId, requestId: "legacy-archive-A" };
    expect(value(await call(world, archiveStorageZone, archiveA))).toEqual({
      written: true,
      documentId: zoneId,
      replayed: false,
    });

    // B: the position backfill later adds the area's default position.
    expect(
      value(
        await call(world, backfillStoragePositions, {
          warehouseId,
          requestId: "legacy-backfill",
        }),
      ),
    ).toMatchObject({ written: true, createdCount: 1 });
    const newer = await layoutState(world);
    expect(newer.positions).toEqual([
      expect.objectContaining({ zoneId, isDefault: true, status: "ACTIVE" }),
    ]);

    // Retry A: its receipt only, no write to B's position.
    expect(value(await call(world, archiveStorageZone, archiveA))).toEqual({
      written: true,
      documentId: zoneId,
      replayed: true,
    });
    expect(await layoutState(world)).toEqual(newer);
  });
});
