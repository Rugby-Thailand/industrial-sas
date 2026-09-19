import { trackFinishedGoodsWrites } from "../../convex/lib/finishedGoodsSummary";
import { createTenantDocumentAccess } from "../../convex/lib/tenantDb";
import { createMutationTenantStorage } from "../../convex/lib/tenantStorage";
import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";
import { list, page } from "../../convex/storageLayouts/locationCatalogue";
import { listStorageBuildingsPage } from "../../convex/storageLayouts/catalogue";
import { createStorageBuilding } from "../../convex/storageLayouts/writes";
import { createStorageZone } from "../../convex/storageLayouts/zones";
import type { DataModel } from "../../convex/schema";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";
type Runtime = {
  _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
};
async function call(
  world: ConvexTenantWorld,
  fn: unknown,
  args: unknown,
  authenticated = true,
) {
  return (
    authenticated
      ? world.t.withIdentity({
          subject: "user_fixture_a",
          org_id: "org_fixture_a",
        })
      : world.t
  ).run((ctx) =>
    (fn as Runtime)._handler(ctx as GenericMutationCtx<DataModel>, args),
  );
}
async function finishSearch(
  world: ConvexTenantWorld,
  args: Record<string, unknown>,
  scanCursor?: string,
) {
  for (let i = 0; i < 500; i++) {
    const result = (await call(world, page, {
      ...args,
      ...(scanCursor ? { scanCursor } : {}),
    })) as {
      value: { status: string; page: { label: string }[]; scanCursor?: string };
    };
    if (result.value.status !== "scanning") return result.value;
    scanCursor = result.value.scanCursor;
  }
  throw new Error("Search did not finish");
}
async function setup() {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
  const warehouseId = world.warehouses.alphaA;
  const made = (await call(world, createStorageBuilding, {
    warehouseId,
    requestId: "locations-building",
    code: "LOC",
    name: "Location QA",
    widthMm: 30000,
    depthMm: 20000,
    defaultFloorHeightMm: 4000,
    floorCount: 2,
  })) as { value: { documentId: string } };
  for (const floorNumber of [1, 2])
    await call(world, createStorageZone, {
      warehouseId,
      buildingId: made.value.documentId,
      requestId: `location-${floorNumber}`,
      floorNumber,
      label: `Spot ${floorNumber}`,
      xMm: 0,
      yMm: 0,
      widthMm: 2000,
      depthMm: 2000,
      maxStackHeightMm: 3000,
    });
  return world;
}
describe("warehouse location catalogue", () => {
  it("includes every floor and archived locations without the old 50-zone truncation", async () => {
    const world = await setup();
    await world.t.run(async (ctx) => {
      const zones = await ctx.db.query("storageZones").collect();
      const first = zones[0]!;
      await ctx.db.patch(zones[1]!._id, { status: "INACTIVE" });
      const { _id, _creationTime, ...fields } = first;
      void _id;
      void _creationTime;
      for (let i = 0; i < 51; i++)
        await ctx.db.insert("storageZones", {
          ...fields,
          code: `EXTRA-${i}`,
          label: `Extra ${i}`,
        });
    });
    const result = (await call(world, list, {
      warehouseId: world.warehouses.alphaA,
    })) as {
      ok: boolean;
      value: { label: string; floorNumber: number; status: string }[];
    };
    expect(result.ok).toBe(true);
    expect(result.value).toHaveLength(53);
    expect(result.value).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Spot 1",
          floorNumber: 1,
          status: "DRAFT",
        }),
        expect.objectContaining({
          label: "Spot 2",
          floorNumber: 2,
          status: "ARCHIVED",
        }),
      ]),
    );
  });
  it("refuses out-of-scope, unauthenticated and foreign-tenant reads", async () => {
    const world = await setup();
    await expect(
      call(world, list, { warehouseId: world.warehouses.bravoA }),
    ).rejects.toThrow("WAREHOUSE_OUT_OF_SCOPE");
    await expect(
      call(world, list, { warehouseId: world.warehouses.alphaB }),
    ).rejects.toThrow("WAREHOUSE_UNKNOWN");
    await expect(
      call(world, list, { warehouseId: world.warehouses.alphaA }, false),
    ).rejects.toThrow();
  });
  it("traverses 101 buildings and searches a late location with combined filters", async () => {
    const world = await setup();
    await world.t.run(async (ctx) => {
      const source = (await ctx.db.query("storageBuildings").collect())[0]!;
      const { _id, _creationTime, ...fields } = source;
      void _id;
      void _creationTime;
      for (let i = 0; i < 100; i++)
        await ctx.db.insert("storageBuildings", {
          ...fields,
          code: `Z-${String(i).padStart(3, "0")}`,
          name: `Building ${i}`,
        });
      const zones = await ctx.db.query("storageZones").collect();
      await ctx.db.patch(zones[1]!._id, {
        label: "ปลายทาง needle",
        status: "INACTIVE",
      });
    });
    type Page = {
      status: string;
      page: { buildingId?: string; label?: string }[];
      isDone: boolean;
      continueCursor: string;
      scanCursor?: string;
    };
    const warehouseId = world.warehouses.alphaA;
    const ids: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 8; i++) {
      const result = (await call(world, listStorageBuildingsPage, {
        warehouseId,
        pageSize: 20,
        ...(cursor ? { cursor } : {}),
      })) as { value: Page };
      expect(result.value.status).toBe("ready");
      ids.push(...result.value.page.map((row) => row.buildingId!));
      if (result.value.isDone) break;
      cursor = result.value.continueCursor;
    }
    expect(ids).toHaveLength(101);
    expect(new Set(ids).size).toBe(101);
    const found = await finishSearch(world, {
      warehouseId,
      pageSize: 20,
      search: "needle",
      status: "ARCHIVED",
      floorNumber: 2,
    });
    expect(found.page.map((row) => row.label)).toEqual(["ปลายทาง needle"]);
    await expect(
      call(world, page, { warehouseId: world.warehouses.alphaB, pageSize: 20 }),
    ).rejects.toThrow("WAREHOUSE_UNKNOWN");
  });
  it("invalidates a partial search when an earlier location changes", async () => {
    const world = await setup();
    const zoneId = await world.t.run(async (ctx) => {
      const source = (await ctx.db.query("storageZones").collect())[0]!;
      const { _id, _creationTime, ...fields } = source;
      void _creationTime;
      for (let i = 0; i < 30; i++)
        await ctx.db.insert("storageZones", {
          ...fields,
          code: `Z-${i}`,
          label: `Zone ${i}`,
        });
      return _id;
    });
    const args = {
      warehouseId: world.warehouses.alphaA,
      pageSize: 20,
      search: "renamed",
    };
    const first = (await call(world, page, args)) as {
      value: { status: string; scanCursor: string };
    };
    expect(first.value.status).toBe("scanning");
    await world.t.run(async (ctx) => {
      const db = createTenantDocumentAccess(
        { orgId: world.orgA, requestId: "location-revision" },
        createMutationTenantStorage(ctx, "location-revision"),
      );
      const tracked = trackFinishedGoodsWrites(db);
      await tracked.db.patch("storageZones", zoneId, { label: "renamed" });
      await tracked.flush();
    });
    const second = (await call(world, page, {
      ...args,
      scanCursor: first.value.scanCursor,
    })) as { value: { status: string; scanCursor: string; scanned: number } };
    expect(second.value.status).toBe("scanning");
    expect(second.value.scanned).toBe(0);
    const completed = await finishSearch(world, args, second.value.scanCursor);
    expect(completed.status).toBe("ready");
    expect(completed.page.map((row) => row.label)).toEqual(["renamed"]);
  });
  it("finds archived sublocation text beyond the active-position limit", async () => {
    const world = await setup();
    await world.t.run(async (ctx) => {
      const zone = (await ctx.db.query("storageZones").collect())[0]!;
      for (let i = 0; i < 120; i++)
        await ctx.db.insert("storagePositions", {
          orgId: world.orgA,
          warehouseId: zone.warehouseId,
          buildingId: zone.buildingId,
          floorId: zone.floorId,
          zoneId: zone._id,
          locationId: zone.locationId,
          code: `HIST-${String(i).padStart(3, "0")}`,
          label: i === 119 ? "ตำแหน่งเก่า needle" : "Historical position",
          qrValue: `HIST:${i}`,
          kind: "FLOOR",
          isDefault: false,
          status: "INACTIVE",
          createdAt: 1,
          updatedAt: 1,
          createdByUserId: world.userA,
          updatedByUserId: world.userA,
        });
    });
    const result = await finishSearch(world, {
      warehouseId: world.warehouses.alphaA,
      pageSize: 20,
      search: "ตำแหน่งเก่า needle",
    });
    expect(result.page.map((row) => row.label)).toEqual(["Spot 1"]);
  });
});
