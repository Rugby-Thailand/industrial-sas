import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import type { DataModel } from "../../convex/schema";
import * as jobScans from "../../convex/finishedGoods/jobScans";
import { catalogueScope } from "../../convex/lib/cataloguePagination";
import { trackDocumentReads } from "../fixtures/document-reads";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";

type Runtime = {
  _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
};
type Item = {
  id: string;
  factoryOrder: string;
  buildingName?: string;
  floorNumber?: number;
};
type Page = {
  status: "ready" | "scanning" | "reset";
  items: Item[];
  isDone: boolean;
  continueCursor: string;
  scanCursor?: string;
  scanned: number;
};
type Request = {
  page: Page;
  /** Native index pages read: Convex allows one per query. */
  paginated: number[];
  /** Bounded non-continuation index reads (`take`). */
  taken: number[];
  gets: { table: string; id: string }[];
  /** Native `pageStatus` of each paginated read. */
  splits: (string | null)[];
};
const identityA = { subject: "user_fixture_a", org_id: "org_fixture_a" };
const identityB = { subject: "user_fixture_a", org_id: "org_fixture_b" };

async function setup() {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
  const parents = await world.t.run(async (ctx) => {
    const now = Date.now();
    const buildingId = await ctx.db.insert("storageBuildings", {
      orgId: world.orgA,
      warehouseId: world.warehouses.alphaA,
      code: "BLDG-N",
      name: "อาคารเหนือ North Annex",
      widthMm: 10000,
      depthMm: 10000,
      defaultFloorHeightMm: 3000,
      floorCount: 1,
      totalHeightMm: 3000,
      grossAreaSqMm: 100000000,
      reservedAreaSqMm: 0,
      usableAreaSqMm: 100000000,
      status: "ACTIVE",
      version: 1,
      createdAt: now,
      createdByUserId: world.userA,
      updatedAt: now,
      updatedByUserId: world.userA,
    });
    const floorId = await ctx.db.insert("storageFloors", {
      orgId: world.orgA,
      warehouseId: world.warehouses.alphaA,
      buildingId,
      floorNumber: 2,
      grossAreaSqMm: 100000000,
      reservedAreaSqMm: 0,
      usableAreaSqMm: 100000000,
      version: 1,
      updatedAt: now,
      updatedByUserId: world.userA,
    });
    return { buildingId, floorId };
  });
  return { world, ...parents };
}

type Seed = {
  factoryOrder: string;
  partName?: string;
  customer?: string;
  locationText?: string;
  locationCode?: string;
  locationName?: string;
  mapped?: boolean;
  building?: boolean;
};
/** Records are created oldest first: `createdAt` equals the seed index. */
async function seed(
  context: Awaited<ReturnType<typeof setup>>,
  rows: Seed[],
  options: {
    orgId?: Id<"organizations">;
    warehouseId?: Id<"warehouses">;
    start?: number;
    /** Large rows make the native 512 KiB read limit split a page. */
    rawBytes?: number;
  } = {},
) {
  const { world } = context;
  return await world.t.run(async (ctx) => {
    const ids: Id<"finishedGoodsJobScans">[] = [];
    for (const [index, row] of rows.entries())
      ids.push(
        await ctx.db.insert("finishedGoodsJobScans", {
          orgId: options.orgId ?? world.orgA,
          warehouseId: options.warehouseId ?? world.warehouses.alphaA,
          factoryOrder: row.factoryOrder,
          productBarcodeText: `BAR-${row.factoryOrder}`,
          ...(row.partName ? { partName: row.partName } : {}),
          ...(row.customer ? { customer: row.customer } : {}),
          source: "MANUAL",
          aiRaw: "x".repeat(options.rawBytes ?? 400),
          locationText: row.locationText ?? "Dock",
          ...(row.locationCode ? { locationCode: row.locationCode } : {}),
          ...(row.locationName ? { locationName: row.locationName } : {}),
          ...(row.building
            ? { buildingId: context.buildingId, floorId: context.floorId }
            : {}),
          mapped: row.mapped ?? false,
          createdAt: (options.start ?? 0) + index,
          createdByUserId: world.userA,
          updatedAt: (options.start ?? 0) + index,
          updatedByUserId: world.userA,
        }),
      );
    return ids;
  });
}

/**
 * One actual handler request. Current clients opt into `progressive`;
 * `legacy` omits it exactly as a frontend built before this change does.
 */
async function request(
  world: ConvexTenantWorld,
  args: Record<string, unknown>,
  identity = identityA,
  { legacy = false }: { legacy?: boolean } = {},
): Promise<Request> {
  const paginated: number[] = [];
  const taken: number[] = [];
  const splits: (string | null)[] = [];
  let gets: { table: string; id: string }[] = [];
  // Authorization lookups use other tables; count reads of saved records only.
  const wrap = (query: object, table: string): object =>
    new Proxy(query, {
      get(target, key, receiver) {
        const member = Reflect.get(target, key, receiver);
        if (typeof member !== "function") return member;
        return (...input: unknown[]) => {
          if (key === "paginate")
            paginated.push((input[0] as { numItems: number }).numItems);
          if (key === "take" && table === "finishedGoodsJobScans")
            taken.push(Number(input[0]));
          const result = Reflect.apply(member, target, input);
          if (key === "paginate")
            void (result as Promise<{ pageStatus?: string | null }>).then(
              (answer) => splits.push(answer.pageStatus ?? null),
            );
          return result &&
            typeof result === "object" &&
            !(result instanceof Promise)
            ? wrap(result, table)
            : result;
        };
      },
    });
  const outcome = (await world.t.withIdentity(identity).run(async (ctx) => {
    const tracked = trackDocumentReads(ctx.db);
    const db = new Proxy(tracked.db, {
      get(target, key, receiver) {
        const member = Reflect.get(target, key, receiver);
        if (key === "query")
          return (table: string) =>
            wrap(Reflect.apply(member, target, [table]), table);
        return typeof member === "function" ? member.bind(target) : member;
      },
    });
    const result = await (jobScans.listJobScans as unknown as Runtime)._handler(
      { ...ctx, db } as GenericMutationCtx<DataModel>,
      {
        warehouseId: world.warehouses.alphaA,
        filter: "ALL",
        ...(legacy ? {} : { progressive: true }),
        ...args,
      },
    );
    gets = tracked.reads;
    return result;
  })) as { ok: boolean; value: Page };
  expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
  return { page: outcome.value, paginated, taken, gets, splits };
}

/** One logical page: follow scan continuations exactly like the client. */
async function logicalPage(
  world: ConvexTenantWorld,
  args: Record<string, unknown>,
) {
  const requests: Request[] = [];
  let scanCursor: string | undefined;
  for (let step = 0; step < 200; step++) {
    const result = await request(world, {
      ...args,
      ...(scanCursor ? { scanCursor } : {}),
    });
    requests.push(result);
    if (result.page.status !== "scanning") return { ...result.page, requests };
    // Progress must be shown while scanning, and the page never overfills.
    expect(result.page.items.length).toBeLessThan(
      Number(args["pageSize"] ?? 20),
    );
    scanCursor = result.page.scanCursor;
  }
  throw new Error("scan did not settle");
}

async function traverse(
  world: ConvexTenantWorld,
  args: Record<string, unknown>,
) {
  const pages: Page[] = [];
  const requests: Request[] = [];
  let cursor: string | null = null;
  for (let index = 0; index < 200; index++) {
    const page = await logicalPage(world, {
      ...args,
      ...(cursor ? { cursor } : {}),
    });
    expect(page.status).toBe("ready");
    pages.push(page);
    requests.push(...page.requests);
    if (page.isDone) return { pages, requests };
    cursor = page.continueCursor;
  }
  throw new Error("traversal did not finish");
}

function expectBudget(requests: Request[]) {
  if (process.env["REPORT_READS"])
    console.log(
      "READS",
      expect.getState().currentTestName,
      JSON.stringify({
        requests: requests.length,
        paginateCalls: requests.reduce((n, r) => n + r.paginated.length, 0),
        indexRowsRequested: requests.reduce(
          (n, r) => n + r.paginated.reduce((a, b) => a + b, 0),
          0,
        ),
        maxGets: Math.max(...requests.map((r) => r.gets.length)),
        totalGets: requests.reduce((n, r) => n + r.gets.length, 0),
      }),
    );
  for (const { paginated, taken, gets } of requests) {
    // One native page of at most the adapter's 100-row maximum per request.
    expect(paginated.length).toBeLessThanOrEqual(1);
    expect(paginated.every((limit) => limit <= 100)).toBe(true);
    expect(taken).toEqual([]);
    // Re-read carried rows plus shared parents; never the history.
    expect(gets.length).toBeLessThanOrEqual(205);
  }
}

const newestFirst = (ids: readonly string[]) => [...ids].reverse();

describe("saved job scan pages", () => {
  it.each([20, 50, 100])(
    "traverses 121 records newest first at page size %i without gaps or duplicates",
    async (pageSize) => {
      const context = await setup();
      const ids = await seed(
        context,
        Array.from({ length: 121 }, (_, n) => ({ factoryOrder: `FO-${n}` })),
      );
      const { pages, requests } = await traverse(context.world, { pageSize });
      const seen = pages.flatMap((page) => page.items.map((item) => item.id));
      expect(seen).toEqual(newestFirst(ids));
      expect(pages.slice(0, -1).every((p) => p.items.length === pageSize)).toBe(
        true,
      );
      // Unfiltered pages read only what they show, plus one look-ahead row
      // that the next page re-reads by ID instead of re-reading the index.
      expect(requests).toHaveLength(Math.ceil(121 / pageSize));
      expect(requests[0]!.paginated).toEqual([Math.min(pageSize + 1, 100)]);
      for (const { paginated } of requests.slice(1))
        expect(paginated.every((limit) => limit <= pageSize)).toBe(true);
      expectBudget(requests);
    },
  );

  it("finds a selective match late in 1,000 records with bounded requests", async () => {
    const context = await setup();
    const ids = await seed(
      context,
      Array.from({ length: 1000 }, (_, n) => ({
        factoryOrder: `FO-${n}`,
        // Only the three oldest records match, in an interior substring.
        ...(n < 3 ? { partName: `TRAY xxNeeDLExx ${n}` } : {}),
      })),
    );
    const page = await logicalPage(context.world, {
      search: "needle",
      pageSize: 20,
    });
    expect(page).toMatchObject({ status: "ready", isDone: true });
    expect(page.items.map((item) => item.id)).toEqual(
      newestFirst(ids.slice(0, 3)),
    );
    // Ten bounded 100-row reads, never the 10,000-row collection.
    expect(page.requests).toHaveLength(10);
    expect(page.requests.flatMap((r) => r.paginated)).toEqual(
      Array(10).fill(100),
    );
    expect(page.scanned).toBe(1000);
    expectBudget(page.requests);
    // Scanning responses report progress without inventing a total.
    expect(page.requests[4]!.page).toMatchObject({
      status: "scanning",
      scanned: 500,
      items: [],
    });
  });

  it.each([20, 50, 100])(
    "traverses a sparse search across chunk boundaries at page size %i",
    async (pageSize) => {
      const context = await setup();
      const ids = await seed(
        context,
        Array.from({ length: 1000 }, (_, n) => ({
          factoryOrder: n % 7 === 3 ? `JOB-match-${n}` : `FO-${n}`,
        })),
      );
      const expected = newestFirst(ids.filter((_, n) => n % 7 === 3));
      const { pages, requests } = await traverse(context.world, {
        search: "MATCH",
        pageSize,
      });
      const seen = pages.flatMap((page) => page.items.map((item) => item.id));
      expect(seen).toEqual(expected);
      expect(new Set(seen).size).toBe(seen.length);
      expect(pages.slice(0, -1).every((p) => p.items.length === pageSize)).toBe(
        true,
      );
      expectBudget(requests);
      // Every history row is inspected about once, not once per page.
      expect(
        requests.reduce((sum, r) => sum + r.paginated.length, 0),
      ).toBeLessThanOrEqual(11);
    },
  );

  it("matches every displayed job and location field case-insensitively", async () => {
    const context = await setup();
    const [part, customer, text, code, name, building, other] = await seed(
      context,
      [
        { factoryOrder: "A-1", partName: "Inner Tray BXVMI004" },
        { factoryOrder: "A-2", customer: "บริษัท ฟาบริเนท จำกัด" },
        { factoryOrder: "A-3", locationText: "Dock door 7" },
        { factoryOrder: "A-4", locationCode: "F1-L30-16", mapped: true },
        { factoryOrder: "A-5", locationName: "ชั้นวางสีฟ้า", mapped: true },
        { factoryOrder: "A-6", building: true, mapped: true },
        { factoryOrder: "A-7" },
      ],
    );
    const search = async (text: string, filter = "ALL") =>
      (await logicalPage(context.world, { search: text, filter })).items.map(
        (item) => item.id,
      );
    expect(await search("bxvmi")).toEqual([part]);
    expect(await search("ฟาบริเนท")).toEqual([customer]);
    expect(await search("DOOR 7")).toEqual([text]);
    expect(await search(" l30-1 ")).toEqual([code]);
    expect(await search("สีฟ้า")).toEqual([name]);
    expect(await search("north annex")).toEqual([building]);
    expect(await search("a-7")).toEqual([other]);
    // Width-insensitive scanner input and filter scope apply together.
    expect(await search("Ｆ１-Ｌ３０")).toEqual([code]);
    expect(await search("a-", "UNMAPPED")).toEqual([
      other,
      text,
      customer,
      part,
    ]);
    expect(await search("a-", "MAPPED")).toEqual([building, name, code]);
    const shown = (await logicalPage(context.world, { search: "annex" }))
      .items[0]!;
    expect(shown).toMatchObject({
      buildingName: "อาคารเหนือ North Annex",
      floorNumber: 2,
    });
  });

  it("keeps a continuation stable when records are inserted or deleted", async () => {
    const context = await setup();
    const ids = await seed(
      context,
      Array.from({ length: 60 }, (_, n) => ({
        factoryOrder: n % 2 ? `HIT-${n}` : `FO-${n}`,
      })),
    );
    const hits = newestFirst(ids.filter((_, n) => n % 2));
    const first = await logicalPage(context.world, {
      search: "hit",
      pageSize: 20,
    });
    expect(first.items.map((item) => item.id)).toEqual(hits.slice(0, 20));
    // Newer matching records and deletions on both pages happen meanwhile.
    await seed(
      context,
      [{ factoryOrder: "HIT-new-1" }, { factoryOrder: "HIT-new-2" }],
      { start: 10_000 },
    );
    const deletedShown = hits[3]!;
    const deletedNext = hits[21]!;
    await context.world.t.run(async (ctx) => {
      await ctx.db.delete(deletedShown as Id<"finishedGoodsJobScans">);
      await ctx.db.delete(deletedNext as Id<"finishedGoodsJobScans">);
    });
    const second = await logicalPage(context.world, {
      search: "hit",
      pageSize: 20,
      cursor: first.continueCursor,
    });
    expect(second.items.map((item) => item.id)).toEqual(
      hits.slice(20).filter((id) => id !== deletedNext),
    );
    expect(second.isDone).toBe(true);
    // The live first page now starts with the new records.
    const refreshed = await logicalPage(context.world, {
      search: "hit",
      pageSize: 20,
    });
    expect(refreshed.items.slice(0, 2).map((i) => i.factoryOrder)).toEqual([
      "HIT-new-2",
      "HIT-new-1",
    ]);
    expect(refreshed.items.map((i) => i.id)).not.toContain(deletedShown);
  });

  it("re-evaluates carried rows instead of skipping a record edited to match", async () => {
    const context = await setup();
    const ids = await seed(
      context,
      Array.from({ length: 30 }, (_, n) => ({
        factoryOrder: n >= 5 ? `HIT-${n}` : `FO-${n}`,
      })),
    );
    const first = await logicalPage(context.world, {
      search: "hit",
      pageSize: 20,
    });
    expect(first.items).toHaveLength(20);
    // Record FO-4 is behind the native cursor, unread by the first page.
    await context.world.t.run((ctx) =>
      ctx.db.patch(ids[4]!, { locationText: "hit later" }),
    );
    const second = await logicalPage(context.world, {
      search: "hit",
      pageSize: 20,
      cursor: first.continueCursor,
    });
    expect(second.items.map((item) => item.id)).toEqual(
      newestFirst(ids.slice(4, 10)),
    );
  });

  it("refuses cursors from other criteria, sizes, actors and tenants", async () => {
    const context = await setup();
    await seed(
      context,
      Array.from({ length: 45 }, (_, n) => ({ factoryOrder: `HIT-${n}` })),
    );
    const first = await logicalPage(context.world, {
      search: "hit",
      pageSize: 20,
    });
    const cursor = first.continueCursor;
    for (const changed of [
      { search: "hit-1" },
      { filter: "UNMAPPED" },
      { pageSize: 50 },
      { search: "" },
    ])
      expect(
        (
          await request(context.world, {
            search: "hit",
            pageSize: 20,
            cursor,
            ...changed,
          })
        ).page,
      ).toMatchObject({ status: "reset", items: [] });
    for (const forged of [
      "20",
      "{",
      JSON.stringify({ v: 2 }),
      "x".repeat(5000),
    ])
      expect(
        (
          await request(context.world, {
            search: "hit",
            pageSize: 20,
            cursor: forged,
          })
        ).page.status,
      ).toBe("reset");
    expect(
      (
        await request(context.world, {
          search: "hit",
          pageSize: 20,
          scanCursor: cursor.replace('"scanned":0', '"scanned":-1'),
        })
      ).page.status,
    ).toBe("reset");
    // The same user in another organization cannot reuse organization A state.
    const foreign = await request(
      context.world,
      {
        warehouseId: context.world.warehouses.alphaB,
        search: "hit",
        pageSize: 20,
        cursor,
      },
      identityB,
    );
    expect(foreign.page).toMatchObject({ status: "reset", items: [] });
  });

  it("re-authorizes retained IDs even inside a well-formed cursor", async () => {
    const context = await setup();
    const [own] = await seed(context, [{ factoryOrder: "HIT-own" }]);
    const [otherWarehouse] = await seed(context, [{ factoryOrder: "HIT-b" }], {
      warehouseId: context.world.warehouses.bravoA,
    });
    const [otherTenant] = await seed(context, [{ factoryOrder: "HIT-t" }], {
      orgId: context.world.orgB,
      warehouseId: context.world.warehouses.alphaB,
    });
    // Forge a correctly scoped state by recomputing the server's scope.
    const scope = catalogueScope(
      {
        tenant: {
          organization: { _id: context.world.orgA },
          actor: { _id: context.world.userA },
        },
      } as never,
      [
        [
          "finishedGoodsJobScans",
          context.world.warehouses.alphaA,
          "ALL",
          "hit",
        ],
        20,
      ],
    );
    const forged = JSON.stringify({
      v: 2,
      k: "page",
      scope,
      range: {},
      ids: [],
      tail: [otherTenant, otherWarehouse, own],
      scanned: 0,
      exhausted: true,
    });
    const result = await request(context.world, {
      search: "hit",
      pageSize: 20,
      cursor: forged,
    });
    expect(result.page).toMatchObject({ status: "ready", isDone: true });
    expect(result.page.items.map((item) => item.id)).toEqual([own]);
  });

  it("treats the client retry attempt as identity only", async () => {
    const context = await setup();
    await seed(
      context,
      Array.from({ length: 30 }, (_, n) => ({ factoryOrder: `HIT-${n}` })),
    );
    const plain = await logicalPage(context.world, {
      search: "hit",
      pageSize: 20,
    });
    const retried = await logicalPage(context.world, {
      search: "hit",
      pageSize: 20,
      attempt: 3,
    });
    expect(retried.items).toEqual(plain.items);
    // A continuation cursor stays valid across retry attempts.
    const next = await logicalPage(context.world, {
      search: "hit",
      pageSize: 20,
      attempt: 4,
      cursor: plain.continueCursor,
    });
    expect(next.items).toHaveLength(10);
  });

  it("accepts the previous native cursor for unfiltered pages", async () => {
    const context = await setup();
    const ids = await seed(
      context,
      Array.from({ length: 5 }, (_, n) => ({ factoryOrder: `FO-${n}` })),
    );
    const native = await context.world.t.run(async (ctx) => {
      const page = await ctx.db
        .query("finishedGoodsJobScans")
        .withIndex("by_orgId_warehouseId_createdAt", (q) =>
          q
            .eq("orgId", context.world.orgA)
            .eq("warehouseId", context.world.warehouses.alphaA),
        )
        .order("desc")
        .paginate({ numItems: 2, cursor: null });
      return page.continueCursor;
    });
    const resumed = await request(context.world, {
      pageSize: 2,
      cursor: native,
    });
    expect(resumed.page.items.map((item) => item.id)).toEqual(
      newestFirst(ids).slice(2, 4),
    );
  });

  it("rejects malformed, duplicate and mismatched continuation state", async () => {
    const context = await setup();
    const ids = await seed(
      context,
      Array.from({ length: 30 }, (_, n) => ({ factoryOrder: `HIT-${n}` })),
    );
    const scope = catalogueScope(
      {
        tenant: {
          organization: { _id: context.world.orgA },
          actor: { _id: context.world.userA },
        },
      } as never,
      [
        [
          "finishedGoodsJobScans",
          context.world.warehouses.alphaA,
          "ALL",
          "hit",
        ],
        20,
      ],
    );
    const page = (fields: Record<string, unknown>) =>
      JSON.stringify({
        v: 2,
        k: "page",
        scope,
        range: {},
        ids: [],
        tail: [],
        scanned: 0,
        ...fields,
      });
    const [a, b] = [ids[29]!, ids[28]!];
    const refused = {
      "duplicate tail IDs": page({ tail: [a, a], exhausted: true }),
      "a page cursor carrying collected rows": page({ ids: [a], tail: [b] }),
      "an exhausted cursor with nothing left": page({ exhausted: true }),
      "a malformed ID": page({ tail: ["../x"], exhausted: true }),
      "a non-string ID": page({ tail: [7], exhausted: true }),
      "an oversized tail": page({
        tail: Array.from({ length: 129 }, (_, n) => `id${n}`),
      }),
      "a progress count on a page cursor": page({ scanned: 5 }),
      "a malformed native range": page({ range: { raw: 5 } }),
      "a scan state used as a page cursor": page({ k: "scan" }),
      "an older cursor version": page({ v: 1 }),
    };
    for (const [label, cursor] of Object.entries(refused)) {
      const result = await request(context.world, {
        search: "hit",
        pageSize: 20,
        cursor,
      });
      expect(result.page, label).toMatchObject({
        status: "reset",
        items: [],
        isDone: true,
      });
      // A refused cursor performs no history read.
      expect(result.paginated, label).toEqual([]);
    }
    const scan = (fields: Record<string, unknown>) =>
      JSON.stringify({
        v: 2,
        k: "scan",
        scope,
        range: {},
        ids: [],
        tail: [],
        scanned: 0,
        ...fields,
      });
    for (const [label, scanCursor] of Object.entries({
      "duplicate collected IDs": scan({ ids: [a, a] }),
      "a full page of collected IDs": scan({
        ids: ids.slice(0, 20),
      }),
      "a scan state with carried rows": scan({ tail: [a] }),
      "an exhausted scan state": scan({ exhausted: true }),
      "a page state used as a scan cursor": page({}),
    }))
      expect(
        (
          await request(context.world, {
            search: "hit",
            pageSize: 20,
            scanCursor,
          })
        ).page.status,
        label,
      ).toBe("reset");
    // Scan continuation is a progressive-protocol state only.
    expect(
      (
        await request(
          context.world,
          { search: "hit", pageSize: 20, scanCursor: scan({}) },
          identityA,
          { legacy: true },
        )
      ).page.status,
    ).toBe("reset");
    // The well-formed equivalent is accepted.
    expect(
      (
        await request(context.world, {
          search: "hit",
          pageSize: 20,
          cursor: page({ tail: [a, b], exhausted: true }),
        })
      ).page,
    ).toMatchObject({ status: "ready", isDone: true });
  });
});

describe("saved job scans for clients without scan continuation", () => {
  /** A frontend built before `progressive`: only items/continueCursor/isDone. */
  async function legacyTraverse(
    world: ConvexTenantWorld,
    args: Record<string, unknown>,
  ) {
    const shown: string[][] = [];
    const requests: Request[] = [];
    let cursor: string | null = null;
    for (let index = 0; index < 300; index++) {
      const result = await request(world, { ...args, cursor }, identityA, {
        legacy: true,
      });
      requests.push(result);
      // The legacy response never asks the caller to continue a page.
      expect(result.page.status).toBe("ready");
      expect(result.page).not.toHaveProperty("scanCursor");
      expect(result.page.items.length).toBeLessThanOrEqual(
        Number(args["pageSize"] ?? 20),
      );
      shown.push(result.page.items.map((item) => item.id));
      if (result.page.isDone) return { shown, requests };
      expect(result.page.continueCursor).not.toBe("");
      cursor = result.page.continueCursor;
    }
    throw new Error("legacy traversal did not finish");
  }

  it("shows each sparse match exactly once across short pages", async () => {
    const context = await setup();
    // The audit's case: 150 records, one match every 20, page size 20.
    const ids = await seed(
      context,
      Array.from({ length: 150 }, (_, n) => ({
        factoryOrder: n % 20 === 0 ? `HIT-${n}` : `FO-${n}`,
      })),
    );
    const { shown, requests } = await legacyTraverse(context.world, {
      search: "hit",
      pageSize: 20,
    });
    const flat = shown.flat();
    expect(flat).toEqual(newestFirst(ids.filter((_, n) => n % 20 === 0)));
    expect(new Set(flat).size).toBe(flat.length);
    expect(shown[0]).toHaveLength(5);
    expectBudget(requests);
  });

  it.each([20, 50, 100])(
    "traverses 1,000 records with a sparse search at page size %i",
    async (pageSize) => {
      const context = await setup();
      const ids = await seed(
        context,
        Array.from({ length: 1000 }, (_, n) => ({
          factoryOrder: n % 7 === 3 ? `JOB-match-${n}` : `FO-${n}`,
        })),
      );
      const { shown, requests } = await legacyTraverse(context.world, {
        search: "match",
        pageSize,
      });
      const flat = shown.flat();
      expect(flat).toEqual(newestFirst(ids.filter((_, n) => n % 7 === 3)));
      expect(new Set(flat).size).toBe(flat.length);
      expectBudget(requests);
    },
  );

  it("keeps unfiltered pages full and refuses an offset cursor without a dead Next", async () => {
    const context = await setup();
    const ids = await seed(
      context,
      Array.from({ length: 45 }, (_, n) => ({ factoryOrder: `FO-${n}` })),
    );
    const { shown } = await legacyTraverse(context.world, { pageSize: 20 });
    expect(shown.map((page) => page.length)).toEqual([20, 20, 5]);
    expect(shown.flat()).toEqual(newestFirst(ids));
    // A search page cursor from before this release was a numeric offset.
    const stale = await request(
      context.world,
      { search: "fo", pageSize: 20, cursor: "20" },
      identityA,
      { legacy: true },
    );
    expect(stale.page).toMatchObject({
      items: [],
      isDone: true,
      continueCursor: "",
    });
  });
});

describe("saved job scans across native read splits", () => {
  it.each([
    ["progressive", false],
    ["legacy", true],
  ] as const)(
    "recovers SplitRequired pages without loss or duplicates (%s)",
    async (_label, legacy) => {
      const context = await setup();
      // ~12 KiB rows: a 100-row read exceeds the adapter's 512 KiB budget.
      const ids = await seed(
        context,
        Array.from({ length: 260 }, (_, n) => ({
          factoryOrder: n % 3 ? `FO-${n}` : `HIT-${n}`,
        })),
        { rawBytes: 12_000 },
      );
      const seen: string[] = [];
      let cursor: string | null = null;
      const statuses: (string | null)[] = [];
      for (let step = 0; step < 400; step++) {
        let scanCursor: string | undefined;
        let result: Request;
        do {
          result = await request(
            context.world,
            {
              search: "hit",
              pageSize: 20,
              cursor,
              ...(scanCursor ? { scanCursor } : {}),
            },
            identityA,
            { legacy },
          );
          expect(result.paginated.length).toBeLessThanOrEqual(1);
          statuses.push(...result.splits);
          scanCursor =
            result.page.status === "scanning"
              ? result.page.scanCursor
              : undefined;
        } while (scanCursor);
        expect(result.page.status).toBe("ready");
        seen.push(...result.page.items.map((item) => item.id));
        if (result.page.isDone) break;
        cursor = result.page.continueCursor;
      }
      expect(seen).toEqual(newestFirst(ids.filter((_, n) => n % 3 === 0)));
      if (process.env["REPORT_READS"])
        console.log(
          "READS split",
          _label,
          JSON.stringify({
            nativeReads: statuses.length,
            splitRequired: statuses.filter((x) => x === "SplitRequired").length,
            matches: seen.length,
          }),
        );
      // The native reader really split ranges, including nested halves.
      expect(
        statuses.filter((status) => status === "SplitRequired").length,
      ).toBeGreaterThanOrEqual(2);
    },
  );
});
