/** Two-leg warehouse transfers with explicit in-transit and discrepancy ownership. */
import { v } from "convex/values";

import {
  CODE_FIELD,
  createMasterDataRow,
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
import { transferSourceKind, transferStatus } from "../lib/validators";
import {
  refusal,
  writeContextOf,
  writeOutcomeValidator,
  written,
} from "../lib/writeEnvelope";
import { decodeBucketKey } from "../model/inventory/stockIdentity";
import type { LedgerTransactionDraft } from "../model/inventory/ledgerTransaction";
import {
  deriveTransferStatus,
  dispatchTransferQuantity,
  initialTransferQuantities,
  receiveTransferQuantity,
  resolveTransferDiscrepancyQuantity,
  type TransferQuantities,
} from "../model/transfer/transferPolicy";

export const TRANSFER_OPERATIONS = Object.freeze({
  create: "transfer.request.create",
  addLine: "transfer.request.line.add",
  approve: "transfer.request.approve",
  dispatch: "transfer.dispatch.line",
  dispatchLedger: "transfer.dispatch.ledger",
  receive: "transfer.receive.line",
  receiveLedger: "transfer.receive.ledger",
  resolveDiscrepancy: "transfer.discrepancy.resolve",
  resolveDiscrepancyLedger: "transfer.discrepancy.resolve.ledger",
});

const MAX_TRANSFER_LINES = 50;

interface WarehouseRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly code: string;
  readonly name: string;
  readonly status: string;
}

interface ItemRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly baseUom: string;
  readonly status: string;
}

interface LocationRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly locationType: string;
  readonly status: string;
}

interface TransferRequestRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly transferNumber: string;
  readonly sourceWarehouseId: string;
  readonly destinationWarehouseId: string;
  readonly sourceKind: string;
  readonly sourceReference?: string;
  readonly purpose: string;
  readonly status: string;
  readonly lineCount: number;
  readonly createdByUserId: string;
}

interface TransferLineRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly transferRequestId: string;
  readonly lineNumber: number;
  readonly itemId: string;
  readonly baseUom: string;
  readonly quantities: TransferQuantities;
  readonly sourceBucketKey?: string;
  readonly sourceLocationId?: string;
  readonly lotId?: string;
  readonly destinationLocationId?: string;
}

interface TransferDiscrepancyRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly transferRequestId: string;
  readonly transferLineId: string;
  readonly baseMinorUnits: number;
  readonly status: string;
}

const quantitiesValidator = v.object({
  REQUESTED: v.number(),
  DISPATCHED: v.number(),
  RECEIVED: v.number(),
  RETURNED: v.number(),
  DISCREPANCY: v.number(),
  CANCELLED: v.number(),
});

const transferSummaryValidator = v.object({
  transferRequestId: v.id("transferRequests"),
  transferNumber: v.string(),
  sourceWarehouseId: v.id("warehouses"),
  destinationWarehouseId: v.id("warehouses"),
  sourceKind: transferSourceKind,
  sourceReference: v.optional(v.string()),
  purpose: v.string(),
  status: transferStatus,
  lineCount: v.number(),
});

const transferLineValidator = v.object({
  transferLineId: v.id("transferLines"),
  transferRequestId: v.id("transferRequests"),
  lineNumber: v.number(),
  itemId: v.id("items"),
  baseUom: v.string(),
  quantities: quantitiesValidator,
  sourceBucketKey: v.optional(v.string()),
  sourceLocationId: v.optional(v.id("locations")),
  lotId: v.optional(v.id("lots")),
  destinationLocationId: v.optional(v.id("locations")),
});

const transferWarehouseValidator = v.object({
  warehouseId: v.id("warehouses"),
  code: v.string(),
  name: v.string(),
});

const transferDiscrepancyValidator = v.object({
  transferDiscrepancyId: v.id("transferDiscrepancies"),
  transferRequestId: v.id("transferRequests"),
  transferLineId: v.id("transferLines"),
  kind: v.union(
    v.literal("MISSING"),
    v.literal("DAMAGED"),
    v.literal("WRONG_TAG"),
  ),
  baseUom: v.string(),
  baseMinorUnits: v.number(),
  note: v.string(),
});

const requestFingerprint = (
  operation: string,
  args: Readonly<Record<string, unknown>>,
) => ({ operation, ...args });

async function loadTransferLines(
  ctx: { readonly tenantDb: TenantPolicyContext["tenantDb"] },
  transferRequestId: string,
): Promise<readonly TransferLineRow[] | null> {
  const page = await ctx.tenantDb
    .byIndex<TransferLineRow>(
      "transferLines",
      "by_orgId_transferRequestId_lineNumber",
      [{ field: "transferRequestId", value: transferRequestId }],
    )
    .page({ limit: MAX_TRANSFER_LINES });
  return page.isDone ? page.page : null;
}

async function updateDerivedStatus(
  ctx: { readonly tenantDb: TenantPolicyContext["tenantDb"] },
  request: TransferRequestRow,
) {
  const lines = await loadTransferLines(ctx, request._id);
  if (lines === null || lines.length === 0) return false;
  const status = deriveTransferStatus(lines.map((line) => line.quantities));
  if (!status.ok) return false;
  await ctx.tenantDb.patch("transferRequests", request._id, {
    status: status.value,
    ...(status.value === "COMPLETE" ? { completedAt: Date.now() } : {}),
  });
  return true;
}

export const createTransferRequest = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    destinationWarehouseId: v.id("warehouses"),
    transferNumber: v.string(),
    sourceKind: transferSourceKind,
    sourceReference: v.optional(v.string()),
    purpose: v.string(),
  },
  returns: writeOutcomeValidator,
  permissionCode: "transfer.request.manage",
  target: { table: "warehouses", id: ({ warehouseId }) => warehouseId },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    if (args.warehouseId === args.destinationWarehouseId) {
      return refusal({
        code: "FIELD_INVALID",
        field: "destinationWarehouseId",
        reason: "SAME_AS_SOURCE",
      });
    }
    const number = normalizeField(
      "transferNumber",
      args.transferNumber,
      CODE_FIELD,
    );
    if (!number.ok) return refusal(number.error);
    const purpose = normalizeDisplayName("purpose", args.purpose);
    if (!purpose.ok) return refusal(purpose.error);
    const sourceReference =
      args.sourceReference === undefined
        ? undefined
        : args.sourceReference.trim();
    if (
      sourceReference !== undefined &&
      (sourceReference.length === 0 || sourceReference.length > 160)
    ) {
      return refusal({
        code: "FIELD_INVALID",
        field: "sourceReference",
        reason: sourceReference.length === 0 ? "EMPTY" : "TOO_LONG",
      });
    }
    const [source, destination] = await Promise.all([
      ctx.tenantDb.get<WarehouseRow>("warehouses", args.warehouseId),
      ctx.tenantDb.get<WarehouseRow>("warehouses", args.destinationWarehouseId),
    ]);
    if (source === null || source.status !== "ACTIVE") {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "warehouseId" });
    }
    if (destination === null || destination.status !== "ACTIVE") {
      return refusal({
        code: "REFERENCE_NOT_FOUND",
        field: "destinationWarehouseId",
      });
    }
    const now = Date.now();
    const fingerprint = requestFingerprint(TRANSFER_OPERATIONS.create, {
      requestId: args.requestId,
      warehouseId: args.warehouseId,
      destinationWarehouseId: args.destinationWarehouseId,
      transferNumber: number.value,
      sourceKind: args.sourceKind,
      sourceReference,
      purpose: purpose.value,
    });
    const outcome = await createMasterDataRow({
      ...writeContextOf(ctx, {
        table: "transferRequests",
        operation: TRANSFER_OPERATIONS.create,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      fingerprint,
      uniqueness: [
        {
          field: "transferNumber",
          index: "by_orgId_transferNumber",
          equality: [{ field: "transferNumber", value: number.value }],
        },
      ],
      document: {
        transferNumber: number.value,
        sourceWarehouseId: args.warehouseId,
        destinationWarehouseId: args.destinationWarehouseId,
        sourceKind: args.sourceKind,
        ...(sourceReference === undefined ? {} : { sourceReference }),
        purpose: purpose.value,
        status: "DRAFT",
        lineCount: 0,
        createdByUserId: ctx.tenant.actor._id,
        createdAt: now,
      },
    });
    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

export const addTransferLine = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    transferRequestId: v.id("transferRequests"),
    itemId: v.id("items"),
    requestedBaseMinorUnits: v.number(),
  },
  returns: writeOutcomeValidator,
  permissionCode: "transfer.request.manage",
  target: {
    table: "transferRequests",
    id: ({ transferRequestId }) => transferRequestId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const request = await ctx.tenantDb.get<TransferRequestRow>(
      "transferRequests",
      args.transferRequestId,
    );
    if (request === null || request.sourceWarehouseId !== args.warehouseId) {
      return refusal({ code: "NOT_FOUND", table: "transferRequests" });
    }
    if (request.status !== "DRAFT") {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "status",
        reason: "TRANSFER_NOT_DRAFT",
      });
    }
    if (request.lineCount >= MAX_TRANSFER_LINES) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "lines",
        reason: "LINE_LIMIT",
      });
    }
    const item = await ctx.tenantDb.get<ItemRow>("items", args.itemId);
    if (item === null || item.status !== "ACTIVE") {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "itemId" });
    }
    const quantities = initialTransferQuantities(args.requestedBaseMinorUnits);
    if (!quantities.ok) return refusal(quantities.error);
    const lineNumber = request.lineCount + 1;
    const fingerprint = requestFingerprint(TRANSFER_OPERATIONS.addLine, {
      requestId: args.requestId,
      warehouseId: args.warehouseId,
      transferRequestId: args.transferRequestId,
      itemId: args.itemId,
      requestedBaseMinorUnits: args.requestedBaseMinorUnits,
    });
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "transferLines",
      operation: TRANSFER_OPERATIONS.addLine,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    const outcome = await createMasterDataRow({
      ...writeContextOf(ctx, {
        table: "transferLines",
        operation: TRANSFER_OPERATIONS.addLine,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      fingerprint,
      uniqueness: [
        {
          field: "lineNumber",
          index: "by_orgId_transferRequestId_lineNumber",
          equality: [
            { field: "transferRequestId", value: args.transferRequestId },
            { field: "lineNumber", value: lineNumber },
          ],
        },
      ],
      document: {
        transferRequestId: args.transferRequestId,
        lineNumber,
        itemId: args.itemId,
        baseUom: item.baseUom,
        quantities: { ...quantities.value },
      },
    });
    if (!outcome.ok) return refusal(outcome.error);
    await ctx.tenantDb.patch("transferRequests", request._id, {
      lineCount: lineNumber,
    });
    return written(outcome.value);
  },
});

async function approvalPolicy(
  ctx: TenantPolicyContext,
  args: { readonly transferRequestId: string },
) {
  const request = await ctx.tenantDb.get<TransferRequestRow>(
    "transferRequests",
    args.transferRequestId,
  );
  return {
    thresholdExceeded: false,
    approvalSatisfied: request?.status === "DRAFT",
    ...(request === null ? {} : { makerUserId: request.createdByUserId }),
  };
}

export const approveTransferRequest = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    transferRequestId: v.id("transferRequests"),
  },
  returns: writeOutcomeValidator,
  permissionCode: "transfer.request.approve",
  target: {
    table: "transferRequests",
    id: ({ transferRequestId }) => transferRequestId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  policy: approvalPolicy,
  handler: async (ctx, args) => {
    const request = await ctx.tenantDb.get<TransferRequestRow>(
      "transferRequests",
      args.transferRequestId,
    );
    if (request === null || request.sourceWarehouseId !== args.warehouseId) {
      return refusal({ code: "NOT_FOUND", table: "transferRequests" });
    }
    const lines = await loadTransferLines(ctx, request._id);
    if (lines === null || lines.length === 0) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "lines",
        reason: "NO_TRANSFER_LINES",
      });
    }
    const fingerprint = requestFingerprint(TRANSFER_OPERATIONS.approve, {
      requestId: args.requestId,
      warehouseId: args.warehouseId,
      transferRequestId: args.transferRequestId,
    });
    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "transferRequests",
        operation: TRANSFER_OPERATIONS.approve,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: request._id,
      fingerprint,
      uniqueness: [],
      patch: {
        status: "APPROVED",
        approvedByUserId: ctx.tenant.actor._id,
        approvedAt: Date.now(),
      },
    });
    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

export const dispatchTransferLine = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    transferRequestId: v.id("transferRequests"),
    transferLineId: v.id("transferLines"),
    sourceBucketKey: v.string(),
    baseMinorUnits: v.number(),
    sealNumber: v.optional(v.string()),
    carrierName: v.optional(v.string()),
    expectedArrivalAt: v.optional(v.number()),
  },
  returns: writeOutcomeValidator,
  permissionCode: "transfer.dispatch",
  target: {
    table: "transferRequests",
    id: ({ transferRequestId }) => transferRequestId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const [request, line] = await Promise.all([
      ctx.tenantDb.get<TransferRequestRow>(
        "transferRequests",
        args.transferRequestId,
      ),
      ctx.tenantDb.get<TransferLineRow>("transferLines", args.transferLineId),
    ]);
    if (
      request === null ||
      line === null ||
      request.sourceWarehouseId !== args.warehouseId ||
      line.transferRequestId !== request._id
    ) {
      return refusal({ code: "NOT_FOUND", table: "transferRequests" });
    }
    const fingerprint = requestFingerprint(TRANSFER_OPERATIONS.dispatch, {
      ...args,
    });
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "transferLines",
      operation: TRANSFER_OPERATIONS.dispatch,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    if (request.status !== "APPROVED" && request.status !== "DISPATCHING") {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "status",
        reason: "TRANSFER_NOT_APPROVED",
      });
    }
    const decoded = decodeBucketKey(args.sourceBucketKey);
    if (!decoded.ok) {
      return refusal({
        code: "FIELD_INVALID",
        field: "sourceBucketKey",
        reason: "BUCKET_MISMATCH",
      });
    }
    const physical = decoded.value;
    if (
      physical.location.kind !== "PHYSICAL" ||
      physical.warehouseId !== args.warehouseId ||
      physical.itemId !== line.itemId ||
      physical.stockStatus !== "AVAILABLE"
    ) {
      return refusal({
        code: "FIELD_INVALID",
        field: "sourceBucketKey",
        reason: "BUCKET_MISMATCH",
      });
    }
    const moved = dispatchTransferQuantity(
      line.quantities,
      args.baseMinorUnits,
    );
    if (!moved.ok) return refusal(moved.error);
    const now = Date.now();
    if (physical.location.kind !== "PHYSICAL") {
      return refusal({ code: "STORED_ROW_INVALID", field: "sourceBucketKey" });
    }
    const sourceLocationId = physical.location.locationId;
    const draft: LedgerTransactionDraft = {
      orgId: ctx.tenant.organization._id,
      warehouseId: args.warehouseId,
      type: "MOVE",
      operation: TRANSFER_OPERATIONS.dispatchLedger,
      requestId: args.requestId,
      actorUserId: ctx.tenant.actor._id,
      occurredAt: now,
      source: { type: "TRANSFER_REQUEST", id: request._id },
      lines: [
        {
          bucket: physical,
          quantity: { uom: line.baseUom, minorUnits: -args.baseMinorUnits },
        },
        {
          bucket: {
            ...physical,
            location: { kind: "VIRTUAL", boundary: "TRANSFER_IN_TRANSIT" },
          },
          quantity: { uom: line.baseUom, minorUnits: args.baseMinorUnits },
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
        table: "transferLines",
        operation: TRANSFER_OPERATIONS.dispatch,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: line._id,
      fingerprint,
      uniqueness: [],
      patch: {
        quantities: { ...moved.value },
        sourceBucketKey: args.sourceBucketKey,
        sourceLocationId,
        ...(physical.lotId === undefined ? {} : { lotId: physical.lotId }),
        dispatchTransactionId: posted.value.result.transactionId,
      },
    });
    if (!outcome.ok) return refusal(outcome.error);
    await ctx.tenantDb.patch("transferRequests", request._id, {
      dispatchedAt: now,
      ...(args.sealNumber === undefined
        ? {}
        : { sealNumber: args.sealNumber.trim() }),
      ...(args.carrierName === undefined
        ? {}
        : { carrierName: args.carrierName.trim() }),
      ...(args.expectedArrivalAt === undefined
        ? {}
        : { expectedArrivalAt: args.expectedArrivalAt }),
    });
    if (!(await updateDerivedStatus(ctx, request))) {
      return refusal({ code: "STORED_ROW_INVALID", field: "lines" });
    }
    return written(outcome.value);
  },
});

export const receiveTransferLine = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    transferRequestId: v.id("transferRequests"),
    transferLineId: v.id("transferLines"),
    destinationLocationId: v.id("locations"),
    receivedBaseMinorUnits: v.number(),
    discrepancyBaseMinorUnits: v.number(),
    discrepancyKind: v.optional(
      v.union(
        v.literal("MISSING"),
        v.literal("DAMAGED"),
        v.literal("WRONG_TAG"),
      ),
    ),
    discrepancyNote: v.optional(v.string()),
    stockStatus: v.union(
      v.literal("AVAILABLE"),
      v.literal("QC_HOLD"),
      v.literal("QUARANTINE"),
    ),
  },
  returns: writeOutcomeValidator,
  permissionCode: "transfer.receive",
  target: {
    table: "transferRequests",
    id: ({ transferRequestId }) => transferRequestId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const [request, line, destination] = await Promise.all([
      ctx.tenantDb.get<TransferRequestRow>(
        "transferRequests",
        args.transferRequestId,
      ),
      ctx.tenantDb.get<TransferLineRow>("transferLines", args.transferLineId),
      ctx.tenantDb.get<LocationRow>("locations", args.destinationLocationId),
    ]);
    if (
      request === null ||
      line === null ||
      request.destinationWarehouseId !== args.warehouseId ||
      line.transferRequestId !== request._id
    ) {
      return refusal({ code: "NOT_FOUND", table: "transferRequests" });
    }
    if (
      destination === null ||
      destination.warehouseId !== args.warehouseId ||
      destination.status !== "ACTIVE"
    ) {
      return refusal({
        code: "REFERENCE_NOT_FOUND",
        field: "destinationLocationId",
      });
    }
    if (
      args.discrepancyBaseMinorUnits > 0 &&
      (args.discrepancyKind === undefined || !args.discrepancyNote?.trim())
    ) {
      return refusal({
        code: "FIELD_INVALID",
        field: "discrepancy",
        reason: "OWNER_AND_REASON_REQUIRED",
      });
    }
    const fingerprint = requestFingerprint(TRANSFER_OPERATIONS.receive, {
      ...args,
    });
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "transferLines",
      operation: TRANSFER_OPERATIONS.receive,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    if (!line.sourceBucketKey) {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "status",
        reason: "LINE_NOT_DISPATCHED",
      });
    }
    const moved = receiveTransferQuantity(line.quantities, {
      received: args.receivedBaseMinorUnits,
      discrepancy: args.discrepancyBaseMinorUnits,
    });
    if (!moved.ok) return refusal(moved.error);
    const decoded = decodeBucketKey(line.sourceBucketKey);
    if (!decoded.ok || decoded.value.location.kind !== "PHYSICAL") {
      return refusal({ code: "STORED_ROW_INVALID", field: "sourceBucketKey" });
    }
    const now = Date.now();
    let receiptTransactionId: string | undefined;
    if (args.receivedBaseMinorUnits > 0) {
      const identity = decoded.value;
      const destinationIdentity = {
        ...identity,
        warehouseId: args.warehouseId,
      };
      const draft: LedgerTransactionDraft = {
        orgId: ctx.tenant.organization._id,
        warehouseId: args.warehouseId,
        type: "MOVE",
        operation: TRANSFER_OPERATIONS.receiveLedger,
        requestId: args.requestId,
        actorUserId: ctx.tenant.actor._id,
        occurredAt: now,
        source: { type: "TRANSFER_REQUEST", id: request._id },
        lines: [
          {
            bucket: {
              ...destinationIdentity,
              location: { kind: "VIRTUAL", boundary: "TRANSFER_IN_TRANSIT" },
            },
            quantity: {
              uom: line.baseUom,
              minorUnits: -args.receivedBaseMinorUnits,
            },
          },
          {
            bucket: {
              ...destinationIdentity,
              location: {
                kind: "PHYSICAL",
                locationId: args.destinationLocationId,
              },
              stockStatus: args.stockStatus,
            },
            quantity: {
              uom: line.baseUom,
              minorUnits: args.receivedBaseMinorUnits,
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
      receiptTransactionId = posted.value.result.transactionId;
    }
    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "transferLines",
        operation: TRANSFER_OPERATIONS.receive,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: line._id,
      fingerprint,
      uniqueness: [],
      patch: {
        quantities: { ...moved.value },
        destinationLocationId: args.destinationLocationId,
        ...(receiptTransactionId === undefined ? {} : { receiptTransactionId }),
      },
    });
    if (!outcome.ok) return refusal(outcome.error);
    if (args.discrepancyBaseMinorUnits > 0) {
      await ctx.tenantDb.insert("transferDiscrepancies", {
        transferRequestId: request._id,
        transferLineId: line._id,
        kind: args.discrepancyKind!,
        baseUom: line.baseUom,
        baseMinorUnits: args.discrepancyBaseMinorUnits,
        status: "OPEN",
        note: args.discrepancyNote!.trim(),
        ownerUserId: ctx.tenant.actor._id,
        createdAt: now,
      });
      await ctx.tenantDb.patch("transferRequests", request._id, {
        discrepancyOwnerUserId: ctx.tenant.actor._id,
      });
    }
    if (!(await updateDerivedStatus(ctx, request))) {
      return refusal({ code: "STORED_ROW_INVALID", field: "lines" });
    }
    return written(outcome.value);
  },
});

export const resolveTransferDiscrepancy = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    transferDiscrepancyId: v.id("transferDiscrepancies"),
    resolution: v.union(
      v.literal("RECEIVED_AT_DESTINATION"),
      v.literal("RETURNED_TO_SOURCE"),
    ),
    destinationLocationId: v.optional(v.id("locations")),
    stockStatus: v.union(
      v.literal("AVAILABLE"),
      v.literal("QC_HOLD"),
      v.literal("QUARANTINE"),
    ),
    resolutionNote: v.string(),
  },
  returns: writeOutcomeValidator,
  permissionCode: "transfer.discrepancy.manage",
  target: {
    table: "transferDiscrepancies",
    id: ({ transferDiscrepancyId }) => transferDiscrepancyId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const discrepancy = await ctx.tenantDb.get<TransferDiscrepancyRow>(
      "transferDiscrepancies",
      args.transferDiscrepancyId,
    );
    if (discrepancy === null) {
      return refusal({ code: "NOT_FOUND", table: "transferDiscrepancies" });
    }
    const [request, line] = await Promise.all([
      ctx.tenantDb.get<TransferRequestRow>(
        "transferRequests",
        discrepancy.transferRequestId,
      ),
      ctx.tenantDb.get<TransferLineRow>(
        "transferLines",
        discrepancy.transferLineId,
      ),
    ]);
    if (
      request === null ||
      line === null ||
      line.transferRequestId !== request._id
    ) {
      return refusal({ code: "STORED_ROW_INVALID", field: "transfer" });
    }
    const receivingAtDestination =
      args.resolution === "RECEIVED_AT_DESTINATION";
    const expectedWarehouseId = receivingAtDestination
      ? request.destinationWarehouseId
      : request.sourceWarehouseId;
    if (args.warehouseId !== expectedWarehouseId) {
      return refusal({ code: "NOT_FOUND", table: "transferDiscrepancies" });
    }
    const fingerprint = requestFingerprint(
      TRANSFER_OPERATIONS.resolveDiscrepancy,
      { ...args },
    );
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "transferDiscrepancies",
      operation: TRANSFER_OPERATIONS.resolveDiscrepancy,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    if (discrepancy.status !== "OPEN") {
      return refusal({
        code: "PRECONDITION_FAILED",
        field: "status",
        reason: "DISCREPANCY_NOT_OPEN",
      });
    }
    const note = args.resolutionNote.trim();
    if (note.length === 0 || note.length > 500) {
      return refusal({
        code: "FIELD_INVALID",
        field: "resolutionNote",
        reason: note.length === 0 ? "EMPTY" : "TOO_LONG",
      });
    }
    const decoded = line.sourceBucketKey
      ? decodeBucketKey(line.sourceBucketKey)
      : null;
    if (
      decoded === null ||
      !decoded.ok ||
      decoded.value.location.kind !== "PHYSICAL"
    ) {
      return refusal({ code: "STORED_ROW_INVALID", field: "sourceBucketKey" });
    }
    const source = decoded.value;
    if (source.location.kind !== "PHYSICAL") {
      return refusal({ code: "STORED_ROW_INVALID", field: "sourceBucketKey" });
    }
    let physicalLocationId = source.location.locationId;
    if (receivingAtDestination) {
      if (args.destinationLocationId === undefined) {
        return refusal({
          code: "FIELD_INVALID",
          field: "destinationLocationId",
          reason: "REQUIRED",
        });
      }
      const destination = await ctx.tenantDb.get<LocationRow>(
        "locations",
        args.destinationLocationId,
      );
      if (
        destination === null ||
        destination.warehouseId !== request.destinationWarehouseId ||
        destination.status !== "ACTIVE"
      ) {
        return refusal({
          code: "REFERENCE_NOT_FOUND",
          field: "destinationLocationId",
        });
      }
      physicalLocationId = args.destinationLocationId;
    }
    const quantities = resolveTransferDiscrepancyQuantity(line.quantities, {
      amount: discrepancy.baseMinorUnits,
      resolution: receivingAtDestination ? "RECEIVED" : "RETURNED",
    });
    if (!quantities.ok) return refusal(quantities.error);
    const now = Date.now();
    const warehouseIdentity = {
      ...source,
      warehouseId: expectedWarehouseId,
    };
    const draft: LedgerTransactionDraft = {
      orgId: ctx.tenant.organization._id,
      warehouseId: expectedWarehouseId,
      type: "MOVE",
      operation: TRANSFER_OPERATIONS.resolveDiscrepancyLedger,
      requestId: args.requestId,
      actorUserId: ctx.tenant.actor._id,
      occurredAt: now,
      source: { type: "TRANSFER_DISCREPANCY", id: discrepancy._id },
      lines: [
        {
          bucket: {
            ...warehouseIdentity,
            location: { kind: "VIRTUAL", boundary: "TRANSFER_IN_TRANSIT" },
          },
          quantity: {
            uom: line.baseUom,
            minorUnits: -discrepancy.baseMinorUnits,
          },
        },
        {
          bucket: {
            ...warehouseIdentity,
            location: {
              kind: "PHYSICAL",
              locationId: physicalLocationId,
            },
            stockStatus: receivingAtDestination
              ? args.stockStatus
              : source.stockStatus,
          },
          quantity: {
            uom: line.baseUom,
            minorUnits: discrepancy.baseMinorUnits,
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
    await ctx.tenantDb.patch("transferLines", line._id, {
      quantities: { ...quantities.value },
      ...(receivingAtDestination
        ? { destinationLocationId: physicalLocationId }
        : { returnTransactionId: posted.value.result.transactionId }),
    });
    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "transferDiscrepancies",
        operation: TRANSFER_OPERATIONS.resolveDiscrepancy,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: discrepancy._id,
      fingerprint,
      uniqueness: [],
      patch: {
        status: receivingAtDestination
          ? "RESOLVED_RECEIVED"
          : "RESOLVED_RETURNED",
        resolutionNote: note,
        resolvedAt: now,
        resolvedByUserId: ctx.tenant.actor._id,
        resolutionTransactionId: posted.value.result.transactionId,
      },
    });
    if (!outcome.ok) return refusal(outcome.error);
    if (!(await updateDerivedStatus(ctx, request))) {
      return refusal({ code: "STORED_ROW_INVALID", field: "lines" });
    }
    return written(outcome.value);
  },
});

export const listSourceTransfers = queryWithOrg({
  args: { warehouseId: v.id("warehouses"), ...listArgs },
  returns: pageOf(transferSummaryValidator),
  permissionCode: "transfer.request.read",
  target: { table: "transferRequests" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
    if (!request.ok) return pageRefusal(request.error.code);
    const page = await ctx.tenantDb
      .byIndex<TransferRequestRow>(
        "transferRequests",
        "by_orgId_sourceWarehouseId_transferNumber",
        [{ field: "sourceWarehouseId", value: args.warehouseId }],
      )
      .page(pageOptions(request.value));
    return {
      ok: true as const,
      items: page.page.map((row) => ({
        transferRequestId: row._id as never,
        transferNumber: row.transferNumber,
        sourceWarehouseId: row.sourceWarehouseId as never,
        destinationWarehouseId: row.destinationWarehouseId as never,
        sourceKind: row.sourceKind as never,
        ...(row.sourceReference === undefined
          ? {}
          : { sourceReference: row.sourceReference }),
        purpose: row.purpose,
        status: row.status as never,
        lineCount: row.lineCount,
      })),
      nextCursor: page.isDone ? null : page.continueCursor,
      complete: page.isDone,
    };
  },
});

export const listTransferWarehouses = queryWithOrg({
  args: { warehouseId: v.id("warehouses"), ...listArgs },
  returns: pageOf(transferWarehouseValidator),
  permissionCode: "transfer.request.read",
  target: { table: "warehouses" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
    if (!request.ok) return pageRefusal(request.error.code);
    const page = await ctx.tenantDb
      .byIndex<WarehouseRow>("warehouses", "by_orgId_status_code", [
        { field: "status", value: "ACTIVE" },
      ])
      .page(pageOptions(request.value));
    return {
      ok: true as const,
      items: page.page.map((row) => ({
        warehouseId: row._id as never,
        code: row.code,
        name: row.name,
      })),
      nextCursor: page.isDone ? null : page.continueCursor,
      complete: page.isDone,
    };
  },
});

export const listDestinationTransfers = queryWithOrg({
  args: { warehouseId: v.id("warehouses"), ...listArgs },
  returns: pageOf(transferSummaryValidator),
  permissionCode: "transfer.request.read",
  target: { table: "transferRequests" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
    if (!request.ok) return pageRefusal(request.error.code);
    const page = await ctx.tenantDb
      .byIndex<TransferRequestRow>(
        "transferRequests",
        "by_orgId_destinationWarehouseId_transferNumber",
        [{ field: "destinationWarehouseId", value: args.warehouseId }],
      )
      .page(pageOptions(request.value));
    return {
      ok: true as const,
      items: page.page.map((row) => ({
        transferRequestId: row._id as never,
        transferNumber: row.transferNumber,
        sourceWarehouseId: row.sourceWarehouseId as never,
        destinationWarehouseId: row.destinationWarehouseId as never,
        sourceKind: row.sourceKind as never,
        ...(row.sourceReference === undefined
          ? {}
          : { sourceReference: row.sourceReference }),
        purpose: row.purpose,
        status: row.status as never,
        lineCount: row.lineCount,
      })),
      nextCursor: page.isDone ? null : page.continueCursor,
      complete: page.isDone,
    };
  },
});

export const listTransferLines = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    transferRequestId: v.id("transferRequests"),
  },
  returns: v.object({
    ok: v.boolean(),
    lines: v.array(transferLineValidator),
  }),
  permissionCode: "transfer.request.read",
  target: {
    table: "transferRequests",
    id: ({ transferRequestId }) => transferRequestId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const request = await ctx.tenantDb.get<TransferRequestRow>(
      "transferRequests",
      args.transferRequestId,
    );
    if (
      request === null ||
      (request.sourceWarehouseId !== args.warehouseId &&
        request.destinationWarehouseId !== args.warehouseId)
    ) {
      return { ok: false, lines: [] };
    }
    const lines = await loadTransferLines(ctx, request._id);
    return {
      ok: lines !== null,
      lines:
        lines?.map((line) => ({
          transferLineId: line._id as never,
          transferRequestId: line.transferRequestId as never,
          lineNumber: line.lineNumber,
          itemId: line.itemId as never,
          baseUom: line.baseUom,
          quantities: { ...line.quantities },
          ...(line.sourceBucketKey === undefined
            ? {}
            : { sourceBucketKey: line.sourceBucketKey }),
          ...(line.sourceLocationId === undefined
            ? {}
            : { sourceLocationId: line.sourceLocationId as never }),
          ...(line.lotId === undefined ? {} : { lotId: line.lotId as never }),
          ...(line.destinationLocationId === undefined
            ? {}
            : { destinationLocationId: line.destinationLocationId as never }),
        })) ?? [],
    };
  },
});

export const listOpenTransferDiscrepancies = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    transferRequestId: v.id("transferRequests"),
  },
  returns: v.object({
    ok: v.boolean(),
    discrepancies: v.array(transferDiscrepancyValidator),
  }),
  permissionCode: "transfer.request.read",
  target: {
    table: "transferRequests",
    id: ({ transferRequestId }) => transferRequestId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const request = await ctx.tenantDb.get<TransferRequestRow>(
      "transferRequests",
      args.transferRequestId,
    );
    if (
      request === null ||
      (request.sourceWarehouseId !== args.warehouseId &&
        request.destinationWarehouseId !== args.warehouseId)
    ) {
      return { ok: false, discrepancies: [] };
    }
    const page = await ctx.tenantDb
      .byIndex<
        TransferDiscrepancyRow & {
          readonly kind: "MISSING" | "DAMAGED" | "WRONG_TAG";
          readonly baseUom: string;
          readonly note: string;
        }
      >("transferDiscrepancies", "by_orgId_transferRequestId_status", [
        { field: "transferRequestId", value: args.transferRequestId },
        { field: "status", value: "OPEN" },
      ])
      .page({ limit: MAX_TRANSFER_LINES });
    return {
      ok: page.isDone,
      discrepancies: page.isDone
        ? page.page.map((row) => ({
            transferDiscrepancyId: row._id as never,
            transferRequestId: row.transferRequestId as never,
            transferLineId: row.transferLineId as never,
            kind: row.kind,
            baseUom: row.baseUom,
            baseMinorUnits: row.baseMinorUnits,
            note: row.note,
          }))
        : [],
    };
  },
});
