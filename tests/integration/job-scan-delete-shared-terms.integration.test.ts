import { expect, it } from "vitest";
import { deleteJobScans } from "../../convex/finishedGoods/jobScans";
import type { Id } from "../../convex/_generated/dataModel";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
} from "../fixtures/convex-tenant-world";
import { measured } from "../fixtures/query-read-stats";

it("300 deletes with retained shared terms stay within read calls and preserve shared terms", async () => {
  const world = await createConvexTenantWorld({
    "../convex/finishedGoods/jobScans.ts": () =>
      import("../../convex/finishedGoods/jobScans"),
    "../convex/finishedGoods/searchIndexBackfill.ts": () =>
      import("../../convex/finishedGoods/searchIndexBackfill"),
  });
  await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
  const ids: Id<"finishedGoodsJobScans">[] = [];
  for (let start = 0; start < 300; start += 20) {
    ids.push(
      ...(await world.t.run(async (ctx) => {
        const selected: Id<"finishedGoodsJobScans">[] = [];
        const base = {
          orgId: world.orgA,
          warehouseId: world.warehouses.alphaA,
        };
        for (let group = start; group < start + 20; group++) {
          const text = `g${group.toString(36).padStart(2, "0")}`;
          const slots: Partial<
            Record<
              "t0" | "t1" | "t2" | "t3" | "t4" | "t5" | "t6",
              Id<"finishedGoodsJobScanTerms">
            >
          > = {};
          for (let field = 0; field < 7; field++) {
            const termId = await ctx.db.insert("finishedGoodsJobScanTerms", {
              ...base,
              field,
              key: text,
              text,
              shared: true,
            });
            slots[`t${field}` as keyof typeof slots] = termId;
            await ctx.db.insert("finishedGoodsJobScanTermGrams", {
              ...base,
              field,
              key: text,
              text,
              termId,
              gram: text,
            });
          }
          // A previously promoted term remains shared even after only two links remain.
          for (let copy = 0; copy < 2; copy++) {
            const scanId = await ctx.db.insert("finishedGoodsJobScans", {
              ...base,
              factoryOrder: text,
              productBarcodeText: text,
              partName: text,
              customer: text,
              locationText: text,
              locationCode: text,
              locationName: text,
              source: "MANUAL",
              mapped: false,
              createdAt: group,
              updatedAt: group,
              createdByUserId: world.userA,
              updatedByUserId: world.userA,
            });
            const row = await ctx.db.get(scanId);
            await ctx.db.insert("finishedGoodsJobScanSearchRows", {
              ...base,
              ...slots,
              scanId,
              createdAt: group,
              scanCreationTime: row!._creationTime,
              mapped: false,
            });
            if (copy === 0) selected.push(scanId);
          }
        }
        return selected;
      })),
    );
  }
  const result = await measured<{ written: boolean }>(world, deleteJobScans, {
    warehouseId: world.warehouses.alphaA,
    requestId: "shared-delete",
    ids,
  });
  expect(result.value.written).toBe(true);
  const calls = [
    ...Object.values(result.stats.ranges),
    ...Object.values(result.stats.gets),
  ].reduce((a, b) => a + b, 0);
  expect(calls).toBeLessThan(4096);
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
    if (round === 99) throw Error("Shared-term cleanup did not finish");
  }
  const remaining = await world.t.run(async (ctx) => ({
    scans: (await ctx.db.query("finishedGoodsJobScans").collect()).length,
    rows: (await ctx.db.query("finishedGoodsJobScanSearchRows").collect())
      .length,
    terms: (await ctx.db.query("finishedGoodsJobScanTerms").collect()).length,
    grams: (await ctx.db.query("finishedGoodsJobScanTermGrams").collect())
      .length,
  }));
  expect(remaining).toEqual({
    scans: 300,
    rows: 300,
    terms: 2100,
    grams: 2100,
  });
}, 120000);
