/**
 * Purchase orders: authored in the app, or imported from a previewed file.
 *
 * `ADR-0007` §1 rejects live ERP synchronization for the MVP and asks for two
 * intake paths instead. Both land in the same two tables, and that is the point:
 * a later ERP integration reuses this shape rather than shadowing it, because the
 * *contract* is the table and not the transport (`ADR-0007` §2).
 *
 * ### Why the order is warehouse-scoped
 *
 * A delivery arrives at a *site*. `purchasing.po.read` and `purchasing.po.create`
 * are warehouse-scoped in the catalogue, and an order that belonged only to the
 * organization would be receivable by an actor with no membership at the dock it
 * turned up on (`INV-0006-04`).
 *
 * ### Why the import previews before it writes
 *
 * `previewPurchaseOrderImport` is a **query**. It parses, it reports, and it
 * cannot write — which is exactly what makes the preview trustworthy: an
 * operator approving 300 lines is approving a parse whose only effect was to
 * produce the list they are reading. Applying it is a separate, chunked mutation
 * whose per-row `sourceRowRef` makes a replayed chunk write nothing new
 * (`INV-0007-12`).
 */
import { v } from "convex/values";

import {
  CODE_FIELD,
  createMasterDataRow,
  normalizeField,
  updateMasterDataRow,
  type UniquenessCheck,
} from "../lib/masterDataStore";
import type { TenantOrgId } from "../lib/tenantDb";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantPolicyContext,
} from "../lib/tenantFunctions";
import {
  refusal,
  writeContextOf,
  writeOutcomeValidator,
  written,
} from "../lib/writeEnvelope";
import {
  purchaseOrderLineStatus,
  purchaseOrderStatus,
  signedQuantity,
} from "../lib/validators";
import {
  MAX_JOB_PAGE_SIZE,
  makeJobPageRequest,
} from "../model/inventory/jobPage";
import {
  DEFAULT_CHUNK_SIZE,
  MAX_CHUNK_SIZE,
  previewImport,
  takeChunk,
} from "../model/inbound/poImport";
import { planUnderClose } from "../model/inbound/receiptPolicy";
import { convertToBase, makeItemUomProfile } from "../model/uom/itemUom";
import { makeRatio } from "../model/uom/ratio";
import { makeQuantity } from "../model/uom/quantity";

/* -------------------------------------------------------------------------- */
/* Operations                                                                  */
/* -------------------------------------------------------------------------- */

/** Half of every idempotency key. Code-owned and stable across releases. */
export const PURCHASING_OPERATIONS = Object.freeze({
  createOrder: "purchasing.po.create",
  addLine: "purchasing.po.addLine",
  cancelOrder: "purchasing.po.cancel",
  closeLineShort: "purchasing.po.closeShort",
  createImportBatch: "purchasing.import.batch",
  applyImportRow: "purchasing.import.row",
});

/* -------------------------------------------------------------------------- */
/* Shared row shapes                                                           */
/* -------------------------------------------------------------------------- */

interface OrderDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly poNumber: string;
  readonly supplierId: string;
  readonly status: string;
}

interface OrderLineDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly purchaseOrderId: string;
  readonly lineNumber: number;
  readonly itemId: string;
  readonly orderedBaseMinorUnits: number;
  readonly receivedBaseMinorUnits: number;
  readonly status: string;
}

interface ItemDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly sku: string;
  readonly baseUom: string;
  readonly status: string;
}

interface ItemUomDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly uom: string;
  readonly toBaseNumerator: number;
  readonly toBaseDenominator: number;
  readonly status: string;
}

/** The most alternate units one item may declare; mirrors the catalogue's cap. */
const MAX_ITEM_UOM_ROWS = 16;

/**
 * Convert an ordered quantity into the item's base minor units.
 *
 * Delegates to the UOM kernel rather than doing arithmetic here: the profile is
 * rebuilt from the item's own stored conversions, and `convertToBase` is the one
 * implementation of the conversion (`ADR-0004`). An order written in cases and
 * an item stored in eaches is the normal case, not an edge one.
 *
 * A conversion that does not land on a whole minor unit is refused rather than
 * rounded. Rounding an *order* quantity would make the tolerance arithmetic
 * downstream disagree with the supplier's paperwork by a unit nobody could
 * account for.
 */
export async function convertOrderedToBase(
  tenantDb: Parameters<typeof createMasterDataRow>[0]["tenantDb"],
  item: ItemDocument,
  quantity: { readonly uom: string; readonly minorUnits: number },
): Promise<
  | { readonly ok: true; readonly baseMinorUnits: number }
  | { readonly ok: false; readonly error: { code: string; field?: string } }
> {
  const normalized = makeQuantity(quantity.minorUnits, quantity.uom);
  if (!normalized.ok) {
    return { ok: false, error: { code: "FIELD_INVALID", field: "quantity" } };
  }
  if (normalized.value.minorUnits <= 0) {
    return { ok: false, error: { code: "FIELD_INVALID", field: "quantity" } };
  }

  if (normalized.value.uom === item.baseUom) {
    return { ok: true, baseMinorUnits: normalized.value.minorUnits };
  }

  const rows = await tenantDb
    .byIndex<ItemUomDocument>("itemUoms", "by_orgId_itemId_status_uom", [
      { field: "itemId", value: item._id },
      { field: "status", value: "ACTIVE" },
    ])
    .take(MAX_ITEM_UOM_ROWS);

  const alternates = [];
  for (const row of rows) {
    const ratio = makeRatio(row.toBaseNumerator, row.toBaseDenominator);
    if (!ratio.ok) {
      return { ok: false, error: { code: "FIELD_INVALID", field: "uom" } };
    }
    alternates.push({ uom: row.uom, toBase: ratio.value });
  }

  const profile = makeItemUomProfile({
    itemKey: item.sku,
    baseUom: item.baseUom,
    alternates,
  });
  if (!profile.ok) {
    return { ok: false, error: { code: "FIELD_INVALID", field: "uom" } };
  }

  const outcome = convertToBase(
    profile.value,
    normalized.value.uom,
    normalized.value.minorUnits,
  );
  if (outcome.kind !== "EXACT") {
    // A rounded order quantity disagrees with the supplier's paperwork by a
    // unit nobody can later account for.
    return { ok: false, error: { code: "CONVERSION_NOT_EXACT", field: "uom" } };
  }
  return { ok: true, baseMinorUnits: outcome.quantity.minorUnits };
}

/* -------------------------------------------------------------------------- */
/* Authoring                                                                   */
/* -------------------------------------------------------------------------- */

const orderUniqueness = (poNumber: string): readonly UniquenessCheck[] => [
  {
    field: "poNumber",
    index: "by_orgId_poNumber",
    equality: [{ field: "poNumber", value: poNumber }],
  },
];

/**
 * Create an order header.
 *
 * `DRAFT` rather than `OPEN`, always. An order with no lines cannot receive
 * anything, and creating it already open would put an empty order in the
 * receiving queue for somebody to stand in front of at a dock.
 */
export const createPurchaseOrder = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    poNumber: v.string(),
    supplierId: v.id("suppliers"),
    externalRef: v.optional(v.string()),
  },
  returns: writeOutcomeValidator,
  permissionCode: "purchasing.po.create",
  target: { table: "purchaseOrders" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const poNumber = normalizeField("poNumber", args.poNumber, CODE_FIELD);
    if (!poNumber.ok) return refusal(poNumber.error);

    const supplier = await ctx.tenantDb.get("suppliers", args.supplierId);
    if (supplier === null) {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "supplierId" });
    }

    const document = {
      warehouseId: args.warehouseId,
      poNumber: poNumber.value,
      supplierId: args.supplierId,
      status: "DRAFT",
      ...(args.externalRef === undefined
        ? {}
        : { externalRef: args.externalRef.trim() }),
    };

    const outcome = await createMasterDataRow({
      ...writeContextOf(ctx, {
        table: "purchaseOrders",
        operation: PURCHASING_OPERATIONS.createOrder,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      fingerprint: document,
      uniqueness: orderUniqueness(poNumber.value),
      document,
    });

    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

/**
 * Add one line, and open the order.
 *
 * The status transition is here rather than in a separate "open" mutation
 * because the two facts are one fact: an order becomes receivable exactly when
 * it has something to receive. A separate call would leave a window in which an
 * order has lines and is not receivable, which is a state nobody can act on and
 * everybody has to handle.
 */
export const addPurchaseOrderLine = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    purchaseOrderId: v.id("purchaseOrders"),
    lineNumber: v.number(),
    itemId: v.id("items"),
    quantity: signedQuantity,
  },
  returns: writeOutcomeValidator,
  permissionCode: "purchasing.po.update",
  target: {
    table: "purchaseOrders",
    id: ({ purchaseOrderId }) => purchaseOrderId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const order = await ctx.tenantDb.get<OrderDocument>(
      "purchaseOrders",
      args.purchaseOrderId,
    );
    if (order === null) {
      return refusal({ code: "NOT_FOUND", table: "purchaseOrders" });
    }
    if (order.status !== "DRAFT" && order.status !== "OPEN") {
      return refusal({ code: "ORDER_NOT_EDITABLE", status: order.status });
    }
    if (!Number.isSafeInteger(args.lineNumber) || args.lineNumber <= 0) {
      return refusal({ code: "FIELD_INVALID", field: "lineNumber" });
    }

    const item = await ctx.tenantDb.get<ItemDocument>("items", args.itemId);
    if (item === null) {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "itemId" });
    }

    const base = await convertOrderedToBase(ctx.tenantDb, item, args.quantity);
    if (!base.ok) return refusal(base.error);

    const document = {
      purchaseOrderId: args.purchaseOrderId,
      lineNumber: args.lineNumber,
      itemId: args.itemId,
      orderedQuantity: args.quantity,
      orderedBaseMinorUnits: base.baseMinorUnits,
      receivedBaseMinorUnits: 0,
      status: "OPEN",
    };

    const outcome = await createMasterDataRow({
      ...writeContextOf(ctx, {
        table: "purchaseOrderLines",
        operation: PURCHASING_OPERATIONS.addLine,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      fingerprint: document,
      uniqueness: [
        {
          field: "lineNumber",
          index: "by_orgId_purchaseOrderId_lineNumber",
          equality: [
            { field: "purchaseOrderId", value: args.purchaseOrderId },
            { field: "lineNumber", value: args.lineNumber },
          ],
        },
      ],
      document,
    });

    if (!outcome.ok) return refusal(outcome.error);

    // An order with a line is receivable. Patched after the line commits, so a
    // refused line never opens an empty order.
    if (order.status === "DRAFT" && !outcome.value.replayed) {
      await ctx.tenantDb.patch("purchaseOrders", args.purchaseOrderId, {
        status: "OPEN",
      });
    }
    return written(outcome.value);
  },
});

/**
 * The maker-checker facts for cancelling an order.
 *
 * The maker is whoever created the order, read from the tenant's own audit-bound
 * row rather than from an argument. The evaluator denies when the maker and the
 * actor are the same person (`INV-0006-05`), so cancelling somebody's order is
 * always a second pair of eyes — and cancelling your own is refused, which is
 * the intended reading of separation of duties on a commitment to a supplier.
 */
async function cancelPolicy(
  ctx: TenantPolicyContext,
  args: { readonly purchaseOrderId: string },
): Promise<{
  readonly thresholdExceeded: boolean;
  readonly approvalSatisfied: boolean;
  readonly makerUserId?: string;
}> {
  const audit = await ctx.tenantDb
    .byIndex<{
      readonly orgId: TenantOrgId;
      readonly actorUserId?: string;
    }>("auditEvents", "by_orgId_entityTable_entityId_occurredAt", [
      { field: "entityTable", value: "purchaseOrders" },
      { field: "entityId", value: args.purchaseOrderId },
    ])
    .first();

  if (audit === null || audit.actorUserId === undefined) {
    return Object.freeze({
      thresholdExceeded: false,
      approvalSatisfied: false,
    });
  }
  return Object.freeze({
    thresholdExceeded: false,
    approvalSatisfied: true,
    makerUserId: audit.actorUserId,
  });
}

/** Cancel an order that has not been received against. */
export const cancelPurchaseOrder = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    purchaseOrderId: v.id("purchaseOrders"),
    reasonCodeId: v.id("reasonCodes"),
  },
  returns: writeOutcomeValidator,
  permissionCode: "purchasing.po.cancel",
  target: {
    table: "purchaseOrders",
    id: ({ purchaseOrderId }) => purchaseOrderId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  policy: cancelPolicy,
  handler: async (ctx, args) => {
    const order = await ctx.tenantDb.get<OrderDocument>(
      "purchaseOrders",
      args.purchaseOrderId,
    );
    if (order === null) {
      return refusal({ code: "NOT_FOUND", table: "purchaseOrders" });
    }
    if (order.status === "CANCELLED" || order.status === "CLOSED") {
      return refusal({ code: "ORDER_NOT_EDITABLE", status: order.status });
    }

    const reason = await ctx.tenantDb.get("reasonCodes", args.reasonCodeId);
    if (reason === null) {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "reasonCodeId" });
    }

    /*
     * Received stock is not un-received by cancelling the paperwork. An order
     * with any receipt against it must be closed short instead, line by line,
     * so each shortfall carries its own reason (`INV-0007-03`).
     */
    const receivedLine = await ctx.tenantDb
      .byIndex<OrderLineDocument>(
        "purchaseOrderLines",
        "by_orgId_purchaseOrderId_status",
        [
          { field: "purchaseOrderId", value: args.purchaseOrderId },
          { field: "status", value: "COMPLETE" },
        ],
      )
      .first();
    if (receivedLine !== null) {
      return refusal({ code: "ORDER_HAS_RECEIPTS", table: "receiptLines" });
    }

    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "purchaseOrders",
        operation: PURCHASING_OPERATIONS.cancelOrder,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: args.purchaseOrderId,
      fingerprint: {
        purchaseOrderId: args.purchaseOrderId,
        status: "CANCELLED",
        reasonCodeId: args.reasonCodeId,
      },
      uniqueness: [],
      patch: { status: "CANCELLED" },
    });

    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

/**
 * The threshold facts for closing a line short.
 *
 * `purchasing.po.closeShort` carries `THRESHOLD`, so the wrapper requires this
 * callback. `thresholdExceeded: false` is **provisional and stated**: no policy
 * table exists and `RG-030` is open, so "nothing exceeds an unconfigured
 * threshold" is the only honest reading of an absent policy. When the policy
 * lands this compares the shortfall against the configured limit, and the
 * denial becomes reachable.
 */
async function closeShortPolicy(): Promise<{
  readonly thresholdExceeded: boolean;
  readonly approvalSatisfied: boolean;
}> {
  return Object.freeze({ thresholdExceeded: false, approvalSatisfied: true });
}

/** Stop waiting for the rest of a line, with a reason (`INV-0007-03`). */
export const closeLineShort = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    purchaseOrderLineId: v.id("purchaseOrderLines"),
    reasonCodeId: v.id("reasonCodes"),
  },
  returns: writeOutcomeValidator,
  permissionCode: "purchasing.po.closeShort",
  target: {
    table: "purchaseOrderLines",
    id: ({ purchaseOrderLineId }) => purchaseOrderLineId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  policy: closeShortPolicy,
  handler: async (ctx, args) => {
    const line = await ctx.tenantDb.get<OrderLineDocument>(
      "purchaseOrderLines",
      args.purchaseOrderLineId,
    );
    if (line === null) {
      return refusal({ code: "NOT_FOUND", table: "purchaseOrderLines" });
    }

    const reason = await ctx.tenantDb.get("reasonCodes", args.reasonCodeId);
    if (reason === null) {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "reasonCodeId" });
    }

    const plan = planUnderClose({
      status: line.status as "OPEN",
      orderedMinorUnits: line.orderedBaseMinorUnits,
      receivedMinorUnits: line.receivedBaseMinorUnits,
      reasonCodeId: args.reasonCodeId,
    });
    if (!plan.ok) return refusal(plan.error);

    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "purchaseOrderLines",
        operation: PURCHASING_OPERATIONS.closeLineShort,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: args.purchaseOrderLineId,
      fingerprint: {
        purchaseOrderLineId: args.purchaseOrderLineId,
        status: "CLOSED_SHORT",
        reasonCodeId: args.reasonCodeId,
        shortfall: plan.value.shortfallMinorUnits,
      },
      uniqueness: [],
      patch: {
        status: "CLOSED_SHORT",
        closeReasonCodeId: args.reasonCodeId,
      },
    });

    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

/* -------------------------------------------------------------------------- */
/* Import                                                                      */
/* -------------------------------------------------------------------------- */

const importRowValidator = v.object({
  sourceRowRef: v.string(),
  sourceLine: v.number(),
  lineNumber: v.number(),
  sku: v.string(),
  quantityMinorUnits: v.number(),
  uom: v.string(),
});

const importPreviewValidator = v.union(
  v.object({
    ok: v.literal(true),
    batchRef: v.string(),
    accepted: v.array(importRowValidator),
    rejected: v.array(
      v.object({
        sourceLine: v.number(),
        code: v.string(),
        column: v.optional(v.string()),
      }),
    ),
    empty: v.boolean(),
  }),
  v.object({ ok: v.literal(false), error: v.object({ code: v.string() }) }),
);

/**
 * Parse an import file and report what it would do. Writes nothing.
 *
 * A **query**, and that is the design rather than an implementation detail: an
 * operator approving three hundred lines is approving a parse whose only effect
 * was to produce the list in front of them. A preview that could write would be
 * a preview nobody should trust.
 *
 * The file text is an argument rather than a stored upload, because storing it
 * would be a private-document retention decision (`ADR-0008` file storage port)
 * this slice has not made. The cost is that applying the import re-sends the
 * text; parsing is deterministic, so the accepted list is identical each time.
 */
export const previewPurchaseOrderImport = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    batchRef: v.string(),
    text: v.string(),
  },
  returns: importPreviewValidator,
  permissionCode: "purchasing.po.import",
  target: { table: "poImportBatches" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (_ctx, args) => {
    const preview = previewImport({
      batchRef: args.batchRef,
      text: args.text,
    });
    if (!preview.ok) {
      return { ok: false as const, error: { code: preview.error.code } };
    }

    return {
      ok: true as const,
      batchRef: preview.value.batchRef,
      accepted: preview.value.accepted.map((row) => ({ ...row })),
      rejected: preview.value.rejected.map((row) => ({
        sourceLine: row.sourceLine,
        code: row.problem.code,
        ...("column" in row.problem ? { column: row.problem.column } : {}),
      })),
      empty: preview.value.empty,
    };
  },
});

const importChunkValidator = v.union(
  v.object({
    written: v.literal(true),
    documentId: v.string(),
    replayed: v.boolean(),
    /** How many lines this chunk created; a replayed chunk creates none. */
    createdCount: v.number(),
    skippedCount: v.number(),
    nextCursor: v.union(v.number(), v.null()),
    complete: v.boolean(),
  }),
  v.object({
    written: v.literal(false),
    error: v.object({
      code: v.string(),
      field: v.optional(v.string()),
      table: v.optional(v.string()),
      reason: v.optional(v.string()),
      status: v.optional(v.string()),
      requestId: v.optional(v.string()),
    }),
  }),
);

/**
 * Apply one bounded chunk of a previewed import (`INV-0007-12`).
 *
 * Three properties, each of which the caller depends on:
 *
 * - **Chunked.** At most `MAX_CHUNK_SIZE` lines per mutation, so a 5,000-row
 *   file is many bounded writes rather than one transaction that times out.
 * - **Resumable.** The cursor is an offset into the deterministic parse, so the
 *   caller re-sends the same text and asks for the next offset. No transaction
 *   is held open between chunks.
 * - **Idempotent per row.** Each line carries its `sourceRowRef`, and the row is
 *   skipped if that reference already exists. A chunk replayed after a crash
 *   creates nothing, and it reports how many it skipped rather than claiming a
 *   write.
 */
export const applyPurchaseOrderImportChunk = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    purchaseOrderId: v.id("purchaseOrders"),
    batchRef: v.string(),
    text: v.string(),
    cursor: v.optional(v.number()),
    chunkSize: v.optional(v.number()),
  },
  returns: importChunkValidator,
  permissionCode: "purchasing.po.import",
  target: {
    table: "purchaseOrders",
    id: ({ purchaseOrderId }) => purchaseOrderId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const order = await ctx.tenantDb.get<OrderDocument>(
      "purchaseOrders",
      args.purchaseOrderId,
    );
    if (order === null) {
      return refusal({ code: "NOT_FOUND", table: "purchaseOrders" });
    }
    if (order.status !== "DRAFT" && order.status !== "OPEN") {
      return refusal({ code: "ORDER_NOT_EDITABLE", status: order.status });
    }

    const preview = previewImport({ batchRef: args.batchRef, text: args.text });
    if (!preview.ok) return refusal(preview.error);

    const chunk = takeChunk({
      accepted: preview.value.accepted,
      ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
      chunkSize: Math.min(args.chunkSize ?? DEFAULT_CHUNK_SIZE, MAX_CHUNK_SIZE),
    });
    if (!chunk.ok) return refusal(chunk.error);

    let created = 0;
    let skipped = 0;

    for (const row of chunk.value.rows) {
      // The per-row idempotency check. A replayed chunk finds its own rows.
      const existing = await ctx.tenantDb
        .byIndex<OrderLineDocument>(
          "purchaseOrderLines",
          "by_orgId_sourceRowRef",
          [{ field: "sourceRowRef", value: row.sourceRowRef }],
        )
        .first();
      if (existing !== null) {
        skipped += 1;
        continue;
      }

      const item = await ctx.tenantDb
        .byIndex<ItemDocument>("items", "by_orgId_sku", [
          { field: "sku", value: row.sku },
        ])
        .unique();
      if (item === null) {
        // A SKU the tenant does not have is a row problem, not a batch failure:
        // the rest of the file is still correct and still worth writing.
        skipped += 1;
        continue;
      }

      const base = await convertOrderedToBase(ctx.tenantDb, item, {
        uom: row.uom,
        minorUnits: row.quantityMinorUnits,
      });
      if (!base.ok) {
        skipped += 1;
        continue;
      }

      await ctx.tenantDb.insert("purchaseOrderLines", {
        purchaseOrderId: args.purchaseOrderId,
        lineNumber: row.lineNumber,
        itemId: item._id,
        orderedQuantity: { uom: row.uom, minorUnits: row.quantityMinorUnits },
        orderedBaseMinorUnits: base.baseMinorUnits,
        receivedBaseMinorUnits: 0,
        status: "OPEN",
        sourceRowRef: row.sourceRowRef,
      });
      created += 1;
    }

    if (created > 0 && order.status === "DRAFT") {
      await ctx.tenantDb.patch("purchaseOrders", args.purchaseOrderId, {
        status: "OPEN",
      });
    }

    return {
      written: true as const,
      documentId: args.purchaseOrderId,
      replayed: created === 0 && skipped > 0,
      createdCount: created,
      skippedCount: skipped,
      nextCursor: chunk.value.nextCursor,
      complete: chunk.value.complete,
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

const orderValidator = v.object({
  purchaseOrderId: v.id("purchaseOrders"),
  warehouseId: v.id("warehouses"),
  poNumber: v.string(),
  supplierId: v.id("suppliers"),
  status: purchaseOrderStatus,
  externalRef: v.optional(v.string()),
});

const orderLineValidator = v.object({
  purchaseOrderLineId: v.id("purchaseOrderLines"),
  purchaseOrderId: v.id("purchaseOrders"),
  lineNumber: v.number(),
  itemId: v.id("items"),
  orderedQuantity: signedQuantity,
  orderedBaseMinorUnits: v.number(),
  receivedBaseMinorUnits: v.number(),
  status: purchaseOrderLineStatus,
});

const pageOf = <Row extends Parameters<typeof v.array>[0]>(row: Row) =>
  v.union(
    v.object({
      ok: v.literal(true),
      items: v.array(row),
      nextCursor: v.union(v.string(), v.null()),
      complete: v.boolean(),
    }),
    v.object({
      ok: v.literal(false),
      error: v.object({ code: v.string() }),
    }),
  );

const listArgs = {
  maxPageSize: v.optional(v.number()),
  cursor: v.optional(v.string()),
};

/** Orders at one site, newest number first by index order. */
export const listPurchaseOrders = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    status: v.optional(purchaseOrderStatus),
    ...listArgs,
  },
  returns: pageOf(orderValidator),
  permissionCode: "purchasing.po.read",
  target: { table: "purchaseOrders" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const request = makeJobPageRequest({
      ...(args.maxPageSize === undefined
        ? {}
        : { maxPageSize: args.maxPageSize }),
      ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
    });
    if (!request.ok) {
      return { ok: false as const, error: { code: request.error.code } };
    }

    const page = await ctx.tenantDb
      .byIndex<OrderDocument & { readonly externalRef?: string }>(
        "purchaseOrders",
        "by_orgId_warehouseId_status_poNumber",
        [
          { field: "warehouseId", value: args.warehouseId },
          ...(args.status === undefined
            ? []
            : [{ field: "status", value: args.status }]),
        ],
      )
      .page({
        limit: request.value.maxPageSize,
        ...(request.value.cursor === null
          ? {}
          : { cursor: request.value.cursor }),
      });

    return {
      ok: true as const,
      items: page.page.map((order) => ({
        purchaseOrderId: order._id as never,
        warehouseId: order.warehouseId as never,
        poNumber: order.poNumber,
        supplierId: order.supplierId as never,
        status: order.status as never,
        ...(order.externalRef === undefined
          ? {}
          : { externalRef: order.externalRef }),
      })),
      nextCursor: page.isDone ? null : page.continueCursor,
      complete: page.isDone,
    };
  },
});

/** The lines of one order, in position order. */
export const listPurchaseOrderLines = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    purchaseOrderId: v.id("purchaseOrders"),
    /**
     * Narrow to one line status, served by `by_orgId_purchaseOrderId_status`.
     *
     * The receiving capture screen asks for `OPEN` lines and nothing else: a
     * complete, cancelled, or short-closed line cannot be received against, and
     * offering one in a picker would be offering a choice the server refuses.
     */
    status: v.optional(purchaseOrderLineStatus),
    ...listArgs,
  },
  returns: pageOf(orderLineValidator),
  permissionCode: "purchasing.po.read",
  target: {
    table: "purchaseOrders",
    id: ({ purchaseOrderId }) => purchaseOrderId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const request = makeJobPageRequest({
      ...(args.maxPageSize === undefined
        ? {}
        : { maxPageSize: args.maxPageSize }),
      ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
    });
    if (!request.ok) {
      return { ok: false as const, error: { code: request.error.code } };
    }

    /*
     * The order is read first, through the tenant-bound accessor, so another
     * tenant's order ID answers the same "no such order" a nonexistent one does
     * (`INV-0002-03`) rather than an empty page that would confirm the ID
     * parses.
     */
    const order = await ctx.tenantDb.get(
      "purchaseOrders",
      args.purchaseOrderId,
    );
    if (order === null) {
      return { ok: false as const, error: { code: "REFERENCE_NOT_FOUND" } };
    }

    const page = await ctx.tenantDb
      .byIndex<OrderLineDocument & { readonly orderedQuantity: never }>(
        "purchaseOrderLines",
        args.status === undefined
          ? "by_orgId_purchaseOrderId_lineNumber"
          : "by_orgId_purchaseOrderId_status",
        [
          { field: "purchaseOrderId", value: args.purchaseOrderId },
          ...(args.status === undefined
            ? []
            : [{ field: "status", value: args.status }]),
        ],
      )
      .page({
        limit: request.value.maxPageSize,
        ...(request.value.cursor === null
          ? {}
          : { cursor: request.value.cursor }),
      });

    return {
      ok: true as const,
      items: page.page.map((line) => ({
        purchaseOrderLineId: line._id as never,
        purchaseOrderId: line.purchaseOrderId as never,
        lineNumber: line.lineNumber,
        itemId: line.itemId as never,
        orderedQuantity: line.orderedQuantity,
        orderedBaseMinorUnits: line.orderedBaseMinorUnits,
        receivedBaseMinorUnits: line.receivedBaseMinorUnits,
        status: line.status as never,
      })),
      nextCursor: page.isDone ? null : page.continueCursor,
      complete: page.isDone,
    };
  },
});

/** The page cap, re-exported so a client can size its own loop. */
export const maxPurchasingPageSize = MAX_JOB_PAGE_SIZE;
