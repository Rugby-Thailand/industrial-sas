import type { GenericMutationCtx } from "convex/server";
import { v } from "convex/values";
import { describe, expect, it } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";
import { inventoryWriter } from "../../convex/lib/inventoryWriter";
import {
  mutationWithOrg,
  type TenantWriteOwner,
} from "../../convex/lib/tenantFunctions";
import type { DataModel } from "../../convex/schema";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
} from "../fixtures/convex-tenant-world";

/**
 * `mutationWithOrg` lets a handler write a projected source table only when
 * the mutation declares the writer that owns the derived rows. Production
 * coverage of the writer's projections lives in the finished-goods and
 * storage suites; these probes pin the gate and the transaction boundary.
 */
const identity = { subject: "user_fixture_a", org_id: "org_fixture_a" };
const args = {
  warehouseId: v.id("warehouses"),
  productId: v.id("finishedGoodsProducts"),
};

const rename = (writer?: TenantWriteOwner) =>
  mutationWithOrg({
    args,
    permissionCode: "masterData.storageLayout.manage",
    target: { table: "finishedGoodsProducts" },
    warehouseId: (a) => a.warehouseId,
    ...(writer === undefined ? {} : { writer }),
    handler: async (ctx, a) => {
      await ctx.tenantDb.patch("finishedGoodsProducts", a.productId, {
        name: "Renamed",
      });
      return null;
    },
  });
const stampWarehouse = mutationWithOrg({
  args,
  permissionCode: "masterData.storageLayout.manage",
  target: { table: "warehouses" },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, a) => {
    await ctx.tenantDb.patch("warehouses", a.warehouseId, { updatedAt: 5 });
    return null;
  },
});

interface RuntimeFunction {
  readonly _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
}

async function world() {
  const w = await createConvexTenantWorld();
  await seedConvexAuthorization(w, { roleA: "ORG_ADMIN" });
  const warehouseId = w.warehouses.alphaA as Id<"warehouses">;
  const productId = await w.t.run((ctx) =>
    ctx.db.insert("finishedGoodsProducts", {
      orgId: w.orgA,
      warehouseId,
      sku: "SKU",
      name: "Boxes",
      unit: "pieces",
      storageFormat: "PALLET",
      storageCondition: "DRY",
      status: "ACTIVE",
      createdAt: 1,
      updatedAt: 1,
      createdByUserId: w.userA,
      updatedByUserId: w.userA,
    }),
  );
  const call = (fn: unknown) =>
    w.t.withIdentity(identity).run((ctx) =>
      (fn as RuntimeFunction)._handler(ctx as GenericMutationCtx<DataModel>, {
        warehouseId,
        productId,
      }),
    );
  const state = () =>
    w.t.run(async (ctx) => ({
      product: await ctx.db.get(productId),
      warehouse: await ctx.db.get(warehouseId),
      shards: await ctx.db.query("finishedGoodsChangeShards").collect(),
      readiness: await ctx.db.query("finishedGoodsSummaryReadiness").collect(),
      audit: await ctx.db.query("auditEvents").collect(),
    }));
  return { call, state };
}

describe("projected source writes", () => {
  it("refuse a mutation without the owning writer and commit nothing", async () => {
    const { call, state } = await world();
    await expect(call(rename())).rejects.toThrow();
    const after = await state();
    expect(after.product?.name).toBe("Boxes");
    expect(after.shards).toEqual([]);
    expect(after.audit).toEqual([]);
  });

  it("update the source and its projections in one transaction with the inventory writer", async () => {
    const { call, state } = await world();
    expect(await call(rename(inventoryWriter))).toMatchObject({
      ok: true,
      value: null,
    });
    const after = await state();
    expect(after.product?.name).toBe("Renamed");
    // The writer's flush recorded the change for catalogue continuations.
    expect(after.shards.reduce((sum, row) => sum + row.count, 0)).toBe(1);
    expect(after.readiness).toHaveLength(1);
  });

  it("leave writes to other tenant tables free of any projection work", async () => {
    const { call, state } = await world();
    expect(await call(stampWarehouse)).toMatchObject({ ok: true });
    const after = await state();
    expect(after.warehouse?.updatedAt).toBe(5);
    expect(after.shards).toEqual([]);
    expect(after.readiness).toEqual([]);
  });
});
