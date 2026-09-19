import { v } from "convex/values";
import { queryWithOrg } from "../../convex/lib/tenantFunctions";
import { paginatedScan } from "../../convex/lib/cataloguePagination";
import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";
import * as catalogue from "../../convex/finishedGoods/catalogue";
import * as batches from "../../convex/finishedGoods/batches";
import { prepare } from "../../convex/finishedGoods/summaryMaintenance";
import type { DataModel } from "../../convex/schema";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";
import { newFilters } from "../../src/features/finishedGoods/catalogueFilters";
type Runtime = {
  _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
};
async function call<T>(
  world: ConvexTenantWorld,
  fn: unknown,
  args: unknown,
): Promise<T> {
  const result = (await world.t
    .withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_a" })
    .run((ctx) =>
      (fn as Runtime)._handler(ctx as GenericMutationCtx<DataModel>, args),
    )) as { ok: boolean; value: T };
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return result.value;
}
async function measuredPage(
  world: ConvexTenantWorld,
  args: Record<string, unknown>,
) {
  const reads: Array<{ table: string; method: string; limit: number }> = [];
  const wrapQuery = (query: object, table: string): object =>
    new Proxy(query, {
      get(target, key, receiver) {
        const member = Reflect.get(target, key, receiver);
        if (typeof member !== "function") return member;
        return (...input: unknown[]) => {
          if (key === "take")
            reads.push({ table, method: "take", limit: Number(input[0]) });
          if (key === "paginate")
            reads.push({
              table,
              method: "paginate",
              limit: Number((input[0] as { numItems: number }).numItems),
            });
          const result = Reflect.apply(member, target, input);
          return result &&
            typeof result === "object" &&
            !(result instanceof Promise)
            ? wrapQuery(result, table)
            : result;
        };
      },
    });
  const outcome = (await world.t
    .withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_a" })
    .run((ctx) => {
      const db = new Proxy(ctx.db, {
        get(target, key, receiver) {
          const member = Reflect.get(target, key, receiver);
          if (key === "query")
            return (table: string) =>
              wrapQuery(Reflect.apply(member, target, [table]), table);
          return typeof member === "function" ? member.bind(target) : member;
        },
      });
      return (catalogue.page as unknown as Runtime)._handler(
        { ...ctx, db } as GenericMutationCtx<DataModel>,
        {
          warehouseId: world.warehouses.alphaA,
          tab: "products",
          search: "",
          filters: newFilters(),
          locale: "en",
          pageSize: 20,
          ...args,
        },
      );
    })) as { ok: boolean; value: Page };
  expect(outcome.ok).toBe(true);
  return { result: outcome.value, reads };
}
type Page = {
  status: string;
  page: Array<{
    _id: string;
    name?: string;
    code?: string;
    summary?: { quantity: number };
  }>;
  isDone: boolean;
  continueCursor: string;
  scanCursor?: string;
  scanned: number;
};
async function page(world: ConvexTenantWorld, args: Record<string, unknown>) {
  let scanCursor: string | undefined;
  for (let step = 0; step < 500; step++) {
    const result = await call<Page>(world, catalogue.page, {
      warehouseId: world.warehouses.alphaA,
      tab: "products",
      search: "",
      filters: newFilters(),
      locale: "en",
      pageSize: 20,
      ...args,
      ...(scanCursor ? { scanCursor } : {}),
    });
    if (result.status !== "scanning") return result;
    expect(result.page).toEqual([]);
    scanCursor = result.scanCursor;
  }
  throw new Error("Scan did not terminate");
}
async function setup(count = 105) {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
  const ids = await world.t.run(async (ctx) => {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const productId = await ctx.db.insert("finishedGoodsProducts", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        sku: `SKU-${String(i).padStart(4, "0")}`,
        name: `สินค้า ${i}`,
        unit: "PCS",
        storageFormat: "PALLET",
        storageCondition: "ANY",
        status: "ACTIVE",
        createdAt: i,
        updatedAt: i,
        createdByUserId: world.userA,
        updatedByUserId: world.userA,
      });
      ids.push(productId);
      await ctx.db.insert("finishedGoodsPallets", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        productId,
        code: `P-${i}`,
        quantity: i + 1,
        lot: i === 2 ? "rare-late-match" : "normal",
        status: "AWAITING_MEASUREMENT",
        createdAt: i,
        updatedAt: i,
        createdByUserId: world.userA,
        updatedByUserId: world.userA,
      });
    }
    return ids;
  });
  for (let i = 0; i < 10; i++) {
    const result = await call<{ ready: boolean }>(world, prepare, {
      warehouseId: world.warehouses.alphaA,
    });
    if (result.ready) break;
  }
  return { world, ids };
}
describe("bounded finished goods catalogue pages", () => {
  it("splits incomplete native ranges before displaying rows, without skipping or duplicating identities", async () => {
    const { world } = await setup(25);
    const products = await world.t.run((ctx) =>
      ctx.db.query("finishedGoodsProducts").collect(),
    );
    const requests: Array<[string | undefined, string | undefined]> = [];
    const endpoint = queryWithOrg({
      args: {
        warehouseId: v.id("warehouses"),
        cursor: v.optional(v.string()),
        scanCursor: v.optional(v.string()),
      },
      returns: v.any(),
      permissionCode: "masterData.storageLayout.read",
      target: { table: "finishedGoodsProducts" },
      warehouseId: (a) => a.warehouseId,
      handler: (ctx, args) =>
        paginatedScan(ctx, {
          scope: ["split-test", args.warehouseId],
          pageSize: 20,
          cursor: args.cursor,
          scanCursor: args.scanCursor,
          read: async (raw, end) => {
            requests.push([raw, end]);
            if (!raw && !end)
              return {
                page: [products[0]!],
                isDone: false,
                continueCursor: "end",
                splitCursor: "middle",
                pageStatus: "SplitRequired" as const,
              };
            if (end === "middle")
              return {
                page: products.slice(0, 10),
                isDone: false,
                continueCursor: "middle",
              };
            if (raw === "middle")
              return {
                page: products.slice(10, 20),
                isDone: false,
                continueCursor: "end",
              };
            return {
              page: products.slice(20),
              isDone: true,
              continueCursor: "finished",
            };
          },
          get: async (id) => products.find((row) => row._id === id) ?? null,
          hydrate: async (row) => row,
          matches: () => true,
        }),
    });
    const first = await call<Page>(world, endpoint, {
      warehouseId: world.warehouses.alphaA,
    });
    expect(first.status).toBe("scanning");
    expect(first.page).toEqual([]);
    const left = await call<Page>(world, endpoint, {
      warehouseId: world.warehouses.alphaA,
      scanCursor: first.scanCursor,
    });
    expect(left.status).toBe("scanning");
    expect(left.page).toEqual([]);
    const combined = await call<Page>(world, endpoint, {
      warehouseId: world.warehouses.alphaA,
      scanCursor: left.scanCursor,
    });
    expect(combined.status).toBe("ready");
    expect(combined.page.map((row) => row._id)).toEqual(
      products.slice(0, 20).map((row) => row._id),
    );
    const last = await call<Page>(world, endpoint, {
      warehouseId: world.warehouses.alphaA,
      cursor: combined.continueCursor,
    });
    expect(last.page.map((row) => row._id)).toEqual(
      products.slice(20).map((row) => row._id),
    );
    expect(requests).toEqual([
      [undefined, undefined],
      [undefined, "middle"],
      ["middle", "end"],
      ["end", undefined],
    ]);
  });
  it("bounds each query's scanned rows and does not read unit history for the default product page", async () => {
    const { world } = await setup();
    const first = await measuredPage(world, {});
    expect(first.result.page).toHaveLength(20);
    expect(
      first.reads.filter((read) => read.method === "paginate"),
    ).toHaveLength(1);
    expect(first.reads.every((read) => read.limit <= 101)).toBe(true);
    expect(
      first.reads.some(
        (read) =>
          read.table === "finishedGoodsPallets" ||
          read.table === "finishedGoodsMoves",
      ),
    ).toBe(false);
    const sorted = await measuredPage(world, {
      filters: { ...newFilters(), sort: "quantity:asc" },
    });
    expect(sorted.result.status).toBe("scanning");
    expect(sorted.result.page).toEqual([]);
    expect(sorted.result.scanned).toBe(50);
    expect(
      sorted.reads.filter((read) => read.method === "paginate"),
    ).toHaveLength(1);
    expect(sorted.reads.every((read) => read.limit <= 101)).toBe(true);
  });
  it.each([0, 1, 19, 20, 21, 100, 101])(
    "handles %i rows without truncation at public page boundaries",
    async (count) => {
      const { world } = await setup(count);
      const first = await page(world, {});
      expect(first.status).toBe("ready");
      expect(first.page).toHaveLength(Math.min(count, 20));
      expect(first.isDone).toBe(count <= 20);
      const large = await page(world, { pageSize: 100 });
      expect(large.page).toHaveLength(Math.min(count, 100));
      expect(large.isDone).toBe(count <= 100);
    },
  );
  it("uses stable identity ties across globally sorted pages", async () => {
    const { world, ids } = await setup(41);
    await world.t.run(async (ctx) => {
      const products = await ctx.db.query("finishedGoodsProducts").collect();
      for (const product of products)
        await ctx.db.patch("finishedGoodsProducts", product._id, {
          name: "Same name",
        });
    });
    const filters = { ...newFilters(), sort: "name:asc" };
    const first = await page(world, { filters });
    const second = await page(world, { filters, cursor: first.continueCursor });
    const collator = new Intl.Collator("en", {
      numeric: true,
      sensitivity: "base",
    });
    expect([...first.page, ...second.page].map((row) => row._id)).toEqual(
      ids.sort(collator.compare).slice(0, 40),
    );
  });
  it("rejects another authorized warehouse's continuation independently of permission denial", async () => {
    const { world } = await setup(21);
    const first = await page(world, {});
    await world.t.run(async (ctx) => {
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_orgId_userId", (q) =>
          q.eq("orgId", world.orgA).eq("userId", world.userA),
        )
        .unique();
      await ctx.db.patch("memberships", membership!._id, {
        scopeMode: "ORG_WIDE",
      });
      await ctx.db.insert("finishedGoodsSummaryReadiness", {
        orgId: world.orgA,
        warehouseId: world.warehouses.bravoA,
        version: 1,
        ready: true,
        generation: 1,
        continuationKey: crypto.randomUUID(),
      });
    });
    const result = await page(world, {
      warehouseId: world.warehouses.bravoA,
      cursor: first.continueCursor,
    });
    expect(result.status).toBe("reset");
    expect(result.page).toEqual([]);
  });
  it("traverses every indexed page once, with complete product summaries and exact boundary sizes", async () => {
    const { world, ids } = await setup();
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const result = await page(world, { ...(cursor ? { cursor } : {}) });
      expect(result.status).toBe("ready");
      expect(result.page.length).toBeLessThanOrEqual(20);
      seen.push(...result.page.map((r) => r._id));
      cursor = result.isDone ? undefined : result.continueCursor;
    } while (cursor);
    expect(seen).toEqual([...ids].reverse());
    expect(new Set(seen).size).toBe(105);
    const fifty = await page(world, { pageSize: 50 });
    expect(fifty.page).toHaveLength(50);
    expect(fifty.page[0]?.summary?.quantity).toBe(105);
  });
  it("filters and sorts globally, finds a unit lot off the first product page, preserves Thai text", async () => {
    const { world, ids } = await setup();
    const result = await page(world, {
      filters: { ...newFilters(), sort: "quantity:asc" },
    });
    expect(result.page.map((r) => r._id)).toEqual(ids.slice(0, 20));
    const second = await page(world, {
      filters: { ...newFilters(), sort: "quantity:asc" },
      cursor: result.continueCursor,
    });
    expect(second.page.map((r) => r._id)).toEqual(ids.slice(20, 40));
    const search = await page(world, { search: "rare-late-match" });
    expect(search.page.map((r) => r._id)).toEqual([ids[2]]);
    const thai = await page(world, { search: "สินค้า 104" });
    expect(thai.page.map((r) => r._id)).toEqual([ids[104]]);
  });
  it("rejects cross-warehouse and changed-criteria cursors; native pages survive unrelated generation updates", async () => {
    const { world } = await setup(21);
    const first = await page(world, {});
    await expect(
      call<Page>(world, catalogue.page, {
        warehouseId: world.warehouses.bravoA,
        tab: "products",
        search: "",
        filters: newFilters(),
        locale: "en",
        pageSize: 20,
        cursor: first.continueCursor,
      }),
    ).rejects.toThrow("WAREHOUSE_OUT_OF_SCOPE");
    expect(
      (await page(world, { search: "changed", cursor: first.continueCursor }))
        .status,
    ).toBe("reset");
    await world.t.run(async (ctx) => {
      const ready = await ctx.db.query("finishedGoodsSummaryReadiness").first();
      if (ready)
        await ctx.db.patch("finishedGoodsSummaryReadiness", ready._id, {
          generation: (ready.generation ?? 0) + 1,
        });
    });
    expect(
      (await page(world, { cursor: first.continueCursor })).page,
    ).toHaveLength(1);
  });
  it("returns complete independent warehouse totals after bounded summary continuation", async () => {
    const { world } = await setup();
    let scanCursor: string | undefined;
    let result: {
      status: string;
      scanCursor?: string;
      totals: {
        products: number;
        awaitingMeasurement: number;
        units: string[];
      };
    };
    do {
      result = await call(world, catalogue.summary, {
        warehouseId: world.warehouses.alphaA,
        ...(scanCursor ? { scanCursor } : {}),
      });
      scanCursor = result.scanCursor;
    } while (result.status === "scanning");
    expect(result.totals).toMatchObject({
      products: 105,
      awaitingMeasurement: 105,
      units: ["PCS"],
    });
  });
  it("rejects forged aggregate totals and malformed native cursors", async () => {
    const { world } = await setup();
    const first = await call<{ status: string; scanCursor: string }>(
      world,
      catalogue.summary,
      { warehouseId: world.warehouses.alphaA },
    );
    expect(first.status).toBe("scanning");
    const cursor = JSON.parse(first.scanCursor);
    const payload = JSON.parse(cursor.payload);
    payload.totals.products = 9000;
    cursor.payload = JSON.stringify(payload);
    const tampered = await call<{ status: string }>(world, catalogue.summary, {
      warehouseId: world.warehouses.alphaA,
      scanCursor: JSON.stringify(cursor),
    });
    expect(tampered.status).toBe("reset");
    const result = await page(world, {});
    const invalid = JSON.parse(result.continueCursor);
    invalid.raw = "not-a-native-cursor";
    expect(
      (await page(world, { cursor: JSON.stringify(invalid) })).status,
    ).toBe("reset");
  });
  it("keeps one-character descendant searches bounded across many child chunks", async () => {
    const { world, ids } = await setup(1);
    await world.t.run(async (ctx) => {
      const unit = await ctx.db.query("finishedGoodsPallets").first();
      const { _id, _creationTime, ...fields } = unit!;
      for (let i = 0; i < 150; i++)
        await ctx.db.insert("finishedGoodsPallets", {
          ...fields,
          code: "a".repeat(70) + i,
          updatedAt: i + 10,
        });
    });
    const result = await page(world, { search: "z" });
    expect(result.status).toBe("ready");
    expect(result.page).toEqual([]);
    expect(ids).toHaveLength(1);
  });
  it("pages lightweight batch headers independently from legacy units", async () => {
    const { world, ids } = await setup(1);
    await world.t.run(async (ctx) => {
      const product = await ctx.db.query("finishedGoodsProducts").first();
      for (let i = 0; i < 21; i++)
        await ctx.db.insert("finishedGoodsBatches", {
          orgId: world.orgA,
          warehouseId: world.warehouses.alphaA,
          productId: product!._id,
          revision: 1,
          status: "DRAFT",
          storageFormat: "BOX",
          packages: [{ dimensionsChecked: false }],
          createdAt: i,
          updatedAt: i,
          createdByUserId: world.userA,
          updatedByUserId: world.userA,
        });
    });
    const args = {
      warehouseId: world.warehouses.alphaA,
      productId: ids[0],
      pageSize: 20,
    };
    const first = await call<Page>(world, batches.pageProductBatches, args);
    expect(first.page).toHaveLength(20);
    expect(first.page[0]).toHaveProperty("batch");
    expect(
      (first.page[0] as unknown as { batch: object }).batch,
    ).not.toHaveProperty("packages");
    const next = await call<Page>(world, batches.pageProductBatches, {
      ...args,
      cursor: first.continueCursor,
    });
    expect(next.page).toHaveLength(1);
    expect(next.isDone).toBe(true);
    const legacy = await call<Page>(world, batches.pageLegacyUnits, args);
    expect(legacy.page).toHaveLength(1);
  });
  it("direct unit resolver remains independent of batch and legacy pagination", async () => {
    const { world, ids } = await setup(21);
    const unit = await world.t.run((ctx) =>
      ctx.db
        .query("finishedGoodsPallets")
        .withIndex("by_orgId_productId", (q) =>
          q.eq("orgId", world.orgA).eq("productId", ids[0] as never),
        )
        .first(),
    );
    const value = await call<{
      unit: { _id: string };
      batchId: null;
      editable: boolean;
    }>(world, batches.resolveUnitBatch, {
      warehouseId: world.warehouses.alphaA,
      productId: ids[0],
      palletId: unit!._id,
    });
    expect(value).toMatchObject({
      batchId: null,
      editable: true,
      unit: { _id: unit!._id },
    });
  });
});
