import { describe, expect, it } from "vitest";

import { seedDemoDataForTenant } from "../../convex/lib/demoDataSeed";
import { createConvexTenantWorld } from "../fixtures/convex-tenant-world";

const CONFIRMATION = "SEED_INDUSTRIAL_SAS_DEMO";

describe("industrial SaaS demo data seed", () => {
  it("creates a connected demo once and keeps it tenant-bound", async () => {
    const world = await createConvexTenantWorld();
    const args = {
      organizationId: world.orgA,
      warehouseId: world.warehouses.alphaA,
      actorUserId: world.userA,
      confirmation: CONFIRMATION,
    };

    const first = await world.t.run(
      async (ctx) => await seedDemoDataForTenant(ctx, args),
    );
    const second = await world.t.run(
      async (ctx) => await seedDemoDataForTenant(ctx, args),
    );

    expect(first.inserted).toBeGreaterThan(70);
    expect(second.inserted).toBe(0);
    expect(second.reused).toBe(first.inserted);

    const evidence = await world.t.run(async (ctx) => {
      const item = await ctx.db
        .query("items")
        .withIndex("by_orgId_sku", (query) =>
          query.eq("orgId", world.orgA).eq("sku", "FG-BOX-300"),
        )
        .unique();
      const leakedItem = await ctx.db
        .query("items")
        .withIndex("by_orgId_sku", (query) =>
          query.eq("orgId", world.orgB).eq("sku", "FG-BOX-300"),
        )
        .unique();
      const transaction = await ctx.db
        .query("inventoryTransactions")
        .withIndex("by_orgId_operation_requestId", (query) =>
          query
            .eq("orgId", world.orgA)
            .eq("operation", "demo.receipt")
            .eq("requestId", "demo-receipt-1001"),
        )
        .unique();
      const lines =
        transaction === null
          ? []
          : await ctx.db
              .query("inventoryLedgerLines")
              .withIndex("by_orgId_transactionId_lineIndex", (query) =>
                query
                  .eq("orgId", world.orgA)
                  .eq("transactionId", transaction._id),
              )
              .collect();
      const building = await ctx.db
        .query("storageBuildings")
        .withIndex("by_orgId_warehouseId_code", (query) =>
          query
            .eq("orgId", world.orgA)
            .eq("warehouseId", world.warehouses.alphaA)
            .eq("code", "DEMO-BLDG"),
        )
        .unique();
      const purchaseOrder = await ctx.db
        .query("purchaseOrders")
        .withIndex("by_orgId_poNumber", (query) =>
          query.eq("orgId", world.orgA).eq("poNumber", "PO-DEMO-1001"),
        )
        .unique();
      const customerOrder = await ctx.db
        .query("customerOrders")
        .withIndex("by_orgId_orderNumber", (query) =>
          query.eq("orgId", world.orgA).eq("orderNumber", "SO-DEMO-26001"),
        )
        .unique();

      return {
        item,
        leakedItem,
        transaction,
        lineCount: lines.length,
        building,
        purchaseOrder,
        customerOrder,
      };
    });

    expect(evidence.item?.name).toContain("กล่องลูกฟูก");
    expect(evidence.leakedItem).toBeNull();
    expect(evidence.transaction?.lineCount).toBe(evidence.lineCount);
    expect(evidence.building?.floorCount).toBe(2);
    expect(evidence.purchaseOrder?.status).toBe("OPEN");
    expect(evidence.customerOrder?.status).toBe("RELEASED");
  });

  it("requires the explicit safety confirmation", async () => {
    const world = await createConvexTenantWorld();

    await expect(
      world.t.run(
        async (ctx) =>
          await seedDemoDataForTenant(ctx, {
            organizationId: world.orgA,
            warehouseId: world.warehouses.alphaA,
            actorUserId: world.userA,
            confirmation: "wrong",
          }),
      ),
    ).rejects.toThrow("Refusing demo seed");
  });
});
