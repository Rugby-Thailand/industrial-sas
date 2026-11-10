/**
 * Warehouse-scoped finished-goods record reads shared by the command
 * modules: unit/product lookups that refuse another warehouse's or a retired
 * unit, the code counter, and active hold/move presence checks.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { TenantIndexEquality, TenantOwnedDocument } from "../lib/tenantDb";
import type { TenantFunctionContext } from "../lib/tenantFunctions";
import type { TenantTableName } from "../lib/schemaPolicy";

export async function rows<T extends TenantOwnedDocument>(
  ctx: TenantFunctionContext,
  table: TenantTableName,
  index: string,
  equality: TenantIndexEquality,
): Promise<T[]> {
  return [
    ...(await ctx.tenantDb.byIndex<T>(table, index, equality).all(10_000)),
  ];
}
export async function palletOf(
  ctx: TenantFunctionContext,
  args: { warehouseId: string; palletId: string },
) {
  const pallet = await ctx.tenantDb.get<Doc<"finishedGoodsPallets">>(
    "finishedGoodsPallets",
    args.palletId,
  );
  return pallet?.warehouseId === args.warehouseId && !pallet.retiredAt
    ? pallet
    : null;
}
export async function productOf(
  ctx: TenantFunctionContext,
  args: { warehouseId: string; productId: string },
) {
  const product = await ctx.tenantDb.get<Doc<"finishedGoodsProducts">>(
    "finishedGoodsProducts",
    args.productId,
  );
  return product?.warehouseId === args.warehouseId ? product : null;
}
export async function nextCode(
  ctx: TenantFunctionContext,
  warehouseId: Id<"warehouses">,
  kind: "pallet" | "position",
) {
  const counter = await ctx.tenantDb
    .byIndex<Doc<"finishedGoodsCounters">>(
      "finishedGoodsCounters",
      "by_orgId_warehouseId",
      [{ field: "warehouseId", value: warehouseId }],
    )
    .unique();
  const field = kind === "pallet" ? "palletSequence" : "positionSequence";
  const number = (counter?.[field] ?? 0) + 1;
  if (counter)
    await ctx.tenantDb.patch("finishedGoodsCounters", counter._id, {
      [field]: number,
    });
  else
    await ctx.tenantDb.insert("finishedGoodsCounters", {
      warehouseId,
      palletSequence: kind === "pallet" ? number : 0,
      positionSequence: kind === "position" ? number : 0,
    });
  return `${kind === "pallet" ? "P" : "POS"}-${String(number).padStart(6, "0")}`;
}
/** Presence checks exclude released history and read at most one row per status. */
export async function hasHeldPlacement(
  ctx: TenantFunctionContext,
  owner: { field: "supportPalletId" | "palletId"; value: string },
) {
  const found = await Promise.all(
    (["RESERVED", "STORED"] as const).map((status) =>
      ctx.tenantDb
        .byIndex<Doc<"finishedGoodsPlacements">>(
          "finishedGoodsPlacements",
          `by_orgId_${owner.field}_status`,
          [owner, { field: "status", value: status }],
        )
        .first(),
    ),
  );
  return found.some((row) => row !== null);
}

/** Preserve the original oldest-active selection, including RESERVED-first ties. */
export async function firstActiveMove(
  ctx: TenantFunctionContext,
  palletId: string,
) {
  const moves = await Promise.all(
    (["RESERVED", "IN_TRANSIT"] as const).map((status) =>
      ctx.tenantDb
        .byIndex<Doc<"finishedGoodsMoves">>(
          "finishedGoodsMoves",
          "by_orgId_palletId_status",
          [
            { field: "palletId", value: palletId },
            { field: "status", value: status },
          ],
        )
        .first(),
    ),
  );
  return moves
    .filter((move) => move !== null)
    .sort((a, b) => a._creationTime - b._creationTime)[0];
}
