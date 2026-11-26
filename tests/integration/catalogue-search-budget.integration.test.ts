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
type UnitSpec = {
  code?: string;
  lot?: string;
  retired?: boolean;
  retirementReason?: string;
  status?:
    "AWAITING_MEASUREMENT" | "AWAITING_PLACEMENT" | "RESERVED" | "STORED";
  updatedAt?: number;
};
type ProductSpec = {
  name: string;
  sku?: string;
  units: UnitSpec[];
  updatedAt?: number;
  customerReference?: string;
  linkCustomer?: boolean;
};
type RequestReads = {
  paginate: number;
  takes: Array<{ table: string; limit: number }>;
  docs: Record<string, number>;
};

/** Raw unit rows one request may read: probe budget plus one native page. */
const MAX_UNIT_DOCS_PER_REQUEST = 10 * 51 + 50;

/** Products are listed newest first; units are listed in index (desc) order. */
async function seed(
  products: ProductSpec[],
  options?: { roleA?: "ORG_ADMIN" | "WAREHOUSE_MANAGER" },
) {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, {
    roleA: options?.roleA ?? "ORG_ADMIN",
  });
  const ids = await world.t.run(async (ctx) => {
    const needsCustomer = products.some((spec) => spec.linkCustomer);
    const customerId = needsCustomer
      ? await ctx.db.insert("customers", {
          orgId: world.orgA,
          code: "CUST-0001",
          name: "Acme Customer",
          normalizedName: "acme customer",
          status: "ACTIVE",
          version: 1,
          createdAt: 1,
          updatedAt: 1,
          createdByUserId: world.userA,
          updatedByUserId: world.userA,
        })
      : undefined;
    const ids: string[] = [];
    for (let i = products.length - 1; i >= 0; i--) {
      const spec = products[i]!;
      const updatedAt = spec.updatedAt ?? products.length - i;
      const productId = await ctx.db.insert("finishedGoodsProducts", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        sku: spec.sku ?? `SKU-${String(i).padStart(4, "0")}`,
        name: spec.name,
        unit: "PCS",
        storageFormat: "PALLET",
        storageCondition: "ANY",
        status: "ACTIVE",
        ...(spec.customerReference !== undefined
          ? { customerReference: spec.customerReference }
          : {}),
        ...(spec.linkCustomer && customerId
          ? { customerId, customerLinkSource: "MANUAL" as const }
          : {}),
        createdAt: updatedAt,
        updatedAt,
        createdByUserId: world.userA,
        updatedByUserId: world.userA,
      });
      ids[i] = productId;
      for (let j = spec.units.length - 1; j >= 0; j--) {
        const unit = spec.units[j]!;
        const unitUpdatedAt = unit.updatedAt ?? spec.units.length - j;
        await ctx.db.insert("finishedGoodsPallets", {
          orgId: world.orgA,
          warehouseId: world.warehouses.alphaA,
          productId,
          code: unit.code ?? `U-${i}-${j}`,
          quantity: 1,
          lot: unit.lot ?? "plain",
          status: unit.status ?? "AWAITING_MEASUREMENT",
          ...(unit.retired
            ? {
                retiredAt: 1,
                ...(unit.retirementReason
                  ? { retirementReason: unit.retirementReason }
                  : {}),
              }
            : {}),
          createdAt: unitUpdatedAt,
          updatedAt: unitUpdatedAt,
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
          .filter(
            (unit) =>
              unit.retiredAt === undefined &&
              !["CANCELLED", "REPLACED"].includes(unit.status),
          )
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
  it("continues native product split ranges while a large product suspends mid-keyset unit scan", async () => {
    const { world, ids } = await seed([
      // 560 units exceeds one request's 510-row unit budget, forcing suspension
      // while the product native split range still has a pending right half.
      { name: "Large", units: units(560, { 555: { lot: "needle" } }) },
      { name: "Direct needle", units: [{}] },
    ]);
    const documents = await world.t.run(async (ctx) => ({
      products: await ctx.db.query("finishedGoodsProducts").collect(),
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
      expect(table).toBe("finishedGoodsProducts");
      const middle = "product-middle";
      const end = "product-end";
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
          page: documents.products.filter((row) => row._id === ids[0]),
          isDone: true,
          continueCursor: middle,
        };
      expect(options).toMatchObject({ cursor: middle, endCursor: end });
      return {
        page: documents.products.filter((row) => row._id === ids[1]),
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
      "finishedGoodsProducts",
    ]);
    expect(log.length).toBeGreaterThanOrEqual(3);
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
    // Allow fixture construction on shared CI workers; the assertions below
    // still enforce the document and continuation budgets.
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
  }, 30_000);

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

  it.each([
    { unitsPerProduct: 1, maxCalls: 6, maxTotalUnitDocs: 105 },
    { unitsPerProduct: 49, maxCalls: 15, maxTotalUnitDocs: 5_145 },
    { unitsPerProduct: 50, maxCalls: 15, maxTotalUnitDocs: 5_250 },
    { unitsPerProduct: 51, maxCalls: 25, maxTotalUnitDocs: 5_460 },
    { unitsPerProduct: 52, maxCalls: 25, maxTotalUnitDocs: 5_670 },
  ])(
    "keeps 105×$unitsPerProduct late-lot search within call and unit-doc budgets",
    async ({ unitsPerProduct, maxCalls, maxTotalUnitDocs }) => {
      const products: ProductSpec[] = Array.from({ length: 105 }, (_, i) => ({
        name: `Product ${i}`,
        units: units(
          unitsPerProduct,
          i === 104
            ? { [unitsPerProduct - 1]: { lot: "late-boundary-lot" } }
            : {},
        ),
      }));
      const { world, ids } = await seed(products);
      const log: RequestReads[] = [];
      const result = await settle(
        world,
        { search: "late-boundary-lot", pageSize: 20 },
        log,
      );
      const totalUnitDocs = log.reduce(
        (sum, entry) => sum + (entry.docs.finishedGoodsPallets ?? 0),
        0,
      );
      expect(result.status).toBe("ready");
      expect(result.page.map((row) => row._id)).toEqual([ids[104]]);
      expectBoundedRequests(log);
      expect(log.length).toBeLessThanOrEqual(maxCalls);
      expect(totalUnitDocs).toBeLessThanOrEqual(maxTotalUnitDocs);
    },
    30_000,
  );

  it("matches Thai text, equal timestamps, cancelled/replaced units, and deep boundary crossings against reference", async () => {
    const equalTsUnits = (
      count: number,
      at: Record<number, UnitSpec> = {},
      timestamp = 1_700_000_000_000,
    ) =>
      Array.from({ length: count }, (_, i) => ({
        updatedAt: timestamp,
        ...(at[i] ?? {}),
      }));
    const retiredPrefix = Object.fromEntries(
      Array.from({ length: 55 }, (_, i) => [
        i,
        {
          lot: "ghost-status-needle",
          retired: true,
          retirementReason:
            i % 2 === 0
              ? "Cancelled"
              : "Replaced by preparation batch revision 2",
        },
      ]),
    );
    const { world, ids } = await seed([
      // 125 units sharing one updatedAt: crosses 50→51 and 100→101 in descending _creationTime order.
      {
        name: "Equal ts cross 51",
        units: equalTsUnits(125, {
          50: { lot: "ท้าย-ขอบ" },
          51: { code: "หัว-ต่อ" },
        }),
      },
      {
        name: "Equal ts cross 101",
        units: equalTsUnits(125, {
          100: { lot: "ท้าย-ขอบ" },
          101: { code: "หัว-ต่อ" },
        }),
      },
      {
        name: "Equal ts deep last",
        units: equalTsUnits(125, { 124: { lot: "ล็อต-ลึก-พิเศษ" } }),
      },
      // Crosses from product SKU across 55 retired (cancelled/replaced) units into unit 55.
      {
        name: "Status skip cross",
        sku: "SKU-ท้าย-ขอบ",
        units: units(60, {
          ...retiredPrefix,
          55: { code: "หัว-ต่อ" },
        }),
      },
      // Only retired/cancelled/replaced units contain the needle: must not match.
      {
        name: "Only cancelled replaced",
        units: units(60, {
          ...retiredPrefix,
          56: { lot: "ghost-status-needle", retired: true },
        }),
      },
      // Thai product name + Thai lot across probe boundary.
      {
        name: "สินค้าไทย",
        units: units(55, { 54: { lot: "ล็อต-ลึก-พิเศษ" } }),
      },
      ...filler(10),
    ]);
    for (const query of [
      "ขอบ หัว-ต่อ",
      "ล็อต-ลึก-พิเศษ",
      "สินค้าไทย",
      "ghost-status-needle",
    ]) {
      const expected = await reference(world, query);
      for (const pageSize of [20, 50, 100] as const) {
        const result = await traverse(world, query, pageSize);
        expect(result.rows).toEqual(expected);
        expect(new Set(result.rows).size).toBe(result.rows.length);
        expectBoundedRequests(result.log);
      }
    }
    expect((await traverse(world, "ขอบ หัว-ต่อ")).rows).toEqual([
      ids[0],
      ids[1],
      ids[3],
    ]);
    expect((await traverse(world, "ghost-status-needle")).rows).toEqual([]);
  });

  it("preserves sorted search results across page sizes for large products", async () => {
    const products: ProductSpec[] = Array.from({ length: 26 }, (_, i) => ({
      name: `Sorted ${String(25 - i).padStart(2, "0")}`,
      units: units(
        i % 2 === 0 ? 55 : 2,
        i % 3 === 0 ? { [i % 2 === 0 ? 53 : 1]: { lot: "sort-hit" } } : {},
      ),
    }));
    const { world } = await seed(products);
    const expectedIds = await reference(world, "sort-hit");
    expect(expectedIds.length).toBeGreaterThan(5);
    for (const sort of [
      "name:asc",
      "name:desc",
      "quantity:asc",
      "quantity:desc",
    ]) {
      const log: RequestReads[] = [];
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let p = 0; p < 10; p++) {
        const res = await settle(
          world,
          {
            search: "sort-hit",
            pageSize: 20,
            filters: { ...newFilters(), sort },
            ...(cursor ? { cursor } : {}),
          },
          log,
        );
        expect(res.status).toBe("ready");
        seen.push(...res.page.map((row) => row._id));
        if (res.isDone) break;
        cursor = res.continueCursor;
      }
      expect(new Set(seen)).toEqual(new Set(expectedIds));
      expect(seen).toHaveLength(expectedIds.length);
      expectBoundedRequests(log);
    }
  });

  it("resets incompatible v2 cursors, malformed v3 cursors, cross-warehouse cursors, and concurrent product deletion cleanly", async () => {
    const products: ProductSpec[] = Array.from({ length: 45 }, (_, i) => ({
      name: `Compat ${i}`,
      units: units(55, i % 2 === 0 ? { 54: { lot: "compat-hit" } } : {}),
    }));
    const { world, ids } = await seed(products);
    const expected = await reference(world, "compat-hit");
    expect(expected).toHaveLength(23);

    // 1. Capture a real page-1 continueCursor and a mid-scan scanCursor.
    const firstScan = await request(world, {
      warehouseId: world.warehouses.alphaA,
      tab: "products",
      search: "compat-hit",
      filters: newFilters(),
      locale: "en",
      pageSize: 20,
    });
    expect(firstScan.value.status).toBe("scanning");
    const firstPage = await settle(
      world,
      { search: "compat-hit", pageSize: 20 },
      [],
    );
    expect(firstPage.status).toBe("ready");
    expect(firstPage.isDone).toBe(false);

    // 2. Simulate an old product-text-v2 cursor during deployment (both scanCursor and continueCursor).
    for (const [field, cursorStr] of [
      ["scanCursor", firstScan.value.scanCursor!],
      ["cursor", firstPage.continueCursor],
    ] as const) {
      const outer = JSON.parse(cursorStr);
      const inner = JSON.parse(outer.raw);
      const v2Scope = JSON.stringify([
        world.orgA,
        world.userA,
        ["product-text-v2", world.warehouses.alphaA, "compat-hit"],
      ]);
      const legacyInner = {
        scope: v2Scope,
        productRange: inner.productRange,
        products: inner.products,
        productsDone: inner.productsDone,
        unitRange: {},
      };
      const reset = await request(world, {
        warehouseId: world.warehouses.alphaA,
        tab: "products",
        search: "compat-hit",
        filters: newFilters(),
        locale: "en",
        pageSize: 20,
        [field]: JSON.stringify({ ...outer, raw: JSON.stringify(legacyInner) }),
      });
      expect(reset.value.status).toBe("reset");
    }

    // 3. Fresh traversal after reset has exact expected order with no gaps or duplicates.
    const fresh = await traverse(world, "compat-hit", 20);
    expect(fresh.rows).toEqual(expected);
    expect(new Set(fresh.rows).size).toBe(expected.length);

    // 4. Malformed v3 unitPos/tail cursors reset instead of trusting invalid state.
    const outerScan = JSON.parse(firstScan.value.scanCursor!);
    const innerScan = JSON.parse(outerScan.raw);
    for (const mutated of [
      { ...innerScan, products: [], unitPos: { u: 1, t: 1, i: "x" }, tail: "" },
      {
        ...innerScan,
        products: [ids[0]],
        unitPos: { u: 1, t: 1, i: "x" },
        tail: undefined,
      },
      {
        ...innerScan,
        products: [ids[0]],
        unitPos: { u: "bad", t: 1, i: "x" },
        tail: "",
      },
      { ...innerScan, unitRange: {} },
    ]) {
      const res = await request(world, {
        warehouseId: world.warehouses.alphaA,
        tab: "products",
        search: "compat-hit",
        filters: newFilters(),
        locale: "en",
        pageSize: 20,
        scanCursor: JSON.stringify({
          ...outerScan,
          raw: JSON.stringify(mutated),
        }),
      });
      expect(res.value.status).toBe("reset");
    }

    // 5. Cross-warehouse cursor resets when ORG_WIDE member switches warehouse.
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
    const crossWarehouse = await request(world, {
      warehouseId: world.warehouses.bravoA,
      tab: "products",
      search: "compat-hit",
      filters: newFilters(),
      locale: "en",
      pageSize: 20,
      cursor: firstPage.continueCursor,
    });
    expect(crossWarehouse.value.status).toBe("reset");

    // 6. Concurrent write mid-scan (generation advance) restarts cleanly and sees the live unit.
    const midScan = await request(world, {
      warehouseId: world.warehouses.alphaA,
      tab: "products",
      search: "midscan-added-lot",
      filters: newFilters(),
      locale: "en",
      pageSize: 20,
    });
    expect(midScan.value.status).toBe("scanning");
    await world.t.run(async (ctx) => {
      const targetUnit = await ctx.db
        .query("finishedGoodsPallets")
        .withIndex("by_orgId_warehouseId_productId_updatedAt", (q) =>
          q
            .eq("orgId", world.orgA)
            .eq("warehouseId", world.warehouses.alphaA)
            .eq("productId", ids[0] as never),
        )
        .order("desc")
        .first();
      await ctx.db.patch(targetUnit!._id, { lot: "midscan-added-lot" });
      await ctx.db.insert("finishedGoodsChangeShards", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        shard: 0,
        count: 1,
      });
    });
    const afterMidScanWrite = await settle(
      world,
      {
        search: "midscan-added-lot",
        pageSize: 20,
        scanCursor: midScan.value.scanCursor,
      },
      [],
    );
    expect(afterMidScanWrite.status).toBe("ready");
    expect(afterMidScanWrite.page.map((row) => row._id)).toEqual([ids[0]]);

    // 7. Concurrent deletion of a queued product resets cleanly on continuation.
    const nextQueuedId = JSON.parse(JSON.parse(firstPage.continueCursor).raw)
      .products[0] as string | undefined;
    expect(nextQueuedId).toBeTruthy();
    await world.t.run(async (ctx) => {
      await ctx.db.delete(nextQueuedId as never);
    });
    const afterDelete = await request(world, {
      warehouseId: world.warehouses.alphaA,
      tab: "products",
      search: "compat-hit",
      filters: newFilters(),
      locale: "en",
      pageSize: 20,
      cursor: firstPage.continueCursor,
    });
    expect(afterDelete.value.status).toBe("reset");
    const recovered = await traverse(world, "compat-hit", 20);
    expect(recovered.rows).toEqual(
      expected.filter((id) => id !== nextQueuedId),
    );
  });

  it("enforces customer field visibility on large-product search results", async () => {
    const spec: ProductSpec[] = [
      {
        name: "Linked product",
        customerReference: "CUST-REF-42",
        linkCustomer: true,
        units: units(55, { 54: { lot: "cust-vis-hit" } }),
      },
    ];
    const admin = await seed(spec, { roleA: "ORG_ADMIN" });
    const adminPage = await settle(admin.world, { search: "cust-vis-hit" }, []);
    expect(adminPage.page).toHaveLength(1);
    expect(adminPage.page[0]).toMatchObject({
      _id: admin.ids[0],
      customerReference: "CUST-REF-42",
      customerLinkSource: "MANUAL",
    });
    expect(
      (adminPage.page[0] as Record<string, unknown>).customerId,
    ).toBeTruthy();

    const manager = await seed(spec, { roleA: "WAREHOUSE_MANAGER" });
    const managerPage = await settle(
      manager.world,
      { search: "cust-vis-hit" },
      [],
    );
    expect(managerPage.page).toHaveLength(1);
    expect(managerPage.page[0]).toMatchObject({
      _id: manager.ids[0],
      customerReference: "CUST-REF-42",
    });
    expect(
      (managerPage.page[0] as Record<string, unknown>).customerId,
    ).toBeUndefined();
    expect(
      (managerPage.page[0] as Record<string, unknown>).customerLinkSource,
    ).toBeUndefined();
  });
});
