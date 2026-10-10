import { describe, expect, it } from "vitest";
import type { GenericMutationCtx } from "convex/server";
import type { Id } from "../../convex/_generated/dataModel";
import type { DataModel } from "../../convex/schema";
import * as locations from "../../convex/finishedGoods/jobScanLocations";
import * as scanning from "../../convex/finishedGoods/scanning";
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

  it("deletes mapped and unmapped records, audits the command, and replays retries", async () => {
    const world = await setup();
    for (const mapped of [false, true]) {
      id(
        await call(world, jobScans.saveJobScans, {
          warehouseId: world.warehouseId,
          requestId: `save-delete-${mapped}`,
          locationText: "Dock",
          ...(mapped ? { location: { zoneId: world.zoneId } } : {}),
          items: [ticket, ticket],
        }),
      );
    }
    const [unmapped] = await list(world, "UNMAPPED");
    const [mapped] = await list(world, "MAPPED");
    const args = {
      warehouseId: world.warehouseId,
      requestId: "delete-selection",
      ids: [unmapped!.id, mapped!.id, mapped!.id],
    };
    expect(id(await call(world, jobScans.deleteJobScans, args))).toBe(
      unmapped!.id,
    );
    expect(await list(world, "UNMAPPED")).toHaveLength(1);
    expect(await list(world, "MAPPED")).toHaveLength(1);
    expect(
      value(await call(world, jobScans.deleteJobScans, args)),
    ).toMatchObject({
      written: true,
      replayed: true,
    });
    const audit = await world.t.run(async (ctx) =>
      (await ctx.db.query("auditEvents").collect()).filter(
        (event) => event.action === "finishedGoods.jobScan.delete",
      ),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      outcome: "ALLOWED",
      entityId: unmapped!.id,
      warehouseId: world.warehouseId,
      actorUserId: world.userA,
    });
  });

  it("rejects a mixed selection from another warehouse or tenant before deleting anything", async () => {
    const world = await setup();
    const scanId = id(
      await call(world, jobScans.saveJobScans, {
        warehouseId: world.warehouseId,
        requestId: "save-protected",
        locationText: "Dock",
        items: [ticket],
      }),
    );
    for (const warehouseId of [
      world.warehouses.bravoA,
      world.warehouses.alphaB,
    ]) {
      const foreignId = await world.t.run(async (ctx) =>
        ctx.db.insert("finishedGoodsJobScans", {
          ...ticket,
          orgId:
            warehouseId === world.warehouses.alphaB ? world.orgB : world.orgA,
          warehouseId,
          locationText: "Other warehouse",
          mapped: false,
          createdAt: Date.now(),
          createdByUserId: world.userA,
          updatedAt: Date.now(),
          updatedByUserId: world.userA,
        }),
      );
      error(
        await call(world, jobScans.deleteJobScans, {
          warehouseId: world.warehouseId,
          requestId: `delete-foreign-${warehouseId}`,
          ids: [scanId, foreignId],
        }),
        "NOT_FOUND",
      );
      expect(await list(world, "ALL")).toHaveLength(1);
      expect(await world.t.run((ctx) => ctx.db.get(foreignId))).not.toBeNull();
    }
  });

  it("rejects missing records and invalid selection sizes", async () => {
    const world = await setup();
    const scanId = id(
      await call(world, jobScans.saveJobScans, {
        warehouseId: world.warehouseId,
        requestId: "save-missing",
        locationText: "Dock",
        items: [ticket, ticket],
      }),
    );
    const otherId = (await list(world, "ALL")).find(
      (scan) => scan.id !== scanId,
    )!.id;
    id(
      await call(world, jobScans.deleteJobScans, {
        warehouseId: world.warehouseId,
        requestId: "delete-once",
        ids: [scanId],
      }),
    );
    for (const [requestId, ids, code] of [
      ["delete-empty", [], "SCAN_GROUP_SIZE_INVALID"],
      [
        "delete-too-many",
        Array.from({ length: 301 }, () => otherId),
        "SCAN_GROUP_SIZE_INVALID",
      ],
      ["delete-missing", [otherId, scanId], "NOT_FOUND"],
    ] as const) {
      error(
        await call(world, jobScans.deleteJobScans, {
          warehouseId: world.warehouseId,
          requestId,
          ids,
        }),
        code,
      );
    }
    expect(await list(world, "ALL")).toHaveLength(1);
  });

  it("denies deletion without manage permission or authentication", async () => {
    const world = await setup("SUPERVISOR");
    const scanId = await world.t.run(async (ctx) =>
      ctx.db.insert("finishedGoodsJobScans", {
        ...ticket,
        orgId: world.orgA,
        warehouseId: world.warehouseId,
        locationText: "Dock",
        mapped: false,
        createdAt: Date.now(),
        createdByUserId: world.userA,
        updatedAt: Date.now(),
        updatedByUserId: world.userA,
      }),
    );
    const args = {
      warehouseId: world.warehouseId,
      requestId: "delete-denied",
      ids: [scanId],
    };
    expect(await call(world, jobScans.deleteJobScans, args)).toMatchObject({
      ok: false,
    });
    await expect(
      call(world, jobScans.deleteJobScans, args, false),
    ).rejects.toMatchObject({
      data: { code: "ANONYMOUS" },
    });
    expect(await list(world, "ALL")).toHaveLength(1);
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

describe("register a location during job scanning", () => {
  const registration = (
    world: Awaited<ReturnType<typeof setup>>,
    overrides: Record<string, unknown> = {},
  ) => ({
    warehouseId: world.warehouseId,
    requestId: "register-dock",
    code: "  dock-new  ",
    buildingId: world.buildingId,
    ...overrides,
  });

  it("creates one canonical registration, replays it and saves ticket types with derived parents", async () => {
    const world = await setup();
    const args = registration(world, { floorId: world.floorId });
    const locationId = id(await call(world, locations.create, args));
    expect(id(await call(world, locations.create, args))).toBe(locationId);
    error(
      await call(world, locations.create, { ...args, code: "OTHER" }),
      "REQUEST_ARGUMENT_CONFLICT",
    );
    const resolved = value(
      await call(world, locations.resolve, {
        warehouseId: world.warehouseId,
        code: "dock-new",
      }),
    );
    expect(resolved).toMatchObject({
      ok: true,
      location: {
        locationId,
        code: "DOCK-NEW",
        name: "DOCK-NEW",
        buildingId: world.buildingId,
        buildingName: "Building A",
        floorId: world.floorId,
        floorNumber: 1,
        layoutPending: true,
      },
    });
    const recordsId = id(
      await call(world, jobScans.saveJobScans, {
        warehouseId: world.warehouseId,
        requestId: "named-save",
        locationText: "dock-new",
        location: { locationId },
        items: ["PALLET", "BOX", "OTHER"].map((storageFormat) => ({
          ...ticket,
          storageFormat,
        })),
      }),
    );
    const saved = await world.t.run((ctx) =>
      ctx.db.query("finishedGoodsJobScans").collect(),
    );
    expect(saved).toHaveLength(3);
    expect(saved.map((row) => row.storageFormat)).toEqual([
      "PALLET",
      "BOX",
      "OTHER",
    ]);
    expect(saved.find((row) => row._id === recordsId)).toMatchObject({
      locationId,
      buildingId: world.buildingId,
      floorId: world.floorId,
      mapped: true,
    });
    const catalogue = value(
      await call(world, locations.page, {
        warehouseId: world.warehouseId,
        pageSize: 20,
      }),
    );
    expect(catalogue).toMatchObject({
      status: "ready",
      page: [{ location: { code: "DOCK-NEW", layoutPending: true } }],
    });
    expect(JSON.stringify(catalogue)).not.toMatch(/widthMm|depthMm|occupied/);
    const canonical = await world.t.run((ctx) =>
      ctx.db
        .query("locations")
        .filter((q) => q.eq(q.field("code"), "DOCK-NEW"))
        .collect(),
    );
    expect(canonical).toHaveLength(1);
    expect(
      await world.t.run((ctx) =>
        ctx.db.query("finishedGoodsPallets").collect(),
      ),
    ).toHaveLength(0);
    expect(
      await world.t.run((ctx) =>
        ctx.db.query("finishedGoodsPlacements").collect(),
      ),
    ).toHaveLength(0);
    expect(
      value(
        await call(world, scanning.resolveLocationCode, {
          warehouseId: world.warehouseId,
          code: "DOCK-NEW",
        }),
      ),
    ).toMatchObject({ ok: false, error: { code: "LOCATION_UNAVAILABLE" } });
  });

  it("rejects conflicts across active, inactive and operational locations and legacy positions", async () => {
    const world = await setup();
    error(
      await call(
        world,
        locations.create,
        registration(world, { code: "BLDG-A-F01-Z01" }),
      ),
      "DUPLICATE_KEY",
    );
    await world.t.run(async (ctx) => {
      await ctx.db.patch(world.locationId, { status: "INACTIVE" });
      await ctx.db.patch(world.zoneId, { status: "INACTIVE" });
      await ctx.db.insert("locations", {
        orgId: world.orgA,
        warehouseId: world.warehouseId,
        code: "DOCK-EXISTING",
        locationType: "DOCK",
        status: "ACTIVE",
      });
      await ctx.db.insert("storagePositions", {
        orgId: world.orgA,
        warehouseId: world.warehouseId,
        buildingId: world.buildingId,
        floorId: world.floorId,
        zoneId: world.zoneId,
        locationId: world.locationId,
        code: "LEGACY-POS",
        label: "Legacy position",
        qrValue: "legacy",
        kind: "FLOOR",
        isDefault: false,
        status: "INACTIVE",
        createdAt: Date.now(),
        createdByUserId: world.userA,
        updatedAt: Date.now(),
        updatedByUserId: world.userA,
      });
    });
    for (const code of ["BLDG-A-F01-Z01", "DOCK-EXISTING", "LEGACY-POS"]) {
      error(
        await call(
          world,
          locations.create,
          registration(world, { code, requestId: code }),
        ),
        "DUPLICATE_KEY",
      );
      expect(
        value(
          await call(world, locations.resolve, {
            warehouseId: world.warehouseId,
            code,
          }),
        ),
      ).toMatchObject({ ok: false, error: { code: "LOCATION_UNAVAILABLE" } });
    }
  });

  it("registers without a floor and clears legacy destination fields on reassignment", async () => {
    const world = await setup();
    const locationId = id(
      await call(world, locations.create, registration(world)),
    );
    const scanId = id(
      await call(world, jobScans.saveJobScans, {
        warehouseId: world.warehouseId,
        requestId: "mapped-save",
        locationText: "Old",
        location: { zoneId: world.zoneId },
        items: [ticket],
      }),
    );
    id(
      await call(world, jobScans.assignJobScanLocation, {
        warehouseId: world.warehouseId,
        requestId: "assign-named",
        ids: [scanId],
        location: { locationId },
      }),
    );
    let record = await world.t.run((ctx) =>
      ctx.db.get(
        "finishedGoodsJobScans",
        scanId as Id<"finishedGoodsJobScans">,
      ),
    );
    expect(record).toMatchObject({
      locationId,
      buildingId: world.buildingId,
      mapped: true,
    });
    expect(record).not.toHaveProperty("zoneId");
    expect(record).not.toHaveProperty("floorId");
    id(
      await call(world, jobScans.assignJobScanLocation, {
        warehouseId: world.warehouseId,
        requestId: "assign-layout",
        ids: [scanId],
        location: { locationId: world.locationId },
      }),
    );
    record = await world.t.run((ctx) =>
      ctx.db.get(
        "finishedGoodsJobScans",
        scanId as Id<"finishedGoodsJobScans">,
      ),
    );
    expect(record).toMatchObject({
      locationId: world.locationId,
      zoneId: world.zoneId,
      floorId: world.floorId,
    });
  });

  it("revalidates archived parents and rejects foreign warehouse/building/floor references before writes", async () => {
    const world = await setup();
    await expect(
      call(
        world,
        locations.create,
        registration(world, { warehouseId: world.warehouses.bravoA }),
      ),
    ).rejects.toMatchObject({ data: { code: "WAREHOUSE_OUT_OF_SCOPE" } });
    const locationId = id(
      await call(world, locations.create, registration(world)),
    );
    const foreignBuilding = await world.t.run(async (ctx) => {
      const building = (await ctx.db.get(world.buildingId))!;
      const { _id, _creationTime, ...fields } = building;
      void _id;
      void _creationTime;
      return ctx.db.insert("storageBuildings", {
        ...fields,
        orgId: world.orgB,
        warehouseId: world.warehouses.alphaB,
      });
    });
    error(
      await call(
        world,
        locations.create,
        registration(world, {
          code: "FOREIGN",
          buildingId: foreignBuilding,
          requestId: "foreign",
        }),
      ),
      "REFERENCE_NOT_FOUND",
    );
    const mismatchedFloor = await world.t.run(async (ctx) => {
      const floor = (await ctx.db.get(world.floorId))!;
      const { _id, _creationTime, ...fields } = floor;
      void _id;
      void _creationTime;
      return ctx.db.insert("storageFloors", {
        ...fields,
        warehouseId: world.warehouses.bravoA,
      });
    });
    error(
      await call(
        world,
        locations.create,
        registration(world, {
          code: "WRONG-FLOOR",
          floorId: mismatchedFloor,
          requestId: "wrong-floor",
        }),
      ),
      "REFERENCE_NOT_FOUND",
    );
    await world.t.run((ctx) =>
      ctx.db.patch(world.buildingId, { status: "ARCHIVED" }),
    );
    error(
      await call(world, jobScans.saveJobScans, {
        warehouseId: world.warehouseId,
        requestId: "archived-save",
        locationText: "DOCK-NEW",
        location: { locationId },
        items: [ticket],
      }),
      "LOCATION_UNAVAILABLE",
    );
    error(
      await call(world, jobScans.saveJobScans, {
        warehouseId: world.warehouseId,
        requestId: "archived-legacy-save",
        locationText: "Old",
        location: { zoneId: world.zoneId },
        items: [ticket],
      }),
      "LOCATION_UNAVAILABLE",
    );
    error(
      await call(
        world,
        locations.create,
        registration(world, { code: "ARCHIVED", requestId: "archived-create" }),
      ),
      "REFERENCE_NOT_FOUND",
    );
    expect(await list(world, "ALL")).toHaveLength(0);
  });

  it.each([
    "ISAS:PALLET:1:anything",
    "ISAS:LOCATION:1:missing",
    "bad\u0000code",
    "x".repeat(201),
  ])("never registers reserved or invalid code %s", async (code) => {
    const world = await setup();
    error(
      await call(world, locations.create, registration(world, { code })),
      "FIELD_INVALID",
    );
    const result = value(
      await call(world, locations.searchPage, {
        warehouseId: world.warehouseId,
        text: code,
        pageSize: 20,
      }),
    );
    expect(result["canCreate"]).toBe(false);
  });

  it("rejects unauthenticated creation and missing manage permission", async () => {
    const world = await setup("SUPERVISOR");
    expect(
      await call(world, locations.create, registration(world)),
    ).toMatchObject({ ok: false });
    await expect(
      call(world, locations.create, registration(world), false),
    ).rejects.toMatchObject({ data: { code: "ANONYMOUS" } });
    expect(
      await world.t.run((ctx) => ctx.db.query("locations").collect()),
    ).toHaveLength(1);
  });
});
