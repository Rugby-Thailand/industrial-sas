import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
} from "../fixtures/convex-tenant-world";

const identity = { subject: "user_fixture_a", org_id: "org_fixture_a" };
const endpoints = [
  "getStorageBuilding",
  "getStorageBuildingLayout",
  "getStorageBuildingInventory",
];

describe("building route IDs at the public query boundary", () => {
  it.each(endpoints)(
    "%s treats malformed, missing and inaccessible building IDs alike while preserving authentication",
    async (endpoint) => {
      const world = await createConvexTenantWorld({
        "../convex/storageLayouts/catalogue.ts": () =>
          import("../../convex/storageLayouts/catalogue"),
      });
      await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
      const ids = await world.t.run(async (ctx) => {
        const row = {
          orgId: world.orgA,
          warehouseId: world.warehouses.alphaA,
          code: "ROUTE-ID",
          name: "Route lookup",
          widthMm: 1000,
          depthMm: 1000,
          defaultFloorHeightMm: 3000,
          floorCount: 0,
          totalHeightMm: 0,
          grossAreaSqMm: 0,
          reservedAreaSqMm: 0,
          usableAreaSqMm: 0,
          status: "DRAFT" as const,
          version: 1,
          createdAt: 1,
          updatedAt: 1,
          createdByUserId: world.userA,
          updatedByUserId: world.userA,
        };
        const valid = await ctx.db.insert("storageBuildings", row);
        const missing = await ctx.db.insert("storageBuildings", row);
        await ctx.db.delete("storageBuildings", missing);
        const otherWarehouse = await ctx.db.insert("storageBuildings", {
          ...row,
          warehouseId: world.warehouses.bravoA,
        });
        const otherTenant = await ctx.db.insert("storageBuildings", {
          ...row,
          orgId: world.orgB,
          warehouseId: world.warehouses.alphaB,
        });
        return { valid, missing, otherWarehouse, otherTenant };
      });
      const query = makeFunctionReference<"query">(
        `storageLayouts/catalogue:${endpoint}`,
      );
      const warehouseId = world.warehouses.alphaA;
      const signed = world.t.withIdentity(identity);
      for (const buildingId of [
        "",
        "not-a-building-id",
        world.warehouses.alphaA,
        ids.missing,
        ids.otherWarehouse,
        ids.otherTenant,
      ]) {
        await expect(
          signed.query(query, { warehouseId, buildingId }),
        ).resolves.toMatchObject({ ok: true, value: { found: false } });
      }
      await expect(
        signed.query(query, { warehouseId, buildingId: ids.valid }),
      ).resolves.toMatchObject({ ok: true, value: { found: true } });
      await expect(
        world.t.query(query, { warehouseId, buildingId: "not-a-building-id" }),
      ).rejects.toMatchObject({
        data: { kind: "TENANT_CONTEXT_DENIED", code: "ANONYMOUS" },
      });
    },
  );
});
