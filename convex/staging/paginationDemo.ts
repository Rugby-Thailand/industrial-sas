import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

export const PAGINATION_CONFIRMATION = "LOCAL_PAGINATION_FIXTURES_V1";
const prefix = "PAGINATION-";
const code = (index: number) => `${prefix}${String(index).padStart(4, "0")}`;
function guard(confirmation: string) {
  if (
    confirmation !== PAGINATION_CONFIRMATION ||
    process.env.ALLOW_LOCAL_TEST_SEED !== "true"
  )
    throw new Error("Local pagination seed is disabled");
  const url = process.env.CONVEX_CLOUD_URL ?? process.env.CONVEX_URL ?? "";
  if (url && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(url))
    throw new Error("Pagination seed requires a loopback deployment");
}
/** Small idempotent chunks; this endpoint is never exposed to a browser client. */
export const seed = internalMutation({
  args: {
    warehouseId: v.id("warehouses"),
    actorUserId: v.id("users"),
    confirmation: v.string(),
    kind: v.union(
      v.literal("products"),
      v.literal("buildings"),
      v.literal("units"),
      v.literal("batches"),
    ),
    start: v.number(),
    count: v.number(),
  },
  handler: async (ctx, args) => {
    guard(args.confirmation);
    if (
      !Number.isInteger(args.start) ||
      args.start < 0 ||
      !Number.isInteger(args.count) ||
      args.count < 1 ||
      args.count > 25
    )
      throw new Error("Seed chunks must contain 1–25 records");
    const maximum = args.kind === "units" ? 360 : 121;
    if (args.start + args.count > maximum)
      throw new Error("Seed range exceeds the pagination profile");
    const warehouse = await ctx.db.get(args.warehouseId);
    const actor = await ctx.db.get(args.actorUserId);
    if (!warehouse || !actor)
      throw new Error("Seed warehouse or actor not found");
    const orgId = warehouse.orgId;
    const shared = { orgId, warehouseId: args.warehouseId };
    const audit = {
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      createdByUserId: args.actorUserId,
      updatedByUserId: args.actorUserId,
    };
    const readiness = await ctx.db
      .query("finishedGoodsSummaryReadiness")
      .withIndex("by_orgId_warehouseId", (q) =>
        q.eq("orgId", orgId).eq("warehouseId", args.warehouseId),
      )
      .unique();
    if (readiness)
      await ctx.db.patch(readiness._id, {
        ready: false,
        cursor: undefined,
        generation: (readiness.generation ?? 0) + 1,
      });
    let created = 0;
    for (let i = args.start; i < args.start + args.count; i++) {
      const idCode = code(i);
      if (args.kind === "products") {
        const found = await ctx.db
          .query("finishedGoodsProducts")
          .withIndex("by_orgId_warehouseId_sku", (q) =>
            q
              .eq("orgId", orgId)
              .eq("warehouseId", args.warehouseId)
              .eq("sku", idCode),
          )
          .unique();
        if (found) continue;
        await ctx.db.insert("finishedGoodsProducts", {
          ...shared,
          ...audit,
          sku: idCode,
          name:
            i === 120
              ? "สินค้าปลายทาง Needle Thai"
              : "Pagination product " + String(i),
          unit: i % 2 ? "PCS" : "KG",
          storageFormat: i % 2 ? "BOX" : "PALLET",
          storageCondition: "ANY",
          status: i % 3 ? "ACTIVE" : "DRAFT",
        });
        created++;
      } else if (args.kind === "buildings") {
        const found = await ctx.db
          .query("storageBuildings")
          .withIndex("by_orgId_warehouseId_code", (q) =>
            q
              .eq("orgId", orgId)
              .eq("warehouseId", args.warehouseId)
              .eq("code", idCode),
          )
          .unique();
        if (found) continue;
        const buildingId = await ctx.db.insert("storageBuildings", {
          ...shared,
          ...audit,
          code: idCode,
          name:
            i === 120 ? "อาคารปลายทาง Needle Thai" : `Pagination building ${i}`,
          widthMm: 10000,
          depthMm: 10000,
          defaultFloorHeightMm: 4000,
          floorCount: 1,
          totalHeightMm: 4000,
          grossAreaSqMm: 100_000_000,
          reservedAreaSqMm: 0,
          usableAreaSqMm: 100_000_000,
          status: i % 3 ? "ACTIVE" : "DRAFT",
          version: 1,
        });
        const floorId = await ctx.db.insert("storageFloors", {
          ...shared,
          buildingId,
          floorNumber: 1,
          widthMm: 10000,
          depthMm: 10000,
          heightMm: 4000,
          grossAreaSqMm: 100_000_000,
          reservedAreaSqMm: 0,
          usableAreaSqMm: 100_000_000,
          version: 1,
          updatedAt: audit.updatedAt,
          updatedByUserId: args.actorUserId,
        });
        for (let z = 0; z < 3; z++) {
          const zoneCode = `${idCode}-Z${z + 1}`;
          const locationId = await ctx.db.insert("locations", {
            ...shared,
            code: zoneCode,
            locationType: "FLOOR_BLOCK",
            status: "ACTIVE",
          });
          await ctx.db.insert("storageZones", {
            ...shared,
            ...audit,
            buildingId,
            floorId,
            locationId,
            code: zoneCode,
            label:
              i === 120 && z === 2
                ? "จุดจัดเก็บปลายทาง Needle Thai"
                : `Pagination spot ${i}-${z + 1}`,
            qrValue: `LOCAL:${zoneCode}`,
            mode: "SIMPLE",
            xMm: z * 3000,
            yMm: 0,
            widthMm: 2000,
            depthMm: 2000,
            maxStackHeightMm: 3000,
            status: "ACTIVE",
          });
        }
        created++;
      } else {
        const product = await ctx.db
          .query("finishedGoodsProducts")
          .withIndex("by_orgId_warehouseId_sku", (q) =>
            q
              .eq("orgId", orgId)
              .eq("warehouseId", args.warehouseId)
              .eq("sku", code(args.kind === "batches" ? 0 : i % 121)),
          )
          .unique();
        if (!product) throw new Error("Seed products first");
        if (args.kind === "units") {
          const found = await ctx.db
            .query("finishedGoodsPallets")
            .withIndex("by_orgId_warehouseId_code", (q) =>
              q
                .eq("orgId", orgId)
                .eq("warehouseId", args.warehouseId)
                .eq("code", idCode),
            )
            .unique();
          if (found) continue;
          await ctx.db.insert("finishedGoodsPallets", {
            ...shared,
            ...audit,
            productId: product._id,
            code: idCode,
            quantity: (1001 + (i % 5) * 1000) / 1000,
            lot: i === 359 ? "ปลายทาง-LOT-NEEDLE" : `PAGINATION-LOT-${i % 7}`,
            storageFormat: i % 2 ? "BOX" : "PALLET",
            status: i % 2 ? "AWAITING_PLACEMENT" : "AWAITING_MEASUREMENT",
            ...(i % 2 ? { lengthMm: 1000, widthMm: 800, heightMm: 1200 } : {}),
          });
        } else {
          const found = await ctx.db
            .query("finishedGoodsBatches")
            .withIndex("by_orgId_productId", (q) =>
              q.eq("orgId", orgId).eq("productId", product._id),
            )
            .filter((q) => q.eq(q.field("lot"), idCode))
            .first();
          if (found) continue;
          await ctx.db.insert("finishedGoodsBatches", {
            ...shared,
            ...audit,
            productId: product._id,
            revision: 1,
            status: "DRAFT",
            storageFormat: "PALLET",
            lot: idCode,
            packages: [],
          });
        }
        created++;
      }
    }
    return { created, processed: args.count };
  },
});
