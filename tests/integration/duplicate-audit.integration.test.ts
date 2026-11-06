import { expect, it } from "vitest";
import type { GenericQueryCtx } from "convex/server";
import type { DataModel } from "../../convex/schema";
import { page } from "../../convex/operations/duplicateAudit";
import { createConvexTenantWorld } from "../fixtures/convex-tenant-world";

it("reports duplicate business keys in bounded resumable tenant pages without deleting records", async () => {
  const world = await createConvexTenantWorld();
  await world.t.run(async (ctx) => {
    for (const orgId of [world.orgA, world.orgA, world.orgB])
      await ctx.db.insert("finishedGoodsProducts", {
        orgId,
        warehouseId: world.warehouses.alphaA,
        sku: "DUP",
        name: "Product",
        unit: "PCS",
        storageFormat: "PALLET",
        storageCondition: "ANY",
        status: "ACTIVE",
        createdAt: 1,
        updatedAt: 1,
        createdByUserId: world.userA,
        updatedByUserId: world.userA,
      });
    for (let i = 0; i < 2; i++)
      await ctx.db.insert("finishedGoodsProducts", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        sku: "",
        name: "Draft",
        unit: "PCS",
        storageFormat: "PALLET",
        storageCondition: "ANY",
        status: "DRAFT",
        createdAt: 1,
        updatedAt: 1,
        createdByUserId: world.userA,
        updatedByUserId: world.userA,
      });
  });
  const contract = "finishedGoodsProducts.warehouseId+sku";
  type Result = {
    scanned: number;
    findings: Array<{ matchingIds: string[] }>;
    cursor: string;
    isDone: boolean;
  };
  const run = (orgId = world.orgA, cursor?: string) =>
    world.t.run((ctx) =>
      (
        page as unknown as {
          _handler: (
            ctx: GenericQueryCtx<DataModel>,
            args: unknown,
          ) => Promise<Result>;
        }
      )._handler(ctx, { orgId, contract, cursor, limit: 1 }),
    );
  let cursor: string | undefined;
  let findings = 0;
  for (let i = 0; i < 4; i++) {
    const result = await run(world.orgA, cursor);
    expect(result.scanned).toBe(1);
    findings += result.findings.length;
    for (const finding of result.findings)
      expect(finding.matchingIds).toHaveLength(2);
    cursor = result.cursor;
    if (result.isDone) break;
  }
  expect(findings).toBe(2);
  expect((await run(world.orgB)).findings).toEqual([]);
  expect(
    await world.t.run((ctx) => ctx.db.query("finishedGoodsProducts").collect()),
  ).toHaveLength(5);
});
