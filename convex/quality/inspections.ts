import { v } from "convex/values";

import { postLedgerTransaction } from "../lib/inventoryLedgerStore";
import {
  listArgs,
  pageOf,
  pageOptions,
  pageRefusal,
  pageRequestOf,
  pageResult,
} from "../lib/listEnvelope";
import type { LedgerTransactionDraft } from "../model/inventory/ledgerTransaction";
import { adjustRollup } from "../lib/rollupStore";
import type { TenantOrgId } from "../lib/tenantDb";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
  type TenantPolicyContext,
} from "../lib/tenantFunctions";
import { refusal } from "../lib/writeEnvelope";
import {
  inspectionStatus,
  qcDisposition,
  samplingStrategy,
} from "../lib/validators";
import { MAX_JOB_PAGE_SIZE } from "../model/inventory/jobPage";
import {
  assertSubmittable,
  planDisposition,
  statusAfterSubmission,
  type DispositionPlan,
} from "../model/inbound/qcPolicy";

export const QUALITY_OPERATIONS = Object.freeze({
  submitDisposition: "quality.disposition.submit",
  approveDisposition: "quality.disposition.approve",
});

interface InspectionDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly receiptLineId: string;
  readonly itemId: string;
  readonly status: string;
  readonly disposition?: string;
  readonly reasonCodeId?: string;
  readonly submittedByUserId?: string;
}

interface ReceiptLineDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly itemId: string;
  readonly lotId?: string;
  readonly handlingUnitId?: string;
  readonly locationId: string;
  readonly baseMinorUnits: number;
  readonly stockStatus: string;
}

interface ItemDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly baseUom: string;
}

async function postDisposition(
  ctx: TenantFunctionContext,
  input: {
    readonly requestId: string;
    readonly warehouseId: string;
    readonly inspectionId: string;
    readonly line: ReceiptLineDocument;
    readonly item: ItemDocument;
    readonly plan: DispositionPlan;
  },
): Promise<
  | { readonly ok: true; readonly transactionId: string }
  | { readonly ok: false; readonly error: { code: string } }
> {
  const orgId = ctx.tenant.organization._id;
  const now = Date.now();
  const location = {
    kind: "PHYSICAL" as const,
    locationId: input.line.locationId,
  };

  const bucketAt = (status: string) => ({
    orgId,
    warehouseId: input.warehouseId,
    itemId: input.line.itemId,
    location,
    stockStatus: status,
    ...(input.line.lotId === undefined ? {} : { lotId: input.line.lotId }),
    ...(input.line.handlingUnitId === undefined
      ? {}
      : { handlingUnitId: input.line.handlingUnitId }),
  });

  const draft = {
    orgId,
    warehouseId: input.warehouseId,
    type: "STATUS_CHANGE",
    operation: QUALITY_OPERATIONS.approveDisposition,
    requestId: input.requestId,
    actorUserId: ctx.tenant.actor._id,
    occurredAt: now,
    source: { type: "QC_INSPECTION", id: input.inspectionId },
    reasonCodeId: input.plan.reasonCodeId,
    lines: [
      {
        bucket: bucketAt(input.plan.fromStatus),
        quantity: {
          uom: input.item.baseUom,
          minorUnits: -input.line.baseMinorUnits,
        },
      },
      {
        bucket: bucketAt(input.plan.toStatus),
        quantity: {
          uom: input.item.baseUom,
          minorUnits: input.line.baseMinorUnits,
        },
      },
    ],
  } as unknown as LedgerTransactionDraft;

  const posted = await postLedgerTransaction({
    tenantDb: ctx.tenantDb,
    tenant: ctx.tenant,
    permissionCode: ctx.permission.code,
    now,
    draft,
  });
  if (!posted.ok) {
    return { ok: false, error: posted.error as unknown as { code: string } };
  }
  return { ok: true, transactionId: posted.value.result.transactionId };
}

async function loadInspection(
  ctx: TenantFunctionContext,
  inspectionId: string,
  warehouseId: string,
): Promise<
  | {
      readonly ok: true;
      readonly inspection: InspectionDocument;
      readonly line: ReceiptLineDocument;
      readonly item: ItemDocument;
    }
  | { readonly ok: false; readonly error: ReturnType<typeof refusal> }
> {
  const inspection = await ctx.tenantDb.get<InspectionDocument>(
    "qcInspections",
    inspectionId,
  );

  if (inspection === null || inspection.warehouseId !== warehouseId) {
    return {
      ok: false,
      error: refusal({ code: "NOT_FOUND", table: "qcInspections" }),
    };
  }

  const line = await ctx.tenantDb.get<ReceiptLineDocument>(
    "receiptLines",
    inspection.receiptLineId,
  );
  if (line === null) {
    return {
      ok: false,
      error: refusal({ code: "REFERENCE_NOT_FOUND", field: "receiptLineId" }),
    };
  }

  const item = await ctx.tenantDb.get<ItemDocument>("items", line.itemId);
  if (item === null) {
    return {
      ok: false,
      error: refusal({ code: "REFERENCE_NOT_FOUND", field: "itemId" }),
    };
  }
  return { ok: true, inspection, line, item };
}

const dispositionOutcomeValidator = v.union(
  v.object({
    written: v.literal(true),
    documentId: v.string(),
    replayed: v.boolean(),
    status: inspectionStatus,

    transactionId: v.optional(v.string()),
    toStatus: v.string(),
  }),
  v.object({
    written: v.literal(false),
    error: v.object({
      code: v.string(),
      field: v.optional(v.string()),
      reason: v.optional(v.string()),
      table: v.optional(v.string()),
      status: v.optional(v.string()),
      requestId: v.optional(v.string()),
    }),
  }),
);

export const submitDisposition = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    inspectionId: v.id("qcInspections"),
    disposition: qcDisposition,
    reasonCodeId: v.id("reasonCodes"),
  },
  returns: dispositionOutcomeValidator,
  permissionCode: "quality.disposition.submit",
  target: { table: "qcInspections", id: ({ inspectionId }) => inspectionId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const loaded = await loadInspection(
      ctx,
      args.inspectionId,
      args.warehouseId,
    );
    if (!loaded.ok) return loaded.error;

    const guard = assertSubmittable(loaded.inspection.status as "OPEN");
    if (!guard.ok) return refusal(guard.error);

    const reason = await ctx.tenantDb.get("reasonCodes", args.reasonCodeId);
    if (reason === null) {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "reasonCodeId" });
    }

    const plan = planDisposition({
      disposition: args.disposition,
      sourceStatus: loaded.line.stockStatus,
      reasonCodeId: args.reasonCodeId,
    });
    if (!plan.ok) return refusal(plan.error);

    const nextStatus = statusAfterSubmission(plan.value);

    if (nextStatus === "PENDING_APPROVAL") {
      await ctx.tenantDb.patch("qcInspections", args.inspectionId, {
        status: nextStatus,
        disposition: args.disposition,
        reasonCodeId: args.reasonCodeId,
        submittedByUserId: ctx.tenant.actor._id,
      });

      await moveInspectionCounters(ctx, args.warehouseId, {
        pending: -1,
        parked: 1,
      });
      return {
        written: true as const,
        documentId: args.inspectionId,
        replayed: false,
        status: nextStatus,
        toStatus: plan.value.toStatus,
      };
    }

    const posted = await postDisposition(ctx, {
      requestId: args.requestId,
      warehouseId: args.warehouseId,
      inspectionId: args.inspectionId,
      line: loaded.line,
      item: loaded.item,
      plan: plan.value,
    });
    if (!posted.ok) return refusal(posted.error);

    await ctx.tenantDb.patch("qcInspections", args.inspectionId, {
      status: "DISPOSED",
      disposition: args.disposition,
      reasonCodeId: args.reasonCodeId,
      submittedByUserId: ctx.tenant.actor._id,
      transactionId: posted.transactionId,
    });

    await moveInspectionCounters(ctx, args.warehouseId, { pending: -1 });

    await ctx.tenantDb.patch("receiptLines", loaded.line._id, {
      stockStatus: plan.value.toStatus,
    });

    return {
      written: true as const,
      documentId: args.inspectionId,
      replayed: false,
      status: "DISPOSED" as const,
      transactionId: posted.transactionId,
      toStatus: plan.value.toStatus,
    };
  },
});

async function moveInspectionCounters(
  ctx: TenantFunctionContext,
  warehouseId: string,
  deltas: { readonly pending?: number; readonly parked?: number },
): Promise<void> {
  const now = Date.now();
  if (deltas.pending !== undefined) {
    await adjustRollup({
      tenantDb: ctx.tenantDb,
      warehouseId,
      metric: "QC_PENDING",
      delta: deltas.pending,
      now,
    });
  }
  if (deltas.parked !== undefined) {
    await adjustRollup({
      tenantDb: ctx.tenantDb,
      warehouseId,
      metric: "QC_PARKED",
      delta: deltas.parked,
      now,
    });
  }
}

async function approvalPolicy(
  ctx: TenantPolicyContext,
  args: { readonly inspectionId: string },
): Promise<{
  readonly thresholdExceeded: boolean;
  readonly approvalSatisfied: boolean;
  readonly makerUserId?: string;
}> {
  const inspection = await ctx.tenantDb.get<InspectionDocument>(
    "qcInspections",
    args.inspectionId,
  );
  if (
    inspection === null ||
    inspection.status !== "PENDING_APPROVAL" ||
    inspection.submittedByUserId === undefined
  ) {
    return Object.freeze({
      thresholdExceeded: false,
      approvalSatisfied: false,
    });
  }
  return Object.freeze({
    thresholdExceeded: false,
    approvalSatisfied: true,
    makerUserId: inspection.submittedByUserId,
  });
}

export const approveDisposition = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    inspectionId: v.id("qcInspections"),
  },
  returns: dispositionOutcomeValidator,
  permissionCode: "quality.disposition.approve",
  target: { table: "qcInspections", id: ({ inspectionId }) => inspectionId },
  warehouseId: ({ warehouseId }) => warehouseId,
  policy: approvalPolicy,
  handler: async (ctx, args) => {
    const loaded = await loadInspection(
      ctx,
      args.inspectionId,
      args.warehouseId,
    );
    if (!loaded.ok) return loaded.error;

    if (loaded.inspection.status !== "PENDING_APPROVAL") {
      return refusal({
        code: "INSPECTION_NOT_PENDING",
        status: loaded.inspection.status,
      });
    }

    const plan = planDisposition({
      disposition: loaded.inspection.disposition ?? "",
      sourceStatus: loaded.line.stockStatus,
      reasonCodeId: loaded.inspection.reasonCodeId ?? "",
    });
    if (!plan.ok) return refusal(plan.error);

    const posted = await postDisposition(ctx, {
      requestId: args.requestId,
      warehouseId: args.warehouseId,
      inspectionId: args.inspectionId,
      line: loaded.line,
      item: loaded.item,
      plan: plan.value,
    });
    if (!posted.ok) return refusal(posted.error);

    await ctx.tenantDb.patch("qcInspections", args.inspectionId, {
      status: "DISPOSED",
      approvedByUserId: ctx.tenant.actor._id,
      transactionId: posted.transactionId,
    });
    await moveInspectionCounters(ctx, args.warehouseId, { parked: -1 });
    await ctx.tenantDb.patch("receiptLines", loaded.line._id, {
      stockStatus: plan.value.toStatus,
    });

    if (plan.value.toStatus === "AVAILABLE") {
      const existing = await ctx.tenantDb
        .byIndex<{ readonly _id: string; readonly orgId: TenantOrgId }>(
          "putawayTasks",
          "by_orgId_receiptLineId",
          [{ field: "receiptLineId", value: loaded.line._id }],
        )
        .first();
      if (existing === null) {
        await ctx.tenantDb.insert("putawayTasks", {
          warehouseId: args.warehouseId,
          receiptLineId: loaded.line._id,
          itemId: loaded.line.itemId,
          baseMinorUnits: loaded.line.baseMinorUnits,
          fromLocationId: loaded.line.locationId,
          status: "READY",
          ...(loaded.line.lotId === undefined
            ? {}
            : { lotId: loaded.line.lotId }),
          ...(loaded.line.handlingUnitId === undefined
            ? {}
            : { handlingUnitId: loaded.line.handlingUnitId }),
        });
        await adjustRollup({
          tenantDb: ctx.tenantDb,
          warehouseId: args.warehouseId,
          metric: "PUTAWAY_READY",
          delta: 1,
          now: Date.now(),
        });
      }
    }

    return {
      written: true as const,
      documentId: args.inspectionId,
      replayed: false,
      status: "DISPOSED" as const,
      transactionId: posted.transactionId,
      toStatus: plan.value.toStatus,
    };
  },
});

const inspectionValidator = v.object({
  inspectionId: v.id("qcInspections"),
  warehouseId: v.id("warehouses"),
  receiptLineId: v.id("receiptLines"),
  itemId: v.id("items"),
  status: inspectionStatus,
  strategy: samplingStrategy,
  sampleSize: v.number(),
  lotSize: v.number(),
  disposition: v.optional(qcDisposition),
});

export const listInspections = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    status: v.optional(inspectionStatus),
    ...listArgs,
  },
  returns: pageOf(inspectionValidator),
  permissionCode: "quality.inspection.read",
  target: { table: "qcInspections" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
    if (!request.ok) return pageRefusal(request.error.code);

    const page = await ctx.tenantDb
      .byIndex<InspectionDocument & Record<string, never>>(
        "qcInspections",
        "by_orgId_warehouseId_status",
        [
          { field: "warehouseId", value: args.warehouseId },
          ...(args.status === undefined
            ? []
            : [{ field: "status", value: args.status }]),
        ],
      )
      .page(pageOptions(request.value));

    return pageResult(
      page.page.map((row) => {
        const record = row as unknown as Record<string, unknown>;
        return {
          inspectionId: row._id as never,
          warehouseId: record["warehouseId"] as never,
          receiptLineId: record["receiptLineId"] as never,
          itemId: record["itemId"] as never,
          status: record["status"] as never,
          strategy: record["strategy"] as never,
          sampleSize: record["sampleSize"] as number,
          lotSize: record["lotSize"] as number,
          ...(record["disposition"] === undefined
            ? {}
            : { disposition: record["disposition"] as never }),
        };
      }),
      page,
    );
  },
});

export const maxQualityPageSize = MAX_JOB_PAGE_SIZE;
