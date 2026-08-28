import type { GenericMutationCtx, WithoutSystemFields } from "convex/server";
import { v } from "convex/values";

import type { Doc, Id, TableNames } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import { encodeBucketKey } from "../model/inventory/stockIdentity";
import type { DataModel } from "../schema";

const CONFIRMATION = "SEED_INDUSTRIAL_SAS_DEMO";
const BUSINESS_DATE = "2026-08-26";

type InsertDocument<TableName extends TableNames> = WithoutSystemFields<
  Doc<TableName>
>;

interface SeedStats {
  inserted: number;
  reused: number;
}

interface DemoSeedArgs {
  readonly organizationId: Id<"organizations">;
  readonly warehouseId: Id<"warehouses">;
  readonly actorUserId: Id<"users">;
  readonly confirmation: string;
}

async function ensure<TableName extends TableNames>(
  ctx: GenericMutationCtx<DataModel>,
  stats: SeedStats,
  table: TableName,
  find: () => Promise<Doc<TableName> | null>,
  document: InsertDocument<TableName>,
): Promise<Id<TableName>> {
  const existing = await find();
  if (existing !== null) {
    stats.reused += 1;
    return existing._id;
  }
  stats.inserted += 1;
  return await ctx.db.insert(table, document);
}

async function ensureCurrent<TableName extends TableNames>(
  ctx: GenericMutationCtx<DataModel>,
  stats: SeedStats,
  table: TableName,
  find: () => Promise<Doc<TableName> | null>,
  document: InsertDocument<TableName>,
): Promise<Id<TableName>> {
  const existing = await find();
  if (existing !== null) {
    stats.reused += 1;
    await ctx.db.replace(existing._id, document as never);
    return existing._id;
  }
  stats.inserted += 1;
  return await ctx.db.insert(table, document);
}

function demoSpecification() {
  return {
    styleCode: "RSC",
    internalLengthMm: 300,
    internalWidthMm: 200,
    internalHeightMm: 150,
    boardGrade: "KA125/C/KA125",
    fluteCode: "C",
    printColourCount: 2,
    sheetLengthMm: 1_010,
    sheetWidthMm: 465,
    productNameEn: "Demo export carton",
    productNameTh: "กล่องลูกฟูกตัวอย่าง",
    layers: [{ position: 1, paperCode: "KA125", grammageGsm: 125 }],
    route: [
      {
        sequence: 10,
        workCenterCode: "PRN-01",
        operationCode: "PRINT",
      },
      {
        sequence: 20,
        workCenterCode: "SLT-01",
        operationCode: "SLOT",
      },
      {
        sequence: 30,
        workCenterCode: "GLU-01",
        operationCode: "GLUE",
      },
    ],
    materials: [
      {
        itemCode: "RM-BOARD-KA125",
        description: "KA125 C-flute corrugated board",
        quantityPerUnit: 1,
        uom: "SHEET",
      },
    ],
    qualityRequirements: [
      {
        code: "BCT",
        description: "Box compression strength",
        target: ">= 4500 N",
      },
    ],
  };
}

function bucketKey(input: {
  readonly organizationId: Id<"organizations">;
  readonly warehouseId: Id<"warehouses">;
  readonly itemId: Id<"items">;
  readonly locationId: Id<"locations">;
  readonly lotId?: Id<"lots">;
  readonly handlingUnitId?: Id<"handlingUnits">;
  readonly stockStatus: "AVAILABLE" | "QC_HOLD";
}): string {
  const encoded = encodeBucketKey({
    orgId: input.organizationId,
    warehouseId: input.warehouseId,
    itemId: input.itemId,
    location: { kind: "PHYSICAL", locationId: input.locationId },
    ...(input.lotId === undefined ? {} : { lotId: input.lotId }),
    ...(input.handlingUnitId === undefined
      ? {}
      : { handlingUnitId: input.handlingUnitId }),
    stockStatus: input.stockStatus,
  });
  if (!encoded.ok)
    throw new Error(`Could not encode demo bucket: ${encoded.error.code}`);
  return encoded.value;
}

function virtualBucketKey(input: {
  readonly organizationId: Id<"organizations">;
  readonly warehouseId: Id<"warehouses">;
  readonly itemId: Id<"items">;
  readonly boundary: "SUPPLIER_RECEIPT" | "INVENTORY_ADJUSTMENT";
  readonly lotId?: Id<"lots">;
  readonly stockStatus: "AVAILABLE" | "QC_HOLD";
}): string {
  const encoded = encodeBucketKey({
    orgId: input.organizationId,
    warehouseId: input.warehouseId,
    itemId: input.itemId,
    location: { kind: "VIRTUAL", boundary: input.boundary },
    ...(input.lotId === undefined ? {} : { lotId: input.lotId }),
    stockStatus: input.stockStatus,
  });
  if (!encoded.ok)
    throw new Error(`Could not encode demo bucket: ${encoded.error.code}`);
  return encoded.value;
}

export async function seedDemoDataForTenant(
  ctx: GenericMutationCtx<DataModel>,
  args: DemoSeedArgs,
): Promise<{ inserted: number; reused: number }> {
  if (args.confirmation !== CONFIRMATION) {
    throw new Error(`Refusing demo seed without confirmation ${CONFIRMATION}`);
  }

  const [organization, warehouse, actor] = await Promise.all([
    ctx.db.get(args.organizationId),
    ctx.db.get(args.warehouseId),
    ctx.db.get(args.actorUserId),
  ]);
  if (organization === null || warehouse === null || actor === null) {
    throw new Error("Demo seed target does not exist");
  }
  if (warehouse.orgId !== organization._id) {
    throw new Error("Demo seed warehouse belongs to another organization");
  }

  const stats: SeedStats = { inserted: 0, reused: 0 };
  const orgId = organization._id;
  const warehouseId = warehouse._id;
  const actorUserId = actor._id;
  const now = Date.now();

  const secondaryWarehouseId = await ensure(
    ctx,
    stats,
    "warehouses",
    async () =>
      await ctx.db
        .query("warehouses")
        .withIndex("by_orgId_code", (query) =>
          query.eq("orgId", orgId).eq("code", "QA-SECONDARY"),
        )
        .unique(),
    {
      orgId,
      code: "QA-SECONDARY",
      name: "คลังสำรองตัวอย่าง",
      status: "ACTIVE",
    },
  );

  const ensureItem = async (
    sku: string,
    name: string,
    baseUom: string,
    trackingMode: "NONE" | "LOT",
  ) =>
    await ensure(
      ctx,
      stats,
      "items",
      async () =>
        await ctx.db
          .query("items")
          .withIndex("by_orgId_sku", (query) =>
            query.eq("orgId", orgId).eq("sku", sku),
          )
          .unique(),
      { orgId, sku, name, baseUom, trackingMode, status: "ACTIVE" },
    );

  const finishedItemId = await ensureItem(
    "FG-BOX-300",
    "กล่องลูกฟูก 300 × 200 × 150 มม.",
    "EA",
    "LOT",
  );
  const boardItemId = await ensureItem(
    "RM-BOARD-KA125",
    "กระดาษลูกฟูก KA125 C-flute",
    "SHEET",
    "LOT",
  );
  const inkItemId = await ensureItem(
    "RM-INK-BLUE",
    "หมึกพิมพ์สีน้ำเงิน",
    "KG",
    "NONE",
  );

  await ensure(
    ctx,
    stats,
    "itemBarcodes",
    async () =>
      await ctx.db
        .query("itemBarcodes")
        .withIndex("by_orgId_barcode", (query) =>
          query.eq("orgId", orgId).eq("barcode", "8850000300201"),
        )
        .unique(),
    {
      orgId,
      itemId: finishedItemId,
      barcode: "8850000300201",
      kind: "INTERNAL",
      status: "ACTIVE",
    },
  );
  await ensure(
    ctx,
    stats,
    "itemUoms",
    async () =>
      await ctx.db
        .query("itemUoms")
        .withIndex("by_orgId_itemId_uom", (query) =>
          query
            .eq("orgId", orgId)
            .eq("itemId", finishedItemId)
            .eq("uom", "BUNDLE"),
        )
        .unique(),
    {
      orgId,
      itemId: finishedItemId,
      uom: "BUNDLE",
      toBaseNumerator: 20,
      toBaseDenominator: 1,
      status: "ACTIVE",
    },
  );

  const finishedLotId = await ensure(
    ctx,
    stats,
    "lots",
    async () =>
      await ctx.db
        .query("lots")
        .withIndex("by_orgId_itemId_lotCode", (query) =>
          query
            .eq("orgId", orgId)
            .eq("itemId", finishedItemId)
            .eq("lotCode", "FG-260826-A"),
        )
        .unique(),
    {
      orgId,
      itemId: finishedItemId,
      lotCode: "FG-260826-A",
      manufactureDate: BUSINESS_DATE,
      bestBeforeDate: "2027-08-26",
      status: "ACTIVE",
    },
  );
  const boardLotId = await ensure(
    ctx,
    stats,
    "lots",
    async () =>
      await ctx.db
        .query("lots")
        .withIndex("by_orgId_itemId_lotCode", (query) =>
          query
            .eq("orgId", orgId)
            .eq("itemId", boardItemId)
            .eq("lotCode", "KA125-2608-A"),
        )
        .unique(),
    {
      orgId,
      itemId: boardItemId,
      lotCode: "KA125-2608-A",
      manufactureDate: "2026-08-10",
      status: "ACTIVE",
    },
  );

  const ensureSupplier = async (code: string, name: string) =>
    await ensure(
      ctx,
      stats,
      "suppliers",
      async () =>
        await ctx.db
          .query("suppliers")
          .withIndex("by_orgId_code", (query) =>
            query.eq("orgId", orgId).eq("code", code),
          )
          .unique(),
      { orgId, code, name, status: "ACTIVE" },
    );
  const paperSupplierId = await ensureSupplier(
    "SUP-PAPER",
    "บริษัท กระดาษสยาม ตัวอย่าง จำกัด",
  );
  await ensureSupplier("SUP-INK", "บริษัท หมึกพิมพ์ไทย ตัวอย่าง จำกัด");

  for (const storageClass of [
    ["AMBIENT", "อุณหภูมิห้อง"],
    ["HEAVY-DUTY", "รองรับน้ำหนักสูง"],
    ["FLAMMABLE", "วัตถุไวไฟ"],
  ] as const) {
    await ensure(
      ctx,
      stats,
      "storageClasses",
      async () =>
        await ctx.db
          .query("storageClasses")
          .withIndex("by_orgId_code", (query) =>
            query.eq("orgId", orgId).eq("code", storageClass[0]),
          )
          .unique(),
      { orgId, code: storageClass[0], name: storageClass[1], status: "ACTIVE" },
    );
  }

  const damagedReasonId = await ensure(
    ctx,
    stats,
    "reasonCodes",
    async () =>
      await ctx.db
        .query("reasonCodes")
        .withIndex("by_orgId_code", (query) =>
          query.eq("orgId", orgId).eq("code", "DAMAGED"),
        )
        .unique(),
    {
      orgId,
      code: "DAMAGED",
      name: "สินค้าเสียหาย",
      scope: "STATUS_CHANGE",
      status: "ACTIVE",
    },
  );
  const countVarianceReasonId = await ensure(
    ctx,
    stats,
    "reasonCodes",
    async () =>
      await ctx.db
        .query("reasonCodes")
        .withIndex("by_orgId_code", (query) =>
          query.eq("orgId", orgId).eq("code", "COUNT-VARIANCE"),
        )
        .unique(),
    {
      orgId,
      code: "COUNT-VARIANCE",
      name: "ผลตรวจนับต่างจากระบบ",
      scope: "ADJUSTMENT",
      status: "ACTIVE",
    },
  );

  await ensure(
    ctx,
    stats,
    "labelTemplates",
    async () =>
      await ctx.db
        .query("labelTemplates")
        .withIndex("by_orgId_code_version", (query) =>
          query.eq("orgId", orgId).eq("code", "LPN-DEMO").eq("version", 1),
        )
        .unique(),
    {
      orgId,
      code: "LPN-DEMO",
      version: 1,
      name: "ป้ายหน่วยบรรจุตัวอย่าง",
      format: "ZPL",
      body: "^XA^FO40,40^A0N,40,40^FD{{LPN}}^FS^XZ",
      status: "ACTIVE",
      draftedByUserId: actorUserId,
      publishedByUserId: actorUserId,
    },
  );

  const ensureLocation = async (
    code: string,
    locationType:
      | "DOCK"
      | "STAGING"
      | "RACK_BIN"
      | "FLOOR_BLOCK"
      | "QUARANTINE"
      | "OVERFLOW",
    targetWarehouseId = warehouseId,
  ) =>
    await ensureCurrent(
      ctx,
      stats,
      "locations",
      async () =>
        await ctx.db
          .query("locations")
          .withIndex("by_orgId_warehouseId_code", (query) =>
            query
              .eq("orgId", orgId)
              .eq("warehouseId", targetWarehouseId)
              .eq("code", code),
          )
          .unique(),
      {
        orgId,
        warehouseId: targetWarehouseId,
        code,
        locationType,
        status: "ACTIVE",
      },
    );

  const dockLocationId = await ensureLocation("DOCK-IN-01", "DOCK");
  const stagingLocationId = await ensureLocation("STAGE-QC-01", "STAGING");
  await ensureLocation("QUARANTINE-01", "QUARANTINE");
  await ensureLocation("OVERFLOW-01", "OVERFLOW");
  const rackLocationId = await ensureLocation("RACK-A-01", "RACK_BIN");
  const secondaryLocationId = await ensureLocation(
    "SECONDARY-STAGE-01",
    "STAGING",
    secondaryWarehouseId,
  );

  const buildingId = await ensureCurrent(
    ctx,
    stats,
    "storageBuildings",
    async () =>
      await ctx.db
        .query("storageBuildings")
        .withIndex("by_orgId_warehouseId_code", (query) =>
          query
            .eq("orgId", orgId)
            .eq("warehouseId", warehouseId)
            .eq("code", "DEMO-BLDG"),
        )
        .unique(),
    {
      orgId,
      warehouseId,
      code: "DEMO-BLDG",
      name: "อาคารตัวอย่างสำหรับเรียนรู้ระบบ",
      widthMm: 30_000,
      depthMm: 20_000,
      defaultFloorHeightMm: 4_000,
      floorCount: 2,
      totalHeightMm: 8_000,
      grossAreaSqMm: 1_200_000_000,
      reservedAreaSqMm: 20_000_000,
      usableAreaSqMm: 1_180_000_000,
      status: "ACTIVE",
      version: 1,
      createdAt: now,
      createdByUserId: actorUserId,
      updatedAt: now,
      updatedByUserId: actorUserId,
      activatedAt: now,
      activatedByUserId: actorUserId,
    },
  );

  const ensureFloor = async (floorNumber: number, reservedAreaSqMm: number) =>
    await ensure(
      ctx,
      stats,
      "storageFloors",
      async () =>
        await ctx.db
          .query("storageFloors")
          .withIndex("by_orgId_buildingId_floorNumber", (query) =>
            query
              .eq("orgId", orgId)
              .eq("buildingId", buildingId)
              .eq("floorNumber", floorNumber),
          )
          .unique(),
      {
        orgId,
        buildingId,
        warehouseId,
        floorNumber,
        grossAreaSqMm: 600_000_000,
        reservedAreaSqMm,
        usableAreaSqMm: 600_000_000 - reservedAreaSqMm,
        version: 1,
        updatedAt: now,
        updatedByUserId: actorUserId,
      },
    );
  const firstFloorId = await ensureFloor(1, 20_000_000);
  await ensureFloor(2, 0);

  await ensure(
    ctx,
    stats,
    "storageFloorReservedBlocks",
    async () =>
      await ctx.db
        .query("storageFloorReservedBlocks")
        .withIndex("by_orgId_floorId", (query) =>
          query.eq("orgId", orgId).eq("floorId", firstFloorId),
        )
        .first(),
    {
      orgId,
      buildingId,
      floorId: firstFloorId,
      warehouseId,
      label: "สำนักงานและทางหนีไฟ",
      xMm: 24_000,
      yMm: 0,
      widthMm: 5_000,
      depthMm: 4_000,
      createdAt: now,
      updatedAt: now,
    },
  );

  const ensureZone = async (
    code: string,
    label: string,
    xMm: number,
    yMm: number,
    widthMm = 4_000,
    depthMm = 4_000,
    mode: "SIMPLE" | "FLOOR_POSITIONS" | "RACK" | "PLATFORM" = "SIMPLE",
    includeCompatibilityDefault = true,
  ) => {
    const locationId = await ensureLocation(code, "FLOOR_BLOCK");
    const zoneId = await ensureCurrent(
      ctx,
      stats,
      "storageZones",
      async () =>
        await ctx.db
          .query("storageZones")
          .withIndex("by_orgId_warehouseId_code", (query) =>
            query
              .eq("orgId", orgId)
              .eq("warehouseId", warehouseId)
              .eq("code", code),
          )
          .unique(),
      {
        orgId,
        buildingId,
        floorId: firstFloorId,
        warehouseId,
        locationId,
        code,
        label,
        qrValue: `ISAS:LOCATION:1:${locationId}`,
        mode,
        xMm,
        yMm,
        widthMm,
        depthMm,
        maxStackHeightMm: 3_000,
        status: "ACTIVE",
        createdAt: now,
        createdByUserId: actorUserId,
        updatedAt: now,
        updatedByUserId: actorUserId,
      },
    );
    // Demo seeds are intentionally refreshable: keep the stable zone/location
    // identities while evolving the illustrative geometry and addressing mode.
    await ctx.db.patch(zoneId, {
      label,
      mode,
      xMm,
      yMm,
      widthMm,
      depthMm,
      maxStackHeightMm: 3_000,
      status: "ACTIVE",
      updatedAt: now,
      updatedByUserId: actorUserId,
    });
    const existingDefaultPosition = await ctx.db
      .query("storagePositions")
      .withIndex("by_orgId_locationId", (query) =>
        query.eq("orgId", orgId).eq("locationId", locationId),
      )
      .unique();
    if (includeCompatibilityDefault) {
      const defaultPositionId = await ensure(
        ctx,
        stats,
        "storagePositions",
        async () => existingDefaultPosition,
        {
          orgId,
          buildingId,
          floorId: firstFloorId,
          zoneId,
          warehouseId,
          locationId,
          code,
          label,
          qrValue: `ISAS:LOCATION:1:${locationId}`,
          kind: "DEFAULT",
          isDefault: true,
          xMm,
          yMm,
          widthMm,
          depthMm,
          status: "ACTIVE",
          createdAt: now,
          createdByUserId: actorUserId,
          updatedAt: now,
          updatedByUserId: actorUserId,
        },
      );
      await ctx.db.patch(defaultPositionId, {
        zoneId,
        label,
        xMm,
        yMm,
        widthMm,
        depthMm,
        status: "ACTIVE",
        updatedAt: now,
        updatedByUserId: actorUserId,
      });
    } else if (existingDefaultPosition?.status === "ACTIVE") {
      await ctx.db.patch(existingDefaultPosition._id, {
        status: "INACTIVE",
        updatedAt: now,
        updatedByUserId: actorUserId,
      });
    }
    return { zoneId, locationId };
  };
  const primaryZone = await ensureZone(
    "DEMO-BLDG-F01-Z01",
    "สินค้าสำเร็จรูป A",
    0,
    0,
  );
  const fullZone = await ensureZone(
    "DEMO-BLDG-F01-Z02",
    "สินค้าสำเร็จรูป B · เต็ม",
    5_000,
    0,
  );
  const bulkZone = await ensureZone(
    "DEMO-BLDG-F01-Z03",
    "BULK-A พื้นที่กองขนาดใหญ่",
    10_000,
    0,
    8_000,
    6_000,
    "FLOOR_POSITIONS",
  );
  const rackZone = await ensureZone(
    "DEMO-BLDG-F01-Z04",
    "ชั้นวางสินค้าสำเร็จรูป",
    18_000,
    0,
    6_000,
    4_000,
    "RACK",
    false,
  );

  const ensurePosition = async (input: {
    zoneId: typeof bulkZone.zoneId;
    zoneCode: string;
    codeSuffix: string;
    label: string;
    kind: "FLOOR" | "RACK_SLOT";
    xMm: number;
    yMm: number;
    widthMm: number;
    depthMm: number;
    fixtureCode?: string;
    bayIndex?: number;
    levelIndex?: number;
    slotIndex?: number;
    elevationMm?: number;
  }) => {
    const code = `${input.zoneCode}-${input.codeSuffix}`;
    const locationId = await ensureLocation(
      code,
      input.kind === "RACK_SLOT" ? "RACK_BIN" : "FLOOR_BLOCK",
    );
    await ensure(
      ctx,
      stats,
      "storagePositions",
      async () =>
        await ctx.db
          .query("storagePositions")
          .withIndex("by_orgId_locationId", (query) =>
            query.eq("orgId", orgId).eq("locationId", locationId),
          )
          .unique(),
      {
        orgId,
        buildingId,
        floorId: firstFloorId,
        zoneId: input.zoneId,
        warehouseId,
        locationId,
        code,
        label: input.label,
        qrValue: `ISAS:LOCATION:1:${locationId}`,
        kind: input.kind,
        isDefault: false,
        xMm: input.xMm,
        yMm: input.yMm,
        widthMm: input.widthMm,
        depthMm: input.depthMm,
        ...(input.fixtureCode === undefined
          ? {}
          : { fixtureCode: input.fixtureCode }),
        ...(input.bayIndex === undefined ? {} : { bayIndex: input.bayIndex }),
        ...(input.levelIndex === undefined
          ? {}
          : { levelIndex: input.levelIndex }),
        ...(input.slotIndex === undefined
          ? {}
          : { slotIndex: input.slotIndex }),
        ...(input.elevationMm === undefined
          ? {}
          : { elevationMm: input.elevationMm }),
        status: "ACTIVE",
        createdAt: now,
        createdByUserId: actorUserId,
        updatedAt: now,
        updatedByUserId: actorUserId,
      },
    );
  };
  await ensurePosition({
    zoneId: bulkZone.zoneId,
    zoneCode: "DEMO-BLDG-F01-Z03",
    codeSuffix: "P-12",
    label: "P-12 กองวัตถุดิบ",
    kind: "FLOOR",
    xMm: 11_000,
    yMm: 1_000,
    widthMm: 2_000,
    depthMm: 2_000,
  });
  await ensurePosition({
    zoneId: bulkZone.zoneId,
    zoneCode: "DEMO-BLDG-F01-Z03",
    codeSuffix: "GRID-B4",
    label: "GRID-B4",
    kind: "FLOOR",
    xMm: 14_000,
    yMm: 3_000,
    widthMm: 2_000,
    depthMm: 2_000,
  });
  for (let bay = 1; bay <= 3; bay += 1) {
    for (let level = 1; level <= 2; level += 1) {
      await ensurePosition({
        zoneId: rackZone.zoneId,
        zoneCode: "DEMO-BLDG-F01-Z04",
        codeSuffix: `RACK-A-B${String(bay).padStart(2, "0")}-L${String(level).padStart(2, "0")}-S01`,
        label: `Rack A / Bay ${String(bay).padStart(2, "0")} / Level ${String(level).padStart(2, "0")}`,
        kind: "RACK_SLOT",
        xMm: 18_000 + (bay - 1) * 2_000,
        yMm: 0,
        widthMm: 2_000,
        depthMm: 1_200,
        fixtureCode: "RACK-A",
        bayIndex: bay,
        levelIndex: level,
        slotIndex: 1,
        elevationMm: (level - 1) * 1_800,
      });
    }
  }

  const handlingUnitId = await ensure(
    ctx,
    stats,
    "handlingUnits",
    async () =>
      await ctx.db
        .query("handlingUnits")
        .withIndex("by_orgId_lpn", (query) =>
          query.eq("orgId", orgId).eq("lpn", "LPN-DEMO-0001"),
        )
        .unique(),
    {
      orgId,
      warehouseId,
      lpn: "LPN-DEMO-0001",
      currentLocationId: primaryZone.locationId,
      widthMm: 1_200,
      depthMm: 1_000,
      heightMm: 1_100,
      status: "ACTIVE",
    },
  );

  const customerId = await ensure(
    ctx,
    stats,
    "customers",
    async () =>
      await ctx.db
        .query("customers")
        .withIndex("by_orgId_code", (query) =>
          query.eq("orgId", orgId).eq("code", "DEMO-RETAIL"),
        )
        .unique(),
    {
      orgId,
      code: "DEMO-RETAIL",
      name: "ลูกค้าตัวอย่าง โกลด์ฟู้ดส์",
      status: "ACTIVE",
    },
  );
  const customerOrderId = await ensure(
    ctx,
    stats,
    "customerOrders",
    async () =>
      await ctx.db
        .query("customerOrders")
        .withIndex("by_orgId_orderNumber", (query) =>
          query.eq("orgId", orgId).eq("orderNumber", "SO-DEMO-26001"),
        )
        .unique(),
    {
      orgId,
      orderNumber: "SO-DEMO-26001",
      customerId,
      customerReference: "PO-CUSTOMER-DEMO-88",
      status: "RELEASED",
      orderedAt: now - 6 * 86_400_000,
    },
  );

  const masterCardId = await ensure(
    ctx,
    stats,
    "masterCards",
    async () =>
      await ctx.db
        .query("masterCards")
        .withIndex("by_orgId_cardNumber", (query) =>
          query.eq("orgId", orgId).eq("cardNumber", "MC-DEMO-001"),
        )
        .unique(),
    {
      orgId,
      cardNumber: "MC-DEMO-001",
      customerId,
      customerProductCode: "DEMO-BOX-300",
      designKey: "RSC|300x200x150|KA125/C/KA125|C2|DEMO",
      name: "Demo carton 300 × 200 × 150",
      status: "ACTIVE",
    },
  );
  const revisionId = await ensure(
    ctx,
    stats,
    "masterCardRevisions",
    async () =>
      await ctx.db
        .query("masterCardRevisions")
        .withIndex("by_orgId_masterCardId_revisionNumber", (query) =>
          query
            .eq("orgId", orgId)
            .eq("masterCardId", masterCardId)
            .eq("revisionNumber", 1),
        )
        .unique(),
    {
      orgId,
      masterCardId,
      revisionNumber: 1,
      status: "RELEASED",
      specification: demoSpecification(),
      designKey: "RSC|300x200x150|KA125/C/KA125|C2|DEMO",
      authoredByUserId: actorUserId,
      submittedByUserId: actorUserId,
      decidedByUserId: actorUserId,
      decidedAt: now - 5 * 86_400_000,
      decisionNote: "ข้อมูลตัวอย่างที่ผ่านการตรวจเพื่อสาธิต workflow",
    },
  );
  const masterCard = await ctx.db.get(masterCardId);
  if (masterCard?.releasedRevisionId === undefined) {
    await ctx.db.patch(masterCardId, { releasedRevisionId: revisionId });
  }

  const customerOrderLineId = await ensure(
    ctx,
    stats,
    "customerOrderLines",
    async () =>
      await ctx.db
        .query("customerOrderLines")
        .withIndex("by_orgId_customerOrderId_lineNumber", (query) =>
          query
            .eq("orgId", orgId)
            .eq("customerOrderId", customerOrderId)
            .eq("lineNumber", 1),
        )
        .unique(),
    {
      orgId,
      customerOrderId,
      lineNumber: 1,
      customerProductCode: "DEMO-BOX-300",
      specification: demoSpecification(),
      designKey: "RSC|300x200x150|KA125/C/KA125|C2|DEMO",
      designSource: "EXISTING",
      status: "HANDED_OFF",
      orderedQuantity: 2_000,
      masterCardRevisionId: revisionId,
    },
  );
  const designRequestId = await ensure(
    ctx,
    stats,
    "designRequests",
    async () =>
      await ctx.db
        .query("designRequests")
        .withIndex("by_orgId_requestNumber", (query) =>
          query.eq("orgId", orgId).eq("requestNumber", "SO-DEMO-26001-1"),
        )
        .unique(),
    {
      orgId,
      requestNumber: "SO-DEMO-26001-1",
      customerOrderLineId,
      status: "FULFILLED",
      priority: "NORMAL",
      dueAt: now + 2 * 86_400_000,
      assignedToUserId: actorUserId,
      masterCardRevisionId: revisionId,
      latestRequirementVersion: 1,
      requirementReadiness: "READY",
      missingRequirements: [],
      requirementsRecordedByUserId: actorUserId,
      requirementsRecordedAt: now - 5 * 86_400_000,
    },
  );
  await ensure(
    ctx,
    stats,
    "designRequirementVersions",
    async () =>
      await ctx.db
        .query("designRequirementVersions")
        .withIndex("by_orgId_designRequestId_version", (query) =>
          query
            .eq("orgId", orgId)
            .eq("designRequestId", designRequestId)
            .eq("version", 1),
        )
        .unique(),
    {
      orgId,
      designRequestId,
      version: 1,
      confirmations: {
        CUSTOMER_PRODUCT_IDENTITY: true,
        DIMENSIONS: true,
        CONSTRUCTION: true,
        PRINT: true,
        PACKING: true,
        ROUTE: true,
        MATERIALS: true,
        QUALITY: true,
      },
      status: "READY",
      missing: [],
      note: "ตัวอย่างข้อกำหนดครบถ้วน",
      recordedByUserId: actorUserId,
      recordedAt: now - 5 * 86_400_000,
    },
  );

  const factoryPacketId = await ensure(
    ctx,
    stats,
    "factoryPackets",
    async () =>
      await ctx.db
        .query("factoryPackets")
        .withIndex("by_orgId_packetNumber", (query) =>
          query.eq("orgId", orgId).eq("packetNumber", "FP-DEMO-26001"),
        )
        .unique(),
    {
      orgId,
      warehouseId,
      packetNumber: "FP-DEMO-26001",
      customerOrderLineId,
      masterCardRevisionId: revisionId,
      status: "ACKNOWLEDGED",
      issuedByUserId: actorUserId,
      acknowledgedByUserId: actorUserId,
      acknowledgedAt: now - 4 * 86_400_000,
    },
  );

  const fulfillmentOrderId = await ensure(
    ctx,
    stats,
    "fulfillmentOrders",
    async () =>
      await ctx.db
        .query("fulfillmentOrders")
        .withIndex("by_orgId_fulfillmentNumber", (query) =>
          query.eq("orgId", orgId).eq("fulfillmentNumber", "FUL-DEMO-26001"),
        )
        .unique(),
    {
      orgId,
      fulfillmentNumber: "FUL-DEMO-26001",
      customerOrderId,
      customerId,
      warehouseId,
      status: "IN_FULFILLMENT",
      routeDecision: "MIXED",
      routeVersion: 1,
      allowPartial: true,
      requestedDeliveryAt: now + 5 * 86_400_000,
      shipTo: {
        name: "คลังลูกค้าตัวอย่าง",
        addressLine1: "88 ถนนตัวอย่าง",
        district: "บางนา",
        province: "กรุงเทพมหานคร",
        postalCode: "10260",
        countryCode: "TH",
        recipientName: "คุณสมชาย ตัวอย่าง",
        recipientPhone: "0800000000",
      },
      releasedAt: now - 3 * 86_400_000,
      createdByUserId: actorUserId,
    },
  );
  const fulfillmentLineId = await ensure(
    ctx,
    stats,
    "fulfillmentLines",
    async () =>
      await ctx.db
        .query("fulfillmentLines")
        .withIndex("by_orgId_fulfillmentOrderId_customerOrderLineId", (query) =>
          query
            .eq("orgId", orgId)
            .eq("fulfillmentOrderId", fulfillmentOrderId)
            .eq("customerOrderLineId", customerOrderLineId),
        )
        .unique(),
    {
      orgId,
      fulfillmentOrderId,
      customerOrderLineId,
      warehouseId,
      itemId: finishedItemId,
      baseUom: "EA",
      orderedBaseMinorUnits: 2_000_000,
      routeDecision: "PRODUCTION",
      routeVersion: 1,
      routedAt: now - 3 * 86_400_000,
      productionShortageBaseMinorUnits: 1_500_000,
      availableStockPlannedBaseMinorUnits: 500_000,
      status: "RESERVED",
      quantities: {
        DEMAND: 2_000_000,
        RESERVED: 500_000,
        PICKING: 0,
        STAGED: 0,
        ISSUED: 0,
        LOADED: 0,
        DELIVERED: 0,
        RETURNED: 0,
        BACKORDERED: 0,
        CANCELLED: 0,
      },
      createdByUserId: actorUserId,
    },
  );

  await ensure(
    ctx,
    stats,
    "productionOrders",
    async () =>
      await ctx.db
        .query("productionOrders")
        .withIndex("by_orgId_productionOrderNumber", (query) =>
          query
            .eq("orgId", orgId)
            .eq("productionOrderNumber", "PROD-DEMO-26001"),
        )
        .unique(),
    {
      orgId,
      warehouseId,
      productionOrderNumber: "PROD-DEMO-26001",
      factoryPacketId,
      customerOrderLineId,
      fulfillmentLineId,
      planningSource: "ROUTED_SHORTAGE",
      masterCardRevisionId: revisionId,
      revisionNumber: 1,
      outputItemId: finishedItemId,
      outputBaseUom: "EA",
      targetBaseMinorUnits: 1_500_000,
      quantities: {
        target: 1_500_000,
        good: 600_000,
        scrap: 20_000,
        rework: 10_000,
        received: 0,
        qcReleased: 0,
        qcRejected: 0,
      },
      route: demoSpecification().route,
      status: "IN_PROGRESS",
      dueAt: now + 3 * 86_400_000,
      createdByUserId: actorUserId,
      createdAt: now - 2 * 86_400_000,
      releasedByUserId: actorUserId,
      releasedAt: now - 2 * 86_400_000,
    },
  );

  const purchaseOrderId = await ensure(
    ctx,
    stats,
    "purchaseOrders",
    async () =>
      await ctx.db
        .query("purchaseOrders")
        .withIndex("by_orgId_poNumber", (query) =>
          query.eq("orgId", orgId).eq("poNumber", "PO-DEMO-1001"),
        )
        .unique(),
    {
      orgId,
      warehouseId,
      poNumber: "PO-DEMO-1001",
      supplierId: paperSupplierId,
      status: "OPEN",
      externalRef: "ERP-DEMO-PO-1001",
    },
  );
  const purchaseOrderLineId = await ensure(
    ctx,
    stats,
    "purchaseOrderLines",
    async () =>
      await ctx.db
        .query("purchaseOrderLines")
        .withIndex("by_orgId_purchaseOrderId_lineNumber", (query) =>
          query
            .eq("orgId", orgId)
            .eq("purchaseOrderId", purchaseOrderId)
            .eq("lineNumber", 1),
        )
        .unique(),
    {
      orgId,
      purchaseOrderId,
      lineNumber: 1,
      itemId: boardItemId,
      orderedQuantity: { uom: "SHEET", minorUnits: 5_000_000 },
      orderedBaseMinorUnits: 5_000_000,
      receivedBaseMinorUnits: 1_000_000,
      status: "OPEN",
      sourceRowRef: "DEMO-PO-1001-L1",
    },
  );
  await ensure(
    ctx,
    stats,
    "purchaseOrderLines",
    async () =>
      await ctx.db
        .query("purchaseOrderLines")
        .withIndex("by_orgId_purchaseOrderId_lineNumber", (query) =>
          query
            .eq("orgId", orgId)
            .eq("purchaseOrderId", purchaseOrderId)
            .eq("lineNumber", 2),
        )
        .unique(),
    {
      orgId,
      purchaseOrderId,
      lineNumber: 2,
      itemId: inkItemId,
      orderedQuantity: { uom: "KG", minorUnits: 200_000 },
      orderedBaseMinorUnits: 200_000,
      receivedBaseMinorUnits: 0,
      status: "OPEN",
      sourceRowRef: "DEMO-PO-1001-L2",
    },
  );

  const receiptTransactionId = await ensure(
    ctx,
    stats,
    "inventoryTransactions",
    async () =>
      await ctx.db
        .query("inventoryTransactions")
        .withIndex("by_orgId_operation_requestId", (query) =>
          query
            .eq("orgId", orgId)
            .eq("operation", "demo.receipt")
            .eq("requestId", "demo-receipt-1001"),
        )
        .unique(),
    {
      orgId,
      warehouseId,
      type: "RECEIPT",
      operation: "demo.receipt",
      requestId: "demo-receipt-1001",
      actorUserId,
      occurredAt: now - 86_400_000,
      businessDate: BUSINESS_DATE,
      source: { type: "DEMO_SEED", id: "PO-DEMO-1001" },
      lineCount: 2,
      conservationGroupCount: 1,
    },
  );
  const receiptPhysicalBucketKey = bucketKey({
    organizationId: orgId,
    warehouseId,
    itemId: boardItemId,
    locationId: stagingLocationId,
    lotId: boardLotId,
    stockStatus: "QC_HOLD",
  });
  const receiptVirtualBucketKey = virtualBucketKey({
    organizationId: orgId,
    warehouseId,
    itemId: boardItemId,
    boundary: "SUPPLIER_RECEIPT",
    lotId: boardLotId,
    stockStatus: "QC_HOLD",
  });
  const receiptConservationKey = `DEMO:${boardItemId}:${boardLotId}:RECEIPT`;
  for (const line of [
    {
      lineIndex: 0,
      locationKind: "PHYSICAL" as const,
      locationId: stagingLocationId,
      bucketKey: receiptPhysicalBucketKey,
      minorUnits: 1_000_000,
    },
    {
      lineIndex: 1,
      locationKind: "VIRTUAL" as const,
      virtualBoundary: "SUPPLIER_RECEIPT" as const,
      bucketKey: receiptVirtualBucketKey,
      minorUnits: -1_000_000,
    },
  ]) {
    await ensure(
      ctx,
      stats,
      "inventoryLedgerLines",
      async () =>
        await ctx.db
          .query("inventoryLedgerLines")
          .withIndex("by_orgId_transactionId_lineIndex", (query) =>
            query
              .eq("orgId", orgId)
              .eq("transactionId", receiptTransactionId)
              .eq("lineIndex", line.lineIndex),
          )
          .unique(),
      {
        orgId,
        transactionId: receiptTransactionId,
        lineIndex: line.lineIndex,
        warehouseId,
        occurredAt: now - 86_400_000,
        itemId: boardItemId,
        locationKind: line.locationKind,
        ...(line.locationKind === "PHYSICAL"
          ? { locationId: line.locationId }
          : { virtualBoundary: line.virtualBoundary }),
        lotId: boardLotId,
        stockStatus: "QC_HOLD",
        bucketKey: line.bucketKey,
        conservationKey: receiptConservationKey,
        quantity: { uom: "SHEET", minorUnits: line.minorUnits },
      },
    );
  }
  for (const balance of [
    {
      bucketKey: receiptPhysicalBucketKey,
      locationKind: "PHYSICAL" as const,
      locationId: stagingLocationId,
      minorUnits: 1_000_000,
    },
    {
      bucketKey: receiptVirtualBucketKey,
      locationKind: "VIRTUAL" as const,
      virtualBoundary: "SUPPLIER_RECEIPT" as const,
      minorUnits: -1_000_000,
    },
  ]) {
    await ensure(
      ctx,
      stats,
      "inventoryBalances",
      async () =>
        await ctx.db
          .query("inventoryBalances")
          .withIndex("by_orgId_bucketKey", (query) =>
            query.eq("orgId", orgId).eq("bucketKey", balance.bucketKey),
          )
          .unique(),
      {
        orgId,
        bucketKey: balance.bucketKey,
        warehouseId,
        itemId: boardItemId,
        locationKind: balance.locationKind,
        ...(balance.locationKind === "PHYSICAL"
          ? { locationId: balance.locationId }
          : { virtualBoundary: balance.virtualBoundary }),
        lotId: boardLotId,
        stockStatus: "QC_HOLD",
        quantity: { uom: "SHEET", minorUnits: balance.minorUnits },
        lastTransactionId: receiptTransactionId,
        updatedAt: now,
      },
    );
  }
  const receiptId = await ensure(
    ctx,
    stats,
    "receipts",
    async () =>
      await ctx.db
        .query("receipts")
        .withIndex("by_orgId_receiptNumber", (query) =>
          query.eq("orgId", orgId).eq("receiptNumber", "RCPT-DEMO-5001"),
        )
        .unique(),
    {
      orgId,
      warehouseId,
      purchaseOrderId,
      receiptNumber: "RCPT-DEMO-5001",
      receivedByUserId: actorUserId,
      occurredAt: now - 86_400_000,
      businessDate: BUSINESS_DATE,
    },
  );
  const receiptLineId = await ensure(
    ctx,
    stats,
    "receiptLines",
    async () =>
      await ctx.db
        .query("receiptLines")
        .withIndex("by_orgId_receiptId", (query) =>
          query.eq("orgId", orgId).eq("receiptId", receiptId),
        )
        .first(),
    {
      orgId,
      receiptId,
      purchaseOrderLineId,
      itemId: boardItemId,
      lotId: boardLotId,
      locationId: stagingLocationId,
      capturedQuantity: { uom: "SHEET", minorUnits: 1_000_000 },
      baseMinorUnits: 1_000_000,
      kind: "ORDERED",
      classification: "PARTIAL",
      stockStatus: "QC_HOLD",
      transactionId: receiptTransactionId,
      overToleranceApproved: false,
    },
  );
  await ensure(
    ctx,
    stats,
    "qcInspections",
    async () =>
      await ctx.db
        .query("qcInspections")
        .withIndex("by_orgId_receiptLineId", (query) =>
          query.eq("orgId", orgId).eq("receiptLineId", receiptLineId),
        )
        .unique(),
    {
      orgId,
      warehouseId,
      receiptLineId,
      itemId: boardItemId,
      status: "PENDING_APPROVAL",
      strategy: "FIXED",
      sampleSize: 20,
      lotSize: 1_000,
      disposition: "RELEASE",
      submittedByUserId: actorUserId,
    },
  );
  await ensure(
    ctx,
    stats,
    "putawayTasks",
    async () =>
      await ctx.db
        .query("putawayTasks")
        .withIndex("by_orgId_receiptLineId", (query) =>
          query.eq("orgId", orgId).eq("receiptLineId", receiptLineId),
        )
        .unique(),
    {
      orgId,
      warehouseId,
      receiptLineId,
      itemId: boardItemId,
      lotId: boardLotId,
      baseMinorUnits: 1_000_000,
      fromLocationId: stagingLocationId,
      status: "READY",
      recommendedLocationId: rackLocationId,
      recommendationTrace: "ตัวอย่าง: ประเภทตำแหน่งเหมาะสมและมีพื้นที่ว่าง",
    },
  );

  const finishedTransactionId = await ensure(
    ctx,
    stats,
    "inventoryTransactions",
    async () =>
      await ctx.db
        .query("inventoryTransactions")
        .withIndex("by_orgId_operation_requestId", (query) =>
          query
            .eq("orgId", orgId)
            .eq("operation", "demo.opening")
            .eq("requestId", "demo-fg-opening"),
        )
        .unique(),
    {
      orgId,
      warehouseId,
      type: "ADJUSTMENT",
      operation: "demo.opening",
      requestId: "demo-fg-opening",
      actorUserId,
      occurredAt: now - 2 * 86_400_000,
      businessDate: BUSINESS_DATE,
      source: { type: "DEMO_SEED", id: "FG-BOX-300" },
      reasonCodeId: countVarianceReasonId,
      lineCount: 2,
      conservationGroupCount: 1,
    },
  );
  const finishedBucketKey = bucketKey({
    organizationId: orgId,
    warehouseId,
    itemId: finishedItemId,
    locationId: primaryZone.locationId,
    lotId: finishedLotId,
    handlingUnitId,
    stockStatus: "AVAILABLE",
  });
  const finishedVirtualBucketKey = virtualBucketKey({
    organizationId: orgId,
    warehouseId,
    itemId: finishedItemId,
    boundary: "INVENTORY_ADJUSTMENT",
    lotId: finishedLotId,
    stockStatus: "AVAILABLE",
  });
  await ensure(
    ctx,
    stats,
    "inventoryLedgerLines",
    async () =>
      await ctx.db
        .query("inventoryLedgerLines")
        .withIndex("by_orgId_transactionId_lineIndex", (query) =>
          query
            .eq("orgId", orgId)
            .eq("transactionId", finishedTransactionId)
            .eq("lineIndex", 0),
        )
        .unique(),
    {
      orgId,
      transactionId: finishedTransactionId,
      lineIndex: 0,
      warehouseId,
      occurredAt: now - 2 * 86_400_000,
      itemId: finishedItemId,
      locationKind: "VIRTUAL",
      virtualBoundary: "INVENTORY_ADJUSTMENT",
      lotId: finishedLotId,
      stockStatus: "AVAILABLE",
      bucketKey: finishedVirtualBucketKey,
      conservationKey: `DEMO:${finishedItemId}:${finishedLotId}`,
      quantity: { uom: "EA", minorUnits: -500_000 },
    },
  );
  await ensure(
    ctx,
    stats,
    "inventoryLedgerLines",
    async () =>
      await ctx.db
        .query("inventoryLedgerLines")
        .withIndex("by_orgId_transactionId_lineIndex", (query) =>
          query
            .eq("orgId", orgId)
            .eq("transactionId", finishedTransactionId)
            .eq("lineIndex", 1),
        )
        .unique(),
    {
      orgId,
      transactionId: finishedTransactionId,
      lineIndex: 1,
      warehouseId,
      occurredAt: now - 2 * 86_400_000,
      itemId: finishedItemId,
      locationKind: "PHYSICAL",
      locationId: primaryZone.locationId,
      lotId: finishedLotId,
      handlingUnitId,
      stockStatus: "AVAILABLE",
      bucketKey: finishedBucketKey,
      conservationKey: `DEMO:${finishedItemId}:${finishedLotId}`,
      quantity: { uom: "EA", minorUnits: 500_000 },
    },
  );
  await ensure(
    ctx,
    stats,
    "inventoryBalances",
    async () =>
      await ctx.db
        .query("inventoryBalances")
        .withIndex("by_orgId_bucketKey", (query) =>
          query.eq("orgId", orgId).eq("bucketKey", finishedBucketKey),
        )
        .unique(),
    {
      orgId,
      bucketKey: finishedBucketKey,
      warehouseId,
      itemId: finishedItemId,
      locationKind: "PHYSICAL",
      locationId: primaryZone.locationId,
      lotId: finishedLotId,
      handlingUnitId,
      stockStatus: "AVAILABLE",
      quantity: { uom: "EA", minorUnits: 500_000 },
      lastTransactionId: finishedTransactionId,
      updatedAt: now,
    },
  );
  await ensure(
    ctx,
    stats,
    "inventoryBalances",
    async () =>
      await ctx.db
        .query("inventoryBalances")
        .withIndex("by_orgId_bucketKey", (query) =>
          query.eq("orgId", orgId).eq("bucketKey", finishedVirtualBucketKey),
        )
        .unique(),
    {
      orgId,
      bucketKey: finishedVirtualBucketKey,
      warehouseId,
      itemId: finishedItemId,
      locationKind: "VIRTUAL",
      virtualBoundary: "INVENTORY_ADJUSTMENT",
      lotId: finishedLotId,
      stockStatus: "AVAILABLE",
      quantity: { uom: "EA", minorUnits: -500_000 },
      lastTransactionId: finishedTransactionId,
      updatedAt: now,
    },
  );

  const fullLocationTransactionId = await ensure(
    ctx,
    stats,
    "inventoryTransactions",
    async () =>
      await ctx.db
        .query("inventoryTransactions")
        .withIndex("by_orgId_operation_requestId", (query) =>
          query
            .eq("orgId", orgId)
            .eq("operation", "demo.capacity")
            .eq("requestId", "demo-full-storage-stack"),
        )
        .unique(),
    {
      orgId,
      warehouseId,
      type: "ADJUSTMENT",
      operation: "demo.capacity",
      requestId: "demo-full-storage-stack",
      actorUserId,
      occurredAt: now - 6 * 3_600_000,
      businessDate: BUSINESS_DATE,
      source: { type: "DEMO_SEED", id: "FULL-STORAGE-STACK" },
      reasonCodeId: countVarianceReasonId,
      lineCount: 16,
      conservationGroupCount: 8,
    },
  );

  for (let index = 0; index < 8; index += 1) {
    const ordinal = String(index + 1).padStart(2, "0");
    const lotId = await ensure(
      ctx,
      stats,
      "lots",
      async () =>
        await ctx.db
          .query("lots")
          .withIndex("by_orgId_itemId_lotCode", (query) =>
            query
              .eq("orgId", orgId)
              .eq("itemId", finishedItemId)
              .eq("lotCode", `LOT-FULL-${ordinal}`),
          )
          .unique(),
      {
        orgId,
        itemId: finishedItemId,
        lotCode: `LOT-FULL-${ordinal}`,
        manufactureDate: "2026-08-20",
        bestBeforeDate: "2027-08-20",
        status: "ACTIVE",
      },
    );
    const handlingUnitId = await ensure(
      ctx,
      stats,
      "handlingUnits",
      async () =>
        await ctx.db
          .query("handlingUnits")
          .withIndex("by_orgId_lpn", (query) =>
            query.eq("orgId", orgId).eq("lpn", `LPN-FULL-${ordinal}`),
          )
          .unique(),
      {
        orgId,
        warehouseId,
        lpn: `LPN-FULL-${ordinal}`,
        currentLocationId: fullZone.locationId,
        widthMm: 1_200,
        depthMm: 1_000,
        heightMm: 350,
        status: "ACTIVE",
      },
    );
    const physicalKey = bucketKey({
      organizationId: orgId,
      warehouseId,
      itemId: finishedItemId,
      locationId: fullZone.locationId,
      lotId,
      handlingUnitId,
      stockStatus: "AVAILABLE",
    });
    const virtualKey = virtualBucketKey({
      organizationId: orgId,
      warehouseId,
      itemId: finishedItemId,
      boundary: "INVENTORY_ADJUSTMENT",
      lotId,
      stockStatus: "AVAILABLE",
    });
    const conservationKey = `DEMO:FULL:${finishedItemId}:${lotId}`;
    for (const line of [
      {
        lineIndex: index * 2,
        locationKind: "VIRTUAL" as const,
        virtualBoundary: "INVENTORY_ADJUSTMENT" as const,
        bucketKey: virtualKey,
        minorUnits: -100_000,
      },
      {
        lineIndex: index * 2 + 1,
        locationKind: "PHYSICAL" as const,
        locationId: fullZone.locationId,
        bucketKey: physicalKey,
        minorUnits: 100_000,
      },
    ]) {
      await ensure(
        ctx,
        stats,
        "inventoryLedgerLines",
        async () =>
          await ctx.db
            .query("inventoryLedgerLines")
            .withIndex("by_orgId_transactionId_lineIndex", (query) =>
              query
                .eq("orgId", orgId)
                .eq("transactionId", fullLocationTransactionId)
                .eq("lineIndex", line.lineIndex),
            )
            .unique(),
        {
          orgId,
          transactionId: fullLocationTransactionId,
          lineIndex: line.lineIndex,
          warehouseId,
          occurredAt: now - 6 * 3_600_000,
          itemId: finishedItemId,
          locationKind: line.locationKind,
          ...(line.locationKind === "PHYSICAL"
            ? { locationId: line.locationId }
            : { virtualBoundary: line.virtualBoundary }),
          lotId,
          handlingUnitId,
          stockStatus: "AVAILABLE",
          bucketKey: line.bucketKey,
          conservationKey,
          quantity: { uom: "EA", minorUnits: line.minorUnits },
        },
      );
    }
    for (const balance of [
      {
        bucketKey: virtualKey,
        locationKind: "VIRTUAL" as const,
        virtualBoundary: "INVENTORY_ADJUSTMENT" as const,
        minorUnits: -100_000,
      },
      {
        bucketKey: physicalKey,
        locationKind: "PHYSICAL" as const,
        locationId: fullZone.locationId,
        minorUnits: 100_000,
      },
    ]) {
      await ensure(
        ctx,
        stats,
        "inventoryBalances",
        async () =>
          await ctx.db
            .query("inventoryBalances")
            .withIndex("by_orgId_bucketKey", (query) =>
              query.eq("orgId", orgId).eq("bucketKey", balance.bucketKey),
            )
            .unique(),
        {
          orgId,
          bucketKey: balance.bucketKey,
          warehouseId,
          itemId: finishedItemId,
          locationKind: balance.locationKind,
          ...(balance.locationKind === "PHYSICAL"
            ? { locationId: balance.locationId }
            : { virtualBoundary: balance.virtualBoundary }),
          lotId,
          handlingUnitId,
          stockStatus: "AVAILABLE",
          quantity: { uom: "EA", minorUnits: balance.minorUnits },
          lastTransactionId: fullLocationTransactionId,
          updatedAt: now,
        },
      );
    }
    await ensure(
      ctx,
      stats,
      "storageStackPlacements",
      async () =>
        await ctx.db
          .query("storageStackPlacements")
          .withIndex("by_orgId_handlingUnitId_status", (query) =>
            query
              .eq("orgId", orgId)
              .eq("handlingUnitId", handlingUnitId)
              .eq("status", "ACTIVE"),
          )
          .unique(),
      {
        orgId,
        zoneId: fullZone.zoneId,
        locationId: fullZone.locationId,
        warehouseId,
        handlingUnitId,
        levelIndex: index + 1,
        widthMm: 1_200,
        depthMm: 1_000,
        heightMm: 350,
        orientation: "DEFAULT",
        status: "ACTIVE",
        transactionId: fullLocationTransactionId,
        placedAt: now - (8 - index) * 1_800_000,
        placedByUserId: actorUserId,
      },
    );
  }

  const countPlanId = await ensure(
    ctx,
    stats,
    "countPlans",
    async () =>
      await ctx.db
        .query("countPlans")
        .withIndex("by_orgId_planNumber", (query) =>
          query.eq("orgId", orgId).eq("planNumber", "COUNT-DEMO-001"),
        )
        .unique(),
    {
      orgId,
      warehouseId,
      planNumber: "COUNT-DEMO-001",
      status: "RELEASED",
      scope: "SPOT",
      visibility: "BLIND",
      movementPolicy: "MOVEMENT_AWARE",
      quantityThresholdBaseMinorUnits: 5_000,
      valueThresholdMinorUnits: 100_000,
      taskCount: 1,
      completedTaskCount: 0,
      varianceTaskCount: 0,
      createdByUserId: actorUserId,
      createdAt: now - 86_400_000,
      releasedByUserId: actorUserId,
      releasedAt: now - 86_400_000,
    },
  );
  await ensure(
    ctx,
    stats,
    "countTasks",
    async () =>
      await ctx.db
        .query("countTasks")
        .withIndex("by_orgId_countPlanId_taskNumber", (query) =>
          query
            .eq("orgId", orgId)
            .eq("countPlanId", countPlanId)
            .eq("taskNumber", 1),
        )
        .unique(),
    {
      orgId,
      warehouseId,
      countPlanId,
      taskNumber: 1,
      locationId: primaryZone.locationId,
      status: "AVAILABLE",
      entryCount: 0,
    },
  );

  await ensure(
    ctx,
    stats,
    "reportJobs",
    async () =>
      await ctx.db
        .query("reportJobs")
        .withIndex("by_orgId_requestId", (query) =>
          query.eq("orgId", orgId).eq("requestId", "report-demo-inventory"),
        )
        .unique(),
    {
      orgId,
      warehouseId,
      kind: "INVENTORY_BALANCES",
      status: "COMPLETE",
      requestedByUserId: actorUserId,
      requestedAt: now - 3_600_000,
      requestId: "report-demo-inventory",
      rowCount: 1,
      artifact:
        "sku,location,status,quantity\nFG-BOX-300,DEMO-BLDG-F01-Z01,AVAILABLE,500",
      artifactBytes: 82,
      checksum: "demo-checksum-inventory",
      completedAt: now - 3_500_000,
    },
  );

  const teamId = await ensure(
    ctx,
    stats,
    "hrTeams",
    async () =>
      await ctx.db
        .query("hrTeams")
        .withIndex("by_orgId_code", (query) =>
          query.eq("orgId", orgId).eq("code", "WH-A"),
        )
        .unique(),
    {
      orgId,
      code: "WH-A",
      name: "ทีมคลังสินค้า A",
      warehouseId,
      status: "ACTIVE",
      createdByUserId: actorUserId,
      createdAt: now,
    },
  );
  const employeeId = await ensure(
    ctx,
    stats,
    "employees",
    async () =>
      await ctx.db
        .query("employees")
        .withIndex("by_orgId_employeeNumber", (query) =>
          query.eq("orgId", orgId).eq("employeeNumber", "EMP-DEMO-001"),
        )
        .unique(),
    {
      orgId,
      employeeNumber: "EMP-DEMO-001",
      userId: actorUserId,
      displayName: "พนักงานคลังตัวอย่าง",
      warehouseId,
      teamId,
      status: "ACTIVE",
      startedOn: "2026-01-01",
      createdByUserId: actorUserId,
      createdAt: now,
    },
  );
  await ensure(
    ctx,
    stats,
    "attendanceDays",
    async () =>
      await ctx.db
        .query("attendanceDays")
        .withIndex("by_orgId_employeeId_businessDate", (query) =>
          query
            .eq("orgId", orgId)
            .eq("employeeId", employeeId)
            .eq("businessDate", BUSINESS_DATE),
        )
        .unique(),
    {
      orgId,
      employeeId,
      warehouseId,
      businessDate: BUSINESS_DATE,
      status: "OPEN",
      clockInAt: now - 4 * 3_600_000,
      breakMinutes: 0,
      lastEventAt: now - 4 * 3_600_000,
      timezone: "Asia/Bangkok",
    },
  );
  await ensure(
    ctx,
    stats,
    "leaveRequests",
    async () =>
      await ctx.db
        .query("leaveRequests")
        .withIndex("by_orgId_requestId", (query) =>
          query.eq("orgId", orgId).eq("requestId", "LEAVE-DEMO-001"),
        )
        .unique(),
    {
      orgId,
      requestId: "LEAVE-DEMO-001",
      employeeId,
      warehouseId,
      startDate: "2026-09-01",
      endDate: "2026-09-01",
      leaveType: "ANNUAL",
      durationKind: "FULL_DAY",
      privateReason: "ข้อมูลตัวอย่าง",
      status: "SUBMITTED",
      requestedByUserId: actorUserId,
      requestedAt: now,
    },
  );

  await ensure(
    ctx,
    stats,
    "devices",
    async () =>
      await ctx.db
        .query("devices")
        .withIndex("by_orgId_label", (query) =>
          query.eq("orgId", orgId).eq("label", "HH-DEMO-01"),
        )
        .unique(),
    {
      orgId,
      label: "HH-DEMO-01",
      deviceType: "HANDHELD",
      status: "ACTIVE",
      warehouseId,
      lastSeenAt: now - 300_000,
      registeredByUserId: actorUserId,
    },
  );
  const operatorTaskId = await ensure(
    ctx,
    stats,
    "operatorTasks",
    async () =>
      await ctx.db
        .query("operatorTasks")
        .withIndex("by_orgId_taskNumber", (query) =>
          query.eq("orgId", orgId).eq("taskNumber", "TASK-DEMO-001"),
        )
        .unique(),
    {
      orgId,
      warehouseId,
      taskNumber: "TASK-DEMO-001",
      kind: "SUPERVISOR_ASSIGNED",
      instruction: "ตรวจสอบป้าย QR และความเรียบร้อยของโซน DEMO-BLDG-F01-Z01",
      status: "AVAILABLE",
      itemId: finishedItemId,
      locationId: primaryZone.locationId,
      expectedBaseMinorUnits: 500_000,
      dueAt: now + 86_400_000,
      evidenceCount: 0,
      createdByUserId: actorUserId,
    },
  );

  await ensure(
    ctx,
    stats,
    "operatorTaskExceptions",
    async () => {
      const exceptions = await ctx.db
        .query("operatorTaskExceptions")
        .withIndex("by_orgId_operatorTaskId_reportedAt", (query) =>
          query.eq("orgId", orgId).eq("operatorTaskId", operatorTaskId),
        )
        .take(25);

      return (
        exceptions.find(
          (exception) => exception.evidence === "DEMO:STACK-LABEL-DAMAGED",
        ) ?? null
      );
    },
    {
      orgId,
      warehouseId,
      operatorTaskId,
      reasonCodeId: damagedReasonId,
      reasonCode: "DAMAGED",
      reasonName: "ป้ายกองจัดเก็บเสียหาย",
      summary:
        "ป้าย QR ของกอง DEMO-BLDG-F01-Z01 อ่านไม่ชัด ต้องพิมพ์ใหม่ก่อนรอบตรวจนับ",
      evidence: "DEMO:STACK-LABEL-DAMAGED",
      proposedDisposition: "ESCALATE",
      proposedRecoveryAction:
        "พิมพ์ป้าย QR ใหม่และยืนยันด้วยเครื่องสแกน HH-DEMO-01",
      status: "OPEN",
      reportedByUserId: actorUserId,
      reportedAt: now - 45 * 60_000,
    },
  );

  const receivingExceptionNote =
    "ตัวอย่างเดโม: พาเลตกระดาษ 1 พาเลตมีมุมยุบ รอหัวหน้าคลังตัดสินใจ";
  await ensure(
    ctx,
    stats,
    "receivingExceptions",
    async () => {
      const exceptions = await ctx.db
        .query("receivingExceptions")
        .withIndex("by_orgId_warehouseId_status_kind", (query) =>
          query
            .eq("orgId", orgId)
            .eq("warehouseId", warehouseId)
            .eq("status", "RAISED")
            .eq("kind", "UNEXPECTED"),
        )
        .take(25);

      return (
        exceptions.find(
          (exception) => exception.note === receivingExceptionNote,
        ) ?? null
      );
    },
    {
      orgId,
      warehouseId,
      kind: "UNEXPECTED",
      itemId: boardItemId,
      purchaseOrderId,
      reasonCodeId: damagedReasonId,
      raisedByUserId: actorUserId,
      raisedAt: now - 2 * 3_600_000,
      status: "RAISED",
      note: receivingExceptionNote,
    },
  );

  const adapterId = await ensure(
    ctx,
    stats,
    "integrationAdapters",
    async () =>
      await ctx.db
        .query("integrationAdapters")
        .withIndex("by_orgId_code", (query) =>
          query.eq("orgId", orgId).eq("code", "ERP-DEMO"),
        )
        .unique(),
    {
      orgId,
      code: "ERP-DEMO",
      displayName: "ERP ตัวอย่าง",
      kind: "ERP",
      status: "ENABLED",
      configurationKey: "demo/erp",
      lastSuccessAt: now - 600_000,
      updatedByUserId: actorUserId,
      updatedAt: now,
    },
  );
  await ensure(
    ctx,
    stats,
    "integrationOutboxMessages",
    async () =>
      await ctx.db
        .query("integrationOutboxMessages")
        .withIndex("by_orgId_eventKey", (query) =>
          query
            .eq("orgId", orgId)
            .eq("eventKey", "demo.customer-order.released"),
        )
        .unique(),
    {
      orgId,
      eventKey: "demo.customer-order.released",
      adapterId,
      eventType: "customer_order.released",
      schemaVersion: 1,
      sourceTable: "customerOrders",
      sourceId: customerOrderId,
      payloadJson: JSON.stringify({ orderNumber: "SO-DEMO-26001" }),
      payloadDigest: "demo-payload-digest",
      status: "DELIVERED",
      attemptCount: 1,
      availableAt: now - 600_000,
      deliveredAt: now - 590_000,
      createdAt: now - 600_000,
    },
  );

  const shipmentId = await ensure(
    ctx,
    stats,
    "shipments",
    async () =>
      await ctx.db
        .query("shipments")
        .withIndex("by_orgId_shipmentNumber", (query) =>
          query.eq("orgId", orgId).eq("shipmentNumber", "SHP-DEMO-001"),
        )
        .unique(),
    {
      orgId,
      shipmentNumber: "SHP-DEMO-001",
      fulfillmentOrderId,
      warehouseId,
      status: "READY_TO_LOAD",
      expectedPackageCount: 2,
      loadedPackageCount: 0,
      requestedDeliveryAt: now + 5 * 86_400_000,
      createdByUserId: actorUserId,
      createdAt: now,
      releasedAt: now,
    },
  );
  const tripId = await ensure(
    ctx,
    stats,
    "trips",
    async () =>
      await ctx.db
        .query("trips")
        .withIndex("by_orgId_tripNumber", (query) =>
          query.eq("orgId", orgId).eq("tripNumber", "TRIP-DEMO-001"),
        )
        .unique(),
    {
      orgId,
      tripNumber: "TRIP-DEMO-001",
      warehouseId,
      status: "READY_TO_LOAD",
      vehicleRegistration: "DEMO-1234",
      driverName: "คนขับรถตัวอย่าง",
      driverPhone: "0800000001",
      expectedShipmentCount: 1,
      expectedPackageCount: 2,
      loadedPackageCount: 0,
      createdByUserId: actorUserId,
      createdAt: now,
      releasedAt: now,
    },
  );
  await ensure(
    ctx,
    stats,
    "tripShipments",
    async () =>
      await ctx.db
        .query("tripShipments")
        .withIndex("by_orgId_shipmentId", (query) =>
          query.eq("orgId", orgId).eq("shipmentId", shipmentId),
        )
        .unique(),
    { orgId, tripId, shipmentId, warehouseId, sequence: 1 },
  );
  const shipment = await ctx.db.get(shipmentId);
  if (shipment?.tripId === undefined)
    await ctx.db.patch(shipmentId, { tripId });

  const transferRequestId = await ensure(
    ctx,
    stats,
    "transferRequests",
    async () =>
      await ctx.db
        .query("transferRequests")
        .withIndex("by_orgId_transferNumber", (query) =>
          query.eq("orgId", orgId).eq("transferNumber", "TRF-DEMO-001"),
        )
        .unique(),
    {
      orgId,
      transferNumber: "TRF-DEMO-001",
      sourceWarehouseId: warehouseId,
      destinationWarehouseId: secondaryWarehouseId,
      sourceKind: "REPLENISHMENT",
      purpose: "เติมสินค้าสำเร็จรูปให้คลังสำรอง",
      status: "APPROVED",
      lineCount: 1,
      carrierName: "รถรับส่งภายใน",
      expectedArrivalAt: now + 2 * 86_400_000,
      createdByUserId: actorUserId,
      createdAt: now,
      approvedByUserId: actorUserId,
      approvedAt: now,
    },
  );
  await ensure(
    ctx,
    stats,
    "transferLines",
    async () =>
      await ctx.db
        .query("transferLines")
        .withIndex("by_orgId_transferRequestId_lineNumber", (query) =>
          query
            .eq("orgId", orgId)
            .eq("transferRequestId", transferRequestId)
            .eq("lineNumber", 1),
        )
        .unique(),
    {
      orgId,
      transferRequestId,
      lineNumber: 1,
      itemId: finishedItemId,
      baseUom: "EA",
      quantities: {
        REQUESTED: 100_000,
        DISPATCHED: 0,
        RECEIVED: 0,
        RETURNED: 0,
        DISCREPANCY: 0,
        CANCELLED: 0,
      },
      sourceBucketKey: finishedBucketKey,
      sourceLocationId: primaryZone.locationId,
      lotId: finishedLotId,
      destinationLocationId: secondaryLocationId,
    },
  );

  const rollups = [
    ["RECEIPTS_OPENED", "SITE", 1],
    ["RECEIPT_LINES_POSTED", "SITE", 1],
    ["QC_PENDING", "SITE", 1],
    ["QC_PARKED", "SITE", 0],
    ["PUTAWAY_READY", "SITE", 1],
    ["PUTAWAY_CLAIMED", "SITE", 0],
    ["LOCATION_OCCUPANCY", primaryZone.locationId, 1],
    ["LOCATION_OCCUPANCY", fullZone.locationId, 8],
    ["LOCATION_OCCUPANCY", stagingLocationId, 1],
  ] as const;
  for (const [metric, subjectKey, count] of rollups) {
    await ensureCurrent(
      ctx,
      stats,
      "operationsRollups",
      async () =>
        await ctx.db
          .query("operationsRollups")
          .withIndex("by_orgId_warehouseId_metric_subjectKey", (query) =>
            query
              .eq("orgId", orgId)
              .eq("warehouseId", warehouseId)
              .eq("metric", metric)
              .eq("subjectKey", subjectKey),
          )
          .unique(),
      { orgId, warehouseId, metric, subjectKey, count, updatedAt: now },
    );
  }

  void dockLocationId;
  return stats;
}

export const seedIndustrialSasDemo = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    warehouseId: v.id("warehouses"),
    actorUserId: v.id("users"),
    confirmation: v.string(),
  },
  returns: v.object({ inserted: v.number(), reused: v.number() }),
  handler: seedDemoDataForTenant,
});
