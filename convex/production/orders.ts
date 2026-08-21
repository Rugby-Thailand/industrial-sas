/** Revision-pinned production execution with ledger-backed material and FG movement. */
import { v } from "convex/values";

import {
  CODE_FIELD,
  appendDomainAudit,
  createMasterDataRow,
  insertedFields,
  normalizeDisplayName,
  normalizeField,
  replayTenantWriteIfPresent,
  updateMasterDataRow,
} from "../lib/masterDataStore";
import {
  postLedgerTransaction,
  toPublicLedgerError,
} from "../lib/inventoryLedgerStore";
import {
  listArgs,
  pageOf,
  pageOptions,
  pageRefusal,
  pageRequestOf,
} from "../lib/listEnvelope";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantPolicyContext,
} from "../lib/tenantFunctions";
import type { TenantOrgId } from "../lib/tenantDb";
import {
  productionOrderStatus,
  productionOutputDisposition,
} from "../lib/validators";
import {
  refusal,
  writeContextOf,
  writeOutcomeValidator,
  written,
} from "../lib/writeEnvelope";
import { decodeBucketKey } from "../model/inventory/stockIdentity";
import type { LedgerTransactionDraft } from "../model/inventory/ledgerTransaction";
import {
  decideProductionQuality,
  deriveProductionStatus,
  initialProductionQuantities,
  issueMaterialQuantity,
  receiveProductionOutput as receiveOutputQuantity,
  reportProductionOutput,
  type ProductionQuantities,
} from "../model/production/productionExecution";

export const PRODUCTION_OPERATIONS = Object.freeze({
  create: "production.order.create",
  release: "production.order.release",
  issueMaterial: "production.material.issue",
  issueMaterialLedger: "production.material.issue.ledger",
  reportOperation: "production.operation.report",
  receiveOutput: "production.output.receive",
  receiveOutputLedger: "production.output.receive.ledger",
  decideQuality: "production.quality.decide",
  decideQualityLedger: "production.quality.decide.ledger",
});

const MAX_MATERIALS = 40;
const MAX_PRODUCTION_RUNS_PER_PACKET = 20;

interface FactoryPacketRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly customerOrderLineId: string;
  readonly masterCardRevisionId: string;
  readonly revisionNumber: number;
  readonly packetNumber: string;
  readonly quantity: number;
  readonly status: string;
  readonly specification: {
    readonly route?: readonly {
      readonly sequence: number;
      readonly workCenterCode: string;
      readonly operationCode: string;
      readonly instruction?: string;
    }[];
    readonly materials?: readonly {
      readonly itemCode: string;
      readonly description: string;
      readonly quantityPerUnit: number;
      readonly uom: string;
      readonly wastePercent?: number;
    }[];
  };
}

interface ItemRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly sku: string;
  readonly baseUom: string;
  readonly status: string;
}

interface ProductionOrderRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly productionOrderNumber: string;
  readonly factoryPacketId: string;
  readonly customerOrderLineId: string;
  readonly fulfillmentLineId?: string;
  readonly planningSource?: "ROUTED_SHORTAGE" | "LEGACY_PACKET";
  readonly masterCardRevisionId: string;
  readonly revisionNumber: number;
  readonly outputItemId: string;
  readonly outputBaseUom: string;
  readonly targetBaseMinorUnits: number;
  readonly quantities: ProductionQuantities;
  readonly route: readonly {
    readonly sequence: number;
    readonly workCenterCode: string;
    readonly operationCode: string;
    readonly instruction?: string;
  }[];
  readonly status: string;
  readonly dueAt: number;
  readonly createdByUserId: string;
}

interface RoutedFulfillmentLineRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly customerOrderLineId: string;
  readonly warehouseId: string;
  readonly itemId: string;
  readonly routeDecision?: "AVAILABLE_STOCK" | "PRODUCTION";
  readonly productionShortageBaseMinorUnits?: number;
}

interface MaterialRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly productionOrderId: string;
  readonly itemId: string;
  readonly baseUom: string;
  readonly requiredBaseMinorUnits: number;
  readonly issuedBaseMinorUnits: number;
}

async function loadProductionMaterials(
  ctx: { readonly tenantDb: TenantPolicyContext["tenantDb"] },
  productionOrderId: string,
): Promise<readonly MaterialRow[] | null> {
  const page = await ctx.tenantDb
    .byIndex<MaterialRow>(
      "productionMaterialRequirements",
      "by_orgId_productionOrderId_lineNumber",
      [{ field: "productionOrderId", value: productionOrderId }],
    )
    .page({ limit: MAX_MATERIALS });
  return page.isDone ? page.page : null;
}

interface OutputReceiptRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly productionOrderId: string;
  readonly warehouseId: string;
  readonly outputItemId: string;
  readonly outputLotId: string;
  readonly destinationLocationId: string;
  readonly baseUom: string;
  readonly baseMinorUnits: number;
  readonly disposition: "QC_HOLD" | "AVAILABLE" | "REJECTED";
  readonly receivedByUserId: string;
}

const quantitiesValidator = v.object({
  target: v.number(),
  good: v.number(),
  scrap: v.number(),
  rework: v.number(),
  received: v.number(),
  qcReleased: v.number(),
  qcRejected: v.number(),
});

const orderValidator = v.object({
  productionOrderId: v.id("productionOrders"),
  warehouseId: v.id("warehouses"),
  productionOrderNumber: v.string(),
  factoryPacketId: v.id("factoryPackets"),
  customerOrderLineId: v.id("customerOrderLines"),
  fulfillmentLineId: v.optional(v.id("fulfillmentLines")),
  planningSource: v.optional(
    v.union(v.literal("ROUTED_SHORTAGE"), v.literal("LEGACY_PACKET")),
  ),
  masterCardRevisionId: v.id("masterCardRevisions"),
  revisionNumber: v.number(),
  outputItemId: v.id("items"),
  outputBaseUom: v.string(),
  targetBaseMinorUnits: v.number(),
  quantities: quantitiesValidator,
  route: v.array(
    v.object({
      sequence: v.number(),
      workCenterCode: v.string(),
      operationCode: v.string(),
      instruction: v.optional(v.string()),
    }),
  ),
  status: productionOrderStatus,
  dueAt: v.number(),
});

const materialValidator = v.object({
  productionMaterialRequirementId: v.id("productionMaterialRequirements"),
  productionOrderId: v.id("productionOrders"),
  lineNumber: v.number(),
  itemId: v.id("items"),
  materialCode: v.string(),
  description: v.string(),
  baseUom: v.string(),
  requiredBaseMinorUnits: v.number(),
  issuedBaseMinorUnits: v.number(),
  sourceLotId: v.optional(v.id("lots")),
});

const outputReceiptValidator = v.object({
  productionOutputReceiptId: v.id("productionOutputReceipts"),
  productionOrderId: v.id("productionOrders"),
  outputLotId: v.id("lots"),
  destinationLocationId: v.id("locations"),
  baseUom: v.string(),
  baseMinorUnits: v.number(),
  disposition: productionOutputDisposition,
  receivedAt: v.number(),
});

const fingerprint = (
  operation: string,
  args: Readonly<Record<string, unknown>>,
) => ({
  operation,
  ...args,
});

async function productionPolicy(
  ctx: TenantPolicyContext,
  args: { readonly productionOrderId: string },
) {
  const order = await ctx.tenantDb.get<ProductionOrderRow>(
    "productionOrders",
    args.productionOrderId,
  );
  return {
    thresholdExceeded: false,
    approvalSatisfied: order !== null,
    ...(order === null ? {} : { makerUserId: order.createdByUserId }),
  };
}

async function qualityPolicy(
  ctx: TenantPolicyContext,
  args: { readonly productionOutputReceiptId: string },
) {
  const receipt = await ctx.tenantDb.get<OutputReceiptRow>(
    "productionOutputReceipts",
    args.productionOutputReceiptId,
  );
  return {
    thresholdExceeded: false,
    approvalSatisfied: receipt?.disposition === "QC_HOLD",
    ...(receipt === null ? {} : { makerUserId: receipt.receivedByUserId }),
  };
}

export const createProductionOrder = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    factoryPacketId: v.id("factoryPackets"),
    productionOrderNumber: v.string(),
    outputItemId: v.id("items"),
    dueAt: v.number(),
  },
  returns: writeOutcomeValidator,
  permissionCode: "production.order.manage",
  target: {
    table: "factoryPackets",
    id: ({ factoryPacketId }) => factoryPacketId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const number = normalizeField(
      "productionOrderNumber",
      args.productionOrderNumber,
      CODE_FIELD,
    );
    if (!number.ok) return refusal(number.error);
    if (!Number.isSafeInteger(args.dueAt) || args.dueAt <= 0) {
      return refusal({
        code: "FIELD_INVALID",
        field: "dueAt",
        reason: "INVALID",
      });
    }
    const [packet, outputItem] = await Promise.all([
      ctx.tenantDb.get<FactoryPacketRow>(
        "factoryPackets",
        args.factoryPacketId,
      ),
      ctx.tenantDb.get<ItemRow>("items", args.outputItemId),
    ]);
    if (
      packet === null ||
      packet.warehouseId !== args.warehouseId ||
      packet.status !== "ACKNOWLEDGED"
    ) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "factoryPacketId",
        reason: "PACKET_NOT_ACKNOWLEDGED",
      });
    }
    if (outputItem === null || outputItem.status !== "ACTIVE") {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "outputItemId" });
    }
    const routedLine = await ctx.tenantDb
      .byIndex<RoutedFulfillmentLineRow>(
        "fulfillmentLines",
        "by_orgId_customerOrderLineId",
        [{ field: "customerOrderLineId", value: packet.customerOrderLineId }],
      )
      .unique();
    if (
      routedLine !== null &&
      (routedLine.warehouseId !== args.warehouseId ||
        routedLine.itemId !== args.outputItemId)
    ) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "outputItemId",
        reason: "ROUTED_DEMAND_MISMATCH",
      });
    }
    if (routedLine?.routeDecision === "AVAILABLE_STOCK") {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "factoryPacketId",
        reason: "NO_PRODUCTION_SHORTAGE",
      });
    }
    const requestFingerprint = fingerprint(PRODUCTION_OPERATIONS.create, args);
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "productionOrders",
      operation: PRODUCTION_OPERATIONS.create,
      requestId: args.requestId,
      fingerprint: requestFingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    const route = packet.specification.route ?? [];
    if (route.length === 0) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "route",
        reason: "NO_RELEASED_ROUTE",
      });
    }
    let target = packet.quantity * 1_000;
    if (routedLine?.routeDecision === "PRODUCTION") {
      const routedShortage = routedLine.productionShortageBaseMinorUnits;
      if (
        routedShortage === undefined ||
        !Number.isSafeInteger(routedShortage) ||
        routedShortage <= 0
      ) {
        return refusal({ code: "STORED_ROW_INVALID" });
      }
      const existingRuns = await ctx.tenantDb
        .byIndex<ProductionOrderRow>(
          "productionOrders",
          "by_orgId_factoryPacketId",
          [{ field: "factoryPacketId", value: args.factoryPacketId }],
        )
        .take(MAX_PRODUCTION_RUNS_PER_PACKET + 1);
      if (existingRuns.length > MAX_PRODUCTION_RUNS_PER_PACKET) {
        return refusal({
          code: "PRECONDITION_FAILED",
          field: "factoryPacketId",
          reason: "PRODUCTION_RUN_LIMIT",
        });
      }
      if (
        existingRuns.some(
          (run) =>
            !["COMPLETE", "CLOSED_REJECTED", "CANCELLED"].includes(run.status),
        )
      ) {
        return refusal({
          code: "PRECONDITION_FAILED",
          field: "factoryPacketId",
          reason: "ACTIVE_PRODUCTION_RUN_EXISTS",
        });
      }
      const released = existingRuns.reduce(
        (sum, run) => sum + run.quantities.qcReleased,
        0,
      );
      if (!Number.isSafeInteger(released) || released < 0) {
        return refusal({ code: "STORED_ROW_INVALID" });
      }
      target = routedShortage - released;
      if (target <= 0) {
        return refusal({
          code: "PRECONDITION_FAILED",
          field: "factoryPacketId",
          reason: "PRODUCTION_SHORTAGE_SATISFIED",
        });
      }
    }
    const quantities = initialProductionQuantities(target);
    if (!quantities.ok) return refusal(quantities.error);
    const materials = packet.specification.materials ?? [];
    if (materials.length === 0 || materials.length > MAX_MATERIALS) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "materials",
        reason: materials.length === 0 ? "NO_RELEASED_BOM" : "MATERIAL_LIMIT",
      });
    }
    const resolvedMaterials: {
      readonly item: ItemRow;
      readonly material: (typeof materials)[number];
      readonly required: number;
    }[] = [];
    for (const material of materials) {
      const item = await ctx.tenantDb
        .byIndex<ItemRow>("items", "by_orgId_sku", [
          { field: "sku", value: material.itemCode },
        ])
        .unique();
      const required = Math.round(
        material.quantityPerUnit *
          (target / 1_000) *
          (1 + (material.wastePercent ?? 0) / 100) *
          1_000,
      );
      if (
        item === null ||
        item.status !== "ACTIVE" ||
        item.baseUom !== material.uom ||
        !Number.isSafeInteger(required) ||
        required <= 0
      ) {
        return refusal({ code: "REFERENCE_NOT_FOUND", field: "materials" });
      }
      resolvedMaterials.push({ item, material, required });
    }
    const context = writeContextOf(ctx, {
      table: "productionOrders",
      operation: PRODUCTION_OPERATIONS.create,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
    });
    const outcome = await createMasterDataRow({
      ...context,
      fingerprint: requestFingerprint,
      uniqueness: [
        {
          field: "productionOrderNumber",
          index: "by_orgId_productionOrderNumber",
          equality: [{ field: "productionOrderNumber", value: number.value }],
        },
        ...(routedLine?.routeDecision === "PRODUCTION"
          ? []
          : [
              {
                field: "factoryPacketId",
                index: "by_orgId_factoryPacketId",
                equality: [
                  { field: "factoryPacketId", value: args.factoryPacketId },
                ],
              },
            ]),
      ],
      document: {
        warehouseId: args.warehouseId,
        productionOrderNumber: number.value,
        factoryPacketId: args.factoryPacketId,
        customerOrderLineId: packet.customerOrderLineId,
        ...(routedLine === null
          ? { planningSource: "LEGACY_PACKET" as const }
          : {
              fulfillmentLineId: routedLine._id,
              planningSource:
                routedLine.routeDecision === "PRODUCTION"
                  ? ("ROUTED_SHORTAGE" as const)
                  : ("LEGACY_PACKET" as const),
            }),
        masterCardRevisionId: packet.masterCardRevisionId,
        revisionNumber: packet.revisionNumber,
        outputItemId: args.outputItemId,
        outputBaseUom: outputItem.baseUom,
        targetBaseMinorUnits: target,
        quantities: { ...quantities.value },
        route: route.map((step) => ({ ...step })),
        status: "DRAFT",
        dueAt: args.dueAt,
        createdByUserId: context.actorUserId,
        createdAt: context.now,
      },
    });
    if (!outcome.ok) return refusal(outcome.error);
    for (const [index, resolved] of resolvedMaterials.entries()) {
      const description = normalizeDisplayName(
        "description",
        resolved.material.description,
      );
      if (!description.ok) return refusal(description.error);
      const document = {
        productionOrderId: outcome.value.documentId,
        lineNumber: index + 1,
        itemId: resolved.item._id,
        materialCode: resolved.material.itemCode,
        description: description.value,
        baseUom: resolved.item.baseUom,
        requiredBaseMinorUnits: resolved.required,
        issuedBaseMinorUnits: 0,
      };
      const id = await ctx.tenantDb.insert(
        "productionMaterialRequirements",
        document,
      );
      await appendDomainAudit(context, {
        entityTable: "productionMaterialRequirements",
        entityId: id,
        changes: insertedFields(document),
      });
    }
    return written(outcome.value);
  },
});

export const releaseProductionOrder = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    productionOrderId: v.id("productionOrders"),
  },
  returns: writeOutcomeValidator,
  permissionCode: "production.order.release",
  target: {
    table: "productionOrders",
    id: ({ productionOrderId }) => productionOrderId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  policy: productionPolicy,
  handler: async (ctx, args) => {
    const order = await ctx.tenantDb.get<ProductionOrderRow>(
      "productionOrders",
      args.productionOrderId,
    );
    if (order === null || order.warehouseId !== args.warehouseId) {
      return refusal({ code: "NOT_FOUND", table: "productionOrders" });
    }
    if (order.status !== "DRAFT") {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "status",
        reason: "ORDER_NOT_DRAFT",
      });
    }
    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "productionOrders",
        operation: PRODUCTION_OPERATIONS.release,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: order._id,
      fingerprint: fingerprint(PRODUCTION_OPERATIONS.release, args),
      uniqueness: [],
      patch: {
        status: "RELEASED",
        releasedByUserId: ctx.tenant.actor._id,
        releasedAt: Date.now(),
      },
    });
    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

export const issueProductionMaterial = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    productionOrderId: v.id("productionOrders"),
    productionMaterialRequirementId: v.id("productionMaterialRequirements"),
    sourceBucketKey: v.string(),
    baseMinorUnits: v.number(),
  },
  returns: writeOutcomeValidator,
  permissionCode: "production.material.issue",
  target: {
    table: "productionOrders",
    id: ({ productionOrderId }) => productionOrderId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const [order, material] = await Promise.all([
      ctx.tenantDb.get<ProductionOrderRow>(
        "productionOrders",
        args.productionOrderId,
      ),
      ctx.tenantDb.get<MaterialRow>(
        "productionMaterialRequirements",
        args.productionMaterialRequirementId,
      ),
    ]);
    if (
      order === null ||
      order.warehouseId !== args.warehouseId ||
      !["RELEASED", "IN_PROGRESS"].includes(order.status)
    ) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "productionOrderId",
        reason: "ORDER_NOT_RELEASED",
      });
    }
    if (material === null || material.productionOrderId !== order._id) {
      return refusal({
        code: "REFERENCE_NOT_FOUND",
        field: "productionMaterialRequirementId",
      });
    }
    const requestFingerprint = fingerprint(
      PRODUCTION_OPERATIONS.issueMaterial,
      args,
    );
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "productionMaterialRequirements",
      operation: PRODUCTION_OPERATIONS.issueMaterial,
      requestId: args.requestId,
      fingerprint: requestFingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    const nextIssued = issueMaterialQuantity(
      material.requiredBaseMinorUnits,
      material.issuedBaseMinorUnits,
      args.baseMinorUnits,
    );
    if (!nextIssued.ok) return refusal(nextIssued.error);
    const bucket = decodeBucketKey(args.sourceBucketKey);
    if (
      !bucket.ok ||
      bucket.value.location.kind !== "PHYSICAL" ||
      bucket.value.orgId !== ctx.tenant.organization._id ||
      bucket.value.warehouseId !== args.warehouseId ||
      bucket.value.itemId !== material.itemId ||
      bucket.value.stockStatus !== "AVAILABLE"
    ) {
      return refusal({
        code: "FIELD_INVALID",
        field: "sourceBucketKey",
        reason: "BUCKET_MISMATCH",
      });
    }
    const now = Date.now();
    const draft: LedgerTransactionDraft = {
      orgId: ctx.tenant.organization._id,
      warehouseId: args.warehouseId,
      type: "PRODUCTION_ISSUE",
      operation: PRODUCTION_OPERATIONS.issueMaterialLedger,
      requestId: args.requestId,
      actorUserId: ctx.tenant.actor._id,
      occurredAt: now,
      source: { type: "PRODUCTION_ORDER", id: order._id },
      lines: [
        {
          bucket: bucket.value,
          quantity: { uom: material.baseUom, minorUnits: -args.baseMinorUnits },
        },
        {
          bucket: {
            ...bucket.value,
            location: { kind: "VIRTUAL", boundary: "PRODUCTION_ISSUE" },
          },
          quantity: { uom: material.baseUom, minorUnits: args.baseMinorUnits },
        },
      ],
    };
    const posted = await postLedgerTransaction({
      tenantDb: ctx.tenantDb,
      tenant: ctx.tenant,
      permissionCode: ctx.permission.code,
      now,
      draft,
    });
    if (!posted.ok) return refusal(toPublicLedgerError(posted.error));
    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "productionMaterialRequirements",
        operation: PRODUCTION_OPERATIONS.issueMaterial,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: material._id,
      fingerprint: requestFingerprint,
      uniqueness: [],
      patch: {
        issuedBaseMinorUnits: nextIssued.value,
        sourceBucketKey: args.sourceBucketKey,
        ...(bucket.value.lotId === undefined
          ? {}
          : { sourceLotId: bucket.value.lotId }),
        issueTransactionId: posted.value.result.transactionId,
      },
    });
    if (!outcome.ok) return refusal(outcome.error);
    if (!outcome.value.replayed) {
      const issueDocument = {
        productionOrderId: order._id,
        productionMaterialRequirementId: material._id,
        itemId: material.itemId,
        sourceBucketKey: args.sourceBucketKey,
        ...(bucket.value.lotId === undefined
          ? {}
          : { sourceLotId: bucket.value.lotId }),
        baseUom: material.baseUom,
        baseMinorUnits: args.baseMinorUnits,
        issueTransactionId: posted.value.result.transactionId,
        issuedByUserId: ctx.tenant.actor._id,
        issuedAt: now,
      };
      const issueId = await ctx.tenantDb.insert(
        "productionMaterialIssues",
        issueDocument,
      );
      await appendDomainAudit(
        writeContextOf(ctx, {
          table: "productionMaterialIssues",
          operation: PRODUCTION_OPERATIONS.issueMaterial,
          requestId: args.requestId,
          warehouseId: args.warehouseId,
        }),
        {
          entityTable: "productionMaterialIssues",
          entityId: issueId,
          changes: insertedFields(issueDocument),
        },
      );
    }
    if (order.status === "RELEASED")
      await ctx.tenantDb.patch("productionOrders", order._id, {
        status: "IN_PROGRESS",
      });
    return written(outcome.value);
  },
});

export const reportProductionOperation = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    productionOrderId: v.id("productionOrders"),
    operationSequence: v.number(),
    goodBaseMinorUnits: v.number(),
    scrapBaseMinorUnits: v.number(),
    reworkBaseMinorUnits: v.number(),
    downtimeMinutes: v.number(),
    downtimeReason: v.optional(v.string()),
  },
  returns: writeOutcomeValidator,
  permissionCode: "production.operation.report",
  target: {
    table: "productionOrders",
    id: ({ productionOrderId }) => productionOrderId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const order = await ctx.tenantDb.get<ProductionOrderRow>(
      "productionOrders",
      args.productionOrderId,
    );
    if (
      order === null ||
      order.warehouseId !== args.warehouseId ||
      !["RELEASED", "IN_PROGRESS"].includes(order.status)
    ) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "productionOrderId",
        reason: "ORDER_NOT_EXECUTABLE",
      });
    }
    const step = order.route.find(
      (candidate) => candidate.sequence === args.operationSequence,
    );
    if (step === undefined)
      return refusal({
        code: "REFERENCE_NOT_FOUND",
        field: "operationSequence",
      });
    if (
      !Number.isSafeInteger(args.downtimeMinutes) ||
      args.downtimeMinutes < 0 ||
      args.downtimeMinutes > 1_440
    ) {
      return refusal({
        code: "FIELD_INVALID",
        field: "downtimeMinutes",
        reason: "OUT_OF_RANGE",
      });
    }
    if (
      args.downtimeMinutes > 0 &&
      (args.downtimeReason === undefined ||
        args.downtimeReason.trim().length === 0)
    ) {
      return refusal({
        code: "FIELD_INVALID",
        field: "downtimeReason",
        reason: "REQUIRED",
      });
    }
    const isFinal = step.sequence === order.route.at(-1)?.sequence;
    if (isFinal) {
      const materials = await loadProductionMaterials(ctx, order._id);
      if (
        materials === null ||
        materials.length === 0 ||
        materials.some(
          (material) =>
            material.issuedBaseMinorUnits !== material.requiredBaseMinorUnits,
        )
      ) {
        return refusal({
          code: "PRECONDITION_FAILED",
          field: "materials",
          reason: "MATERIALS_NOT_FULLY_ISSUED",
        });
      }
    }
    const next = isFinal
      ? reportProductionOutput(order.quantities, {
          good: args.goodBaseMinorUnits,
          scrap: args.scrapBaseMinorUnits,
          rework: args.reworkBaseMinorUnits,
        })
      : { ok: true as const, value: order.quantities };
    if (!next.ok) return refusal(next.error);
    const requestFingerprint = fingerprint(
      PRODUCTION_OPERATIONS.reportOperation,
      args,
    );
    const context = writeContextOf(ctx, {
      table: "productionOperationReports",
      operation: PRODUCTION_OPERATIONS.reportOperation,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
    });
    const outcome = await createMasterDataRow({
      ...context,
      fingerprint: requestFingerprint,
      uniqueness: [],
      document: {
        productionOrderId: order._id,
        operationSequence: step.sequence,
        workCenterCode: step.workCenterCode,
        operationCode: step.operationCode,
        goodBaseMinorUnits: args.goodBaseMinorUnits,
        scrapBaseMinorUnits: args.scrapBaseMinorUnits,
        reworkBaseMinorUnits: args.reworkBaseMinorUnits,
        downtimeMinutes: args.downtimeMinutes,
        ...(args.downtimeReason === undefined
          ? {}
          : { downtimeReason: args.downtimeReason.trim() }),
        operatorUserId: context.actorUserId,
        reportedAt: context.now,
      },
    });
    if (!outcome.ok) return refusal(outcome.error);
    if (!outcome.value.replayed && isFinal)
      await ctx.tenantDb.patch("productionOrders", order._id, {
        quantities: { ...next.value },
        status: "IN_PROGRESS",
      });
    return written(outcome.value);
  },
});

export const receiveProductionOutput = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    productionOrderId: v.id("productionOrders"),
    outputLotId: v.id("lots"),
    destinationLocationId: v.id("locations"),
    baseMinorUnits: v.number(),
  },
  returns: writeOutcomeValidator,
  permissionCode: "production.output.receive",
  target: {
    table: "productionOrders",
    id: ({ productionOrderId }) => productionOrderId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const order = await ctx.tenantDb.get<ProductionOrderRow>(
      "productionOrders",
      args.productionOrderId,
    );
    if (
      order === null ||
      order.warehouseId !== args.warehouseId ||
      order.status !== "IN_PROGRESS"
    ) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "productionOrderId",
        reason: "ORDER_NOT_IN_PROGRESS",
      });
    }
    const [lot, location] = await Promise.all([
      ctx.tenantDb.get<{
        readonly orgId: TenantOrgId;
        readonly itemId: string;
        readonly status: string;
      }>("lots", args.outputLotId),
      ctx.tenantDb.get<{
        readonly orgId: TenantOrgId;
        readonly warehouseId: string;
        readonly status: string;
      }>("locations", args.destinationLocationId),
    ]);
    if (
      lot === null ||
      lot.itemId !== order.outputItemId ||
      lot.status !== "ACTIVE"
    )
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "outputLotId" });
    if (
      location === null ||
      location.warehouseId !== args.warehouseId ||
      location.status !== "ACTIVE"
    )
      return refusal({
        code: "REFERENCE_NOT_FOUND",
        field: "destinationLocationId",
      });
    const next = receiveOutputQuantity(order.quantities, args.baseMinorUnits);
    if (!next.ok) return refusal(next.error);
    const requestFingerprint = fingerprint(
      PRODUCTION_OPERATIONS.receiveOutput,
      args,
    );
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "productionOutputReceipts",
      operation: PRODUCTION_OPERATIONS.receiveOutput,
      requestId: args.requestId,
      fingerprint: requestFingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    const now = Date.now();
    const baseBucket = {
      orgId: ctx.tenant.organization._id,
      warehouseId: args.warehouseId,
      itemId: order.outputItemId,
      lotId: args.outputLotId,
      stockStatus: "QC_HOLD" as const,
    };
    const draft: LedgerTransactionDraft = {
      orgId: ctx.tenant.organization._id,
      warehouseId: args.warehouseId,
      type: "PRODUCTION_RECEIPT",
      operation: PRODUCTION_OPERATIONS.receiveOutputLedger,
      requestId: args.requestId,
      actorUserId: ctx.tenant.actor._id,
      occurredAt: now,
      source: { type: "PRODUCTION_ORDER", id: order._id },
      lines: [
        {
          bucket: {
            ...baseBucket,
            location: {
              kind: "PHYSICAL",
              locationId: args.destinationLocationId,
            },
          },
          quantity: {
            uom: order.outputBaseUom,
            minorUnits: args.baseMinorUnits,
          },
        },
        {
          bucket: {
            ...baseBucket,
            location: { kind: "VIRTUAL", boundary: "PRODUCTION_RECEIPT" },
          },
          quantity: {
            uom: order.outputBaseUom,
            minorUnits: -args.baseMinorUnits,
          },
        },
      ],
    };
    const posted = await postLedgerTransaction({
      tenantDb: ctx.tenantDb,
      tenant: ctx.tenant,
      permissionCode: ctx.permission.code,
      now,
      draft,
    });
    if (!posted.ok) return refusal(toPublicLedgerError(posted.error));
    const context = writeContextOf(ctx, {
      table: "productionOutputReceipts",
      operation: PRODUCTION_OPERATIONS.receiveOutput,
      requestId: args.requestId,
      warehouseId: args.warehouseId,
    });
    const outcome = await createMasterDataRow({
      ...context,
      fingerprint: requestFingerprint,
      uniqueness: [],
      document: {
        productionOrderId: order._id,
        warehouseId: args.warehouseId,
        outputItemId: order.outputItemId,
        outputLotId: args.outputLotId,
        destinationLocationId: args.destinationLocationId,
        baseUom: order.outputBaseUom,
        baseMinorUnits: args.baseMinorUnits,
        disposition: "QC_HOLD",
        receiptTransactionId: posted.value.result.transactionId,
        receivedByUserId: context.actorUserId,
        receivedAt: context.now,
      },
    });
    if (!outcome.ok) return refusal(outcome.error);
    if (!outcome.value.replayed)
      await ctx.tenantDb.patch("productionOrders", order._id, {
        quantities: { ...next.value },
        status: "QC_PENDING",
      });
    return written(outcome.value);
  },
});

export const decideProductionOutputQuality = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    productionOutputReceiptId: v.id("productionOutputReceipts"),
    decision: v.union(v.literal("RELEASE"), v.literal("REJECT")),
    note: v.string(),
  },
  returns: writeOutcomeValidator,
  permissionCode: "production.quality.decide",
  target: {
    table: "productionOutputReceipts",
    id: ({ productionOutputReceiptId }) => productionOutputReceiptId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  policy: qualityPolicy,
  handler: async (ctx, args) => {
    const receipt = await ctx.tenantDb.get<OutputReceiptRow>(
      "productionOutputReceipts",
      args.productionOutputReceiptId,
    );
    if (
      receipt === null ||
      receipt.warehouseId !== args.warehouseId ||
      receipt.disposition !== "QC_HOLD"
    )
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "productionOutputReceiptId",
        reason: "OUTPUT_NOT_ON_HOLD",
      });
    const order = await ctx.tenantDb.get<ProductionOrderRow>(
      "productionOrders",
      receipt.productionOrderId,
    );
    if (order === null)
      return refusal({
        code: "REFERENCE_NOT_FOUND",
        field: "productionOrderId",
      });
    const note = normalizeDisplayName("note", args.note);
    if (!note.ok) return refusal(note.error);
    const next = decideProductionQuality(
      order.quantities,
      args.decision,
      receipt.baseMinorUnits,
    );
    if (!next.ok) return refusal(next.error);
    const requestFingerprint = fingerprint(
      PRODUCTION_OPERATIONS.decideQuality,
      args,
    );
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "productionOutputReceipts",
      operation: PRODUCTION_OPERATIONS.decideQuality,
      requestId: args.requestId,
      fingerprint: requestFingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    const now = Date.now();
    const toStatus = args.decision === "RELEASE" ? "AVAILABLE" : "REJECTED";
    const at = (stockStatus: "QC_HOLD" | "AVAILABLE" | "REJECTED") => ({
      orgId: ctx.tenant.organization._id,
      warehouseId: args.warehouseId,
      itemId: receipt.outputItemId,
      lotId: receipt.outputLotId,
      stockStatus,
      location: {
        kind: "PHYSICAL" as const,
        locationId: receipt.destinationLocationId,
      },
    });
    const draft: LedgerTransactionDraft = {
      orgId: ctx.tenant.organization._id,
      warehouseId: args.warehouseId,
      type: "STATUS_CHANGE",
      operation: PRODUCTION_OPERATIONS.decideQualityLedger,
      requestId: args.requestId,
      actorUserId: ctx.tenant.actor._id,
      occurredAt: now,
      source: { type: "PRODUCTION_OUTPUT", id: receipt._id },
      lines: [
        {
          bucket: at("QC_HOLD"),
          quantity: {
            uom: receipt.baseUom,
            minorUnits: -receipt.baseMinorUnits,
          },
        },
        {
          bucket: at(toStatus),
          quantity: {
            uom: receipt.baseUom,
            minorUnits: receipt.baseMinorUnits,
          },
        },
      ],
    };
    const posted = await postLedgerTransaction({
      tenantDb: ctx.tenantDb,
      tenant: ctx.tenant,
      permissionCode: ctx.permission.code,
      now,
      draft,
    });
    if (!posted.ok) return refusal(toPublicLedgerError(posted.error));
    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "productionOutputReceipts",
        operation: PRODUCTION_OPERATIONS.decideQuality,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: receipt._id,
      fingerprint: requestFingerprint,
      uniqueness: [],
      patch: {
        disposition: toStatus,
        qualityTransactionId: posted.value.result.transactionId,
        qualityDecidedByUserId: ctx.tenant.actor._id,
        qualityDecidedAt: now,
        qualityNote: note.value,
      },
    });
    if (!outcome.ok) return refusal(outcome.error);
    const derived = deriveProductionStatus(next.value);
    await ctx.tenantDb.patch("productionOrders", order._id, {
      quantities: { ...next.value },
      status: derived.ok ? derived.value : "QC_PENDING",
      ...(derived.ok && ["COMPLETE", "CLOSED_REJECTED"].includes(derived.value)
        ? { completedAt: now }
        : {}),
    });
    return written(outcome.value);
  },
});

export const listProductionOrders = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    status: v.optional(productionOrderStatus),
    ...listArgs,
  },
  returns: pageOf(orderValidator),
  permissionCode: "production.order.read",
  target: { table: "productionOrders" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
    if (!request.ok) return pageRefusal(request.error.code);
    const page = await ctx.tenantDb
      .byIndex<ProductionOrderRow>(
        "productionOrders",
        args.status === undefined
          ? "by_orgId_warehouseId_dueAt"
          : "by_orgId_warehouseId_status_dueAt",
        [
          { field: "warehouseId", value: args.warehouseId },
          ...(args.status === undefined
            ? []
            : [{ field: "status", value: args.status }]),
        ],
      )
      .page(pageOptions(request.value));
    return {
      ok: true as const,
      items: page.page.map((order) => ({
        productionOrderId: order._id as never,
        warehouseId: order.warehouseId as never,
        productionOrderNumber: order.productionOrderNumber,
        factoryPacketId: order.factoryPacketId as never,
        customerOrderLineId: order.customerOrderLineId as never,
        ...(order.fulfillmentLineId === undefined
          ? {}
          : { fulfillmentLineId: order.fulfillmentLineId as never }),
        ...(order.planningSource === undefined
          ? {}
          : { planningSource: order.planningSource }),
        masterCardRevisionId: order.masterCardRevisionId as never,
        revisionNumber: order.revisionNumber,
        outputItemId: order.outputItemId as never,
        outputBaseUom: order.outputBaseUom,
        targetBaseMinorUnits: order.targetBaseMinorUnits,
        quantities: { ...order.quantities },
        route: order.route.map((step) => ({ ...step })),
        status: order.status as never,
        dueAt: order.dueAt,
      })),
      nextCursor: page.isDone ? null : page.continueCursor,
      complete: page.isDone,
    };
  },
});

export const listProductionMaterials = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    productionOrderId: v.id("productionOrders"),
    ...listArgs,
  },
  returns: pageOf(materialValidator),
  permissionCode: "production.order.read",
  target: {
    table: "productionOrders",
    id: ({ productionOrderId }) => productionOrderId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
    if (!request.ok) return pageRefusal(request.error.code);
    const order = await ctx.tenantDb.get<ProductionOrderRow>(
      "productionOrders",
      args.productionOrderId,
    );
    if (order === null || order.warehouseId !== args.warehouseId)
      return pageRefusal("NOT_FOUND");
    const page = await ctx.tenantDb
      .byIndex<
        MaterialRow & {
          readonly lineNumber: number;
          readonly materialCode: string;
          readonly description: string;
          readonly sourceLotId?: string;
        }
      >(
        "productionMaterialRequirements",
        "by_orgId_productionOrderId_lineNumber",
        [{ field: "productionOrderId", value: args.productionOrderId }],
      )
      .page(pageOptions(request.value));
    return {
      ok: true as const,
      items: page.page.map((row) => ({
        productionMaterialRequirementId: row._id as never,
        productionOrderId: row.productionOrderId as never,
        lineNumber: row.lineNumber,
        itemId: row.itemId as never,
        materialCode: row.materialCode,
        description: row.description,
        baseUom: row.baseUom,
        requiredBaseMinorUnits: row.requiredBaseMinorUnits,
        issuedBaseMinorUnits: row.issuedBaseMinorUnits,
        ...(row.sourceLotId === undefined
          ? {}
          : { sourceLotId: row.sourceLotId as never }),
      })),
      nextCursor: page.isDone ? null : page.continueCursor,
      complete: page.isDone,
    };
  },
});

export const listProductionOutputReceipts = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    productionOrderId: v.id("productionOrders"),
    ...listArgs,
  },
  returns: pageOf(outputReceiptValidator),
  permissionCode: "production.order.read",
  target: {
    table: "productionOrders",
    id: ({ productionOrderId }) => productionOrderId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
    if (!request.ok) return pageRefusal(request.error.code);
    const order = await ctx.tenantDb.get<ProductionOrderRow>(
      "productionOrders",
      args.productionOrderId,
    );
    if (order === null || order.warehouseId !== args.warehouseId)
      return pageRefusal("NOT_FOUND");
    const page = await ctx.tenantDb
      .byIndex<OutputReceiptRow & { readonly receivedAt: number }>(
        "productionOutputReceipts",
        "by_orgId_productionOrderId_receivedAt",
        [{ field: "productionOrderId", value: args.productionOrderId }],
      )
      .page(pageOptions(request.value));
    return {
      ok: true as const,
      items: page.page.map((row) => ({
        productionOutputReceiptId: row._id as never,
        productionOrderId: row.productionOrderId as never,
        outputLotId: row.outputLotId as never,
        destinationLocationId: row.destinationLocationId as never,
        baseUom: row.baseUom,
        baseMinorUnits: row.baseMinorUnits,
        disposition: row.disposition,
        receivedAt: row.receivedAt,
      })),
      nextCursor: page.isDone ? null : page.continueCursor,
      complete: page.isDone,
    };
  },
});
