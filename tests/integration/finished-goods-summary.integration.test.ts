import { describe, expect, it } from "vitest";
import { createConvexTenantWorld } from "../fixtures/convex-tenant-world";
import { createTenantDocumentAccess } from "../../convex/lib/tenantDb";
import { createMutationTenantStorage } from "../../convex/lib/tenantStorage";
import {
  backfillProductSummaries,
  readProductSummary,
  trackFinishedGoodsWrites,
} from "../../convex/lib/finishedGoodsSummary";

describe("finished goods summary ledger", () => {
  it("backfills across pages and reconciles live changes without double counting", async () => {
    const world = await createConvexTenantWorld();
    const productId = await world.t.run((ctx) =>
      ctx.db.insert("finishedGoodsProducts", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        sku: "SUM",
        name: "Summary",
        unit: "PCS",
        storageFormat: "PALLET",
        storageCondition: "ANY",
        status: "ACTIVE",
        createdAt: 1,
        updatedAt: 1,
        createdByUserId: world.userA,
        updatedByUserId: world.userA,
      }),
    );
    const ids = await world.t.run(async (ctx) => {
      const ids = [];
      for (let i = 0; i < 101; i++)
        ids.push(
          await ctx.db.insert("finishedGoodsPallets", {
            orgId: world.orgA,
            warehouseId: world.warehouses.alphaA,
            productId,
            code: String(i).padStart(3, "0"),
            quantity: 1.001,
            status: "AWAITING_MEASUREMENT",
            createdAt: 1,
            updatedAt: 1,
            createdByUserId: world.userA,
            updatedByUserId: world.userA,
          }),
        );
      return ids;
    });
    async function run<T>(
      fn: (db: ReturnType<typeof createTenantDocumentAccess>) => Promise<T>,
    ) {
      return world.t.run((ctx) =>
        fn(
          createTenantDocumentAccess(
            { orgId: world.orgA, requestId: "summary-test" },
            createMutationTenantStorage(ctx, "summary-test"),
          ),
        ),
      );
    }
    const read = () =>
      run(async (db) =>
        readProductSummary(
          { tenantDb: db },
          (await db.get("finishedGoodsProducts", productId)) as never,
        ),
      );
    expect(await read()).toBeNull();
    const initialBatch = await run((db) =>
      backfillProductSummaries(db, world.warehouses.alphaA),
    );
    expect(initialBatch.ready).toBe(false);
    expect(initialBatch).not.toHaveProperty("continuationKey");
    await run(async (db) => {
      const writes = trackFinishedGoodsWrites(db);
      await writes.db.patch("finishedGoodsPallets", ids[0]!, {
        quantity: 2.002,
        status: "STORED",
      });
      await writes.db.delete("finishedGoodsPallets", ids[1]!);
      await writes.flush();
    });
    const finalBatch = await run((db) =>
      backfillProductSummaries(db, world.warehouses.alphaA),
    );
    expect(finalBatch.ready).toBe(true);
    expect(finalBatch).not.toHaveProperty("continuationKey");
    expect(await read()).toMatchObject({
      count: 100,
      quantity: 101.101,
      stored: 1,
      awaitingMeasurement: 99,
      formatCounts: { PALLET: 100, BOX: 0, OTHER: 0 },
    });
    expect(
      await run((db) => backfillProductSummaries(db, world.warehouses.alphaA)),
    ).not.toHaveProperty("continuationKey");
    await run(async (db) => {
      const writes = trackFinishedGoodsWrites(db);
      await writes.db.patch("finishedGoodsProducts", productId, {
        storageFormat: "BOX",
      });
      await writes.db.patch("finishedGoodsPallets", ids[2]!, { retiredAt: 2 });
      await writes.flush();
    });
    expect(await read()).toMatchObject({
      count: 99,
      quantity: 100.1,
      formatCounts: { PALLET: 0, BOX: 99, OTHER: 0 },
    });
  });
});
