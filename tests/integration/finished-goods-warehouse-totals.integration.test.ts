import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";

import { summary } from "../../convex/finishedGoods/catalogue";
import { run as buildTotals } from "../../convex/finishedGoods/totalsBackfill";
import {
  backfillProductSummaries,
  trackFinishedGoodsWrites,
} from "../../convex/lib/finishedGoodsSummary";
import { createTenantDocumentAccess } from "../../convex/lib/tenantDb";
import { createMutationTenantStorage } from "../../convex/lib/tenantStorage";
import type { DataModel } from "../../convex/schema";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
} from "../fixtures/convex-tenant-world";
import { settlePage } from "../fixtures/query-read-stats";

type Totals = {
  products: number;
  awaitingMeasurement: number;
  awaitingStorage: number;
  stored: number;
  moving: number;
  units: string[];
};

async function catalogueWorld() {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, {
    roleA: "ORG_ADMIN",
    roleB: "ORG_ADMIN",
  });
  const warehouseId = world.warehouses.alphaA;
  const audit = {
    orgId: world.orgA,
    warehouseId,
    createdAt: 1,
    updatedAt: 1,
    createdByUserId: world.userA,
    updatedByUserId: world.userA,
  };
  const { products, pallets } = await world.t.run(async (ctx) => {
    const products = [];
    for (const [sku, unit] of [
      ["A", "PCS"],
      ["B", "KG"],
      ["C", "PCS"],
    ] as const)
      products.push(
        await ctx.db.insert("finishedGoodsProducts", {
          ...audit,
          sku,
          name: `Product ${sku}`,
          unit,
          storageFormat: "PALLET",
          storageCondition: "ANY",
          status: "ACTIVE",
        }),
      );
    // Enough products that the paged scan needs more than one 100-row chunk.
    for (let i = 0; i < 120; i++)
      await ctx.db.insert("finishedGoodsProducts", {
        ...audit,
        sku: `Z-${String(i).padStart(3, "0")}`,
        name: `Filler ${i}`,
        unit: i % 2 ? "PCS" : "SET",
        storageFormat: "PALLET",
        storageCondition: "ANY",
        status: "ACTIVE",
      });
    const statuses = [
      "AWAITING_MEASUREMENT",
      "AWAITING_PLACEMENT",
      "RESERVED",
      "STORED",
    ] as const;
    const pallets = [];
    for (let i = 0; i < 30; i++)
      pallets.push(
        await ctx.db.insert("finishedGoodsPallets", {
          ...audit,
          productId: products[i % 3]!,
          code: `P-${i}`,
          quantity: 1,
          status: statuses[i % 4]!,
        }),
      );
    return { products, pallets };
  });
  const run = <T>(
    fn: (db: ReturnType<typeof createTenantDocumentAccess>) => Promise<T>,
  ) =>
    world.t.run((ctx) =>
      fn(
        createTenantDocumentAccess(
          { orgId: world.orgA, requestId: "totals-test" },
          createMutationTenantStorage(ctx, "totals-test"),
        ),
      ),
    );
  for (let batch = 0; batch < 10; batch++)
    if ((await run((db) => backfillProductSummaries(db, warehouseId))).ready)
      break;
  const build = () =>
    world.t.run((ctx) =>
      (
        buildTotals as unknown as {
          _handler(
            ctx: GenericMutationCtx<DataModel>,
            args: unknown,
          ): Promise<{ built: boolean }>;
        }
      )._handler(ctx, { warehouseId }),
    );
  const setTotalsVersion = (version: number | undefined) =>
    world.t.run(async (ctx) => {
      const row = (
        await ctx.db.query("finishedGoodsSummaryReadiness").collect()
      )[0]!;
      await ctx.db.patch(row._id, { totalsVersion: version });
    });
  const read = async () => {
    const settled = await settlePage<{
      status: string;
      scanCursor?: string;
      continueCursor: string;
      isDone: boolean;
      totals: Totals;
    }>(world, summary, { warehouseId });
    return {
      result: settled.result,
      requests: settled.requests,
      docs: Object.values(settled.stats.rangeDocs)
        .concat(Object.values(settled.stats.gets))
        .reduce((sum, count) => sum + count, 0),
    };
  };
  /** Maintained totals versus the paged scan, on the same snapshot. */
  const expectParity = async () => {
    await setTotalsVersion(undefined);
    const scanned = await read();
    await setTotalsVersion(1);
    const maintained = await read();
    expect(maintained.result).toEqual(scanned.result);
    return { scanned, maintained };
  };
  return { world, run, build, read, expectParity, products, pallets };
}

describe("maintained warehouse totals", () => {
  it("answer the catalogue summary exactly, in one request, through writes", async () => {
    const seed = await catalogueWorld();
    expect(await seed.build()).toEqual({ built: true });
    const first = await seed.expectParity();
    expect(first.maintained.requests).toBe(1);
    expect(first.maintained.docs).toBeLessThan(first.scanned.docs);
    expect(first.scanned.requests).toBeGreaterThan(1);
    expect(first.maintained.result.totals).toMatchObject({
      products: 123,
      units: ["KG", "PCS", "SET"],
    });

    // New product with a new unit, a unit change, and pallet transitions.
    await seed.run(async (db) => {
      const writes = trackFinishedGoodsWrites(db);
      await writes.db.insert("finishedGoodsProducts", {
        warehouseId: seed.world.warehouses.alphaA,
        sku: "D",
        name: "Product D",
        unit: "BOX",
        storageFormat: "PALLET",
        storageCondition: "ANY",
        status: "ACTIVE",
        createdAt: 2,
        updatedAt: 2,
        createdByUserId: seed.world.userA,
        updatedByUserId: seed.world.userA,
      });
      await writes.db.patch("finishedGoodsProducts", seed.products[1]!, {
        unit: "L",
      });
      await writes.db.patch("finishedGoodsPallets", seed.pallets[0]!, {
        status: "STORED",
      });
      await writes.db.delete("finishedGoodsPallets", seed.pallets[5]!);
      await writes.flush();
    });
    const second = await seed.expectParity();
    expect(second.maintained.result.totals).toMatchObject({
      products: 124,
      units: ["BOX", "L", "PCS", "SET"],
    });
  });

  it("fall back to the scan after writes by code that does not maintain them", async () => {
    const seed = await catalogueWorld();
    await seed.build();
    const before = await seed.read();
    expect(before.requests).toBe(1);
    // Pre-change code bumps the legacy generation on every write (rollback).
    await seed.world.t.run(async (ctx) => {
      const row = (
        await ctx.db.query("finishedGoodsSummaryReadiness").collect()
      )[0]!;
      await ctx.db.patch(row._id, { generation: (row.generation ?? 0) + 1 });
    });
    const after = await seed.read();
    expect(after.result).toEqual(before.result);
    expect(after.docs).toBeGreaterThan(before.docs);
    // A rebuild trusts them again.
    await seed.build();
    expect((await seed.read()).requests).toBe(1);
  });
});
