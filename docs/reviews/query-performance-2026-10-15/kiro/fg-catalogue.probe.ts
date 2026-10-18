import { describe, expect, it } from "vitest";
import * as catalogue from "../../../../convex/finishedGoods/catalogue";
import { prepare } from "../../../../convex/finishedGoods/summaryMaintenance";
import { createRowComparator } from "../../../../convex/finishedGoods/catalogueFilters";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "@tests/fixtures/convex-tenant-world";
import { newFilters } from "../../../../src/features/finishedGoods/catalogueFilters";
import { measured, settlePage, total } from "./measure";

type Page = {
  status: string;
  page: Array<{ _id: string; unit?: string; summary?: { quantity: number } }>;
  isDone: boolean;
  continueCursor: string;
  scanCursor?: string;
  scanned: number;
};

/** Products with one AWAITING_MEASUREMENT unit each, then summary readiness. */
async function seed(
  count: number,
  product: (i: number) => { unit: string; quantity: number; lot?: string },
) {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
  await world.t.run(async (ctx) => {
    for (let i = 0; i < count; i++) {
      const shape = product(i);
      const productId = await ctx.db.insert("finishedGoodsProducts", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        sku: `SKU-${String(i).padStart(4, "0")}`,
        name: `Product ${i}`,
        unit: shape.unit,
        storageFormat: "PALLET",
        storageCondition: "ANY",
        status: "ACTIVE",
        createdAt: i,
        updatedAt: i,
        createdByUserId: world.userA,
        updatedByUserId: world.userA,
      });
      await ctx.db.insert("finishedGoodsPallets", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        productId,
        code: `P-${i}`,
        quantity: shape.quantity,
        lot: shape.lot ?? "normal",
        status: "AWAITING_MEASUREMENT",
        createdAt: i,
        updatedAt: i,
        createdByUserId: world.userA,
        updatedByUserId: world.userA,
      });
    }
  });
  for (let i = 0; i < 20; i++) {
    const { value } = await measured<{ ready: boolean }>(world, prepare, {
      warehouseId: world.warehouses.alphaA,
    });
    if (value.ready) break;
  }
  return world;
}

const baseArgs = (world: ConvexTenantWorld) => ({
  warehouseId: world.warehouses.alphaA,
  tab: "products",
  search: "",
  filters: newFilters(),
  locale: "en",
  pageSize: 20,
});

/** Follow Next until done, as the catalogue pager does. */
async function traverse(world: ConvexTenantWorld, sort: string) {
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < 20; pageNumber++) {
    const { result } = await settlePage<Page>(world, catalogue.page, {
      ...baseArgs(world),
      filters: { ...newFilters(), sort },
      ...(cursor ? { cursor } : {}),
    });
    expect(result.status).toBe("ready");
    seen.push(...result.page.map((row) => row._id));
    if (result.isDone) break;
    cursor = result.continueCursor;
  }
  return seen;
}

describe("Q1 — quantity sort comparator with case-variant units", () => {
  it("createRowComparator is transitive (pure helper)", () => {
    const compare = createRowComparator("quantity:asc", "en");
    const row = (id: string, unit: string, quantity: number) => ({
      id,
      unit,
      quantity,
      name: "",
      sku: "",
      code: "",
      search: "",
      format: "",
      formats: [],
      progress: [],
      status: "ACTIVE",
      lot: "",
      measured: false,
      length: undefined,
      width: undefined,
      height: undefined,
      stored: 0,
      awaitingStorage: 0,
      awaitingMeasurement: 0,
      moving: 0,
      updatedAt: 0,
    });
    const x = row("a", "PCS", 5);
    const y = row("b", "pcs", 3);
    const z = row("c", "PCS", 1);
    const order = (p: typeof x, q: typeof x) => Math.sign(compare(p, q));
    // z<x (same unit, quantity), x<y and y<z (different units collate equal,
    // fall through to id order) => z<x<y<z is a cycle.
    const observed = [order(z, x), order(x, y), order(y, z)];
    expect(
      observed,
      "a strict weak order cannot have all three negative",
    ).not.toEqual([-1, -1, -1]);
  });

  it("sorted product pages return every product exactly once (mixed PCS/pcs units)", async () => {
    const count = 45;
    const world = await seed(count, (i) => ({
      unit: i % 2 ? "PCS" : "pcs",
      quantity: ((i * 37) % count) + 1,
    }));
    for (const sort of ["quantity:asc", "quantity:desc"]) {
      const seen = await traverse(world, sort);
      const duplicates = seen.length - new Set(seen).size;
      const missing = count - new Set(seen).size;
      console.info(
        `[Q1] sort=${sort}: rows=${seen.length} unique=${new Set(seen).size} duplicates=${duplicates} missing=${missing}`,
      );
      expect.soft({ sort, duplicates, missing }).toEqual({
        sort,
        duplicates: 0,
        missing: 0,
      });
    }
  });

  it("control: identical data with one unit spelling pages completely", async () => {
    const count = 45;
    const world = await seed(count, (i) => ({
      unit: "PCS",
      quantity: ((i * 37) % count) + 1,
    }));
    const seen = await traverse(world, "quantity:asc");
    expect(new Set(seen).size).toBe(count);
    expect(seen).toHaveLength(count);
  });
});

describe("Q2 — product search that matches only unit text", () => {
  it("settles a 105-product unit-lot search in a bounded number of requests", async () => {
    const count = 105;
    const world = await seed(count, (i) => ({
      unit: "PCS",
      quantity: i + 1,
      lot: i === 2 ? "rare-late-match" : "normal",
    }));
    const unitOnly = await settlePage<Page>(world, catalogue.page, {
      ...baseArgs(world),
      search: "rare-late-match",
    });
    const nameHit = await settlePage<Page>(world, catalogue.page, {
      ...baseArgs(world),
      search: "Product 104",
    });
    console.info(
      `[Q2] unit-lot search: requests=${unitOnly.requests} ranges=${total(unitOnly.stats.ranges)} rangeDocs=${total(unitOnly.stats.rangeDocs)} gets=${total(unitOnly.stats.gets)} matches=${unitOnly.result.page.length}`,
      JSON.stringify(unitOnly.stats),
    );
    console.info(
      `[Q2] control name search: requests=${nameHit.requests} ranges=${total(nameHit.stats.ranges)} matches=${nameHit.result.page.length}`,
    );
    expect(unitOnly.result.page).toHaveLength(1);
    // One bounded batch of up to 20 products per request would need
    // ceil(105/20)=6 requests; allow 2x slack for unit continuations.
    expect(unitOnly.requests).toBeLessThanOrEqual(12);
  });
});
