import { describe, expect, it } from "vitest";
import * as jobScanLocations from "../../../../convex/finishedGoods/jobScanLocations";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
} from "@tests/fixtures/convex-tenant-world";
import { settlePage, total } from "./measure";

type Page = {
  status: string;
  page: Array<{ _id: string }>;
  isDone: boolean;
  continueCursor: string;
  scanCursor?: string;
};

async function namedLocations(count: number) {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
  await world.t.run(async (ctx) => {
    const buildingId = await ctx.db.insert("storageBuildings", {
      orgId: world.orgA,
      warehouseId: world.warehouses.alphaA,
      code: "B-01",
      name: "Building 1",
      widthMm: 10_000,
      depthMm: 10_000,
      defaultFloorHeightMm: 3_000,
      floorCount: 1,
      totalHeightMm: 3_000,
      grossAreaSqMm: 100_000_000,
      reservedAreaSqMm: 0,
      usableAreaSqMm: 100_000_000,
      status: "ACTIVE",
      version: 1,
      createdAt: 1,
      createdByUserId: world.userA,
      updatedAt: 1,
      updatedByUserId: world.userA,
    });
    for (let i = 0; i < count; i++)
      await ctx.db.insert("locations", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        code: `NAMED-${String(i).padStart(4, "0")}`,
        label: `Named ${i}`,
        locationType: "NAMED_STORAGE",
        status: "ACTIVE",
        buildingId,
        version: 1,
        createdAt: 1,
        createdByUserId: world.userA,
        updatedAt: 1,
        updatedByUserId: world.userA,
      });
  });
  return world;
}

describe("Q4 — registered (named) locations under a non-ACTIVE status filter", () => {
  it("answers DRAFT/ARCHIVED filters without scanning every ACTIVE registration", async () => {
    const count = 120;
    const world = await namedLocations(count);
    const args = {
      warehouseId: world.warehouses.alphaA,
      search: "",
      pageSize: 20,
    };
    const control = await settlePage<Page>(world, jobScanLocations.page, {
      ...args,
      status: "ACTIVE",
    });
    console.info(
      `[Q4] status=ACTIVE control: requests=${control.requests} rows=${control.result.page.length} locations docs=${control.stats.rangeDocs.locations ?? 0}`,
    );
    expect(control.result.page).toHaveLength(20);
    for (const status of ["ARCHIVED", "DRAFT"]) {
      const { result, requests, stats } = await settlePage<Page>(
        world,
        jobScanLocations.page,
        { ...args, status },
      );
      console.info(
        `[Q4] status=${status}: requests=${requests} rows=${result.page.length} locations docs=${stats.rangeDocs.locations ?? 0} building gets=${stats.gets.storageBuildings ?? 0} all ranges=${total(stats.ranges)}`,
      );
      expect(result.page).toEqual([]);
      expect(result.isDone).toBe(true);
      // The predicate is constant-false: nothing needs to be read.
      expect
        .soft({
          status,
          requests,
          locationDocs: stats.rangeDocs.locations ?? 0,
        })
        .toEqual({
          status,
          requests: 1,
          locationDocs: 0,
        });
    }
  });
});
