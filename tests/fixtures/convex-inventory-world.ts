import type { GenericId } from "convex/values";

import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexAuthorizationWorld,
  type ConvexTenantWorld,
  type ConvexTestModuleMap,
} from "./convex-tenant-world";

export interface InventoryReferenceRows {
  readonly item: GenericId<"items">;

  readonly untrackedItem: GenericId<"items">;

  readonly serialItem: GenericId<"items">;
  readonly dock: GenericId<"locations">;
  readonly rack: GenericId<"locations">;

  readonly otherWarehouseLocation: GenericId<"locations">;
  readonly lot: GenericId<"lots">;

  readonly foreignLot: GenericId<"lots">;
  readonly pallet: GenericId<"handlingUnits">;
  readonly secondPallet: GenericId<"handlingUnits">;
  readonly owner: GenericId<"owners">;
  readonly adjustmentReason: GenericId<"reasonCodes">;
  readonly scrapReason: GenericId<"reasonCodes">;
  readonly reversalReason: GenericId<"reasonCodes">;
}

export interface ConvexInventoryWorld extends ConvexTenantWorld {
  readonly authorization: ConvexAuthorizationWorld;
  readonly a: InventoryReferenceRows;
  readonly b: InventoryReferenceRows;

  readonly vanishedItem: GenericId<"items">;
}

export const FIXTURE_UOM = "PCS";

async function seedReferenceRows(
  world: ConvexTenantWorld,
  orgId: GenericId<"organizations">,
  warehouseId: GenericId<"warehouses">,
  otherWarehouseId: GenericId<"warehouses">,
): Promise<InventoryReferenceRows> {
  return await world.t.run(async (ctx) => {
    const item = await ctx.db.insert("items", {
      orgId,
      sku: "WIDGET-001",
      name: "Widget",
      baseUom: FIXTURE_UOM,
      trackingMode: "LOT",
      status: "ACTIVE",
    });
    const untrackedItem = await ctx.db.insert("items", {
      orgId,
      sku: "BULK-001",
      name: "Bulk material",
      baseUom: FIXTURE_UOM,
      trackingMode: "NONE",
      status: "ACTIVE",
    });
    const serialItem = await ctx.db.insert("items", {
      orgId,
      sku: "SERIAL-001",
      name: "Serialized unit",
      baseUom: FIXTURE_UOM,
      trackingMode: "LOT_SERIAL",
      status: "ACTIVE",
    });

    const dock = await ctx.db.insert("locations", {
      orgId,
      warehouseId,
      code: "DOCK-01",
      locationType: "DOCK",
      status: "ACTIVE",
    });
    const rack = await ctx.db.insert("locations", {
      orgId,
      warehouseId,
      code: "RACK-01",
      locationType: "RACK_BIN",
      status: "ACTIVE",
    });
    const otherWarehouseLocation = await ctx.db.insert("locations", {
      orgId,
      warehouseId: otherWarehouseId,
      code: "DOCK-01",
      locationType: "DOCK",
      status: "ACTIVE",
    });

    const lot = await ctx.db.insert("lots", {
      orgId,
      itemId: item,
      lotCode: "LOT-A",
      expirationDate: "2027-01-31",
      status: "ACTIVE",
    });
    const foreignLot = await ctx.db.insert("lots", {
      orgId,
      itemId: untrackedItem,
      lotCode: "LOT-B",
      status: "ACTIVE",
    });

    const pallet = await ctx.db.insert("handlingUnits", {
      orgId,
      warehouseId,
      lpn: "INV-0001-01",
      status: "ACTIVE",
    });
    const secondPallet = await ctx.db.insert("handlingUnits", {
      orgId,
      warehouseId,
      lpn: "INV-0002-02",
      status: "ACTIVE",
    });

    const owner = await ctx.db.insert("owners", {
      orgId,
      code: "OWNER-01",
      name: "Consignor",
      status: "ACTIVE",
    });

    const reason = async (
      code: string,
      scope: "ADJUSTMENT" | "SCRAP" | "REVERSAL" | "STATUS_CHANGE",
    ): Promise<GenericId<"reasonCodes">> =>
      await ctx.db.insert("reasonCodes", {
        orgId,
        code,
        name: code,
        scope,
        status: "ACTIVE",
      });

    return {
      item,
      untrackedItem,
      serialItem,
      dock,
      rack,
      otherWarehouseLocation,
      lot,
      foreignLot,
      pallet,
      secondPallet,
      owner,
      adjustmentReason: await reason("ADJ-01", "ADJUSTMENT"),
      scrapReason: await reason("SCR-01", "SCRAP"),
      reversalReason: await reason("REV-01", "REVERSAL"),
    };
  });
}

export async function createConvexInventoryWorld(
  modules: ConvexTestModuleMap = {},
  options: { readonly roleA?: string; readonly roleB?: string } = {},
): Promise<ConvexInventoryWorld> {
  const world = await createConvexTenantWorld(modules);
  const authorization = await seedConvexAuthorization(world, {
    roleA: options.roleA ?? "WAREHOUSE_MANAGER",
    roleB: options.roleB ?? "ORG_ADMIN",
  });

  const a = await seedReferenceRows(
    world,
    world.orgA,
    world.warehouses.alphaA,
    world.warehouses.bravoA,
  );
  const b = await seedReferenceRows(
    world,
    world.orgB,
    world.warehouses.alphaB,
    world.warehouses.alphaB,
  );

  const vanishedItem = await world.t.run(async (ctx) => {
    const id = await ctx.db.insert("items", {
      orgId: world.orgA,
      sku: "GONE-001",
      name: "Deleted",
      baseUom: FIXTURE_UOM,
      trackingMode: "NONE",
      status: "ACTIVE",
    });
    await ctx.db.delete("items", id);
    return id;
  });

  return { ...world, authorization, a, b, vanishedItem };
}

export async function enableConsignedStock(
  world: ConvexInventoryWorld,
  orgId: GenericId<"organizations">,
): Promise<void> {
  await world.t.run(async (ctx) => {
    const organization = await ctx.db.get("organizations", orgId);
    if (organization === null) throw new Error("missing organization");
    await ctx.db.patch("organizations", orgId, {
      settings: { ...organization.settings, consignedStockEnabled: true },
    });
  });
}

export async function enableNegativeAvailable(
  world: ConvexInventoryWorld,
  orgId: GenericId<"organizations">,
): Promise<void> {
  await world.t.run(async (ctx) => {
    const organization = await ctx.db.get("organizations", orgId);
    if (organization === null) throw new Error("missing organization");
    await ctx.db.patch("organizations", orgId, {
      settings: { ...organization.settings, negativeAvailableAllowed: true },
    });
  });
}

export async function storedLedgerLines(
  world: ConvexInventoryWorld,
  orgId: GenericId<"organizations">,
): Promise<readonly Record<string, unknown>[]> {
  return await world.t.run(
    async (ctx) =>
      await ctx.db
        .query("inventoryLedgerLines")
        .withIndex("by_orgId_bucketKey_occurredAt", (query) =>
          query.eq("orgId", orgId),
        )
        .take(200),
  );
}

export async function storedTransactions(
  world: ConvexInventoryWorld,
  orgId: GenericId<"organizations">,
): Promise<readonly Record<string, unknown>[]> {
  return await world.t.run(
    async (ctx) =>
      await ctx.db
        .query("inventoryTransactions")
        .withIndex("by_orgId_occurredAt", (query) => query.eq("orgId", orgId))
        .take(200),
  );
}

export async function storedBalances(
  world: ConvexInventoryWorld,
  orgId: GenericId<"organizations">,
): Promise<readonly Record<string, unknown>[]> {
  return await world.t.run(
    async (ctx) =>
      await ctx.db
        .query("inventoryBalances")
        .withIndex("by_orgId_bucketKey", (query) => query.eq("orgId", orgId))
        .take(200),
  );
}

export async function storedIdempotencyRecords(
  world: ConvexInventoryWorld,
  orgId: GenericId<"organizations">,
): Promise<readonly Record<string, unknown>[]> {
  return await world.t.run(
    async (ctx) =>
      await ctx.db
        .query("idempotencyRecords")
        .withIndex("by_orgId_expiresAt", (query) => query.eq("orgId", orgId))
        .take(200),
  );
}
