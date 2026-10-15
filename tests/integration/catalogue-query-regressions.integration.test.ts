import { describe, expect, it } from "vitest";
import * as catalogue from "../../convex/finishedGoods/catalogue";
import { prepare } from "../../convex/finishedGoods/summaryMaintenance";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "@tests/fixtures/convex-tenant-world";
import { newFilters } from "../../src/features/finishedGoods/catalogueFilters";
import { measured, settlePage } from "../fixtures/query-read-stats";

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
async function traverse(
  world: ConvexTenantWorld,
  sort: string,
  tab: "products" | "pallets" = "products",
) {
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < 20; pageNumber++) {
    const { result } = await settlePage<Page>(world, catalogue.page, {
      ...baseArgs(world),
      tab,
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

describe("quantity-sorted pages with case-variant counting units", () => {
  it.each(["products", "pallets"] as const)(
    "sorted %s pages return every row exactly once with mixed PCS/pcs units",
    async (tab) => {
      const count = 45;
      const world = await seed(count, (i) => ({
        unit: i % 2 ? "PCS" : "pcs",
        quantity: ((i * 37) % count) + 1,
      }));
      for (const sort of ["quantity:asc", "quantity:desc"]) {
        const seen = await traverse(world, sort, tab);
        const duplicates = seen.length - new Set(seen).size;
        const missing = count - new Set(seen).size;
        expect.soft({ sort, duplicates, missing }).toEqual({
          sort,
          duplicates: 0,
          missing: 0,
        });
      }
    },
  );

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

describe("product search request budget", () => {
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
    expect(unitOnly.result.page).toHaveLength(1);
    // The 105 single-unit products fit in six bounded product chunks.
    expect(unitOnly.requests).toBe(6);
    expect(nameHit.result.page).toHaveLength(1);
    expect(nameHit.requests).toBe(6);
  });
});
