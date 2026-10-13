import { expect, it, vi } from "vitest";
import type { GenericMutationCtx } from "convex/server";
import type { DataModel } from "../../convex/schema";
import type { Id } from "../../convex/_generated/dataModel";
import * as workflow from "../../convex/finishedGoods/workflow";
import { fingerprintArguments, sha256Hex } from "../../convex/lib/idempotency";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";

type Runtime = {
  _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
};
async function call(world: ConvexTenantWorld, fn: unknown, args: unknown) {
  const result = await world.t
    .withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_a" })
    .run((ctx) =>
      (fn as Runtime)._handler(ctx as GenericMutationCtx<DataModel>, args),
    );
  expect(result).toHaveProperty("ok", true);
  return (result as { value: Record<string, unknown> }).value;
}
async function setup(unit = "PCS") {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
  const warehouseId = world.warehouses.alphaA;
  const productArgs = {
    warehouseId,
    requestId: "product",
    sku: "INV-1",
    name: "Original",
    unit,
    storageCondition: "ANY",
    draft: false,
  };
  const productId = (await call(world, workflow.saveProduct, productArgs))
    .documentId as Id<"finishedGoodsProducts">;
  const product = (await world.t.run((ctx) => ctx.db.get(productId)))!;
  const palletId = (
    await call(world, workflow.createPallet, {
      warehouseId,
      productId,
      requestId: "pallet",
    })
  ).documentId as Id<"finishedGoodsPallets">;
  const pallet = (await world.t.run((ctx) => ctx.db.get(palletId)))!;
  return {
    world,
    warehouseId,
    productId,
    productArgs,
    product,
    palletId,
    pallet,
  };
}

it("INV-03 monotonic product versions reject stale editors when the clock does not advance", async () => {
  const { world, productId, productArgs, product } = await setup();
  const clock = vi.spyOn(Date, "now").mockReturnValue(product.updatedAt);
  try {
    const args = {
      ...productArgs,
      productId,
      expectedUpdatedAt: product.updatedAt,
      requestId: "editor-A",
      name: "Editor A",
    };
    expect(await call(world, workflow.saveProduct, args)).toHaveProperty(
      "written",
      true,
    );
    expect(
      await call(world, workflow.saveProduct, {
        ...args,
        requestId: "editor-B",
        name: "Editor B",
      }),
    ).toMatchObject({ written: false, error: { code: "VERSION_CONFLICT" } });
    expect(await call(world, workflow.saveProduct, args)).toMatchObject({
      written: true,
      replayed: true,
    });
    expect(await world.t.run((ctx) => ctx.db.get(productId))).toMatchObject({
      name: "Editor A",
      updatedAt: product.updatedAt + 1,
    });
  } finally {
    clock.mockRestore();
  }
});

it("INV-04 stale measurements retain newer dimensions and exact retries recover before version checks", async () => {
  const { world, warehouseId, palletId, pallet } = await setup();
  const clock = vi.spyOn(Date, "now").mockReturnValue(pallet.updatedAt);
  try {
    const first = {
      warehouseId,
      palletId,
      expectedMeasurementUpdatedAt: pallet.updatedAt,
      requestId: "editor-A",
      quantity: 1,
      widthMm: 2000,
      lengthMm: 1000,
      heightMm: 1000,
    };
    expect(await call(world, workflow.saveMeasurement, first)).toHaveProperty(
      "written",
      true,
    );
    expect(
      await call(world, workflow.saveMeasurement, {
        ...first,
        requestId: "editor-B",
        widthMm: 1000,
        lot: "Stale B",
      }),
    ).toMatchObject({ written: false, error: { code: "VERSION_CONFLICT" } });
    expect(
      await call(world, workflow.saveMeasurement, {
        ...first,
        expectedMeasurementUpdatedAt: pallet.updatedAt + 1,
        requestId: "editor-C",
        widthMm: 3000,
      }),
    ).toHaveProperty("written", true);
    expect(await call(world, workflow.saveMeasurement, first)).toMatchObject({
      written: true,
      replayed: true,
    });
    expect(
      await call(world, workflow.saveMeasurement, { ...first, widthMm: 4000 }),
    ).toMatchObject({
      written: false,
      error: { code: "REQUEST_ARGUMENT_CONFLICT" },
    });
    expect(await world.t.run((ctx) => ctx.db.get(palletId))).toMatchObject({
      widthMm: 3000,
      updatedAt: pallet.updatedAt + 2,
    });
  } finally {
    clock.mockRestore();
  }
});

it("refuses fresh blind measurement saves while recovering old success receipts", async () => {
  const { world, warehouseId, palletId, pallet } = await setup();
  const args = {
    warehouseId,
    palletId,
    requestId: "old-measurement",
    quantity: 1,
    widthMm: 1000,
  };
  expect(await call(world, workflow.saveMeasurement, args)).toMatchObject({
    written: false,
    error: { code: "VERSION_CONFLICT" },
  });
  const hash = await fingerprintArguments(args);
  if (!hash.ok) throw new Error("Invalid fixture arguments");
  const resultHash = await sha256Hex(`finishedGoodsPallets:${palletId}`);
  await world.t.run((ctx) =>
    ctx.db.insert("idempotencyRecords", {
      orgId: world.orgA,
      operation: "finishedGoods.measurement.save",
      requestId: args.requestId,
      status: "SUCCEEDED",
      requestHash: hash.value,
      resultRef: palletId,
      resultHash,
      actorUserId: world.userA,
      firstSeenAt: 1,
      completedAt: 1,
      expiresAt: Date.now() + 100000,
    }),
  );
  expect(await call(world, workflow.saveMeasurement, args)).toMatchObject({
    written: true,
    replayed: true,
  });
  expect(await world.t.run((ctx) => ctx.db.get(palletId))).toEqual(pallet);
});

it.each(["PCS", "pieces", "ชิ้น"])(
  "INV-05 rejects fractional %s defaults, old defaults and measurements",
  async (unit) => {
    const {
      world,
      warehouseId,
      productId,
      productArgs,
      product,
      palletId,
      pallet,
    } = await setup(unit);
    expect(
      await call(world, workflow.saveProduct, {
        ...productArgs,
        requestId: "fractional-default",
        sku: "OTHER",
        defaultQuantity: 1.5,
      }),
    ).toMatchObject({
      written: false,
      error: { code: "FIELD_INVALID", field: "defaultQuantity" },
    });
    await world.t.run((ctx) =>
      ctx.db.patch(productId, { defaultQuantity: 1.5 }),
    );
    expect(
      await call(world, workflow.saveProduct, {
        ...productArgs,
        productId,
        expectedUpdatedAt: product.updatedAt,
        requestId: "inherited-old-default",
      }),
    ).toMatchObject({
      written: false,
      error: { code: "FIELD_INVALID", field: "defaultQuantity" },
    });
    expect(
      await call(world, workflow.createPallet, {
        warehouseId,
        productId,
        requestId: "old-default",
      }),
    ).toMatchObject({
      written: false,
      error: { code: "FIELD_INVALID", field: "defaultQuantity" },
    });
    expect(
      await call(world, workflow.saveMeasurement, {
        warehouseId,
        palletId,
        requestId: "fractional-measurement",
        expectedMeasurementUpdatedAt: pallet.updatedAt,
        quantity: 1.5,
      }),
    ).toMatchObject({
      written: false,
      error: { code: "FIELD_INVALID", field: "quantity" },
    });
    expect(await world.t.run((ctx) => ctx.db.get(palletId))).toHaveProperty(
      "quantity",
      1,
    );
  },
);

it("accepts an explicit zero measurement baseline while refusing a missing baseline", async () => {
  const { world, warehouseId, palletId } = await setup();
  await world.t.run((ctx) => ctx.db.patch(palletId, { updatedAt: 0 }));
  const args = { warehouseId, palletId, quantity: 1, requestId: "blind-zero" };
  expect(await call(world, workflow.saveMeasurement, args)).toMatchObject({
    written: false,
    error: { code: "VERSION_CONFLICT" },
  });
  expect(
    await call(world, workflow.saveMeasurement, {
      ...args,
      requestId: "loaded-zero",
      expectedMeasurementUpdatedAt: 0,
    }),
  ).toHaveProperty("written", true);
});

it("accepts three-decimal continuous quantities and refuses finer legacy precision", async () => {
  const {
    world,
    warehouseId,
    productId,
    productArgs,
    product,
    palletId,
    pallet,
  } = await setup("kg");
  expect(
    await call(world, workflow.saveProduct, {
      ...productArgs,
      productId,
      requestId: "valid-default",
      expectedUpdatedAt: product.updatedAt,
      defaultQuantity: 1.125,
    }),
  ).toHaveProperty("written", true);
  expect(
    await call(world, workflow.saveMeasurement, {
      warehouseId,
      palletId,
      requestId: "valid-measurement",
      expectedMeasurementUpdatedAt: pallet.updatedAt,
      quantity: 1.123,
    }),
  ).toHaveProperty("written", true);
  const current = (await world.t.run((ctx) => ctx.db.get(palletId)))!;
  expect(
    await call(world, workflow.saveMeasurement, {
      warehouseId,
      palletId,
      requestId: "too-precise",
      expectedMeasurementUpdatedAt: current.updatedAt,
      quantity: 1.1234,
    }),
  ).toMatchObject({
    written: false,
    error: { code: "FIELD_INVALID", field: "quantity" },
  });
  expect(
    await call(world, workflow.saveProduct, {
      ...productArgs,
      sku: "KG-2",
      requestId: "too-precise-default",
      defaultQuantity: 1.1234,
    }),
  ).toMatchObject({
    written: false,
    error: { code: "FIELD_INVALID", field: "defaultQuantity" },
  });
});
