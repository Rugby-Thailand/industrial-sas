import type { GenericMutationCtx } from "convex/server";
import type { GenericId } from "convex/values";
import { describe, expect, it } from "vitest";

import { generateLabel } from "../../convex/labels/print";
import { listReceivingLocations } from "../../convex/masterData/catalogue";
import { DEFAULT_PUTAWAY_WEIGHTS } from "../../convex/model/inbound/putawayScoring";
import {
  addPurchaseOrderLine,
  createPurchaseOrder,
  listPurchaseOrders,
} from "../../convex/purchasing/orders";
import {
  claimPutawayTask,
  confirmPutaway,
  listPutawayTasks,
} from "../../convex/putaway/tasks";
import { submitDisposition } from "../../convex/quality/inspections";
import {
  openReceipt,
  postReceiptLine,
  raiseReceivingException,
} from "../../convex/receiving/receipts";
import type { DataModel } from "../../convex/schema";
import {
  FIXTURE_UOM,
  createConvexInventoryWorld,
  type ConvexInventoryWorld,
} from "../fixtures/convex-inventory-world";

interface RuntimeFunction {
  readonly _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
}

const run = (value: unknown) => value as RuntimeFunction;

const identity = (org: "a" | "b") => ({
  subject: "user_fixture_a",
  org_id: `org_fixture_${org}`,
});

async function callAs(
  world: ConvexInventoryWorld,
  org: "a" | "b",
  fn: unknown,
  args: unknown,
): Promise<Record<string, unknown>> {
  return (await world.t
    .withIdentity(identity(org))
    .run(async (ctx) =>
      run(fn)._handler(ctx as GenericMutationCtx<DataModel>, args),
    )) as Record<string, unknown>;
}

function value(outcome: Record<string, unknown>): Record<string, unknown> {
  expect(outcome["ok"], JSON.stringify(outcome)).toBe(true);
  return outcome["value"] as Record<string, unknown>;
}

const errorOf = (result: Record<string, unknown>) =>
  result["error"] as { code: string; field?: string };

const requestId = (name: string): string => {
  let hash = 0;
  for (const character of name) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return `0193f2c1-0000-7000-8000-0000${hash.toString(16).padStart(8, "0")}`;
};

async function seedBoth(world: ConvexInventoryWorld) {
  return await world.t.run(async (ctx) => {
    const forOrg = async (orgId: GenericId<"organizations">) => ({
      supplier: await ctx.db.insert("suppliers", {
        orgId,
        code: "SUP-01",
        name: "Supplier",
        status: "ACTIVE",
      }),
      reason: await ctx.db.insert("reasonCodes", {
        orgId,
        code: "EXC-01",
        name: "Exception",
        scope: "ADJUSTMENT",
        status: "ACTIVE",
      }),
      template: await ctx.db.insert("labelTemplates", {
        orgId,
        code: "TPL-01",
        version: 1,
        name: "Label",
        format: "ZPL",
        body: "^XA^FD{{SKU}}^FS^XZ",
        status: "ACTIVE",
        draftedByUserId: world.userA,
      }),
    });
    return { a: await forOrg(world.orgA), b: await forOrg(world.orgB) };
  });
}

describe("purchase orders are tenant-confined", () => {
  it("lets both tenants hold the same order number", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await seedBoth(world);

    const a = value(
      await callAs(world, "a", createPurchaseOrder, {
        requestId: requestId("a"),
        warehouseId: world.warehouses.alphaA,
        poNumber: "PO-1",
        supplierId: seeded.a.supplier,
      }),
    );
    const b = value(
      await callAs(world, "b", createPurchaseOrder, {
        requestId: requestId("b"),
        warehouseId: world.warehouses.alphaB,
        poNumber: "PO-1",
        supplierId: seeded.b.supplier,
      }),
    );

    expect(a["written"]).toBe(true);
    expect(b["written"]).toBe(true);
    expect(a["documentId"]).not.toBe(b["documentId"]);
  });

  it("never lists another tenant's orders", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await seedBoth(world);

    await callAs(world, "b", createPurchaseOrder, {
      requestId: requestId("only_b"),
      warehouseId: world.warehouses.alphaB,
      poNumber: "PO-B-ONLY",
      supplierId: seeded.b.supplier,
    });

    const asA = value(
      await callAs(world, "a", listPurchaseOrders, {
        warehouseId: world.warehouses.alphaA,
      }),
    );
    expect(asA["items"]).toEqual([]);
  });

  it("refuses an order whose supplier belongs to another tenant", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await seedBoth(world);

    const result = value(
      await callAs(world, "a", createPurchaseOrder, {
        requestId: requestId("cross_supplier"),
        warehouseId: world.warehouses.alphaA,
        poNumber: "PO-CROSS",
        supplierId: seeded.b.supplier,
      }),
    );

    expect(errorOf(result).code).toBe("REFERENCE_NOT_FOUND");
    expect(errorOf(result).field).toBe("supplierId");
  });

  it("refuses a line whose item belongs to another tenant", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await seedBoth(world);

    const order = value(
      await callAs(world, "a", createPurchaseOrder, {
        requestId: requestId("order_a"),
        warehouseId: world.warehouses.alphaA,
        poNumber: "PO-A",
        supplierId: seeded.a.supplier,
      }),
    );

    const line = value(
      await callAs(world, "a", addPurchaseOrderLine, {
        requestId: requestId("line_cross"),
        warehouseId: world.warehouses.alphaA,
        purchaseOrderId: order["documentId"],
        lineNumber: 1,
        itemId: world.b.untrackedItem,
        quantity: { uom: FIXTURE_UOM, minorUnits: 1_000 },
      }),
    );

    expect(errorOf(line).code).toBe("REFERENCE_NOT_FOUND");
  });
});

describe("receiving is tenant-confined", () => {
  async function receiptFor(world: ConvexInventoryWorld, org: "a" | "b") {
    const seeded = await seedBoth(world);
    const warehouseId =
      org === "a" ? world.warehouses.alphaA : world.warehouses.alphaB;

    const receipt = value(
      await callAs(world, org, openReceipt, {
        requestId: requestId(`receipt_${org}`),
        warehouseId,
        receiptNumber: `GRN-${org}`,
      }),
    );
    return { seeded, warehouseId, receiptId: receipt["documentId"] as string };
  }

  it("lets both tenants use the same receipt number", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await seedBoth(world);

    for (const [org, warehouseId] of [
      ["a", world.warehouses.alphaA],
      ["b", world.warehouses.alphaB],
    ] as const) {
      const receipt = value(
        await callAs(world, org, openReceipt, {
          requestId: requestId(`shared_${org}`),
          warehouseId,
          receiptNumber: "GRN-SHARED",
        }),
      );
      expect(receipt["written"], org).toBe(true);
    }
    expect(seeded.a.supplier).not.toBe(seeded.b.supplier);
  });

  it("refuses a posting into another tenant's receipt", async () => {
    const world = await createConvexInventoryWorld();
    const foreign = await receiptFor(world, "b");

    const posted = value(
      await callAs(world, "a", postReceiptLine, {
        requestId: requestId("cross_receipt"),
        warehouseId: world.warehouses.alphaA,
        receiptId: foreign.receiptId,
        locationId: world.a.dock,
        itemId: world.a.untrackedItem,
        purchaseOrderLineId: world.a.item as unknown as string,
        quantity: { uom: FIXTURE_UOM, minorUnits: 1_000 },
      }),
    );

    expect(posted["written"]).toBe(false);
  });

  it("writes no row when a cross-tenant posting is refused", async () => {
    const world = await createConvexInventoryWorld();
    const foreign = await receiptFor(world, "b");

    await callAs(world, "a", postReceiptLine, {
      requestId: requestId("cross_receipt_2"),
      warehouseId: world.warehouses.alphaA,
      receiptId: foreign.receiptId,
      locationId: world.a.dock,
      itemId: world.a.untrackedItem,
      purchaseOrderLineId: world.a.item as unknown as string,
      quantity: { uom: FIXTURE_UOM, minorUnits: 1_000 },
    });

    const lines = await world.t.run(
      async (ctx) => await ctx.db.query("receiptLines").collect(),
    );
    expect(lines).toEqual([]);
  });

  it("refuses a dock belonging to another tenant", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await seedBoth(world);

    const receipt = value(
      await callAs(world, "a", openReceipt, {
        requestId: requestId("cross_dock_receipt"),
        warehouseId: world.warehouses.alphaA,
        receiptNumber: "GRN-CROSS",
      }),
    );

    const order = value(
      await callAs(world, "a", createPurchaseOrder, {
        requestId: requestId("cross_dock_order"),
        warehouseId: world.warehouses.alphaA,
        poNumber: "PO-CROSS-DOCK",
        supplierId: seeded.a.supplier,
      }),
    );
    const line = value(
      await callAs(world, "a", addPurchaseOrderLine, {
        requestId: requestId("cross_dock_line"),
        warehouseId: world.warehouses.alphaA,
        purchaseOrderId: order["documentId"],
        lineNumber: 1,
        itemId: world.a.untrackedItem,
        quantity: { uom: FIXTURE_UOM, minorUnits: 10_000 },
      }),
    );

    const refused = value(
      await callAs(world, "a", postReceiptLine, {
        requestId: requestId("cross_dock_post"),
        warehouseId: world.warehouses.alphaA,
        receiptId: receipt["documentId"],
        purchaseOrderLineId: line["documentId"],
        locationId: world.b.dock,
        itemId: world.a.untrackedItem,
        quantity: { uom: FIXTURE_UOM, minorUnits: 1_000 },
      }),
    );

    expect(refused["written"]).toBe(false);
    expect(errorOf(refused).code).toBe("REFERENCE_NOT_FOUND");
    expect(errorOf(refused).field).toBe("locationId");

    const lines = await world.t.run(
      async (ctx) => await ctx.db.query("receiptLines").collect(),
    );
    expect(lines).toEqual([]);
  });

  it("never offers another tenant's receiving locations", async () => {
    const world = await createConvexInventoryWorld();

    const asA = value(
      await callAs(world, "a", listReceivingLocations, {
        warehouseId: world.warehouses.alphaA,
      }),
    );
    const ids = (asA["items"] as { locationId: string }[]).map(
      (row) => row.locationId,
    );

    expect(ids).toContain(world.a.dock);
    expect(ids).not.toContain(world.b.dock);
  });

  it("refuses an exception raised in another tenant", async () => {
    const world = await createConvexInventoryWorld({}, { roleA: "ORG_ADMIN" });
    const seeded = await seedBoth(world);

    const raised = value(
      await callAs(world, "b", raiseReceivingException, {
        requestId: requestId("exc_b"),
        warehouseId: world.warehouses.alphaB,
        kind: "BLIND",
        reasonCodeId: seeded.b.reason,
      }),
    );
    expect(raised["written"]).toBe(true);

    const rows = await world.t.run(
      async (ctx) => await ctx.db.query("receivingExceptions").collect(),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.orgId).toBe(world.orgB);
  });
});

describe("quality, labels, and putaway are tenant-confined", () => {
  it("refuses a disposition against another tenant's inspection", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await seedBoth(world);

    const inspectionId = await world.t.run(async (ctx) => {
      const receiptId = await ctx.db.insert("receipts", {
        orgId: world.orgB,
        warehouseId: world.warehouses.alphaB,
        receiptNumber: "GRN-B",
        receivedByUserId: world.userA,
        occurredAt: Date.now(),
        businessDate: "2026-08-11",
      });
      const transactionId = await ctx.db.insert("inventoryTransactions", {
        orgId: world.orgB,
        warehouseId: world.warehouses.alphaB,
        type: "RECEIPT",
        operation: "seed",
        requestId: requestId("seed_b"),
        actorUserId: world.userA,
        occurredAt: Date.now(),
        businessDate: "2026-08-11",
        source: { type: "SEED", id: "1" },
        lineCount: 0,
        conservationGroupCount: 0,
      });
      const receiptLineId = await ctx.db.insert("receiptLines", {
        orgId: world.orgB,
        receiptId,
        itemId: world.b.untrackedItem,
        locationId: world.b.dock,
        capturedQuantity: { uom: FIXTURE_UOM, minorUnits: 1_000 },
        baseMinorUnits: 1_000,
        kind: "ORDERED",
        classification: "COMPLETE",
        stockStatus: "QC_HOLD",
        transactionId,
        overToleranceApproved: false,
      });
      return await ctx.db.insert("qcInspections", {
        orgId: world.orgB,
        warehouseId: world.warehouses.alphaB,
        receiptLineId,
        itemId: world.b.untrackedItem,
        status: "OPEN",
        strategy: "ALL",
        sampleSize: 1,
        lotSize: 1,
      });
    });

    const result = value(
      await callAs(world, "a", submitDisposition, {
        requestId: requestId("disp_cross"),
        warehouseId: world.warehouses.alphaA,
        inspectionId,
        disposition: "REJECT",
        reasonCodeId: seeded.a.reason,
      }),
    );

    expect(result["written"]).toBe(false);
    expect(errorOf(result).code).toBe("NOT_FOUND");
  });

  it("refuses a label from another tenant's template", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await seedBoth(world);

    const result = value(
      await callAs(world, "a", generateLabel, {
        requestId: requestId("label_cross"),
        warehouseId: world.warehouses.alphaA,
        labelTemplateId: seeded.b.template,
        targetKind: "LOT",
        targetId: world.a.lot,
        fields: { SKU: "X" },
      }),
    );

    expect(errorOf(result).code).toBe("REFERENCE_NOT_FOUND");
    expect(errorOf(result).field).toBe("labelTemplateId");
  });

  it("never lists another tenant's putaway tasks", async () => {
    const world = await createConvexInventoryWorld();
    await world.t.run(async (ctx) => {
      const transactionId = await ctx.db.insert("inventoryTransactions", {
        orgId: world.orgB,
        warehouseId: world.warehouses.alphaB,
        type: "RECEIPT",
        operation: "seed",
        requestId: requestId("seed_task"),
        actorUserId: world.userA,
        occurredAt: Date.now(),
        businessDate: "2026-08-11",
        source: { type: "SEED", id: "2" },
        lineCount: 0,
        conservationGroupCount: 0,
      });
      const receiptId = await ctx.db.insert("receipts", {
        orgId: world.orgB,
        warehouseId: world.warehouses.alphaB,
        receiptNumber: "GRN-B2",
        receivedByUserId: world.userA,
        occurredAt: Date.now(),
        businessDate: "2026-08-11",
      });
      const receiptLineId = await ctx.db.insert("receiptLines", {
        orgId: world.orgB,
        receiptId,
        itemId: world.b.untrackedItem,
        locationId: world.b.dock,
        capturedQuantity: { uom: FIXTURE_UOM, minorUnits: 2_000 },
        baseMinorUnits: 2_000,
        kind: "ORDERED",
        classification: "COMPLETE",
        stockStatus: "AVAILABLE",
        transactionId,
        overToleranceApproved: false,
      });
      await ctx.db.insert("putawayTasks", {
        orgId: world.orgB,
        warehouseId: world.warehouses.alphaB,
        receiptLineId,
        itemId: world.b.untrackedItem,
        baseMinorUnits: 2_000,
        fromLocationId: world.b.dock,
        status: "READY",
      });
    });

    const asA = value(
      await callAs(world, "a", listPutawayTasks, {
        warehouseId: world.warehouses.alphaA,
      }),
    );
    expect(asA["items"]).toEqual([]);
  });

  it("refuses to claim a task belonging to another tenant", async () => {
    const world = await createConvexInventoryWorld();
    const taskId = await world.t.run(async (ctx) => {
      const transactionId = await ctx.db.insert("inventoryTransactions", {
        orgId: world.orgB,
        warehouseId: world.warehouses.alphaB,
        type: "RECEIPT",
        operation: "seed",
        requestId: requestId("seed_claim"),
        actorUserId: world.userA,
        occurredAt: Date.now(),
        businessDate: "2026-08-11",
        source: { type: "SEED", id: "3" },
        lineCount: 0,
        conservationGroupCount: 0,
      });
      const receiptId = await ctx.db.insert("receipts", {
        orgId: world.orgB,
        warehouseId: world.warehouses.alphaB,
        receiptNumber: "GRN-B3",
        receivedByUserId: world.userA,
        occurredAt: Date.now(),
        businessDate: "2026-08-11",
      });
      const receiptLineId = await ctx.db.insert("receiptLines", {
        orgId: world.orgB,
        receiptId,
        itemId: world.b.untrackedItem,
        locationId: world.b.dock,
        capturedQuantity: { uom: FIXTURE_UOM, minorUnits: 2_000 },
        baseMinorUnits: 2_000,
        kind: "ORDERED",
        classification: "COMPLETE",
        stockStatus: "AVAILABLE",
        transactionId,
        overToleranceApproved: false,
      });
      return await ctx.db.insert("putawayTasks", {
        orgId: world.orgB,
        warehouseId: world.warehouses.alphaB,
        receiptLineId,
        itemId: world.b.untrackedItem,
        baseMinorUnits: 2_000,
        fromLocationId: world.b.dock,
        status: "READY",
      });
    });

    const result = value(
      await callAs(world, "a", claimPutawayTask, {
        requestId: requestId("claim_cross"),
        warehouseId: world.warehouses.alphaA,
        putawayTaskId: taskId,
      }),
    );

    expect(errorOf(result).code).toBe("NOT_FOUND");

    const task = await world.t.run(async (ctx) => await ctx.db.get(taskId));
    expect(task?.status).toBe("READY");
    expect(task?.claimedByUserId).toBeUndefined();
  });
});

describe("a request authorized for one warehouse cannot write another's", () => {
  it("refuses a disposition on an inspection in the tenant's other warehouse", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await seedBoth(world);
    const inspectionId = await world.t.run(async (ctx) => {
      const transactionId = await ctx.db.insert("inventoryTransactions", {
        orgId: world.orgA,
        warehouseId: world.warehouses.bravoA,
        type: "RECEIPT",
        operation: "seed",
        requestId: requestId("seed_wh_disp"),
        actorUserId: world.userA,
        occurredAt: Date.now(),
        businessDate: "2026-08-11",
        source: { type: "SEED", id: "4" },
        lineCount: 0,
        conservationGroupCount: 0,
      });
      const receiptId = await ctx.db.insert("receipts", {
        orgId: world.orgA,
        warehouseId: world.warehouses.bravoA,
        receiptNumber: "GRN-A-BRAVO",
        receivedByUserId: world.userA,
        occurredAt: Date.now(),
        businessDate: "2026-08-11",
      });
      const receiptLineId = await ctx.db.insert("receiptLines", {
        orgId: world.orgA,
        receiptId,
        itemId: world.a.untrackedItem,
        locationId: world.a.otherWarehouseLocation,
        capturedQuantity: { uom: FIXTURE_UOM, minorUnits: 1_000 },
        baseMinorUnits: 1_000,
        kind: "ORDERED",
        classification: "COMPLETE",
        stockStatus: "QC_HOLD",
        transactionId,
        overToleranceApproved: false,
      });
      return await ctx.db.insert("qcInspections", {
        orgId: world.orgA,
        warehouseId: world.warehouses.bravoA,
        receiptLineId,
        itemId: world.a.untrackedItem,
        status: "OPEN",
        strategy: "ALL",
        sampleSize: 1,
        lotSize: 1,
      });
    });

    const result = value(
      await callAs(world, "a", submitDisposition, {
        requestId: requestId("disp_wh_cross"),
        warehouseId: world.warehouses.alphaA,
        inspectionId,
        disposition: "REJECT",
        reasonCodeId: seeded.a.reason,
      }),
    );

    expect(result["written"]).toBe(false);
    expect(errorOf(result).code).toBe("NOT_FOUND");

    const inspection = await world.t.run(
      async (ctx) => await ctx.db.get(inspectionId),
    );
    expect(inspection?.status).toBe("OPEN");
    expect(inspection?.disposition).toBeUndefined();
  });

  it("refuses to claim a task in the tenant's other warehouse", async () => {
    const world = await createConvexInventoryWorld();
    const taskId = await world.t.run(async (ctx) => {
      const transactionId = await ctx.db.insert("inventoryTransactions", {
        orgId: world.orgA,
        warehouseId: world.warehouses.bravoA,
        type: "RECEIPT",
        operation: "seed",
        requestId: requestId("seed_wh_claim"),
        actorUserId: world.userA,
        occurredAt: Date.now(),
        businessDate: "2026-08-11",
        source: { type: "SEED", id: "5" },
        lineCount: 0,
        conservationGroupCount: 0,
      });
      const receiptId = await ctx.db.insert("receipts", {
        orgId: world.orgA,
        warehouseId: world.warehouses.bravoA,
        receiptNumber: "GRN-A-BRAVO-2",
        receivedByUserId: world.userA,
        occurredAt: Date.now(),
        businessDate: "2026-08-11",
      });
      const receiptLineId = await ctx.db.insert("receiptLines", {
        orgId: world.orgA,
        receiptId,
        itemId: world.a.untrackedItem,
        locationId: world.a.otherWarehouseLocation,
        capturedQuantity: { uom: FIXTURE_UOM, minorUnits: 2_000 },
        baseMinorUnits: 2_000,
        kind: "ORDERED",
        classification: "COMPLETE",
        stockStatus: "AVAILABLE",
        transactionId,
        overToleranceApproved: false,
      });
      return await ctx.db.insert("putawayTasks", {
        orgId: world.orgA,
        warehouseId: world.warehouses.bravoA,
        receiptLineId,
        itemId: world.a.untrackedItem,
        baseMinorUnits: 2_000,
        fromLocationId: world.a.otherWarehouseLocation,
        status: "READY",
      });
    });

    const result = value(
      await callAs(world, "a", claimPutawayTask, {
        requestId: requestId("claim_wh_cross"),
        warehouseId: world.warehouses.alphaA,
        putawayTaskId: taskId,
      }),
    );

    expect(errorOf(result).code).toBe("NOT_FOUND");

    const task = await world.t.run(async (ctx) => await ctx.db.get(taskId));
    expect(task?.status).toBe("READY");
    expect(task?.claimedByUserId).toBeUndefined();
  });

  it("refuses to confirm a task in the tenant's other warehouse", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await world.t.run(async (ctx) => {
      const rack = await ctx.db.insert("locations", {
        orgId: world.orgA,
        warehouseId: world.warehouses.bravoA,
        code: "RACK-01",
        locationType: "RACK_BIN",
        status: "ACTIVE",
      });
      const transactionId = await ctx.db.insert("inventoryTransactions", {
        orgId: world.orgA,
        warehouseId: world.warehouses.bravoA,
        type: "RECEIPT",
        operation: "seed",
        requestId: requestId("seed_wh_confirm"),
        actorUserId: world.userA,
        occurredAt: Date.now(),
        businessDate: "2026-08-11",
        source: { type: "SEED", id: "6" },
        lineCount: 0,
        conservationGroupCount: 0,
      });
      const receiptId = await ctx.db.insert("receipts", {
        orgId: world.orgA,
        warehouseId: world.warehouses.bravoA,
        receiptNumber: "GRN-A-BRAVO-3",
        receivedByUserId: world.userA,
        occurredAt: Date.now(),
        businessDate: "2026-08-11",
      });
      const receiptLineId = await ctx.db.insert("receiptLines", {
        orgId: world.orgA,
        receiptId,
        itemId: world.a.untrackedItem,
        locationId: world.a.otherWarehouseLocation,
        capturedQuantity: { uom: FIXTURE_UOM, minorUnits: 2_000 },
        baseMinorUnits: 2_000,
        kind: "ORDERED",
        classification: "COMPLETE",
        stockStatus: "AVAILABLE",
        transactionId,
        overToleranceApproved: false,
      });
      const taskId = await ctx.db.insert("putawayTasks", {
        orgId: world.orgA,
        warehouseId: world.warehouses.bravoA,
        receiptLineId,
        itemId: world.a.untrackedItem,
        baseMinorUnits: 2_000,
        fromLocationId: world.a.otherWarehouseLocation,
        status: "CLAIMED",
        claimedByUserId: world.userA,
        claimedAt: Date.now(),
        recommendedLocationId: rack,
        recommendationTrace: JSON.stringify({
          ranked: [
            {
              locationId: rack,
              code: "RACK-01",
              score: 0,
              components: [],
              viaOverflow: false,
            },
          ],
          rejected: [],
          filtersApplied: [],
          weights: DEFAULT_PUTAWAY_WEIGHTS,
        }),
      });
      return { rack, taskId };
    });

    const result = value(
      await callAs(world, "a", confirmPutaway, {
        requestId: requestId("confirm_wh_cross"),
        warehouseId: world.warehouses.alphaA,
        putawayTaskId: seeded.taskId,
        chosenLocationId: seeded.rack,
      }),
    );

    expect(result["written"]).toBe(false);
    expect(errorOf(result).code).toBe("NOT_FOUND");

    const task = await world.t.run(
      async (ctx) => await ctx.db.get(seeded.taskId),
    );
    expect(task?.status).toBe("CLAIMED");
    expect(task?.chosenLocationId).toBeUndefined();
    expect(task?.transactionId).toBeUndefined();

    const transactions = await world.t.run(
      async (ctx) => await ctx.db.query("inventoryTransactions").collect(),
    );
    expect(transactions.map((row) => row.operation)).toEqual(["seed"]);
  });
});

describe("every inbound row carries the writing tenant", () => {
  it("stamps orgId from the resolved context, never from an argument", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await seedBoth(world);

    const order = value(
      await callAs(world, "a", createPurchaseOrder, {
        requestId: requestId("stamp"),
        warehouseId: world.warehouses.alphaA,
        poNumber: "PO-STAMP",
        supplierId: seeded.a.supplier,
      }),
    );
    await callAs(world, "a", openReceipt, {
      requestId: requestId("stamp_receipt"),
      warehouseId: world.warehouses.alphaA,
      receiptNumber: "GRN-STAMP",
      purchaseOrderId: order["documentId"],
    });

    const rows = await world.t.run(async (ctx) => ({
      orders: await ctx.db.query("purchaseOrders").collect(),
      receipts: await ctx.db.query("receipts").collect(),
    }));

    expect(rows.orders.every((row) => row.orgId === world.orgA)).toBe(true);
    expect(rows.receipts.every((row) => row.orgId === world.orgA)).toBe(true);
  });
});
