/**
 * Location picker and storage catalogue: actual authorized handlers against
 * convex-test, driven the way `useCatalogueSync` drives them, with database
 * operations counted through a proxy. Counts are local emulator operations,
 * not hosted billing units or production latency.
 */
import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import type { DataModel } from "../../convex/schema";
import * as locations from "../../convex/finishedGoods/jobScanLocations";
import { page as cataloguePage } from "../../convex/storageLayouts/locationCatalogue";
import { run as backfill } from "../../convex/staging/locationBuildingBackfill";
import { createStorageBuilding } from "../../convex/storageLayouts/writes";
import { createStorageZone } from "../../convex/storageLayouts/zones";
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
  code: string;
  name: string;
  buildingId: string;
  locationId: string;
};
type Page = {
  status: "ready" | "scanning" | "reset";
  items: Item[];
  page: { _id: string; label?: string; buildingId?: string }[];
  isDone: boolean;
  scanCursor?: string;
  continueCursor: string;
  phase?: string;
  buildingUnavailable?: boolean;
};
type Measure = { gets: number; queries: number };

const identity = { subject: "user_fixture_a", org_id: "org_fixture_a" };
// 1,000-location fixtures are deliberately large; allow for parallel workers.
vi.setConfig({ testTimeout: 120_000 });

async function invoke<T>(
  world: ConvexTenantWorld,
  fn: unknown,
  args: unknown,
): Promise<{ value: T; measure: Measure }> {
  const measure: Measure = { gets: 0, queries: 0 };
  const result = (await world.t.withIdentity(identity).run(async (ctx) => {
    const wrap = <Q extends object>(query: Q): Q =>
      new Proxy(query, {
        get(target, property, receiver) {
          const member = Reflect.get(target, property, receiver);
          if (typeof member !== "function") return member;
          return (...params: unknown[]) => {
            if (
              ["paginate", "take", "first", "collect", "unique"].includes(
                String(property),
              )
            )
              measure.queries += 1;
            const value = Reflect.apply(member, target, params);
            return value && typeof value === "object" && !("then" in value)
              ? wrap(value)
              : value;
          };
        },
      });
    const db = new Proxy(ctx.db, {
      get(target, property, receiver) {
        const member = Reflect.get(target, property, receiver);
        if (property === "get")
          return (...params: unknown[]) => {
            measure.gets += 1;
            return Reflect.apply(member, target, params);
          };
        if (property === "query")
          return (table: string) =>
            wrap(Reflect.apply(member, target, [table]) as object);
        return typeof member === "function" ? member.bind(target) : member;
      },
    });
    return (fn as Runtime)._handler(
      { ...ctx, db } as GenericMutationCtx<DataModel>,
      args,
    );
  })) as { ok: boolean; value: T };
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return { value: result.value, measure };
}

type Fixture = Awaited<ReturnType<typeof setup>>;
async function setup(
  count: number,
  options: {
    kind?: "physical" | "named" | "mixed";
    legacy?: boolean;
    second?: number;
  } = {},
) {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
  const warehouseId = world.warehouses.alphaA;
  const kind = options.kind ?? "physical";
  const ids = await world.t.run(async (ctx) => {
    const stamps = {
      createdAt: 1,
      updatedAt: 1,
      createdByUserId: world.userA,
      updatedByUserId: world.userA,
    };
    const building = (code: string, name: string, status = "ACTIVE") =>
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
        status: status as "ACTIVE",
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
    const empty = await building("BUILDING-EMPTY", "Empty building");
    const draft = await building("BUILDING-DRAFT", "Draft building", "DRAFT");
    const floorA = await floor(buildingA);
    const floorB = await floor(buildingB);
    const add = async (
      code: string,
      label: string,
      type: "physical" | "named",
      buildingId: Id<"storageBuildings">,
      floorId: Id<"storageFloors">,
    ) => {
      const locationId = await ctx.db.insert("locations", {
        orgId: world.orgA,
        warehouseId,
        code,
        status: "ACTIVE",
        locationType: type === "named" ? "NAMED_STORAGE" : "FLOOR_BLOCK",
        ...(type === "named"
          ? { label, buildingId, floorId }
          : options.legacy
            ? {}
            : { buildingId, floorId }),
      });
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
        await ctx.db.insert("storagePositions", {
          orgId: world.orgA,
          warehouseId,
          buildingId,
          floorId,
          zoneId,
          locationId,
          code,
          label,
          qrValue: `ISAS:LOCATION:1:${locationId}`,
          kind: "DEFAULT",
          isDefault: true,
          status: "ACTIVE",
          ...stamps,
        });
      }
      return locationId;
    };
    const created: Id<"locations">[] = [];
    for (let index = 0; index < count; index += 1) {
      const last = index === count - 1;
      const code = last ? "F1-L30-16" : `A-${String(index).padStart(5, "0")}`;
      const label = last
        ? "ชั้นวางปลายทาง"
        : index === Math.floor(count / 2)
          ? "Shelf MIDDLE-L30-1"
          : `Shelf ${index}`;
      const type =
        kind === "mixed" ? (index % 3 === 0 ? "named" : "physical") : kind;
      created.push(await add(code, label, type, buildingA, floorA));
    }
    for (let index = 0; index < (options.second ?? 0); index += 1)
      created.push(
        await add(
          `B-${String(index).padStart(5, "0")}`,
          `Bay ${index}`,
          "physical",
          buildingB,
          floorB,
        ),
      );
    return { buildingA, buildingB, empty, draft, floorA, floorB, created };
  });
  return { ...world, warehouseId, ...ids };
}

/** Follow scan continuations like `useCatalogueSync`, recording each response. */
async function finish(
  world: ConvexTenantWorld & { warehouseId: Id<"warehouses"> },
  args: Record<string, unknown>,
  fn: unknown = locations.searchPage,
) {
  let scanCursor: string | undefined;
  const trace: { status: string; shown: number; measure: Measure }[] = [];
  for (let request = 0; request < 200; request += 1) {
    const { value, measure } = await invoke<Page>(world, fn, {
      warehouseId: world.warehouseId,
      pageSize: 20,
      ...args,
      ...(scanCursor ? { scanCursor } : {}),
    });
    trace.push({
      status: value.status,
      shown: (value.items ?? value.page).length,
      measure,
    });
    if (value.status !== "scanning") return { page: value, trace };
    scanCursor = value.scanCursor;
  }
  throw new Error("Search did not finish");
}
const total = (trace: { measure: Measure }[]) =>
  trace.reduce(
    (sum, step) => ({
      gets: sum.gets + step.measure.gets,
      queries: sum.queries + step.measure.queries,
    }),
    { gets: 0, queries: 0 },
  );

describe("location picker search", () => {
  it("browses the first 20 locations in one page-proportional request at 121 and 1,000 rows", async () => {
    const counts: Measure[] = [];
    for (const size of [121, 1000]) {
      const world = await setup(size);
      const { page, trace } = await finish(world, { text: "" });
      expect(trace).toHaveLength(1);
      expect(page.status).toBe("ready");
      expect(page.items).toHaveLength(20);
      expect(page.isDone).toBe(false);
      counts.push(trace[0]!.measure);
    }
    // Same work for 121 and 1,000 rows: the read set follows the page.
    expect(counts[1]).toEqual(counts[0]);
    // 20 rows share one building/floor: no per-row parent reads.
    expect(counts[0]!.gets).toBeLessThanOrEqual(30);
    expect(counts[0]!.queries).toBeLessThanOrEqual(40);
  });

  it("shows an indexed prefix and exact code in the first response, then completes the fallback", async () => {
    for (const size of [121, 1000]) {
      const world = await setup(size);
      for (const text of ["F1-L30-16", "F1-L30", "f1-l30 "]) {
        const first = await invoke<Page>(world, locations.searchPage, {
          warehouseId: world.warehouseId,
          text,
          pageSize: 20,
        });
        expect(first.value.items.map((row) => row.code)).toEqual(["F1-L30-16"]);
        const { page, trace } = await finish(world, { text });
        expect(page.status).toBe("ready");
        expect(page.isDone).toBe(true);
        expect(page.items.map((row) => row.code)).toEqual(["F1-L30-16"]);
        // Every intermediate response already carries the prefix match.
        expect(trace.every((step) => step.shown === 1)).toBe(true);
        expect(trace.length).toBeLessThanOrEqual(Math.ceil(size / 150) + 1);
      }
      const exact = await invoke<{ ok: boolean; location?: Item }>(
        world,
        locations.resolve,
        { warehouseId: world.warehouseId, code: "F1-L30-16" },
      );
      expect(exact.value.location?.code).toBe("F1-L30-16");
      // One bounded identity request, independent of warehouse size.
      expect(exact.measure.queries).toBeLessThanOrEqual(24);
    }
  });

  it("never reports a miss before the fallback is exhausted, and bounds each request", async () => {
    const world = await setup(1000);
    const { page, trace } = await finish(world, { text: "NO-SUCH-PLACE" });
    expect(page.items).toEqual([]);
    expect(page.isDone).toBe(true);
    expect(trace.slice(0, -1).every((step) => step.status === "scanning")).toBe(
      true,
    );
    // Previously 50 sequential requests at 1,000 locations.
    expect(trace.length).toBeLessThanOrEqual(8);
    for (const step of trace)
      expect(step.measure.gets + step.measure.queries).toBeLessThan(1_000);
  });

  it("keeps case-insensitive interior substring and Thai name matching", async () => {
    const world = await setup(121);
    const interior = await finish(world, { text: "l30-1" });
    expect(interior.page.items.map((row) => row.code).sort()).toEqual([
      "A-00060",
      "F1-L30-16",
    ]);
    const thai = await finish(world, { text: "ปลายทาง" });
    expect(thai.page.items.map((row) => row.name)).toEqual(["ชั้นวางปลายทาง"]);
  });

  it("answers a canonical QR in one request and respects the building filter", async () => {
    const world = await setup(30);
    const id = world.created.at(-1)!;
    const direct = await finish(world, { text: `ISAS:LOCATION:1:${id}` });
    expect(direct.trace).toHaveLength(1);
    expect(direct.page.items.map((row) => row.locationId)).toEqual([id]);
    const filtered = await finish(world, {
      text: `ISAS:LOCATION:1:${id}`,
      buildingId: world.buildingB,
    });
    expect(filtered.page.items).toEqual([]);
  });

  it.each([false, true])(
    "filters by building on the server, including legacy rows without buildingId (legacy=%s)",
    async (legacy) => {
      const world = await setup(45, { kind: "mixed", legacy, second: 25 });
      const all = new Set<string>();
      let cursor: string | undefined;
      for (let pages = 0; pages < 5; pages += 1) {
        const { page } = await finish(world, {
          text: "",
          buildingId: world.buildingB,
          ...(cursor ? { cursor } : {}),
        });
        for (const row of page.items) {
          expect(row.buildingId).toBe(world.buildingB);
          all.add(row.locationId);
        }
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
      expect(all.size).toBe(25);
      // The filter keeps the query; prefix lanes are also scoped.
      const scoped = await finish(world, {
        text: "B-0001",
        buildingId: world.buildingB,
      });
      expect(scoped.page.items.map((row) => row.code)).toEqual(
        Array.from({ length: 10 }, (_, i) => `B-0001${i}`),
      );
      const outside = await finish(world, {
        text: "F1-L30",
        buildingId: world.buildingB,
      });
      expect(outside.page.items).toEqual([]);
      const resolved = await invoke<{ ok: boolean; error?: { code: string } }>(
        world,
        locations.resolve,
        {
          warehouseId: world.warehouseId,
          code: "F1-L30-16",
          buildingId: world.buildingB,
        },
      );
      expect(resolved.value.error?.code).toBe("OUTSIDE_BUILDING_FILTER");
    },
  );

  it("answers empty, draft and foreign buildings without scanning the warehouse", async () => {
    const world = await setup(1000);
    const empty = await finish(world, { text: "", buildingId: world.empty });
    expect(empty.trace).toHaveLength(1);
    expect(empty.page).toMatchObject({ status: "ready", isDone: true });
    expect(empty.page.items).toEqual([]);
    const draft = await finish(world, { text: "", buildingId: world.draft });
    expect(draft.trace).toHaveLength(1);
    expect(draft.page.buildingUnavailable).toBe(true);
  });

  it.each([20, 50, 100])(
    "traverses mixed named, physical and legacy rows at page size %i without gaps or duplicates",
    async (pageSize) => {
      const world = await setup(121, { kind: "mixed", legacy: true });
      const seen: string[] = [];
      let cursor: string | undefined;
      let requests = 0;
      for (let pages = 0; pages < 10; pages += 1) {
        const { page, trace } = await finish(world, {
          text: "",
          pageSize,
          ...(cursor ? { cursor } : {}),
        });
        requests += trace.length;
        expect(page.items.length).toBeLessThanOrEqual(pageSize);
        seen.push(...page.items.map((row) => row.locationId));
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
      expect(seen).toHaveLength(121);
      expect(new Set(seen).size).toBe(121);
      expect(requests).toBeLessThanOrEqual(Math.ceil(121 / pageSize) + 1);
    },
  );

  it("keeps cursors stable when rows are inserted or archived around a page boundary", async () => {
    const world = await setup(40);
    const first = await finish(world, { text: "" });
    const boundary = first.page.items.at(-1)!.code;
    await world.t.run(async (ctx) => {
      // Before the boundary: belongs to page 1 and must not appear on page 2.
      await ctx.db.insert("locations", {
        orgId: world.orgA,
        warehouseId: world.warehouseId,
        code: "A-00000-EARLY",
        label: "Early",
        status: "ACTIVE",
        locationType: "NAMED_STORAGE",
        buildingId: world.buildingA,
      });
      // Archive the first row of page 2.
      const next = await ctx.db
        .query("locations")
        .withIndex("by_orgId_warehouseId_code", (q) =>
          q
            .eq("orgId", world.orgA)
            .eq("warehouseId", world.warehouseId)
            .eq("code", "A-00020"),
        )
        .first();
      await ctx.db.patch(next!._id, { status: "INACTIVE" });
    });
    const second = await finish(world, {
      text: "",
      cursor: first.page.continueCursor,
    });
    const codes = second.page.items.map((row) => row.code);
    expect(codes[0]! > boundary).toBe(true);
    expect(codes).not.toContain("A-00000-EARLY");
    expect(codes).not.toContain("A-00020");
    expect(codes).toHaveLength(19);
  });

  it("refuses other warehouses and tenants, and resets cursors from other criteria", async () => {
    const world = await setup(700);
    for (const warehouseId of [
      world.warehouses.bravoA,
      world.warehouses.alphaB,
    ])
      await expect(
        invoke(world, locations.searchPage, {
          warehouseId,
          text: "",
          pageSize: 20,
        }),
      ).rejects.toThrow(/WAREHOUSE_OUT_OF_SCOPE|WAREHOUSE_UNKNOWN/);
    const first = await finish(world, { text: "" });
    for (const changed of [
      { text: "A-" },
      { text: "", buildingId: world.buildingB },
      { text: "", pageSize: 50 },
    ]) {
      const reused = await invoke<Page>(world, locations.searchPage, {
        warehouseId: world.warehouseId,
        pageSize: 20,
        ...changed,
        cursor: first.page.continueCursor,
      });
      expect(reused.value.status).toBe("reset");
    }
    const started = await invoke<Page>(world, locations.searchPage, {
      warehouseId: world.warehouseId,
      text: "nothing",
      pageSize: 20,
    });
    expect(started.value.status).toBe("scanning");
    // A continuation belongs to the page it started on.
    const state = JSON.parse(started.value.scanCursor!);
    const moved = await invoke<Page>(world, locations.searchPage, {
      warehouseId: world.warehouseId,
      text: "nothing",
      pageSize: 20,
      scanCursor: JSON.stringify({ ...state, base: { s: 1 } }),
    });
    expect(moved.value.status).toBe("reset");
    for (const tampered of [
      "not json",
      JSON.stringify({ scope: "x", pos: { s: 0 } }),
      started.value.scanCursor!.replace('"s":', '"s":"0",'),
    ]) {
      const result = await invoke<Page>(world, locations.searchPage, {
        warehouseId: world.warehouseId,
        text: "nothing",
        pageSize: 20,
        scanCursor: tampered,
      });
      expect(result.value.status).toBe("reset");
    }
  });

  it("pages active building options independently of the location page", async () => {
    const world = await setup(3);
    await world.t.run(async (ctx) => {
      const source = (await ctx.db.get(world.buildingA))!;
      const { _id, _creationTime, ...fields } = source;
      void _id;
      void _creationTime;
      for (let i = 0; i < 60; i += 1)
        await ctx.db.insert("storageBuildings", {
          ...fields,
          code: `Z-${String(i).padStart(2, "0")}`,
          name: i === 59 ? "คลังสุดท้าย" : `Extra ${i}`,
        });
    });
    type Options = {
      page: { buildingId: string; code: string; name: string }[];
      isDone: boolean;
      continueCursor: string;
    };
    const first = await finish(world, {}, locations.buildingOptions);
    const options = first.page as unknown as Options;
    expect(options.page).toHaveLength(50);
    expect(options.isDone).toBe(false);
    const second = await finish(
      world,
      { cursor: options.continueCursor },
      locations.buildingOptions,
    );
    const codes = [
      ...options.page.map((row) => row.code),
      ...(second.page as unknown as Options).page.map((row) => row.code),
    ];
    // Three active fixtures plus 60 extras; the draft building is excluded.
    expect(codes).toHaveLength(63);
    expect(codes).not.toContain("BUILDING-DRAFT");
    const searched = await finish(
      world,
      { search: "สุดท้าย" },
      locations.buildingOptions,
    );
    expect(
      (searched.page as unknown as Options).page.map((row) => row.code),
    ).toEqual(["Z-59"]);
  });

  it("backfills legacy building metadata in bounded, idempotent batches", async () => {
    const world = await setup(130, { legacy: true });
    await world.t.run(async (ctx) => {
      await ctx.db.insert("locations", {
        orgId: world.orgA,
        warehouseId: world.warehouseId,
        code: "DOCK-1",
        status: "ACTIVE",
        locationType: "DOCK",
      });
    });
    const runBackfill = (cursor?: string) =>
      world.t.run((ctx) =>
        (backfill as unknown as Runtime)._handler(
          ctx as GenericMutationCtx<DataModel>,
          { warehouseId: world.warehouseId, ...(cursor ? { cursor } : {}) },
        ),
      ) as Promise<{
        done: boolean;
        updated: number;
        skipped: number;
        cursor?: string;
      }>;
    let cursor: string | undefined;
    let updated = 0;
    for (let calls = 0; calls < 10; calls += 1) {
      const result = await runBackfill(cursor);
      updated += result.updated;
      if (result.done) break;
      cursor = result.cursor;
    }
    expect(updated).toBe(130);
    expect((await runBackfill()).updated).toBe(0);
    const rows = await world.t.run((ctx) =>
      ctx.db.query("locations").collect(),
    );
    expect(
      rows
        .filter((row) => row.locationType !== "DOCK")
        .every(
          (row) =>
            row.buildingId === world.buildingA && row.floorId === world.floorA,
        ),
    ).toBe(true);
    const filtered = await finish(world, {
      text: "",
      buildingId: world.buildingA,
    });
    expect(filtered.page.items).toHaveLength(20);
  });
});

describe("location building metadata writers", () => {
  it("stores building and floor on ledger rows created by the floor planner", async () => {
    const world = await createConvexTenantWorld();
    await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
    const warehouseId = world.warehouses.alphaA;
    const write = (fn: unknown, args: unknown) =>
      world.t
        .withIdentity(identity)
        .run((ctx) =>
          (fn as Runtime)._handler(ctx as GenericMutationCtx<DataModel>, args),
        ) as Promise<{ value: { documentId: string } }>;
    const building = await write(createStorageBuilding, {
      warehouseId,
      requestId: "writer-building",
      code: "WRITER",
      name: "Writer",
      widthMm: 30000,
      depthMm: 20000,
      defaultFloorHeightMm: 4000,
      floorCount: 1,
    });
    const buildingId = building.value.documentId as Id<"storageBuildings">;
    await write(createStorageZone, {
      warehouseId,
      buildingId,
      requestId: "writer-zone",
      floorNumber: 1,
      label: "Writer zone",
      xMm: 0,
      yMm: 0,
      widthMm: 2000,
      depthMm: 2000,
      maxStackHeightMm: 3000,
    });
    const rows = await world.t.run(async (ctx) => ({
      locations: await ctx.db.query("locations").collect(),
      zones: await ctx.db.query("storageZones").collect(),
    }));
    expect(rows.locations).toHaveLength(1);
    expect(rows.locations[0]).toMatchObject({
      buildingId,
      floorId: rows.zones[0]!.floorId,
    });
  });
});

describe("storage location catalogue search", () => {
  it("searches sparse text in a bounded number of requests instead of two per zone", async () => {
    const world = await setup(1000);
    const sparse = await finish(world, { search: "ปลายทาง" }, cataloguePage);
    expect(sparse.page.page.map((row) => row.label)).toEqual([
      "ชั้นวางปลายทาง",
    ]);
    // Previously 2,000 sequential requests.
    expect(sparse.trace.length).toBeLessThanOrEqual(12);
    const totals = total(sparse.trace);
    expect(totals.gets + totals.queries).toBeLessThan(6_000);
    const blank = await finish(world, {}, cataloguePage);
    expect(blank.trace).toHaveLength(1);
    expect(blank.page.page).toHaveLength(20);
  });

  it("pushes building filters into the index: an empty building costs one request", async () => {
    const world = await setup(1000, { second: 5 });
    const empty = await finish(
      world,
      { buildingId: world.empty },
      cataloguePage,
    );
    expect(empty.trace).toHaveLength(1);
    expect(empty.page.page).toEqual([]);
    const second = await finish(
      world,
      { buildingId: world.buildingB, floorNumber: 1, status: "ACTIVE" },
      cataloguePage,
    );
    expect(second.trace).toHaveLength(1);
    expect(second.page.page.map((row) => row.buildingId)).toEqual(
      Array(5).fill(world.buildingB),
    );
    const mismatched = await finish(
      world,
      { buildingId: world.buildingB, status: "DRAFT" },
      cataloguePage,
    );
    expect(mismatched.trace).toHaveLength(1);
    expect(mismatched.page.page).toEqual([]);
  });
});

/** Actual handler with the index rows it read, grouped per table. */
async function invokeRows<T>(
  world: ConvexTenantWorld,
  fn: unknown,
  args: unknown,
): Promise<{ value: T; rows: Record<string, number> }> {
  const rows: Record<string, number> = {};
  const result = (await world.t.withIdentity(identity).run(async (ctx) => {
    const db = new Proxy(ctx.db, {
      get(target, property, receiver) {
        const member = Reflect.get(target, property, receiver);
        if (property !== "query")
          return typeof member === "function" ? member.bind(target) : member;
        return (table: string) => {
          const query = Reflect.apply(member, target, [table]) as object;
          return new Proxy(query, {
            get(q, name, r) {
              const method = Reflect.get(q, name, r);
              if (name !== "withIndex")
                return typeof method === "function" ? method.bind(q) : method;
              return (...params: unknown[]) => {
                const bounded = Reflect.apply(method, q, params) as object;
                return new Proxy(bounded, {
                  get(b, operation, br) {
                    const fnMember = Reflect.get(b, operation, br);
                    if (operation !== "take")
                      return typeof fnMember === "function"
                        ? fnMember.bind(b)
                        : fnMember;
                    return async (count: number) => {
                      const found = (await Reflect.apply(fnMember, b, [
                        count,
                      ])) as unknown[];
                      rows[table] = (rows[table] ?? 0) + found.length;
                      return found;
                    };
                  },
                });
              };
            },
          });
        };
      },
    });
    return (fn as Runtime)._handler(
      { ...ctx, db } as GenericMutationCtx<DataModel>,
      args,
    );
  })) as { ok: boolean; value: T };
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return { value: result.value, rows };
}

/** One active building and floor-planner areas created by the public writers. */
async function plannerWorld() {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
  const warehouseId = world.warehouses.alphaA;
  const write = (fn: unknown, args: unknown) =>
    world.t
      .withIdentity(identity)
      .run((ctx) =>
        (fn as Runtime)._handler(ctx as GenericMutationCtx<DataModel>, args),
      ) as Promise<{ ok: boolean; value: { documentId: string } }>;
  const made = await write(createStorageBuilding, {
    warehouseId,
    requestId: "review-building",
    code: "AUD",
    name: "Audit",
    widthMm: 60000,
    depthMm: 20000,
    defaultFloorHeightMm: 4000,
    floorCount: 1,
  });
  const buildingId = made.value.documentId as Id<"storageBuildings">;
  await world.t.run((ctx) => ctx.db.patch(buildingId, { status: "ACTIVE" }));
  const makeZone = async (n: number) => {
    const result = await write(createStorageZone, {
      warehouseId,
      buildingId,
      requestId: `review-zone-${n}`,
      floorNumber: 1,
      label: `Spot ${n}`,
      xMm: n * 2000,
      yMm: 0,
      widthMm: 1000,
      depthMm: 1000,
      maxStackHeightMm: 3000,
    });
    expect(result.ok, JSON.stringify(result)).toBe(true);
  };
  return { ...world, warehouseId, buildingId, makeZone };
}

describe("review regressions: cursor stability and bounded descendants", () => {
  it.each(["patch", "backfill"] as const)(
    "keeps a legacy physical row reachable when building metadata is filled between pages (%s)",
    async (mode) => {
      const world = await plannerWorld();
      await world.makeZone(0);
      const legacy = await world.t.run(async (ctx) => {
        const zone = (await ctx.db.query("storageZones").collect())[0]!;
        await ctx.db.patch(zone.locationId!, {
          buildingId: undefined,
          floorId: undefined,
          status: "ACTIVE",
        });
        // 20 earlier and 5 later named rows around the legacy area's code.
        for (const code of [
          ...Array.from(
            { length: 20 },
            (_, n) => `AA-${String(n).padStart(2, "0")}`,
          ),
          ...Array.from({ length: 5 }, (_, n) => `ZZ-0${n}`),
        ])
          await ctx.db.insert("locations", {
            orgId: world.orgA,
            warehouseId: world.warehouseId,
            buildingId: world.buildingId,
            code,
            label: `Named ${code}`,
            locationType: "NAMED_STORAGE",
            status: "ACTIVE",
          });
        return zone;
      });
      const args = {
        warehouseId: world.warehouseId,
        buildingId: world.buildingId,
        text: "",
        pageSize: 20,
      };
      const first = await invoke<Page>(world, locations.searchPage, args);
      expect(first.value.status).toBe("ready");
      expect(first.value.items.map((row) => row.code)).not.toContain(
        legacy.code,
      );
      if (mode === "patch")
        await world.t.run((ctx) =>
          ctx.db.patch(legacy.locationId!, {
            buildingId: world.buildingId,
            floorId: legacy.floorId,
          }),
        );
      else
        await world.t.run((ctx) =>
          (backfill as unknown as Runtime)._handler(
            ctx as GenericMutationCtx<DataModel>,
            { warehouseId: world.warehouseId },
          ),
        );
      const migrated = await world.t.run((ctx) =>
        ctx.db.get(legacy.locationId!),
      );
      expect(migrated?.buildingId).toBe(world.buildingId);
      const next = await finish(world, {
        ...args,
        cursor: first.value.continueCursor,
      });
      const codes = next.page.items.map((row) => row.code);
      // Merged in code order: the area sorts between AA-* and ZZ-*.
      expect(codes).toEqual([legacy.code, ...codes.slice(1)]);
      expect(codes.slice(1)).toEqual(
        Array.from({ length: 5 }, (_, n) => `ZZ-0${n}`),
      );
      expect(next.page.isDone).toBe(true);
    },
  );

  it("keeps blank browse in global code order while legacy rows remain", async () => {
    const world = await setup(30, { kind: "mixed", legacy: true });
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let pages = 0; pages < 5; pages += 1) {
      const { page } = await finish(world, {
        text: "",
        buildingId: world.buildingA,
        ...(cursor ? { cursor } : {}),
      });
      seen.push(...page.items.map((row) => row.code));
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    expect(seen).toHaveLength(30);
    expect(seen).toEqual([...seen].sort());
  });

  it("bounds descendant reads per request and resumes long position history without capping it", async () => {
    const world = await plannerWorld();
    for (let n = 0; n < 12; n += 1) await world.makeZone(n);
    const zones = await world.t.run((ctx) =>
      ctx.db.query("storageZones").collect(),
    );
    const addHistory = (
      zone: (typeof zones)[number],
      n: number,
      from: number,
      to: number,
    ) =>
      world.t.run(async (ctx) => {
        for (let i = from; i < to; i += 1) {
          const code = `HIST-${n}-${String(i).padStart(4, "0")}`;
          const locationId = await ctx.db.insert("locations", {
            orgId: world.orgA,
            warehouseId: world.warehouseId,
            buildingId: zone.buildingId,
            floorId: zone.floorId,
            code,
            locationType: "FLOOR_BLOCK",
            status: "INACTIVE",
          });
          await ctx.db.insert("storagePositions", {
            orgId: world.orgA,
            warehouseId: world.warehouseId,
            buildingId: zone.buildingId,
            floorId: zone.floorId,
            zoneId: zone._id,
            locationId,
            code,
            label: i === 999 ? "late needle" : "Historical position",
            qrValue: `ISAS:LOCATION:1:${locationId}`,
            kind: "FLOOR",
            isDefault: false,
            status: "INACTIVE",
            createdAt: 1,
            updatedAt: 1,
            createdByUserId: world.userA,
            updatedByUserId: world.userA,
          });
        }
      });
    for (const [n, zone] of zones.entries()) await addHistory(zone, n, 0, 120);

    const follow = async (search: string) => {
      const steps: { status: string; positions: number; all: number }[] = [];
      let scanCursor: string | undefined;
      for (let request = 0; request < 50; request += 1) {
        const { value, rows } = await invokeRows<Page>(world, cataloguePage, {
          warehouseId: world.warehouseId,
          pageSize: 20,
          search,
          ...(scanCursor ? { scanCursor } : {}),
        });
        steps.push({
          status: value.status,
          positions: rows.storagePositions ?? 0,
          all: Object.values(rows).reduce((sum, count) => sum + count, 0),
        });
        if (value.status !== "scanning") return { value, steps };
        scanCursor = value.scanCursor;
      }
      throw new Error("Catalogue search did not finish");
    };

    // Previously one request read all 1,452 position rows (budget 1,200).
    const sparse = await follow("NEVER_MATCH");
    expect(sparse.value).toMatchObject({ status: "ready", isDone: true });
    expect(sparse.value.page).toEqual([]);
    expect(sparse.steps.length).toBeGreaterThan(1);
    for (const step of sparse.steps) {
      // Budget plus at most one bounded position chunk.
      expect(step.positions).toBeLessThanOrEqual(1_200 + 100);
      expect(step.all).toBeLessThanOrEqual(1_200 + 100 + 120);
    }
    // Suspended areas resume where they stopped instead of starting again.
    const read = sparse.steps.reduce((sum, step) => sum + step.positions, 0);
    expect(read).toBeLessThanOrEqual(12 * 121 + 100);

    // Exactly 1,000 inactive positions previously raised INTERNAL_ERROR.
    await addHistory(zones[0]!, 0, 120, 1_000);
    const late = await follow("late needle");
    expect(late.value.status).toBe("ready");
    expect(late.value.page.map((row) => row._id)).toEqual([zones[0]!._id]);
    for (const step of late.steps)
      expect(step.positions).toBeLessThanOrEqual(1_200 + 100);
    // A match spanning two adjacent positions across a read chunk.
    const spanning = await follow("hist-0-0099 historical");
    expect(spanning.value.page.map((row) => row._id)).toEqual([zones[0]!._id]);
  });

  it("never repeats a renamed building, resets on a moved boundary, and keeps equal-code ties", async () => {
    type Options = {
      status: string;
      page: { buildingId: string; code: string }[];
      isDone: boolean;
      continueCursor: string;
    };
    const options = (world: Fixture, args: Record<string, unknown> = {}) =>
      invoke<Options>(world, locations.buildingOptions, {
        warehouseId: world.warehouseId,
        ...args,
      }).then((result) => result.value);
    const world = await setup(1);
    const insertBuildings = (codes: string[]) =>
      world.t.run(async (ctx) => {
        const { _id, _creationTime, ...fields } = (await ctx.db.get(
          world.buildingA,
        ))!;
        void _id;
        void _creationTime;
        for (const code of codes)
          await ctx.db.insert("storageBuildings", { ...fields, code });
      });
    // 45 + BUILDING-A/B/EMPTY = 48, then four rows share the code TIE.
    await insertBuildings([
      ...Array.from(
        { length: 45 },
        (_, n) => `AAA-${String(n).padStart(2, "0")}`,
      ),
      "TIE",
      "TIE",
      "TIE",
      "TIE",
    ]);
    const first = await options(world);
    expect(first.page).toHaveLength(50);
    expect(first.isDone).toBe(false);
    const second = await options(world, { cursor: first.continueCursor });
    const ids = [...first.page, ...second.page].map((row) => row.buildingId);
    expect(ids).toHaveLength(52);
    expect(new Set(ids).size).toBe(52);
    expect(second.isDone).toBe(true);

    // Rename an already shown row past the boundary: not repeated on Next.
    const renamed = first.page[0]!;
    await world.t.run((ctx) =>
      ctx.db.patch(renamed.buildingId as Id<"storageBuildings">, {
        code: "ZZZ-RENAMED",
      }),
    );
    const afterRename = await options(world, { cursor: first.continueCursor });
    expect(afterRename.status).toBe("ready");
    expect(afterRename.page.map((row) => row.buildingId)).not.toContain(
      renamed.buildingId,
    );

    // Renaming the boundary row itself invalidates the page cursor.
    const boundary = first.page.at(-1)!;
    await world.t.run((ctx) =>
      ctx.db.patch(boundary.buildingId as Id<"storageBuildings">, {
        code: "AAA-MOVED",
      }),
    );
    const moved = await options(world, { cursor: first.continueCursor });
    expect(moved.status).toBe("reset");
    // A fresh first page lists every building exactly once.
    const fresh = await options(world);
    const freshNext = await options(world, { cursor: fresh.continueCursor });
    const all = [...fresh.page, ...freshNext.page].map((row) => row.buildingId);
    expect(new Set(all).size).toBe(52);
    expect(all).toHaveLength(52);
  });

  it("reports isDone only when nothing else matches, so a full page never hides an empty next page", async () => {
    const world = await setup(1);
    await world.t.run(async (ctx) => {
      const { _id, _creationTime, ...fields } = (await ctx.db.get(
        world.buildingA,
      ))!;
      void _id;
      void _creationTime;
      // Three active fixtures + 47 = exactly 50 options.
      for (let n = 0; n < 47; n += 1)
        await ctx.db.insert("storageBuildings", {
          ...fields,
          code: `AAA-${String(n).padStart(2, "0")}`,
        });
    });
    const exact = await finish(world, {}, locations.buildingOptions);
    expect(exact.page).toMatchObject({ status: "ready", isDone: true });
    expect(exact.page.page).toHaveLength(50);

    // Exactly 20 picker matches, the last found by the contains fallback.
    const picker = await setup(40);
    await picker.t.run(async (ctx) => {
      const rows = await ctx.db.query("storagePositions").collect();
      for (const row of rows.slice(0, 19))
        await ctx.db.patch(row._id, { label: `Exact twenty ${row.code}` });
      await ctx.db.patch(rows.at(-2)!._id, { label: "twenty at the end" });
    });
    const twenty = await finish(picker, { text: "twenty" });
    expect(twenty.page).toMatchObject({ status: "ready", isDone: true });
    expect(twenty.page.items).toHaveLength(20);
    // One more match: page 1 is full and isDone is false; page 2 holds it.
    await picker.t.run(async (ctx) => {
      const rows = await ctx.db.query("storagePositions").collect();
      await ctx.db.patch(rows.at(-3)!._id, { label: "twenty plus one" });
    });
    const more = await finish(picker, { text: "twenty" });
    expect(more.page).toMatchObject({ status: "ready", isDone: false });
    expect(more.page.items).toHaveLength(20);
    const rest = await finish(picker, {
      text: "twenty",
      cursor: more.page.continueCursor,
    });
    expect(rest.page).toMatchObject({ status: "ready", isDone: true });
    expect(rest.page.items).toHaveLength(1);
  });

  it("accepts an ignored attempt argument without invalidating cursors", async () => {
    const world = await setup(45);
    const first = await finish(world, { text: "" });
    const retried = await finish(world, {
      text: "",
      attempt: 2,
      cursor: first.page.continueCursor,
    });
    const plain = await finish(world, {
      text: "",
      cursor: first.page.continueCursor,
    });
    expect(retried.page.status).toBe("ready");
    expect(retried.page.items).toEqual(plain.page.items);
    const buildings = await finish(
      world,
      { attempt: 1 },
      locations.buildingOptions,
    );
    expect(buildings.page.status).toBe("ready");
  });
});
