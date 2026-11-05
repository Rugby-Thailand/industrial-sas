import { expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { deleteJobScans } from "../../convex/finishedGoods/jobScans";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
} from "../fixtures/convex-tenant-world";
import { measured } from "../fixtures/query-read-stats";

it("atomically deletes 300 diverse scans within read-call limits and completes deferred cleanup", async () => {
  const world = await createConvexTenantWorld(
    {
      "../convex/finishedGoods/jobScans.ts": () =>
        import("../../convex/finishedGoods/jobScans"),
      "../convex/finishedGoods/searchIndexBackfill.ts": () =>
        import("../../convex/finishedGoods/searchIndexBackfill"),
    },
    { transactionLimits: true },
  );
  await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
  const warehouseId = world.warehouses.alphaA;
  const actor = world.t.withIdentity({
    subject: "user_fixture_a",
    org_id: "org_fixture_a",
  });
  for (let start = 0; start < 300; start += 10) {
    const result = await actor.mutation(
      api.finishedGoods.jobScans.saveJobScans,
      {
        warehouseId,
        requestId: `limit-save-${start}`,
        locationText: "LIMIT-PROBE",
        items: Array.from({ length: 10 }, (_, offset) => {
          const i = start + offset;
          const text = `value-${i.toString(36).padStart(3, "0")}-abcdef`;
          return {
            factoryOrder: `FO69${950000 + i}`,
            productBarcodeText: `LIMIT-${text}`,
            partName: `PART-${text}`,
            customer: `CUSTOMER-${text}`,
            quantity: 100,
            source: "MANUAL" as const,
          };
        }),
      },
    );
    expect(result).toMatchObject({ ok: true, value: { written: true } });
  }
  let backfill = await world.t.mutation(
    internal.finishedGoods.searchIndexBackfill.run,
    { warehouseId, kind: "jobScans", restart: true, batchSize: 10 },
  );
  while (!backfill.isDone)
    backfill = await world.t.mutation(
      internal.finishedGoods.searchIndexBackfill.run,
      {
        warehouseId,
        kind: "jobScans",
        cursor: backfill.continueCursor,
        runId: backfill.runId,
        batchSize: 10,
      },
    );
  expect(backfill.ready).toBe(true);
  const ids = await world.t.run(async (ctx) =>
    (await ctx.db.query("finishedGoodsJobScans").collect()).map(
      (row) => row._id,
    ),
  );
  expect(ids).toHaveLength(300);
  const result = await measured<{ written: boolean }>(world, deleteJobScans, {
    warehouseId,
    requestId: "limit-delete-300",
    ids,
  });
  expect(result.value.written).toBe(true);
  const calls = [
    ...Object.values(result.stats.ranges),
    ...Object.values(result.stats.gets),
  ].reduce((sum, n) => sum + n, 0);
  expect(calls).toBeLessThan(4096);
  expect(
    await world.t.run((ctx) => ctx.db.query("finishedGoodsJobScans").collect()),
  ).toEqual([]);
  const search = await actor.query(api.finishedGoods.jobScans.listJobScans, {
    warehouseId,
    search: "LIMIT",
    filter: "ALL",
    pageSize: 50,
    progressive: true,
  });
  expect(search).toMatchObject({ ok: true, value: { items: [] } });
  for (let round = 0; round < 100; round++) {
    await new Promise((resolve) => setTimeout(resolve, 2));
    await world.t.finishInProgressScheduledFunctions();
    const jobs = await world.t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(jobs.filter((job) => job.state.kind === "failed")).toEqual([]);
    if (
      jobs.every(
        (job) => job.state.kind === "success" || job.state.kind === "canceled",
      )
    )
      break;
    if (round === 99) throw Error("Deferred cleanup did not finish");
  }
  const leftovers = await world.t.run(async (ctx) => ({
    rows: (await ctx.db.query("finishedGoodsJobScanSearchRows").collect())
      .length,
    grams: (await ctx.db.query("finishedGoodsJobScanGrams").collect()).length,
    terms: (await ctx.db.query("finishedGoodsJobScanTerms").collect()).length,
    termGrams: (await ctx.db.query("finishedGoodsJobScanTermGrams").collect())
      .length,
  }));
  expect(leftovers).toEqual({ rows: 0, grams: 0, terms: 0, termGrams: 0 });
}, 120000);
