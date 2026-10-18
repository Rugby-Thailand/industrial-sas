import { describe, expect, it } from "vitest";
import type { GenericMutationCtx } from "convex/server";
import type { DataModel } from "../../../../../convex/schema";
import * as workflow from "../../../../../convex/finishedGoods/workflow";
import * as layouts from "../../../../../convex/storageLayouts/writes";
import * as zones from "../../../../../convex/storageLayouts/zones";
import * as scans from "../../../../../convex/finishedGoods/jobScans";
import { quantityToMinor } from "../../../../../convex/model/finishedGoods/packing";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../../../../../tests/fixtures/convex-tenant-world";

type Registered = {
  _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
};
async function call(world: ConvexTenantWorld, fn: unknown, args: unknown) {
  const envelope = await world.t
    .withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_a" })
    .run((ctx) =>
      (fn as Registered)._handler(ctx as GenericMutationCtx<DataModel>, args),
    );
  expect(envelope).toHaveProperty("ok", true);
  return (envelope as { value: Record<string, unknown> }).value;
}
async function setup() {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
  const warehouseId = world.warehouses.alphaA;
  const productArgs = {
    warehouseId,
    requestId: "product-create",
    sku: "INV-PRODUCT",
    name: "Original product",
    unit: "PCS",
    storageCondition: "ANY",
    notes: "Original notes",
    draft: false,
  };
  const productId = (await call(world, workflow.saveProduct, productArgs))
    .documentId as string;
  return { world, warehouseId, productId, productArgs };
}
async function buildingWorld() {
  const { world, warehouseId } = await setup();
  const result = await call(world, layouts.createStorageBuilding, {
    warehouseId,
    requestId: "building-create",
    code: "INV-BUILDING",
    name: "Inventory building",
    widthMm: 10_000,
    depthMm: 10_000,
    defaultFloorHeightMm: 4_000,
    floorCount: 1,
  });
  const buildingId = result.documentId as string;
  return { world, warehouseId, buildingId };
}
async function zoneWorld() {
  const base = await buildingWorld();
  const args = {
    warehouseId: base.warehouseId,
    buildingId: base.buildingId,
    floorNumber: 1,
    requestId: "zone-create",
    label: "Original zone",
    xMm: 0,
    yMm: 0,
    widthMm: 2_000,
    depthMm: 2_000,
    maxStackHeightMm: 3_000,
  };
  const result = await call(base.world, zones.createStorageZone, args);
  return { ...base, zoneId: result.documentId as string, zoneArgs: args };
}

describe("inventory research: assertions describe correct behavior", () => {
  it("INV-01 replays a completed layout write before checking its now-stale version", async () => {
    const { world, warehouseId, buildingId } = await buildingWorld();
    const args = {
      warehouseId,
      buildingId,
      requestId: "lost-building-reply",
      expectedVersion: 1,
      name: "Changed building",
      widthMm: 10_000,
      depthMm: 10_000,
      defaultFloorHeightMm: 4_000,
    };
    expect(
      await call(world, layouts.updateStorageBuilding, args),
    ).toMatchObject({ written: true, replayed: false });
    const retry = await call(world, layouts.updateStorageBuilding, args);
    console.log("INV-01 same request retry", JSON.stringify(retry));
    expect(retry).toMatchObject({ written: true, replayed: true });
  });

  it("INV-02 a replayed zone update must not overwrite a newer default position", async () => {
    const { world, warehouseId, zoneId, zoneArgs } = await zoneWorld();
    const updateA = {
      warehouseId,
      zoneId,
      requestId: "zone-A",
      label: "Zone A",
      xMm: 1_000,
      yMm: 0,
      widthMm: zoneArgs.widthMm,
      depthMm: zoneArgs.depthMm,
      maxStackHeightMm: zoneArgs.maxStackHeightMm,
    };
    const updateB = {
      ...updateA,
      requestId: "zone-B",
      label: "Zone B",
      xMm: 2_000,
    };
    expect(await call(world, zones.updateStorageZone, updateA)).toHaveProperty(
      "written",
      true,
    );
    expect(await call(world, zones.updateStorageZone, updateB)).toHaveProperty(
      "written",
      true,
    );
    expect(await call(world, zones.updateStorageZone, updateA)).toMatchObject({
      written: true,
      replayed: true,
    });
    const state = await world.t.run(async (ctx) => ({
      zones: await ctx.db.query("storageZones").collect(),
      positions: await ctx.db.query("storagePositions").collect(),
    }));
    console.log(
      "INV-02 parent/child",
      JSON.stringify(state.zones.map((z) => [z.label, z.xMm])),
      JSON.stringify(state.positions.map((p) => [p.label, p.xMm])),
    );
    expect(state.positions[0]).toMatchObject({ label: "Zone B", xMm: 2_000 });
  });

  it("INV-03 stale product edits must not silently overwrite another editor's save", async () => {
    const { world, productId, productArgs } = await setup();
    const firstEditor = {
      ...productArgs,
      productId,
      requestId: "product-editor-A",
      name: "Renamed by A",
    };
    const secondEditor = {
      ...productArgs,
      productId,
      requestId: "product-editor-B",
      notes: "Notes edited by B",
    };
    expect(await call(world, workflow.saveProduct, firstEditor)).toHaveProperty(
      "written",
      true,
    );
    const result = await call(world, workflow.saveProduct, secondEditor);
    const products = await world.t.run((ctx) =>
      ctx.db.query("finishedGoodsProducts").collect(),
    );
    console.log(
      "INV-03 stale save",
      JSON.stringify(result),
      JSON.stringify(products.map((p) => [p.name, p.notes])),
    );
    expect(products[0]).toHaveProperty("name", "Renamed by A");
  });

  it("INV-04 stale measurement saves must not erase another editor's physical dimensions", async () => {
    const { world, warehouseId, productId } = await setup();
    const palletId = (
      await call(world, workflow.createPallet, {
        warehouseId,
        productId,
        requestId: "pallet-create",
      })
    ).documentId;
    const initial = {
      warehouseId,
      palletId,
      requestId: "measurement-initial",
      quantity: 1,
      lengthMm: 1_000,
      widthMm: 1_000,
      heightMm: 1_000,
      lot: "Original lot",
    };
    expect(await call(world, workflow.saveMeasurement, initial)).toHaveProperty(
      "written",
      true,
    );
    expect(
      await call(world, workflow.saveMeasurement, {
        ...initial,
        requestId: "measurement-editor-A",
        widthMm: 2_000,
      }),
    ).toHaveProperty("written", true);
    const result = await call(world, workflow.saveMeasurement, {
      ...initial,
      requestId: "measurement-editor-B",
      lot: "Lot changed by B",
    });
    const units = await world.t.run((ctx) =>
      ctx.db.query("finishedGoodsPallets").collect(),
    );
    console.log(
      "INV-04 stale save",
      JSON.stringify(result),
      JSON.stringify(units.map((p) => [p.widthMm, p.lot])),
    );
    expect(units[0]).toHaveProperty("widthMm", 2_000);
  });

  it("INV-05 legacy measurement cannot store fractional discrete PCS quantities", async () => {
    const { world, warehouseId, productId } = await setup();
    const palletId = (
      await call(world, workflow.createPallet, {
        warehouseId,
        productId,
        requestId: "pallet-create",
      })
    ).documentId;
    expect(quantityToMinor(1.5, "PCS")).toBeNull();
    const result = await call(world, workflow.saveMeasurement, {
      warehouseId,
      palletId,
      requestId: "fractional-PCS",
      quantity: 1.5,
      lengthMm: 1_000,
      widthMm: 1_000,
      heightMm: 1_000,
      dimensionsChecked: true,
    });
    const units = await world.t.run((ctx) =>
      ctx.db.query("finishedGoodsPallets").collect(),
    );
    console.log(
      "INV-05 discrete quantity",
      JSON.stringify(result),
      units[0]?.quantity,
    );
    expect(result).toHaveProperty("written", false);
  });

  it("INV-06 omitted floor offset overrides must use the geometry that was validated", async () => {
    const { world, warehouseId, buildingId } = await buildingWorld();
    expect(
      await call(world, layouts.saveStorageFloor, {
        warehouseId,
        buildingId,
        requestId: "offset-override",
        expectedBuildingVersion: 1,
        expectedFloorVersion: 1,
        floor: {
          floorNumber: 1,
          widthMm: 6_000,
          depthMm: 10_000,
          offsetXMm: 2_000,
          offsetYMm: 0,
          reservedBlocks: [],
        },
      }),
    ).toHaveProperty("written", true);
    expect(
      await call(world, layouts.saveStorageFloor, {
        warehouseId,
        buildingId,
        requestId: "offset-inherit",
        expectedBuildingVersion: 2,
        expectedFloorVersion: 2,
        floor: { floorNumber: 1, reservedBlocks: [] },
      }),
    ).toHaveProperty("written", true);
    const floors = await world.t.run((ctx) =>
      ctx.db.query("storageFloors").collect(),
    );
    console.log(
      "INV-06 inherited floor",
      JSON.stringify(
        floors.map((f) => ({ widthMm: f.widthMm, offsetXMm: f.offsetXMm })),
      ),
    );
    expect(floors[0]?.offsetXMm ?? 0).toBe(0);
  });

  it("INV-07 live insertion must not duplicate the last searched record on the next page", async () => {
    const { world, warehouseId } = await setup();
    for (let i = 1; i <= 4; i++) {
      await call(world, scans.saveJobScans, {
        warehouseId,
        requestId: `history-${i}`,
        locationText: "Dock",
        items: [
          {
            factoryOrder: `FO000${i}`,
            productBarcodeText: "SEARCH-PRODUCT",
            source: "MANUAL",
          },
        ],
      });
      await world.t.run(async (ctx) => {
        const all = await ctx.db.query("finishedGoodsJobScans").collect();
        const row = all.find((item) => item.factoryOrder === `FO000${i}`)!;
        await ctx.db.patch(row._id, { createdAt: i });
      });
    }
    const first = await call(world, scans.listJobScans, {
      warehouseId,
      filter: "ALL",
      search: "SEARCH",
      pageSize: 2,
    });
    await call(world, scans.saveJobScans, {
      warehouseId,
      requestId: "history-new",
      locationText: "Dock",
      items: [
        {
          factoryOrder: "FO0005",
          productBarcodeText: "SEARCH-PRODUCT",
          source: "MANUAL",
        },
      ],
    });
    const second = await call(world, scans.listJobScans, {
      warehouseId,
      filter: "ALL",
      search: "SEARCH",
      pageSize: 2,
      cursor: first.continueCursor,
    });
    const firstIds = (
      first.items as { id: string; factoryOrder: string }[]
    ).map((item) => item.id);
    const secondIds = (
      second.items as { id: string; factoryOrder: string }[]
    ).map((item) => item.id);
    console.log(
      "INV-07 search pages",
      JSON.stringify(first.items),
      JSON.stringify(second.items),
    );
    expect(secondIds.filter((id) => firstIds.includes(id))).toEqual([]);
  });

  it("INV-08 searched location names must match the location names displayed on job records", async () => {
    const { world, warehouseId, buildingId, zoneId } = await zoneWorld();
    expect(
      await call(world, layouts.activateStorageBuilding, {
        warehouseId,
        buildingId,
        requestId: "building-active",
        expectedVersion: 1,
      }),
    ).toHaveProperty("written", true);
    expect(
      await call(world, scans.saveJobScans, {
        warehouseId,
        requestId: "mapped-ticket",
        locationText: "INV-BUILDING-F01-Z01",
        location: { zoneId },
        items: [
          {
            factoryOrder: "FO0001",
            productBarcodeText: "PRODUCT",
            source: "MANUAL",
          },
        ],
      }),
    ).toHaveProperty("written", true);
    const all = await call(world, scans.listJobScans, {
      warehouseId,
      filter: "ALL",
    });
    const found = await call(world, scans.listJobScans, {
      warehouseId,
      filter: "ALL",
      search: "Original zone",
    });
    console.log(
      "INV-08 location label/search",
      JSON.stringify(all.items),
      JSON.stringify(found.items),
    );
    expect(found.items).toHaveLength(1);
  });
});
