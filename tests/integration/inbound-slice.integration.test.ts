/**
 * The inbound vertical slice, end to end, against the real functions.
 *
 * `RG-051` asks that a real PO complete receive → QC → pallet → print → putaway
 * → inventory history. That gate is a *pilot hardware* gate and stays open. What
 * this file proves is the half that is local: the same journey through the same
 * public Convex functions, with the ledger, the permissions, the idempotency
 * machinery, and the maker-checker evaluator all real.
 *
 * Every seeded row is synthetic (PDPA, plan §12).
 */
import type { GenericMutationCtx } from "convex/server";
import type { GenericId } from "convex/values";
import { describe, expect, it } from "vitest";

import { listBalances } from "../../convex/inventory/ledger";
import {
  generateLabel,
  listPrintJobsForTarget,
} from "../../convex/labels/print";
import {
  addPurchaseOrderLine,
  applyPurchaseOrderImportChunk,
  closeLineShort,
  createPurchaseOrder,
  listPurchaseOrderLines,
  previewPurchaseOrderImport,
} from "../../convex/purchasing/orders";
import {
  claimPutawayTask,
  confirmPutaway,
  listPutawayTasks,
  recommendPutawayLocations,
} from "../../convex/putaway/tasks";
import {
  approveDisposition,
  listInspections,
  submitDisposition,
} from "../../convex/quality/inspections";
import {
  buildHandlingUnit,
  listReceipts,
  openReceipt,
  postExceptionReceiptLine,
  postReceiptLine,
  raiseReceivingException,
} from "../../convex/receiving/receipts";
import type { DataModel } from "../../convex/schema";
import {
  FIXTURE_UOM,
  createConvexInventoryWorld,
  type ConvexInventoryWorld,
} from "../fixtures/convex-inventory-world";
import {
  recordStepUp,
  seedSecondActorForOrgA,
} from "../fixtures/convex-tenant-world";

interface RuntimeFunction {
  readonly _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
}

const run = (value: unknown) => value as RuntimeFunction;

/** Tenant A's own actor, and a second one for the maker-checker halves. */
const identityA = { subject: "user_fixture_a", org_id: "org_fixture_a" };

async function callAs(
  world: ConvexInventoryWorld,
  identity: { subject: string; org_id: string },
  fn: unknown,
  args: unknown,
): Promise<Record<string, unknown>> {
  return (await world.t
    .withIdentity(identity)
    .run(async (ctx) =>
      run(fn)._handler(ctx as GenericMutationCtx<DataModel>, args),
    )) as Record<string, unknown>;
}

const call = async (
  world: ConvexInventoryWorld,
  fn: unknown,
  args: unknown,
): Promise<Record<string, unknown>> => await callAs(world, identityA, fn, args);

function value(outcome: Record<string, unknown>): Record<string, unknown> {
  expect(outcome["ok"], JSON.stringify(outcome)).toBe(true);
  return outcome["value"] as Record<string, unknown>;
}

/**
 * Unwrap a mutation's answer to the write envelope inside it.
 *
 * Every tenant-bound function answers `TenantOutcome` — `{ok, requestId, value}`
 * — and the write envelope is the `value`. Unwrapping in one place keeps the
 * two failure modes distinguishable: `ok: false` is the wrapper refusing the
 * *caller*, and `written: false` is the handler refusing the *request*.
 */
const writeOf = (outcome: Record<string, unknown>): Record<string, unknown> =>
  value(outcome);

const okWrite = (outcome: Record<string, unknown>): Record<string, unknown> => {
  const result = writeOf(outcome);
  expect(result["written"], JSON.stringify(result)).toBe(true);
  return result;
};

const errorOf = (result: Record<string, unknown>) =>
  result["error"] as { code: string; field?: string; status?: string };

/*
 * One reader per table rather than a bare `ctx.db.get`. `get` is typed as the
 * union of every table's row, so `row.status` would not type-check even where it
 * is the right field.
 */
const readOrder = async (world: ConvexInventoryWorld, id: string) =>
  await world.t.run(
    async (ctx) => await ctx.db.get(id as GenericId<"purchaseOrders">),
  );
const readOrderLine = async (world: ConvexInventoryWorld, id: string) =>
  await world.t.run(
    async (ctx) => await ctx.db.get(id as GenericId<"purchaseOrderLines">),
  );
const readReceiptLine = async (world: ConvexInventoryWorld, id: string) =>
  await world.t.run(
    async (ctx) => await ctx.db.get(id as GenericId<"receiptLines">),
  );
const readInspection = async (world: ConvexInventoryWorld, id: string) =>
  await world.t.run(
    async (ctx) => await ctx.db.get(id as GenericId<"qcInspections">),
  );
const readException = async (world: ConvexInventoryWorld, id: string) =>
  await world.t.run(
    async (ctx) => await ctx.db.get(id as GenericId<"receivingExceptions">),
  );
const readTask = async (world: ConvexInventoryWorld, id: string) =>
  await world.t.run(
    async (ctx) => await ctx.db.get(id as GenericId<"putawayTasks">),
  );

/**
 * A UUIDv7-shaped request ID derived from a readable name.
 *
 * The ledger refuses a request ID that is not a UUIDv7 (`requestIdentity`), and
 * `"line_1"` is not one. Deriving the UUID from a name keeps the tests readable
 * while sending the shape the server actually contracts for — and keeps a retry
 * in a test genuinely identical to its first attempt.
 */
const requestId = (name: string): string => {
  let hash = 0;
  for (const character of name) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  const tail = hash.toString(16).padStart(8, "0");
  return `0193f2c1-0000-7000-8000-0000${tail}`;
};

/** The rows the inbound flows need that the shared world does not seed. */
async function seedInbound(world: ConvexInventoryWorld) {
  return await world.t.run(async (ctx) => {
    const supplier = await ctx.db.insert("suppliers", {
      orgId: world.orgA,
      code: "SUP-01",
      name: "ผู้จัดจำหน่ายทดสอบ",
      status: "ACTIVE",
    });
    const secondRack = await ctx.db.insert("locations", {
      orgId: world.orgA,
      warehouseId: world.warehouses.alphaA,
      code: "RACK-02",
      locationType: "RACK_BIN",
      status: "ACTIVE",
    });
    const receivingReason = await ctx.db.insert("reasonCodes", {
      orgId: world.orgA,
      code: "SHORT-DELIVERY",
      name: "Supplier under-delivered",
      scope: "ADJUSTMENT",
      status: "ACTIVE",
    });
    const qcReason = await ctx.db.insert("reasonCodes", {
      orgId: world.orgA,
      code: "QC-PASS",
      name: "Inspection passed",
      scope: "STATUS_CHANGE",
      status: "ACTIVE",
    });
    const template = await ctx.db.insert("labelTemplates", {
      orgId: world.orgA,
      code: "LPN-4X6",
      version: 1,
      name: "Pallet label",
      format: "ZPL",
      body: "^XA^FD{{LPN}}^FS^FD{{SKU}}^FS^XZ",
      status: "ACTIVE",
      draftedByUserId: world.userA,
    });
    return { supplier, secondRack, receivingReason, qcReason, template };
  });
}

/** Enable QC for one item, so the receipt lands held. */
async function enableQcFor(
  world: ConvexInventoryWorld,
  itemId: GenericId<"items">,
) {
  await world.t.run(async (ctx) => {
    await ctx.db.insert("qcProfiles", {
      orgId: world.orgA,
      itemId,
      enabled: true,
      strategy: "PERCENT",
      parameter: 10,
    });
  });
}

/** Open an order with one line for the untracked item, and return both IDs. */
async function openOrderWithLine(
  world: ConvexInventoryWorld,
  seeded: Awaited<ReturnType<typeof seedInbound>>,
  input: { readonly orderedMinorUnits: number; readonly itemId?: string } = {
    orderedMinorUnits: 100_000,
  },
) {
  const order = okWrite(
    await call(world, createPurchaseOrder, {
      requestId: requestId("po_create_1"),
      warehouseId: world.warehouses.alphaA,
      poNumber: "PO-1001",
      supplierId: seeded.supplier,
    }),
  );

  const line = okWrite(
    await call(world, addPurchaseOrderLine, {
      requestId: requestId("po_line_1"),
      warehouseId: world.warehouses.alphaA,
      purchaseOrderId: order["documentId"],
      lineNumber: 1,
      itemId: input.itemId ?? world.a.untrackedItem,
      quantity: { uom: FIXTURE_UOM, minorUnits: input.orderedMinorUnits },
    }),
  );

  return {
    purchaseOrderId: order["documentId"] as string,
    purchaseOrderLineId: line["documentId"] as string,
  };
}

async function openReceiptFor(
  world: ConvexInventoryWorld,
  purchaseOrderId: string,
  receiptNumber = "GRN-1",
) {
  const receipt = okWrite(
    await call(world, openReceipt, {
      requestId: requestId(`receipt_${receiptNumber}`),
      warehouseId: world.warehouses.alphaA,
      receiptNumber,
      purchaseOrderId,
    }),
  );
  return receipt["documentId"] as string;
}

/* -------------------------------------------------------------------------- */
/* Purchase orders                                                             */
/* -------------------------------------------------------------------------- */

describe("purchase orders", () => {
  it("opens only once it has a line to receive against", async () => {
    /*
     * An order created already open would sit in the receiving queue with
     * nothing on it for somebody to stand in front of at a dock.
     */
    const world = await createConvexInventoryWorld();
    const seeded = await seedInbound(world);

    const order = okWrite(
      await call(world, createPurchaseOrder, {
        requestId: requestId("po_1"),
        warehouseId: world.warehouses.alphaA,
        poNumber: "PO-2001",
        supplierId: seeded.supplier,
      }),
    );

    const before = await readOrder(world, order["documentId"] as string);
    expect(before?.status).toBe("DRAFT");

    await call(world, addPurchaseOrderLine, {
      requestId: requestId("po_line_1"),
      warehouseId: world.warehouses.alphaA,
      purchaseOrderId: order["documentId"],
      lineNumber: 1,
      itemId: world.a.untrackedItem,
      quantity: { uom: FIXTURE_UOM, minorUnits: 10_000 },
    });

    const after = await readOrder(world, order["documentId"] as string);
    expect(after?.status).toBe("OPEN");
  });

  it("refuses a second order under one number, naming the field only", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await seedInbound(world);
    const args = {
      warehouseId: world.warehouses.alphaA,
      poNumber: "PO-3001",
      supplierId: seeded.supplier,
    };

    okWrite(
      await call(world, createPurchaseOrder, {
        ...args,
        requestId: requestId("a"),
      }),
    );
    const clash = writeOf(
      await call(world, createPurchaseOrder, {
        ...args,
        requestId: requestId("b"),
      }),
    );

    expect(clash["written"]).toBe(false);
    expect(errorOf(clash).code).toBe("DUPLICATE_KEY");
    expect(errorOf(clash).field).toBe("poNumber");
    // The refusal names the field and refuses to say what collided with it.
    expect(JSON.stringify(clash)).not.toContain("PO-3001");
  });

  it("replays a create rather than making two orders", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await seedInbound(world);
    const args = {
      requestId: requestId("po_retry"),
      warehouseId: world.warehouses.alphaA,
      poNumber: "PO-4001",
      supplierId: seeded.supplier,
    };

    const first = okWrite(await call(world, createPurchaseOrder, args));
    const second = okWrite(await call(world, createPurchaseOrder, args));

    expect(second["documentId"]).toBe(first["documentId"]);
    expect(second["replayed"]).toBe(true);
  });

  it("closes a line short only with a reason", async () => {
    // `INV-0007-03`. The reason is the row a buyer later reads to ask why the
    // supplier under-delivered.
    const world = await createConvexInventoryWorld({}, { roleA: "ORG_ADMIN" });
    const seeded = await seedInbound(world);
    const { purchaseOrderLineId } = await openOrderWithLine(world, seeded);

    const closed = okWrite(
      await call(world, closeLineShort, {
        requestId: requestId("close_1"),
        warehouseId: world.warehouses.alphaA,
        purchaseOrderLineId,
        reasonCodeId: seeded.receivingReason,
      }),
    );
    expect(closed["written"]).toBe(true);

    const row = await readOrderLine(world, purchaseOrderLineId);
    expect(row?.status).toBe("CLOSED_SHORT");
    expect(row?.closeReasonCodeId).toBe(seeded.receivingReason);
  });
});

/* -------------------------------------------------------------------------- */
/* Import                                                                      */
/* -------------------------------------------------------------------------- */

describe("previewed import", () => {
  const file = [
    "line_number,sku,quantity,uom",
    `1,BULK-001,12.5,${FIXTURE_UOM}`,
    `2,WIDGET-001,4,${FIXTURE_UOM}`,
    "3,,7,PCS",
  ].join("\n");

  it("previews without writing anything", async () => {
    /*
     * The preview is a query, and this is the assertion that makes it matter: an
     * operator approving a list is approving a parse whose only effect was to
     * produce the list.
     */
    const world = await createConvexInventoryWorld();
    await seedInbound(world);

    const preview = value(
      await call(world, previewPurchaseOrderImport, {
        warehouseId: world.warehouses.alphaA,
        batchRef: "BATCH-1",
        text: file,
      }),
    );

    expect(preview["ok"]).toBe(true);
    expect((preview["accepted"] as unknown[]).length).toBe(2);
    expect(
      (preview["rejected"] as { sourceLine: number }[])[0]?.sourceLine,
    ).toBe(4);

    const lines = await world.t.run(
      async (ctx) => await ctx.db.query("purchaseOrderLines").collect(),
    );
    expect(lines).toEqual([]);
  });

  it("writes each source row exactly once, however often the chunk replays", async () => {
    // `INV-0007-12`. A chunk re-run after a crash must recognise its own rows.
    const world = await createConvexInventoryWorld();
    const seeded = await seedInbound(world);

    const order = okWrite(
      await call(world, createPurchaseOrder, {
        requestId: requestId("po_import"),
        warehouseId: world.warehouses.alphaA,
        poNumber: "PO-IMPORT",
        supplierId: seeded.supplier,
      }),
    );

    const args = {
      requestId: requestId("chunk_1"),
      warehouseId: world.warehouses.alphaA,
      purchaseOrderId: order["documentId"],
      batchRef: "BATCH-1",
      text: file,
    };

    const first = okWrite(
      await call(world, applyPurchaseOrderImportChunk, args),
    );
    expect(first["createdCount"]).toBe(2);
    expect(first["complete"]).toBe(true);

    const replay = okWrite(
      await call(world, applyPurchaseOrderImportChunk, {
        ...args,
        requestId: requestId("chunk_2"),
      }),
    );
    expect(replay["createdCount"]).toBe(0);
    expect(replay["skippedCount"]).toBe(2);

    const lines = await world.t.run(
      async (ctx) => await ctx.db.query("purchaseOrderLines").collect(),
    );
    expect(lines).toHaveLength(2);
  });
});

/* -------------------------------------------------------------------------- */
/* Receiving                                                                   */
/* -------------------------------------------------------------------------- */

describe("receiving", () => {
  it("posts a partial receipt and leaves the line open", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await seedInbound(world);
    const { purchaseOrderId, purchaseOrderLineId } = await openOrderWithLine(
      world,
      seeded,
    );
    const receiptId = await openReceiptFor(world, purchaseOrderId);

    const posted = okWrite(
      await call(world, postReceiptLine, {
        requestId: requestId("line_1"),
        warehouseId: world.warehouses.alphaA,
        receiptId,
        locationId: world.a.dock,
        itemId: world.a.untrackedItem,
        purchaseOrderLineId,
        quantity: { uom: FIXTURE_UOM, minorUnits: 60_000 },
      }),
    );

    expect(posted["classification"]).toBe("PARTIAL");
    expect(posted["kind"]).toBe("ORDERED");
    expect(posted["stockStatus"]).toBe("AVAILABLE");

    const line = await readOrderLine(world, purchaseOrderLineId);
    expect(line?.receivedBaseMinorUnits).toBe(60_000);
    expect(line?.status).toBe("OPEN");
  });

  it("classifies against the line total, not against one posting", async () => {
    /*
     * Two postings of 60 against an order of 100 is an over-receipt. A rule that
     * asked "is *this* posting over?" would answer no twice and let 120 in with
     * no approval (`INV-0007-02`).
     */
    const world = await createConvexInventoryWorld();
    const seeded = await seedInbound(world);
    const { purchaseOrderId, purchaseOrderLineId } = await openOrderWithLine(
      world,
      seeded,
    );
    const receiptId = await openReceiptFor(world, purchaseOrderId);

    const common = {
      warehouseId: world.warehouses.alphaA,
      receiptId,
      locationId: world.a.dock,
      itemId: world.a.untrackedItem,
      purchaseOrderLineId,
      quantity: { uom: FIXTURE_UOM, minorUnits: 60_000 },
    };

    okWrite(
      await call(world, postReceiptLine, {
        ...common,
        requestId: requestId("l1"),
      }),
    );
    const second = writeOf(
      await call(world, postReceiptLine, {
        ...common,
        requestId: requestId("l2"),
      }),
    );

    expect(second["written"]).toBe(false);
    expect(errorOf(second).code).toBe("OVER_TOLERANCE_APPROVAL_REQUIRED");
  });

  it("posts a balanced RECEIPT the balance projection agrees with", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await seedInbound(world);
    const { purchaseOrderId, purchaseOrderLineId } = await openOrderWithLine(
      world,
      seeded,
    );
    const receiptId = await openReceiptFor(world, purchaseOrderId);

    okWrite(
      await call(world, postReceiptLine, {
        requestId: requestId("line_1"),
        warehouseId: world.warehouses.alphaA,
        receiptId,
        locationId: world.a.dock,
        itemId: world.a.untrackedItem,
        purchaseOrderLineId,
        quantity: { uom: FIXTURE_UOM, minorUnits: 25_000 },
      }),
    );

    const balances = value(
      await call(world, listBalances, {
        warehouseId: world.warehouses.alphaA,
      }),
    );
    const rows = (balances["items"] ?? []) as {
      stockStatus: string;
      minorUnits: number;
    }[];
    /*
     * Two buckets: the dock, holding the stock, and the supplier boundary at
     * minus the same amount. Their sum is zero, which is the conservation the
     * ledger enforces; the dock's own figure is what an operator sees.
     */
    const available = rows.filter((row) => row.stockStatus === "AVAILABLE");
    expect(available.reduce((sum, row) => sum + row.minorUnits, 0)).toBe(0);
    expect(available.some((row) => row.minorUnits === 25_000)).toBe(true);
  });

  it("replays a double-submitted posting instead of receiving twice", async () => {
    // `INV-0007-01` / `RG-025`: a retry or a double scan never posts twice.
    const world = await createConvexInventoryWorld();
    const seeded = await seedInbound(world);
    const { purchaseOrderId, purchaseOrderLineId } = await openOrderWithLine(
      world,
      seeded,
    );
    const receiptId = await openReceiptFor(world, purchaseOrderId);

    const args = {
      requestId: requestId("same_intent"),
      warehouseId: world.warehouses.alphaA,
      receiptId,
      locationId: world.a.dock,
      itemId: world.a.untrackedItem,
      purchaseOrderLineId,
      quantity: { uom: FIXTURE_UOM, minorUnits: 10_000 },
    };

    okWrite(await call(world, postReceiptLine, args));
    const replay = okWrite(await call(world, postReceiptLine, args));

    expect(replay["replayed"]).toBe(true);

    const line = await readOrderLine(world, purchaseOrderLineId);
    // The running total advanced once, not twice.
    expect(line?.receivedBaseMinorUnits).toBe(10_000);

    const lines = await world.t.run(
      async (ctx) => await ctx.db.query("receiptLines").collect(),
    );
    expect(lines).toHaveLength(1);
  });

  it("requires a lot for a lot-tracked item", async () => {
    // Stock nobody can trace, recall, or rotate by expiry is not stock.
    const world = await createConvexInventoryWorld();
    const seeded = await seedInbound(world);
    const { purchaseOrderId, purchaseOrderLineId } = await openOrderWithLine(
      world,
      seeded,
      { orderedMinorUnits: 50_000, itemId: world.a.item },
    );
    const receiptId = await openReceiptFor(world, purchaseOrderId);

    const missing = writeOf(
      await call(world, postReceiptLine, {
        requestId: requestId("no_lot"),
        warehouseId: world.warehouses.alphaA,
        receiptId,
        locationId: world.a.dock,
        itemId: world.a.item,
        purchaseOrderLineId,
        quantity: { uom: FIXTURE_UOM, minorUnits: 5_000 },
      }),
    );
    expect(errorOf(missing).code).toBe("LOT_REQUIRED");
  });

  it("captures a new lot with its expiry on the way in", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await seedInbound(world);
    const { purchaseOrderId, purchaseOrderLineId } = await openOrderWithLine(
      world,
      seeded,
      { orderedMinorUnits: 50_000, itemId: world.a.item },
    );
    const receiptId = await openReceiptFor(world, purchaseOrderId);

    okWrite(
      await call(world, postReceiptLine, {
        requestId: requestId("with_lot"),
        warehouseId: world.warehouses.alphaA,
        receiptId,
        locationId: world.a.dock,
        itemId: world.a.item,
        purchaseOrderLineId,
        lotCode: "L-2026-05",
        expirationDate: "2027-05-01",
        quantity: { uom: FIXTURE_UOM, minorUnits: 5_000 },
      }),
    );

    const lots = await world.t.run(
      async (ctx) => await ctx.db.query("lots").collect(),
    );
    const created = lots.find((lot) => lot.lotCode === "L-2026-05");
    expect(created?.expirationDate).toBe("2027-05-01");
  });

  it("refuses an unexpected item on the ordinary path", async () => {
    /*
     * `INV-0007-04`. The kind is decided by the server from the rows it read; a
     * handheld cannot declare its own posting ordinary.
     */
    const world = await createConvexInventoryWorld();
    const seeded = await seedInbound(world);
    const { purchaseOrderId, purchaseOrderLineId } = await openOrderWithLine(
      world,
      seeded,
    );
    const receiptId = await openReceiptFor(world, purchaseOrderId);

    const wrongItem = writeOf(
      await call(world, postReceiptLine, {
        requestId: requestId("wrong_item"),
        warehouseId: world.warehouses.alphaA,
        receiptId,
        locationId: world.a.dock,
        // The order line is for `untrackedItem`; this is a different SKU.
        itemId: world.a.item,
        purchaseOrderLineId,
        lotCode: "L-X",
        quantity: { uom: FIXTURE_UOM, minorUnits: 1_000 },
      }),
    );

    /*
     * The server derives `UNEXPECTED` and refuses, rather than posting it. The
     * ordinary entry point declared `receiving.receipt.post`; an unexpected item
     * needs `receiving.receipt.unexpected`, which carries maker-checker, so
     * posting it here would route the delivery around the control built to catch
     * it (`INV-0007-04`).
     */
    expect(wrongItem["written"]).toBe(false);
    expect(errorOf(wrongItem).code).toBe("ITEM_NOT_ON_LINE");
  });
});

/* -------------------------------------------------------------------------- */
/* Receiving preconditions the server owns                                     */
/* -------------------------------------------------------------------------- */

describe("receiving preconditions", () => {
  async function ready(world: ConvexInventoryWorld) {
    const seeded = await seedInbound(world);
    const { purchaseOrderId, purchaseOrderLineId } = await openOrderWithLine(
      world,
      seeded,
    );
    const receiptId = await openReceiptFor(world, purchaseOrderId);
    return { seeded, purchaseOrderId, purchaseOrderLineId, receiptId };
  }

  const post = async (
    world: ConvexInventoryWorld,
    input: Record<string, unknown>,
  ) =>
    writeOf(
      await call(world, postReceiptLine, {
        warehouseId: world.warehouses.alphaA,
        itemId: world.a.untrackedItem,
        quantity: { uom: FIXTURE_UOM, minorUnits: 1_000 },
        ...input,
        // Last, so the readable name in each case becomes the UUID the ledger
        // contracts for rather than being overwritten by the spread.
        requestId: requestId(String(input["requestId"] ?? "precondition")),
      }),
    );

  it("refuses a rack: stock is received to a dock, and putaway moves it off", async () => {
    /*
     * A receipt straight to a rack makes the putaway task a fiction — the stock
     * is already where putaway would have moved it. The rule is the server's,
     * because a client-side picker is a suggestion and this is a constraint.
     */
    const world = await createConvexInventoryWorld();
    const { receiptId, purchaseOrderLineId } = await ready(world);

    const refused = await post(world, {
      requestId: "to_rack",
      receiptId,
      purchaseOrderLineId,
      locationId: world.a.rack,
    });

    expect(refused["written"]).toBe(false);
    expect(errorOf(refused).code).toBe("LOCATION_NOT_RECEIVABLE");
  });

  it("refuses a deactivated dock", async () => {
    const world = await createConvexInventoryWorld();
    const { receiptId, purchaseOrderLineId } = await ready(world);

    await world.t.run(async (ctx) => {
      await ctx.db.patch(world.a.dock, { status: "INACTIVE" });
    });

    const refused = await post(world, {
      requestId: "dead_dock",
      receiptId,
      purchaseOrderLineId,
      locationId: world.a.dock,
    });

    expect(errorOf(refused).code).toBe("LOCATION_NOT_RECEIVABLE");
  });

  it("refuses a dock in another warehouse of the same tenant", async () => {
    /*
     * Same tenant, wrong site. The warehouse edge is a real boundary
     * (`INV-0006-04`) and one the operator can cross by accident: two sites'
     * docks look alike in a picker.
     */
    const world = await createConvexInventoryWorld();
    const { receiptId, purchaseOrderLineId } = await ready(world);

    const refused = await post(world, {
      requestId: "wrong_site",
      receiptId,
      purchaseOrderLineId,
      locationId: world.a.otherWarehouseLocation,
    });

    expect(errorOf(refused).code).toBe("LOCATION_NOT_RECEIVABLE");
  });

  it("refuses a line belonging to a different order than the receipt", async () => {
    /*
     * The receipt names an order; the line must be on it. Otherwise a posting
     * would advance the received total of an order nobody is receiving, and the
     * two documents would disagree about what arrived.
     */
    const world = await createConvexInventoryWorld();
    const { seeded, receiptId } = await ready(world);

    const otherOrder = okWrite(
      await call(world, createPurchaseOrder, {
        requestId: requestId("other_order"),
        warehouseId: world.warehouses.alphaA,
        poNumber: "PO-OTHER",
        supplierId: seeded.supplier,
      }),
    );
    const otherLine = okWrite(
      await call(world, addPurchaseOrderLine, {
        requestId: requestId("other_line"),
        warehouseId: world.warehouses.alphaA,
        purchaseOrderId: otherOrder["documentId"],
        lineNumber: 1,
        itemId: world.a.untrackedItem,
        quantity: { uom: FIXTURE_UOM, minorUnits: 10_000 },
      }),
    );

    const refused = await post(world, {
      requestId: "cross_order",
      receiptId,
      purchaseOrderLineId: otherLine["documentId"],
      locationId: world.a.dock,
    });

    expect(errorOf(refused).code).toBe("LINE_NOT_ON_RECEIPT_ORDER");
  });

  it("refuses an item that is not the one the line ordered", async () => {
    // The ordinary path is for what was ordered. A different item is an
    // exception with its own permission and its own maker (`INV-0007-04`).
    const world = await createConvexInventoryWorld();
    const { receiptId, purchaseOrderLineId } = await ready(world);

    const refused = await post(world, {
      requestId: "wrong_item_ordinary",
      receiptId,
      purchaseOrderLineId,
      locationId: world.a.dock,
      itemId: world.a.item,
      lotCode: "L-1",
    });

    expect(errorOf(refused).code).toBe("ITEM_NOT_ON_LINE");
  });

  it("accepts the valid combination", async () => {
    const world = await createConvexInventoryWorld();
    const { receiptId, purchaseOrderLineId } = await ready(world);

    const posted = await post(world, {
      requestId: "valid",
      receiptId,
      purchaseOrderLineId,
      locationId: world.a.dock,
    });

    expect(posted["written"], JSON.stringify(posted)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Exceptions and maker-checker                                                */
/* -------------------------------------------------------------------------- */

describe("receiving exceptions", () => {
  it("denies posting against an exception the same actor raised", async () => {
    /*
     * `receiving.receipt.unexpected` carries maker-checker, and the maker is
     * whoever raised the exception. Raising your own and receiving against it is
     * exactly what the permission exists to prevent (`INV-0006-05`).
     */
    const world = await createConvexInventoryWorld({}, { roleA: "ORG_ADMIN" });
    const seeded = await seedInbound(world);
    const { purchaseOrderId } = await openOrderWithLine(world, seeded);
    const receiptId = await openReceiptFor(world, purchaseOrderId);

    const raised = okWrite(
      await call(world, raiseReceivingException, {
        requestId: requestId("exc_1"),
        warehouseId: world.warehouses.alphaA,
        kind: "BLIND",
        reasonCodeId: seeded.receivingReason,
      }),
    );

    const denied = await call(world, postExceptionReceiptLine, {
      requestId: requestId("exc_post_1"),
      warehouseId: world.warehouses.alphaA,
      receiptId,
      locationId: world.a.dock,
      itemId: world.a.untrackedItem,
      exceptionId: raised["documentId"],
      quantity: { uom: FIXTURE_UOM, minorUnits: 1_000 },
    });

    expect(denied["ok"]).toBe(false);
    expect((denied["denial"] as { code: string } | undefined)?.code).toBe(
      "AUTHORIZATION_DENIED",
    );
  });

  it("lets a second actor post against a raised exception", async () => {
    const world = await createConvexInventoryWorld({}, { roleA: "ORG_ADMIN" });
    const seeded = await seedInbound(world);
    const second = await seedSecondActorForOrgA(world, "ORG_ADMIN");
    const { purchaseOrderId } = await openOrderWithLine(world, seeded);
    const receiptId = await openReceiptFor(world, purchaseOrderId);

    const raised = okWrite(
      await call(world, raiseReceivingException, {
        requestId: requestId("exc_2"),
        warehouseId: world.warehouses.alphaA,
        kind: "BLIND",
        reasonCodeId: seeded.receivingReason,
      }),
    );

    const posted = okWrite(
      await callAs(
        world,
        { subject: second.clerkUserId, org_id: "org_fixture_a" },
        postExceptionReceiptLine,
        {
          requestId: requestId("exc_post_2"),
          warehouseId: world.warehouses.alphaA,
          receiptId,
          locationId: world.a.dock,
          itemId: world.a.untrackedItem,
          exceptionId: raised["documentId"],
          quantity: { uom: FIXTURE_UOM, minorUnits: 1_000 },
        },
      ),
    );

    expect(posted["kind"]).toBe("BLIND");

    // One raised exception authorizes one posting, not a standing bypass.
    const row = await readException(world, raised["documentId"] as string);
    expect(row?.status).toBe("CONSUMED");
  });
});

/* -------------------------------------------------------------------------- */
/* Quality control                                                             */
/* -------------------------------------------------------------------------- */

describe("quality control", () => {
  async function receiveHeldStock(world: ConvexInventoryWorld) {
    const seeded = await seedInbound(world);
    await enableQcFor(world, world.a.untrackedItem);
    const { purchaseOrderId, purchaseOrderLineId } = await openOrderWithLine(
      world,
      seeded,
    );
    const receiptId = await openReceiptFor(world, purchaseOrderId);

    const posted = okWrite(
      await call(world, postReceiptLine, {
        requestId: requestId("qc_line"),
        warehouseId: world.warehouses.alphaA,
        receiptId,
        locationId: world.a.dock,
        itemId: world.a.untrackedItem,
        purchaseOrderLineId,
        quantity: { uom: FIXTURE_UOM, minorUnits: 40_000 },
      }),
    );
    return { seeded, posted };
  }

  it("lands QC-controlled stock in QC_HOLD with a computed sample plan", async () => {
    const world = await createConvexInventoryWorld();
    const { posted } = await receiveHeldStock(world);

    expect(posted["stockStatus"]).toBe("QC_HOLD");
    expect(posted["inspectionId"]).toBeDefined();

    const inspection = await readInspection(
      world,
      posted["inspectionId"] as string,
    );
    // 10% of 40 whole units, rounded up.
    expect(inspection?.lotSize).toBe(40);
    expect(inspection?.sampleSize).toBe(4);
    expect(inspection?.status).toBe("OPEN");
  });

  it("posts a rejection immediately, as a balanced transition", async () => {
    /*
     * `ADR-0007` §6: a disposition is a ledger transition, never a status edit.
     * `REJECT` keeps the stock unavailable and recoverable, so one inspector may
     * take it without blocking the delivery.
     */
    const world = await createConvexInventoryWorld();
    const { seeded, posted } = await receiveHeldStock(world);

    const disposed = okWrite(
      await call(world, submitDisposition, {
        requestId: requestId("disp_1"),
        warehouseId: world.warehouses.alphaA,
        inspectionId: posted["inspectionId"],
        disposition: "REJECT",
        reasonCodeId: seeded.qcReason,
      }),
    );

    expect(disposed["status"]).toBe("DISPOSED");
    expect(disposed["toStatus"]).toBe("REJECTED");
    expect(disposed["transactionId"]).toBeDefined();

    const balances = value(
      await call(world, listBalances, {
        warehouseId: world.warehouses.alphaA,
      }),
    );
    const rows = (balances["items"] ?? []) as {
      stockStatus: string;
      minorUnits: number;
    }[];
    const totalIn = (status: string) =>
      rows
        .filter((row) => row.stockStatus === status && row.minorUnits > 0)
        .reduce((sum, row) => sum + row.minorUnits, 0);

    // The hold is emptied and the rejected bucket holds it instead — one
    // balanced transition, not a status edit.
    expect(totalIn("QC_HOLD")).toBe(0);
    expect(totalIn("REJECTED")).toBe(40_000);
  });

  it("parks a release and refuses to let the submitter approve it", async () => {
    // `INV-0007-06`. An inspector approving their own release is the whole
    // failure maker-checker exists to prevent.
    const world = await createConvexInventoryWorld({}, { roleA: "ORG_ADMIN" });
    const { seeded, posted } = await receiveHeldStock(world);

    const parked = okWrite(
      await call(world, submitDisposition, {
        requestId: requestId("disp_release"),
        warehouseId: world.warehouses.alphaA,
        inspectionId: posted["inspectionId"],
        disposition: "RELEASE",
        reasonCodeId: seeded.qcReason,
      }),
    );
    expect(parked["status"]).toBe("PENDING_APPROVAL");
    expect(parked["transactionId"]).toBeUndefined();

    await recordStepUp(world, {
      orgId: world.orgA,
      userId: world.userA,
      occurredAt: Date.now(),
      reverifiedAt: Date.now(),
    });

    const denied = await call(world, approveDisposition, {
      requestId: requestId("approve_self"),
      warehouseId: world.warehouses.alphaA,
      inspectionId: posted["inspectionId"],
    });
    expect(denied["ok"]).toBe(false);
  });

  it("releases held stock when a second actor approves, and opens a putaway task", async () => {
    const world = await createConvexInventoryWorld({}, { roleA: "ORG_ADMIN" });
    const { seeded, posted } = await receiveHeldStock(world);
    const second = await seedSecondActorForOrgA(world, "ORG_ADMIN");

    okWrite(
      await call(world, submitDisposition, {
        requestId: requestId("disp_release_2"),
        warehouseId: world.warehouses.alphaA,
        inspectionId: posted["inspectionId"],
        disposition: "RELEASE",
        reasonCodeId: seeded.qcReason,
      }),
    );

    const now = Date.now();
    await recordStepUp(world, {
      orgId: world.orgA,
      userId: second.userId,
      occurredAt: now,
      reverifiedAt: now,
    });

    const approved = okWrite(
      await callAs(
        world,
        { subject: second.clerkUserId, org_id: "org_fixture_a" },
        approveDisposition,
        {
          requestId: requestId("approve_second"),
          warehouseId: world.warehouses.alphaA,
          inspectionId: posted["inspectionId"],
        },
      ),
    );

    expect(approved["toStatus"]).toBe("AVAILABLE");

    /*
     * The putaway task is created here, not at receipt. Creating it at receipt
     * would have put held stock in the putaway queue, which is the bypass
     * `INV-0007-05` forbids.
     */
    const tasks = await world.t.run(
      async (ctx) => await ctx.db.query("putawayTasks").collect(),
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.status).toBe("READY");
  });

  it("lists the inspection queue by status", async () => {
    const world = await createConvexInventoryWorld();
    await receiveHeldStock(world);

    const open = value(
      await call(world, listInspections, {
        warehouseId: world.warehouses.alphaA,
        status: "OPEN",
      }),
    );
    expect((open["items"] as unknown[]).length).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Handling units and labels                                                   */
/* -------------------------------------------------------------------------- */

describe("handling units and label evidence", () => {
  async function receiveOnto(world: ConvexInventoryWorld) {
    const seeded = await seedInbound(world);
    const { purchaseOrderId, purchaseOrderLineId } = await openOrderWithLine(
      world,
      seeded,
    );
    const receiptId = await openReceiptFor(world, purchaseOrderId);

    const posted = okWrite(
      await call(world, postReceiptLine, {
        requestId: requestId("hu_line"),
        warehouseId: world.warehouses.alphaA,
        receiptId,
        locationId: world.a.dock,
        itemId: world.a.untrackedItem,
        purchaseOrderLineId,
        quantity: { uom: FIXTURE_UOM, minorUnits: 30_000 },
      }),
    );
    return { seeded, receiptLineId: posted["documentId"] as string };
  }

  it("builds a pallet from received lines and attaches them", async () => {
    const world = await createConvexInventoryWorld();
    const { receiptLineId } = await receiveOnto(world);

    const built = okWrite(
      await call(world, buildHandlingUnit, {
        requestId: requestId("hu_1"),
        warehouseId: world.warehouses.alphaA,
        lpn: "PALLET-9001",
        locationId: world.a.dock,
        receiptLineIds: [receiptLineId],
      }),
    );

    const line = await readReceiptLine(world, receiptLineId);
    expect(line?.handlingUnitId).toBe(built["documentId"]);
  });

  it("records label evidence with the template version and a payload hash", async () => {
    const world = await createConvexInventoryWorld();
    const { seeded, receiptLineId } = await receiveOnto(world);

    const built = okWrite(
      await call(world, buildHandlingUnit, {
        requestId: requestId("hu_2"),
        warehouseId: world.warehouses.alphaA,
        lpn: "PALLET-9002",
        locationId: world.a.dock,
        receiptLineIds: [receiptLineId],
      }),
    );

    okWrite(
      await call(world, generateLabel, {
        requestId: requestId("label_1"),
        warehouseId: world.warehouses.alphaA,
        labelTemplateId: seeded.template,
        targetKind: "HANDLING_UNIT",
        targetId: built["documentId"],
        fields: { LPN: "PALLET-9002", SKU: "BULK-001" },
      }),
    );

    const jobs = value(
      await call(world, listPrintJobsForTarget, {
        warehouseId: world.warehouses.alphaA,
        targetKind: "HANDLING_UNIT",
        targetId: built["documentId"],
      }),
    );
    const rows = jobs["items"] as {
      templateVersion: number;
      payloadHash: string;
      status: string;
      reason: string;
    }[];

    expect(rows).toHaveLength(1);
    expect(rows[0]?.templateVersion).toBe(1);
    expect(rows[0]?.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    /*
     * `GENERATED` and never `PRINTED`. Nothing in this repository can observe a
     * printer (`INT-04` absent, `RG-004` open).
     */
    expect(rows[0]?.status).toBe("GENERATED");
    expect(rows[0]?.reason).toBe("INITIAL");
  });

  it("refuses to render an unpublished template", async () => {
    const world = await createConvexInventoryWorld();
    const { receiptLineId } = await receiveOnto(world);

    const draft = await world.t.run(
      async (ctx) =>
        await ctx.db.insert("labelTemplates", {
          orgId: world.orgA,
          code: "DRAFT-TPL",
          version: 1,
          name: "Unpublished",
          format: "ZPL",
          body: "^XA^FD{{SKU}}^FS^XZ",
          status: "DRAFT",
          draftedByUserId: world.userA,
        }),
    );

    const refused = writeOf(
      await call(world, generateLabel, {
        requestId: requestId("label_draft"),
        warehouseId: world.warehouses.alphaA,
        labelTemplateId: draft,
        targetKind: "RECEIPT_LINE",
        targetId: receiptLineId,
        fields: { SKU: "BULK-001" },
      }),
    );

    expect(refused["written"]).toBe(false);
    expect(errorOf(refused).code).toBe("TEMPLATE_NOT_PUBLISHED");
  });
});

/* -------------------------------------------------------------------------- */
/* Putaway                                                                     */
/* -------------------------------------------------------------------------- */

describe("putaway", () => {
  async function readyTask(world: ConvexInventoryWorld) {
    const seeded = await seedInbound(world);
    const { purchaseOrderId, purchaseOrderLineId } = await openOrderWithLine(
      world,
      seeded,
    );
    const receiptId = await openReceiptFor(world, purchaseOrderId);

    const posted = okWrite(
      await call(world, postReceiptLine, {
        requestId: requestId("pa_line"),
        warehouseId: world.warehouses.alphaA,
        receiptId,
        locationId: world.a.dock,
        itemId: world.a.untrackedItem,
        purchaseOrderLineId,
        quantity: { uom: FIXTURE_UOM, minorUnits: 20_000 },
      }),
    );

    const tasks = await world.t.run(
      async (ctx) => await ctx.db.query("putawayTasks").collect(),
    );
    return {
      seeded,
      receiptLineId: posted["documentId"] as string,
      taskId: tasks[0]?._id as GenericId<"putawayTasks">,
    };
  }

  it("opens a task when stock lands available", async () => {
    const world = await createConvexInventoryWorld();
    const { taskId } = await readyTask(world);
    expect(taskId).toBeDefined();
  });

  it("gives each task the base unit its quantity is counted in", async () => {
    /*
     * A board at one site holds kilograms of coil, litres of resin, and eaches
     * of carton in the same column, so `baseMinorUnits` without its unit is
     * three measures rendered as one — the visual audit's finding. The unit is
     * the item's, so the read joins it exactly as the order lines do.
     */
    const world = await createConvexInventoryWorld();
    await readyTask(world);

    const page = value(
      await call(world, listPutawayTasks, {
        warehouseId: world.warehouses.alphaA,
      }),
    );
    const tasks = page["items"] as {
      baseMinorUnits: number;
      baseUom?: string;
    }[];

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.baseUom).toBe(FIXTURE_UOM);
    expect(tasks[0]?.baseMinorUnits).toBe(20_000);
  });

  it("recommends a rack and never the dock it is sitting on", async () => {
    // Stock left on a working surface has not been put away; a recommendation
    // that offered one would let the task complete without the pallet moving.
    const world = await createConvexInventoryWorld();
    const { taskId } = await readyTask(world);

    const recommendation = value(
      await call(world, recommendPutawayLocations, {
        warehouseId: world.warehouses.alphaA,
        putawayTaskId: taskId,
      }),
    );

    const ranked = recommendation["ranked"] as { code: string }[];
    const rejected = recommendation["rejected"] as {
      code: string;
      reason: string;
    }[];

    expect(ranked.map((entry) => entry.code)).toContain("RACK-01");
    expect(ranked.map((entry) => entry.code)).not.toContain("DOCK-01");
    expect(rejected.find((entry) => entry.code === "DOCK-01")?.reason).toBe(
      "LOCATION_TYPE_NOT_STORAGE",
    );
  });

  it("lets exactly one actor claim a task", async () => {
    // `INV-0007-11`, resolved on the write rather than on a read both passed.
    const world = await createConvexInventoryWorld({}, { roleA: "ORG_ADMIN" });
    const { taskId } = await readyTask(world);
    const second = await seedSecondActorForOrgA(world, "ORG_ADMIN");

    const first = okWrite(
      await call(world, claimPutawayTask, {
        requestId: requestId("claim_1"),
        warehouseId: world.warehouses.alphaA,
        putawayTaskId: taskId,
      }),
    );
    expect(first["alreadyHeld"]).toBe(false);

    const contender = writeOf(
      await callAs(
        world,
        { subject: second.clerkUserId, org_id: "org_fixture_a" },
        claimPutawayTask,
        {
          requestId: requestId("claim_2"),
          warehouseId: world.warehouses.alphaA,
          putawayTaskId: taskId,
        },
      ),
    );

    expect(contender["written"]).toBe(false);
    expect(errorOf(contender).code).toBe("TASK_CLAIMED_BY_ANOTHER");
  });

  it("lets the holder re-claim their own task after a reconnect", async () => {
    const world = await createConvexInventoryWorld();
    const { taskId } = await readyTask(world);

    await call(world, claimPutawayTask, {
      requestId: requestId("claim_a"),
      warehouseId: world.warehouses.alphaA,
      putawayTaskId: taskId,
    });
    const again = okWrite(
      await call(world, claimPutawayTask, {
        requestId: requestId("claim_b"),
        warehouseId: world.warehouses.alphaA,
        putawayTaskId: taskId,
      }),
    );
    expect(again["alreadyHeld"]).toBe(true);
  });

  it("confirms the recommendation and posts a balanced move", async () => {
    const world = await createConvexInventoryWorld();
    const { taskId } = await readyTask(world);

    const claim = okWrite(
      await call(world, claimPutawayTask, {
        requestId: requestId("claim_c"),
        warehouseId: world.warehouses.alphaA,
        putawayTaskId: taskId,
      }),
    );

    const confirmed = okWrite(
      await call(world, confirmPutaway, {
        requestId: requestId("confirm_1"),
        warehouseId: world.warehouses.alphaA,
        putawayTaskId: taskId,
        chosenLocationId: claim["recommendedLocationId"],
      }),
    );

    expect(confirmed["isOverride"]).toBe(false);

    const balances = value(
      await call(world, listBalances, {
        warehouseId: world.warehouses.alphaA,
      }),
    );
    const rows = (balances["items"] ?? []) as {
      bucketKey: string;
      minorUnits: number;
    }[];
    /*
     * The dock is empty, the rack holds the stock, and the supplier boundary
     * still carries the negative it was received against: the whole warehouse
     * sums to zero, which is what "balanced" means here.
     */
    expect(rows.reduce((sum, row) => sum + row.minorUnits, 0)).toBe(0);
    expect(rows.some((row) => row.minorUnits === 20_000)).toBe(true);
  });

  it("requires a reason to take a runner-up, and records what was recommended", async () => {
    // `INV-0007-09`. Without all four facts, override analytics is a count with
    // no content.
    const world = await createConvexInventoryWorld();
    const { seeded, taskId } = await readyTask(world);

    const claim = okWrite(
      await call(world, claimPutawayTask, {
        requestId: requestId("claim_d"),
        warehouseId: world.warehouses.alphaA,
        putawayTaskId: taskId,
      }),
    );

    const other =
      claim["recommendedLocationId"] === world.a.rack
        ? seeded.secondRack
        : world.a.rack;

    const missingReason = writeOf(
      await call(world, confirmPutaway, {
        requestId: requestId("confirm_no_reason"),
        warehouseId: world.warehouses.alphaA,
        putawayTaskId: taskId,
        chosenLocationId: other,
      }),
    );
    expect(errorOf(missingReason).code).toBe("REASON_REQUIRED");

    const overridden = okWrite(
      await call(world, confirmPutaway, {
        requestId: requestId("confirm_override"),
        warehouseId: world.warehouses.alphaA,
        putawayTaskId: taskId,
        chosenLocationId: other,
        overrideReasonCodeId: seeded.receivingReason,
      }),
    );
    expect(overridden["isOverride"]).toBe(true);

    const task = await readTask(world, taskId);
    expect(task?.chosenLocationId).toBe(other);
    expect(task?.recommendedLocationId).toBe(claim["recommendedLocationId"]);
    expect(task?.overrideReasonCodeId).toBe(seeded.receivingReason);
  });

  it("refuses a location a hard constraint rejected", async () => {
    /*
     * `INV-0007-08`. Compatibility, prohibition, and capacity are not
     * preferences an operator may overrule from a handheld.
     */
    const world = await createConvexInventoryWorld();
    const { seeded, taskId } = await readyTask(world);

    await call(world, claimPutawayTask, {
      requestId: requestId("claim_e"),
      warehouseId: world.warehouses.alphaA,
      putawayTaskId: taskId,
    });

    const refused = writeOf(
      await call(world, confirmPutaway, {
        requestId: requestId("confirm_dock"),
        warehouseId: world.warehouses.alphaA,
        putawayTaskId: taskId,
        chosenLocationId: world.a.dock,
        overrideReasonCodeId: seeded.receivingReason,
      }),
    );

    expect(errorOf(refused).code).toBe("LOCATION_FAILS_HARD_CONSTRAINT");
  });

  it("answers with the stored trace once a task is claimed", async () => {
    /*
     * The confirmation validates against the trace frozen at claim time. A
     * recommendation query that recomputed could offer a bin the confirmation
     * would then refuse — or silently turn an override into a non-override
     * because the warehouse changed while the operator walked to the rack.
     */
    const world = await createConvexInventoryWorld();
    const { taskId } = await readyTask(world);

    const claim = okWrite(
      await call(world, claimPutawayTask, {
        requestId: requestId("claim_trace"),
        warehouseId: world.warehouses.alphaA,
        putawayTaskId: taskId,
      }),
    );

    // Deactivate the recommended bin *after* the claim. A recomputed answer
    // would drop it; the stored trace still names it, which is what the
    // operator was shown and what they will be held to.
    await world.t.run(async (ctx) => {
      await ctx.db.patch(
        claim["recommendedLocationId"] as GenericId<"locations">,
        {
          status: "INACTIVE",
        },
      );
    });

    const recommendation = value(
      await call(world, recommendPutawayLocations, {
        warehouseId: world.warehouses.alphaA,
        putawayTaskId: taskId,
      }),
    );

    const ranked = recommendation["ranked"] as { locationId: string }[];
    expect(ranked.map((entry) => entry.locationId)).toContain(
      claim["recommendedLocationId"],
    );
  });

  it("lists the task board by status", async () => {
    const world = await createConvexInventoryWorld();
    await readyTask(world);

    const ready = value(
      await call(world, listPutawayTasks, {
        warehouseId: world.warehouses.alphaA,
        status: "READY",
      }),
    );
    expect((ready["items"] as unknown[]).length).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* What the screens read                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Two fields that exist for a screen rather than for the domain, and are
 * therefore easy to drop: the unit a line's base quantities are counted in, and
 * the order number a receipt was posted against.
 *
 * Both are joins — the item document and the order document — so neither can be
 * asserted from the row's own table, and both are what the visual audit found
 * missing: a bare `0` under "Received" beside `40.000 CASE` ordered, and
 * `prv_po_2601` where the register says `PO-2601`.
 */
describe("screen-facing read shapes", () => {
  it("gives each order line the base unit its received figure is counted in", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await seedInbound(world);
    const { purchaseOrderId } = await openOrderWithLine(world, seeded);

    const page = value(
      await call(world, listPurchaseOrderLines, {
        warehouseId: world.warehouses.alphaA,
        purchaseOrderId,
      }),
    );
    const lines = page["items"] as {
      baseUom?: string;
      orderedQuantity: { uom: string };
    }[];

    expect(lines).toHaveLength(1);
    expect(lines[0]?.baseUom).toBe(FIXTURE_UOM);
    // The ordered unit is still the unit the order was written in; the two are
    // separate facts even when a fixture makes them the same string.
    expect(lines[0]?.orderedQuantity.uom).toBe(FIXTURE_UOM);
  });

  it("gives each receipt the order number, not only the order's identifier", async () => {
    const world = await createConvexInventoryWorld();
    const seeded = await seedInbound(world);
    const { purchaseOrderId } = await openOrderWithLine(world, seeded);
    await openReceiptFor(world, purchaseOrderId, "GRN-READ-1");

    const page = value(
      await call(world, listReceipts, {
        warehouseId: world.warehouses.alphaA,
      }),
    );
    const receipts = page["items"] as {
      receiptNumber: string;
      purchaseOrderId?: string;
      poNumber?: string;
    }[];

    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.poNumber).toBe("PO-1001");
    expect(receipts[0]?.purchaseOrderId).toBe(purchaseOrderId);
  });

  it("leaves the order number absent on a blind receipt", async () => {
    // A blind receipt has no order behind it, so there is no number to join to
    // and nothing is invented in its place.
    const world = await createConvexInventoryWorld();
    await seedInbound(world);

    okWrite(
      await call(world, openReceipt, {
        requestId: requestId("receipt_blind_read"),
        warehouseId: world.warehouses.alphaA,
        receiptNumber: "GRN-BLIND-1",
      }),
    );

    const page = value(
      await call(world, listReceipts, {
        warehouseId: world.warehouses.alphaA,
      }),
    );
    const receipts = page["items"] as {
      poNumber?: string;
      purchaseOrderId?: string;
    }[];

    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.poNumber).toBeUndefined();
    expect(receipts[0]?.purchaseOrderId).toBeUndefined();
  });
});
