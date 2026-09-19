import { afterEach, expect, it, vi } from "vitest";
import type { GenericMutationCtx } from "convex/server";
import type { DataModel } from "../../convex/schema";
import {
  seed,
  PAGINATION_CONFIRMATION,
} from "../../convex/staging/paginationDemo";
import { createConvexTenantWorld } from "../fixtures/convex-tenant-world";

afterEach(() => vi.unstubAllEnvs());
it("seeds bounded idempotent local fixtures with valid floor/zone relationships", async () => {
  vi.stubEnv("ALLOW_LOCAL_TEST_SEED", "true");
  vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
  const world = await createConvexTenantWorld();
  const invoke = (
    kind: "products" | "buildings" | "units" | "batches",
    count: number,
  ) =>
    world.t.run((ctx) =>
      (
        seed as unknown as {
          _handler: (
            ctx: GenericMutationCtx<DataModel>,
            args: unknown,
          ) => Promise<{ created: number }>;
        }
      )._handler(ctx as GenericMutationCtx<DataModel>, {
        warehouseId: world.warehouses.alphaA,
        actorUserId: world.userA,
        confirmation: PAGINATION_CONFIRMATION,
        kind,
        start: 0,
        count,
      }),
    );
  for (const kind of ["products", "buildings", "units", "batches"] as const) {
    expect((await invoke(kind, 2)).created).toBe(2);
    expect((await invoke(kind, 2)).created).toBe(0);
  }
  await world.t.run(async (ctx) => {
    const zones = await ctx.db.query("storageZones").collect();
    expect(zones).toHaveLength(6);
    for (const zone of zones) {
      const floor = await ctx.db.get(zone.floorId);
      expect(floor?.buildingId).toBe(zone.buildingId);
      expect(zone.xMm + zone.widthMm).toBeLessThanOrEqual(floor?.widthMm ?? 0);
      expect((await ctx.db.get(zone.locationId))?.code).toBe(zone.code);
    }
    expect(await ctx.db.query("finishedGoodsPallets").collect()).toHaveLength(
      2,
    );
    expect(await ctx.db.query("finishedGoodsBatches").collect()).toHaveLength(
      2,
    );
  });
  await expect(invoke("units", 26)).rejects.toThrow("1–25");
  vi.stubEnv("CONVEX_CLOUD_URL", "https://example.convex.cloud");
  await expect(invoke("units", 1)).rejects.toThrow("loopback");
});
