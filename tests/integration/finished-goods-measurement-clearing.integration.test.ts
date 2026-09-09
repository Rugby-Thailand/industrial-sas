import { expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
} from "../fixtures/convex-tenant-world";

async function measuredPallet() {
  const world = await createConvexTenantWorld({
    "../convex/finishedGoods/workflow.ts": () =>
      import("../../convex/finishedGoods/workflow"),
  });
  await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
  const palletId = await world.t.run(async (ctx) => {
    const fields = {
      orgId: world.orgA,
      warehouseId: world.warehouses.alphaA,
      createdAt: 1000,
      createdByUserId: world.userA,
      updatedAt: 1000,
      updatedByUserId: world.userA,
    };
    const productId = await ctx.db.insert("finishedGoodsProducts", {
      ...fields,
      sku: "CLEAR-01",
      name: "Cartons",
      unit: "pieces",
      defaultQuantity: 500,
      storageFormat: "PALLET",
      storageCondition: "ANY",
      status: "ACTIVE",
    });
    return ctx.db.insert("finishedGoodsPallets", {
      ...fields,
      productId,
      code: "P-001",
      quantity: 500,
      lengthMm: 1200,
      widthMm: 1000,
      heightMm: 1400,
      weightKg: 75,
      lot: "OLD-LOT",
      status: "AWAITING_PLACEMENT",
    });
  });
  return {
    world,
    palletId,
    authenticated: world.t.withIdentity({
      subject: "user_fixture_a",
      org_id: "org_fixture_a",
    }),
  };
}

it("clears a previously measured height when Save and exit omits the emptied field", async () => {
  const { world, palletId, authenticated } = await measuredPallet();
  const result = await authenticated.mutation(
    api.finishedGoods.workflow.saveMeasurement,
    {
      warehouseId: world.warehouses.alphaA,
      palletId,
      requestId: "clear-height",
      quantity: 500,
      lengthMm: 1200,
      widthMm: 1000,
      lot: "NEW-LOT",
    },
  );
  expect(result).toMatchObject({ ok: true, value: { written: true } });
  const saved = await world.t.run((ctx) => ctx.db.get(palletId));
  expect(saved).toMatchObject({
    status: "AWAITING_MEASUREMENT",
    lengthMm: 1200,
    widthMm: 1000,
    lot: "NEW-LOT",
  });
  expect(saved).not.toHaveProperty("heightMm");
  expect(saved).not.toHaveProperty("weightKg");
});

it("clears all dimensions without retaining measured status, and can later be completed", async () => {
  const { world, palletId, authenticated } = await measuredPallet();
  await authenticated.mutation(api.finishedGoods.workflow.saveMeasurement, {
    warehouseId: world.warehouses.alphaA,
    palletId,
    requestId: "clear-all",
    quantity: 250,
  });
  const incomplete = await world.t.run((ctx) => ctx.db.get(palletId));
  expect(incomplete).toMatchObject({
    quantity: 250,
    status: "AWAITING_MEASUREMENT",
  });
  for (const key of ["lengthMm", "widthMm", "heightMm", "weightKg", "lot"])
    expect(incomplete).not.toHaveProperty(key);
  const complete = await authenticated.mutation(
    api.finishedGoods.workflow.saveMeasurement,
    {
      warehouseId: world.warehouses.alphaA,
      palletId,
      requestId: "remeasure",
      quantity: 250,
      lengthMm: 1000,
      widthMm: 800,
      heightMm: 1500,
    },
  );
  expect(complete).toMatchObject({ ok: true, value: { written: true } });
  expect(await world.t.run((ctx) => ctx.db.get(palletId))).toMatchObject({
    lengthMm: 1000,
    widthMm: 800,
    heightMm: 1500,
    status: "AWAITING_PLACEMENT",
  });
});
