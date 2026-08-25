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
  listArgs,
  pageOf,
  pageOptions,
  pageRefusal,
  pageRequestOf,
  pageResult,
} from "../lib/listEnvelope";
import {
  purchaseOrderLineStatus,
  purchaseOrderStatus,
  signedQuantity,
} from "../lib/validators";
import { MAX_JOB_PAGE_SIZE } from "../model/inventory/jobPage";
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

export const PURCHASING_OPERATIONS = Object.freeze({
  createOrder: "purchasing.po.create",
  addLine: "purchasing.po.addLine",
  cancelOrder: "purchasing.po.cancel",
  closeLineShort: "purchasing.po.closeShort",
  createImportBatch: "purchasing.import.batch",
  applyImportRow: "purchasing.import.row",
});

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

const MAX_ITEM_UOM_ROWS = 16;

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
    return { ok: false, error: { code: "CONVERSION_NOT_EXACT", field: "uom" } };
  }
  return { ok: true, baseMinorUnits: outcome.quantity.minorUnits };
}

const orderUniqueness = (poNumber: string): readonly UniquenessCheck[] => [
  {
    field: "poNumber",
    index: "by_orgId_poNumber",
    equality: [{ field: "poNumber", value: poNumber }],
  },
];

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

    if (order.status === "DRAFT" && !outcome.value.replayed) {
      await ctx.tenantDb.patch("purchaseOrders", args.purchaseOrderId, {
        status: "OPEN",
      });
    }
    return written(outcome.value);
  },
});

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

async function closeShortPolicy(): Promise<{
  readonly thresholdExceeded: boolean;
  readonly approvalSatisfied: boolean;
}> {
  return Object.freeze({ thresholdExceeded: false, approvalSatisfied: true });
}

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
  baseUom: v.optional(v.string()),
  status: purchaseOrderLineStatus,
});

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
    const request = pageRequestOf(args);
    if (!request.ok) return pageRefusal(request.error.code);

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
      .page(pageOptions(request.value));

    return pageResult(
      page.page.map((order) => ({
        purchaseOrderId: order._id as never,
        warehouseId: order.warehouseId as never,
        poNumber: order.poNumber,
        supplierId: order.supplierId as never,
        status: order.status as never,
        ...(order.externalRef === undefined
          ? {}
          : { externalRef: order.externalRef }),
      })),
      page,
    );
  },
});

export const listPurchaseOrderLines = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    purchaseOrderId: v.id("purchaseOrders"),

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
    const request = pageRequestOf(args);
    if (!request.ok) return pageRefusal(request.error.code);

    const order = await ctx.tenantDb.get(
      "purchaseOrders",
      args.purchaseOrderId,
    );
    if (order === null) {
      return pageRefusal("REFERENCE_NOT_FOUND");
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
      .page(pageOptions(request.value));

    const baseUomByItemId = new Map<string, string | undefined>();
    for (const line of page.page) {
      if (baseUomByItemId.has(line.itemId)) continue;
      const item = await ctx.tenantDb.get<ItemDocument>("items", line.itemId);
      baseUomByItemId.set(line.itemId, item?.baseUom);
    }

    return pageResult(
      page.page.map((line) => {
        const baseUom = baseUomByItemId.get(line.itemId);
        return {
          purchaseOrderLineId: line._id as never,
          purchaseOrderId: line.purchaseOrderId as never,
          lineNumber: line.lineNumber,
          itemId: line.itemId as never,
          orderedQuantity: line.orderedQuantity,
          orderedBaseMinorUnits: line.orderedBaseMinorUnits,
          receivedBaseMinorUnits: line.receivedBaseMinorUnits,
          ...(baseUom === undefined ? {} : { baseUom }),
          status: line.status as never,
        };
      }),
      page,
    );
  },
});

export const maxPurchasingPageSize = MAX_JOB_PAGE_SIZE;
