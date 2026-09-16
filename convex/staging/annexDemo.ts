import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import { internalMutation, internalQuery } from "../_generated/server";
import { storageFootprintUsage } from "../model/storageLayout/areaUsage";

const CONFIRMATION = "SEED_DEMO_ANNEX_REALISTIC_2026_09";
const SEED_PREFIX = "DEMO-ANNEX-R26-";
const AISLE_PREFIX = "DEMO · ทางเดิน";
const PALLET_WIDTH_MM = 1_000;
const PALLET_DEPTH_MM = 1_000;
const ANNEX_BUILDING_CODE = "DEMO-ANNEX";

type PlacementStatus = "RESERVED" | "STORED";

export type AnnexPalletSeed = {
  readonly zoneCode: string;
  readonly xMm: number;
  readonly yMm: number;
  readonly status: PlacementStatus;
};

const addGrid = (
  result: AnnexPalletSeed[],
  input: {
    readonly zoneCode: string;
    readonly columns: number;
    readonly rows: number;
    readonly startXMm?: number;
    readonly startYMm?: number;
    readonly limit?: number;
    readonly reserved?: boolean;
  },
) => {
  const limit = input.limit ?? input.columns * input.rows;
  for (let index = 0; index < limit; index += 1) {
    result.push({
      zoneCode: input.zoneCode,
      xMm: (input.startXMm ?? 0) + (index % input.columns) * PALLET_WIDTH_MM,
      yMm:
        (input.startYMm ?? 0) +
        Math.floor(index / input.columns) * PALLET_DEPTH_MM,
      status: input.reserved ? "RESERVED" : "STORED",
    });
  }
};

/**
 * A 30 × 20 m, two-floor annex with fixed pedestrian aisles. The retained
 * baseline demo pallets occupy 24 m²; these 905 m² of pallet footprints bring
 * the usable 1,056 m² to 929 m² (about 88% utilised).
 */
export function annexPalletPlan(): readonly AnnexPalletSeed[] {
  const rows: AnnexPalletSeed[] = [];

  // Floor 1: four distinct working areas around receiving, dispatch and aisles.
  addGrid(rows, { zoneCode: "DEMO-ANNEX-F01-Z10", columns: 2, rows: 8 });
  addGrid(rows, { zoneCode: "DEMO-ANNEX-F01-Z11", columns: 14, rows: 8 });
  addGrid(rows, {
    zoneCode: "DEMO-ANNEX-F01-Z12",
    columns: 24,
    rows: 10,
  });
  addGrid(rows, { zoneCode: "DEMO-ANNEX-F01-Z13", columns: 6, rows: 6 });

  // Floor 2: high-turnover rack-facing area plus a bulk reserve area.
  addGrid(rows, { zoneCode: "DEMO-ANNEX-F02-Z10", columns: 18, rows: 8 });
  addGrid(rows, { zoneCode: "DEMO-ANNEX-F02-Z11", columns: 30, rows: 10 });

  // Fill some of the original demo areas while leaving their existing pallets
  // and move holds untouched.
  addGrid(rows, { zoneCode: "DEMO-ANNEX-F01-Z01", columns: 4, rows: 8 });
  addGrid(rows, {
    zoneCode: "DEMO-ANNEX-F01-Z03",
    columns: 6,
    rows: 2,
    startYMm: 1_000,
  });
  addGrid(rows, {
    zoneCode: "DEMO-ANNEX-F02-Z01",
    columns: 5,
    rows: 3,
    startYMm: 1_000,
    limit: 13,
  });

  // The dispatch area contains held pallets awaiting an outbound move.
  for (let index = rows.length - 36; index < rows.length; index += 1) {
    const row = rows[index]!;
    rows[index] = { ...row, status: "RESERVED" };
  }
  return rows;
}

const zoneSpecifications = [
  {
    code: "DEMO-ANNEX-F01-Z10",
    label: "คลังสำรอง A · สินค้าหมุนเวียนเร็ว",
    floorNumber: 1,
    xMm: 10_000,
    yMm: 0,
    widthMm: 2_000,
    depthMm: 8_000,
  },
  {
    code: "DEMO-ANNEX-F01-Z11",
    label: "คลังสำรอง B · สินค้าเต็มพาเลท",
    floorNumber: 1,
    xMm: 16_000,
    yMm: 0,
    widthMm: 14_000,
    depthMm: 8_000,
  },
  {
    code: "DEMO-ANNEX-F01-Z12",
    label: "พื้นที่จัดส่ง · เตรียมจ่ายสินค้า",
    floorNumber: 1,
    xMm: 6_000,
    yMm: 10_000,
    widthMm: 24_000,
    depthMm: 10_000,
  },
  {
    code: "DEMO-ANNEX-F01-Z13",
    label: "คลังย่อย · อะไหล่และบรรจุภัณฑ์",
    floorNumber: 1,
    xMm: 0,
    yMm: 14_000,
    widthMm: 6_000,
    depthMm: 6_000,
  },
  {
    code: "DEMO-ANNEX-F02-Z10",
    label: "ชั้นวาง A · สินค้าหมุนเวียนเร็ว",
    floorNumber: 2,
    xMm: 12_000,
    yMm: 0,
    widthMm: 18_000,
    depthMm: 8_000,
  },
  {
    code: "DEMO-ANNEX-F02-Z11",
    label: "คลังสินค้าสำเร็จรูป · ชั้น 2",
    floorNumber: 2,
    xMm: 0,
    yMm: 10_000,
    widthMm: 30_000,
    depthMm: 10_000,
  },
] as const;
const seedZoneCodes = new Set(zoneSpecifications.map((zone) => zone.code));

const aisleSpecifications = [
  {
    floorNumber: 1,
    label: `${AISLE_PREFIX}หลัก · ชั้น 1`,
    xMm: 0,
    yMm: 8_000,
    widthMm: 30_000,
    depthMm: 2_000,
  },
  {
    floorNumber: 1,
    label: `${AISLE_PREFIX}ขวาง · ชั้น 1`,
    xMm: 14_000,
    yMm: 0,
    widthMm: 2_000,
    depthMm: 8_000,
  },
  {
    floorNumber: 2,
    label: `${AISLE_PREFIX}หลัก · ชั้น 2`,
    xMm: 0,
    yMm: 8_000,
    widthMm: 30_000,
    depthMm: 2_000,
  },
  {
    floorNumber: 2,
    label: `${AISLE_PREFIX}ขวาง · ชั้น 2`,
    xMm: 10_000,
    yMm: 0,
    widthMm: 2_000,
    depthMm: 4_000,
  },
] as const;

function overlaps(
  first: { xMm: number; yMm: number; widthMm: number; depthMm: number },
  second: { xMm: number; yMm: number; widthMm: number; depthMm: number },
) {
  return (
    first.xMm < second.xMm + second.widthMm &&
    first.xMm + first.widthMm > second.xMm &&
    first.yMm < second.yMm + second.depthMm &&
    first.yMm + first.depthMm > second.yMm
  );
}

function assertConfirmation(confirmation: string) {
  if (confirmation !== CONFIRMATION) {
    throw new Error(`Refusing demo seed without confirmation ${CONFIRMATION}`);
  }
}

export const configure = internalMutation({
  args: {
    warehouseId: v.id("warehouses"),
    actorUserId: v.id("users"),
    confirmation: v.string(),
  },
  returns: v.object({ zoneCount: v.number(), usableAreaSqMm: v.number() }),
  handler: async (ctx, args) => {
    assertConfirmation(args.confirmation);
    const [warehouse, actor] = await Promise.all([
      ctx.db.get(args.warehouseId),
      ctx.db.get(args.actorUserId),
    ]);
    if (!warehouse || !actor)
      throw new Error("Demo seed target does not exist");

    const building = await ctx.db
      .query("storageBuildings")
      .withIndex("by_orgId_warehouseId_code", (query) =>
        query
          .eq("orgId", warehouse.orgId)
          .eq("warehouseId", warehouse._id)
          .eq("code", ANNEX_BUILDING_CODE),
      )
      .unique();
    if (!building)
      throw new Error("DEMO-ANNEX was not found in this warehouse");

    const floors = await ctx.db
      .query("storageFloors")
      .withIndex("by_orgId_buildingId_floorNumber", (query) =>
        query.eq("orgId", warehouse.orgId).eq("buildingId", building._id),
      )
      .take(10);
    const floorsByNumber = new Map(
      floors.map((floor) => [floor.floorNumber, floor]),
    );
    if (!floorsByNumber.has(1) || !floorsByNumber.has(2)) {
      throw new Error("DEMO-ANNEX must have floors 1 and 2");
    }

    const now = Date.now();
    const retainedBlocksByFloor = new Map<
      number,
      Doc<"storageFloorReservedBlocks">[]
    >();
    for (const floor of floors) {
      const blocks = await ctx.db
        .query("storageFloorReservedBlocks")
        .withIndex("by_orgId_floorId", (query) =>
          query.eq("orgId", warehouse.orgId).eq("floorId", floor._id),
        )
        .take(50);
      const retained = blocks.filter(
        (block) => !block.label.startsWith(AISLE_PREFIX),
      );
      retainedBlocksByFloor.set(floor.floorNumber, retained);
      for (const block of blocks.filter((block) =>
        block.label.startsWith(AISLE_PREFIX),
      )) {
        await ctx.db.delete(block._id);
      }
    }

    const existingZonesByFloor = new Map<number, Doc<"storageZones">[]>();
    for (const floor of floors) {
      const zones = await ctx.db
        .query("storageZones")
        .withIndex("by_orgId_floorId_status_code", (query) =>
          query
            .eq("orgId", warehouse.orgId)
            .eq("floorId", floor._id)
            .eq("status", "ACTIVE"),
        )
        .take(200);
      existingZonesByFloor.set(floor.floorNumber, zones);
    }

    for (const aisle of aisleSpecifications) {
      const floor = floorsByNumber.get(aisle.floorNumber)!;
      const zones = existingZonesByFloor.get(aisle.floorNumber) ?? [];
      if (zones.some((zone) => overlaps(aisle, zone))) {
        throw new Error(
          `Aisle ${aisle.label} overlaps an existing storage zone`,
        );
      }
      const retainedBlocks = retainedBlocksByFloor.get(aisle.floorNumber) ?? [];
      if (retainedBlocks.some((block) => overlaps(aisle, block))) {
        throw new Error(
          `Aisle ${aisle.label} overlaps an existing reserved block`,
        );
      }
      await ctx.db.insert("storageFloorReservedBlocks", {
        orgId: warehouse.orgId,
        buildingId: building._id,
        floorId: floor._id,
        warehouseId: warehouse._id,
        label: aisle.label,
        xMm: aisle.xMm,
        yMm: aisle.yMm,
        widthMm: aisle.widthMm,
        depthMm: aisle.depthMm,
        createdAt: now,
        updatedAt: now,
      });
    }

    for (const specification of zoneSpecifications) {
      const floor = floorsByNumber.get(specification.floorNumber)!;
      const existingZones =
        existingZonesByFloor.get(specification.floorNumber) ?? [];
      const existing = existingZones.find(
        (zone) => zone.code === specification.code,
      );
      if (
        existing &&
        (existing.xMm !== specification.xMm ||
          existing.yMm !== specification.yMm ||
          existing.widthMm !== specification.widthMm ||
          existing.depthMm !== specification.depthMm)
      ) {
        throw new Error(
          `Seed zone ${specification.code} has unexpected geometry`,
        );
      }
      if (!existing) {
        const occupied = existingZones.filter(
          (zone) =>
            !seedZoneCodes.has(
              zone.code as (typeof zoneSpecifications)[number]["code"],
            ),
        );
        if (occupied.some((zone) => overlaps(specification, zone))) {
          throw new Error(
            `Seed zone ${specification.code} overlaps existing storage`,
          );
        }
        if (
          aisleSpecifications
            .filter((aisle) => aisle.floorNumber === specification.floorNumber)
            .some((aisle) => overlaps(specification, aisle))
        ) {
          throw new Error(`Seed zone ${specification.code} overlaps an aisle`);
        }
        const location = await ctx.db
          .query("locations")
          .withIndex("by_orgId_warehouseId_code", (query) =>
            query
              .eq("orgId", warehouse.orgId)
              .eq("warehouseId", warehouse._id)
              .eq("code", specification.code),
          )
          .unique();
        const locationId =
          location?._id ??
          (await ctx.db.insert("locations", {
            orgId: warehouse.orgId,
            warehouseId: warehouse._id,
            code: specification.code,
            locationType: "FLOOR_BLOCK",
            status: "ACTIVE",
          }));
        await ctx.db.insert("storageZones", {
          orgId: warehouse.orgId,
          buildingId: building._id,
          floorId: floor._id,
          warehouseId: warehouse._id,
          locationId,
          code: specification.code,
          label: specification.label,
          qrValue: `ISAS:LOCATION:1:${locationId}`,
          mode: "FLOOR_POSITIONS",
          xMm: specification.xMm,
          yMm: specification.yMm,
          widthMm: specification.widthMm,
          depthMm: specification.depthMm,
          maxStackHeightMm: 3_000,
          storageCondition: "AMBIENT",
          status: "ACTIVE",
          createdAt: now,
          createdByUserId: actor._id,
          updatedAt: now,
          updatedByUserId: actor._id,
        });
      }
    }

    for (const product of [
      {
        sku: "DEMO-HOMECARE",
        name: "กระดาษทิชชูม้วน 12 แพ็ก",
        unit: "PACK",
      },
      {
        sku: "DEMO-SNACK",
        name: "ขนมขบเคี้ยวคละรส 24 ซอง",
        unit: "CARTON",
      },
    ] as const) {
      const existing = await ctx.db
        .query("finishedGoodsProducts")
        .withIndex("by_orgId_warehouseId_sku", (query) =>
          query
            .eq("orgId", warehouse.orgId)
            .eq("warehouseId", warehouse._id)
            .eq("sku", product.sku),
        )
        .unique();
      if (!existing) {
        await ctx.db.insert("finishedGoodsProducts", {
          orgId: warehouse.orgId,
          warehouseId: warehouse._id,
          ...product,
          storageFormat: "PALLET",
          defaultQuantity: 48,
          storageCondition: "AMBIENT",
          notes: "ข้อมูลตัวอย่างสำหรับคลัง DEMO-ANNEX",
          status: "ACTIVE",
          createdAt: now,
          createdByUserId: actor._id,
          updatedAt: now,
          updatedByUserId: actor._id,
        });
      }
    }

    let reservedAreaSqMm = 0;
    let usableAreaSqMm = 0;
    for (const floor of floors) {
      const retainedBlocks = retainedBlocksByFloor.get(floor.floorNumber) ?? [];
      const ownBlocks = aisleSpecifications.filter(
        (aisle) => aisle.floorNumber === floor.floorNumber,
      );
      const reserved = [...retainedBlocks, ...ownBlocks].reduce(
        (total, block) => total + block.widthMm * block.depthMm,
        0,
      );
      const usable = floor.grossAreaSqMm - reserved;
      if (usable <= 0)
        throw new Error(`Floor ${floor.floorNumber} has no usable area`);
      reservedAreaSqMm += reserved;
      usableAreaSqMm += usable;
      await ctx.db.patch(floor._id, {
        reservedAreaSqMm: reserved,
        usableAreaSqMm: usable,
        version: floor.version + 1,
        updatedAt: now,
        updatedByUserId: actor._id,
      });
    }
    await ctx.db.patch(building._id, {
      reservedAreaSqMm,
      usableAreaSqMm,
      version: building.version + 1,
      updatedAt: now,
      updatedByUserId: actor._id,
    });

    return { zoneCount: zoneSpecifications.length, usableAreaSqMm };
  },
});

export const seedPalletBatch = internalMutation({
  args: {
    warehouseId: v.id("warehouses"),
    actorUserId: v.id("users"),
    startIndex: v.number(),
    batchSize: v.number(),
    confirmation: v.string(),
  },
  returns: v.object({
    created: v.number(),
    reused: v.number(),
    total: v.number(),
  }),
  handler: async (ctx, args) => {
    assertConfirmation(args.confirmation);
    if (
      !Number.isInteger(args.startIndex) ||
      !Number.isInteger(args.batchSize)
    ) {
      throw new Error("Batch bounds must be integers");
    }
    if (args.batchSize < 1 || args.batchSize > 100) {
      throw new Error("Batch size must be between 1 and 100");
    }
    const [warehouse, actor] = await Promise.all([
      ctx.db.get(args.warehouseId),
      ctx.db.get(args.actorUserId),
    ]);
    if (!warehouse || !actor)
      throw new Error("Demo seed target does not exist");

    const plan = annexPalletPlan();
    const batch = plan.slice(args.startIndex, args.startIndex + args.batchSize);
    const productSkus = [
      "DEMO-CARTON",
      "DEMO-DRINK",
      "DEMO-SPARE-PARTS",
      "DEMO-HOMECARE",
      "DEMO-SNACK",
    ];
    const products = await Promise.all(
      productSkus.map(
        async (sku) =>
          await ctx.db
            .query("finishedGoodsProducts")
            .withIndex("by_orgId_warehouseId_sku", (query) =>
              query
                .eq("orgId", warehouse.orgId)
                .eq("warehouseId", warehouse._id)
                .eq("sku", sku),
            )
            .unique(),
      ),
    );
    if (products.some((product) => !product)) {
      throw new Error("Run staging/annexDemo:configure before seeding pallets");
    }
    const activeProducts = products as Doc<"finishedGoodsProducts">[];
    const building = await ctx.db
      .query("storageBuildings")
      .withIndex("by_orgId_warehouseId_code", (query) =>
        query
          .eq("orgId", warehouse.orgId)
          .eq("warehouseId", warehouse._id)
          .eq("code", ANNEX_BUILDING_CODE),
      )
      .unique();
    if (!building)
      throw new Error("DEMO-ANNEX was not found in this warehouse");

    const zones = await Promise.all(
      [...new Set(plan.map((row) => row.zoneCode))].map(
        async (code) =>
          await ctx.db
            .query("storageZones")
            .withIndex("by_orgId_warehouseId_code", (query) =>
              query
                .eq("orgId", warehouse.orgId)
                .eq("warehouseId", warehouse._id)
                .eq("code", code),
            )
            .unique(),
      ),
    );
    if (zones.some((zone) => !zone)) {
      throw new Error("Run staging/annexDemo:configure before seeding pallets");
    }
    const zonesByCode = new Map(zones.map((zone) => [zone!.code, zone!]));
    const now = Date.now();
    let created = 0;
    let reused = 0;

    for (const [offset, row] of batch.entries()) {
      const index = args.startIndex + offset;
      const palletCode = `${SEED_PREFIX}${String(index + 1).padStart(4, "0")}`;
      const zone = zonesByCode.get(row.zoneCode)!;
      const existingPallet = await ctx.db
        .query("finishedGoodsPallets")
        .withIndex("by_orgId_warehouseId_code", (query) =>
          query
            .eq("orgId", warehouse.orgId)
            .eq("warehouseId", warehouse._id)
            .eq("code", palletCode),
        )
        .unique();
      const palletId =
        existingPallet?._id ??
        (await ctx.db.insert("finishedGoodsPallets", {
          orgId: warehouse.orgId,
          warehouseId: warehouse._id,
          productId: activeProducts[index % activeProducts.length]!._id,
          code: palletCode,
          quantity: 40 + (index % 4) * 20,
          lot: `ANX-2609-${String((index % 8) + 1).padStart(2, "0")}`,
          lengthMm: PALLET_DEPTH_MM,
          widthMm: PALLET_WIDTH_MM,
          heightMm: 1_000 + (index % 3) * 200,
          weightKg: 180 + (index % 5) * 20,
          stackable: true,
          maxStackLevels: 2,
          status: row.status,
          createdAt: now,
          createdByUserId: actor._id,
          updatedAt: now,
          updatedByUserId: actor._id,
        }));
      if (!existingPallet) {
        created += 1;
      } else {
        reused += 1;
      }
      const placement = await ctx.db
        .query("finishedGoodsPlacements")
        .withIndex("by_orgId_palletId", (query) =>
          query.eq("orgId", warehouse.orgId).eq("palletId", palletId),
        )
        .unique();
      if (!placement) {
        const placementId = await ctx.db.insert("finishedGoodsPlacements", {
          orgId: warehouse.orgId,
          warehouseId: warehouse._id,
          palletId,
          buildingId: building._id,
          floorId: zone.floorId,
          zoneId: zone._id,
          locationId: zone.locationId,
          positionCode: `${row.zoneCode}-P-${String(index + 1).padStart(4, "0")}`,
          qrValue: `ISAS:FG:${palletCode}`,
          xMm: row.xMm,
          yMm: row.yMm,
          zMm: 0,
          widthMm: PALLET_WIDTH_MM,
          depthMm: PALLET_DEPTH_MM,
          heightMm: 1_000 + (index % 3) * 200,
          rotation: 0,
          status: row.status,
          verifiedAt: now,
          verifiedByUserId: actor._id,
          verificationMethod: "MANUAL",
          createdAt: now,
          createdByUserId: actor._id,
          updatedAt: now,
          updatedByUserId: actor._id,
        });
        await ctx.db.patch(palletId, {
          placementId,
          status: row.status,
          updatedAt: now,
          updatedByUserId: actor._id,
        });
      }
    }
    return { created, reused, total: plan.length };
  },
});

export const inspect = internalQuery({
  args: { warehouseId: v.id("warehouses") },
  returns: v.any(),
  handler: async (ctx, args) => {
    const warehouse = await ctx.db.get(args.warehouseId);
    if (!warehouse) throw new Error("Warehouse was not found");
    const building = await ctx.db
      .query("storageBuildings")
      .withIndex("by_orgId_warehouseId_code", (query) =>
        query
          .eq("orgId", warehouse.orgId)
          .eq("warehouseId", warehouse._id)
          .eq("code", ANNEX_BUILDING_CODE),
      )
      .unique();
    if (!building)
      throw new Error("DEMO-ANNEX was not found in this warehouse");
    const placements = (
      await Promise.all(
        (["STORED", "RESERVED"] as const).map(
          async (status) =>
            await ctx.db
              .query("finishedGoodsPlacements")
              .withIndex("by_orgId_buildingId_status", (query) =>
                query
                  .eq("orgId", warehouse.orgId)
                  .eq("buildingId", building._id)
                  .eq("status", status),
              )
              .take(10_000),
        ),
      )
    ).flat();
    const byZone = new Map<string, typeof placements>();
    for (const placement of placements) {
      const grouped = byZone.get(placement.zoneId) ?? [];
      grouped.push(placement);
      byZone.set(placement.zoneId, grouped);
    }
    const usage = storageFootprintUsage(
      [...byZone.values()].map((zonePlacements) => ({
        placements: zonePlacements,
      })),
    );
    const occupiedAreaSqMm =
      usage.storedFootprintAreaSqMm + usage.heldFootprintAreaSqMm;
    return {
      usableAreaSqMm: building.usableAreaSqMm,
      storedFootprintAreaSqMm: usage.storedFootprintAreaSqMm,
      heldFootprintAreaSqMm: usage.heldFootprintAreaSqMm,
      occupancyPercent: Number(
        ((occupiedAreaSqMm / building.usableAreaSqMm) * 100).toFixed(2),
      ),
      seedPalletCount: placements.filter((placement) =>
        placement.qrValue.startsWith("ISAS:FG:DEMO-ANNEX-R26-"),
      ).length,
      plannedPalletCount: annexPalletPlan().length,
    };
  },
});
