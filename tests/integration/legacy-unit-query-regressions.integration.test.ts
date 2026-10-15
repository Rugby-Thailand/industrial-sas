import { describe, expect, it } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import * as batches from "../../convex/finishedGoods/batches";
import { prepare } from "../../convex/finishedGoods/summaryMaintenance";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
} from "@tests/fixtures/convex-tenant-world";
import { measured, settlePage } from "../fixtures/query-read-stats";

type Page = {
  status: string;
  page: Array<{ _id: string }>;
  isDone: boolean;
  continueCursor: string;
  scanCursor?: string;
};

/**
 * One product whose `units` were all created by a preparation batch (the
 * normal flow), plus `legacy` pre-batch units. ProductBatches always mounts
 * pageLegacyUnits for the product detail page.
 */
async function product(batchUnits: number, legacy: number) {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
  const productId = await world.t.run(async (ctx) => {
    const productId = await ctx.db.insert("finishedGoodsProducts", {
      orgId: world.orgA,
      warehouseId: world.warehouses.alphaA,
      sku: "SKU-0001",
      name: "Product",
      unit: "PCS",
      storageFormat: "PALLET",
      storageCondition: "ANY",
      status: "ACTIVE",
      createdAt: 1,
      updatedAt: 1,
      createdByUserId: world.userA,
      updatedByUserId: world.userA,
    });
    for (let i = 0; i < legacy; i++)
      await ctx.db.insert("finishedGoodsPallets", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        productId,
        code: `P-${i}`,
        quantity: 1,
        status: "AWAITING_MEASUREMENT",
        // Oldest rows are legacy, so the desc scan reaches them last.
        createdAt: i,
        updatedAt: i,
        createdByUserId: world.userA,
        updatedByUserId: world.userA,
      });
    return productId;
  });
  // Use the actual write path so every batch respects the 50-package limit
  // and its units have a real CREATED parent and batch revision.
  for (let offset = 0; offset < batchUnits; offset += 50) {
    const count = Math.min(50, batchUnits - offset);
    const { value } = await measured<{ written: boolean }>(
      world,
      batches.commitBatch,
      {
        warehouseId: world.warehouses.alphaA,
        productId,
        requestId: `query-audit-batch-${offset}`,
        totalQuantity: count,
        storageFormat: "PALLET",
        simplePacking: true,
        packages: Array.from({ length: count }, () => ({
          quantity: 1,
          dimensionsChecked: false,
        })),
      },
    );
    expect(value.written).toBe(true);
  }
  for (let i = 0; i < 20; i++) {
    const { value } = await measured<{ ready: boolean }>(world, prepare, {
      warehouseId: world.warehouses.alphaA,
    });
    if (value.ready) break;
  }
  return { world, productId };
}

describe("legacy-unit pages filter documents before hydrating relations", () => {
  it("does not issue active-move lookups for units the page filters out", async () => {
    const batchUnits = 100;
    const { world, productId } = await product(batchUnits, 1);
    const { result, stats } = await settlePage<Page>(
      world,
      batches.pageLegacyUnits,
      { warehouseId: world.warehouses.alphaA, productId, pageSize: 20 },
    );
    const moveRanges = stats.ranges.finishedGoodsMoves ?? 0;
    expect(result.page).toHaveLength(1);
    // RESERVED + IN_TRANSIT presence checks are needed only for the shown
    // legacy unit: 2 ranges, not 2 per scanned batch unit.
    expect(moveRanges).toBe(2);
  });

  it("rechecks retained legacy IDs before hydrating them on continuation", async () => {
    const { world, productId } = await product(40, 1);
    const legacyId = await world.t.run(async (ctx) => {
      const unit = (await ctx.db.query("finishedGoodsPallets").collect()).find(
        (row) => row.productId === productId && !row.preparationBatchId,
      )!;
      await ctx.db.patch(unit._id, { updatedAt: Date.now() + 1 });
      return unit._id;
    });
    const args = {
      warehouseId: world.warehouses.alphaA,
      productId,
      pageSize: 20,
    };
    const first = await measured<Page>(world, batches.pageLegacyUnits, args);
    expect(first.value.status).toBe("scanning");
    expect(JSON.parse(first.value.scanCursor!).ids).toEqual([legacyId]);
    expect(first.stats.ranges.finishedGoodsMoves).toBe(2);

    // Exercise the retained-ID guard independently of generation invalidation.
    await world.t.run((ctx) =>
      ctx.db.patch(legacyId, { retiredAt: Date.now() }),
    );
    const resumed = await measured<Page>(world, batches.pageLegacyUnits, {
      ...args,
      scanCursor: first.value.scanCursor,
    });
    expect(resumed.value.page).toEqual([]);
    expect(resumed.stats.ranges.finishedGoodsMoves ?? 0).toBe(0);
  });

  it("pages all live legacy units exactly once while excluding batch and retired units", async () => {
    const { world, productId } = await product(45, 46);
    const expected = await world.t.run(async (ctx) => {
      const legacy = (
        await ctx.db.query("finishedGoodsPallets").collect()
      ).filter((row) => row.productId === productId && !row.preparationBatchId);
      await ctx.db.patch(legacy[0]!._id, { retiredAt: Date.now() });
      return legacy.slice(1).map((row) => row._id);
    });
    const seen: Id<"finishedGoodsPallets">[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const { result } = await settlePage<Page>(
        world,
        batches.pageLegacyUnits,
        {
          warehouseId: world.warehouses.alphaA,
          productId,
          pageSize: 20,
          ...(cursor ? { cursor } : {}),
        },
      );
      expect(result.status).toBe("ready");
      seen.push(
        ...result.page.map((row) => row._id as Id<"finishedGoodsPallets">),
      );
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    expect(seen).toHaveLength(expected.length);
    expect(new Set(seen)).toEqual(new Set(expected));
  });
});
