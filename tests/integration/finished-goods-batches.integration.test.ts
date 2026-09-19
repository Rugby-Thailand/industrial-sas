import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";
import * as batches from "../../convex/finishedGoods/batches";
import * as workflow from "../../convex/finishedGoods/workflow";
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
async function batchRows(world: ConvexTenantWorld) {
  return world.t.run((ctx) => ctx.db.query("finishedGoodsBatches").collect());
}
async function active(world: ConvexTenantWorld) {
  return (await pallets(world)).filter((p) => !p.retiredAt);
}
describe("preparation batches", () => {
  it("creates exactly two measured units for 100/50 and three for 110/50 without conflating batches", async () => {
    const { world, args } = await setup();
    expect(await call(world, batches.commitBatch, args)).toMatchObject({
      ok: true,
      value: { written: true, revision: 1, palletIds: expect.any(Array) },
    });
    expect((await active(world)).map((p) => p.quantity)).toEqual([50, 50]);
    await call(world, batches.commitBatch, {
      ...args,
      requestId: "second",
      totalQuantity: 110,
      packages: [
        { ...row, quantity: 50 },
        { ...row, quantity: 50 },
        { ...row, quantity: 10 },
      ],
    });
    expect((await active(world)).map((p) => p.quantity)).toEqual([
      50, 50, 50, 50, 10,
    ]);
    expect(await batchRows(world)).toHaveLength(2);
    expect(
      await call(world, batches.listProductBatches, {
        warehouseId: args.warehouseId,
        productId: args.productId,
      }),
    ).toMatchObject({
      ok: true,
      value: {
        batches: expect.arrayContaining([
          expect.objectContaining({
            units: expect.arrayContaining([
              expect.objectContaining({ editable: true }),
            ]),
          }),
        ]),
        legacyUnits: [],
      },
    });
  });
  it("saves incomplete drafts without creating units and resumes with optimistic revision", async () => {
    const { world, args } = await setup();
    const draft = {
      ...args,
      totalQuantity: undefined,
      packages: [{ dimensionsChecked: false }],
    };
    expect(await call(world, batches.saveBatchDraft, draft)).toMatchObject({
      ok: true,
      value: { written: true, revision: 1, palletIds: [] },
    });
    expect(await pallets(world)).toHaveLength(0);
    const [batch] = await batchRows(world);
    expect(
      await call(world, batches.getBatch, {
        warehouseId: args.warehouseId,
        batchId: batch!._id,
      }),
    ).toMatchObject({
      ok: true,
      value: {
        batch: { status: "DRAFT", packages: [{ dimensionsChecked: false }] },
        editable: true,
        units: [],
      },
    });
    expect(
      await call(world, batches.commitBatch, {
        ...args,
        requestId: "commit",
        batchId: batch!._id,
        expectedRevision: 1,
      }),
    ).toMatchObject({ ok: true, value: { written: true, revision: 2 } });
    expect(await active(world)).toHaveLength(2);
    expect(
      await call(world, batches.saveBatchDraft, {
        ...args,
        requestId: "late",
        batchId: batch!._id,
        expectedRevision: 1,
      }),
    ).toMatchObject({
      ok: true,
      value: { written: false, error: { code: "STALE_REVISION" } },
    });
  });
  it("replaces 4 with 2 in the same batch, preserves total/history and original retry receipt after later revision", async () => {
    const { world, args } = await setup();
    const first = {
      ...args,
      packages: Array.from({ length: 4 }, () => ({ ...row, quantity: 25 })),
    };
    await call(world, batches.commitBatch, first);
    const original = await active(world);
    await call(world, workflow.saveStackingLimits, {
      warehouseId: args.warehouseId,
      palletId: original[0]!._id,
      requestId: "configure-before-repack",
      stackable: true,
      maxStackLevels: 3,
    });
    const [batch] = await batchRows(world);
    await call(world, batches.commitBatch, {
      ...args,
      requestId: "differentbatch",
    });
    const revisionArgs = {
      ...args,
      requestId: "repack",
      batchId: batch!._id,
      expectedRevision: 1,
    };
    expect(await call(world, batches.commitBatch, revisionArgs)).toMatchObject({
      ok: true,
      value: { written: true, revision: 2 },
    });
    const current = (await active(world)).filter(
      (p) => p.preparationBatchId === batch!._id,
    );
    expect(current.map((p) => p.quantity)).toEqual([50, 50]);
    expect(
      current.every(
        (p) => p.stackable === undefined && p.maxStackLevels === undefined,
      ),
    ).toBe(true);
    expect(current.reduce((sum, p) => sum + p.quantity, 0)).toBe(100);
    expect(await active(world)).toHaveLength(4);
    expect((await pallets(world)).filter((p) => p.retiredAt)).toHaveLength(4);
    expect(await call(world, batches.commitBatch, first)).toMatchObject({
      ok: true,
      value: {
        written: true,
        replayed: true,
        revision: 1,
        palletIds: original.map((p) => p._id),
      },
    });
    expect(await call(world, batches.commitBatch, revisionArgs)).toMatchObject({
      ok: true,
      value: {
        written: true,
        replayed: true,
        revision: 2,
        palletIds: current.map((p) => p._id),
      },
    });
    expect(
      await call(world, workflow.getPallet, {
        warehouseId: args.warehouseId,
        palletId: original[0]!._id,
      }),
    ).toMatchObject({ ok: true, value: null });
    expect(
      await call(world, batches.commitBatch, {
        ...revisionArgs,
        requestId: "totalchange",
        expectedRevision: 2,
        totalQuantity: 90,
        packages: [{ ...row, quantity: 90 }],
      }),
    ).toMatchObject({
      ok: true,
      value: { written: false, error: { code: "BATCH_TOTAL_LOCKED" } },
    });
    expect(
      await call(world, batches.commitBatch, {
        ...revisionArgs,
        requestId: "stale",
      }),
    ).toMatchObject({
      ok: true,
      value: { written: false, error: { code: "STALE_REVISION" } },
    });
  });
  it("rejects invalid, missing, unconfirmed dimensions and over/under allocation atomically", async () => {
    const { world, args } = await setup();
    for (const changed of [
      { totalQuantity: 0 },
      { totalQuantity: -1 },
      { totalQuantity: undefined },
      { totalQuantity: 0.5, packages: [{ ...row, quantity: 0.5 }] },
      { packages: [] },
      { packages: [{ ...row, quantity: 0 }] },
      { packages: [{ ...row, quantity: 100, lengthMm: undefined }] },
      { packages: [{ ...row, quantity: 100, dimensionsChecked: false }] },
      { packages: [{ ...row, quantity: 100, weightKg: -1 }] },
      { totalQuantity: 99 },
      { totalQuantity: 101 },
    ]) {
      expect(
        await call(world, batches.commitBatch, { ...args, ...changed }),
      ).toMatchObject({ ok: true, value: { written: false } });
      expect(await pallets(world)).toHaveLength(0);
      expect(await batchRows(world)).toHaveLength(0);
    }
    expect(await call(world, batches.commitBatch, args)).toMatchObject({
      ok: true,
      value: { written: true },
    });
  });
  it.each(["RESERVED", "STORED"] as const)(
    "refuses repack of %s unit and preserves existing units",
    async (status) => {
      const { world, args } = await setup();
      await call(world, batches.commitBatch, args);
      const [batch] = await batchRows(world);
      const [unit] = await active(world);
      await world.t.run((ctx) => ctx.db.patch(unit!._id, { status }));
      expect(
        await call(world, batches.commitBatch, {
          ...args,
          requestId: "repack",
          batchId: batch!._id,
          expectedRevision: 1,
        }),
      ).toMatchObject({
        ok: true,
        value: { written: false, error: { code: "BATCH_NOT_EDITABLE" } },
      });
      expect(await active(world)).toHaveLength(2);
      expect((await batchRows(world))[0]!.revision).toBe(1);
    },
  );
  it("requires auth, permission, tenant/warehouse identity, and active product", async () => {
    const { world, args } = await setup();
    await expect(call(world, batches.commitBatch, args, false)).rejects.toThrow(
      "ANONYMOUS",
    );
    await expect(
      call(world, batches.commitBatch, {
        ...args,
        warehouseId: world.warehouses.alphaB,
      }),
    ).rejects.toThrow();
    const reader = await setup("SUPERVISOR");
    expect(
      await call(reader.world, batches.commitBatch, reader.args),
    ).toMatchObject({ ok: false });
    await world.t.run((ctx) =>
      ctx.db.patch(args.productId, { status: "DRAFT" }),
    );
    expect(await call(world, batches.commitBatch, args)).toMatchObject({
      ok: true,
      value: { written: false, error: { code: "PRODUCT_DRAFT" } },
    });
  });
  it("keeps legacy units separate and cancels only explicit unplaced reviewed rows, retaining history", async () => {
    const { world, args } = await setup();
    await call(world, workflow.createPallet, args);
    const [legacy] = await active(world);
    expect(
      await call(world, batches.cancelLegacyUnit, {
        warehouseId: args.warehouseId,
        palletId: legacy!._id,
        expectedUpdatedAt: legacy!.updatedAt,
        reason: "",
        requestId: "cancel",
      }),
    ).toMatchObject({
      ok: true,
      value: { written: false, error: { code: "REASON_REQUIRED" } },
    });
    expect(
      await call(world, batches.cancelLegacyUnit, {
        warehouseId: args.warehouseId,
        palletId: legacy!._id,
        expectedUpdatedAt: 0,
        reason: "Duplicate reviewed",
        requestId: "cancel",
      }),
    ).toMatchObject({
      ok: true,
      value: { written: false, error: { code: "STALE_REVISION" } },
    });
    const cancellation = {
      warehouseId: args.warehouseId,
      palletId: legacy!._id,
      expectedUpdatedAt: legacy!.updatedAt,
      reason: "Duplicate reviewed",
      requestId: "cancel",
    };
    expect(
      await call(world, batches.cancelLegacyUnit, cancellation),
    ).toMatchObject({ ok: true, value: { written: true } });
    expect(await active(world)).toHaveLength(0);
    expect((await pallets(world))[0]).toMatchObject({
      retirementReason: "Duplicate reviewed",
      retiredAt: expect.any(Number),
    });
    expect(
      await call(world, batches.cancelLegacyUnit, cancellation),
    ).toMatchObject({ ok: true, value: { written: true, replayed: true } });
    expect(
      await call(world, workflow.saveMeasurement, {
        warehouseId: args.warehouseId,
        palletId: legacy!._id,
        quantity: 100,
        requestId: "editretired",
      }),
    ).toMatchObject({
      ok: true,
      value: { written: false, error: { code: "NOT_FOUND" } },
    });
  });
  it("saves only FG fields without requiring packaging defaults", async () => {
    const { world, args } = await setup();
    expect(
      await call(world, workflow.saveProduct, {
        warehouseId: args.warehouseId,
        requestId: "newfg",
        sku: "NO-PACKING",
        name: "Only product",
        unit: "PCS",
        storageCondition: "ANY",
        draft: false,
      }),
    ).toMatchObject({ ok: true, value: { written: true } });
    expect(await pallets(world)).toHaveLength(0);
  });
});

async function seedLocation(world: ConvexTenantWorld) {
  const warehouseId = world.warehouses.alphaA;
  return await world.t.run(async (ctx) => {
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
}

describe("preparation integrity", () => {
  it("blocks orphan physical holds and moving units independently of cached unit status", async () => {
    const { world, args } = await setup();
    await call(world, batches.commitBatch, args);
    const [batch] = await batchRows(world);
    const [unit] = await active(world);
    const location = await seedLocation(world);
    const placementId = await world.t.run((ctx) =>
      ctx.db.insert("finishedGoodsPlacements", {
        orgId: world.orgA,
        warehouseId: args.warehouseId,
        palletId: unit!._id,
        ...location,
        positionCode: "POS-HOLD",
        qrValue: "hold",
        xMm: 0,
        yMm: 0,
        zMm: 0,
        widthMm: 1000,
        depthMm: 1200,
        heightMm: 1400,
        rotation: 0,
        status: "RESERVED",
        createdAt: 1,
        updatedAt: 1,
        createdByUserId: world.userA,
        updatedByUserId: world.userA,
      }),
    );
    const change = {
      ...args,
      requestId: "held",
      batchId: batch!._id,
      expectedRevision: 1,
    };
    expect(
      await call(world, batches.listProductBatches, {
        warehouseId: args.warehouseId,
        productId: args.productId,
      }),
    ).toMatchObject({
      ok: true,
      value: {
        batches: [
          expect.objectContaining({
            units: expect.arrayContaining([
              expect.objectContaining({ _id: unit!._id, editable: false }),
              expect.objectContaining({ editable: true }),
            ]),
          }),
        ],
      },
    });
    expect(await call(world, batches.commitBatch, change)).toMatchObject({
      ok: true,
      value: { written: false, error: { code: "BATCH_NOT_EDITABLE" } },
    });
    await world.t.run(async (ctx) => {
      await ctx.db.patch(placementId, { status: "RELEASED" });
      await ctx.db.insert("finishedGoodsMoves", {
        orgId: world.orgA,
        warehouseId: args.warehouseId,
        palletId: unit!._id,
        sourcePlacementId: placementId,
        targetPlacementId: placementId,
        sourceUpdatedAt: 1,
        targetUpdatedAt: 1,
        palletUpdatedAt: unit!.updatedAt,
        ownerUserId: world.userA,
        status: "IN_TRANSIT",
        createdAt: 1,
        updatedAt: 1,
        createdByUserId: world.userA,
        updatedByUserId: world.userA,
      });
    });
    expect(
      await call(world, batches.commitBatch, {
        ...change,
        requestId: "moving",
      }),
    ).toMatchObject({
      ok: true,
      value: { written: false, error: { code: "BATCH_NOT_EDITABLE" } },
    });
    expect(
      await call(world, batches.getBatch, {
        warehouseId: args.warehouseId,
        batchId: batch!._id,
      }),
    ).toMatchObject({
      ok: true,
      value: {
        editable: false,
        units: expect.arrayContaining([
          expect.objectContaining({
            moveStatus: "IN_TRANSIT",
            editable: false,
          }),
          expect.objectContaining({ editable: true }),
        ]),
      },
    });
    expect(await active(world)).toHaveLength(2);
  });
  it("requires batch editing for actual dimensions and rejects old retired operations", async () => {
    const { world, args } = await setup();
    await call(world, batches.commitBatch, args);
    const [batch] = await batchRows(world);
    const [unit] = await active(world);
    expect(
      await call(world, workflow.saveMeasurement, {
        warehouseId: args.warehouseId,
        palletId: unit!._id,
        requestId: "measure",
        quantity: 50,
        lengthMm: 500,
        widthMm: 500,
        heightMm: 500,
      }),
    ).toMatchObject({
      ok: true,
      value: { written: false, error: { code: "BATCH_MEASUREMENT_LOCKED" } },
    });
    await call(world, batches.commitBatch, {
      ...args,
      requestId: "replace",
      batchId: batch!._id,
      expectedRevision: 1,
    });
    expect(
      await call(world, workflow.recommend, {
        warehouseId: args.warehouseId,
        palletId: unit!._id,
      }),
    ).toMatchObject({ ok: true, value: { candidates: [] } });
    expect(
      await call(world, workflow.confirmStored, {
        warehouseId: args.warehouseId,
        palletId: unit!._id,
        requestId: "retired-confirm",
      }),
    ).toMatchObject({
      ok: true,
      value: { written: false, error: { code: "NOT_FOUND" } },
    });
  });
});

it("commits unmeasured mixed-size packages with fullness while preserving stock totals", async () => {
  const { world, args } = await setup();
  const simple = {
    ...args,
    simplePacking: true,
    sameSize: false,
    packages: [
      { quantity: 50, dimensionsChecked: false, fillPercent: 100 },
      { quantity: 50, dimensionsChecked: false, fillPercent: 25 },
    ],
  };
  expect(await call(world, batches.commitBatch, simple)).toMatchObject({
    ok: true,
    value: { written: true },
  });
  const units = await active(world);
  expect(units.map((p) => p.quantity)).toEqual([50, 50]);
  expect(units.map((p) => p.fillPercent)).toEqual([100, 25]);
  expect(
    units.every(
      (p) =>
        p.sameSize === false &&
        p.lengthMm === undefined &&
        p.status === "AWAITING_PLACEMENT",
    ),
  ).toBe(true);
  const [batch] = await batchRows(world);
  expect(batch).toMatchObject({ simplePacking: true, sameSize: false });
});
it("rejects incomplete measured packing and invalid simple fullness or quantity without creating stock", async () => {
  const { world, args } = await setup();
  const packages = [
    { quantity: 50, dimensionsChecked: false, fillPercent: 100 },
    { quantity: 50, dimensionsChecked: false, fillPercent: 25 },
  ];
  for (const variant of [
    { ...args, packages },
    {
      ...args,
      simplePacking: true,
      packages: [{ ...packages[0], fillPercent: 101 }, packages[1]],
    },
    {
      ...args,
      simplePacking: true,
      packages: [{ ...packages[0], quantity: 45 }, packages[1]],
    },
  ]) {
    expect(await call(world, batches.commitBatch, variant)).toMatchObject({
      ok: true,
      value: { written: false },
    });
  }
  expect(await active(world)).toHaveLength(0);
});
