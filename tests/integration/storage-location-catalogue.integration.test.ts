import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";
import { list } from "../../convex/storageLayouts/locationCatalogue";
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
});
