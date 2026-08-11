/**
 * A two-tenant inventory world: the minimal reference rows a ledger posting must
 * validate against, seeded on top of `convex-test`.
 *
 * This is a fixture, not a test. It extends `convex-tenant-world.ts` — the same two
 * organizations, the same warehouses, the same seeded roles — with the `items`,
 * `locations`, `lots`, `handlingUnits`, `owners`, and `reasonCodes` rows the ledger
 * reads to prove ownership (`INV-0003-04`, `INV-0003-05`).
 *
 * ### The collisions are deliberate
 *
 * Tenant B's rows are built to *look* like tenant A's, because a cross-tenant test
 * is only meaningful if the foreign value is plausible:
 *
 * - the same SKU (`WIDGET-001`), the same location code (`DOCK-01`), the same lot
 *   code (`LOT-A`), and the same reason code (`ADJ-01`) exist in both tenants, so a
 *   read that dropped `orgId` would find a row and a read that did not, must not;
 * - tenant B's warehouse code is `ALPHA`, exactly like tenant A's first, inherited
 *   from the base world for the same reason.
 *
 * Every ID handed back is a real Convex document ID of the right table, so a test
 * that posts tenant B's `itemId` into tenant A's transaction is exercising the
 * ownership check rather than a string that merely looks wrong. `vanishedItem` is a
 * real ID whose document has been deleted, which is the third case that must answer
 * identically: absent, foreign, and malformed are one answer (`INV-0002-03`).
 *
 * All data is synthetic — no real customer, supplier, or personal data (PDPA, see
 * `tests/fixtures/README.md`).
 */
import type { GenericId } from "convex/values";

import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexAuthorizationWorld,
  type ConvexTenantWorld,
  type ConvexTestModuleMap,
} from "./convex-tenant-world";

/** The reference rows of one tenant. */
export interface InventoryReferenceRows {
  readonly item: GenericId<"items">;
  /** A second item, tracked `NONE`, for the no-lot path. */
  readonly untrackedItem: GenericId<"items">;
  /** An item declared `LOT_SERIAL`, which the ledger must refuse (D-09). */
  readonly serialItem: GenericId<"items">;
  readonly dock: GenericId<"locations">;
  readonly rack: GenericId<"locations">;
  /** A location in the tenant's *other* warehouse, for the warehouse-edge check. */
  readonly otherWarehouseLocation: GenericId<"locations">;
  readonly lot: GenericId<"lots">;
  /** A lot of `untrackedItem`, for the lot-belongs-to-item check. */
  readonly foreignLot: GenericId<"lots">;
  readonly pallet: GenericId<"handlingUnits">;
  readonly secondPallet: GenericId<"handlingUnits">;
  readonly owner: GenericId<"owners">;
  readonly adjustmentReason: GenericId<"reasonCodes">;
  readonly scrapReason: GenericId<"reasonCodes">;
  readonly reversalReason: GenericId<"reasonCodes">;
}

/** The seeded inventory world: the base tenant world plus both tenants' rows. */
export interface ConvexInventoryWorld extends ConvexTenantWorld {
  readonly authorization: ConvexAuthorizationWorld;
  readonly a: InventoryReferenceRows;
  readonly b: InventoryReferenceRows;
  /** A real `items` ID of tenant A whose document has been deleted. */
  readonly vanishedItem: GenericId<"items">;
}

/** The base UOM every seeded item uses. Thousandths of it are the ledger's units. */
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

/**
 * Seed a fresh two-tenant inventory world.
 *
 * `roleA` defaults to `WAREHOUSE_MANAGER` rather than the base world's
 * `SUPERVISOR`, because that is the seeded role holding both
 * `inventory.transaction.post` and `inventory.transaction.reverse` (catalogue
 * §3.1). A suite that wants to prove a *missing* permission passes a narrower role
 * explicitly.
 */
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

/** Enable consigned stock for one tenant, which ships disabled (D-11). */
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

/**
 * Turn on the tenant setting D-12 reserves for a negative-stock exception.
 *
 * Exists so a test can prove the ledger refuses a negative `AVAILABLE` balance
 * **even with the flag on**: the field is schema-ready and defaults `false`, and the
 * exception design it belongs to — the permission, the approval, the audit trail —
 * is not implemented (`RG-030`). Nothing in `convex/` reads it.
 */
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

/** Every ledger line of one tenant, read outside any wrapper. */
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

/** Every transaction of one tenant, newest last, read outside any wrapper. */
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

/** Every balance row of one tenant, read outside any wrapper. */
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

/** Every idempotency record of one tenant, read outside any wrapper. */
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
