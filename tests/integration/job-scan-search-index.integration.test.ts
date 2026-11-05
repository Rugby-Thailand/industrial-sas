/**
 * Index-backed saved job-scan search (`convex/lib/jobScanSearch.ts`) against
 * the bounded scan it replaces, on one generated multilingual corpus of more
 * than 2,000 scans: same records, same newest-first order, same page
 * boundaries and exhaustion, for every needle and filter. Read and write
 * counts are convex-test measurements (documents through `ctx.db`), not
 * hosted billing units.
 */
import type { GenericMutationCtx } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type { DataModel } from "../../convex/schema";
import * as jobScans from "../../convex/finishedGoods/jobScans";
import * as backfill from "../../convex/finishedGoods/searchIndexBackfill";
import { RECONCILE_MARGIN_MS } from "../../convex/lib/searchReadiness";
import {
  jobScanTextMatches,
  normalizeJobScanSearch,
} from "../../convex/lib/jobScanSearch";
import { mutationWithOrg } from "../../convex/lib/tenantFunctions";
import { v } from "convex/values";
import {
  addStats,
  emptyStats,
  measured,
  type ReadStats,
} from "../fixtures/query-read-stats";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";

// convex-test scans every document on each index read, so these corpora are
// slow on a loaded machine; SEARCH_INDEX_TEST_TIMEOUT_MS raises the limit.
vi.setConfig({
  testTimeout: Number(process.env["SEARCH_INDEX_TEST_TIMEOUT_MS"] ?? 600_000),
});

type Runtime = {
  _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
};
type Item = { id: string };
type Page = {
  status: "ready" | "scanning" | "reset";
  items: Item[];
  isDone: boolean;
  continueCursor: string;
  scanCursor?: string;
};
type Filter = "ALL" | "MAPPED" | "UNMAPPED";
const identity = { subject: "user_fixture_a", org_id: "org_fixture_a" };

let seed = 11;
const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const pick = <T>(list: readonly T[]) =>
  list[Math.floor(random() * list.length)]!;
/** ASCII → fullwidth forms (NFKC folds them back). */
const fullwidth = (text: string) =>
  text.replace(/[!-~]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) + 0xfee0),
  );

const CUSTOMERS = [
  "บริษัท ฟาบริเนท จำกัด (สำนักงานใหญ่)",
  "Siam Packaging Co., Ltd.",
  "ＳＩＡＭ ＰＡＣＫ",
  "İstanbul Kargo",
  "Straße Logistik",
  "บริษัท สยามพาร์ท จำกัด",
  "Thai Metal Works",
  undefined,
] as const;
const PART_STEMS = [
  "VMI BOX TRAY",
  "CARTON A4",
  "DIVIDER 5x8",
  "ถาดพลาสติก",
  "กล่องกระดาษ ลูกฟูก",
  "ＬＡＹＥＲ ＰＡＤ",
] as const;
const FREE_TEXT = [
  "หน้าประตู 3 ฝั่งซ้าย",
  "Dock B overflow",
  "ข้างเสา C12",
  "  spaced   text  ",
  "ลานจอด ๒",
] as const;
const BUILDINGS = [
  ["BLDG-N", "อาคารเหนือ North Annex"],
  ["BLDG-A", "Building A"],
  ["BLDG-O", "คลังสำนักงาน"],
  ["BLDG-W", "ＷＩＤＥ Hall"],
  ["BLDG-D", "Dock Hall 2"],
  ["BLDG-T", "Annex-Tower"],
] as const;

const stamps = (world: ConvexTenantWorld) => ({
  createdAt: 1,
  updatedAt: 1,
  createdByUserId: world.userA,
  updatedByUserId: world.userA,
});

async function setup(count: number) {
  // The same corpus whichever tests run (a filtered run must reproduce it).
  seed = 11;
  const world = await createConvexTenantWorld({
    "../convex/finishedGoods/searchIndexBackfill.ts": () =>
      import("../../convex/finishedGoods/searchIndexBackfill"),
  });
  await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
  const warehouseId = world.warehouses.alphaA;
  const layout = await world.t.run(async (ctx) => {
    const zones: Doc<"storageZones">[] = [];
    const buildings: Id<"storageBuildings">[] = [];
    for (const [index, [code, name]] of BUILDINGS.entries()) {
      const buildingId = await ctx.db.insert("storageBuildings", {
        orgId: world.orgA,
        warehouseId,
        code,
        name,
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
        ...stamps(world),
      });
      buildings.push(buildingId);
      const floorId = await ctx.db.insert("storageFloors", {
        orgId: world.orgA,
        warehouseId,
        buildingId,
        floorNumber: 1,
        widthMm: 10000,
        depthMm: 10000,
        heightMm: 3000,
        grossAreaSqMm: 100000000,
        reservedAreaSqMm: 0,
        usableAreaSqMm: 100000000,
        version: 1,
        updatedAt: 1,
        updatedByUserId: world.userA,
      });
      for (let zone = 0; zone < 5; zone++) {
        const zoneCode = `${code}-F01-Z${String(zone + 1).padStart(2, "0")}`;
        const locationId = await ctx.db.insert("locations", {
          orgId: world.orgA,
          warehouseId,
          code: zoneCode,
          locationType: "FLOOR_BLOCK",
          status: "ACTIVE",
          buildingId,
          floorId,
        });
        const zoneId = await ctx.db.insert("storageZones", {
          orgId: world.orgA,
          warehouseId,
          buildingId,
          floorId,
          locationId,
          code: zoneCode,
          label: pick(["FG-1", "โซน ก", "Rack ＲＯ１", `Bay ${index}${zone}`]),
          qrValue: `ISAS:LOCATION:1:${locationId}`,
          xMm: 1000 * zone,
          yMm: 0,
          widthMm: 1000,
          depthMm: 1000,
          maxStackHeightMm: 3000,
          status: "ACTIVE",
          ...stamps(world),
        });
        zones.push((await ctx.db.get(zoneId))!);
      }
    }
    // Another warehouse of the same tenant, with the same texts.
    const foreignBuilding = await ctx.db.insert("storageBuildings", {
      orgId: world.orgA,
      warehouseId: world.warehouses.bravoA,
      code: "BLDG-A",
      name: "Building A",
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
      ...stamps(world),
    });
    return { zones, buildings, foreignBuilding };
  });
  const parts = Array.from(
    { length: 300 },
    (_, n) =>
      `${pick(PART_STEMS)} ${String(n * 7).padStart(4, "0")} Rev.0${n % 3}`,
  );
  const barcodes = Array.from(
    { length: 250 },
    (_, n) =>
      `${pick(["FBN", "TG", "ＦＢＮ", "SCALE"])}-${pick(["BXVMI", "CTN", "DIV"])}${String(n).padStart(3, "0")}-BOX-0${(n % 16).toString(16).toUpperCase()}`,
  );
  const factoryOrders: string[] = [];
  let createdAt = 1_000;
  let batchLeft = 0;
  const rows: Record<string, unknown>[] = [];
  for (let n = 0; n < count; n++) {
    if (batchLeft-- <= 0) {
      createdAt += 1 + Math.floor(random() * 5);
      batchLeft = Math.floor(random() * 50);
    }
    let factoryOrder = `FO69${String(100000 + n)}`;
    const roll = random();
    if (roll < 0.05 && factoryOrders.length) factoryOrder = pick(factoryOrders);
    else if (roll < 0.1) factoryOrder = `FOM${6900000 + n}`;
    else if (roll < 0.13) factoryOrder = fullwidth(factoryOrder);
    factoryOrders.push(factoryOrder);
    const mapped = random() < 0.4;
    const zone = pick(layout.zones);
    const legacyZoneOnly = mapped && random() < 0.3;
    const long = random() < 0.01;
    rows.push({
      orgId: world.orgA,
      warehouseId,
      factoryOrder,
      productBarcodeText: pick(barcodes),
      ...(random() < 0.9
        ? {
            partName: long
              ? `${pick(PART_STEMS)} ${"ยาวมาก-".repeat(90)}${n}`
              : random() < 0.1
                ? `${pick(PART_STEMS)} ล็อต ${n}`
                : pick(parts),
          }
        : {}),
      ...(pick(CUSTOMERS) ? { customer: pick(CUSTOMERS)! } : {}),
      source: "MANUAL",
      locationText: mapped ? zone.code : pick(FREE_TEXT),
      mapped,
      ...(mapped
        ? {
            locationCode: zone.code,
            locationName: zone.label,
            zoneId: zone._id,
            ...(legacyZoneOnly
              ? {}
              : { buildingId: zone.buildingId, floorId: zone.floorId }),
          }
        : {}),
      createdAt,
      createdByUserId: world.userA,
      updatedAt: createdAt,
      updatedByUserId: world.userA,
    });
  }
  for (let start = 0; start < rows.length; start += 250)
    await world.t.run(async (ctx) => {
      for (const row of rows.slice(start, start + 250))
        await ctx.db.insert(
          "finishedGoodsJobScans",
          row as Omit<Doc<"finishedGoodsJobScans">, "_id" | "_creationTime">,
        );
    });
  // The same texts in another warehouse must never be returned.
  await world.t.run(async (ctx) => {
    for (const row of rows.slice(0, 60))
      await ctx.db.insert("finishedGoodsJobScans", {
        ...(row as Omit<Doc<"finishedGoodsJobScans">, "_id" | "_creationTime">),
        warehouseId: world.warehouses.bravoA,
        ...(row["mapped"] ? { buildingId: layout.foreignBuilding } : {}),
      });
  });
  return { world, warehouseId, ...layout, parts, barcodes, factoryOrders };
}
type Fixture = Awaited<ReturnType<typeof setup>>;

// Only Date is faked: time moves when a test says so (`advance`), so rows
// can be placed before or after a build's watermark; timers stay real.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});
/** Let more than the reconcile margin pass. */
const advance = (ms = RECONCILE_MARGIN_MS + 1_000) =>
  vi.setSystemTime(Date.now() + ms);

async function runBackfill(fixture: Fixture, warehouseId?: Id<"warehouses">) {
  // The corpus was written well before the build (outside its margin).
  advance();
  let cursor: string | undefined;
  let runId: string | undefined;
  for (let step = 0; step < 1_000; step++) {
    const result = (await fixture.world.t.run((ctx) =>
      (backfill.run as unknown as Runtime)._handler(ctx, {
        warehouseId: warehouseId ?? fixture.warehouseId,
        kind: "jobScans",
        ...(cursor ? { cursor, runId } : { restart: true }),
        batchSize: 50,
      }),
    )) as {
      isDone: boolean;
      ready: boolean;
      continueCursor: string;
      runId: string;
    };
    if (result.isDone) return result;
    cursor = result.continueCursor;
    runId = result.runId;
  }
  throw new Error("backfill did not finish");
}

async function setReady(fixture: Fixture, ready: boolean) {
  await fixture.world.t.run(async (ctx) => {
    const row = await ctx.db
      .query("searchIndexReadiness")
      .withIndex("by_orgId_warehouseId_kind", (q) =>
        q
          .eq("orgId", fixture.world.orgA)
          .eq("warehouseId", fixture.warehouseId)
          .eq("kind", "jobScans"),
      )
      .unique();
    await ctx.db.patch(row!._id, { ready });
  });
}

/** Ground truth: the old predicate over every scan, newest first. */
/** Current scans and parents, read once per data state. */
async function snapshot(fixture: Fixture) {
  const data = await fixture.world.t.run(async (ctx) => {
    const scans = await ctx.db
      .query("finishedGoodsJobScans")
      .withIndex("by_orgId_warehouseId_createdAt", (q) =>
        q
          .eq("orgId", fixture.world.orgA)
          .eq("warehouseId", fixture.warehouseId),
      )
      .order("desc")
      .collect();
    const names: [string, string | null][] = [];
    for (const scan of scans) {
      const zone =
        !scan.buildingId && scan.zoneId ? await ctx.db.get(scan.zoneId) : null;
      const buildingId = scan.buildingId ?? zone?.buildingId;
      const building = buildingId ? await ctx.db.get(buildingId) : null;
      names.push([
        scan._id,
        building && building.warehouseId === fixture.warehouseId
          ? normalizeJobScanSearch(building.name)
          : null,
      ]);
    }
    return { scans, names };
  });
  return { scans: data.scans, names: new Map(data.names) };
}
type Snapshot = Awaited<ReturnType<typeof snapshot>>;

/** Ground truth: the scan path's predicate over every scan, newest first. */
function truthOf(data: Snapshot, needle: string, filter: Filter) {
  return data.scans
    .filter(
      (scan) =>
        (filter === "ALL" || scan.mapped === (filter === "MAPPED")) &&
        (jobScanTextMatches(scan, needle) ||
          Boolean(data.names.get(scan._id)?.includes(needle))),
    )
    .map((scan) => scan._id as string);
}
async function expected(fixture: Fixture, needle: string, filter: Filter) {
  return truthOf(await snapshot(fixture), needle, filter);
}

async function request(
  world: ConvexTenantWorld,
  args: Record<string, unknown>,
): Promise<{ page: Page; stats: ReadStats }> {
  const { value, stats } = await measured<Page>(world, jobScans.listJobScans, {
    progressive: true,
    ...args,
  });
  return { page: value, stats };
}

/** Every page, following scan continuations exactly like the client. */
async function traverse(
  fixture: Fixture,
  args: { search: string; filter: Filter; pageSize: number },
) {
  const pages: string[][] = [];
  const stats = emptyStats();
  let requests = 0;
  let cursor: string | undefined;
  for (let pageNo = 0; pageNo < 500; pageNo++) {
    let scanCursor: string | undefined;
    let page: Page;
    do {
      const result = await request(fixture.world, {
        warehouseId: fixture.warehouseId,
        ...args,
        ...(cursor ? { cursor } : {}),
        ...(scanCursor ? { scanCursor } : {}),
      });
      requests++;
      addStats(stats, result.stats);
      page = result.page;
      if (page.status === "scanning")
        expect(page.items.length).toBeLessThan(args.pageSize);
      scanCursor = page.scanCursor;
    } while (page.status === "scanning");
    expect(page.status).toBe("ready");
    pages.push(page.items.map((item) => item.id));
    if (page.isDone) return { pages, stats, requests };
    cursor = page.continueCursor;
  }
  throw new Error("traversal did not finish");
}
const docsRead = (stats: ReadStats) =>
  Object.values(stats.rangeDocs).reduce((a, b) => a + b, 0) +
  Object.values(stats.gets).reduce((a, b) => a + b, 0);
/** Non-empty pages: the scan may end with one empty `isDone` page. */
const filled = (pages: string[][]) => pages.filter((page) => page.length);
const chunk = (ids: string[], size: number) =>
  Array.from({ length: Math.ceil(ids.length / size) }, (_, index) =>
    ids.slice(index * size, (index + 1) * size),
  );

function needlesFor(fixture: Fixture, count: number) {
  const edge = [
    "-",
    "()",
    "fo6",
    "FO6910",
    "fo691000",
    "ＦＯ６９１０",
    "fom69",
    "0073",
    "1234",
    "box-0",
    "rev.01",
    "บริษัท",
    "ฟาบริ",
    "จำกัด (สำนัก",
    "สำนัก",
    "ข้างเสา",
    "เสา c1",
    "c12",
    "siam pack",
    "ｓｉａｍ",
    "istanbul",
    "İstanbul",
    "i̇stanbul",
    "straße",
    "strasse",
    "annex",
    "north annex",
    "building a",
    "อาคาร",
    "wide hall",
    "ＷＩＤＥ",
    "zzzz-no-match",
    "ไม่มีข้อมูล",
    "spaced   text",
    "ro1",
    "ยาวมาก-ยาว",
    "ล็อต 1",
    "lot",
    "๒",
  ];
  const values = [
    ...fixture.parts,
    ...fixture.barcodes,
    ...fixture.factoryOrders,
    ...CUSTOMERS.filter(Boolean),
    ...FREE_TEXT,
    ...BUILDINGS.map(([, name]) => name),
    ...fixture.zones.flatMap((zone) => [zone.code, zone.label]),
  ] as string[];
  const needles = new Set(edge);
  while (needles.size < edge.length + count) {
    const chars = [...pick(values)];
    const start = Math.floor(random() * chars.length);
    const length =
      3 +
      Math.floor(random() * Math.min(12, Math.max(1, chars.length - start)));
    let needle = chars.slice(start, start + length).join("");
    if (random() < 0.2) needle = needle.toUpperCase();
    if (random() < 0.1) needle = fullwidth(needle);
    needles.add(needle);
  }
  return [...needles];
}

/** Run scheduled re-index work to completion (real timers) and require success. */
async function drainScheduled(world: ConvexTenantWorld) {
  for (let round = 0; round < 100; round++) {
    await new Promise((resolve) => setTimeout(resolve, 2));
    await world.t.finishInProgressScheduledFunctions();
    const jobs = await world.t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(jobs.filter((job) => job.state.kind === "failed")).toEqual([]);
    if (
      jobs.every(
        (job) =>
          job.state.kind !== "pending" && job.state.kind !== "inProgress",
      )
    )
      return jobs.length;
  }
  throw new Error("scheduled work did not finish");
}

/** The warehouse's job-scan readiness row and layout counter. */
async function markers(fixture: Fixture) {
  return fixture.world.t.run(async (ctx) => {
    const row = await ctx.db
      .query("searchIndexReadiness")
      .withIndex("by_orgId_warehouseId_kind", (q) =>
        q
          .eq("orgId", fixture.world.orgA)
          .eq("warehouseId", fixture.warehouseId)
          .eq("kind", "jobScans"),
      )
      .unique();
    const signal = await ctx.db
      .query("storageCatalogueSignals")
      .withIndex("by_orgId_warehouseId", (q) =>
        q
          .eq("orgId", fixture.world.orgA)
          .eq("warehouseId", fixture.warehouseId),
      )
      .unique();
    return { row: row!, generation: signal?.generation ?? 0 };
  });
}

/** The reconcile cron's work for this warehouse, once the margin has passed. */
async function reconcileNow(fixture: Fixture) {
  advance();
  const result = (await fixture.world.t.run((ctx) =>
    (backfill.reconcile as unknown as Runtime)._handler(ctx, {
      warehouseId: fixture.warehouseId,
      kind: "jobScans",
    }),
  )) as { status: string; checked: number; reindexed: number };
  await drainScheduled(fixture.world);
  return result;
}

describe("index-backed job-scan search", () => {
  // convex-test evaluates every index read by iterating all documents, so the
  // exhaustive sweep uses a 900-scan corpus; the 2,200-scan corpus below
  // measures reads and re-checks parity for the needles it measures.
  it("answers every needle and filter exactly like the scan, page by page", async () => {
    const fixture = await setup(900);
    const built = await runBackfill(fixture);
    expect(built.ready).toBe(true);
    // SEARCH_PARITY_NEEDLES raises the random sample (reported runs: 110).
    const needles = needlesFor(
      fixture,
      Number(process.env["SEARCH_PARITY_NEEDLES"] ?? 70),
    );
    const data = await snapshot(fixture);
    let compared = 0;
    let mismatches = 0;
    for (const raw of needles) {
      const needle = normalizeJobScanSearch(raw);
      for (const filter of ["ALL", "MAPPED", "UNMAPPED"] as const) {
        if (filter !== "ALL" && random() < 0.6) continue;
        const truth = truthOf(data, needle, filter);
        // Very common needles: one filter, large pages (boundaries still checked).
        if (filter !== "ALL" && truth.length > 600) continue;
        const pageSize = truth.length > 300 ? 100 : 20;
        const indexed = await traverse(fixture, {
          search: raw,
          filter,
          pageSize,
        });
        compared++;
        const same =
          JSON.stringify(indexed.pages.flat()) === JSON.stringify(truth) &&
          JSON.stringify(filled(indexed.pages)) ===
            JSON.stringify(chunk(truth, pageSize));
        if (!same) {
          mismatches++;
          console.log("MISMATCH", JSON.stringify(raw), filter, {
            indexed: indexed.pages.flat().length,
            truth: truth.length,
          });
        }
      }
    }
    console.log(
      "PARITY",
      JSON.stringify({ needles: needles.length, compared, mismatches }),
    );
    expect(mismatches).toBe(0);

    // The unindexed scan, run on the same data, returns the same pages.
    const sample = needles.filter(
      (raw, index) =>
        index % 10 === 0 &&
        truthOf(data, normalizeJobScanSearch(raw), "ALL").length < 300,
    );
    for (const raw of sample) {
      const needle = normalizeJobScanSearch(raw);
      await setReady(fixture, false);
      const old = await traverse(fixture, {
        search: raw,
        filter: "ALL",
        pageSize: 50,
      });
      await setReady(fixture, true);
      const indexed = await traverse(fixture, {
        search: raw,
        filter: "ALL",
        pageSize: 50,
      });
      expect(filled(indexed.pages), raw).toEqual(filled(old.pages));
      expect(indexed.pages.flat()).toEqual(truthOf(data, needle, "ALL"));
    }
  });

  it("reads in proportion to matches for rare needles, not to history", async () => {
    const fixture = await setup(2_200);
    await runBackfill(fixture);
    const report: Record<string, unknown> = {};
    const cases = [
      ["rare (one job number)", fixture.factoryOrders[1_234]!],
      ["medium fragment", "FO691012"],
      ["rare Thai (lot)", "ล็อต 77"],
      ["common customer", "บริษัท"],
      ["common stem", "box-0"],
      ["building name", "north annex"],
      ["miss", "zzzz-no-match"],
      ["short (scan path)", "c1"],
    ] as const;
    for (const [label, search] of cases) {
      const truth = await expected(
        fixture,
        normalizeJobScanSearch(search),
        "ALL",
      );
      const first = (async () => {
        const pages: Page[] = [];
        const stats = emptyStats();
        let scanCursor: string | undefined;
        let requests = 0;
        for (;;) {
          const result = await request(fixture.world, {
            warehouseId: fixture.warehouseId,
            filter: "ALL",
            search,
            pageSize: 50,
            ...(scanCursor ? { scanCursor } : {}),
          });
          requests++;
          addStats(stats, result.stats);
          pages.push(result.page);
          if (result.page.status !== "scanning")
            return { page: result.page, stats, requests };
          scanCursor = result.page.scanCursor;
        }
      })();
      const indexed = await first;
      await setReady(fixture, false);
      const before = await (async () => {
        const stats = emptyStats();
        let scanCursor: string | undefined;
        let requests = 0;
        for (;;) {
          const result = await request(fixture.world, {
            warehouseId: fixture.warehouseId,
            filter: "ALL",
            search,
            pageSize: 50,
            ...(scanCursor ? { scanCursor } : {}),
          });
          requests++;
          addStats(stats, result.stats);
          if (result.page.status !== "scanning")
            return { page: result.page, stats, requests };
          scanCursor = result.page.scanCursor;
        }
      })();
      await setReady(fixture, true);
      expect(indexed.page.items.map((item) => item.id)).toEqual(
        truth.slice(0, 50),
      );
      expect(before.page.items.map((item) => item.id)).toEqual(
        truth.slice(0, 50),
      );
      report[label] = {
        matches: truth.length,
        indexed: { docs: docsRead(indexed.stats), requests: indexed.requests },
        scan: { docs: docsRead(before.stats), requests: before.requests },
      };
    }
    console.log("READS", JSON.stringify(report, null, 1));
    const reads = (label: string) =>
      (report[label] as { indexed: { docs: number; requests: number } })
        .indexed;
    // Rare needles: matches plus a constant set by the probe sizes, where
    // the scan reads all 2,200 records over 22 requests. The constant is at
    // most 6 term-gram probes of 17 rows, 6 scan-gram probes of 8 rows, the
    // unposted rows, readiness and ~15 authorization reads.
    const scanned = (label: string) =>
      (report[label] as { scan: { docs: number } }).scan.docs;
    for (const label of ["rare (one job number)", "rare Thai (lot)", "miss"]) {
      expect(reads(label).requests).toBe(1);
      expect(reads(label).docs).toBeLessThanOrEqual(
        (report[label] as { matches: number }).matches + 200,
      );
      expect(reads(label).docs).toBeLessThan(scanned(label) / 10);
    }
    // Other needles fill one 50-row page in one request, from postings,
    // matching terms' streams or (densest) the history itself.
    for (const label of [
      "medium fragment",
      "common customer",
      "common stem",
      "building name",
    ]) {
      expect(reads(label).requests).toBe(1);
      expect(reads(label).docs).toBeLessThanOrEqual(320);
    }
  });

  it("keeps the index exact through saves, corrections, remaps, deletes and building renames", async () => {
    const fixture = await setup(400);
    await runBackfill(fixture);
    const { world, warehouseId } = fixture;
    const call = (fn: unknown, args: unknown) =>
      world.t
        .withIdentity(identity)
        .run((ctx) =>
          (fn as Runtime)._handler(ctx as GenericMutationCtx<DataModel>, args),
        ) as Promise<{ ok: boolean; value: Record<string, unknown> }>;
    const writes = async (fn: unknown, args: unknown) => {
      const counts: Record<string, number> = {};
      const result = (await world.t.withIdentity(identity).run(async (ctx) => {
        const db = new Proxy(ctx.db, {
          get(target, key, receiver) {
            const member = Reflect.get(target, key, receiver);
            if (["insert", "patch", "replace", "delete"].includes(String(key)))
              return (...input: unknown[]) => {
                const table =
                  typeof input[0] === "string" && !input[0].includes(";")
                    ? input[0]
                    : "(id)";
                counts[table] = (counts[table] ?? 0) + 1;
                return Reflect.apply(member, target, input);
              };
            return typeof member === "function" ? member.bind(target) : member;
          },
        });
        return (fn as Runtime)._handler(
          { ...ctx, db } as GenericMutationCtx<DataModel>,
          args,
        );
      })) as { ok: boolean; value: Record<string, unknown> };
      expect(result.ok, JSON.stringify(result)).toBe(true);
      const derived = Object.entries(counts)
        .filter(([table]) =>
          /^(finishedGoodsJobScan(SearchRows|Terms|TermGrams|Grams)|locationSearchGrams)$/.test(
            table,
          ),
        )
        .reduce((sum, [, n]) => sum + n, 0);
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      return { result, counts, derived, base: total - derived, total };
    };
    const zone = fixture.zones[0]!;
    const ticket = (n: number) => ({
      factoryOrder: `FO6999${String(n).padStart(4, "0")}`,
      productBarcodeText: pick(fixture.barcodes),
      partName: pick(fixture.parts),
      customer: "บริษัท ฟาบริเนท จำกัด (สำนักงานใหญ่)",
      source: "MANUAL" as const,
    });
    const one = await writes(jobScans.saveJobScans, {
      warehouseId,
      requestId: "save-one",
      locationText: "ข้างเสา Q77",
      items: [ticket(1)],
    });
    const fifty = await writes(jobScans.saveJobScans, {
      warehouseId,
      requestId: "save-fifty",
      locationText: "",
      location: { zoneId: zone._id },
      items: Array.from({ length: 50 }, (_, n) => ticket(100 + n)),
    });
    // Worst case the validators accept: 50 tickets with long unique texts.
    const worst = await writes(jobScans.saveJobScans, {
      warehouseId,
      requestId: "save-worst",
      locationText: `ที่วาง ${"พิเศษ".repeat(38)}`,
      items: Array.from({ length: 50 }, (_, n) => ({
        factoryOrder: `FOX${n}-${"ก".repeat(90)}`,
        productBarcodeText: `BX${n}-${"ข".repeat(190)}`,
        partName: `PART ${n} ${"ค".repeat(300)}`,
        customer: `CUST ${n} ${"ง".repeat(300)}`,
        source: "MANUAL" as const,
      })),
    });
    console.log(
      "WRITES",
      JSON.stringify({
        oneItem: { base: one.base, derived: one.derived, total: one.total },
        fiftyItems: {
          base: fifty.base,
          derived: fifty.derived,
          total: fifty.total,
        },
        fiftyLongUnique: {
          base: worst.base,
          derived: worst.derived,
          total: worst.total,
        },
      }),
    );
    // Bounded by the per-transaction budget: postings ≤ 1,500, plus one
    // search row, one unposted row and at most 7 terms per scan.
    for (const save of [fifty, worst])
      expect(save.derived).toBeLessThanOrEqual(1_500 + 50 * 9);

    const check = async (raw: string) => {
      const needle = normalizeJobScanSearch(raw);
      for (const filter of ["ALL", "MAPPED", "UNMAPPED"] as const) {
        const indexed = await traverse(fixture, {
          search: raw,
          filter,
          pageSize: 20,
        });
        expect(indexed.pages.flat(), `${raw} ${filter}`).toEqual(
          await expected(fixture, needle, filter),
        );
      }
    };
    for (const raw of [
      "FO6999",
      "q77",
      "บริษัท ฟาบริ",
      "FOX4",
      "ขขขข",
      "พิเศษพิเศษ",
    ])
      await check(raw);

    // A correction changes ticket text in place.
    const saved = await world.t.run((ctx) =>
      ctx.db
        .query("finishedGoodsJobScans")
        .withIndex("by_orgId_warehouseId_createdAt", (q) =>
          q.eq("orgId", world.orgA).eq("warehouseId", warehouseId),
        )
        .order("desc")
        .take(120),
    );
    const target = saved.find((scan) => scan.factoryOrder === "FO69990100")!;
    expect(
      (
        await call(jobScans.updateJobScan, {
          warehouseId,
          jobScanId: target._id,
          requestId: "correct-1",
          expectedVersion: target.version ?? 1,
          fields: {
            factoryOrder: "FO-CORRECTED-7788",
            productBarcodeText: "ใหม่-บาร์โค้ด-123",
            partName: "ชิ้นส่วนที่แก้ไข",
          },
        })
      ).ok,
    ).toBe(true);
    for (const raw of [
      "corrected-77",
      "FO69990100",
      "ใหม่-บาร์",
      "แก้ไข",
      "บริษัท ฟาบริ",
    ])
      await check(raw);

    // A remap of many tickets changes location text, building and filter.
    const remapped = saved
      .filter((scan) => scan.locationText === "ข้างเสา Q77" || scan.mapped)
      .slice(0, 60);
    const other = fixture.zones[17]!;
    const remap = await writes(jobScans.assignJobScanLocation, {
      warehouseId,
      requestId: "remap-60",
      ids: remapped.map((scan) => scan._id),
      location: { zoneId: other._id },
    });
    console.log(
      "WRITES remap 60",
      JSON.stringify({ base: remap.base, derived: remap.derived }),
    );
    for (const raw of [
      other.code,
      zone.code,
      "q77",
      other.label,
      "annex",
      "building a",
    ])
      await check(raw);

    // Deletes remove records from every stream.
    const removed = saved.slice(0, 30).map((scan) => scan._id);
    const deleted = await writes(jobScans.deleteJobScans, {
      warehouseId,
      requestId: "delete-30",
      ids: removed,
    });
    console.log(
      "WRITES delete 30",
      JSON.stringify({ base: deleted.base, derived: deleted.derived }),
    );
    for (const raw of ["FO6999", "บริษัท", "FOX4"]) await check(raw);

    // A building rename re-posts the building name through the tracked write.
    const rename = mutationWithOrg({
      args: {
        warehouseId: v.id("warehouses"),
        buildingId: v.id("storageBuildings"),
        name: v.string(),
      },
      permissionCode: "masterData.storageLayout.manage",
      target: { table: "storageBuildings" },
      warehouseId: (args) => args.warehouseId,
      handler: async (ctx, args) => {
        await ctx.tenantDb.patch("storageBuildings", args.buildingId, {
          name: args.name,
        });
        return null;
      },
    });
    expect(
      (
        await call(rename, {
          warehouseId,
          buildingId: fixture.buildings[0],
          name: "Südflügel ห้องเย็น",
        })
      ).ok,
    ).toBe(true);
    for (const raw of ["north annex", "südflügel", "ห้องเย็น", "annex"])
      await check(raw);

    // Deferred work (the worst-case save) is re-indexed by the scheduled job.
    await drainScheduled(world);
    for (const raw of ["FOX4", "ขขขข", "CUST 1"]) await check(raw);
  });

  it("collects terms no scan links any more, so dead values cannot force a history search", async () => {
    const fixture = await setup(200);
    await runBackfill(fixture);
    const { world, warehouseId } = fixture;
    const call = async (fn: unknown, args: unknown) => {
      const result = (await world.t
        .withIdentity(identity)
        .run((ctx) =>
          (fn as Runtime)._handler(ctx as GenericMutationCtx<DataModel>, args),
        )) as { ok: boolean; value: unknown };
      expect(result.ok, JSON.stringify(result)).toBe(true);
      // Business refusals are values: never let one pass as a write.
      expect(
        (result.value as { error?: unknown } | null)?.error,
        JSON.stringify(result.value),
      ).toBeUndefined();
      return result.value;
    };
    // 49 customers (more than the 48 shared streams a search merges), each
    // linked by 9 scans so it is shared, then every one of them deleted.
    const CUSTOMERS_N = 49;
    for (let round = 0; round < 9; round++)
      await call(jobScans.saveJobScans, {
        warehouseId,
        requestId: `obsolete-${round}`,
        locationText: "ข้างเสา Z1",
        items: Array.from({ length: CUSTOMERS_N }, (_, i) => ({
          factoryOrder: `FO6988${String(round * 100 + i).padStart(4, "0")}`,
          productBarcodeText: `OBS-${round}-${i}`,
          customer: `obsolete-customer-${String(i).padStart(2, "0")}`,
          source: "MANUAL" as const,
        })),
      });
    await drainScheduled(world);
    const terms = () =>
      world.t.run(async (ctx) => ({
        terms: (await ctx.db.query("finishedGoodsJobScanTerms").collect())
          .filter((term) => term.text.includes("obsolete-customer"))
          .map((term) => term.shared),
        grams: (
          await ctx.db.query("finishedGoodsJobScanTermGrams").collect()
        ).filter((gram) => gram.text.includes("obsolete-customer")).length,
      }));
    const live = await terms();
    expect(live.terms).toHaveLength(CUSTOMERS_N);
    expect(live.terms.every(Boolean)).toBe(true);
    expect(live.grams).toBeGreaterThan(0);
    const saved = await world.t.run((ctx) =>
      ctx.db
        .query("finishedGoodsJobScans")
        .collect()
        .then((rows) =>
          rows
            .filter((row) => row.productBarcodeText?.startsWith("OBS-"))
            .map((row) => row._id),
        ),
    );
    expect(saved).toHaveLength(9 * CUSTOMERS_N);
    for (let start = 0; start < saved.length; start += 50)
      await call(jobScans.deleteJobScans, {
        warehouseId,
        requestId: `obsolete-delete-${start}`,
        ids: saved.slice(start, start + 50),
      });
    await drainScheduled(world);
    expect(await terms()).toEqual({ terms: [], grams: 0 });
    // A search for the dead values reads postings, not history.
    const dead = await traverse(fixture, {
      search: "obsolete-customer",
      filter: "ALL",
      pageSize: 50,
    });
    expect(filled(dead.pages)).toEqual([]);
    expect(dead.requests).toBe(1);
    expect(docsRead(dead.stats)).toBeLessThan(200);

    // An edit that moves every scan off a shared value releases it too.
    await call(jobScans.saveJobScans, {
      warehouseId,
      requestId: "edited-away",
      locationText: "ข้างเสา Z1",
      items: Array.from({ length: 9 }, (_, i) => ({
        factoryOrder: `FO6989${String(i).padStart(4, "0")}`,
        productBarcodeText: `EDIT-${i}`,
        customer: "edited-away-customer",
        source: "MANUAL" as const,
      })),
    });
    const edited = await world.t.run((ctx) =>
      ctx.db
        .query("finishedGoodsJobScans")
        .collect()
        .then((rows) =>
          rows.filter((row) => row.productBarcodeText?.startsWith("EDIT-")),
        ),
    );
    for (const scan of edited)
      await call(jobScans.updateJobScan, {
        warehouseId,
        jobScanId: scan._id,
        requestId: `edit-${scan._id}`,
        expectedVersion: scan.version ?? 1,
        fields: {
          factoryOrder: scan.factoryOrder,
          productBarcodeText: scan.productBarcodeText,
          customer: "kept-customer",
        },
      });
    await drainScheduled(world);
    expect(
      (
        await world.t.run((ctx) =>
          ctx.db.query("finishedGoodsJobScanTerms").collect(),
        )
      ).filter((term) => term.text.includes("edited-away")),
    ).toEqual([]);
    const kept = await traverse(fixture, {
      search: "kept-customer",
      filter: "ALL",
      pageSize: 50,
    });
    expect(filled(kept.pages).flat().sort()).toEqual(
      edited.map((scan) => scan._id as string).sort(),
    );
  });

  it("stays exact through writes that bypass maintenance, then reconciles them", async () => {
    const fixture = await setup(300);
    await runBackfill(fixture);
    const { world, warehouseId } = fixture;
    const before = await markers(fixture);
    const recent = await world.t.run((ctx) =>
      ctx.db
        .query("finishedGoodsJobScans")
        .withIndex("by_orgId_warehouseId_createdAt", (q) =>
          q.eq("orgId", world.orgA).eq("warehouseId", warehouseId),
        )
        .order("desc")
        .take(40),
    );
    const corrected = recent[5]!;
    const removed = recent[7]!;
    const renamed = fixture.buildings[1]!;
    // What code without the index does (main after a rollback): saves and
    // corrections stamp `updatedAt`, a staging seed backdates its rows and
    // inserts a building raw (no layout counter), a delete, and a building
    // rename through its tracked writer, which bumps the layout counter but
    // knows nothing of the search markers.
    const now = Date.now();
    const seeded = await world.t.run(async (ctx) => {
      const buildingId = await ctx.db.insert("storageBuildings", {
        orgId: world.orgA,
        warehouseId,
        code: "BLDG-SEED",
        name: "Seed Annex อาคารเมล็ด",
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
        warehouseId,
        buildingId,
        floorNumber: 1,
        widthMm: 10000,
        depthMm: 10000,
        heightMm: 3000,
        grossAreaSqMm: 100000000,
        reservedAreaSqMm: 0,
        usableAreaSqMm: 100000000,
        version: 1,
        updatedAt: now,
        updatedByUserId: world.userA,
      });
      const locationId = await ctx.db.insert("locations", {
        orgId: world.orgA,
        warehouseId,
        code: "BLDG-SEED-Z01",
        locationType: "FLOOR_BLOCK",
        status: "ACTIVE",
        buildingId,
        floorId,
      });
      return ctx.db.insert("storageZones", {
        orgId: world.orgA,
        warehouseId,
        buildingId,
        floorId,
        locationId,
        code: "BLDG-SEED-Z01",
        label: "Z01",
        qrValue: `ISAS:LOCATION:1:${locationId}`,
        xMm: 0,
        yMm: 0,
        widthMm: 1000,
        depthMm: 1000,
        maxStackHeightMm: 3000,
        status: "ACTIVE",
        createdAt: now,
        createdByUserId: world.userA,
        updatedAt: now,
        updatedByUserId: world.userA,
      });
    });
    await world.t.run(async (ctx) => {
      const base = {
        orgId: world.orgA,
        warehouseId,
        productBarcodeText: "LEGACY-BX-77",
        source: "MANUAL" as const,
        locationText: "ข้างเสา L1",
        mapped: false,
        createdByUserId: world.userA,
        updatedByUserId: world.userA,
      };
      await ctx.db.insert("finishedGoodsJobScans", {
        ...base,
        factoryOrder: "FO-LEGACY-NEW-01",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("finishedGoodsJobScans", {
        ...base,
        factoryOrder: "FO-LEGACY-OLD-02",
        partName: "ชิ้นงานย้อนหลัง",
        createdAt: 1_500,
        updatedAt: 1_500,
      });
      await ctx.db.patch(corrected._id, {
        factoryOrder: "FO-LEGACY-FIX-03",
        customer: "ลูกค้าแก้ไขเก่า",
        updatedAt: Math.max(now, corrected.updatedAt + 1),
      });
      await ctx.db.delete(removed._id);
      await ctx.db.patch(renamed, { name: "Legacy Hall ห้องเก่า" });
      const signal = await ctx.db
        .query("storageCatalogueSignals")
        .withIndex("by_orgId_warehouseId", (q) =>
          q.eq("orgId", world.orgA).eq("warehouseId", warehouseId),
        )
        .unique();
      if (signal)
        await ctx.db.patch(signal._id, { generation: signal.generation + 1 });
      else
        await ctx.db.insert("storageCatalogueSignals", {
          orgId: world.orgA,
          warehouseId,
          generation: 1,
        });
    });
    const call = async (fn: unknown, args: unknown) => {
      const result = (await world.t
        .withIdentity(identity)
        .run((ctx) =>
          (fn as Runtime)._handler(ctx as GenericMutationCtx<DataModel>, args),
        )) as { ok: boolean; value: unknown };
      expect(result.ok, JSON.stringify(result)).toBe(true);
      expect(
        (result.value as { error?: unknown } | null)?.error,
        JSON.stringify(result.value),
      ).toBeUndefined();
    };
    // Maintained saves into the seeded building: their search rows name a
    // building that has no name term yet.
    await call(jobScans.saveJobScans, {
      warehouseId,
      requestId: "into-seeded-building",
      locationText: "",
      location: { zoneId: seeded },
      items: Array.from({ length: 3 }, (_, n) => ({
        factoryOrder: `FO-SEEDED-${n}`,
        productBarcodeText: `SD-${n}`,
        source: "MANUAL" as const,
      })),
    });
    const needles = [
      "seed annex",
      "อาคารเมล็ด",
      "fo-legacy",
      "legacy-new",
      "ชิ้นงานย้อน",
      "legacy-fix",
      corrected.factoryOrder,
      "ลูกค้าแก้ไข",
      removed.factoryOrder,
      "legacy hall",
      "ห้องเก่า",
      "building a",
      "บริษัท ฟาบริ",
    ];
    const checkAll = async () => {
      for (const raw of needles)
        for (const filter of ["ALL", "MAPPED", "UNMAPPED"] as const) {
          const indexed = await traverse(fixture, {
            search: raw,
            filter,
            pageSize: 20,
          });
          expect(indexed.pages.flat(), `${raw} ${filter}`).toEqual(
            await expected(fixture, normalizeJobScanSearch(raw), filter),
          );
        }
    };
    const rare = async () => {
      const result = await traverse(fixture, {
        search: "legacy-old",
        filter: "ALL",
        pageSize: 20,
      });
      return { docs: docsRead(result.stats), requests: result.requests };
    };
    // Unrepaired: the layout counter moved without the index, so building
    // names come from history, merged by the same engine (same cursors).
    expect((await markers(fixture)).generation).toBe(before.generation + 1);
    await checkAll();
    const first = await request(world, {
      warehouseId,
      filter: "ALL",
      search: "legacy-fix",
      pageSize: 20,
    });
    expect(
      JSON.parse(first.page.continueCursor || first.page.scanCursor || "{}")
        .v ?? "jss1",
    ).toBe("jss1");
    const unrepaired = await rare();
    // Control: a reader that trusted readiness alone (iteration 7) would miss
    // them. Pretend the markers cover everything, then put them back.
    const trusted = await markers(fixture);
    const pretend = (fields: Record<string, unknown>) =>
      world.t.run((ctx) => ctx.db.patch(trusted.row._id, fields));
    await pretend({
      watermark: Date.now() + 3_600_000,
      layoutGeneration: trusted.generation,
    });
    for (const raw of ["legacy-new", "legacy-old", "legacy-fix", "seed annex"])
      expect(
        (
          await traverse(fixture, { search: raw, filter: "ALL", pageSize: 20 })
        ).pages.flat(),
        raw,
      ).toEqual([]);
    await pretend({
      watermark: trusted.row.watermark,
      layoutGeneration: trusted.row.layoutGeneration,
    });

    // The reconcile job re-derives building names (the renamed and the
    // seeded one) and re-indexes the three scans whose search rows were
    // built from other values (the delete leaves rows that only propose a
    // missing scan; the maintained saves compare equal).
    const repaired = await reconcileNow(fixture);
    expect(repaired).toMatchObject({ status: "done", reindexed: 3 });
    const after = await markers(fixture);
    expect(after.row.layoutGeneration).toBe(after.generation);
    expect(after.row.watermark).toBeGreaterThan(now);
    expect(after.row.reconcile).toBeUndefined();
    await checkAll();
    const reconciled = await rare();
    console.log("LEGACY READS", JSON.stringify({ unrepaired, reconciled }));
    expect(reconciled.requests).toBe(1);
    expect(reconciled.docs).toBeLessThan(unrepaired.docs);
    expect(reconciled.docs).toBeLessThan(150);

    // Maintained writes keep their rows current: a reconcile after them only
    // compares digests, and a tracked layout write moves the marker along.
    await call(jobScans.saveJobScans, {
      warehouseId,
      requestId: "after-reconcile",
      locationText: "ข้างเสา M2",
      items: Array.from({ length: 12 }, (_, n) => ({
        factoryOrder: `FO-MAINTAINED-${n}`,
        productBarcodeText: `MT-${n}`,
        source: "MANUAL" as const,
      })),
    });
    const rename = mutationWithOrg({
      args: {
        warehouseId: v.id("warehouses"),
        buildingId: v.id("storageBuildings"),
        name: v.string(),
      },
      permissionCode: "masterData.storageLayout.manage",
      target: { table: "storageBuildings" },
      warehouseId: (args) => args.warehouseId,
      handler: async (ctx, args) => {
        await ctx.tenantDb.patch("storageBuildings", args.buildingId, {
          name: args.name,
        });
        return null;
      },
    });
    await call(rename, {
      warehouseId,
      buildingId: renamed,
      name: "Maintained Hall",
    });
    const followed = await markers(fixture);
    expect(followed.generation).toBe(after.generation + 1);
    expect(followed.row.layoutGeneration).toBe(followed.generation);
    for (const raw of ["fo-maintained", "maintained hall", "legacy hall"])
      for (const filter of ["ALL", "UNMAPPED"] as const) {
        const indexed = await traverse(fixture, {
          search: raw,
          filter,
          pageSize: 20,
        });
        expect(indexed.pages.flat(), raw).toEqual(
          await expected(fixture, normalizeJobScanSearch(raw), filter),
        );
      }
    expect(await reconcileNow(fixture)).toMatchObject({
      status: "done",
      checked: 12,
      reindexed: 0,
    });
  });

  it("falls back to the scan until ready, and after raw writers invalidate it", async () => {
    const fixture = await setup(300);
    const page = async () =>
      (
        await request(fixture.world, {
          warehouseId: fixture.warehouseId,
          filter: "ALL",
          search: "บริษัท",
          pageSize: 20,
        })
      ).page;
    // Not ready: the bounded scan answers (its cursors are not ours).
    const before = await page();
    expect(before.status === "scanning" || before.continueCursor).toBeTruthy();
    const scanCursor = before.scanCursor ?? before.continueCursor;
    expect(JSON.parse(scanCursor).v).toBe(2);
    await runBackfill(fixture);
    const ready = await page();
    expect(ready.status).toBe("ready");
    expect(JSON.parse(ready.continueCursor).v).toBe("jss1");
    // A cursor from the other path restarts from page one.
    const stale = await request(fixture.world, {
      warehouseId: fixture.warehouseId,
      filter: "ALL",
      search: "บริษัท",
      pageSize: 20,
      cursor: scanCursor,
    });
    expect(stale.page.status).toBe("reset");
    await fixture.world.t.run((ctx) =>
      backfill.invalidateSearchIndex(
        ctx as unknown as Parameters<typeof backfill.invalidateSearchIndex>[0],
        fixture.warehouseId,
      ),
    );
    const invalidated = await page();
    expect(
      invalidated.status === "scanning" ||
        JSON.parse(invalidated.continueCursor).v === 2,
    ).toBe(true);
    // A continuation of the superseded run cannot declare readiness.
    const restarted = await runBackfill(fixture);
    expect(restarted.ready).toBe(true);
  });
});
