import { v } from "convex/values";

import {
  assertUnique,
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
import type { TenantOrgId } from "../lib/tenantDb";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
  type TenantPolicyContext,
} from "../lib/tenantFunctions";
import { openingStockBatchStatus } from "../lib/validators";
import {
  buildOpeningStockTransactionChunk,
  decideOpeningStockApproval,
  decideOpeningStockRejection,
  decideOpeningStockSubmission,
  makeOpeningStockBatch,
  MAX_OPENING_ROWS_PER_TRANSACTION,
  type OpeningStockBatchState,
  type OpeningStockRowDraft,
} from "../model/counting/openingStock";
import {
  STOCK_STATUSES,
  type StockStatus,
} from "../model/inventory/stockIdentity";
import {
  makeItemUomProfile,
  convertToBase,
  type ItemUomProfile,
} from "../model/uom/itemUom";
import { makeRatio } from "../model/uom/ratio";
import {
  refusal,
  writeContextOf,
  writeErrorValidator,
  writeOutcomeValidator,
  written,
} from "../lib/writeEnvelope";

export const OPENING_STOCK_OPERATIONS = Object.freeze({
  create: "inventory.opening.create",
  importRows: "inventory.opening.importRows",
  submit: "inventory.opening.submit",
  approve: "inventory.opening.approve",
  reject: "inventory.opening.reject",
  post: "inventory.opening.post",
});

const MAX_IMPORT_ROWS = 50;
const MAX_SOURCE_TEXT = 128;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

interface OpeningBatchDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly batchRef: string;
  readonly status: string;
  readonly sourceFileName: string;
  readonly sourceHash: string;
  readonly cutoffAt: number;
  readonly reasonCodeId: string;
  readonly declaredRowCount: number;
  readonly importedRowCount: number;
  readonly validRowCount: number;
  readonly validationErrorCount: number;
  readonly postedRowCount: number;
  readonly createdByUserId: string;
  readonly createdAt: number;
  readonly submittedByUserId?: string;
  readonly submittedAt?: number;
  readonly approvedByUserId?: string;
  readonly approvedAt?: number;
  readonly postedByUserId?: string;
  readonly postedAt?: number;
}

interface OpeningRowDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly openingStockBatchId: string;
  readonly sourceRowNumber: number;
  readonly status: string;
  readonly sourceSku: string;
  readonly sourceLocationCode: string;
  readonly sourceLotCode?: string;
  readonly sourceStockStatus: string;
  readonly entryUom: string;
  readonly entryMinorUnits: number;
  readonly itemId?: string;
  readonly locationId?: string;
  readonly lotId?: string;
  readonly baseUom?: string;
  readonly baseMinorUnits?: number;
  readonly validationCode?: string;
  readonly postedTransactionId?: string;
  readonly importedAt: number;
}

interface ImportChunkDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly openingStockBatchId: string;
  readonly startSourceRowNumber: number;
  readonly requestId: string;
  readonly rowCount: number;
  readonly validRowCount: number;
  readonly validationErrorCount: number;
}

interface PostChunkDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly openingStockBatchId: string;
  readonly requestId: string;
  readonly transactionId?: string;
  readonly rowCount: number;
  readonly status: string;
}

interface ItemDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly sku: string;
  readonly baseUom: string;
  readonly trackingMode: string;
  readonly status: string;
}

interface ItemUomDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly itemId: string;
  readonly uom: string;
  readonly toBaseNumerator: number;
  readonly toBaseDenominator: number;
  readonly status: string;
}

interface LocationDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly warehouseId: string;
  readonly code: string;
  readonly status: string;
}

interface LotDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly itemId: string;
  readonly lotCode: string;
  readonly status: string;
}

interface ReasonCodeDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly scope: string;
  readonly status: string;
}

const importResultValidator = v.union(
  v.object({
    written: v.literal(true),
    documentId: v.string(),
    replayed: v.boolean(),
    rowCount: v.number(),
    validRowCount: v.number(),
    validationErrorCount: v.number(),
  }),
  v.object({ written: v.literal(false), error: writeErrorValidator }),
);

const postResultValidator = v.union(
  v.object({
    written: v.literal(true),
    documentId: v.string(),
    replayed: v.boolean(),
    transactionId: v.string(),
    rowCount: v.number(),
    batchComplete: v.boolean(),
  }),
  v.object({ written: v.literal(false), error: writeErrorValidator }),
);

const batchValidator = v.object({
  batchId: v.id("openingStockBatches"),
  warehouseId: v.id("warehouses"),
  batchRef: v.string(),
  status: openingStockBatchStatus,
  sourceFileName: v.string(),
  sourceHash: v.string(),
  cutoffAt: v.number(),
  declaredRowCount: v.number(),
  importedRowCount: v.number(),
  validRowCount: v.number(),
  validationErrorCount: v.number(),
  postedRowCount: v.number(),
  createdByUserId: v.id("users"),
  createdAt: v.number(),
  submittedByUserId: v.optional(v.id("users")),
  submittedAt: v.optional(v.number()),
  approvedByUserId: v.optional(v.id("users")),
  approvedAt: v.optional(v.number()),
  postedByUserId: v.optional(v.id("users")),
  postedAt: v.optional(v.number()),
});

const toBatchWire = (batch: OpeningBatchDocument) => ({
  batchId: batch._id as never,
  warehouseId: batch.warehouseId as never,
  batchRef: batch.batchRef,
  status: batch.status as never,
  sourceFileName: batch.sourceFileName,
  sourceHash: batch.sourceHash,
  cutoffAt: batch.cutoffAt,
  declaredRowCount: batch.declaredRowCount,
  importedRowCount: batch.importedRowCount,
  validRowCount: batch.validRowCount,
  validationErrorCount: batch.validationErrorCount,
  postedRowCount: batch.postedRowCount,
  createdByUserId: batch.createdByUserId as never,
  createdAt: batch.createdAt,
  ...(batch.submittedByUserId === undefined
    ? {}
    : { submittedByUserId: batch.submittedByUserId as never }),
  ...(batch.submittedAt === undefined
    ? {}
    : { submittedAt: batch.submittedAt }),
  ...(batch.approvedByUserId === undefined
    ? {}
    : { approvedByUserId: batch.approvedByUserId as never }),
  ...(batch.approvedAt === undefined ? {} : { approvedAt: batch.approvedAt }),
  ...(batch.postedByUserId === undefined
    ? {}
    : { postedByUserId: batch.postedByUserId as never }),
  ...(batch.postedAt === undefined ? {} : { postedAt: batch.postedAt }),
});

function domainState(batch: OpeningBatchDocument): OpeningStockBatchState {
  return {
    status: batch.status as OpeningStockBatchState["status"],
    createdByUserId: batch.createdByUserId,
    sourceHash: batch.sourceHash,
    cutoffAt: batch.cutoffAt,
    rowCount: batch.declaredRowCount,
    validRowCount: batch.validRowCount,
    validationErrorCount: batch.validationErrorCount,
    ...(batch.submittedByUserId === undefined
      ? {}
      : { submittedByUserId: batch.submittedByUserId }),
    ...(batch.submittedAt === undefined
      ? {}
      : { submittedAt: batch.submittedAt }),
    ...(batch.approvedByUserId === undefined
      ? {}
      : { approvedByUserId: batch.approvedByUserId }),
    ...(batch.approvedAt === undefined ? {} : { approvedAt: batch.approvedAt }),
  };
}

async function loadProfile(
  ctx: TenantFunctionContext,
  item: ItemDocument,
): Promise<ItemUomProfile | null> {
  const rows = await ctx.tenantDb
    .byIndex<ItemUomDocument>("itemUoms", "by_orgId_itemId_status_uom", [
      { field: "itemId", value: item._id },
      { field: "status", value: "ACTIVE" },
    ])
    .take(25);
  const alternates = [];
  for (const row of rows) {
    const ratio = makeRatio(row.toBaseNumerator, row.toBaseDenominator);
    if (!ratio.ok) return null;
    alternates.push({ uom: row.uom, toBase: ratio.value });
  }
  const profile = makeItemUomProfile({
    itemKey: item._id,
    baseUom: item.baseUom,
    alternates,
  });
  return profile.ok ? profile.value : null;
}

function safeSourceText(raw: string): {
  readonly value: string;
  readonly tooLong: boolean;
} {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return {
    value: trimmed.slice(0, MAX_SOURCE_TEXT),
    tooLong: trimmed.length > MAX_SOURCE_TEXT,
  };
}

interface ImportRowInput {
  readonly sku: string;
  readonly locationCode: string;
  readonly lotCode?: string;
  readonly stockStatus: string;
  readonly entryUom: string;
  readonly entryMinorUnits: number;
}

async function validateImportRow(
  ctx: TenantFunctionContext,
  input: {
    readonly batch: OpeningBatchDocument;
    readonly sourceRowNumber: number;
    readonly row: ImportRowInput;
    readonly now: number;
  },
): Promise<Record<string, unknown>> {
  const skuSource = safeSourceText(input.row.sku);
  const locationSource = safeSourceText(input.row.locationCode);
  const lotSource =
    input.row.lotCode === undefined
      ? undefined
      : safeSourceText(input.row.lotCode);
  const statusSource = safeSourceText(input.row.stockStatus);
  const uomSource = safeSourceText(input.row.entryUom);
  const base = {
    warehouseId: input.batch.warehouseId,
    openingStockBatchId: input.batch._id,
    sourceRowNumber: input.sourceRowNumber,
    sourceSku: skuSource.value,
    sourceLocationCode: locationSource.value,
    ...(lotSource === undefined || lotSource.value.length === 0
      ? {}
      : { sourceLotCode: lotSource.value }),
    sourceStockStatus: statusSource.value,
    entryUom: uomSource.value,
    entryMinorUnits: input.row.entryMinorUnits,
    importedAt: input.now,
  };
  const invalid = (
    validationCode: string,
    details: Record<string, unknown> = {},
  ) => ({
    ...base,
    ...details,
    status: "INVALID" as const,
    validationCode,
  });
  if (
    skuSource.tooLong ||
    locationSource.tooLong ||
    lotSource?.tooLong === true ||
    statusSource.tooLong ||
    uomSource.tooLong
  ) {
    return invalid("SOURCE_FIELD_TOO_LONG");
  }
  const sku = normalizeField("sku", skuSource.value, CODE_FIELD);
  if (!sku.ok) return invalid("SKU_INVALID");
  const item = await ctx.tenantDb
    .byIndex<ItemDocument>("items", "by_orgId_sku", [
      { field: "sku", value: sku.value },
    ])
    .first();
  if (item === null) return invalid("ITEM_NOT_FOUND");
  if (item.status !== "ACTIVE")
    return invalid("ITEM_INACTIVE", { itemId: item._id });

  const locationCode = normalizeField(
    "locationCode",
    locationSource.value,
    CODE_FIELD,
  );
  if (!locationCode.ok)
    return invalid("LOCATION_INVALID", { itemId: item._id });
  const location = await ctx.tenantDb
    .byIndex<LocationDocument>("locations", "by_orgId_warehouseId_code", [
      { field: "warehouseId", value: input.batch.warehouseId },
      { field: "code", value: locationCode.value },
    ])
    .first();
  if (location === null)
    return invalid("LOCATION_NOT_FOUND", { itemId: item._id });
  if (location.status !== "ACTIVE") {
    return invalid("LOCATION_INACTIVE", {
      itemId: item._id,
      locationId: location._id,
    });
  }
  if (!(STOCK_STATUSES as readonly string[]).includes(statusSource.value)) {
    return invalid("STOCK_STATUS_INVALID", {
      itemId: item._id,
      locationId: location._id,
    });
  }

  let lotId: string | undefined;
  if (item.trackingMode === "LOT") {
    if (lotSource === undefined || lotSource.value.length === 0) {
      return invalid("LOT_REQUIRED", {
        itemId: item._id,
        locationId: location._id,
      });
    }
    const lot = await ctx.tenantDb
      .byIndex<LotDocument>("lots", "by_orgId_itemId_lotCode", [
        { field: "itemId", value: item._id },
        { field: "lotCode", value: lotSource.value },
      ])
      .first();
    if (lot === null || lot.status !== "ACTIVE") {
      return invalid("LOT_NOT_FOUND", {
        itemId: item._id,
        locationId: location._id,
      });
    }
    lotId = lot._id;
  } else if (item.trackingMode === "LOT_SERIAL") {
    return invalid("SERIAL_FLOW_DISABLED", {
      itemId: item._id,
      locationId: location._id,
    });
  } else if (lotSource !== undefined && lotSource.value.length > 0) {
    return invalid("LOT_NOT_TRACKED", {
      itemId: item._id,
      locationId: location._id,
    });
  }

  const profile = await loadProfile(ctx, item);
  if (profile === null) {
    return invalid("UOM_PROFILE_INVALID", {
      itemId: item._id,
      locationId: location._id,
    });
  }
  const converted = convertToBase(
    profile,
    uomSource.value,
    input.row.entryMinorUnits,
  );
  if (converted.kind === "REJECTED") {
    return invalid("UOM_REJECTED", {
      itemId: item._id,
      locationId: location._id,
    });
  }
  if (converted.kind === "INEXACT") {
    return invalid("UOM_INEXACT", {
      itemId: item._id,
      locationId: location._id,
    });
  }
  if (converted.quantity.minorUnits <= 0) {
    return invalid("QUANTITY_NOT_POSITIVE", {
      itemId: item._id,
      locationId: location._id,
    });
  }
  return {
    ...base,
    status: "VALID" as const,
    itemId: item._id,
    locationId: location._id,
    ...(lotId === undefined ? {} : { lotId }),
    baseUom: converted.quantity.uom,
    baseMinorUnits: converted.quantity.minorUnits,
  };
}

export const createOpeningStockBatch = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    batchRef: v.string(),
    sourceFileName: v.string(),
    sourceHash: v.string(),
    cutoffAt: v.number(),
    declaredRowCount: v.number(),
    reasonCodeId: v.id("reasonCodes"),
  },
  returns: writeOutcomeValidator,
  permissionCode: "inventory.opening.manage",
  target: { table: "openingStockBatches" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const batchRef = normalizeField("batchRef", args.batchRef, CODE_FIELD);
    if (!batchRef.ok) return refusal(batchRef.error);
    const fileName = normalizeDisplayName(
      "sourceFileName",
      args.sourceFileName,
    );
    if (!fileName.ok) return refusal(fileName.error);
    const seed = makeOpeningStockBatch({
      createdByUserId: ctx.tenant.actor._id,
      sourceHash: args.sourceHash,
      cutoffAt: args.cutoffAt,
      rowCount: args.declaredRowCount,
      validRowCount: args.declaredRowCount,
      validationErrorCount: 0,
    });
    if (!seed.ok) {
      return refusal({ code: seed.error.code, field: "declaredRowCount" });
    }
    if (!SHA256_PATTERN.test(args.sourceHash)) {
      return refusal({ code: "SOURCE_HASH_INVALID", field: "sourceHash" });
    }
    if (
      !Number.isSafeInteger(args.declaredRowCount) ||
      args.declaredRowCount <= 0 ||
      args.declaredRowCount > 100_000
    ) {
      return refusal({ code: "ROW_COUNT_INVALID", field: "declaredRowCount" });
    }
    const reason = await ctx.tenantDb.get<ReasonCodeDocument>(
      "reasonCodes",
      args.reasonCodeId,
    );
    if (
      reason === null ||
      reason.status !== "ACTIVE" ||
      reason.scope !== "ADJUSTMENT"
    ) {
      return refusal({ code: "REFERENCE_NOT_FOUND", field: "reasonCodeId" });
    }
    const now = Date.now();
    const document = {
      warehouseId: args.warehouseId,
      batchRef: batchRef.value,
      status: "DRAFT",
      sourceFileName: fileName.value,
      sourceHash: args.sourceHash.toLowerCase(),
      cutoffAt: args.cutoffAt,
      reasonCodeId: args.reasonCodeId,
      declaredRowCount: args.declaredRowCount,
      importedRowCount: 0,
      validRowCount: 0,
      validationErrorCount: 0,
      postedRowCount: 0,
      createdByUserId: ctx.tenant.actor._id,
      createdAt: now,
    };
    const outcome = await createMasterDataRow({
      ...writeContextOf(ctx, {
        table: "openingStockBatches",
        operation: OPENING_STOCK_OPERATIONS.create,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      fingerprint: { ...document, createdAt: undefined },
      uniqueness: [
        {
          field: "batchRef",
          index: "by_orgId_batchRef",
          equality: [{ field: "batchRef", value: batchRef.value }],
        },
      ],
      document,
    });
    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

const importRowArgument = v.object({
  sku: v.string(),
  locationCode: v.string(),
  lotCode: v.optional(v.string()),
  stockStatus: v.string(),
  entryUom: v.string(),
  entryMinorUnits: v.number(),
});

export const importOpeningStockRows = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    openingStockBatchId: v.id("openingStockBatches"),
    startSourceRowNumber: v.number(),
    rows: v.array(importRowArgument),
  },
  returns: importResultValidator,
  permissionCode: "inventory.opening.manage",
  target: {
    table: "openingStockBatches",
    id: ({ openingStockBatchId }) => openingStockBatchId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const fingerprint = {
      openingStockBatchId: args.openingStockBatchId,
      startSourceRowNumber: args.startSourceRowNumber,
      rows: args.rows,
    };
    const replay = await replayTenantWriteIfPresent({
      tenantDb: ctx.tenantDb,
      table: "openingStockImportChunks",
      operation: OPENING_STOCK_OPERATIONS.importRows,
      requestId: args.requestId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) {
      const chunk = await ctx.tenantDb.get<ImportChunkDocument>(
        "openingStockImportChunks",
        replay.value.documentId,
      );
      if (chunk === null)
        return refusal({
          code: "REPLAY_TARGET_MISSING",
          requestId: args.requestId,
        });
      return {
        written: true as const,
        documentId: chunk._id,
        replayed: true,
        rowCount: chunk.rowCount,
        validRowCount: chunk.validRowCount,
        validationErrorCount: chunk.validationErrorCount,
      };
    }
    const batch = await ctx.tenantDb.get<OpeningBatchDocument>(
      "openingStockBatches",
      args.openingStockBatchId,
    );
    if (batch === null)
      return refusal({ code: "NOT_FOUND", table: "openingStockBatches" });
    if (batch.warehouseId !== args.warehouseId)
      return refusal({ code: "NOT_FOUND", table: "openingStockBatches" });
    if (batch.status !== "DRAFT")
      return refusal({ code: "BATCH_NOT_READY", status: batch.status });
    if (
      !Number.isSafeInteger(args.startSourceRowNumber) ||
      args.startSourceRowNumber <= 0
    ) {
      return refusal({ code: "FIELD_INVALID", field: "startSourceRowNumber" });
    }
    if (args.rows.length === 0 || args.rows.length > MAX_IMPORT_ROWS) {
      return refusal({ code: "ROW_COUNT_INVALID", field: "rows" });
    }
    const end = args.startSourceRowNumber + args.rows.length - 1;
    if (end > batch.declaredRowCount) {
      return refusal({ code: "ROW_COUNT_INVALID", field: "rows" });
    }
    const existingChunk = await ctx.tenantDb
      .byIndex<ImportChunkDocument>(
        "openingStockImportChunks",
        "by_orgId_openingStockBatchId_startSourceRowNumber",
        [
          { field: "openingStockBatchId", value: batch._id },
          { field: "startSourceRowNumber", value: args.startSourceRowNumber },
        ],
      )
      .first();
    if (existingChunk !== null)
      return refusal({ code: "DUPLICATE_KEY", field: "startSourceRowNumber" });
    for (let index = 0; index < args.rows.length; index += 1) {
      const existing = await ctx.tenantDb
        .byIndex<OpeningRowDocument>(
          "openingStockRows",
          "by_orgId_openingStockBatchId_sourceRowNumber",
          [
            { field: "openingStockBatchId", value: batch._id },
            {
              field: "sourceRowNumber",
              value: args.startSourceRowNumber + index,
            },
          ],
        )
        .first();
      if (existing !== null)
        return refusal({ code: "DUPLICATE_KEY", field: "sourceRowNumber" });
    }
    const now = Date.now();
    const documents: Record<string, unknown>[] = [];
    let validRowCount = 0;
    for (const [index, row] of args.rows.entries()) {
      const document = await validateImportRow(ctx, {
        batch,
        sourceRowNumber: args.startSourceRowNumber + index,
        row,
        now,
      });
      if (document["status"] === "VALID") validRowCount += 1;
      documents.push(document);
    }
    const validationErrorCount = documents.length - validRowCount;
    const chunkOutcome = await createMasterDataRow({
      ...writeContextOf(ctx, {
        table: "openingStockImportChunks",
        operation: OPENING_STOCK_OPERATIONS.importRows,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      fingerprint,
      uniqueness: [
        {
          field: "startSourceRowNumber",
          index: "by_orgId_openingStockBatchId_startSourceRowNumber",
          equality: [
            { field: "openingStockBatchId", value: batch._id },
            { field: "startSourceRowNumber", value: args.startSourceRowNumber },
          ],
        },
        {
          field: "requestId",
          index: "by_orgId_requestId",
          equality: [{ field: "requestId", value: args.requestId }],
        },
      ],
      document: {
        openingStockBatchId: batch._id,
        startSourceRowNumber: args.startSourceRowNumber,
        requestId: args.requestId,
        rowCount: documents.length,
        validRowCount,
        validationErrorCount,
        importedByUserId: ctx.tenant.actor._id,
        importedAt: now,
      },
    });
    if (!chunkOutcome.ok) return refusal(chunkOutcome.error);
    for (const document of documents) {
      await ctx.tenantDb.insert("openingStockRows", document);
    }
    await ctx.tenantDb.patch("openingStockBatches", batch._id, {
      importedRowCount: batch.importedRowCount + documents.length,
      validRowCount: batch.validRowCount + validRowCount,
      validationErrorCount: batch.validationErrorCount + validationErrorCount,
    });
    return {
      written: true as const,
      documentId: chunkOutcome.value.documentId,
      replayed: false,
      rowCount: documents.length,
      validRowCount,
      validationErrorCount,
    };
  },
});

async function replayTransition(
  ctx: TenantFunctionContext,
  input: {
    readonly table: "openingStockBatches";
    readonly operation: string;
    readonly requestId: string;
    readonly batchId: string;
    readonly fingerprint: unknown;
  },
) {
  return await replayTenantWriteIfPresent({
    tenantDb: ctx.tenantDb,
    table: input.table,
    operation: input.operation,
    requestId: input.requestId,
    fingerprint: input.fingerprint,
  });
}

export const submitOpeningStockBatch = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    openingStockBatchId: v.id("openingStockBatches"),
  },
  returns: writeOutcomeValidator,
  permissionCode: "inventory.opening.manage",
  target: {
    table: "openingStockBatches",
    id: ({ openingStockBatchId }) => openingStockBatchId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const fingerprint = { openingStockBatchId: args.openingStockBatchId };
    const replay = await replayTransition(ctx, {
      table: "openingStockBatches",
      operation: OPENING_STOCK_OPERATIONS.submit,
      requestId: args.requestId,
      batchId: args.openingStockBatchId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    const batch = await ctx.tenantDb.get<OpeningBatchDocument>(
      "openingStockBatches",
      args.openingStockBatchId,
    );
    if (batch === null || batch.warehouseId !== args.warehouseId)
      return refusal({ code: "NOT_FOUND", table: "openingStockBatches" });
    if (batch.importedRowCount !== batch.declaredRowCount)
      return refusal({ code: "ROWS_INCOMPLETE", field: "importedRowCount" });
    const decision = decideOpeningStockSubmission({
      state: domainState(batch),
      actorUserId: ctx.tenant.actor._id,
      now: Date.now(),
    });
    if (!decision.ok) return refusal(decision.error);
    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "openingStockBatches",
        operation: OPENING_STOCK_OPERATIONS.submit,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: batch._id,
      fingerprint,
      uniqueness: [],
      patch: {
        status: decision.value.status,
        submittedByUserId: decision.value.submittedByUserId,
        submittedAt: decision.value.submittedAt,
      },
    });
    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

export async function openingStockApprovalPolicy(
  ctx: TenantPolicyContext,
  args: { readonly openingStockBatchId: string },
) {
  const batch = await ctx.tenantDb.get<OpeningBatchDocument>(
    "openingStockBatches",
    args.openingStockBatchId,
  );
  return batch === null
    ? Object.freeze({ thresholdExceeded: false, approvalSatisfied: false })
    : Object.freeze({
        thresholdExceeded: false,
        approvalSatisfied: true,
        makerUserId: batch.submittedByUserId ?? batch.createdByUserId,
      });
}

export const approveOpeningStockBatch = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    openingStockBatchId: v.id("openingStockBatches"),
  },
  returns: writeOutcomeValidator,
  permissionCode: "inventory.opening.approve",
  target: {
    table: "openingStockBatches",
    id: ({ openingStockBatchId }) => openingStockBatchId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  policy: openingStockApprovalPolicy,
  handler: async (ctx, args) => {
    const fingerprint = { openingStockBatchId: args.openingStockBatchId };
    const replay = await replayTransition(ctx, {
      table: "openingStockBatches",
      operation: OPENING_STOCK_OPERATIONS.approve,
      requestId: args.requestId,
      batchId: args.openingStockBatchId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    const batch = await ctx.tenantDb.get<OpeningBatchDocument>(
      "openingStockBatches",
      args.openingStockBatchId,
    );
    if (batch === null || batch.warehouseId !== args.warehouseId)
      return refusal({ code: "NOT_FOUND", table: "openingStockBatches" });
    const decision = decideOpeningStockApproval({
      state: domainState(batch),
      actorUserId: ctx.tenant.actor._id,
      now: Date.now(),
    });
    if (!decision.ok) return refusal(decision.error);
    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "openingStockBatches",
        operation: OPENING_STOCK_OPERATIONS.approve,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: batch._id,
      fingerprint,
      uniqueness: [],
      patch: {
        status: decision.value.status,
        approvedByUserId: decision.value.approvedByUserId,
        approvedAt: decision.value.approvedAt,
      },
    });
    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

export const rejectOpeningStockBatch = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    openingStockBatchId: v.id("openingStockBatches"),
    reason: v.string(),
  },
  returns: writeOutcomeValidator,
  permissionCode: "inventory.opening.manage",
  target: {
    table: "openingStockBatches",
    id: ({ openingStockBatchId }) => openingStockBatchId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const fingerprint = {
      openingStockBatchId: args.openingStockBatchId,
      reason: args.reason,
    };
    const replay = await replayTransition(ctx, {
      table: "openingStockBatches",
      operation: OPENING_STOCK_OPERATIONS.reject,
      requestId: args.requestId,
      batchId: args.openingStockBatchId,
      fingerprint,
    });
    if (!replay.ok) return refusal(replay.error);
    if (replay.value !== null) return written(replay.value);
    const batch = await ctx.tenantDb.get<OpeningBatchDocument>(
      "openingStockBatches",
      args.openingStockBatchId,
    );
    if (batch === null || batch.warehouseId !== args.warehouseId)
      return refusal({ code: "NOT_FOUND", table: "openingStockBatches" });
    const decision = decideOpeningStockRejection({
      state: domainState(batch),
      actorUserId: ctx.tenant.actor._id,
      reason: args.reason,
      now: Date.now(),
    });
    if (!decision.ok) return refusal(decision.error);
    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "openingStockBatches",
        operation: OPENING_STOCK_OPERATIONS.reject,
        requestId: args.requestId,
        warehouseId: args.warehouseId,
      }),
      documentId: batch._id,
      fingerprint,
      uniqueness: [],
      patch: {
        status: decision.value.status,
        rejectedByUserId: decision.value.rejectedByUserId,
        rejectedAt: decision.value.rejectedAt,
        rejectionReason: decision.value.rejectionReason,
      },
    });
    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

export const postNextOpeningStockChunk = mutationWithOrg({
  args: {
    requestId: v.string(),
    warehouseId: v.id("warehouses"),
    openingStockBatchId: v.id("openingStockBatches"),
  },
  returns: postResultValidator,
  permissionCode: "inventory.opening.post",
  target: {
    table: "openingStockBatches",
    id: ({ openingStockBatchId }) => openingStockBatchId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const priorChunk = await ctx.tenantDb
      .byIndex<PostChunkDocument>(
        "openingStockPostChunks",
        "by_orgId_requestId",
        [{ field: "requestId", value: args.requestId }],
      )
      .first();
    if (priorChunk !== null) {
      if (
        priorChunk.openingStockBatchId !== args.openingStockBatchId ||
        priorChunk.transactionId === undefined ||
        priorChunk.status !== "POSTED"
      ) {
        return refusal({
          code: "REQUEST_ID_REUSED",
          requestId: args.requestId,
        });
      }
      const batch = await ctx.tenantDb.get<OpeningBatchDocument>(
        "openingStockBatches",
        args.openingStockBatchId,
      );
      return {
        written: true as const,
        documentId: priorChunk._id,
        replayed: true,
        transactionId: priorChunk.transactionId,
        rowCount: priorChunk.rowCount,
        batchComplete: batch?.status === "POSTED",
      };
    }
    const batch = await ctx.tenantDb.get<OpeningBatchDocument>(
      "openingStockBatches",
      args.openingStockBatchId,
    );
    if (batch === null || batch.warehouseId !== args.warehouseId)
      return refusal({ code: "NOT_FOUND", table: "openingStockBatches" });
    if (batch.status !== "APPROVED" && batch.status !== "POSTING") {
      return refusal({ code: "BATCH_NOT_READY", status: batch.status });
    }
    const rows = await ctx.tenantDb
      .byIndex<OpeningRowDocument>(
        "openingStockRows",
        "by_orgId_openingStockBatchId_status_sourceRowNumber",
        [
          { field: "openingStockBatchId", value: batch._id },
          { field: "status", value: "VALID" },
        ],
      )
      .take(MAX_OPENING_ROWS_PER_TRANSACTION);
    if (rows.length === 0) {
      return refusal({ code: "NO_ROWS_TO_POST", status: batch.status });
    }
    const plannedRows: OpeningStockRowDraft[] = [];
    for (const row of rows) {
      if (
        row.itemId === undefined ||
        row.locationId === undefined ||
        row.baseUom === undefined ||
        row.baseMinorUnits === undefined
      ) {
        return refusal({
          code: "VALIDATED_ROW_CORRUPT",
          table: "openingStockRows",
        });
      }
      const item = await ctx.tenantDb.get<ItemDocument>("items", row.itemId);
      if (item === null)
        return refusal({ code: "REFERENCE_NOT_FOUND", field: "itemId" });
      const profile = await loadProfile(ctx, item);
      if (profile === null)
        return refusal({ code: "UOM_PROFILE_INVALID", field: "itemId" });
      plannedRows.push({
        bucket: {
          orgId: ctx.tenant.organization._id,
          warehouseId: batch.warehouseId,
          itemId: row.itemId,
          location: { kind: "PHYSICAL", locationId: row.locationId },
          ...(row.lotId === undefined ? {} : { lotId: row.lotId }),
          stockStatus: row.sourceStockStatus as StockStatus,
        },
        profile,
        entryUom: row.entryUom,
        entryMinorUnits: row.entryMinorUnits,
      });
    }
    const now = Date.now();
    const draft = buildOpeningStockTransactionChunk({
      orgId: ctx.tenant.organization._id,
      warehouseId: batch.warehouseId,
      batchId: batch._id,
      requestId: args.requestId,
      actorUserId: ctx.tenant.actor._id,
      occurredAt: now,
      reasonCodeId: batch.reasonCodeId,
      rows: plannedRows,
    });
    if (!draft.ok) return refusal({ code: draft.error.code, field: "rows" });
    const posted = await postLedgerTransaction({
      tenantDb: ctx.tenantDb,
      tenant: ctx.tenant,
      permissionCode: ctx.permission.code,
      now,
      draft: draft.value,
    });
    if (!posted.ok) return refusal(toPublicLedgerError(posted.error));
    const transactionId = posted.value.result.transactionId;
    const chunkNumber =
      Math.floor(batch.postedRowCount / MAX_OPENING_ROWS_PER_TRANSACTION) + 1;
    const firstSourceRowNumber = rows[0]!.sourceRowNumber;
    const lastSourceRowNumber = rows[rows.length - 1]!.sourceRowNumber;
    const uniqueChunk = await assertUnique(
      ctx.tenantDb,
      "openingStockPostChunks",
      [
        {
          field: "chunkNumber",
          index: "by_orgId_openingStockBatchId_chunkNumber",
          equality: [
            { field: "openingStockBatchId", value: batch._id },
            { field: "chunkNumber", value: chunkNumber },
          ],
        },
        {
          field: "requestId",
          index: "by_orgId_requestId",
          equality: [{ field: "requestId", value: args.requestId }],
        },
      ],
    );
    if (!uniqueChunk.ok) return refusal(uniqueChunk.error);
    const chunkId = await ctx.tenantDb.insert("openingStockPostChunks", {
      warehouseId: batch.warehouseId,
      openingStockBatchId: batch._id,
      chunkNumber,
      firstSourceRowNumber,
      lastSourceRowNumber,
      rowCount: rows.length,
      requestId: args.requestId,
      status: "POSTED",
      transactionId,
      postedByUserId: ctx.tenant.actor._id,
      postedAt: now,
    });
    for (const row of rows) {
      await ctx.tenantDb.patch("openingStockRows", row._id, {
        status: "POSTED",
        postedTransactionId: transactionId,
      });
    }
    const postedRowCount = batch.postedRowCount + rows.length;
    const batchComplete = postedRowCount === batch.validRowCount;
    await ctx.tenantDb.patch("openingStockBatches", batch._id, {
      status: batchComplete ? "POSTED" : "POSTING",
      postedRowCount,
      ...(batch.status === "APPROVED" ? { postingStartedAt: now } : {}),
      ...(batchComplete
        ? { postedByUserId: ctx.tenant.actor._id, postedAt: now }
        : {}),
    });
    return {
      written: true as const,
      documentId: chunkId,
      replayed: posted.value.replayed,
      transactionId,
      rowCount: rows.length,
      batchComplete,
    };
  },
});

export const getOpeningStockBatch = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    openingStockBatchId: v.id("openingStockBatches"),
  },
  returns: v.union(
    v.object({ found: v.literal(true), batch: batchValidator }),
    v.object({ found: v.literal(false) }),
  ),
  permissionCode: "inventory.opening.read",
  target: {
    table: "openingStockBatches",
    id: ({ openingStockBatchId }) => openingStockBatchId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const batch = await ctx.tenantDb.get<OpeningBatchDocument>(
      "openingStockBatches",
      args.openingStockBatchId,
    );
    return batch === null || batch.warehouseId !== args.warehouseId
      ? { found: false as const }
      : { found: true as const, batch: toBatchWire(batch) };
  },
});

const rowWireValidator = v.object({
  rowId: v.id("openingStockRows"),
  sourceRowNumber: v.number(),
  status: v.string(),
  sourceSku: v.string(),
  sourceLocationCode: v.string(),
  sourceLotCode: v.optional(v.string()),
  sourceStockStatus: v.string(),
  entryUom: v.string(),
  entryMinorUnits: v.number(),
  baseUom: v.optional(v.string()),
  baseMinorUnits: v.optional(v.number()),
  validationCode: v.optional(v.string()),
  postedTransactionId: v.optional(v.id("inventoryTransactions")),
});

export const listOpeningStockRows = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    openingStockBatchId: v.id("openingStockBatches"),
    status: v.union(
      v.literal("VALID"),
      v.literal("INVALID"),
      v.literal("POSTED"),
    ),
    limit: v.number(),
  },
  returns: v.object({
    rows: v.array(rowWireValidator),
    truncated: v.boolean(),
  }),
  permissionCode: "inventory.opening.read",
  target: {
    table: "openingStockBatches",
    id: ({ openingStockBatchId }) => openingStockBatchId,
  },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const limit =
      Number.isSafeInteger(args.limit) && args.limit > 0 && args.limit <= 100
        ? args.limit
        : 50;
    const batch = await ctx.tenantDb.get<OpeningBatchDocument>(
      "openingStockBatches",
      args.openingStockBatchId,
    );
    if (batch === null || batch.warehouseId !== args.warehouseId)
      return { rows: [], truncated: false };
    const rows = await ctx.tenantDb
      .byIndex<OpeningRowDocument>(
        "openingStockRows",
        "by_orgId_openingStockBatchId_status_sourceRowNumber",
        [
          { field: "openingStockBatchId", value: batch._id },
          { field: "status", value: args.status },
        ],
      )
      .take(limit + (limit < 100 ? 1 : 0));
    return {
      rows: rows.slice(0, limit).map((row) => ({
        rowId: row._id as never,
        sourceRowNumber: row.sourceRowNumber,
        status: row.status,
        sourceSku: row.sourceSku,
        sourceLocationCode: row.sourceLocationCode,
        ...(row.sourceLotCode === undefined
          ? {}
          : { sourceLotCode: row.sourceLotCode }),
        sourceStockStatus: row.sourceStockStatus,
        entryUom: row.entryUom,
        entryMinorUnits: row.entryMinorUnits,
        ...(row.baseUom === undefined ? {} : { baseUom: row.baseUom }),
        ...(row.baseMinorUnits === undefined
          ? {}
          : { baseMinorUnits: row.baseMinorUnits }),
        ...(row.validationCode === undefined
          ? {}
          : { validationCode: row.validationCode }),
        ...(row.postedTransactionId === undefined
          ? {}
          : { postedTransactionId: row.postedTransactionId as never }),
      })),
      truncated: rows.length > limit,
    };
  },
});
