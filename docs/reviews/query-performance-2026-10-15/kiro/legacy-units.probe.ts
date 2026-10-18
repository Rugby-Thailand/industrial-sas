import { describe, expect, it } from "vitest";
import * as batches from "../../../../convex/finishedGoods/batches";
import { prepare } from "../../../../convex/finishedGoods/summaryMaintenance";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
} from "@tests/fixtures/convex-tenant-world";
import { measured, settlePage } from "./measure";

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

describe("Q5 — legacy-unit list hydrates batch units before discarding them", () => {
  it("does not issue active-move lookups for units the page filters out", async () => {
    const batchUnits = 100;
    const { world, productId } = await product(batchUnits, 1);
    const { result, requests, stats } = await settlePage<Page>(
      world,
      batches.pageLegacyUnits,
      { warehouseId: world.warehouses.alphaA, productId, pageSize: 20 },
    );
    const moveRanges = stats.ranges.finishedGoodsMoves ?? 0;
    console.info(
      `[Q5] ${batchUnits} batch units + 1 legacy: requests=${requests} rows=${result.page.length} pallet docs=${stats.rangeDocs.finishedGoodsPallets ?? 0} finishedGoodsMoves ranges=${moveRanges}`,
    );
    expect(result.page).toHaveLength(1);
    // RESERVED + IN_TRANSIT presence checks are needed only for the shown
    // legacy unit: 2 ranges, not 2 per scanned batch unit.
    expect(moveRanges).toBeLessThanOrEqual(2);
  });
});
