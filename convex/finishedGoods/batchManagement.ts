import { v } from "convex/values";
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
} from "../model/finishedGoods/packing";
import {
  command,
  compact,
  created,
  failure,
  nextCode,
  productOf,
  rows,
  stamp,
} from "./workflow";

const scope = {
  warehouseId: v.id("warehouses"),
  batchId: v.id("finishedGoodsBatches"),
};
async function activeUnits(
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
/** A physical hold takes precedence over the convenience unit status. */
async function unitState(
  ctx: TenantFunctionContext,
  unit: Doc<"finishedGoodsPallets">,
) {
  const [placements, children, moves] = await Promise.all([
    rows<Doc<"finishedGoodsPlacements">>(
      ctx,
      "finishedGoodsPlacements",
      "by_orgId_palletId",
      [{ field: "palletId", value: unit._id }],
    ),
    rows<Doc<"finishedGoodsPlacements">>(
      ctx,
      "finishedGoodsPlacements",
      "by_orgId_supportPalletId",
      [{ field: "supportPalletId", value: unit._id }],
    ),
    rows<Doc<"finishedGoodsMoves">>(
      ctx,
      "finishedGoodsMoves",
      "by_orgId_palletId",
      [{ field: "palletId", value: unit._id }],
    ),
  ]);
  const move = moves.find(
    (m) => m.status === "RESERVED" || m.status === "IN_TRANSIT",
  );
  const reason = children.some((p) => p.status !== "RELEASED")
    ? "SUPPORTING"
    : move
      ? "MOVING"
      : unit.status === "STORED"
        ? "STORED"
        : unit.status === "RESERVED" ||
            placements.some((p) => p.status !== "RELEASED")
          ? "RESERVED"
          : null;
  return {
    ...unit,
    editable: reason === null,
    lockReason: reason,
    ...(move ? { moveStatus: move.status } : {}),
  };
}
export const get = queryWithOrg({
  args: scope,
  returns: v.any(),
  permissionCode: "masterData.storageLayout.read",
  target: { table: "finishedGoodsBatches" },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) => {
    const batch = await ctx.tenantDb.get<Doc<"finishedGoodsBatches">>(
      "finishedGoodsBatches",
      args.batchId,
    );
    if (!batch || batch.warehouseId !== args.warehouseId) return null;
    const product = await productOf(ctx, batch);
    if (!product) return null;
    const units = await Promise.all(
      (await activeUnits(ctx, batch._id)).map((p) => unitState(ctx, p)),
    );
    return { batch, product, units };
  },
});
export const repackAvailable = mutationWithOrg({
  args: {
    ...scope,
    requestId: v.string(),
    expectedRevision: v.number(),
    unitIds: v.array(v.id("finishedGoodsPallets")),
    packages: v.array(
      v.object({
        quantity: v.number(),
        lengthMm: v.number(),
        widthMm: v.number(),
        heightMm: v.number(),
        weightKg: v.optional(v.number()),
        dimensionsChecked: v.boolean(),
      }),
    ),
  },
  returns: v.any(),
  permissionCode: "masterData.storageLayout.manage",
  target: { table: "finishedGoodsBatches" },
  warehouseId: (a) => a.warehouseId,
  handler: async (ctx, args) =>
    command(
      ctx,
      args,
      "finishedGoods.batch.repackAvailable",
      "finishedGoodsBatchRevisions",
      async () => {
        const batch = await ctx.tenantDb.get<Doc<"finishedGoodsBatches">>(
          "finishedGoodsBatches",
          args.batchId,
        );
        if (!batch || batch.warehouseId !== args.warehouseId)
          return failure("NOT_FOUND");
        if (
          batch.status !== "CREATED" ||
          batch.revision !== args.expectedRevision
        )
          return failure("STALE_REVISION");
        const product = await productOf(ctx, batch);
        if (!product) return failure("NOT_FOUND");
        if (product.status !== "ACTIVE") return failure("PRODUCT_DRAFT");
        const units = await activeUnits(ctx, batch._id);
        const chosen = new Set(args.unitIds);
        if (!chosen.size || chosen.size !== args.unitIds.length)
          return failure("FIELD_INVALID");
        const replacing = units.filter((p) => chosen.has(p._id));
        if (replacing.length !== chosen.size) return failure("STALE_REVISION");
        for (const unit of replacing)
          if (!(await unitState(ctx, unit)).editable)
            return failure("BATCH_NOT_EDITABLE");
        const retained = units.filter((p) => !chosen.has(p._id));
        if (retained.length + args.packages.length > MAX_FG_PACKAGES)
          return failure("PACKAGE_COUNT_INVALID");
        const selectedMinor = replacing.reduce(
          (sum, p) => sum + (quantityToMinor(p.quantity, product.unit) ?? NaN),
          0,
        );
        const invalid = validatePacking(
          selectedMinor / 1000,
          args.packages,
          product.unit,
        );
        if (invalid) return failure(invalid);
        const fullMinor = units.reduce(
          (sum, p) => sum + (quantityToMinor(p.quantity, product.unit) ?? NaN),
          0,
        );
        if (
          fullMinor !==
          quantityToMinor(batch.totalQuantity ?? NaN, product.unit)
        )
          return failure("BATCH_TOTAL_LOCKED");
        const revision = batch.revision + 1;
        const newIds: Id<"finishedGoodsPallets">[] = [];
        for (const unit of replacing)
          await ctx.tenantDb.patch("finishedGoodsPallets", unit._id, {
            retiredAt: Date.now(),
            retirementReason: `Replaced by preparation batch revision ${revision}`,
            ...stamp(ctx),
          });
        for (const row of args.packages) {
          const id = await ctx.tenantDb.insert("finishedGoodsPallets", {
            warehouseId: batch.warehouseId,
            productId: batch.productId,
            preparationBatchId: batch._id,
            batchRevision: revision,
            storageFormat: batch.storageFormat,
            code: await nextCode(ctx, batch.warehouseId, "pallet"),
            quantity: row.quantity,
            lengthMm: row.lengthMm,
            widthMm: row.widthMm,
            heightMm: row.heightMm,
            ...compact({ weightKg: row.weightKg, lot: batch.lot }),
            status: "AWAITING_PLACEMENT",
            ...created(ctx),
          });
          newIds.push(id as Id<"finishedGoodsPallets">);
        }
        // Receipt is a complete snapshot of this revision, including unchanged physical units.
        const packages = [
          ...retained.map((p) => ({
            ...compact({
              quantity: p.quantity,
              lengthMm: p.lengthMm,
              widthMm: p.widthMm,
              heightMm: p.heightMm,
              weightKg: p.weightKg,
            }),
            dimensionsChecked: Boolean(p.lengthMm && p.widthMm && p.heightMm),
          })),
          ...args.packages,
        ];
        const fields = {
          warehouseId: batch.warehouseId,
          productId: batch.productId,
          revision,
          status: "CREATED" as const,
          totalQuantity: batch.totalQuantity,
          storageFormat: batch.storageFormat,
          lot: batch.lot,
          splitMode: "MANUAL" as const,
          packages,
          ...stamp(ctx),
        };
        await ctx.tenantDb.patch("finishedGoodsBatches", batch._id, {
          ...fields,
          capacity: undefined,
          unitCount: undefined,
        });
        const receipt = await ctx.tenantDb.insert(
          "finishedGoodsBatchRevisions",
          {
            ...compact(fields),
            ...created(ctx),
            batchId: batch._id,
            requestId: args.requestId,
            palletIds: [...retained.map((p) => p._id), ...newIds],
          },
        );
        return { documentId: receipt };
      },
    ),
});
