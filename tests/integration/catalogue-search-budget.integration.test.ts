import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";
import * as catalogue from "../../convex/finishedGoods/catalogue";
import { prepare } from "../../convex/finishedGoods/summaryMaintenance";
import type { DataModel } from "../../convex/schema";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "@tests/fixtures/convex-tenant-world";
import { newFilters } from "../../src/features/finishedGoods/catalogueFilters";
import { measured } from "../fixtures/query-read-stats";

/**
 * Product-tab search evaluates many products per request: small products are
 * read completely by a bounded unit probe, and only products with more raw unit
 * rows than one page continue through the single native page a query may use.
 * Each case compares against a reference that joins every product's live unit
 * text in index order, which is the search's defined substring semantics.
 */

type Runtime = {
  _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
};
type Page = {
  status: string;
  page: Array<{ _id: string }>;
  isDone: boolean;
  continueCursor: string;
  scanCursor?: string;
  scanned: number;
};
type UnitSpec = { code?: string; lot?: string; retired?: boolean };
type ProductSpec = { name: string; sku?: string; units: UnitSpec[] };
type RequestReads = {
  paginate: number;
  takes: Array<{ table: string; limit: number }>;
  docs: Record<string, number>;
};

/** Raw unit rows one request may read: probe budget plus one native page. */
const MAX_UNIT_DOCS_PER_REQUEST = 10 * 51 + 50;

/** Products are listed newest first; units are listed in index (desc) order. */
async function seed(products: ProductSpec[]) {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
  const ids = await world.t.run(async (ctx) => {
    const ids: string[] = [];
    for (let i = products.length - 1; i >= 0; i--) {
      const spec = products[i]!;
      const updatedAt = products.length - i;
      const productId = await ctx.db.insert("finishedGoodsProducts", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        sku: spec.sku ?? `SKU-${String(i).padStart(4, "0")}`,
        name: spec.name,
        unit: "PCS",
        storageFormat: "PALLET",
        storageCondition: "ANY",
        status: "ACTIVE",
        createdAt: updatedAt,
        updatedAt,
        createdByUserId: world.userA,
        updatedByUserId: world.userA,
      });
      ids[i] = productId;
      for (let j = spec.units.length - 1; j >= 0; j--) {
        const unit = spec.units[j]!;
        await ctx.db.insert("finishedGoodsPallets", {
          orgId: world.orgA,
          warehouseId: world.warehouses.alphaA,
          productId,
          code: unit.code ?? `U-${i}-${j}`,
          quantity: 1,
          lot: unit.lot ?? "plain",
          status: "AWAITING_MEASUREMENT",
          ...(unit.retired ? { retiredAt: 1 } : {}),
          createdAt: spec.units.length - j,
          updatedAt: spec.units.length - j,
          createdByUserId: world.userA,
          updatedByUserId: world.userA,
        });
      }
    }
    return ids;
  });
  for (let i = 0; i < 500; i++) {
    const { value } = await measured<{ ready: boolean }>(world, prepare, {
      warehouseId: world.warehouses.alphaA,
    });
    if (value.ready) return { world, ids };
  }
  throw new Error("summaries did not become ready");
}

/** Joined live text per product in index order; independent of the scanner. */
async function reference(world: ConvexTenantWorld, search: string) {
  const needle = search.trim().toLocaleLowerCase();
  return world.t.run(async (ctx) => {
    const matches: string[] = [];
    const products = await ctx.db
      .query("finishedGoodsProducts")
      .withIndex("by_orgId_warehouseId_updatedAt", (q) =>
        q.eq("orgId", world.orgA).eq("warehouseId", world.warehouses.alphaA),
      )
      .order("desc")
      .collect();
    for (const product of products) {
      const units = await ctx.db
        .query("finishedGoodsPallets")
        .withIndex("by_orgId_warehouseId_productId_updatedAt", (q) =>
          q
            .eq("orgId", world.orgA)
            .eq("warehouseId", world.warehouses.alphaA)
            .eq("productId", product._id),
        )
        .order("desc")
        .collect();
      const text =
        `${product.name} ${product.sku} ` +
        units
          .filter((unit) => unit.retiredAt === undefined)
          .map((unit) => `${unit.code} ${unit.lot ?? ""} `)
          .join("");
      if (text.toLocaleLowerCase().includes(needle)) matches.push(product._id);
    }
    return matches;
  });
}

/** One registered handler execution, recording native pages and range sizes. */
async function request(
  world: ConvexTenantWorld,
  args: unknown,
  nativePage?: (table: string, options: unknown) => unknown,
) {
  const reads: RequestReads = { paginate: 0, takes: [], docs: {} };
  const count = (table: string, value: unknown) => {
    const docs = Array.isArray(value)
      ? value.length
      : value && typeof value === "object" && "page" in value
        ? (value as { page: unknown[] }).page.length
        : 0;
    reads.docs[table] = (reads.docs[table] ?? 0) + docs;
    return value;
  };
  const wrap = (query: object, table: string): object =>
    new Proxy(query, {
      get(target, key, receiver) {
        const member = Reflect.get(target, key, receiver);
        if (typeof member !== "function") return member;
        return (...input: unknown[]) => {
          if (key === "paginate") reads.paginate++;
          if (key === "take")
            reads.takes.push({ table, limit: Number(input[0]) });
          const result =
            key === "paginate" && nativePage
              ? Promise.resolve(nativePage(table, input[0]))
              : Reflect.apply(member, target, input);
          if (key === "paginate" || key === "take")
            return (result as Promise<unknown>).then((value) =>
              count(table, value),
            );
          return result &&
            typeof result === "object" &&
            !(result instanceof Promise)
            ? wrap(result, table)
            : result;
        };
      },
    });
  const outcome = (await world.t
    .withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_a" })
    .run(async (ctx) => {
      const db = new Proxy(ctx.db, {
        get(target, key, receiver) {
          const member = Reflect.get(target, key, receiver);
          if (key === "query")
            return (table: string) =>
              wrap(Reflect.apply(member, target, [table]), table);
          return typeof member === "function" ? member.bind(target) : member;
        },
      });
      return (catalogue.page as unknown as Runtime)._handler(
        { ...ctx, db } as GenericMutationCtx<DataModel>,
        args,
      );
    })) as { ok: boolean; value: Page };
  expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
  return { value: outcome.value, reads };
}

/** Settle one visible page as the client scan loop does. */
async function settle(
  world: ConvexTenantWorld,
  args: Record<string, unknown>,
  log: RequestReads[],
) {
  let scanCursor: string | undefined;
  for (let step = 0; step < 500; step++) {
    const { value, reads } = await request(world, {
      warehouseId: world.warehouses.alphaA,
      tab: "products",
      filters: newFilters(),
      locale: "en",
      pageSize: 20,
      ...args,
      ...(scanCursor ? { scanCursor } : {}),
    });
    log.push(reads);
    if (value.status !== "scanning") return value;
    expect(value.page).toEqual([]);
    scanCursor = value.scanCursor;
  }
  throw new Error("scan did not settle");
}

/** Follow Next until done; returns every page and each request's reads. */
async function traverse(
  world: ConvexTenantWorld,
  search: string,
  pageSize: 20 | 50 | 100 = 20,
) {
  const log: RequestReads[] = [];
  const pages: string[][] = [];
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < 50; pageNumber++) {
    const result = await settle(
      world,
      { search, pageSize, ...(cursor ? { cursor } : {}) },
      log,
    );
    expect(result.status).toBe("ready");
    expect(result.page.length).toBeLessThanOrEqual(pageSize);
    pages.push(result.page.map((row) => row._id));
    if (result.isDone) return { pages, rows: pages.flat(), log };
    cursor = result.continueCursor;
  }
  throw new Error("pages did not finish");
}

function expectBoundedRequests(log: RequestReads[]) {
  for (const reads of log) {
    expect(reads.paginate).toBeLessThanOrEqual(1);
    expect(
      reads.takes
        .filter((take) => take.table === "finishedGoodsPallets")
        .every((take) => take.limit <= 51),
    ).toBe(true);
    expect(reads.docs.finishedGoodsPallets ?? 0).toBeLessThanOrEqual(
      MAX_UNIT_DOCS_PER_REQUEST,
    );
    expect(reads.docs.finishedGoodsProducts ?? 0).toBeLessThanOrEqual(20);
  }
}

const filler = (count: number, from = 0): ProductSpec[] =>
  Array.from({ length: count }, (_, i) => ({
    name: `Filler ${from + i}`,
    units: [{}],
  }));
const units = (count: number, at: Record<number, UnitSpec> = {}) =>
  Array.from({ length: count }, (_, i) => at[i] ?? {});

describe("product search batches bounded unit probes", () => {
  it("continues both native split ranges while a large product waits for its unit pages", async () => {
    const { world, ids } = await seed([
      { name: "Large", units: units(120, { 115: { lot: "needle" } }) },
      { name: "Direct needle", units: [{}] },
    ]);
    const documents = await world.t.run(async (ctx) => ({
      products: await ctx.db.query("finishedGoodsProducts").collect(),
      units: (await ctx.db.query("finishedGoodsPallets").collect())
        .filter((row) => row.productId === ids[0])
        .sort((a, b) => b.updatedAt - a.updatedAt),
    }));
    const nativeCalls: Array<{
      table: string;
      cursor: unknown;
      endCursor: unknown;
    }> = [];
    const nativePage = (table: string, input: unknown) => {
      const options = input as { cursor: string | null; endCursor?: string };
      nativeCalls.push({
        table,
        cursor: options.cursor,
        endCursor: options.endCursor,
      });
      const product = table === "finishedGoodsProducts";
      const middle = product ? "product-middle" : "unit-middle";
      const end = product ? "product-end" : "unit-end";
      if (!options.cursor && !options.endCursor)
        return {
          page: [],
          isDone: false,
          continueCursor: end,
          splitCursor: middle,
          pageStatus: "SplitRequired",
        };
      if (!options.cursor && options.endCursor === middle)
        return {
          page: product
            ? documents.products.filter((row) => row._id === ids[0])
            : documents.units.slice(0, 50),
          isDone: true,
          continueCursor: middle,
        };
      expect(options).toMatchObject({ cursor: middle, endCursor: end });
      return {
        page: product
          ? documents.products.filter((row) => row._id === ids[1])
          : documents.units.slice(50),
        isDone: true,
        continueCursor: end,
      };
    };
    const log: RequestReads[] = [];
    let scanCursor: string | undefined;
    let result: Page | undefined;
    for (let step = 0; step < 10; step++) {
      const response = await request(
        world,
        {
          warehouseId: world.warehouses.alphaA,
          tab: "products",
          search: "needle",
          filters: newFilters(),
          locale: "en",
          pageSize: 20,
          ...(scanCursor ? { scanCursor } : {}),
        },
        nativePage,
      );
      result = response.value;
      log.push(response.reads);
      if (result.status !== "scanning") break;
      scanCursor = result.scanCursor;
    }
    expect(result?.status).toBe("ready");
    expect(result?.page.map((row) => row._id)).toEqual(ids);
    expect(nativeCalls.map(({ table }) => table)).toEqual([
      "finishedGoodsProducts",
      "finishedGoodsProducts",
      "finishedGoodsPallets",
      "finishedGoodsPallets",
      "finishedGoodsPallets",
      "finishedGoodsProducts",
    ]);
    expectBoundedRequests(log);
  });

  it("decides large-product continuation from raw rows, including a retired prefix", async () => {
    const retiredPrefix = Object.fromEntries(
      Array.from({ length: 60 }, (_, i) => [
        i,
        { lot: "ghost-needle", retired: true },
      ]),
    );
    const { world, ids } = await seed([
      ...filler(3),
      // 60 retired rows, then the live match at raw row 66.
      {
        name: "Retired prefix",
        units: units(70, { ...retiredPrefix, 65: { lot: "late-needle" } }),
      },
      ...filler(25, 3),
      // Exactly one page: the probe proves exhaustion.
      { name: "Fifty", units: units(50, { 49: { lot: "late-needle" } }) },
      // One raw row over a page; the probe's extra row holds the match.
      { name: "Fifty one", units: units(51, { 50: { lot: "late-needle" } }) },
      // Third native page, and only after a large non-matching product.
      { name: "Large miss", units: units(51) },
      {
        name: "Hundred one",
        units: units(101, { 100: { lot: "late-needle" } }),
      },
      // Every live row was retired: never matched by retired text.
      {
        name: "All retired",
        units: units(
          55,
          Object.fromEntries(
            Array.from({ length: 55 }, (_, i) => [
              i,
              { lot: "ghost-needle", retired: true },
            ]),
          ),
        ),
      },
      ...filler(5, 40),
    ]);
    const late = await traverse(world, "late-needle");
    expect(late.rows).toEqual([ids[3], ids[29], ids[30], ids[32]]);
    expect(late.rows).toEqual(await reference(world, "late-needle"));
    expectBoundedRequests(late.log);
    const ghost = await traverse(world, "ghost-needle");
    expect(ghost.rows).toEqual([]);
    expect(await reference(world, "ghost-needle")).toEqual([]);
    expectBoundedRequests(ghost.log);
  });

  it("matches substrings that cross name, unit, retired-row and native-page boundaries", async () => {
    const { world, ids } = await seed([
      // Crosses native unit pages 2 and 3 (raw rows 100 and 101), so the
      // text tail must survive a request boundary.
      {
        name: "Page boundary",
        units: units(120, {
          99: { lot: "tail-end" },
          100: { code: "head-start" },
        }),
      },
      // Crosses raw rows 50 and 51: inside the probe's extra row.
      {
        name: "Probe edge",
        units: units(60, {
          49: { lot: "tail-end" },
          50: { code: "head-start" },
        }),
      },
      ...filler(3),
      // Crosses inside one probe, skipping a retired row's text.
      {
        name: "Probe boundary",
        units: [
          { lot: "tail-end" },
          { code: "head-hidden", retired: true },
          { code: "head-start" },
        ],
      },
      // Crosses from name/SKU text into the first live unit.
      { name: "Prefix", sku: "SKU-TAIL-END", units: [{ code: "head-start" }] },
      // Each half alone, in different products, must not match.
      { name: "Half A", units: [{ lot: "tail-end" }] },
      { name: "Half B", units: [{ code: "head-start" }] },
      // Same halves split by the end of a product's text.
      {
        name: "Large split",
        units: units(60, { 59: { lot: "tail-end" } }),
      },
      { name: "Next head", units: [{ code: "head-start" }] },
      ...filler(20, 10),
    ]);
    const crossing = await traverse(world, "end head-st");
    expect(crossing.rows).toEqual([ids[0], ids[1], ids[5], ids[6]]);
    expect(crossing.rows).toEqual(await reference(world, "end head-st"));
    expectBoundedRequests(crossing.log);
    const retiredText = await traverse(world, "head-hidden");
    expect(retiredText.rows).toEqual([]);
  });

  it("keeps direct and descendant matches in source order across full pages", async () => {
    const products: ProductSpec[] = Array.from({ length: 70 }, (_, i) => {
      const kind = i % 7;
      if (kind === 0 || kind === 3) return { name: `Mix ${i}`, units: [{}] };
      if (kind === 1 || kind === 5)
        return { name: `Plain ${i}`, units: [{}, { lot: `MIX-${i}` }] };
      if (kind === 6)
        return {
          name: `Plain large ${i}`,
          units: units(55, { 53: { lot: "mixed" } }),
        };
      return { name: `Plain ${i}`, units: [{}, {}] };
    });
    const { world, ids } = await seed(products);
    const expected = await reference(world, "mix");
    expect(expected).toHaveLength(50);
    expect(expected).toEqual(
      ids.filter((_, i) => [0, 1, 3, 5, 6].includes(i % 7)),
    );
    const twenty = await traverse(world, "mix");
    expect(twenty.pages.map((page) => page.length)).toEqual([20, 20, 10]);
    expect(twenty.rows).toEqual(expected);
    expect(new Set(twenty.rows).size).toBe(twenty.rows.length);
    expectBoundedRequests(twenty.log);
    const fifty = await traverse(world, "mix", 50);
    expect(fifty.pages[0]).toHaveLength(50);
    expect(fifty.rows).toEqual(expected);
    expectBoundedRequests(fifty.log);
  });

  it("splits probe work by its row budget without skipping products", async () => {
    // 30 products × 45 raw rows: a full chunk of probes would read 1,350 rows.
    const products: ProductSpec[] = Array.from({ length: 30 }, (_, i) => ({
      name: `Medium ${i}`,
      units: units(45, i === 29 ? { 44: { lot: "deep-needle" } } : {}),
    }));
    const { world, ids } = await seed(products);
    const result = await traverse(world, "deep-needle");
    expect(result.rows).toEqual([ids[29]]);
    expectBoundedRequests(result.log);
    expect(result.log.length).toBeGreaterThan(2);
    expect(result.log.length).toBeLessThanOrEqual(4);
  });

  it("settles the audit's 105-product lot search in a few requests", async () => {
    const products: ProductSpec[] = Array.from({ length: 105 }, (_, i) => ({
      name: `Product ${104 - i}`,
      units: [{ lot: 104 - i === 2 ? "rare-late-match" : "normal" }],
    }));
    const { world, ids } = await seed(products);
    const log: RequestReads[] = [];
    const result = await settle(world, { search: "rare-late-match" }, log);
    expect(result.page.map((row) => row._id)).toEqual([ids[102]]);
    expect(log.length).toBeLessThanOrEqual(6);
    expectBoundedRequests(log);
  });

  it("resets a tampered search continuation instead of trusting it", async () => {
    const { world } = await seed(filler(45));
    const first = await request(world, {
      warehouseId: world.warehouses.alphaA,
      tab: "products",
      search: "absent",
      filters: newFilters(),
      locale: "en",
      pageSize: 20,
    });
    expect(first.value.status).toBe("scanning");
    const outer = JSON.parse(first.value.scanCursor!);
    const inner = JSON.parse(outer.raw);
    expect(inner.products).toEqual([]);
    inner.products = Array.from({ length: 101 }, () => "x");
    const tampered = await request(world, {
      warehouseId: world.warehouses.alphaA,
      tab: "products",
      search: "absent",
      filters: newFilters(),
      locale: "en",
      pageSize: 20,
      scanCursor: JSON.stringify({ ...outer, raw: JSON.stringify(inner) }),
    });
    expect(tampered.value.status).toBe("reset");
  });
});
