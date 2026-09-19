import { pageArgs as cataloguePageArgs, hydrateUnit } from "./catalogue";
import {
  paginatedScan,
  remainingScanCapacity,
} from "../lib/cataloguePagination";
import { summaryReadiness } from "../lib/finishedGoodsSummary";
import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import {
  quantityToMinor,
  validatePacking,
  MAX_FG_PACKAGES,
  type PackedUnit,
} from "../model/finishedGoods/packing";
import { validDimension } from "../model/finishedGoods/placement";
import {
  command,
  compact,
  created,
  failure,
  nextCode,
  palletOf,
  productOf,
  rows,
  stamp,
} from "./workflow";
const READ = "masterData.storageLayout.read";
const MANAGE = "masterData.storageLayout.manage";
const format = v.union(
  v.literal("PALLET"),
  v.literal("BOX"),
  v.literal("OTHER"),
);
const packageFields = v.object({
  quantity: v.optional(v.number()),
  lengthMm: v.optional(v.number()),
  widthMm: v.optional(v.number()),
  heightMm: v.optional(v.number()),
  weightKg: v.optional(v.number()),
  fillPercent: v.optional(v.number()),
  dimensionsChecked: v.boolean(),
});
const writeFields = {
  warehouseId: v.id("warehouses"),
  productId: v.id("finishedGoodsProducts"),
  requestId: v.string(),
  simplePacking: v.optional(v.boolean()),
  sameSize: v.optional(v.boolean()),
  batchId: v.optional(v.id("finishedGoodsBatches")),
  expectedRevision: v.optional(v.number()),
  totalQuantity: v.optional(v.number()),
  storageFormat: format,
  lot: v.optional(v.string()),
  splitMode: v.optional(
    v.union(v.literal("CAPACITY"), v.literal("EQUAL"), v.literal("MANUAL")),
  ),
  capacity: v.optional(v.number()),
  unitCount: v.optional(v.number()),
  packages: v.array(packageFields),
};
const _writeValidator = v.object(writeFields);
type BatchInput = Infer<typeof _writeValidator>;
async function batchOf(
  ctx: TenantFunctionContext,
  warehouseId: string,
  batchId: string,
) {
  const batch = await ctx.tenantDb.get<Doc<"finishedGoodsBatches">>(
    "finishedGoodsBatches",
    batchId,
  );
  return batch?.warehouseId === warehouseId ? batch : null;
}
async function unitsOf(
  ctx: TenantFunctionContext,
  batchId: Id<"finishedGoodsBatches">,
) {
  return (
    await rows<Doc<"finishedGoodsPallets">>(
      ctx,
      "finishedGoodsPallets",
      "by_orgId_preparationBatchId",
      [{ field: "preparationBatchId", value: batchId }],
    )
  ).filter((p) => !p.retiredAt);
}
async function withMove(
  ctx: TenantFunctionContext,
  unit: Doc<"finishedGoodsPallets">,
) {
  const moves = await rows<Doc<"finishedGoodsMoves">>(
    ctx,
    "finishedGoodsMoves",
    "by_orgId_palletId",
    [{ field: "palletId", value: unit._id }],
  );
  const move = moves.find(
    (m) => m.status === "RESERVED" || m.status === "IN_TRANSIT",
  );
  return {
    ...unit,
    ...(move ? { moveStatus: move.status, activeMoveId: move._id } : {}),
  };
}
/** Every physical hold is inspected independently of the convenience pallet status. */
async function editableUnits(
  ctx: TenantFunctionContext,
  units: Doc<"finishedGoodsPallets">[],
) {
  for (const unit of units) {
    if (unit.status === "RESERVED" || unit.status === "STORED") return false;
    for (const status of ["RESERVED", "STORED"] as const) {
      for (const field of ["supportPalletId", "palletId"] as const) {
        const placement = await ctx.tenantDb
          .byIndex<Doc<"finishedGoodsPlacements">>(
            "finishedGoodsPlacements",
            `by_orgId_${field}_status`,
            [
              { field, value: unit._id },
              { field: "status", value: status },
            ],
          )
          .first();
        if (placement) return false;
      }
    }
    for (const status of ["RESERVED", "IN_TRANSIT"] as const) {
      const move = await ctx.tenantDb
        .byIndex<Doc<"finishedGoodsMoves">>(
          "finishedGoodsMoves",
          "by_orgId_palletId_status",
          [
            { field: "palletId", value: unit._id },
            { field: "status", value: status },
          ],
        )
        .first();
      if (move) return false;
    }
  }
  return true;
}
async function detail(
  ctx: TenantFunctionContext,
  batch: Doc<"finishedGoodsBatches">,
) {
  const units = await unitsOf(ctx, batch._id);
  const history = await rows<Doc<"finishedGoodsBatchRevisions">>(
    ctx,
    "finishedGoodsBatchRevisions",
    "by_orgId_batchId_revision",
    [{ field: "batchId", value: batch._id }],
  );
  const managedUnits = await Promise.all(
    units.map(async (unit) => ({
      ...(await withMove(ctx, unit)),
      editable: await editableUnits(ctx, [unit]),
    })),
  );
  const editable = managedUnits.every((unit) => unit.editable);
  return {
    batch,
    units: managedUnits,
    history: history.sort((a, b) => b.revision - a.revision),
    editable,
    ...(!editable ? { blockedReason: "BATCH_NOT_EDITABLE" } : {}),
  };
}
function validateDraft(args: BatchInput, unit: string) {
  if (args.packages.length > MAX_FG_PACKAGES) return "PACKAGE_COUNT_INVALID";
  if (
    args.totalQuantity !== undefined &&
    quantityToMinor(args.totalQuantity, unit) === null
  )
    return "QUANTITY_INVALID";
  if (
    args.capacity !== undefined &&
    quantityToMinor(args.capacity, unit) === null
  )
    return "QUANTITY_INVALID";
  if (
    args.unitCount !== undefined &&
    (!Number.isInteger(args.unitCount) ||
      args.unitCount < 1 ||
      args.unitCount > MAX_FG_PACKAGES)
  )
    return "PACKAGE_COUNT_INVALID";
  if ((args.lot?.length ?? 0) > 100) return "FIELD_INVALID";
  for (const row of args.packages) {
    if (
      row.fillPercent !== undefined &&
      (!Number.isInteger(row.fillPercent) ||
        row.fillPercent < 1 ||
        row.fillPercent > 100)
    )
      return "FILL_PERCENT_INVALID";
    if (
      row.quantity !== undefined &&
      quantityToMinor(row.quantity, unit) === null
    )
      return "QUANTITY_INVALID";
    if (
      [row.lengthMm, row.widthMm, row.heightMm].some(
        (n) => n !== undefined && !validDimension(n),
      )
    )
      return "DIMENSIONS_INVALID";
    if (
      row.weightKg !== undefined &&
      (!Number.isFinite(row.weightKg) ||
        row.weightKg <= 0 ||
        row.weightKg > 1_000_000)
    )
      return "WEIGHT_INVALID";
  }
  return null;
}
async function save(
  ctx: TenantFunctionContext,
  args: BatchInput,
  commit: boolean,
) {
  const result = await command(
    ctx,
    args,
    commit ? "finishedGoods.batch.commit" : "finishedGoods.batch.draft",
    "finishedGoodsBatchRevisions",
    async () => {
      const product = await productOf(ctx, args);
      if (!product) return failure("NOT_FOUND");
      if (product.status !== "ACTIVE") return failure("PRODUCT_DRAFT");
      const before = args.batchId
        ? await batchOf(ctx, args.warehouseId, args.batchId)
        : null;
      if (args.batchId && (!before || before.productId !== args.productId))
        return failure("NOT_FOUND");
      if (before && args.expectedRevision !== before.revision)
        return failure("STALE_REVISION");
      if (before?.status === "CREATED" && !commit)
        return failure("BATCH_ALREADY_CREATED");
      const error = validateDraft(args, product.unit);
      if (error) return failure(error);
      if (commit) {
        if (args.totalQuantity === undefined)
          return failure("QUANTITY_INVALID");
        const invalid = validatePacking(
          args.totalQuantity,
          args.packages as PackedUnit[],
          product.unit,
          args.simplePacking ? "SIMPLE" : "GEOMETRIC",
        );
        if (invalid) return failure(invalid);
      }
      const oldUnits = before ? await unitsOf(ctx, before._id) : [];
      if (before?.status === "CREATED") {
        if (
          quantityToMinor(args.totalQuantity!, product.unit) !==
          quantityToMinor(before.totalQuantity!, product.unit)
        )
          return failure("BATCH_TOTAL_LOCKED");
        if (!(await editableUnits(ctx, oldUnits)))
          return failure("BATCH_NOT_EDITABLE");
      }
      const revision = (before?.revision ?? 0) + 1;
      const fields = {
        warehouseId: args.warehouseId,
        productId: args.productId,
        revision,
        status: commit ? ("CREATED" as const) : ("DRAFT" as const),
        totalQuantity: args.totalQuantity,
        storageFormat: args.storageFormat,
        simplePacking: args.simplePacking,
        sameSize: args.sameSize,
        lot: args.lot?.trim(),
        splitMode: args.splitMode,
        capacity: args.capacity,
        unitCount: args.unitCount,
        packages: args.packages,
        ...stamp(ctx),
      };
      const batchId = before
        ? before._id
        : ((await ctx.tenantDb.insert("finishedGoodsBatches", {
            ...compact(fields),
            ...created(ctx),
          })) as Id<"finishedGoodsBatches">);
      if (before)
        await ctx.tenantDb.patch("finishedGoodsBatches", batchId, fields);
      const palletIds: Id<"finishedGoodsPallets">[] = [];
      if (commit) {
        for (const unit of oldUnits)
          await ctx.tenantDb.patch("finishedGoodsPallets", unit._id, {
            retiredAt: Date.now(),
            retirementReason: `Replaced by preparation batch revision ${revision}`,
            ...stamp(ctx),
          });
        for (const row of args.packages) {
          const palletId = await ctx.tenantDb.insert("finishedGoodsPallets", {
            warehouseId: args.warehouseId,
            productId: args.productId,
            preparationBatchId: batchId,
            batchRevision: revision,
            storageFormat: args.storageFormat,
            code: await nextCode(ctx, args.warehouseId, "pallet"),
            quantity: row.quantity!,
            ...compact({
              lengthMm: row.lengthMm,
              widthMm: row.widthMm,
              heightMm: row.heightMm,
              weightKg: row.weightKg,
              lot: args.lot?.trim(),
              sameSize: args.sameSize,
              fillPercent: row.fillPercent,
            }),
            status: "AWAITING_PLACEMENT",
            ...created(ctx),
          });
          palletIds.push(palletId as Id<"finishedGoodsPallets">);
        }
      }
      const receipt = await ctx.tenantDb.insert("finishedGoodsBatchRevisions", {
        ...compact(fields),
        ...created(ctx),
        batchId,
        requestId: args.requestId,
        palletIds,
      });
      return { documentId: receipt };
    },
  );
  if (!result.written) return result;
  const receipt = await ctx.tenantDb.get<Doc<"finishedGoodsBatchRevisions">>(
    "finishedGoodsBatchRevisions",
    result.documentId,
  );
  if (!receipt) return failure("REPLAY_RESULT_UNVERIFIABLE");
  return {
    ...result,
    documentId: receipt.batchId,
    batchId: receipt.batchId,
    revision: receipt.revision,
    palletIds: receipt.palletIds,
  };
}
export const saveBatchDraft = mutationWithOrg({
  args: writeFields,
  returns: v.any(),
  permissionCode: MANAGE,
  target: { table: "finishedGoodsBatches" },
  warehouseId: (a) => a.warehouseId,
  handler: (ctx, args) => save(ctx, args, false),
});
export const commitBatch = mutationWithOrg({
  args: writeFields,
  returns: v.any(),
  permissionCode: MANAGE,
  target: { table: "finishedGoodsBatches" },
  warehouseId: (a) => a.warehouseId,
  handler: (ctx, args) => save(ctx, args, true),
});
export const getBatch = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    batchId: v.id("finishedGoodsBatches"),
  },
  returns: v.any(),
  permissionCode: READ,
  target: { table: "finishedGoodsBatches" },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) => {
    const batch = await batchOf(ctx, args.warehouseId, args.batchId);
    if (!batch) return null;
    const product = await productOf(ctx, batch);
    if (!product) return null;
    return { ...(await detail(ctx, batch)), product };
  },
});
export const listProductBatches = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    productId: v.id("finishedGoodsProducts"),
  },
  returns: v.any(),
  permissionCode: READ,
  target: { table: "finishedGoodsBatches" },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) => {
    if (!(await productOf(ctx, args))) return { batches: [], legacyUnits: [] };
    const batches = await rows<Doc<"finishedGoodsBatches">>(
      ctx,
      "finishedGoodsBatches",
      "by_orgId_productId",
      [{ field: "productId", value: args.productId }],
    );
    const units = await rows<Doc<"finishedGoodsPallets">>(
      ctx,
      "finishedGoodsPallets",
      "by_orgId_productId",
      [{ field: "productId", value: args.productId }],
    );
    return {
      batches: await Promise.all(
        batches
          .filter((b) => b.warehouseId === args.warehouseId)
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((b) => detail(ctx, b)),
      ),
      legacyUnits: await Promise.all(
        units
          .filter(
            (p) =>
              p.warehouseId === args.warehouseId &&
              !p.preparationBatchId &&
              !p.retiredAt,
          )
          .map((unit) => withMove(ctx, unit)),
      ),
    };
  },
});
export const cancelLegacyUnit = mutationWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    palletId: v.id("finishedGoodsPallets"),
    reason: v.string(),
    expectedUpdatedAt: v.number(),
    requestId: v.string(),
  },
  returns: v.any(),
  permissionCode: MANAGE,
  target: { table: "finishedGoodsPallets" },
  warehouseId: (a) => a.warehouseId,
  handler: (ctx, args) =>
    command(
      ctx,
      args,
      "finishedGoods.legacy.cancel",
      "finishedGoodsPallets",
      async () => {
        const unit = await palletOf(ctx, args);
        if (!unit) return failure("NOT_FOUND");
        if (unit.preparationBatchId) return failure("LEGACY_UNIT_REQUIRED");
        if (unit.updatedAt !== args.expectedUpdatedAt)
          return failure("STALE_REVISION");
        if (!args.reason.trim() || args.reason.length > 2000)
          return failure("REASON_REQUIRED");
        if (!(await editableUnits(ctx, [unit])))
          return failure("BATCH_NOT_EDITABLE");
        await ctx.tenantDb.patch("finishedGoodsPallets", unit._id, {
          retiredAt: Date.now(),
          retirementReason: args.reason.trim(),
          ...stamp(ctx),
        });
        return { documentId: unit._id };
      },
    ),
});

/** Catalogue pages intentionally omit unit detail and revision history. */
export const pageProductBatches = queryWithOrg({
  args: { ...cataloguePageArgs, productId: v.id("finishedGoodsProducts") },
  returns: v.any(),
  permissionCode: READ,
  target: { table: "finishedGoodsBatches" },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) => {
    const generation =
      (await summaryReadiness(ctx.tenantDb, args.warehouseId))?.generation ?? 0;
    return paginatedScan(ctx, {
      scope: ["batches", args.warehouseId, args.productId],
      generation,
      pageSize: args.pageSize,
      cursor: args.cursor,
      scanCursor: args.scanCursor,
      read: (cursor, endCursor) =>
        ctx.tenantDb
          .byIndex<Doc<"finishedGoodsBatches">>(
            "finishedGoodsBatches",
            "by_orgId_warehouseId_productId_updatedAt",
            [
              { field: "warehouseId", value: args.warehouseId },
              { field: "productId", value: args.productId },
            ],
          )
          .page({
            limit: remainingScanCapacity(args.scanCursor, args.pageSize),
            cursor,
            endCursor,
            order: "desc",
          }),
      get: async (id) => {
        const row = await batchOf(ctx, args.warehouseId, id);
        return row?.productId === args.productId ? row : null;
      },
      hydrate: async (batch) => {
        const { packages, ...header } = batch;
        return {
          _id: batch._id,
          batch: header,
          unitCount: batch.status === "CREATED" ? packages.length : 0,
        };
      },
      matches: () => true,
    });
  },
});
export const pageLegacyUnits = queryWithOrg({
  args: { ...cataloguePageArgs, productId: v.id("finishedGoodsProducts") },
  returns: v.any(),
  permissionCode: READ,
  target: { table: "finishedGoodsPallets" },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) => {
    const generation =
      (await summaryReadiness(ctx.tenantDb, args.warehouseId))?.generation ?? 0;
    return paginatedScan(ctx, {
      scope: ["legacy-units", args.warehouseId, args.productId],
      generation,
      pageSize: args.pageSize,
      cursor: args.cursor,
      scanCursor: args.scanCursor,
      read: (cursor, endCursor) =>
        ctx.tenantDb
          .byIndex<Doc<"finishedGoodsPallets">>(
            "finishedGoodsPallets",
            "by_orgId_warehouseId_productId_updatedAt",
            [
              { field: "warehouseId", value: args.warehouseId },
              { field: "productId", value: args.productId },
            ],
          )
          .page({
            limit: remainingScanCapacity(args.scanCursor, args.pageSize),
            cursor,
            endCursor,
            order: "desc",
          }),
      get: async (id) => {
        const row = await palletOf(ctx, {
          warehouseId: args.warehouseId,
          palletId: id,
        });
        return row?.productId === args.productId ? row : null;
      },
      hydrate: (unit) => hydrateUnit(ctx, unit),
      matches: (unit) =>
        !unit.preparationBatchId && unit.retiredAt === undefined,
    });
  },
});
export const resolveUnitBatch = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    productId: v.id("finishedGoodsProducts"),
    palletId: v.id("finishedGoodsPallets"),
  },
  returns: v.any(),
  permissionCode: READ,
  target: { table: "finishedGoodsPallets" },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) => {
    const unit = await palletOf(ctx, args);
    if (!unit || unit.productId !== args.productId) return null;
    const batch = unit.preparationBatchId
      ? await batchOf(ctx, args.warehouseId, unit.preparationBatchId)
      : null;
    if (
      unit.preparationBatchId &&
      (!batch || batch.productId !== args.productId)
    )
      return null;
    return {
      batchId: batch?._id ?? null,
      editable: await editableUnits(ctx, [unit]),
      unit: await hydrateUnit(ctx, unit),
    };
  },
});
