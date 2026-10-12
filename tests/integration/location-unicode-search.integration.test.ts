import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import type { DataModel } from "../../convex/schema";
import { page } from "../../convex/storageLayouts/locationCatalogue";
import { createStorageBuilding } from "../../convex/storageLayouts/writes";
import { createStorageZone } from "../../convex/storageLayouts/zones";
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
type CataloguePage = {
  status: string;
  isDone: boolean;
  page: { _id: string }[];
};

async function invoke<T>(
  world: ConvexTenantWorld,
  fn: unknown,
  args: unknown,
): Promise<T> {
  const result = (await world.t
    .withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_a" })
    .run((ctx) =>
      (fn as Runtime)._handler(ctx as GenericMutationCtx<DataModel>, args),
    )) as { ok: boolean; value: T };
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return result.value;
}

describe("physical location catalogue Unicode search", () => {
  it.each([
    { field: "building", text: "Cafe\u0301" },
    { field: "zone", text: "Re\u0301serve" },
    { field: "descendant", text: "Cre\u0300me bru\u0302le\u0301e" },
  ])("matches NFC/NFD equivalents in $field text", async ({ field, text }) => {
    const world = await createConvexTenantWorld();
    await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
    const warehouseId = world.warehouses.alphaA;
    const building = await invoke<{ documentId: Id<"storageBuildings"> }>(
      world,
      createStorageBuilding,
      {
        warehouseId,
        requestId: `unicode-building-${field}`,
        code: "UNICODE",
        name: field === "building" ? text : "Unicode building",
        widthMm: 10000,
        depthMm: 10000,
        defaultFloorHeightMm: 4000,
        floorCount: 1,
      },
    );
    const created = await invoke<{ documentId: Id<"storageZones"> }>(
      world,
      createStorageZone,
      {
        warehouseId,
        buildingId: building.documentId,
        requestId: `unicode-zone-${field}`,
        floorNumber: 1,
        label: field === "zone" ? text : "Plain rack",
        xMm: 0,
        yMm: 0,
        widthMm: 1000,
        depthMm: 1000,
        maxStackHeightMm: 3000,
      },
    );

    await world.t.run(async (ctx) => {
      const zone = (await ctx.db.get(created.documentId))!;
      if (field === "building")
        expect((await ctx.db.get(building.documentId))!.name).toBe(text);
      if (field === "zone") expect(zone.label).toBe(text);
      if (field !== "descendant") return;
      // Historical child fixture: the growing archive must remain searchable.
      const locationId = await ctx.db.insert("locations", {
        orgId: world.orgA,
        warehouseId,
        buildingId: zone.buildingId,
        floorId: zone.floorId,
        code: "HIST-UNICODE",
        locationType: "FLOOR_BLOCK",
        status: "INACTIVE",
      });
      await ctx.db.insert("storagePositions", {
        orgId: world.orgA,
        warehouseId,
        buildingId: zone.buildingId,
        floorId: zone.floorId,
        zoneId: zone._id,
        locationId,
        code: "HIST-UNICODE",
        label: text,
        qrValue: `ISAS:LOCATION:1:${locationId}`,
        kind: "FLOOR",
        isDefault: false,
        status: "INACTIVE",
        createdAt: 1,
        updatedAt: 1,
        createdByUserId: world.userA,
        updatedByUserId: world.userA,
      });
    });

    expect(text).not.toBe(text.normalize("NFC"));
    for (const search of [
      text.normalize("NFC").toUpperCase(),
      text.toUpperCase(),
    ]) {
      const result = await invoke<CataloguePage>(world, page, {
        warehouseId,
        pageSize: 20,
        search,
      });
      expect(result.status).toBe("ready");
      expect(result.isDone).toBe(true);
      expect(result.page.map((row) => row._id)).toEqual([created.documentId]);
    }
  });
});
