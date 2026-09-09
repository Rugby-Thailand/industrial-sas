import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";
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
    totalQuantity: 1000,
    packages: [row, row],
  };
  return { world, args };
}
async function pallets(world: ConvexTenantWorld) {
  return world.t.run((ctx) => ctx.db.query("finishedGoodsPallets").collect());
}
describe("atomic finished goods packing", () => {
  it("creates measured pallets with a stable group and identical replay without duplicate codes or rows", async () => {
    const { world, args } = await setup();
    const first = await call(world, workflow.createPacking, args);
    expect(first).toMatchObject({
      ok: true,
      value: { written: true, replayed: false, palletIds: expect.any(Array) },
    });
    const rows = await pallets(world);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.code)).toEqual(["P-000001", "P-000002"]);
    expect(rows.map((r) => r.quantity)).toEqual([500, 500]);
    expect(
      rows.every(
        (r) =>
          r.status === "AWAITING_PLACEMENT" &&
          r.packingBatchId === rows[0]!._id,
      ),
    ).toBe(true);
    const replay = await call(world, workflow.createPacking, args);
    expect(replay).toMatchObject({
      ok: true,
      value: {
        written: true,
        replayed: true,
        documentId: rows[0]!._id,
        palletIds: rows.map((r) => r._id),
      },
    });
    expect(await pallets(world)).toHaveLength(2);
    expect(
      await call(world, workflow.createPacking, {
        ...args,
        totalQuantity: 999,
      }),
    ).toMatchObject({
      ok: true,
      value: {
        written: false,
        error: { code: "REQUEST_ARGUMENT_CONFLICT" },
      },
    });
    expect(await pallets(world)).toHaveLength(2);
  });
  it("preserves submitted row order when pallet codes grow beyond six digits", async () => {
    const { world, args } = await setup();
    await world.t.run((ctx) =>
      ctx.db.insert("finishedGoodsCounters", {
        orgId: world.orgA,
        warehouseId: args.warehouseId,
        palletSequence: 999998,
        positionSequence: 0,
      }),
    );
    const packages = [
      { ...row, quantity: 600 },
      { ...row, quantity: 400 },
    ];
    const result = await call(world, workflow.createPacking, {
      ...args,
      packages,
    });
    const rows = await pallets(world);
    expect(rows.map((r) => r.code)).toEqual(["P-999999", "P-1000000"]);
    expect(result).toMatchObject({
      ok: true,
      value: { palletIds: rows.map((r) => r._id) },
    });
    expect(
      await call(world, workflow.createPacking, { ...args, packages }),
    ).toMatchObject({
      ok: true,
      value: { replayed: true, palletIds: rows.map((r) => r._id) },
    });
  });
  it("rejects any invalid row or total before writing pallets or consuming sequence numbers", async () => {
    const { world, args } = await setup();
    for (const changed of [
      { packages: [row, { ...row, heightMm: 0 }] },
      { packages: [row, { ...row, dimensionsChecked: false }] },
      { packages: [row, { ...row, weightKg: -1 }] },
      { totalQuantity: 999 },
      { totalQuantity: 1001 },
      { packages: [] },
      { totalQuantity: 25500, packages: Array.from({ length: 51 }, () => row) },
      { totalQuantity: 500.5, packages: [row, { ...row, quantity: 0.5 }] },
    ]) {
      expect(
        await call(world, workflow.createPacking, { ...args, ...changed }),
      ).toMatchObject({ ok: true, value: { written: false } });
      expect(await pallets(world)).toHaveLength(0);
      expect(
        await world.t.run((ctx) =>
          ctx.db.query("finishedGoodsCounters").collect(),
        ),
      ).toHaveLength(0);
    }
    expect(await call(world, workflow.createPacking, args)).toMatchObject({
      ok: true,
      value: { written: true },
    });
    expect((await pallets(world))[0]!.code).toBe("P-000001");
  });
  it("guards authentication, warehouse boundaries, readonly permissions and draft products", async () => {
    const { world, args } = await setup();
    await expect(
      call(world, workflow.createPacking, args, false),
    ).rejects.toThrow("ANONYMOUS");
    await expect(
      call(world, workflow.createPacking, {
        ...args,
        warehouseId: world.warehouses.alphaB,
      }),
    ).rejects.toThrow();
    await world.t.run((ctx) =>
      ctx.db.patch(args.productId, { status: "DRAFT" }),
    );
    expect(await call(world, workflow.createPacking, args)).toMatchObject({
      ok: true,
      value: { written: false, error: { code: "PRODUCT_DRAFT" } },
    });
    expect(await pallets(world)).toHaveLength(0);
    const reader = await setup("SUPERVISOR");
    expect(
      await call(reader.world, workflow.createPacking, reader.args),
    ).toMatchObject({ ok: false });
    expect(await pallets(reader.world)).toHaveLength(0);
  });
  it("allows metadata and default changes without altering packed stock, but locks its units, format and quantity", async () => {
    const { world, args } = await setup();
    await call(world, workflow.createPacking, args);
    const [pallet] = await pallets(world);
    expect(
      await call(world, workflow.saveProduct, {
        ...productFields,
        ...args,
        requestId: "edit",
        name: "New name",
        defaultQuantity: 42,
      }),
    ).toMatchObject({ ok: true, value: { written: true } });
    expect((await pallets(world)).map((r) => r.quantity)).toEqual([500, 500]);
    for (const changed of [{ unit: "kg" }, { storageFormat: "BOX" }])
      expect(
        await call(world, workflow.saveProduct, {
          ...productFields,
          warehouseId: args.warehouseId,
          productId: args.productId,
          requestId: "invalid-edit",
          ...changed,
        }),
      ).toMatchObject({
        ok: true,
        value: { written: false, error: { code: "PRODUCT_PACKING_IN_USE" } },
      });
    const measurement = {
      warehouseId: args.warehouseId,
      palletId: pallet!._id,
      requestId: "measure",
      quantity: 501,
      lengthMm: 1000,
      widthMm: 1000,
      heightMm: 1000,
    };
    expect(
      await call(world, workflow.saveMeasurement, measurement),
    ).toMatchObject({
      ok: true,
      value: { written: false, error: { code: "BATCH_QUANTITY_LOCKED" } },
    });
    expect(
      await call(world, workflow.saveMeasurement, {
        ...measurement,
        quantity: 500,
      }),
    ).toMatchObject({ ok: true, value: { written: true } });
    expect((await pallets(world))[0]!.lengthMm).toBe(1000);
  });
});
