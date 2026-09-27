import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

export const JOB_SCAN_DEMO_CONFIRMATION = "LOCAL_JOB_SCAN_FIXTURES_V1";

const TICKETS = [
  [
    "FO69070073",
    "FBN-BXVMI004-BOX-00F",
    "VMI BOX TRAY BXVMI004 Rev.02",
    "บริษัท ฟาบริเนท จำกัด (สำนักงานใหญ่)",
    1000,
  ],
  [
    "FO69070073",
    "FBN-BXVMI004-BOX-00F",
    "VMI BOX TRAY BXVMI004 Rev.02",
    "บริษัท ฟาบริเนท จำกัด (สำนักงานใหญ่)",
    1000,
  ],
  [
    "FO69070081",
    "FBN-CTN-A4-220-01A",
    "CARTON A4 220x310 Rev.01",
    "บริษัท ฟาบริเนท จำกัด (สำนักงานใหญ่)",
    500,
  ],
  [
    "FO69070102",
    "TG-DIV-5x8-003",
    "DIVIDER 5x8 SLOT",
    "บริษัท สยามพาร์ท จำกัด",
    2400,
  ],
  [
    "FO69070115",
    "TG-PAD-1200-010",
    "LAYER PAD 1200x1000",
    "บริษัท สยามพาร์ท จำกัด",
    300,
  ],
  [
    "FO69070120",
    "FBN-BXVMI006-BOX-00B",
    "VMI BOX TRAY BXVMI006 Rev.01",
    "บริษัท ฟาบริเนท จำกัด (สำนักงานใหญ่)",
    800,
  ],
] as const;
const UNMAPPED_TEXT = [
  "หน้าประตู 3 ฝั่งซ้าย",
  "Dock B overflow",
  "ข้างเสา C12",
];

/** Local-only sample job scans: half mapped to real zones, half free-text unmapped. */
export const seed = internalMutation({
  args: {
    warehouseId: v.id("warehouses"),
    actorUserId: v.id("users"),
    confirmation: v.string(),
  },
  handler: async (ctx, args) => {
    if (
      args.confirmation !== JOB_SCAN_DEMO_CONFIRMATION ||
      process.env.ALLOW_LOCAL_TEST_SEED !== "true"
    )
      throw new Error("Local job scan seed is disabled");
    const warehouse = await ctx.db.get(args.warehouseId);
    if (!warehouse) throw new Error("Seed warehouse not found");
    const orgId = warehouse.orgId;
    const existing = await ctx.db
      .query("finishedGoodsJobScans")
      .withIndex("by_orgId_warehouseId_createdAt", (q) =>
        q.eq("orgId", orgId).eq("warehouseId", args.warehouseId),
      )
      .first();
    if (existing) return { inserted: 0 };
    const zones = (
      await ctx.db
        .query("storageZones")
        .withIndex("by_orgId_warehouseId_code", (q) =>
          q.eq("orgId", orgId).eq("warehouseId", args.warehouseId),
        )
        .take(50)
    ).filter((zone) => zone.status === "ACTIVE");
    const now = Date.now();
    let inserted = 0;
    for (const [
      index,
      [factoryOrder, productBarcodeText, partName, customer, quantity],
    ] of TICKETS.entries()) {
      const zone =
        index % 2 === 0 ? zones[index % Math.max(zones.length, 1)] : undefined;
      const at = now - (TICKETS.length - index) * 15 * 60_000;
      await ctx.db.insert("finishedGoodsJobScans", {
        orgId,
        warehouseId: args.warehouseId,
        factoryOrder,
        productBarcodeText,
        partName,
        customer,
        deliveryDate: "6/7/2569",
        manufacturingDate: "27/7/2569",
        quantity,
        factoryQuantity: quantity,
        customerQuantity: quantity,
        source: index % 3 === 0 ? "AI" : index % 3 === 1 ? "BARCODE" : "MANUAL",
        ...(zone
          ? {
              mapped: true,
              locationText: zone.code,
              zoneId: zone._id,
              locationCode: zone.code,
              locationName: zone.label,
            }
          : {
              mapped: false,
              locationText: UNMAPPED_TEXT[index % UNMAPPED_TEXT.length]!,
            }),
        createdAt: at,
        createdByUserId: args.actorUserId,
        updatedAt: at,
        updatedByUserId: args.actorUserId,
      });
      inserted++;
    }
    return { inserted };
  },
});
