/**
 * Integration tier — dashboard rollups, occupancy, verification, and exports.
 *
 * The claim under test is the one a supervisor's screen rests on: **a maintained
 * counter equals what a fresh derivation says it is, after a real journey through
 * the real functions.** A counter that were merely *plausible* would be
 * indistinguishable from a correct one by looking at the tile, so every case here
 * drives the actual mutations — open a receipt, post a line, park a disposition,
 * claim a task — and then compares the tile to a recomputation of the tables that
 * define it.
 *
 * The export cases prove the other half of `ADR-0011`: a walk that is bounded per
 * chunk, resumable, replayed rather than restarted on a repeated request, and
 * stopped rather than truncated when the artifact will not fit.
 *
 * Every seeded row is synthetic (`tests/fixtures/README.md`).
 */
import type { GenericMutationCtx } from "convex/server";
import type { GenericId } from "convex/values";
import { describe, expect, it } from "vitest";

import { readDashboard, readOccupancy } from "../../convex/reporting/dashboard";
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

/** A UUIDv7-shaped request ID derived from a readable name (the ledger's rule). */
const requestId = (name: string): string => {
  let hash = 0;
  for (const character of name) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return `0193f2c1-0000-7000-8000-0000${hash.toString(16).padStart(8, "0")}`;
};

/** One tile's count, by metric. */
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

/** Open an order with one line for the untracked item. */
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

/** Open a receipt and post one ordinary line against it. */
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
  it("starts every tile at zero rather than omitting it", async () => {
    /*
     * A missing tile reads as a missing feature. A counter that has never moved
     * is a real, correct zero — and the screen can tell the two apart because
     * `updatedAt` is absent on the untouched one.
     */
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
    // Available stock creates a putaway task, so that backlog moved too.
    expect(tileFor(result["tiles"], "PUTAWAY_READY")).toBe(1);
  });

  it("does not count a replayed request twice", async () => {
    /*
     * The failure this prevents: a handheld retries through a dropped
     * connection, the idempotency machinery correctly replays the receipt, and
     * the tile climbs anyway — so the counter measures network quality.
     */
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

    // Release needs a second person, so the inspection parks rather than closes.
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
    /*
     * The claim the dashboard rests on. Not "the counter is plausible" but "the
     * counter equals what counting the source tables says", proved after the
     * mutations that moved it.
     */
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
    /*
     * Two failures in one. A verifier that paged would need a second cursored
     * read in the same execution, which Convex refuses — so it would work on a
     * small site and throw on every real one. A verifier that counted a capped
     * page as the total would report drift on every busy site.
     *
     * The honest answer for a source larger than one bounded read is "not
     * checked", and `incomplete` is how it says so.
     */
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
    // The metric it could not count is absent from the comparison entirely: a
    // lower bound cannot disprove a counter.
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
    // A hole in the map reads as "no such location" rather than as "empty".
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
    /*
     * Generous, because a two-level walk spends a chunk advancing to each
     * receipt before draining it. A loop that ran out would silently assert
     * against a half-finished export, which is the failure this suite exists to
     * catch.
     */
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
    // The byte-order mark is what makes Excel read Thai as Thai.
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
    /*
     * The defect this replaces: the walk took a fixed number of lines per
     * receipt, so a delivery with more lines than the page size silently lost
     * the rest — and the finished file looked complete. A stock extract that is
     * quietly short is the worst outcome this feature has.
     *
     * `EXPORT_CHUNK_ROWS + 7` is deliberately over the boundary rather than a
     * round multiple, so an off-by-one in the resume path shows up as a missing
     * or duplicated row rather than as a clean pass.
     */
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
    // One line from the receiving journey, plus everything seeded above.
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
    // Header plus one record per line, and no record written twice.
    expect(body).toHaveLength(extra + 2);
    expect(new Set(body).size).toBe(body.length);
  });

  it("keeps every chunk to a single cursored read", async () => {
    /*
     * A Convex execution may perform only one indexed read that has a
     * continuation. The two-level walk respects that by alternating: a chunk
     * either advances to the next receipt, appending nothing, or drains a page
     * of that receipt's lines. Asserting the *shape* here is what stops somebody
     * folding the two back together for tidiness and meeting the limit only on
     * the tenant with the most receipts.
     */
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
    // Step one advances to the receipt and appends nothing.
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
    // Restarting the walk would duplicate every row already written, so an
    // unreadable cursor stops the job with the reason instead.
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
    /*
     * Answering with the earlier job would hand back a balances extract to
     * somebody who asked for putaway tasks. It would look like a successful
     * export until they read it.
     */
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
    /*
     * The cross-site half of the same defect, and it is caught one layer
     * earlier: the warehouse is revalidated against membership before the
     * handler runs (`INV-0006-04`), so a reused request ID pointed at another
     * site is a *denial* rather than a refusal — and certainly not the earlier
     * job handed back.
     *
     * Asserted here as well as in the isolation tier because the two failures
     * would be indistinguishable to a caller, and only one of them is the one
     * this code is responsible for.
     */
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
    /*
     * The reachable half of the scoping question, and the one the explicit
     * warehouse check in `getReportJob` actually defends. A cross-*tenant* ID is
     * already `null` from the accessor, so it proves nothing about this code; a
     * job belonging to another **site of the same tenant** reaches the handler
     * and must still answer `found: false`.
     *
     * Without the check, a supervisor scoped to one site could read another
     * site's stock extract by quoting its job ID.
     */
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
    // The same scoping question on the write side, where the consequence is
    // worse: advancing another site's export would append that site's rows to
    // an artifact somebody else can read.
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
    /*
     * A spreadsheet that looks complete and is not is the worst outcome an
     * export can have — somebody counts stock from it. The job fails loudly
     * instead, with a code the register shows.
     */
    const world = await createConvexInventoryWorld();
    const seeded = await seedReporting(world);
    // One posted line, so the export has at least one row to try to append.
    await receiveOneLine(world, seeded.supplier);

    const requested = okWrite(
      await call(world, requestExport, {
        requestId: requestId("rpt_export_cap"),
        warehouseId: world.warehouses.alphaA,
        kind: "PUTAWAY_TASKS",
      }),
    );

    // The artifact is declared already full, which is the state a long export
    // reaches on its own; forcing it keeps the test from writing half a megabyte.
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

    // And the job says so afterwards, rather than looking merely unfinished.
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
