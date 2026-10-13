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
  hasHeldPlacement,
  firstActiveMove,
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
  // Only held placements and active moves decide the lock; released
  // placements and finished moves are history and are not read here.
  const [placements, children, move] = await Promise.all([
    hasHeldPlacement(ctx, { field: "palletId", value: unit._id }),
    hasHeldPlacement(ctx, { field: "supportPalletId", value: unit._id }),
    firstActiveMove(ctx, unit._id),
  ]);
  const reason = children
    ? "SUPPORTING"
    : move
      ? "MOVING"
      : unit.status === "STORED"
        ? "STORED"
        : unit.status === "RESERVED" || placements
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
    simplePacking: v.optional(v.boolean()),
    sameSize: v.optional(v.boolean()),
    unitIds: v.array(v.id("finishedGoodsPallets")),
    packages: v.array(
      v.object({
        quantity: v.number(),
        lengthMm: v.optional(v.number()),
        widthMm: v.optional(v.number()),
        heightMm: v.optional(v.number()),
        fillPercent: v.optional(v.number()),
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
          (args.simplePacking ?? batch.simplePacking) ? "SIMPLE" : "GEOMETRIC",
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
            ...compact({
              lengthMm: row.lengthMm,
              widthMm: row.widthMm,
              heightMm: row.heightMm,
              weightKg: row.weightKg,
              lot: batch.lot,
              sameSize: args.sameSize ?? batch.sameSize,
              fillPercent: row.fillPercent,
            }),
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
              fillPercent: p.fillPercent,
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
          simplePacking: args.simplePacking ?? batch.simplePacking,
          sameSize: args.sameSize ?? batch.sameSize,
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

/** Immutable revision receipt: retired labels map to the complete replacement group. */
export const replacementLabels = queryWithOrg({
  args: {
    warehouseId: v.id("warehouses"),
    receiptId: v.optional(v.id("finishedGoodsBatchRevisions")),
    batchId: v.optional(v.id("finishedGoodsBatches")),
    revision: v.optional(v.number()),
  },
  returns: v.any(),
  permissionCode: "masterData.storageLayout.read",
  target: { table: "finishedGoodsBatchRevisions" },
  warehouseId: (args) => args.warehouseId,
  handler: async (ctx, args) => {
    const receipt = args.receiptId
      ? await ctx.tenantDb.get<Doc<"finishedGoodsBatchRevisions">>(
          "finishedGoodsBatchRevisions",
          args.receiptId,
        )
      : args.batchId && args.revision
        ? await ctx.tenantDb
            .byIndex<Doc<"finishedGoodsBatchRevisions">>(
              "finishedGoodsBatchRevisions",
              "by_orgId_batchId_revision",
              [
                { field: "batchId", value: args.batchId },
                { field: "revision", value: args.revision },
              ],
            )
            .first()
        : null;
    if (!receipt || receipt.warehouseId !== args.warehouseId) return null;
    const previous = await ctx.tenantDb
      .byIndex<Doc<"finishedGoodsBatchRevisions">>(
        "finishedGoodsBatchRevisions",
        "by_orgId_batchId_revision",
        [
          { field: "batchId", value: receipt.batchId },
          { field: "revision", value: receipt.revision - 1 },
        ],
      )
      .first();
    const before = new Set(previous?.palletIds ?? []);
    const after = new Set(receipt.palletIds);
    const describe = async (id: string) => {
      const unit = await ctx.tenantDb.get<Doc<"finishedGoodsPallets">>(
        "finishedGoodsPallets",
        id,
      );
      return unit
        ? { id: unit._id, code: unit.code, quantity: unit.quantity }
        : null;
    };
    const retired = await Promise.all(
      [...before].filter((id) => !after.has(id)).map(describe),
    );
    const replacements = await Promise.all(
      [...after].filter((id) => !before.has(id)).map(describe),
    );
    return {
      revision: receipt.revision,
      retired: retired.filter((item) => item !== null),
      replacements: replacements.filter((item) => item !== null),
    };
  },
});
