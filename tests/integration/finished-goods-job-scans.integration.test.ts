import { describe, expect, it } from "vitest";
import type { GenericMutationCtx } from "convex/server";
import type { DataModel } from "../../convex/schema";
import * as jobScans from "../../convex/finishedGoods/jobScans";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";
interface RuntimeFunction {
  readonly _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
}
const identity = { subject: "user_fixture_a", org_id: "org_fixture_a" };
async function call(
  world: ConvexTenantWorld,
  fn: unknown,
  args: unknown,
  auth = true,
): Promise<Record<string, unknown>> {
  const harness = auth ? world.t.withIdentity(identity) : world.t;
  return (await harness.run((ctx) =>
    (fn as RuntimeFunction)._handler(
      ctx as GenericMutationCtx<DataModel>,
      args,
    ),
  )) as Record<string, unknown>;
}
function value(result: Record<string, unknown>): Record<string, unknown> {
  expect(result["ok"], JSON.stringify(result)).toBe(true);
  return result["value"] as Record<string, unknown>;
}
function id(result: Record<string, unknown>): string {
  const body = value(result);
  expect(body["written"], JSON.stringify(body)).toBe(true);
  return body["documentId"] as string;
}
function error(result: Record<string, unknown>, code: string) {
  expect(value(result)).toMatchObject({ written: false, error: { code } });
}
async function setup(roleA: "ORG_ADMIN" | "SUPERVISOR" = "ORG_ADMIN") {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, { roleA });
  const warehouseId = world.warehouses.alphaA;
  const location = await world.t.run(async (ctx) => {
    const now = Date.now(),
      orgId = world.orgA;
    const stamps = {
      createdAt: now,
      createdByUserId: world.userA,
      updatedAt: now,
      updatedByUserId: world.userA,
    };
    const buildingId = await ctx.db.insert("storageBuildings", {
      orgId,
      warehouseId,
      code: "BLDG-A",
      name: "Building A",
      widthMm: 10000,
      depthMm: 10000,
      defaultFloorHeightMm: 3000,
      floorCount: 1,
      totalHeightMm: 3000,
      grossAreaSqMm: 100000000,
      reservedAreaSqMm: 0,
      usableAreaSqMm: 100000000,
      status: "ACTIVE",
      version: 1,
      ...stamps,
    });
    const floorId = await ctx.db.insert("storageFloors", {
      orgId,
      warehouseId,
      buildingId,
      floorNumber: 1,
      widthMm: 10000,
      depthMm: 10000,
      heightMm: 3000,
      grossAreaSqMm: 100000000,
      reservedAreaSqMm: 0,
      usableAreaSqMm: 100000000,
      version: 1,
      updatedAt: now,
      updatedByUserId: world.userA,
    });
    const locationId = await ctx.db.insert("locations", {
      orgId,
      warehouseId,
      code: "BLDG-A-F01-Z01",
      locationType: "FLOOR_BLOCK",
      status: "ACTIVE",
    });
    const zoneId = await ctx.db.insert("storageZones", {
      orgId,
      warehouseId,
      buildingId,
      floorId,
      locationId,
      code: "BLDG-A-F01-Z01",
      label: "FG-1",
      qrValue: `ISAS:LOCATION:1:${locationId}`,
      xMm: 1000,
      yMm: 2000,
      widthMm: 2000,
      depthMm: 2000,
      maxStackHeightMm: 3000,
      status: "ACTIVE",
      ...stamps,
    });
    return { buildingId, floorId, zoneId, locationId };
  });
  return { ...world, warehouseId, ...location };
}

const ticket = {
  factoryOrder: "FO69070073",
  productBarcodeText: "FBN-BXVMI004-BOX-00F",
  partName: "VMI BOX TRAY BXVMI004 Rev.02",
  quantity: 1000,
  source: "AI" as const,
};
const listPage = async (
  world: Awaited<ReturnType<typeof setup>>,
  args: Record<string, unknown>,
) =>
  value(
    await call(world, jobScans.listJobScans, {
      warehouseId: world.warehouseId,
      filter: "ALL",
      ...args,
    }),
  ) as unknown as {
    items: { factoryOrder: string }[];
    continueCursor: string;
    isDone: boolean;
  };
const list = async (
  world: Awaited<ReturnType<typeof setup>>,
  filter: "ALL" | "MAPPED" | "UNMAPPED",
  search?: string,
) =>
  value(
    await call(world, jobScans.listJobScans, {
      warehouseId: world.warehouseId,
      filter,
      ...(search ? { search } : {}),
    }),
  ).items as unknown as {
    id: string;
    mapped: boolean;
    locationCode?: string;
  }[];

describe("finished goods job scans", () => {
  it("saves unmapped tickets, allows duplicate job numbers, and maps them later", async () => {
    const world = await setup();
    id(
      await call(world, jobScans.saveJobScans, {
        warehouseId: world.warehouseId,
        requestId: "save-1",
        locationText: "Dock corner by gate 3",
        items: [ticket, { ...ticket, productBarcodeText: "FBN-OTHER" }],
      }),
    );
    expect(await list(world, "UNMAPPED")).toHaveLength(2);
    expect(await list(world, "MAPPED")).toHaveLength(0);
    expect(await list(world, "ALL", "other")).toHaveLength(1);

    const ids = (await list(world, "UNMAPPED")).map((scan) => scan.id);
    id(
      await call(world, jobScans.assignJobScanLocation, {
        warehouseId: world.warehouseId,
        requestId: "assign-1",
        ids,
        location: { zoneId: world.zoneId },
      }),
    );
    const mapped = await list(world, "MAPPED");
    expect(mapped).toHaveLength(2);
    expect(mapped[0]).toMatchObject({
      mapped: true,
      locationCode: "BLDG-A-F01-Z01",
    });
  });

  it("saves mapped tickets and validates required fields", async () => {
    const world = await setup();
    id(
      await call(world, jobScans.saveJobScans, {
        warehouseId: world.warehouseId,
        requestId: "save-mapped",
        locationText: "",
        location: { zoneId: world.zoneId },
        items: [ticket],
      }),
    );
    expect(await list(world, "MAPPED")).toHaveLength(1);
    error(
      await call(world, jobScans.saveJobScans, {
        warehouseId: world.warehouseId,
        requestId: "save-invalid",
        locationText: "A",
        items: [{ ...ticket, productBarcodeText: " " }],
      }),
      "PRODUCT_BARCODE_REQUIRED",
    );
    error(
      await call(world, jobScans.saveJobScans, {
        warehouseId: world.warehouseId,
        requestId: "save-no-location",
        locationText: " ",
        items: [ticket],
      }),
      "LOCATION_REQUIRED",
    );
  });

  it("finds active zones by code or label", async () => {
    const world = await setup();
    const found = value(
      await call(world, jobScans.searchLocations, {
        warehouseId: world.warehouseId,
        text: "fg-1",
      }),
    ) as unknown as { total: number; pages: number; items: { code: string }[] };
    expect(found.items.map((zone) => zone.code)).toEqual(["BLDG-A-F01-Z01"]);
    expect(found).toMatchObject({ total: 1, pages: 1, page: 1 });
  });

  it("pages through records newest first, with and without search", async () => {
    const world = await setup();
    id(
      await call(world, jobScans.saveJobScans, {
        warehouseId: world.warehouseId,
        requestId: "save-many",
        locationText: "Dock",
        items: Array.from({ length: 5 }, (_, n) => ({
          ...ticket,
          factoryOrder: `FO${n}`,
        })),
      }),
    );
    const first = await listPage(world, { pageSize: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.isDone).toBe(false);
    const second = await listPage(world, {
      pageSize: 2,
      cursor: first.continueCursor,
    });
    expect(second.items).toHaveLength(2);
    const third = await listPage(world, {
      pageSize: 2,
      cursor: second.continueCursor,
    });
    expect(third.items).toHaveLength(1);
    expect(third.isDone).toBe(true);

    const searched = await listPage(world, { search: "fo", pageSize: 3 });
    expect(searched.items).toHaveLength(3);
    const rest = await listPage(world, {
      search: "fo",
      pageSize: 3,
      cursor: searched.continueCursor,
    });
    expect(rest).toMatchObject({ isDone: true });
    expect(rest.items).toHaveLength(2);
  });
});
