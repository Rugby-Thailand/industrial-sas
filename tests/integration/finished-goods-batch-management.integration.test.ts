import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";
import * as batches from "../../convex/finishedGoods/batches";
import * as management from "../../convex/finishedGoods/batchManagement";
import type { Id } from "../../convex/_generated/dataModel";
import type { DataModel } from "../../convex/schema";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";
interface RuntimeFunction {
  _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
}
async function call(
  world: ConvexTenantWorld,
  fn: unknown,
  args: unknown,
  auth = true,
) {
  return (
    auth
      ? world.t.withIdentity({
          subject: "user_fixture_a",
          org_id: "org_fixture_a",
        })
      : world.t
  ).run((ctx) =>
    (fn as RuntimeFunction)._handler(
      ctx as GenericMutationCtx<DataModel>,
      args,
    ),
  );
}
const productFields = {
  sku: "PACK-1",
  name: "Packing product",
  unit: "PCS",
  storageFormat: "PALLET",
  defaultQuantity: 500,
  storageCondition: "ANY",
  draft: false,
};
const row = {
  quantity: 500,
  lengthMm: 1200,
  widthMm: 1000,
  heightMm: 1400,
  dimensionsChecked: true,
};
async function setup(roleA: "ORG_ADMIN" | "SUPERVISOR" = "ORG_ADMIN") {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, { roleA });
  const warehouseId = world.warehouses.alphaA;
  // Set up the product directly so authorization tests also exercise readers.
  const productId = await world.t.run((ctx) =>
    ctx.db.insert("finishedGoodsProducts", {
      orgId: world.orgA,
      warehouseId,
      sku: productFields.sku,
      name: productFields.name,
      unit: "PCS",
      storageFormat: "PALLET",
      defaultQuantity: 500,
      storageCondition: "ANY",
      status: "ACTIVE",
      createdAt: 1,
      updatedAt: 1,
      createdByUserId: world.userA,
      updatedByUserId: world.userA,
    }),
  );
  const args = {
    warehouseId,
    productId,
    requestId: "pack-1",
    totalQuantity: 100,
    storageFormat: "PALLET",
    packages: [
      { ...row, quantity: 50 },
      { ...row, quantity: 50 },
    ],
  };
  return { world, args };
}
async function pallets(world: ConvexTenantWorld) {
  return world.t.run((ctx) => ctx.db.query("finishedGoodsPallets").collect());
}
async function active(world: ConvexTenantWorld) {
  return (await pallets(world)).filter((p) => !p.retiredAt);
}
async function partialWorld() {
  const { world, args } = await setup();
  await call(world, batches.commitBatch, {
    ...args,
    totalQuantity: 110,
    packages: [
      { ...row, quantity: 50 },
      { ...row, quantity: 50 },
      { ...row, quantity: 10 },
    ],
  });
  const original = await active(world);
  await world.t.run((ctx) =>
    ctx.db.patch(original[0]!._id, { status: "STORED" }),
  );
  const protectedUnit = await world.t.run((ctx) =>
    ctx.db.get(original[0]!._id),
  );
  const request = {
    warehouseId: args.warehouseId,
    batchId: original[0]!.preparationBatchId!,
    expectedRevision: 1,
    requestId: "partial",
    unitIds: original.slice(1).map((u) => u._id),
    packages: [
      { ...row, quantity: 30 },
      { ...row, quantity: 30 },
    ],
  };
  return { world, args, original, protectedUnit, request };
}
describe("partial batch management", () => {
  it.each(["placement", "support", "move"])(
    "a real %s hold prevents repacking even if the unit status is stale",
    async (kind) => {
      const { world, request, original } = await partialWorld();
      const location = await storageFixture(world);
      const hold = await world.t.run(async (ctx) => {
        const placementId = await ctx.db.insert("finishedGoodsPlacements", {
          orgId: world.orgA,
          warehouseId: request.warehouseId,
          ...location,
          palletId: kind === "support" ? original[2]!._id : original[1]!._id,
          ...(kind === "support" ? { supportPalletId: original[1]!._id } : {}),
          positionCode: "HOLD",
          qrValue: "HOLD",
          xMm: 0,
          yMm: 0,
          zMm: 0,
          widthMm: 1000,
          depthMm: 1200,
          heightMm: 1400,
          rotation: 0,
          status: kind === "move" ? "RELEASED" : "RESERVED",
          createdAt: 1,
          updatedAt: 1,
          createdByUserId: world.userA,
          updatedByUserId: world.userA,
        });
        if (kind === "move")
          await ctx.db.insert("finishedGoodsMoves", {
            orgId: world.orgA,
            warehouseId: request.warehouseId,
            palletId: original[1]!._id,
            sourcePlacementId: placementId,
            targetPlacementId: placementId,
            sourceUpdatedAt: 1,
            targetUpdatedAt: 1,
            palletUpdatedAt: 1,
            ownerUserId: world.userA,
            status: "IN_TRANSIT",
            createdAt: 1,
            updatedAt: 1,
            createdByUserId: world.userA,
            updatedByUserId: world.userA,
          });
        return placementId;
      });
      const before = await pallets(world);
      expect(
        await call(world, management.repackAvailable, request),
      ).toMatchObject({
        ok: true,
        value: { written: false, error: { code: "BATCH_NOT_EDITABLE" } },
      });
      expect(await pallets(world)).toEqual(before);
      // A released support no longer locks its former base.
      if (kind === "support") {
        await world.t.run((ctx) => ctx.db.patch(hold, { status: "RELEASED" }));
        expect(
          await call(world, management.repackAvailable, {
            ...request,
            requestId: "released",
          }),
        ).toMatchObject({ ok: true, value: { written: true } });
      }
    },
  );
  it("replaces only the 60 available pieces and preserves the stored 50 exactly", async () => {
    const { world, original, protectedUnit, request } = await partialWorld();
    const receipt = await call(world, management.repackAvailable, request);
    expect(receipt).toMatchObject({ ok: true, value: { written: true } });
    expect(await world.t.run((ctx) => ctx.db.get(original[0]!._id))).toEqual(
      protectedUnit,
    );
    const current = await active(world);
    expect(current.map((u) => u.quantity)).toEqual([50, 30, 30]);
    expect(current.reduce((s, u) => s + u.quantity, 0)).toBe(110);
    expect((await pallets(world)).filter((u) => u.retiredAt)).toHaveLength(2);
    expect(
      current
        .slice(1)
        .every(
          (u) => u.stackable === undefined && u.maxStackLevels === undefined,
        ),
    ).toBe(true);
    const batch = await world.t.run((ctx) => ctx.db.get(request.batchId));
    expect(batch).toMatchObject({
      totalQuantity: 110,
      revision: 2,
      splitMode: "MANUAL",
    });
    expect(batch!.packages.map((p) => p.quantity)).toEqual([50, 30, 30]);
    expect(
      await call(world, management.repackAvailable, request),
    ).toMatchObject({ ok: true, value: { written: true, replayed: true } });
    expect(await active(world)).toHaveLength(3);
  });
  it("keeps 4 to 2 repacking at exactly two active units and resets stacking settings", async () => {
    const { world, args } = await setup();
    await call(world, batches.commitBatch, {
      ...args,
      packages: Array.from({ length: 4 }, () => ({ ...row, quantity: 25 })),
    });
    const before = await active(world);
    await world.t.run((ctx) =>
      ctx.db.patch(before[0]!._id, { stackable: true, maxStackLevels: 4 }),
    );
    expect(
      await call(world, management.repackAvailable, {
        warehouseId: args.warehouseId,
        batchId: before[0]!.preparationBatchId,
        expectedRevision: 1,
        requestId: "4-2",
        unitIds: before.map((u) => u._id),
        packages: [
          { ...row, quantity: 50 },
          { ...row, quantity: 50 },
        ],
      }),
    ).toMatchObject({ ok: true, value: { written: true } });
    const after = await active(world);
    expect(after.map((u) => u.quantity)).toEqual([50, 50]);
    expect(
      after.every(
        (u) => u.stackable === undefined && u.maxStackLevels === undefined,
      ),
    ).toBe(true);
  });
  it.each(["STORED", "RESERVED"] as const)(
    "refuses a selected unit that became %s without changing any unit",
    async (status) => {
      const { world, original, request } = await partialWorld();
      await world.t.run((ctx) => ctx.db.patch(original[1]!._id, { status }));
      const before = await pallets(world);
      expect(
        await call(world, management.repackAvailable, request),
      ).toMatchObject({
        ok: true,
        value: { written: false, error: { code: "BATCH_NOT_EDITABLE" } },
      });
      expect(await pallets(world)).toEqual(before);
    },
  );
  it.each([
    { packages: [{ ...row, quantity: 59 }] },
    { packages: [{ ...row, quantity: 60, lengthMm: 0 }] },
    { packages: [{ ...row, quantity: 60, dimensionsChecked: false }] },
    { packages: [] },
    { unitIds: [] },
    { expectedRevision: 0 },
  ])(
    "rejects invalid or stale partial edits atomically: %j",
    async (change) => {
      const { world, request } = await partialWorld();
      const before = await pallets(world);
      expect(
        await call(world, management.repackAvailable, {
          ...request,
          ...change,
        }),
      ).toMatchObject({ ok: true, value: { written: false } });
      expect(await pallets(world)).toEqual(before);
    },
  );
  it("refuses retired, duplicate, protected and foreign-batch unit IDs", async () => {
    const { world, original, request, args } = await partialWorld();
    await call(world, batches.commitBatch, {
      ...args,
      requestId: "foreign-batch",
    });
    const foreign = (await active(world)).find(
      (u) => u.preparationBatchId !== request.batchId,
    )!;
    for (const ids of [
      [foreign._id],
      [original[0]!._id],
      [original[1]!._id, original[1]!._id],
    ])
      expect(
        await call(world, management.repackAvailable, {
          ...request,
          requestId: ids.join(":"),
          unitIds: ids,
        }),
      ).toMatchObject({ ok: true, value: { written: false } });
    await world.t.run((ctx) =>
      ctx.db.patch(original[1]!._id, { retiredAt: Date.now() }),
    );
    expect(
      await call(world, management.repackAvailable, request),
    ).toMatchObject({
      ok: true,
      value: { written: false, error: { code: "STALE_REVISION" } },
    });
  });
  it("only one simultaneous edit at a revision succeeds", async () => {
    const { world, request } = await partialWorld();
    const results = await Promise.all([
      call(world, management.repackAvailable, request),
      call(world, management.repackAvailable, {
        ...request,
        requestId: "competing",
      }),
    ]);
    expect(
      results.filter(
        (r) => (r as { value: { written: boolean } }).value.written,
      ),
    ).toHaveLength(1);
    expect(await active(world)).toHaveLength(3);
  });
  it("preserves history receipts when later repacks change active replacements", async () => {
    const { world, request } = await partialWorld();
    await call(world, management.repackAvailable, request);
    const second = (await active(world)).filter((u) => u.status !== "STORED");
    await call(world, management.repackAvailable, {
      ...request,
      requestId: "later",
      expectedRevision: 2,
      unitIds: second.map((u) => u._id),
      packages: [{ ...row, quantity: 60 }],
    });
    const replay = (await call(world, management.repackAvailable, request)) as {
      value: { documentId: Id<"finishedGoodsBatchRevisions"> };
    };
    const receipt = await world.t.run((ctx) =>
      ctx.db.get(replay.value.documentId),
    );
    expect(receipt).toMatchObject({ revision: 2, totalQuantity: 110 });
    expect(receipt!.palletIds).toHaveLength(3);
    expect((await active(world)).map((u) => u.quantity)).toEqual([50, 60]);
  });
  it("enforces authentication and warehouse scope", async () => {
    const { world, request } = await partialWorld();
    await expect(
      call(world, management.repackAvailable, request, false),
    ).rejects.toThrow("ANONYMOUS");
    await expect(
      call(world, management.get, {
        warehouseId: world.warehouses.bravoA,
        batchId: request.batchId,
      }),
    ).rejects.toThrow("WAREHOUSE_OUT_OF_SCOPE");
  });
  it("queries available versus protected units while excluding retired rows", async () => {
    const { world, original, request } = await partialWorld();
    await world.t.run((ctx) =>
      ctx.db.patch(original[2]!._id, { retiredAt: Date.now() }),
    );
    const result = (await call(world, management.get, request)) as {
      value: { units: Array<{ editable: boolean; lockReason: string | null }> };
    };
    expect(result.value.units.map((u) => u.editable)).toEqual([false, true]);
    expect(result.value.units[0]!.lockReason).toBe("STORED");
  });
});

async function storageFixture(world: ConvexTenantWorld) {
  const warehouseId = world.warehouses.alphaA;
  const location = await world.t.run(async (ctx) => {
    const now = Date.now(),
      orgId = world.orgA;
    const stamps = {
      createdAt: now,
      createdByUserId: world.userA,
      updatedAt: now,
      updatedByUserId: world.userA,
    };
    const buildingId = await ctx.db.insert("storageBuildings", {
      orgId,
      warehouseId,
      code: "BLDG-A",
      name: "Building A",
      widthMm: 10000,
      depthMm: 10000,
      defaultFloorHeightMm: 3000,
      floorCount: 1,
      totalHeightMm: 3000,
      grossAreaSqMm: 100000000,
      reservedAreaSqMm: 0,
      usableAreaSqMm: 100000000,
      status: "ACTIVE",
      version: 1,
      ...stamps,
    });
    const floorId = await ctx.db.insert("storageFloors", {
      orgId,
      warehouseId,
      buildingId,
      floorNumber: 1,
      widthMm: 10000,
      depthMm: 10000,
      heightMm: 3000,
      grossAreaSqMm: 100000000,
      reservedAreaSqMm: 0,
      usableAreaSqMm: 100000000,
      version: 1,
      updatedAt: now,
      updatedByUserId: world.userA,
    });
    const locationId = await ctx.db.insert("locations", {
      orgId,
      warehouseId,
      code: "BLDG-A-F01-Z01",
      locationType: "FLOOR_BLOCK",
      status: "ACTIVE",
    });
    const zoneId = await ctx.db.insert("storageZones", {
      orgId,
      warehouseId,
      buildingId,
      floorId,
      locationId,
      code: "BLDG-A-F01-Z01",
      label: "FG-1",
      qrValue: `ISAS:LOCATION:1:${locationId}`,
      xMm: 1000,
      yMm: 2000,
      widthMm: 2000,
      depthMm: 2000,
      maxStackHeightMm: 3000,
      status: "ACTIVE",
      ...stamps,
    });
    return { buildingId, floorId, zoneId, locationId };
  });
  return location;
}
