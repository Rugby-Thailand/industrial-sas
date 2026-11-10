import { expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  backfillProductSummaries,
  readProductSummary,
} from "../../convex/lib/finishedGoodsSummary";
import { createTenantDocumentAccess } from "../../convex/lib/tenantDb";
import { createMutationTenantStorage } from "../../convex/lib/tenantStorage";
import { tenantDocument } from "../../convex/lib/tenantDocument";
import {
  PUBLIC_API_ACTOR,
  createPublicApiWorld,
} from "../fixtures/public-api-examples";

const modules = Object.fromEntries(
  Object.entries(
    import.meta.glob([
      "../../convex/**/*.ts",
      "!../../convex/_generated/**",
      "!../../convex/model/**",
      "!../../convex/**/*.test.ts",
      "!../../convex/schema.ts",
      "!../../convex/auth.config.ts",
    ]),
  ).map(([file, load]) => [file.replace("../../convex/", "../convex/"), load]),
);

it("rebuilds the same summary after seeded packing writes and duplicate command deliveries", async () => {
  const w = await createPublicApiWorld(modules);
  const actor = w.t.withIdentity(PUBLIC_API_ACTOR);
  const rebuild = () =>
    w.t.run(async (ctx) => {
      const db = createTenantDocumentAccess(
        { orgId: w.orgA, requestId: "rebuild-equivalence" },
        createMutationTenantStorage(ctx, "rebuild-equivalence"),
      );
      return backfillProductSummaries(db, w.warehouses.alphaA);
    });
  const read = () =>
    w.t.run(async (ctx) => {
      const db = createTenantDocumentAccess(
        { orgId: w.orgA, requestId: "read-equivalence" },
        createMutationTenantStorage(ctx, "read-equivalence"),
      );
      const product = await tenantDocument(
        db,
        "finishedGoodsProducts",
        w.productId,
      );
      if (!product) throw new Error("fixture product missing");
      return readProductSummary({ tenantDb: db }, product);
    });
  expect((await rebuild()).ready).toBe(true);
  let seed = 179;
  const draw = () => (seed = (seed * 1664525 + 1013904223) >>> 0);
  for (let n = 0; n < 8; n++) {
    const packages = Array.from({ length: 1 + (draw() % 3) }, () => ({
      quantity: 1 + (draw() % 20),
      lengthMm: 400,
      widthMm: 300,
      heightMm: 200,
      dimensionsChecked: true,
    }));
    const args = {
      warehouseId: w.warehouses.alphaA,
      productId: w.productId,
      requestId: `equivalence-packing-${n}`,
      totalQuantity: packages.reduce((sum, row) => sum + row.quantity, 0),
      packages,
    };
    expect(
      await actor.mutation(api.finishedGoods.workflow.createPacking, args),
    ).toMatchObject({ ok: true, value: { written: true, replayed: false } });
    expect(
      await actor.mutation(api.finishedGoods.workflow.createPacking, args),
    ).toMatchObject({ ok: true, value: { written: true, replayed: true } });
  }
  const incremental = await read();
  expect(incremental).not.toBeNull();
  // Remove only derived rows, forcing the rebuild to read authoritative units
  // rather than accepting already-maintained contribution receipts.
  await w.t.run(async (ctx) => {
    for (const table of [
      "finishedGoodsProductSummaries",
      "finishedGoodsUnitContributions",
      "finishedGoodsSummaryReadiness",
    ] as const)
      for (const row of await ctx.db.query(table).collect())
        if (row.orgId === w.orgA) await ctx.db.delete(row._id);
  });
  expect(await read()).toBeNull();
  expect((await rebuild()).ready).toBe(true);
  expect(await read()).toEqual(incremental);
});
