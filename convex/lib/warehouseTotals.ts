import type { Doc } from "../_generated/dataModel";
import type { TenantDocumentAccess } from "./tenantDb";

/**
 * Exact warehouse catalogue totals, sharded by product: the sum of every
 * product summary's counters, the product count and unit-label reference
 * counts. Product-summary deltas and product writes keep it exact in their own
 * transaction; a single-transaction backfill builds it; the catalogue summary
 * reads it only while the readiness row says it is current.
 */
export const WAREHOUSE_TOTALS_VERSION = 1;
export const WAREHOUSE_TOTALS_SHARDS = 8;
/** Larger catalogues keep the paged summary scan (one backfill transaction). */
export const MAX_TOTALS_BACKFILL_PRODUCTS = 2_000;

export const TOTAL_FIELDS = [
  "awaitingMeasurement",
  "awaitingStorage",
  "stored",
  "moving",
] as const;
type TotalField = (typeof TOTAL_FIELDS)[number];
type Shard = Doc<"finishedGoodsWarehouseTotals">;
export type TotalsDelta = Partial<Record<TotalField | "products", number>> & {
  units?: Record<string, number>;
};

/** Same product, same shard: totals add no conflicts beyond its summary row. */
export function totalsShard(productId: string) {
  let hash = 0;
  for (const char of productId) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % WAREHOUSE_TOTALS_SHARDS;
}

const emptyShard = (warehouseId: string, shard: number) => ({
  warehouseId,
  shard,
  products: 0,
  awaitingMeasurement: 0,
  awaitingStorage: 0,
  stored: 0,
  moving: 0,
  units: [] as { unit: string; count: number }[],
});

async function shardRow(
  db: TenantDocumentAccess,
  warehouseId: string,
  shard: number,
) {
  return db
    .byIndex<Shard>(
      "finishedGoodsWarehouseTotals",
      "by_orgId_warehouseId_shard",
      [
        { field: "warehouseId", value: warehouseId },
        { field: "shard", value: shard },
      ],
    )
    .unique();
}

function applied(
  base: ReturnType<typeof emptyShard>,
  delta: TotalsDelta,
): ReturnType<typeof emptyShard> {
  // Copy only the counter fields: a stored row also carries system fields.
  const next = {
    warehouseId: base.warehouseId,
    shard: base.shard,
    products: base.products,
    awaitingMeasurement: base.awaitingMeasurement,
    awaitingStorage: base.awaitingStorage,
    stored: base.stored,
    moving: base.moving,
    units: base.units.map((u) => ({ unit: u.unit, count: u.count })),
  };
  next.products += delta.products ?? 0;
  for (const field of TOTAL_FIELDS) next[field] += delta[field] ?? 0;
  for (const [unit, change] of Object.entries(delta.units ?? {})) {
    const row = next.units.find((u) => u.unit === unit);
    if (row) row.count += change;
    else next.units.push({ unit, count: change });
  }
  next.units = next.units.filter((u) => u.count !== 0);
  return next;
}

/** Apply one product's delta. Rows exist before readiness; readers ignore them until then. */
export async function adjustWarehouseTotals(
  db: TenantDocumentAccess,
  warehouseId: string,
  productId: string,
  delta: TotalsDelta,
) {
  const shard = totalsShard(productId);
  const row = await shardRow(db, warehouseId, shard);
  const sum = applied(row ?? emptyShard(warehouseId, shard), delta);
  const next = {
    products: sum.products,
    awaitingMeasurement: sum.awaitingMeasurement,
    awaitingStorage: sum.awaitingStorage,
    stored: sum.stored,
    moving: sum.moving,
    units: sum.units,
  };
  if (row) await db.patch("finishedGoodsWarehouseTotals", row._id, next);
  else
    await db.insert("finishedGoodsWarehouseTotals", {
      warehouseId,
      shard,
      ...next,
    });
}

/** Summed totals, or null when they are not current for this warehouse. */
export async function readWarehouseTotals(
  db: TenantDocumentAccess,
  readiness: Doc<"finishedGoodsSummaryReadiness">,
) {
  if (
    !readiness.ready ||
    readiness.totalsVersion !== WAREHOUSE_TOTALS_VERSION ||
    // Writes by code that does not maintain totals move the legacy generation.
    readiness.totalsGeneration !== (readiness.generation ?? 0)
  )
    return null;
  const shards = await db
    .byIndex<Shard>(
      "finishedGoodsWarehouseTotals",
      "by_orgId_warehouseId_shard",
      [{ field: "warehouseId", value: readiness.warehouseId }],
    )
    .all(WAREHOUSE_TOTALS_SHARDS);
  const total = shards.reduce(
    (sum, shard) =>
      applied(sum, {
        ...shard,
        units: Object.fromEntries(shard.units.map((u) => [u.unit, u.count])),
      }),
    emptyShard(readiness.warehouseId, 0),
  );
  return {
    products: total.products,
    awaitingMeasurement: total.awaitingMeasurement,
    awaitingStorage: total.awaitingStorage,
    stored: total.stored,
    moving: total.moving,
    units: total.units
      .filter((u) => u.count > 0)
      .map((u) => u.unit)
      .sort(),
  };
}
