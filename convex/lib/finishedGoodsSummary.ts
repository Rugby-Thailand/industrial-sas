import type { Doc } from "../_generated/dataModel";
import type { TenantDocumentAccess } from "./tenantDb";

const VERSION = 1;
const numericFields = [
  "count",
  "quantityMinor",
  "stored",
  "awaitingMeasurement",
  "awaitingStorage",
  "moving",
] as const;
const formats = ["PALLET", "BOX", "OTHER", "INHERITED"] as const;
const zero = () => ({
  count: 0,
  quantityMinor: 0,
  stored: 0,
  awaitingMeasurement: 0,
  awaitingStorage: 0,
  moving: 0,
  formatCounts: { PALLET: 0, BOX: 0, OTHER: 0, INHERITED: 0 },
});
type Contribution = Omit<
  Doc<"finishedGoodsUnitContributions">,
  "_id" | "_creationTime" | "orgId"
>;

async function ledger(db: TenantDocumentAccess, palletId: string) {
  return db
    .byIndex<Doc<"finishedGoodsUnitContributions">>(
      "finishedGoodsUnitContributions",
      "by_orgId_palletId",
      [{ field: "palletId", value: palletId }],
    )
    .unique();
}
async function summary(db: TenantDocumentAccess, productId: string) {
  return db
    .byIndex<Doc<"finishedGoodsProductSummaries">>(
      "finishedGoodsProductSummaries",
      "by_orgId_productId",
      [{ field: "productId", value: productId }],
    )
    .unique();
}
async function adjust(
  db: TenantDocumentAccess,
  contribution: Contribution,
  sign: 1 | -1,
) {
  const previous = await summary(db, contribution.productId);
  const values = zero();
  for (const field of numericFields)
    values[field] = (previous?.[field] ?? 0) + sign * contribution[field];
  for (const format of formats)
    values.formatCounts[format] =
      (previous?.formatCounts[format] ?? 0) +
      (format === contribution.format ? sign * contribution.count : 0);
  if (
    numericFields.some((field) => values[field] < 0) ||
    formats.some((format) => values.formatCounts[format] < 0)
  )
    throw new Error("Invalid finished goods summary delta");
  if (previous)
    await db.patch("finishedGoodsProductSummaries", previous._id, {
      ...values,
      version: VERSION,
    });
  else
    await db.insert("finishedGoodsProductSummaries", {
      ...values,
      warehouseId: contribution.warehouseId,
      productId: contribution.productId,
      version: VERSION,
    });
}

/** Idempotent reconciliation is shared by normal mutations and resumable backfill. */
export async function reconcileUnitContribution(
  db: TenantDocumentAccess,
  palletId: string,
) {
  const [previous, pallet] = await Promise.all([
    ledger(db, palletId),
    db.get<Doc<"finishedGoodsPallets">>("finishedGoodsPallets", palletId),
  ]);
  let next: Contribution | null = null;
  if (
    pallet &&
    pallet.retiredAt === undefined &&
    !["CANCELLED", "REPLACED"].includes(pallet.status)
  ) {
    const moving = await db
      .byIndex<Doc<"finishedGoodsMoves">>(
        "finishedGoodsMoves",
        "by_orgId_palletId_status",
        [
          { field: "palletId", value: palletId },
          { field: "status", value: "IN_TRANSIT" },
        ],
      )
      .first();
    next = {
      warehouseId: pallet.warehouseId,
      palletId: pallet._id,
      productId: pallet.productId,
      count: 1,
      quantityMinor: Math.round(pallet.quantity * 1000),
      format: pallet.storageFormat ?? "INHERITED",
      stored: Number(pallet.status === "STORED" && !moving),
      awaitingMeasurement: Number(pallet.status === "AWAITING_MEASUREMENT"),
      awaitingStorage: Number(
        pallet.status === "AWAITING_PLACEMENT" || pallet.status === "RESERVED",
      ),
      moving: Number(moving !== null),
    };
  }
  if (
    previous &&
    next &&
    previous.productId === next.productId &&
    previous.warehouseId === next.warehouseId &&
    previous.format === next.format &&
    numericFields.every((field) => previous[field] === next[field])
  )
    return;
  if (previous) await adjust(db, previous, -1);
  if (next) await adjust(db, next, 1);
  if (previous && next)
    await db.replace("finishedGoodsUnitContributions", previous._id, next);
  else if (previous)
    await db.delete("finishedGoodsUnitContributions", previous._id);
  else if (next) await db.insert("finishedGoodsUnitContributions", next);
}

export async function summaryReadiness(
  db: TenantDocumentAccess,
  warehouseId: string,
) {
  return db
    .byIndex<Doc<"finishedGoodsSummaryReadiness">>(
      "finishedGoodsSummaryReadiness",
      "by_orgId_warehouseId",
      [{ field: "warehouseId", value: warehouseId }],
    )
    .unique();
}
export async function readProductSummary(
  ctx: { tenantDb: TenantDocumentAccess },
  product: Doc<"finishedGoodsProducts">,
) {
  const ready = await summaryReadiness(ctx.tenantDb, product.warehouseId);
  if (!ready?.ready || ready.version !== VERSION) return null;
  const row = await summary(ctx.tenantDb, product._id);
  const values = row ?? zero();
  const formatCounts = {
    PALLET: values.formatCounts.PALLET,
    BOX: values.formatCounts.BOX,
    OTHER: values.formatCounts.OTHER,
  };
  formatCounts[product.storageFormat] += values.formatCounts.INHERITED;
  return {
    count: values.count,
    quantityMinor: values.quantityMinor,
    quantity: values.quantityMinor / 1000,
    formatCounts,
    formats: Object.entries(formatCounts)
      .filter(([, count]) => count > 0)
      .map(([format, count]) => ({ format, count })),
    stored: values.stored,
    awaitingMeasurement: values.awaitingMeasurement,
    awaitingStorage: values.awaitingStorage,
    moving: values.moving,
  };
}

export async function backfillProductSummaries(
  db: TenantDocumentAccess,
  warehouseId: string,
) {
  const state = await summaryReadiness(db, warehouseId);
  if (state?.ready && state.version === VERSION) {
    if (!state.continuationKey)
      await db.patch("finishedGoodsSummaryReadiness", state._id, {
        continuationKey: crypto.randomUUID(),
      });
    return { ready: true, isDone: true, scanned: 0 };
  }
  const result = await db
    .byIndex<Doc<"finishedGoodsPallets">>(
      "finishedGoodsPallets",
      "by_orgId_warehouseId_code",
      [{ field: "warehouseId", value: warehouseId }],
    )
    .page({
      limit: 100,
      ...(state?.version === VERSION && state.cursor
        ? { cursor: state.cursor }
        : {}),
    });
  // Sequential writes are required: units may contribute to the same product.
  for (const pallet of result.page)
    await reconcileUnitContribution(db, pallet._id);
  const fields = {
    warehouseId,
    version: VERSION,
    ready: result.isDone,
    continuationKey: state?.continuationKey ?? crypto.randomUUID(),
    ...(!result.isDone
      ? { cursor: result.continueCursor }
      : { cursor: undefined }),
  };
  if (state) await db.patch("finishedGoodsSummaryReadiness", state._id, fields);
  else await db.insert("finishedGoodsSummaryReadiness", fields);
  return {
    ready: result.isDone,
    isDone: result.isDone,
    scanned: result.page.length,
  };
}

/** Wrap source writes once and flush after the entire mutation, including moves. */
export function trackFinishedGoodsWrites(db: TenantDocumentAccess) {
  const touched = new Set<string>();
  const warehouses = new Set<string>();
  const note = async (table: string, id: string) => {
    if (table === "finishedGoodsPallets") touched.add(id);
    if (
      table === "finishedGoodsPallets" ||
      table === "finishedGoodsProducts" ||
      table === "finishedGoodsMoves" ||
      table === "storageBuildings" ||
      table === "storageFloors" ||
      table === "storageZones" ||
      table === "storagePositions"
    ) {
      const row = await db.get<
        | Doc<"finishedGoodsPallets">
        | Doc<"finishedGoodsProducts">
        | Doc<"finishedGoodsMoves">
        | Doc<"storageBuildings">
        | Doc<"storageFloors">
        | Doc<"storageZones">
        | Doc<"storagePositions">
      >(table, id);
      if (row) warehouses.add(row.warehouseId);
    }
    if (table === "finishedGoodsMoves") {
      const move = await db.get<Doc<"finishedGoodsMoves">>(
        "finishedGoodsMoves",
        id,
      );
      if (move) touched.add(move.palletId);
    }
  };
  const tracked: TenantDocumentAccess = {
    ...db,
    insert: async (table, payload) => {
      const id = await db.insert(table, payload);
      await note(table, id);
      return id;
    },
    patch: async (table, id, fields) => {
      await note(table, id);
      await db.patch(table, id, fields);
      await note(table, id);
    },
    replace: async (table, id, fields) => {
      await note(table, id);
      await db.replace(table, id, fields);
      await note(table, id);
    },
    delete: async (table, id) => {
      await note(table, id);
      await db.delete(table, id);
    },
  };
  return {
    db: tracked,
    flush: async () => {
      for (const id of touched) await reconcileUnitContribution(db, id);
      for (const warehouseId of warehouses) {
        const state = await summaryReadiness(db, warehouseId);
        if (state)
          await db.patch("finishedGoodsSummaryReadiness", state._id, {
            generation: (state.generation ?? 0) + 1,
          });
        else
          await db.insert("finishedGoodsSummaryReadiness", {
            warehouseId,
            version: VERSION,
            ready: false,
            continuationKey: crypto.randomUUID(),
            generation: 1,
          });
      }
    },
  };
}
