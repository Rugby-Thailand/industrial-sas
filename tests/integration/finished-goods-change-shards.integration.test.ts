import { describe, expect, it } from "vitest";

import {
  FINISHED_GOODS_CHANGE_SHARDS,
  finishedGoodsGeneration,
  summaryReadiness,
  trackFinishedGoodsWrites,
} from "../../convex/lib/finishedGoodsSummary";
import { createTenantDocumentAccess } from "../../convex/lib/tenantDb";
import { createMutationTenantStorage } from "../../convex/lib/tenantStorage";
import { createConvexTenantWorld } from "../fixtures/convex-tenant-world";

async function world() {
  const world = await createConvexTenantWorld();
  const warehouseId = world.warehouses.alphaA;
  const palletId = await world.t.run(async (ctx) => {
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
    return ctx.db.insert("finishedGoodsPallets", {
      ...audit,
      productId,
      code: "PAL-1",
      quantity: 1,
      status: "AWAITING_MEASUREMENT",
    });
  });
  const access = (ctx: Parameters<Parameters<typeof world.t.run>[0]>[0]) =>
    createTenantDocumentAccess(
      { orgId: world.orgA, requestId: "change-shards" },
      createMutationTenantStorage(ctx, "change-shards"),
    );
  const write = (quantity: number) =>
    world.t.run(async (ctx) => {
      const tracked = trackFinishedGoodsWrites(access(ctx));
      await tracked.db.patch("finishedGoodsPallets", palletId, { quantity });
      await tracked.flush();
    });
  const state = () =>
    world.t.run(async (ctx) => {
      const db = access(ctx);
      const readiness = await summaryReadiness(db, warehouseId);
      return {
        readiness,
        token: await finishedGoodsGeneration(
          db,
          warehouseId,
          readiness?.generation ?? 0,
        ),
        shards: await ctx.db.query("finishedGoodsChangeShards").collect(),
      };
    });
  return { write, state };
}

describe("finished-goods change shards", () => {
  it("counts every committed write without patching the shared readiness row", async () => {
    const { write, state } = await world();
    await write(2);
    const first = await state();
    for (let quantity = 3; quantity < 23; quantity++) await write(quantity);
    const later = await state();
    // Writers no longer read-modify-write the readiness row (no OCC hot spot)…
    expect(later.readiness!._id).toBe(first.readiness!._id);
    expect(later.readiness!.generation).toBe(first.readiness!.generation);
    // …and the token counts each write, so a late commit always moves it.
    expect(later.token - first.token).toBe(20);
    expect(later.shards.length).toBeLessThanOrEqual(
      FINISHED_GOODS_CHANGE_SHARDS,
    );
    expect(later.shards.reduce((sum, row) => sum + row.count, 0)).toBe(21);
  });
});
