/**
 * Write cost of the derived search indexes under their per-transaction write
 * budget, through the real mutations: sustained job-scan ingestion, a
 * correction burst, a 300-ticket remap, a 100-ticket delete, and layout
 * imports (the FG1 importer and its rollback, a 100-slot rack). Counts are
 * convex-test measurements (documents through `ctx.db`), not hosted billing.
 * "derived" is every search table plus the readiness rows; "base" is
 * everything else the mutation writes (scans, audit, idempotency, …).
 */
import type { GenericMutationCtx } from "convex/server";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import type { DataModel } from "../../convex/schema";
import * as jobScans from "../../convex/finishedGoods/jobScans";
import * as backfill from "../../convex/finishedGoods/searchIndexBackfill";
import {
  scanSourceHash,
  SEARCH_WRITE_BUDGET,
} from "../../convex/lib/jobScanSearch";
import { RECONCILE_MARGIN_MS } from "../../convex/lib/searchReadiness";
import {
  apply as applyFg1,
  preflight as preflightFg1,
  rollback as rollbackFg1,
} from "../../convex/storageLayouts/fg1Import";
import { createStorageBuilding } from "../../convex/storageLayouts/writes";
import {
  createStorageZone,
  generateRackStoragePositions,
} from "../../convex/storageLayouts/zones";
import {
  fg1ApprovedPlan,
  FG1_REVISION,
} from "../../convex/model/storageLayout/fg1ApprovedPlan";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";

vi.setConfig({
  testTimeout: Number(process.env["SEARCH_INDEX_TEST_TIMEOUT_MS"] ?? 600_000),
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});
const advance = () =>
  vi.setSystemTime(Date.now() + RECONCILE_MARGIN_MS + 1_000);

type Runtime = {
  _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
};
type Identity = { subject: string; org_id: string };
const DERIVED =
  /^(finishedGoodsJobScan(SearchRows|Terms|TermGrams|Grams)|locationSearchGrams|searchIndexReadiness)$/;

interface Cost {
  reads: { base: number; derived: number };
  writes: { base: number; derived: number };
  writesByTable: Record<string, number>;
  /** Items handed to the scheduled re-index (deferred backlog). */
  deferred: number;
  scheduled: string[];
}
const sum = (map: Record<string, number>, derived: boolean) =>
  Object.entries(map)
    .filter(([table]) => DERIVED.test(table) === derived)
    .reduce((total, [, n]) => total + n, 0);
const bump = (map: Record<string, number>, key: string, by = 1) => {
  map[key] = (map[key] ?? 0) + by;
};

/** Counts reads that return documents, writes by table, and scheduling. */
function countedQuery(
  query: object,
  table: string,
  reads: Record<string, number>,
): object {
  return new Proxy(query, {
    get(target, key, receiver) {
      const member = Reflect.get(target, key, receiver);
      if (typeof member !== "function") return member;
      return (...input: unknown[]) => {
        const result = Reflect.apply(member, target, input);
        if (result instanceof Promise)
          return result.then((value: unknown) => {
            bump(
              reads,
              table,
              Array.isArray(value)
                ? value.length
                : value && typeof value === "object" && "page" in value
                  ? (value as { page: unknown[] }).page.length
                  : value
                    ? 1
                    : 0,
            );
            return value;
          });
        return result && typeof result === "object"
          ? countedQuery(result, table, reads)
          : result;
      };
    },
  });
}

async function costOf<T>(
  world: ConvexTenantWorld,
  identity: Identity,
  fn: unknown,
  args: unknown,
): Promise<{ value: T; cost: Cost }> {
  const reads: Record<string, number> = {};
  const writes: Record<string, number> = {};
  const scheduled: string[] = [];
  let deferred = 0;
  const outcome = (await world.t.withIdentity(identity).run(async (ctx) => {
    const db = new Proxy(ctx.db, {
      get(target, key, receiver) {
        const member = Reflect.get(target, key, receiver);
        if (["insert", "patch", "replace", "delete"].includes(String(key)))
          return (...input: unknown[]) => {
            bump(writes, String(input[0]));
            return Reflect.apply(member, target, input);
          };
        if (key === "get")
          return (...input: unknown[]) =>
            Promise.resolve(Reflect.apply(member, target, input)).then(
              (value) => {
                bump(
                  reads,
                  input.length > 1 ? String(input[0]) : "(id)",
                  value ? 1 : 0,
                );
                return value;
              },
            );
        if (key === "query")
          return (table: string) =>
            countedQuery(Reflect.apply(member, target, [table]), table, reads);
        return typeof member === "function" ? member.bind(target) : member;
      },
    });
    const scheduler = {
      ...ctx.scheduler,
      runAfter: (delay: number, ref: never, input: never) => {
        const name = getFunctionName(ref);
        scheduled.push(name);
        if (name.endsWith("searchIndexBackfill:reindex")) {
          const items = input as {
            scans: string[];
            terms: string[];
            locations: string[];
          };
          deferred +=
            items.scans.length + items.terms.length + items.locations.length;
        }
        return ctx.scheduler.runAfter(delay, ref, input);
      },
    };
    return (fn as Runtime)._handler(
      { ...ctx, db, scheduler } as unknown as GenericMutationCtx<DataModel>,
      args,
    );
  })) as { ok: boolean; value: T };
  expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
  expect(
    (outcome.value as { error?: unknown } | null)?.error,
    JSON.stringify(outcome.value),
  ).toBeUndefined();
  return {
    value: outcome.value,
    cost: {
      reads: { base: sum(reads, false), derived: sum(reads, true) },
      writes: { base: sum(writes, false), derived: sum(writes, true) },
      writesByTable: writes,
      deferred,
      scheduled,
    },
  };
}

/** Run due scheduled work (re-index, reconcile continuations) to the end. */
async function drainScheduled(world: ConvexTenantWorld) {
  for (let round = 0; round < 400; round++) {
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

async function build(
  world: ConvexTenantWorld,
  warehouseId: Id<"warehouses">,
  kind: "jobScans" | "locations",
) {
  let cursor: string | undefined;
  let runId: string | undefined;
  for (let step = 0; step < 1_000; step++) {
    const result = (await world.t.run((ctx) =>
      (backfill.run as unknown as Runtime)._handler(ctx, {
        warehouseId,
        kind,
        ...(cursor ? { cursor, runId } : { restart: true }),
        batchSize: 50,
      }),
    )) as {
      isDone: boolean;
      ready: boolean;
      continueCursor: string;
      runId: string;
    };
    if (result.isDone) {
      expect(result.ready).toBe(true);
      return;
    }
    cursor = result.continueCursor;
    runId = result.runId;
  }
  throw new Error("build did not finish");
}

async function readiness(
  world: ConvexTenantWorld,
  warehouseId: Id<"warehouses">,
  kind: "jobScans" | "locations",
) {
  return world.t.run(async (ctx) => {
    const row = await ctx.db
      .query("searchIndexReadiness")
      .withIndex("by_orgId_warehouseId_kind", (q) =>
        q
          .eq("orgId", world.orgA)
          .eq("warehouseId", warehouseId)
          .eq("kind", kind),
      )
      .unique();
    const signal = await ctx.db
      .query("storageCatalogueSignals")
      .withIndex("by_orgId_warehouseId", (q) =>
        q.eq("orgId", world.orgA).eq("warehouseId", warehouseId),
      )
      .unique();
    return { row: row!, generation: signal?.generation ?? 0 };
  });
}

/** Reconcile once the margin has passed; scheduled continuations included. */
async function reconcile(
  world: ConvexTenantWorld,
  warehouseId: Id<"warehouses">,
  kind: "jobScans" | "locations",
) {
  advance();
  const derivedBefore = await derivedCounts(world);
  const first = (await world.t.run((ctx) =>
    (backfill.reconcile as unknown as Runtime)._handler(ctx, {
      warehouseId,
      kind,
    }),
  )) as { status: string; checked: number; reindexed: number };
  await drainScheduled(world);
  const progress = await world.t.run((ctx) =>
    ctx.db
      .query("searchIndexReconcile")
      .withIndex("by_orgId_warehouseId_kind", (q) =>
        q
          .eq("orgId", world.orgA)
          .eq("warehouseId", warehouseId)
          .eq("kind", kind),
      )
      .unique(),
  );
  expect(progress?.reconcile).toBeUndefined();
  return { first, derivedBefore, derivedAfter: await derivedCounts(world) };
}

async function derivedCounts(world: ConvexTenantWorld) {
  return world.t.run(async (ctx) => ({
    searchRows: (await ctx.db.query("finishedGoodsJobScanSearchRows").collect())
      .length,
    terms: (await ctx.db.query("finishedGoodsJobScanTerms").collect()).length,
    termGrams: (await ctx.db.query("finishedGoodsJobScanTermGrams").collect())
      .length,
    scanGrams: (await ctx.db.query("finishedGoodsJobScanGrams").collect())
      .length,
    unposted: (
      await ctx.db.query("finishedGoodsJobScanGrams").collect()
    ).filter((row) => row.gram === "").length,
    locationGrams: (await ctx.db.query("locationSearchGrams").collect()).length,
  }));
}

const summary = (costs: Cost[]) => {
  const pick = (f: (cost: Cost) => number) => {
    const values = costs.map(f).sort((a, b) => a - b);
    return {
      min: values[0],
      p50: values[Math.floor(values.length / 2)],
      max: values[values.length - 1],
      total: values.reduce((a, b) => a + b, 0),
    };
  };
  return {
    n: costs.length,
    baseWrites: pick((c) => c.writes.base),
    derivedWrites: pick((c) => c.writes.derived),
    derivedReads: pick((c) => c.reads.derived),
    deferred: pick((c) => c.deferred),
  };
};

describe("search index write costs", () => {
  it("sustained ingestion, a correction burst, a remap and a 100-ticket delete stay within the budget and drain", async () => {
    const world = await createConvexTenantWorld({
      "../convex/finishedGoods/searchIndexBackfill.ts": () =>
        import("../../convex/finishedGoods/searchIndexBackfill"),
    });
    await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
    const identity = { subject: "user_fixture_a", org_id: "org_fixture_a" };
    const warehouseId = world.warehouses.alphaA;
    const stamps = {
      createdAt: 1,
      updatedAt: 1,
      createdByUserId: world.userA,
      updatedByUserId: world.userA,
    };
    // A small layout and 300 earlier scans whose customers, parts and
    // barcodes repeat (as in production), so terms become shared.
    const CUSTOMERS = [
      "บริษัท ฟาบริเนท จำกัด (สำนักงานใหญ่)",
      "Siam Packaging Co., Ltd.",
      "Thai Metal Works",
      "บริษัท สยามพาร์ท จำกัด",
    ];
    const PARTS = Array.from(
      { length: 40 },
      (_, n) =>
        `${["VMI BOX TRAY", "CARTON A4", "ถาดพลาสติก"][n % 3]} ${String(n * 7).padStart(4, "0")} Rev.0${n % 3}`,
    );
    const BARCODES = Array.from(
      { length: 60 },
      (_, n) =>
        `FBN-BXVMI${String(n).padStart(3, "0")}-BOX-0${(n % 16).toString(16)}`,
    );
    const zones = await world.t.run(async (ctx) => {
      const buildingId = await ctx.db.insert("storageBuildings", {
        orgId: world.orgA,
        warehouseId,
        code: "BLDG-W",
        name: "อาคารรับสินค้า West",
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
      const ids: Id<"storageZones">[] = [];
      for (let zone = 0; zone < 4; zone++) {
        const code = `W-F01-Z${zone + 1}`;
        const locationId = await ctx.db.insert("locations", {
          orgId: world.orgA,
          warehouseId,
          code,
          locationType: "FLOOR_BLOCK",
          status: "ACTIVE",
          buildingId,
          floorId,
        });
        ids.push(
          await ctx.db.insert("storageZones", {
            orgId: world.orgA,
            warehouseId,
            buildingId,
            floorId,
            locationId,
            code,
            label: `โซน ${zone + 1}`,
            qrValue: `ISAS:LOCATION:1:${locationId}`,
            xMm: 1000 * zone,
            yMm: 0,
            widthMm: 1000,
            depthMm: 1000,
            maxStackHeightMm: 3000,
            status: "ACTIVE",
            ...stamps,
          }),
        );
      }
      for (let n = 0; n < 300; n++)
        await ctx.db.insert("finishedGoodsJobScans", {
          orgId: world.orgA,
          warehouseId,
          factoryOrder: `FO68${String(100000 + n)}`,
          productBarcodeText: BARCODES[n % BARCODES.length]!,
          partName: PARTS[n % PARTS.length]!,
          customer: CUSTOMERS[n % CUSTOMERS.length]!,
          source: "MANUAL",
          locationText: "ข้างเสา C12",
          mapped: false,
          createdAt: 1_000 + n,
          createdByUserId: world.userA,
          updatedAt: 1_000 + n,
          updatedByUserId: world.userA,
        });
      return ids;
    });
    advance();
    await build(world, warehouseId, "jobScans");
    await build(world, warehouseId, "locations");
    await reconcile(world, warehouseId, "jobScans");

    // 20 consecutive 50-ticket saves: unique job numbers, repeating texts.
    const saves: Cost[] = [];
    let ticket = 0;
    for (let save = 0; save < 20; save++) {
      const { cost } = await costOf(world, identity, jobScans.saveJobScans, {
        warehouseId,
        requestId: `ingest-${save}`,
        locationText: "",
        location: { zoneId: zones[save % zones.length]! },
        items: Array.from({ length: 50 }, () => {
          const n = ticket++;
          return {
            factoryOrder: `FO69${String(200000 + n)}`,
            productBarcodeText: BARCODES[(n * 7) % BARCODES.length]!,
            partName: PARTS[(n * 3) % PARTS.length]!,
            customer: CUSTOMERS[n % CUSTOMERS.length]!,
            source: "MANUAL" as const,
          };
        }),
      });
      saves.push(cost);
    }
    const backlog = await derivedCounts(world);
    await drainScheduled(world);
    const drained = await derivedCounts(world);
    // Every save within the budget: postings ≤ 1,500, plus per scan one
    // search row, one unposted row and at most 7 new terms.
    for (const cost of saves)
      expect(cost.writes.derived).toBeLessThanOrEqual(
        SEARCH_WRITE_BUDGET + 50 * 9,
      );
    // Whatever was deferred is posted by the scheduled re-index.
    expect(drained.unposted).toBe(0);

    // The reconcile pass over 1,000 maintained scans compares digests and
    // writes nothing derived.
    const ingestReconcile = await reconcile(world, warehouseId, "jobScans");
    expect(ingestReconcile.first.status).toBe("continuing");
    expect(ingestReconcile.derivedAfter).toEqual(ingestReconcile.derivedBefore);

    // A correction burst: 50 consecutive single-ticket corrections.
    const saved = await world.t.run((ctx) =>
      ctx.db
        .query("finishedGoodsJobScans")
        .withIndex("by_orgId_warehouseId_createdAt", (q) =>
          q.eq("orgId", world.orgA).eq("warehouseId", warehouseId),
        )
        .order("desc")
        .take(1_000),
    );
    const corrections: Cost[] = [];
    for (const [n, scan] of saved.slice(0, 50).entries()) {
      const { cost } = await costOf(world, identity, jobScans.updateJobScan, {
        warehouseId,
        jobScanId: scan._id,
        requestId: `correct-${n}`,
        expectedVersion: scan.version ?? 1,
        fields: {
          factoryOrder: `${scan.factoryOrder}-C`,
          productBarcodeText: scan.productBarcodeText,
          partName: PARTS[(n * 11) % PARTS.length],
          customer: `ลูกค้าแก้ไข ${n}`,
        },
      });
      corrections.push(cost);
    }
    // A 300-ticket remap (the selection limit) to another area.
    const remap = (
      await costOf(world, identity, jobScans.assignJobScanLocation, {
        warehouseId,
        requestId: "remap-300",
        ids: saved.slice(100, 400).map((scan) => scan._id),
        location: { zoneId: zones[0]! },
      })
    ).cost;
    // A 100-ticket delete.
    const deleted = (
      await costOf(world, identity, jobScans.deleteJobScans, {
        warehouseId,
        requestId: "delete-100",
        ids: saved.slice(400, 500).map((scan) => scan._id),
      })
    ).cost;
    const beforeDrain = await derivedCounts(world);
    await drainScheduled(world);
    const afterDrain = await derivedCounts(world);
    expect(afterDrain.unposted).toBe(0);
    // Deleted scans keep no search rows or postings once drained.
    const leftovers = await world.t.run(async (ctx) => {
      const gone = new Set(
        saved.slice(400, 500).map((scan) => scan._id as string),
      );
      return (await ctx.db.query("finishedGoodsJobScanGrams").collect()).filter(
        (row) => gone.has(row.scanId),
      ).length;
    });
    expect(leftovers).toBe(0);
    for (const cost of [...corrections, remap, deleted])
      expect(cost.writes.derived).toBeLessThanOrEqual(
        SEARCH_WRITE_BUDGET + 300 * 9,
      );
    // Every search row was built from its scan's current fields.
    const stale = await world.t.run(async (ctx) => {
      let count = 0;
      for (const scan of await ctx.db
        .query("finishedGoodsJobScans")
        .collect()) {
        const row = await ctx.db
          .query("finishedGoodsJobScanSearchRows")
          .withIndex("by_orgId_scanId", (q) =>
            q.eq("orgId", world.orgA).eq("scanId", scan._id),
          )
          .first();
        if (row?.sourceHash !== (await scanSourceHash(scan))) count++;
      }
      return count;
    });
    expect(stale).toBe(0);
    console.log(
      "INGESTION",
      JSON.stringify(
        {
          saves50: summary(saves),
          perSave: saves.map((c) => [
            c.writes.base,
            c.writes.derived,
            c.deferred,
          ]),
          backlogBeforeDrain: backlog,
          afterDrain: drained,
          reconcileAfterIngest: ingestReconcile.first,
          corrections: summary(corrections),
          remap300: remap,
          delete100: deleted,
          beforeDrain,
          afterDrain2: afterDrain,
        },
        null,
        1,
      ),
    );
  });

  it("layout imports: FG1 apply and rollback, and a 100-slot rack", async () => {
    const world = await createConvexTenantWorld({
      "../convex/finishedGoods/searchIndexBackfill.ts": () =>
        import("../../convex/finishedGoods/searchIndexBackfill"),
    });
    await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
    const identity = {
      subject: "user_fixture_a",
      org_id: "org_3Je6JpUXsjAZcHyLD5lodjFdLmQ",
    };
    // The FG1 fixture of tests/integration/fg1-import.integration.test.ts.
    const target = await world.t.run(async (ctx) => {
      await ctx.db.patch("organizations", world.orgA, {
        clerkOrganizationId: identity.org_id,
      });
      await ctx.db.patch("warehouses", world.warehouses.alphaA, {
        code: "TG-OPT",
      });
      const warehouseId = world.warehouses.alphaA;
      const stamps = {
        createdAt: 1,
        updatedAt: 1,
        createdByUserId: world.userA,
        updatedByUserId: world.userA,
      };
      const buildingId = await ctx.db.insert("storageBuildings", {
        orgId: world.orgA,
        warehouseId,
        code: "FG1",
        name: "FG1",
        widthMm: 60000,
        depthMm: 12000,
        defaultFloorHeightMm: 5000,
        floorCount: 1,
        totalHeightMm: 5000,
        grossAreaSqMm: 720000000,
        usableAreaSqMm: 720000000,
        reservedAreaSqMm: 0,
        version: 4,
        status: "DRAFT",
        ...stamps,
      });
      const floorId = await ctx.db.insert("storageFloors", {
        orgId: world.orgA,
        warehouseId,
        buildingId,
        floorNumber: 1,
        version: 2,
        grossAreaSqMm: 720000000,
        usableAreaSqMm: 720000000,
        reservedAreaSqMm: 0,
        updatedAt: 1,
        updatedByUserId: world.userA,
      });
      for (const cell of fg1ApprovedPlan().cells) {
        const locationId = await ctx.db.insert("locations", {
          orgId: world.orgA,
          warehouseId,
          code: cell.code,
          locationType: "FLOOR_BLOCK",
          status: "ACTIVE",
        });
        const zoneId = await ctx.db.insert("storageZones", {
          ...cell,
          orgId: world.orgA,
          warehouseId,
          buildingId,
          floorId,
          locationId,
          label: cell.code,
          qrValue: `qr:${locationId}`,
          maxStackHeightMm: 650,
          status: "ACTIVE",
          ...stamps,
        });
        await ctx.db.insert("storagePositions", {
          orgId: world.orgA,
          warehouseId,
          buildingId,
          floorId,
          locationId,
          zoneId,
          code: cell.code,
          label: cell.code,
          qrValue: `qr:${locationId}`,
          kind: "DEFAULT",
          isDefault: true,
          status: "ACTIVE",
          ...stamps,
        });
      }
      return { warehouseId, buildingId };
    });
    const { warehouseId } = target;
    advance();
    await build(world, warehouseId, "jobScans");
    await build(world, warehouseId, "locations");
    const cells = fg1ApprovedPlan().cells.length;
    const read = async () =>
      (
        (await world.t
          .withIdentity(identity)
          .run((ctx) =>
            (preflightFg1 as unknown as Runtime)._handler(
              ctx as GenericMutationCtx<DataModel>,
              target,
            ),
          )) as { value: { digest: string; backup: unknown } }
      ).value;
    const before = await read();
    const applied = await costOf<{ afterDigest: string }>(
      world,
      identity,
      applyFg1,
      { ...target, revision: FG1_REVISION, expectedDigest: before.digest },
    );
    // Geometry only: no posting changes, the layout markers follow along.
    expect(applied.cost.writesByTable["locationSearchGrams"] ?? 0).toBe(0);
    expect(applied.cost.writes.derived).toBeLessThanOrEqual(2);
    for (const kind of ["jobScans", "locations"] as const) {
      const state = await readiness(world, warehouseId, kind);
      expect(state.row.layoutGeneration, kind).toBe(state.generation);
    }
    const rolledBack = await costOf(world, identity, rollbackFg1, {
      ...target,
      expectedAfterDigest: applied.value.afterDigest,
      backup: before.backup,
    });
    // A rollback replaces every area and position: each location is
    // compared with its postings (reads), none of which change.
    expect(rolledBack.cost.writesByTable["locationSearchGrams"] ?? 0).toBe(0);
    expect(rolledBack.cost.writes.derived).toBeLessThanOrEqual(2);

    // A real 100-slot rack: 100 new locations and positions in one write.
    const building = (
      await costOf<{ documentId: Id<"storageBuildings"> }>(
        world,
        identity,
        createStorageBuilding,
        {
          warehouseId,
          requestId: "cost-building",
          code: "RACKS",
          name: "อาคารชั้นวาง Rack Hall",
          widthMm: 20000,
          depthMm: 20000,
          defaultFloorHeightMm: 6000,
          floorCount: 1,
        },
      )
    ).value;
    const zone = (
      await costOf<{ documentId: Id<"storageZones"> }>(
        world,
        identity,
        createStorageZone,
        {
          warehouseId,
          buildingId: building.documentId,
          requestId: "cost-zone",
          floorNumber: 1,
          label: "ชั้นวาง ราคา",
          xMm: 0,
          yMm: 0,
          widthMm: 12000,
          depthMm: 4000,
          maxStackHeightMm: 5000,
          mode: "RACK",
        },
      )
    ).value;
    const rack = await costOf<{ createdCount: number }>(
      world,
      identity,
      generateRackStoragePositions,
      {
        warehouseId,
        zoneId: zone.documentId,
        requestId: "cost-rack",
        fixtureCode: "RC",
        bayCount: 10,
        levelCount: 5,
        slotsPerBay: 2,
        bayWidthMm: 1000,
        rackDepthMm: 1000,
        levelHeightMm: 900,
      },
    );
    expect(rack.value.createdCount).toBe(100);
    expect(rack.cost.writes.derived).toBeLessThanOrEqual(
      SEARCH_WRITE_BUDGET + 100 + 2,
    );
    await drainScheduled(world);
    // New locations: the picker skips its postings until the reconcile job
    // has compared them (one paginated pass of ~100 rows).
    const rackReconcile = await reconcile(world, warehouseId, "locations");
    const state = await readiness(world, warehouseId, "locations");
    expect(state.row.layoutGeneration).toBe(state.generation);
    expect(rackReconcile.derivedAfter).toEqual(rackReconcile.derivedBefore);
    console.log(
      "LAYOUT",
      JSON.stringify(
        {
          fg1Cells: cells,
          fg1Apply: applied.cost,
          fg1Rollback: rolledBack.cost,
          rack100: rack.cost,
          rackReconcile: rackReconcile.first,
          locationGrams: rackReconcile.derivedAfter.locationGrams,
        },
        null,
        1,
      ),
    );
  });
});
