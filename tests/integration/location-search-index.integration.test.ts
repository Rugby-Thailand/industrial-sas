/**
 * Index-backed job-scan location picker search (`searchPage` over
 * `locationSearchGrams`) against the keyset scan it replaces, on a generated
 * multilingual fixture of 600+ locations: identical pages, order, phases and
 * exhaustion. Counts are convex-test measurements, not hosted billing units.
 */
import type { GenericMutationCtx } from "convex/server";
import { v } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import type { DataModel } from "../../convex/schema";
import * as locations from "../../convex/finishedGoods/jobScanLocations";
import * as backfill from "../../convex/finishedGoods/searchIndexBackfill";
import { RECONCILE_MARGIN_MS } from "../../convex/lib/searchReadiness";
import { mutationWithOrg } from "../../convex/lib/tenantFunctions";
import { createStorageBuilding } from "../../convex/storageLayouts/writes";
import {
  createStorageZone,
  generateRackStoragePositions,
} from "../../convex/storageLayouts/zones";
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

// convex-test scans every document on each index read; on a loaded machine
// SEARCH_INDEX_TEST_TIMEOUT_MS raises the limit (as for job scans).
vi.setConfig({
  testTimeout: Number(process.env["SEARCH_INDEX_TEST_TIMEOUT_MS"] ?? 600_000),
});

type Runtime = {
  _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
};
type Page = {
  status: "ready" | "scanning" | "reset";
  items: { locationId: string; code: string }[];
  isDone: boolean;
  continueCursor: string;
  scanCursor?: string;
  phase?: string;
};
const identity = { subject: "user_fixture_a", org_id: "org_fixture_a" };

let seed = 5;
const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const pick = <T>(list: readonly T[]) =>
  list[Math.floor(random() * list.length)]!;

async function setup(count: number) {
  const world = await createConvexTenantWorld({
    "../convex/finishedGoods/searchIndexBackfill.ts": () =>
      import("../../convex/finishedGoods/searchIndexBackfill"),
  });
  await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
  const warehouseId = world.warehouses.alphaA;
  const ids = await world.t.run(async (ctx) => {
    const stamps = {
      createdAt: 1,
      updatedAt: 1,
      createdByUserId: world.userA,
      updatedByUserId: world.userA,
    };
    const building = (code: string, name: string) =>
      ctx.db.insert("storageBuildings", {
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
        ...stamps,
      });
    const floor = (buildingId: Id<"storageBuildings">) =>
      ctx.db.insert("storageFloors", {
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
    const buildingA = await building("BUILDING-A", "อาคาร A");
    const buildingB = await building("BUILDING-B", "Building B");
    const floorA = await floor(buildingA);
    const floorB = await floor(buildingB);
    const labels = [
      "Shelf",
      "ชั้นวาง",
      "ชั้นวางปลายทาง",
      "Rack ＲＯ１",
      "Réserve",
      "Réserve",
      "โซน ก จำนวน",
      "Bay",
    ];
    const created: Id<"locations">[] = [];
    for (let index = 0; index < count; index++) {
      const inB = random() < 0.35;
      const buildingId = inB ? buildingB : buildingA;
      const floorId = inB ? floorB : floorA;
      const prefix = pick(["A", "B", "R0", "F1-L30", "R01-B0", "ZN"]);
      const code = `${prefix}-${String(index).padStart(4, "0")}`;
      const label = `${pick(labels)} ${index % 37}`;
      const roll = random();
      const type = roll < 0.3 ? "named" : "physical";
      const legacy = type === "physical" && random() < 0.15;
      const status = random() < 0.08 ? "INACTIVE" : "ACTIVE";
      const locationId = await ctx.db.insert("locations", {
        orgId: world.orgA,
        warehouseId,
        code,
        status,
        locationType: type === "named" ? "NAMED_STORAGE" : "FLOOR_BLOCK",
        ...(type === "named"
          ? { label, buildingId, floorId }
          : legacy
            ? {}
            : { buildingId, floorId }),
      });
      created.push(locationId);
      if (type === "physical") {
        const zoneId = await ctx.db.insert("storageZones", {
          orgId: world.orgA,
          warehouseId,
          buildingId,
          floorId,
          locationId,
          code,
          label,
          qrValue: `ISAS:LOCATION:1:${locationId}`,
          xMm: 0,
          yMm: 0,
          widthMm: 1000,
          depthMm: 1000,
          maxStackHeightMm: 3000,
          status: "ACTIVE",
          ...stamps,
        });
        // Most physical rows show their support position; some only the area.
        if (random() < 0.8)
          await ctx.db.insert("storagePositions", {
            orgId: world.orgA,
            warehouseId,
            buildingId,
            floorId,
            zoneId,
            locationId,
            code: random() < 0.1 ? `${code}-P` : code,
            label: random() < 0.2 ? `ตำแหน่ง ${label}` : label,
            qrValue: `ISAS:LOCATION:1:${locationId}`,
            kind: "DEFAULT",
            isDefault: true,
            status: "ACTIVE",
            ...stamps,
          });
      }
    }
    return { buildingA, buildingB, floorA, created };
  });
  return { world, warehouseId, ...ids };
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

async function runBackfill(fixture: Fixture) {
  // The fixture was written well before the build (outside its margin).
  advance();
  let cursor: string | undefined;
  let runId: string | undefined;
  for (let step = 0; step < 1_000; step++) {
    const result = (await fixture.world.t.run((ctx) =>
      (backfill.run as unknown as Runtime)._handler(ctx, {
        warehouseId: fixture.warehouseId,
        kind: "locations",
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
          .eq("kind", "locations"),
      )
      .unique();
    await ctx.db.patch(row!._id, { ready });
  });
}

/** Every page of one search, following scan continuations like the client. */
async function traverse(
  world: ConvexTenantWorld,
  args: Record<string, unknown>,
) {
  const pages: { items: string[]; isDone: boolean }[] = [];
  const stats = emptyStats();
  let requests = 0;
  let cursor: string | undefined;
  for (let pageNo = 0; pageNo < 200; pageNo++) {
    let scanCursor: string | undefined;
    let page: Page;
    do {
      const result = await measured<Page>(world, locations.searchPage, {
        ...args,
        ...(cursor ? { cursor } : {}),
        ...(scanCursor ? { scanCursor } : {}),
      });
      requests++;
      addStats(stats, result.stats);
      page = result.value;
      scanCursor = page.scanCursor;
    } while (page.status === "scanning");
    expect(page.status).toBe("ready");
    pages.push({
      items: page.items.map((item) => item.locationId),
      isDone: page.isDone,
    });
    if (page.isDone) return { pages, stats, requests };
    cursor = page.continueCursor;
  }
  throw new Error("traversal did not finish");
}
const docsRead = (stats: ReadStats) =>
  Object.values(stats.rangeDocs).reduce((a, b) => a + b, 0) +
  Object.values(stats.gets).reduce((a, b) => a + b, 0);

async function postings(world: ConvexTenantWorld) {
  const rows = await world.t.run((ctx) =>
    ctx.db.query("locationSearchGrams").collect(),
  );
  return rows
    .map((row) => [row.locationId, row.gram, row.code, row.texts.join("|")])
    .map((row) => JSON.stringify(row))
    .sort();
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

/** The warehouse's picker readiness row and layout counter. */
async function markers(fixture: Fixture) {
  return fixture.world.t.run(async (ctx) => {
    const row = await ctx.db
      .query("searchIndexReadiness")
      .withIndex("by_orgId_warehouseId_kind", (q) =>
        q
          .eq("orgId", fixture.world.orgA)
          .eq("warehouseId", fixture.warehouseId)
          .eq("kind", "locations"),
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
      kind: "locations",
    }),
  )) as { status: string; checked: number; reindexed: number };
  await drainScheduled(fixture.world);
  return result;
}

describe("index-backed location picker search", () => {
  it("returns the same pages as the keyset scan for every needle and filter", async () => {
    const fixture = await setup(640);
    expect((await runBackfill(fixture)).ready).toBe(true);
    const codes = await fixture.world.t.run(async (ctx) =>
      (await ctx.db.query("locations").collect()).flatMap((row) => [
        row.code,
        row.label ?? "",
      ]),
    );
    const needles = new Set([
      "R0",
      "r0",
      "F1-L30",
      "f1-l30 ",
      "L30-0",
      "-00",
      "ชั้นวาง",
      "ปลายทาง",
      "Réserve",
      "Réserve",
      "ＲＯ１",
      "ro1",
      "จำนวน",
      "ำน",
      "-P",
      "ZN-0",
      "NO-SUCH-PLACE",
      "ไม่มี",
      "A",
      "ก",
      "1",
    ]);
    // SEARCH_PARITY_NEEDLES raises the sample (reported runs: 90).
    const size = Number(process.env["SEARCH_PARITY_NEEDLES"] ?? 60);
    while (needles.size < size) {
      const chars = [...pick(codes)];
      const start = Math.floor(random() * chars.length);
      const length = 2 + Math.floor(random() * 6);
      const needle = chars.slice(start, start + length).join("");
      if (needle.trim())
        needles.add(random() < 0.3 ? needle.toLowerCase() : needle);
    }
    let compared = 0;
    for (const text of needles)
      for (const buildingId of [undefined, fixture.buildingB]) {
        if (buildingId && random() < 0.5) continue;
        for (const pageSize of [20, 50]) {
          if (pageSize === 50 && random() < 0.7) continue;
          const args = {
            warehouseId: fixture.warehouseId,
            text,
            pageSize,
            ...(buildingId ? { buildingId } : {}),
          };
          const indexed = await traverse(fixture.world, args);
          await setReady(fixture, false);
          const scanned = await traverse(fixture.world, args);
          await setReady(fixture, true);
          expect(
            indexed.pages,
            `${text} ${buildingId ?? ""} ${pageSize}`,
          ).toEqual(scanned.pages);
          compared++;
        }
      }
    console.log(
      "PICKER PARITY",
      JSON.stringify({ needles: needles.size, compared }),
    );
  });

  it("reads the needle's postings instead of every location", async () => {
    const fixture = await setup(640);
    await runBackfill(fixture);
    const report: Record<string, unknown> = {};
    for (const text of [
      "R0",
      "F1-L30-0123",
      "ปลายทาง",
      "Shelf 3",
      "NO-SUCH-PLACE",
    ]) {
      const args = { warehouseId: fixture.warehouseId, text, pageSize: 20 };
      const indexed = await traverse(fixture.world, args);
      await setReady(fixture, false);
      const scanned = await traverse(fixture.world, args);
      await setReady(fixture, true);
      expect(indexed.pages).toEqual(scanned.pages);
      report[text] = {
        matches: indexed.pages.reduce((n, page) => n + page.items.length, 0),
        indexed: { docs: docsRead(indexed.stats), requests: indexed.requests },
        scan: { docs: docsRead(scanned.stats), requests: scanned.requests },
      };
    }
    console.log("PICKER READS", JSON.stringify(report, null, 1));
    const miss = report["NO-SUCH-PLACE"] as {
      indexed: { docs: number; requests: number };
    };
    expect(miss.indexed.requests).toBe(1);
    expect(miss.indexed.docs).toBeLessThan(60);
  });

  it("keeps postings exact through tracked layout writes, renames and deferred work", async () => {
    const fixture = await setup(120);
    await runBackfill(fixture);
    const { world, warehouseId } = fixture;
    const call = async (fn: unknown, args: unknown) => {
      const result = (await world.t
        .withIdentity(identity)
        .run((ctx) =>
          (fn as Runtime)._handler(ctx as GenericMutationCtx<DataModel>, args),
        )) as { ok: boolean; value: Record<string, unknown> };
      expect(result.ok, JSON.stringify(result)).toBe(true);
      return result.value;
    };
    // Real layout mutations: a building, an area and a 100-slot rack.
    const building = (await call(createStorageBuilding, {
      warehouseId,
      requestId: "index-building",
      code: "INDEXED",
      name: "อาคารดัชนี",
      widthMm: 20000,
      depthMm: 20000,
      defaultFloorHeightMm: 6000,
      floorCount: 1,
    })) as { documentId: Id<"storageBuildings"> };
    const zone = (await call(createStorageZone, {
      warehouseId,
      buildingId: building.documentId,
      requestId: "index-zone",
      floorNumber: 1,
      label: "ชั้นวาง ดัชนี",
      xMm: 0,
      yMm: 0,
      widthMm: 12000,
      depthMm: 4000,
      maxStackHeightMm: 5000,
      mode: "RACK",
    })) as { documentId: Id<"storageZones"> };
    const rack = await call(generateRackStoragePositions, {
      warehouseId,
      zoneId: zone.documentId,
      requestId: "index-rack",
      fixtureCode: "RX",
      bayCount: 10,
      levelCount: 5,
      slotsPerBay: 2,
      bayWidthMm: 1000,
      rackDepthMm: 1000,
      levelHeightMm: 900,
    });
    expect(rack["createdCount"]).toBe(100);
    // Labels and codes changed through the tracked tenant writer.
    const edit = mutationWithOrg({
      args: {
        warehouseId: v.id("warehouses"),
        table: v.union(
          v.literal("locations"),
          v.literal("storagePositions"),
          v.literal("storageZones"),
        ),
        id: v.string(),
        fields: v.any(),
      },
      permissionCode: "masterData.storageLayout.manage",
      target: { table: "locations" },
      warehouseId: (args) => args.warehouseId,
      handler: async (ctx, args) => {
        await ctx.tenantDb.patch(args.table, args.id, args.fields);
        return null;
      },
    });
    const sample = await world.t.run(async (ctx) => ({
      position: (await ctx.db.query("storagePositions").first())!,
      named: (await ctx.db
        .query("locations")
        .filter((q) => q.eq(q.field("locationType"), "NAMED_STORAGE"))
        .first())!,
    }));
    await call(edit, {
      warehouseId,
      table: "storagePositions",
      id: sample.position._id,
      fields: { label: "ป้ายใหม่ NEWLABEL" },
    });
    await call(edit, {
      warehouseId,
      table: "locations",
      id: sample.named._id,
      fields: { code: "ZZ-RENAMED-01", label: "ชื่อใหม่" },
    });
    await call(edit, {
      warehouseId,
      table: "locations",
      id: sample.position.locationId,
      fields: { status: "INACTIVE" },
    });
    // Deferred postings (if any) are re-indexed by the scheduled job.
    await drainScheduled(world);
    const maintained = await postings(world);
    await runBackfill(fixture);
    await drainScheduled(world);
    expect(maintained).toEqual(await postings(world));
    for (const text of [
      "NEWLABEL",
      "ป้ายใหม่",
      "ZZ-RENAMED",
      "ชื่อใหม่",
      "RX",
      "ดัชนี",
    ]) {
      const args = { warehouseId, text, pageSize: 20 };
      const indexed = await traverse(world, args);
      await setReady(fixture, false);
      const scanned = await traverse(world, args);
      await setReady(fixture, true);
      expect(indexed.pages, text).toEqual(scanned.pages);
    }
  });
  it("skips the postings after a layout write that bypassed them, and reconciles bypassing writes", async () => {
    const fixture = await setup(160);
    await runBackfill(fixture);
    const { world, warehouseId } = fixture;
    const compare = async (text: string) => {
      const args = { warehouseId, text, pageSize: 20 };
      const indexed = await traverse(world, args);
      await setReady(fixture, false);
      const scanned = await traverse(world, args);
      await setReady(fixture, true);
      expect(indexed.pages, text).toEqual(scanned.pages);
      return {
        matches: indexed.pages.flatMap((page) => page.items).length,
        docs: docsRead(indexed.stats),
        scanDocs: docsRead(scanned.stats),
      };
    };
    // An active area shown by its own label (no support position).
    const zone = await world.t.run(async (ctx) => {
      const positioned = new Set(
        (await ctx.db.query("storagePositions").collect()).map(
          (row) => row.locationId,
        ),
      );
      for (const row of await ctx.db.query("storageZones").collect())
        if (
          !positioned.has(row.locationId) &&
          (await ctx.db.get(row.locationId))?.status === "ACTIVE"
        )
          return row;
      throw new Error("fixture has no area-only location");
    });
    // Code without the index (main after a rollback): a registration
    // inserted without postings, and an area relabelled through its tracked
    // writer, which bumps the layout counter but not the index's copy.
    const insertLegacy = (code: string, label: string) =>
      world.t.run((ctx) =>
        ctx.db.insert("locations", {
          orgId: world.orgA,
          warehouseId,
          code,
          label,
          status: "ACTIVE",
          locationType: "NAMED_STORAGE",
          buildingId: fixture.buildingA,
          floorId: fixture.floorA,
        }),
      );
    await insertLegacy("LEG-NAMED-01", "ชั้นลับเก่า");
    await world.t.run(async (ctx) => {
      await ctx.db.patch(zone._id, { label: "ป้ายเก่า OLDLABEL" });
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
    // Unrepaired: the keyset scan answers (same pages; its reads plus the
    // layout counter the readiness check compares).
    const legacy = ["LEG-NAMED", "ชั้นลับ", "OLDLABEL", "ป้ายเก่า"];
    for (const text of legacy) {
      const read = await compare(text);
      expect(read.matches, text).toBeGreaterThan(0);
      expect(read.docs, text).toBe(read.scanDocs + 1);
    }
    // The counter moved without the index: postings are rebuilt (a restarted
    // build, which also covers the inserted registration).
    expect(await reconcileNow(fixture)).toMatchObject({ status: "rebuilding" });
    const rebuilt = await markers(fixture);
    expect(rebuilt.row.ready).toBe(true);
    expect(rebuilt.row.layoutGeneration).toBe(rebuilt.generation);
    for (const text of legacy) {
      const read = await compare(text);
      expect(read.docs, text).toBeLessThan(read.scanDocs);
    }

    // A creation alone by code without the index (no layout write): the
    // accepted window (lib/searchReadiness.ts). Readers keep the postings, so
    // the location is not proposed until reconcile (every minute) has posted
    // it in place, without a rebuild.
    await insertLegacy("LEG-NAMED-02", "ชั้นลับใหม่");
    const pending = await traverse(world, {
      warehouseId,
      text: "ชั้นลับใหม่",
      pageSize: 20,
    });
    expect(pending.pages.flatMap((page) => page.items)).toEqual([]);
    expect(await reconcileNow(fixture)).toMatchObject({
      status: "done",
      checked: 1,
    });
    const posted = await compare("ชั้นลับใหม่");
    expect(posted.matches).toBe(1);
    expect(posted.docs).toBeLessThan(posted.scanDocs);
    console.log(
      "LEGACY PICKER READS",
      JSON.stringify({ pending: docsRead(pending.stats), posted }),
    );
  });
});
