import { afterEach, expect, it, vi } from "vitest";
import type { MutationCtx } from "../../convex/_generated/server";
import type { Id } from "../../convex/_generated/dataModel";
import { measured } from "../fixtures/query-read-stats";
import { reconcile } from "../../convex/finishedGoods/searchIndexBackfill";
import { api, internal } from "../../convex/_generated/api";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
} from "../fixtures/convex-tenant-world";

afterEach(() => vi.useRealTimers());

it.each([
  { mode: "maintained", expected: "done", added: 1 },
  { mode: "raw", expected: "done", added: 1 },
  { mode: "overflow", expected: "rebuilding", added: 101 },
  { mode: "generation-mismatch", expected: "rebuilding", added: 1 },
])(
  "reconciles $mode building creation in a 101-building warehouse",
  async ({ mode, expected, added }) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = Date.UTC(2026, 10, 5);
    vi.setSystemTime(start);
    const world = await createConvexTenantWorld({
      "../convex/finishedGoods/searchIndexBackfill.ts": () =>
        import("../../convex/finishedGoods/searchIndexBackfill"),
      "../convex/storageLayouts/writes.ts": () =>
        import("../../convex/storageLayouts/writes"),
    });
    await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
    const warehouseId = world.warehouses.alphaA;
    await world.t.run(async (ctx) => {
      for (let index = 0; index < 101; index++)
        await ctx.db.insert("storageBuildings", {
          orgId: world.orgA,
          warehouseId,
          code: `B${index}`,
          name: `Building ${index}`,
          widthMm: 10_000,
          depthMm: 10_000,
          defaultFloorHeightMm: 3_000,
          floorCount: 1,
          totalHeightMm: 3_000,
          grossAreaSqMm: 100_000_000,
          reservedAreaSqMm: 0,
          usableAreaSqMm: 100_000_000,
          status: "DRAFT",
          version: 1,
          createdAt: start,
          createdByUserId: world.userA,
          updatedAt: start,
          updatedByUserId: world.userA,
        });
    });
    // The original buildings predate the reconciliation window.
    vi.setSystemTime(start + 120_000);
    const run = internal.finishedGoods.searchIndexBackfill.run;
    let built = await world.t.mutation(run, {
      warehouseId,
      kind: "jobScans",
      restart: true,
      batchSize: 25,
    });
    for (let page = 0; !built.isDone && page < 10; page++)
      built = await world.t.mutation(run, {
        warehouseId,
        kind: "jobScans",
        cursor: built.continueCursor,
        runId: built.runId,
        batchSize: 25,
      });
    expect(built.ready).toBe(true);

    if (mode === "maintained") {
      const created = await world.t
        .withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_a" })
        .mutation(api.storageLayouts.writes.createStorageBuilding, {
          warehouseId,
          requestId: "reconcile-maintained-building",
          code: "NEW",
          name: "New building window",
          widthMm: 10_000,
          depthMm: 10_000,
          defaultFloorHeightMm: 3_000,
          floorCount: 1,
        });
      expect(created).toMatchObject({ ok: true, value: { written: true } });
    } else {
      await world.t.run(async (ctx) => {
        const template = (await ctx.db.query("storageBuildings").first())!;
        const { _id, _creationTime, ...fields } = template;
        void _id;
        void _creationTime;
        for (let index = 0; index < added; index++)
          await ctx.db.insert("storageBuildings", {
            ...fields,
            code: `NEW-${index}`,
            name: `New building window ${index}`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
        if (mode === "generation-mismatch")
          await ctx.db.insert("storageCatalogueSignals", {
            orgId: world.orgA,
            warehouseId,
            generation: 1,
          });
      });
    }
    vi.setSystemTime(start + 210_000);
    const measurement = await measured<{ status: string }>(
      world,
      {
        _handler: async (
          ctx: MutationCtx,
          args: { warehouseId: Id<"warehouses">; kind: "jobScans" },
        ) => ({
          ok: true,
          value: await (
            reconcile as unknown as {
              _handler(
                ctx: MutationCtx,
                args: unknown,
              ): Promise<{ status: string }>;
            }
          )._handler(ctx, args),
        }),
      },
      {
        warehouseId,
        kind: "jobScans",
      },
    );
    const result = measurement.value;
    console.info(
      "BUILDING_RECONCILE",
      JSON.stringify({ mode, status: result.status, stats: measurement.stats }),
    );
    expect(result.status).toBe(expected);
    const state = await world.t.run((ctx) =>
      ctx.db
        .query("searchIndexReadiness")
        .withIndex("by_orgId_warehouseId_kind", (q) =>
          q
            .eq("orgId", world.orgA)
            .eq("warehouseId", warehouseId)
            .eq("kind", "jobScans"),
        )
        .unique(),
    );
    if (expected === "done") {
      expect(state).toMatchObject({ ready: true, runId: built.runId });
      const terms = await world.t.run((ctx) =>
        ctx.db.query("finishedGoodsJobScanTerms").collect(),
      );
      expect(
        terms.some((term) => term.text.includes("new building window")),
      ).toBe(true);
    } else {
      const scheduled = await world.t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").collect(),
      );
      expect(
        scheduled.some(
          (job) =>
            job.name === "finishedGoods/searchIndexBackfill:run" &&
            job.args[0]?.restart === true,
        ),
      ).toBe(true);
    }
  },
);
