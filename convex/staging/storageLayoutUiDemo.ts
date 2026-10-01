import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

/** Add-only, local fixtures for reviewing the responsive storage workspace. */
export const seed = internalMutation({
  args: {
    warehouseId: v.id("warehouses"),
    actorUserId: v.id("users"),
    confirmation: v.literal("LOCAL_STORAGE_LAYOUT_UI_B_V1"),
  },
  handler: async (ctx, args) => {
    const url = process.env.CONVEX_CLOUD_URL ?? process.env.CONVEX_URL ?? "";
    if (
      process.env.ALLOW_LOCAL_TEST_SEED !== "true" ||
      !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(url)
    )
      throw new Error("Storage UI fixtures require the enabled local backend");
    const warehouse = await ctx.db.get(args.warehouseId);
    const actor = await ctx.db.get(args.actorUserId);
    if (!warehouse || !actor) throw new Error("Seed the local demo first");
    const orgId = warehouse.orgId;
    const common = { orgId, warehouseId: warehouse._id };
    const now = Date.now();
    const audit = {
      createdAt: now,
      updatedAt: now,
      createdByUserId: actor._id,
      updatedByUserId: actor._id,
    };
    const product = await ctx.db
      .query("finishedGoodsProducts")
      .withIndex("by_orgId_warehouseId_sku", (q) =>
        q
          .eq("orgId", orgId)
          .eq("warehouseId", warehouse._id)
          .eq("sku", "DEMO-CARTON"),
      )
      .unique();
    if (!product) throw new Error("Demo product missing");
    const building = async (
      code: string,
      name: string,
      count: number,
      status: "DRAFT" | "ARCHIVED",
      widthMm = 30000,
      depthMm = 20000,
      defaultFloorHeightMm = 4000,
    ) => {
      const existing = await ctx.db
        .query("storageBuildings")
        .withIndex("by_orgId_warehouseId_code", (q) =>
          q
            .eq("orgId", orgId)
            .eq("warehouseId", warehouse._id)
            .eq("code", code),
        )
        .unique();
      if (existing) return existing._id;
      return ctx.db.insert("storageBuildings", {
        ...common,
        ...audit,
        code,
        name,
        widthMm,
        depthMm,
        defaultFloorHeightMm,
        floorCount: count,
        totalHeightMm: count * defaultFloorHeightMm,
        grossAreaSqMm: count * widthMm * depthMm,
        reservedAreaSqMm: 0,
        usableAreaSqMm: count * widthMm * depthMm,
        status,
        version: 1,
      });
    };
    const buildingId = await building(
      "UI-B-DEMO",
      "อาคารสาธิต UI B — เลือกชั้น ดูผัง รายการ และรายละเอียด",
      4,
      "DRAFT",
    );
    const emptyBuildingId = await building(
      "UI-B-NO-FLOORS",
      "อาคารตัวอย่างยังไม่มีชั้น",
      0,
      "DRAFT",
    );
    const archivedBuildingId = await building(
      "UI-B-ARCHIVED",
      "อาคารตัวอย่างเก็บถาวร · อ่านอย่างเดียว",
      1,
      "ARCHIVED",
    );
    const floors: Id<"storageFloors">[] = [];
    for (const [target, numbers] of [
      [buildingId, [1, 2, 3, 4]],
      [archivedBuildingId, [1]],
    ] as const) {
      for (const floorNumber of numbers) {
        let floor = await ctx.db
          .query("storageFloors")
          .withIndex("by_orgId_buildingId_floorNumber", (q) =>
            q
              .eq("orgId", orgId)
              .eq("buildingId", target)
              .eq("floorNumber", floorNumber),
          )
          .unique();
        if (!floor) {
          const widthMm = floorNumber === 4 ? 18000 : 30000;
          const depthMm = floorNumber === 4 ? 12000 : 20000;
          const floorId = await ctx.db.insert("storageFloors", {
            ...common,
            buildingId: target,
            floorNumber,
            widthMm,
            depthMm,
            heightMm: 4000,
            offsetXMm: floorNumber === 4 ? 6000 : 0,
            offsetYMm: floorNumber === 4 ? 4000 : 0,
            grossAreaSqMm: widthMm * depthMm,
            reservedAreaSqMm: 0,
            usableAreaSqMm: widthMm * depthMm,
            version: 1,
            updatedAt: now,
            updatedByUserId: actor._id,
          });
          floor = await ctx.db.get(floorId);
        }
        if (target === buildingId && floor) floors.push(floor._id);
      }
    }
    if (floors.length !== 4) throw new Error("Demo floors incomplete");
    const zone = async (
      floorId: Id<"storageFloors">,
      code: string,
      label: string,
      xMm: number,
      yMm: number,
      widthMm: number,
      depthMm: number,
      grouped = false,
      targetBuildingId = buildingId,
    ) => {
      let item = await ctx.db
        .query("storageZones")
        .withIndex("by_orgId_warehouseId_code", (q) =>
          q
            .eq("orgId", orgId)
            .eq("warehouseId", warehouse._id)
            .eq("code", code),
        )
        .unique();
      if (!item) {
        const locationId = await ctx.db.insert("locations", {
          ...common,
          code,
          locationType: "FLOOR_BLOCK",
          status: "ACTIVE",
        });
        const id = await ctx.db.insert("storageZones", {
          ...common,
          ...audit,
          buildingId: targetBuildingId,
          floorId,
          locationId,
          code,
          label,
          qrValue: `ISAS:LOCATION:1:${locationId}`,
          mode: grouped ? "FLOOR_POSITIONS" : "SIMPLE",
          xMm,
          yMm,
          widthMm,
          depthMm,
          maxStackHeightMm: 3000,
          storageCondition: "AMBIENT",
          status: "ACTIVE",
          ...(grouped
            ? {
                importNote:
                  "ข้อมูลนำเข้าจำลอง: กลุ่ม 15 ตำแหน่ง รักษาสัดส่วนจริงและทางเดิน 0.30 ม.",
              }
            : {}),
        });
        item = await ctx.db.get(id);
      }
      if (!item) throw new Error("Zone fixture missing");
      return item;
    };
    const zones = [];
    for (let i = 0; i < 30; i++)
      zones.push(
        await zone(
          floors[0]!,
          `UI-B-F01-${String(i + 1).padStart(2, "0")}`,
          i === 0
            ? "สินค้าจัดเก็บ · กล่องบรรจุภัณฑ์"
            : i === 1
              ? "จุดจองสินค้า · เตรียมจัดส่ง"
              : i === 2
                ? "สินค้าที่ไม่มีพิกัด · ยังไม่ได้วัดขนาด"
                : i === 29
                  ? "จุดจัดเก็บชื่อยาวสำหรับทดสอบข้อความภาษาไทยและภาษาอังกฤษ Long storage location name"
                  : `จุดจัดเก็บ ${i + 1} · ว่าง`,
          (i % 5) * 5000,
          Math.floor(i / 5) * 3000,
          4000,
          2300,
        ),
      );
    const group = await zone(
      floors[1]!,
      "UI-B-GROUP-L1",
      "กลุ่มตำแหน่งนำเข้า · 15 จุด",
      0,
      0,
      7000,
      4150,
      true,
    );
    for (let i = 0; i < 15; i++) {
      const code = `UI-B-GROUP-L1-${15 - i}`;
      const existing = await ctx.db
        .query("storagePositions")
        .withIndex("by_orgId_warehouseId_code", (q) =>
          q
            .eq("orgId", orgId)
            .eq("warehouseId", warehouse._id)
            .eq("code", code),
        )
        .unique();
      if (existing) continue;
      const locationId = await ctx.db.insert("locations", {
        ...common,
        code,
        locationType: "FLOOR_BLOCK",
        status: "ACTIVE",
      });
      await ctx.db.insert("storagePositions", {
        ...common,
        ...audit,
        buildingId,
        floorId: floors[1]!,
        zoneId: group._id,
        locationId,
        code,
        label: code,
        qrValue: `ISAS:LOCATION:1:${locationId}`,
        kind: "FLOOR",
        isDefault: false,
        xMm: (i % 5) * 1400,
        yMm: Math.floor(i / 5) * 1283,
        widthMm: 1400,
        depthMm: 983,
        status: "ACTIVE",
      });
    }
    for (let i = 0; i < 3; i++)
      await zone(
        floors[3]!,
        `UI-B-F04-${i + 1}`,
        `จุดชั้นบน ${i + 1}`,
        i * 5000,
        0,
        4000,
        4000,
      );
    const blocks = [
      {
        floorId: floors[0]!,
        label: "ทางเดินหลัก · Main aisle",
        xMm: 0,
        yMm: 18500,
        widthMm: 30000,
        depthMm: 1500,
        color: "#FFB68E",
      },
      {
        floorId: floors[1]!,
        label: "พื้นที่ห้ามจัดเก็บ · ทางหนีไฟ",
        xMm: 8000,
        yMm: 0,
        widthMm: 1000,
        depthMm: 20000,
        color: "#E8A0A0",
      },
    ];
    for (const block of blocks) {
      const existing = await ctx.db
        .query("storageFloorReservedBlocks")
        .withIndex("by_orgId_floorId", (q) =>
          q.eq("orgId", orgId).eq("floorId", block.floorId),
        )
        .collect();
      if (!existing.some((b) => b.label === block.label))
        await ctx.db.insert("storageFloorReservedBlocks", {
          ...common,
          buildingId,
          ...block,
          createdAt: now,
          updatedAt: now,
        });
    }
    let gross = 0,
      reserved = 0;
    for (const floorId of floors) {
      const floor = await ctx.db.get(floorId);
      if (!floor) continue;
      const blocks = await ctx.db
        .query("storageFloorReservedBlocks")
        .withIndex("by_orgId_floorId", (q) =>
          q.eq("orgId", orgId).eq("floorId", floorId),
        )
        .collect();
      const area = blocks.reduce((sum, b) => sum + b.widthMm * b.depthMm, 0);
      gross += floor.grossAreaSqMm;
      reserved += area;
      if (floor.reservedAreaSqMm !== area)
        await ctx.db.patch(floorId, {
          reservedAreaSqMm: area,
          usableAreaSqMm: floor.grossAreaSqMm - area,
        });
    }
    await ctx.db.patch(buildingId, {
      grossAreaSqMm: gross,
      reservedAreaSqMm: reserved,
      usableAreaSqMm: gross - reserved,
    });
    for (let i = 0; i < 10; i++) {
      const code = `UI-B-PALLET-${String(i + 1).padStart(2, "0")}`;
      const existing = await ctx.db
        .query("finishedGoodsPallets")
        .withIndex("by_orgId_warehouseId_code", (q) =>
          q
            .eq("orgId", orgId)
            .eq("warehouseId", warehouse._id)
            .eq("code", code),
        )
        .unique();
      if (existing) continue;
      const noGeometry = i >= 8;
      const status =
        i >= 4 && i < 8 ? ("RESERVED" as const) : ("STORED" as const);
      const selected = zones[noGeometry ? 2 : i < 4 ? 0 : 1]!;
      const palletId = await ctx.db.insert("finishedGoodsPallets", {
        ...common,
        ...audit,
        productId: product._id,
        code,
        quantity: 24,
        storageFormat: "PALLET",
        status,
        ...(noGeometry
          ? {}
          : { lengthMm: 1000, widthMm: 1000, heightMm: 1000, weightKg: 100 }),
      });
      const base = {
        ...common,
        ...audit,
        palletId,
        buildingId,
        floorId: floors[0]!,
        zoneId: selected._id,
        locationId: selected.locationId,
        positionCode: `${selected.code}-P${i + 1}`,
        qrValue: `ISAS:FG:${code}`,
        status,
        verifiedAt: now,
        verifiedByUserId: actor._id,
        verificationMethod: "MANUAL" as const,
      };
      let placementId: Id<"finishedGoodsPlacements">;
      if (noGeometry) {
        const assignmentId = await ctx.db.insert(
          "finishedGoodsScanAssignments",
          {
            ...common,
            requestId: `ui-b-${code}`,
            orderedUnitIds: [palletId],
            placementIds: [],
            sameSize: false,
            fillPercents: [100],
            zoneId: selected._id,
            locationId: selected.locationId,
            buildingId,
            floorId: floors[0]!,
            locationCode: selected.code,
            locationName: selected.label,
            locationVersion: "ui-b-demo-v1",
            verificationMethod: "MANUAL",
            verifiedCode: selected.code,
            createdAt: now,
            createdByUserId: actor._id,
          },
        );
        placementId = await ctx.db.insert("finishedGoodsPlacements", {
          ...base,
          mode: "LOCATION_ONLY",
          assignmentId,
          sequence: 0,
        });
        await ctx.db.patch(assignmentId, { placementIds: [placementId] });
      } else
        placementId = await ctx.db.insert("finishedGoodsPlacements", {
          ...base,
          mode: "GEOMETRIC",
          xMm: (i % 4) * 1000,
          yMm: 0,
          zMm: 0,
          widthMm: 1000,
          depthMm: 1000,
          heightMm: 1000,
          rotation: 0,
        });
      await ctx.db.patch(palletId, { placementId });
    }
    // Reference-shaped data lives in a separate building; real geometry is not stretched.
    const referenceBuildingId = await building(
      "UI-B-REFERENCE",
      "FG1 · Canvas design reference",
      1,
      "DRAFT",
      12260,
      29930,
      3300,
    );
    let referenceFloor = await ctx.db
      .query("storageFloors")
      .withIndex("by_orgId_buildingId_floorNumber", (q) =>
        q
          .eq("orgId", orgId)
          .eq("buildingId", referenceBuildingId)
          .eq("floorNumber", 1),
      )
      .unique();
    if (!referenceFloor) {
      const id = await ctx.db.insert("storageFloors", {
        ...common,
        buildingId: referenceBuildingId,
        floorNumber: 1,
        widthMm: 12260,
        depthMm: 29930,
        heightMm: 3300,
        offsetXMm: 0,
        offsetYMm: 0,
        grossAreaSqMm: 12260 * 29930,
        reservedAreaSqMm: 0,
        usableAreaSqMm: 12260 * 29930,
        version: 1,
        updatedAt: now,
        updatedByUserId: actor._id,
      });
      referenceFloor = await ctx.db.get(id);
    }
    if (!referenceFloor) throw new Error("Reference floor missing");
    for (let i = 0; i < 15; i++) {
      const left = i < 5;
      const code = `FG1-${left ? "L" : "R"}${String(left ? i + 1 : i - 4).padStart(2, "0")}`;
      const item = await zone(
        referenceFloor._id,
        code,
        left ? "ฝั่งซ้าย" : "ฝั่งขวา",
        left ? 1200 : 7200,
        left ? 3500 + i * 5500 : 1500 + (i - 5) * 2500,
        2400,
        left ? 3200 : 1600,
        false,
        referenceBuildingId,
      );
      if (![0, 2, 5, 7, 10, 13].includes(i)) continue;
      for (let j = 0; j < 4; j++) {
        const palletCode = `${code}-PALLET-${j + 1}`;
        const existing = await ctx.db
          .query("finishedGoodsPallets")
          .withIndex("by_orgId_warehouseId_code", (q) =>
            q
              .eq("orgId", orgId)
              .eq("warehouseId", warehouse._id)
              .eq("code", palletCode),
          )
          .unique();
        if (existing) continue;
        const palletId = await ctx.db.insert("finishedGoodsPallets", {
          ...common,
          ...audit,
          productId: product._id,
          code: palletCode,
          quantity: 24,
          storageFormat: "PALLET",
          status: "STORED",
          lengthMm: 1000,
          widthMm: 1000,
          heightMm: 1000,
          weightKg: 100,
        });
        const placementId = await ctx.db.insert("finishedGoodsPlacements", {
          ...common,
          ...audit,
          palletId,
          buildingId: referenceBuildingId,
          floorId: referenceFloor._id,
          zoneId: item._id,
          locationId: item.locationId,
          positionCode: `${code}-P${j + 1}`,
          qrValue: `ISAS:FG:${palletCode}`,
          status: "STORED",
          verifiedAt: now,
          verifiedByUserId: actor._id,
          verificationMethod: "MANUAL",
          mode: "GEOMETRIC",
          xMm: (j % 2) * 1000,
          yMm: Math.floor(j / 2) * 800,
          zMm: 0,
          widthMm: 1000,
          depthMm: 800,
          heightMm: 1000,
          rotation: 0,
        });
        await ctx.db.patch(palletId, { placementId });
      }
    }
    const referenceBlocks = [
      {
        label: "ทางเดิน / AISLE",
        xMm: 5000,
        yMm: 1500,
        widthMm: 1000,
        depthMm: 25500,
        color: "#71825D",
      },
      {
        label: "พื้นที่ห้ามจัดเก็บ · ด้านหน้า",
        xMm: 800,
        yMm: 700,
        widthMm: 3600,
        depthMm: 1600,
        color: "#9C8355",
      },
      {
        label: "พื้นที่ห้ามจัดเก็บ · ด้านหลัง",
        xMm: 7200,
        yMm: 27700,
        widthMm: 4300,
        depthMm: 1400,
        color: "#9C8355",
      },
    ];
    const existingReferenceBlocks = await ctx.db
      .query("storageFloorReservedBlocks")
      .withIndex("by_orgId_floorId", (q) =>
        q.eq("orgId", orgId).eq("floorId", referenceFloor!._id),
      )
      .collect();
    for (const block of referenceBlocks)
      if (!existingReferenceBlocks.some((b) => b.label === block.label))
        await ctx.db.insert("storageFloorReservedBlocks", {
          ...common,
          buildingId: referenceBuildingId,
          floorId: referenceFloor._id,
          ...block,
          createdAt: now,
          updatedAt: now,
        });
    const allReferenceFloors = await ctx.db
      .query("storageFloors")
      .withIndex("by_orgId_buildingId_floorNumber", (q) =>
        q.eq("orgId", orgId).eq("buildingId", referenceBuildingId),
      )
      .collect();
    let referenceGross = 0,
      referenceReserved = 0;
    for (const floor of allReferenceFloors) {
      const areas = await ctx.db
        .query("storageFloorReservedBlocks")
        .withIndex("by_orgId_floorId", (q) =>
          q.eq("orgId", orgId).eq("floorId", floor._id),
        )
        .collect();
      const reservedArea = areas.reduce(
        (sum, b) => sum + b.widthMm * b.depthMm,
        0,
      );
      referenceGross += floor.grossAreaSqMm;
      referenceReserved += reservedArea;
      await ctx.db.patch(floor._id, {
        reservedAreaSqMm: reservedArea,
        usableAreaSqMm: floor.grossAreaSqMm - reservedArea,
      });
    }
    await ctx.db.patch(referenceBuildingId, {
      grossAreaSqMm: referenceGross,
      reservedAreaSqMm: referenceReserved,
      usableAreaSqMm: referenceGross - referenceReserved,
    });
    return {
      buildingId,
      referenceBuildingId,
      emptyBuildingId,
      archivedBuildingId,
      floors: 4,
      locations: 34,
      groupedPositions: 15,
      pallets: 10,
      unmeasuredPallets: 2,
    };
  },
});
