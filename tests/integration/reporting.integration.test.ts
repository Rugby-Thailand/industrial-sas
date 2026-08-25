import type { GenericMutationCtx } from "convex/server";
import type { GenericId } from "convex/values";
import { describe, expect, it } from "vitest";

import { readDashboard, readOccupancy } from "../../convex/reporting/dashboard";
import {
  readOperationalExceptions,
  readStockMovements,
  readStockReports,
} from "../../convex/reporting/operationalViews";
import {
  exportChunkRows,
  getReportJob,
  listReportJobs,
  requestExport,
  runExportChunk,
} from "../../convex/reporting/exports";
import {
  maxVerifyRows,
  repairRollup,
  verifyRollups,
} from "../../convex/reporting/rollups";
import { claimPutawayTask, listPutawayTasks } from "../../convex/putaway/tasks";
import { submitDisposition } from "../../convex/quality/inspections";
import { openReceipt, postReceiptLine } from "../../convex/receiving/receipts";
import { createPurchaseOrder } from "../../convex/purchasing/orders";
import { addPurchaseOrderLine } from "../../convex/purchasing/orders";
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
const identityA = { subject: "user_fixture_a", org_id: "org_fixture_a" };

async function call(
  world: ConvexInventoryWorld,
  fn: unknown,
  args: unknown,
): Promise<Record<string, unknown>> {
  return (await world.t
    .withIdentity(identityA)
    .run(async (ctx) =>
      run(fn)._handler(ctx as GenericMutationCtx<DataModel>, args),
    )) as Record<string, unknown>;
}

function value(outcome: Record<string, unknown>): Record<string, unknown> {
  expect(outcome["ok"], JSON.stringify(outcome)).toBe(true);
  return outcome["value"] as Record<string, unknown>;
}

const okWrite = (outcome: Record<string, unknown>): Record<string, unknown> => {
  const result = value(outcome);
  expect(result["written"], JSON.stringify(result)).toBe(true);
  return result;
};

const requestId = (name: string): string => {
  let hash = 0;
  for (const character of name) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return `0193f2c1-0000-7000-8000-0000${hash.toString(16).padStart(8, "0")}`;
};

const tileFor = (tiles: unknown, metric: string): number => {
  const found = (tiles as { metric: string; count: number }[]).find(
    (tile) => tile.metric === metric,
  );
  return found?.count ?? -1;
};

const dashboard = async (world: ConvexInventoryWorld) =>
  value(
    await call(world, readDashboard, {
      warehouseId: world.warehouses.alphaA,
    }),
  );

async function seedReporting(world: ConvexInventoryWorld) {
  return await world.t.run(async (ctx) => {
    const supplier = await ctx.db.insert("suppliers", {
      orgId: world.orgA,
      code: "SUP-RPT",
      name: "ผู้จัดจำหน่ายรายงาน",
      status: "ACTIVE",
    });
    const qcReason = await ctx.db.insert("reasonCodes", {
      orgId: world.orgA,
      code: "QC-HOLD-RPT",
      name: "Inspection parked",
      scope: "STATUS_CHANGE",
      status: "ACTIVE",
    });
    return { supplier, qcReason };
  });
}

async function orderWithLine(
  world: ConvexInventoryWorld,
  supplier: GenericId<"suppliers">,
) {
  const order = okWrite(
    await call(world, createPurchaseOrder, {
      requestId: requestId("rpt_po"),
      warehouseId: world.warehouses.alphaA,
      poNumber: "PO-RPT-1",
      supplierId: supplier,
    }),
  );
  const line = okWrite(
    await call(world, addPurchaseOrderLine, {
      requestId: requestId("rpt_pol"),
      warehouseId: world.warehouses.alphaA,
      purchaseOrderId: order["documentId"],
      lineNumber: 1,
      itemId: world.a.untrackedItem,
      quantity: { uom: FIXTURE_UOM, minorUnits: 100_000 },
    }),
  );
  return {
    purchaseOrderId: order["documentId"] as string,
    purchaseOrderLineId: line["documentId"] as string,
  };
}

async function receiveOneLine(
  world: ConvexInventoryWorld,
  supplier: GenericId<"suppliers">,
  suffix = "1",
) {
  const order = await orderWithLine(world, supplier);
  const receipt = okWrite(
    await call(world, openReceipt, {
      requestId: requestId(`rpt_receipt_${suffix}`),
      warehouseId: world.warehouses.alphaA,
      receiptNumber: `GRN-RPT-${suffix}`,
      purchaseOrderId: order.purchaseOrderId,
    }),
  );
  const posted = okWrite(
    await call(world, postReceiptLine, {
      requestId: requestId(`rpt_line_${suffix}`),
      warehouseId: world.warehouses.alphaA,
      receiptId: receipt["documentId"],
      purchaseOrderLineId: order.purchaseOrderLineId,
      itemId: world.a.untrackedItem,
      locationId: world.a.dock,
      quantity: { uom: FIXTURE_UOM, minorUnits: 40_000 },
    }),
  );
  return { receiptId: receipt["documentId"] as string, posted };
}

describe("dashboard rollups", () => {
  it("serves the four stock views and prioritized exceptions from bounded source facts", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await seedReporting(world);
    await receiveOneLine(world, seeded.supplier);
    await world.t.run(async (ctx) => {
      const taskId = await ctx.db.insert("operatorTasks", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        taskNumber: "TASK-RPT-EX-1",
        kind: "SUPERVISOR_ASSIGNED",
        instruction: "Investigate damaged carton",
        status: "AVAILABLE",
        evidenceCount: 1,
        createdByUserId: world.userA,
      });
      await ctx.db.insert("operatorTaskExceptions", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        operatorTaskId: taskId,
        reasonCodeId: seeded.qcReason,
        reasonCode: "QC-HOLD-RPT",
        reasonName: "Inspection parked",
        summary: "Damaged carton blocks the pick task",
        evidence: "Corner crush visible on the scanned pallet",
        proposedDisposition: "ESCALATE",
        proposedRecoveryAction: "Move stock to quality hold",
        status: "OPEN",
        reportedByUserId: world.userA,
        reportedAt: 10,
      });
    });

    const stock = value(
      await call(world, readStockReports, {
        warehouseId: world.warehouses.alphaA,
      }),
    );
    expect(stock["complete"]).toBe(true);
    expect(stock["balances"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sku: "BULK-001",
          stockStatus: "AVAILABLE",
          baseMinorUnits: 40_000,
        }),
      ]),
    );
    expect(stock["sku"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sku: "BULK-001",
          availableBaseMinorUnits: 40_000,
          atpBaseMinorUnits: 40_000,
        }),
      ]),
    );

    const movements = value(
      await call(world, readStockMovements, {
        warehouseId: world.warehouses.alphaA,
      }),
    );
    expect(movements["movements"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sku: "BULK-001",
          operation: "receiving.receipt.postLine",
        }),
      ]),
    );

    const exceptions = value(
      await call(world, readOperationalExceptions, {
        warehouseId: world.warehouses.alphaA,
      }),
    );
    expect(exceptions["exceptions"]).toEqual([
      expect.objectContaining({
        severity: "HIGH",
        titleCode: "TASK_EXCEPTION",
        detail: "Damaged carton blocks the pick task",
      }),
    ]);
  });

  it("starts every tile at zero rather than omitting it", async () => {
    const world = await createConvexInventoryWorld();
    const result = await dashboard(world);

    const tiles = result["tiles"] as { metric: string; count: number }[];
    expect(tiles.length).toBeGreaterThanOrEqual(6);
    expect(tiles.every((tile) => tile.count === 0)).toBe(true);
    expect(tiles.some((tile) => "updatedAt" in tile)).toBe(false);
  });

  it("counts a receipt and its line as they are posted", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await seedReporting(world);

    await receiveOneLine(world, seeded.supplier);
    const result = await dashboard(world);

    expect(tileFor(result["tiles"], "RECEIPTS_OPENED")).toBe(1);
    expect(tileFor(result["tiles"], "RECEIPT_LINES_POSTED")).toBe(1);

    expect(tileFor(result["tiles"], "PUTAWAY_READY")).toBe(1);
  });

  it("does not count a replayed request twice", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await seedReporting(world);
    const order = await orderWithLine(world, seeded.supplier);

    const args = {
      requestId: requestId("rpt_replay"),
      warehouseId: world.warehouses.alphaA,
      receiptNumber: "GRN-REPLAY",
      purchaseOrderId: order.purchaseOrderId,
    };
    okWrite(await call(world, openReceipt, args));
    const second = okWrite(await call(world, openReceipt, args));

    expect(second["replayed"]).toBe(true);
    expect(tileFor((await dashboard(world))["tiles"], "RECEIPTS_OPENED")).toBe(
      1,
    );
  });

  it("moves the putaway pair together when a task is claimed", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await seedReporting(world);
    await receiveOneLine(world, seeded.supplier);

    const board = value(
      await call(world, listPutawayTasks, {
        warehouseId: world.warehouses.alphaA,
        status: "READY",
      }),
    );
    const task = (board["items"] as { putawayTaskId: string }[])[0];

    okWrite(
      await call(world, claimPutawayTask, {
        requestId: requestId("rpt_claim"),
        warehouseId: world.warehouses.alphaA,
        putawayTaskId: task?.putawayTaskId,
      }),
    );

    const tiles = (await dashboard(world))["tiles"];
    expect(tileFor(tiles, "PUTAWAY_READY")).toBe(0);
    expect(tileFor(tiles, "PUTAWAY_CLAIMED")).toBe(1);
  });

  it("moves an inspection from pending to parked in one transaction", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await seedReporting(world);
    await world.t.run(async (ctx) => {
      await ctx.db.insert("qcProfiles", {
        orgId: world.orgA,
        itemId: world.a.untrackedItem,
        enabled: true,
        strategy: "ALL",
      });
    });

    const { posted } = await receiveOneLine(world, seeded.supplier);
    expect(posted["stockStatus"]).toBe("QC_HOLD");
    expect(tileFor((await dashboard(world))["tiles"], "QC_PENDING")).toBe(1);

    okWrite(
      await call(world, submitDisposition, {
        requestId: requestId("rpt_disposition"),
        warehouseId: world.warehouses.alphaA,
        inspectionId: posted["inspectionId"],
        disposition: "RELEASE",
        reasonCodeId: seeded.qcReason,
      }),
    );

    const tiles = (await dashboard(world))["tiles"];
    expect(tileFor(tiles, "QC_PENDING")).toBe(0);
    expect(tileFor(tiles, "QC_PARKED")).toBe(1);
  });

  it("never answers with another tenant's counters", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await seedReporting(world);
    await receiveOneLine(world, seeded.supplier);

    const asB = value(
      await world.t
        .withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_b" })
        .run(
          async (ctx) =>
            (await run(readDashboard)._handler(
              ctx as GenericMutationCtx<DataModel>,
              { warehouseId: world.warehouses.alphaB },
            )) as Record<string, unknown>,
        ),
    );

    expect(tileFor(asB["tiles"], "RECEIPTS_OPENED")).toBe(0);
  });
});

describe("rollup verification", () => {
  it("agrees with a fresh derivation after a real journey", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await seedReporting(world);
    await receiveOneLine(world, seeded.supplier);

    const report = value(
      await call(world, verifyRollups, {
        warehouseId: world.warehouses.alphaA,
      }),
    );

    expect(report["balanced"]).toBe(true);
    expect(report["drifted"]).toEqual([]);
    expect(report["incomplete"]).toBe(false);
    expect(report["checked"]).toBeGreaterThan(0);
  });

  it("finds drift when a counter is corrupted behind its back", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await seedReporting(world);
    await receiveOneLine(world, seeded.supplier);

    await world.t.run(async (ctx) => {
      const rows = await ctx.db.query("operationsRollups").collect();
      const row = rows.find((entry) => entry.metric === "RECEIPTS_OPENED");
      if (row !== undefined) {
        await ctx.db.patch("operationsRollups", row._id, { count: 99 });
      }
    });

    const report = value(
      await call(world, verifyRollups, {
        warehouseId: world.warehouses.alphaA,
      }),
    );

    expect(report["balanced"]).toBe(false);
    expect(
      (report["drifted"] as { metric: string; stored: number }[])[0],
    ).toMatchObject({ metric: "RECEIPTS_OPENED", stored: 99, derived: 1 });
  });

  it("reports a site it cannot fully count as unverifiable, not as balanced", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await seedReporting(world);
    const { posted } = await receiveOneLine(world, seeded.supplier);
    const receiptLineId = posted["documentId"] as GenericId<"receiptLines">;

    await world.t.run(async (ctx) => {
      for (let index = 0; index < maxVerifyRows + 5; index += 1) {
        await ctx.db.insert("putawayTasks", {
          orgId: world.orgA,
          warehouseId: world.warehouses.alphaA,
          receiptLineId,
          itemId: world.a.item,
          baseMinorUnits: 1_000,
          fromLocationId: world.a.dock,
          status: "READY" as const,
        });
      }
    });

    const report = value(
      await call(world, verifyRollups, {
        warehouseId: world.warehouses.alphaA,
      }),
    );

    expect(report["incomplete"]).toBe(true);
    // A lower bound cannot disprove a counter, so it is not compared.
    expect(
      (report["drifted"] as { metric: string }[]).some(
        (entry) => entry.metric === "PUTAWAY_READY",
      ),
    ).toBe(false);
  });

  it("repairs a drifted counter from the derivation, not from a guess", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await seedReporting(world);
    await receiveOneLine(world, seeded.supplier);

    await world.t.run(async (ctx) => {
      const rows = await ctx.db.query("operationsRollups").collect();
      const row = rows.find((entry) => entry.metric === "RECEIPTS_OPENED");
      if (row !== undefined) {
        await ctx.db.patch("operationsRollups", row._id, { count: 99 });
      }
    });

    const repaired = value(
      await call(world, repairRollup, {
        requestId: requestId("rpt_repair"),
        warehouseId: world.warehouses.alphaA,
        metric: "RECEIPTS_OPENED",
      }),
    );

    expect(repaired).toMatchObject({ written: true, from: 99, to: 1 });
    expect(
      value(
        await call(world, verifyRollups, {
          warehouseId: world.warehouses.alphaA,
        }),
      )["balanced"],
    ).toBe(true);
  });

  it("refuses to repair the per-location metric here, rather than half-doing it", async () => {
    const world = await createConvexInventoryWorld();

    const outcome = value(
      await call(world, repairRollup, {
        requestId: requestId("rpt_repair_occ"),
        warehouseId: world.warehouses.alphaA,
        metric: "LOCATION_OCCUPANCY",
      }),
    );

    expect(outcome["written"]).toBe(false);
    expect((outcome["error"] as { code: string }).code).toBe(
      "METRIC_NOT_REPAIRABLE_HERE",
    );
  });
});

describe("occupancy", () => {
  it("draws every active location, including the empty ones", async () => {
    const world = await createConvexInventoryWorld();
    const map = value(
      await call(world, readOccupancy, {
        warehouseId: world.warehouses.alphaA,
      }),
    );

    const cells = map["cells"] as { code: string; band: string }[];
    expect(cells.map((cell) => cell.code).sort()).toEqual([
      "DOCK-01",
      "RACK-01",
    ]);
    expect(cells.every((cell) => cell.band === "EMPTY")).toBe(true);
    expect(map["complete"]).toBe(true);
  });

  it("counts a location as occupied once stock lands there", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await seedReporting(world);
    await receiveOneLine(world, seeded.supplier);

    const map = value(
      await call(world, readOccupancy, {
        warehouseId: world.warehouses.alphaA,
      }),
    );
    const dock = (
      map["cells"] as { code: string; band: string; distinctBuckets: number }[]
    ).find((cell) => cell.code === "DOCK-01");

    expect(dock?.distinctBuckets).toBe(1);
    expect(dock?.band).toBe("LIGHT");
  });

  it("keeps aisle order, so a cell does not move between refreshes", async () => {
    const world = await createConvexInventoryWorld();

    const first = value(
      await call(world, readOccupancy, {
        warehouseId: world.warehouses.alphaA,
      }),
    );
    const second = value(
      await call(world, readOccupancy, {
        warehouseId: world.warehouses.alphaA,
      }),
    );

    expect((first["cells"] as { code: string }[]).map((c) => c.code)).toEqual(
      (second["cells"] as { code: string }[]).map((c) => c.code),
    );
  });
});

describe("exports", () => {
  const drain = async (
    world: ConvexInventoryWorld,
    reportJobId: string,
  ): Promise<Record<string, unknown>> => {
    let last: Record<string, unknown> = {};
    for (let step = 0; step < 200; step += 1) {
      last = value(
        await call(world, runExportChunk, {
          warehouseId: world.warehouses.alphaA,
          reportJobId,
        }),
      );
      if (last["complete"] === true) break;
    }
    return last;
  };

  it("renders a balances export a spreadsheet can open", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await seedReporting(world);
    await receiveOneLine(world, seeded.supplier);

    const requested = okWrite(
      await call(world, requestExport, {
        requestId: requestId("rpt_export_1"),
        warehouseId: world.warehouses.alphaA,
        kind: "INVENTORY_BALANCES",
      }),
    );
    await drain(world, requested["documentId"] as string);

    const fetched = value(
      await call(world, getReportJob, {
        warehouseId: world.warehouses.alphaA,
        reportJobId: requested["documentId"],
      }),
    );

    expect(fetched["found"]).toBe(true);
    const artifact = fetched["artifact"] as string;

    expect(artifact.startsWith("﻿")).toBe(true);
    expect(artifact).toContain("bucketKey");
    expect((fetched["job"] as { rowCount: number }).rowCount).toBeGreaterThan(
      0,
    );
    expect((fetched["job"] as { status: string }).status).toBe("COMPLETE");
  });

  it("replays a repeated request rather than starting a second walk", async () => {
    const world = await createConvexInventoryWorld();

    const args = {
      requestId: requestId("rpt_export_replay"),
      warehouseId: world.warehouses.alphaA,
      kind: "PUTAWAY_TASKS" as const,
    };
    const first = okWrite(await call(world, requestExport, args));
    const second = okWrite(await call(world, requestExport, args));

    expect(second["replayed"]).toBe(true);
    expect(second["documentId"]).toBe(first["documentId"]);
  });

  it("reports a completed job in the register", async () => {
    const world = await createConvexInventoryWorld();
    const requested = okWrite(
      await call(world, requestExport, {
        requestId: requestId("rpt_export_register"),
        warehouseId: world.warehouses.alphaA,
        kind: "RECEIPT_LINES",
      }),
    );
    await drain(world, requested["documentId"] as string);

    const register = value(
      await call(world, listReportJobs, {
        warehouseId: world.warehouses.alphaA,
      }),
    );
    const jobs = register["jobs"] as { reportJobId: string; status: string }[];

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe("COMPLETE");
  });

  it("answers a foreign job exactly as it answers a nonexistent one", async () => {
    // `INV-0002-03`: the export register must not become an existence oracle.
    const world = await createConvexInventoryWorld();
    const requested = okWrite(
      await call(world, requestExport, {
        requestId: requestId("rpt_export_foreign"),
        warehouseId: world.warehouses.alphaA,
        kind: "PUTAWAY_TASKS",
      }),
    );

    const asB = await world.t
      .withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_b" })
      .run(
        async (ctx) =>
          (await run(getReportJob)._handler(
            ctx as GenericMutationCtx<DataModel>,
            {
              warehouseId: world.warehouses.alphaB,
              reportJobId: requested["documentId"],
            },
          )) as Record<string, unknown>,
      );

    expect(value(asB)["found"]).toBe(false);
  });

  it("exports every line of a receipt larger than one page", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await seedReporting(world);
    const { receiptId } = await receiveOneLine(world, seeded.supplier);

    const extra = exportChunkRows + 7;
    await world.t.run(async (ctx) => {
      const posted = await ctx.db.query("receiptLines").first();
      for (let index = 0; index < extra; index += 1) {
        await ctx.db.insert("receiptLines", {
          orgId: world.orgA,
          receiptId: receiptId as GenericId<"receipts">,
          itemId: world.a.untrackedItem,
          locationId: world.a.dock,
          capturedQuantity: { uom: FIXTURE_UOM, minorUnits: 1_000 },
          baseMinorUnits: 1_000,
          kind: "ORDERED",
          classification: "COMPLETE",
          stockStatus: "AVAILABLE",
          transactionId:
            posted?.transactionId as GenericId<"inventoryTransactions">,
          overToleranceApproved: false,
        });
      }
    });

    const requested = okWrite(
      await call(world, requestExport, {
        requestId: requestId("rpt_export_big"),
        warehouseId: world.warehouses.alphaA,
        kind: "RECEIPT_LINES",
      }),
    );
    const last = await drain(world, requested["documentId"] as string);

    expect(last["complete"]).toBe(true);

    expect(last["rowCount"]).toBe(extra + 1);

    const fetched = value(
      await call(world, getReportJob, {
        warehouseId: world.warehouses.alphaA,
        reportJobId: requested["documentId"],
      }),
    );
    const body = (fetched["artifact"] as string)
      .split("\r\n")
      .filter((line) => line !== "");

    expect(body).toHaveLength(extra + 2);
    expect(new Set(body).size).toBe(body.length);
  });

  it("keeps every chunk to a single cursored read", async () => {
    // Convex permits only one paginated read per function execution.
    const world = await createConvexInventoryWorld();
    const seeded = await seedReporting(world);
    await receiveOneLine(world, seeded.supplier);

    const requested = okWrite(
      await call(world, requestExport, {
        requestId: requestId("rpt_export_steps"),
        warehouseId: world.warehouses.alphaA,
        kind: "RECEIPT_LINES",
      }),
    );
    const jobId = requested["documentId"] as string;

    const first = value(
      await call(world, runExportChunk, {
        warehouseId: world.warehouses.alphaA,
        reportJobId: jobId,
      }),
    );

    expect(first).toMatchObject({ rowCount: 0, complete: false });

    const second = value(
      await call(world, runExportChunk, {
        warehouseId: world.warehouses.alphaA,
        reportJobId: jobId,
      }),
    );
    expect(second).toMatchObject({ rowCount: 1, complete: false });

    const third = value(
      await call(world, runExportChunk, {
        warehouseId: world.warehouses.alphaA,
        reportJobId: jobId,
      }),
    );
    expect(third["complete"]).toBe(true);
  });

  it("fails honestly when its stored position cannot be read", async () => {
    const world = await createConvexInventoryWorld();
    const requested = okWrite(
      await call(world, requestExport, {
        requestId: requestId("rpt_export_badcursor"),
        warehouseId: world.warehouses.alphaA,
        kind: "PUTAWAY_TASKS",
      }),
    );

    await world.t.run(async (ctx) => {
      await ctx.db.patch(
        "reportJobs",
        requested["documentId"] as GenericId<"reportJobs">,
        { cursor: "not a position" },
      );
    });

    const outcome = value(
      await call(world, runExportChunk, {
        warehouseId: world.warehouses.alphaA,
        reportJobId: requested["documentId"],
      }),
    );

    expect(outcome["written"]).toBe(false);
    expect((outcome["error"] as { code: string }).code).toBe(
      "CURSOR_UNPARSEABLE",
    );
  });

  it("refuses a request ID reused for a different export", async () => {
    const world = await createConvexInventoryWorld();
    const shared = requestId("rpt_export_conflict");

    okWrite(
      await call(world, requestExport, {
        requestId: shared,
        warehouseId: world.warehouses.alphaA,
        kind: "INVENTORY_BALANCES",
      }),
    );

    const conflicting = value(
      await call(world, requestExport, {
        requestId: shared,
        warehouseId: world.warehouses.alphaA,
        kind: "PUTAWAY_TASKS",
      }),
    );

    expect(conflicting["written"]).toBe(false);
    expect((conflicting["error"] as { code: string }).code).toBe(
      "REQUEST_ARGUMENT_CONFLICT",
    );
  });

  it("never lets a reused request ID reach a site the caller cannot use", async () => {
    const world = await createConvexInventoryWorld();
    const shared = requestId("rpt_export_conflict_site");

    okWrite(
      await call(world, requestExport, {
        requestId: shared,
        warehouseId: world.warehouses.alphaA,
        kind: "PUTAWAY_TASKS",
      }),
    );

    await expect(
      call(world, requestExport, {
        requestId: shared,
        warehouseId: world.warehouses.bravoA,
        kind: "PUTAWAY_TASKS",
      }),
    ).rejects.toThrow(/WAREHOUSE_OUT_OF_SCOPE/);
  });

  it("does not hand a job to a caller asking about a different site", async () => {
    const world = await createConvexInventoryWorld();

    const foreignSiteJob = await world.t.run(
      async (ctx) =>
        await ctx.db.insert("reportJobs", {
          orgId: world.orgA,
          warehouseId: world.warehouses.bravoA,
          kind: "PUTAWAY_TASKS" as const,
          status: "COMPLETE" as const,
          requestedByUserId: world.userA,
          requestedAt: 1,
          requestId: requestId("rpt_other_site"),
          rowCount: 3,
          artifact: "secret",
          artifactBytes: 6,
        }),
    );

    const answer = value(
      await call(world, getReportJob, {
        warehouseId: world.warehouses.alphaA,
        reportJobId: foreignSiteJob,
      }),
    );

    expect(answer).toEqual({ found: false });
  });

  it("does not advance a job belonging to a different site", async () => {
    const world = await createConvexInventoryWorld();

    const foreignSiteJob = await world.t.run(
      async (ctx) =>
        await ctx.db.insert("reportJobs", {
          orgId: world.orgA,
          warehouseId: world.warehouses.bravoA,
          kind: "PUTAWAY_TASKS" as const,
          status: "QUEUED" as const,
          requestedByUserId: world.userA,
          requestedAt: 1,
          requestId: requestId("rpt_other_site_run"),
          rowCount: 0,
          artifact: "",
          artifactBytes: 0,
        }),
    );

    const outcome = value(
      await call(world, runExportChunk, {
        warehouseId: world.warehouses.alphaA,
        reportJobId: foreignSiteJob,
      }),
    );

    expect(outcome["written"]).toBe(false);
    expect((outcome["error"] as { code: string }).code).toBe("NOT_FOUND");
  });

  it("stops rather than truncating when the artifact will not fit", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await seedReporting(world);

    await receiveOneLine(world, seeded.supplier);

    const requested = okWrite(
      await call(world, requestExport, {
        requestId: requestId("rpt_export_cap"),
        warehouseId: world.warehouses.alphaA,
        kind: "PUTAWAY_TASKS",
      }),
    );

    await world.t.run(async (ctx) => {
      await ctx.db.patch(
        "reportJobs",
        requested["documentId"] as GenericId<"reportJobs">,
        { artifactBytes: 512 * 1024 },
      );
    });

    const outcome = value(
      await call(world, runExportChunk, {
        warehouseId: world.warehouses.alphaA,
        reportJobId: requested["documentId"],
      }),
    );

    expect(outcome["written"]).toBe(false);
    expect((outcome["error"] as { code: string }).code).toBe(
      "ARTIFACT_LIMIT_REACHED",
    );

    const fetched = value(
      await call(world, getReportJob, {
        warehouseId: world.warehouses.alphaA,
        reportJobId: requested["documentId"],
      }),
    );
    expect(fetched["job"]).toMatchObject({
      status: "FAILED",
      failureCode: "ARTIFACT_LIMIT_REACHED",
    });
  });
});
