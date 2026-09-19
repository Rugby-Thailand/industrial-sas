import { describe, expect, it } from "vitest";
import type { GenericMutationCtx } from "convex/server";
import type { DataModel } from "../../convex/schema";
import type { Id } from "../../convex/_generated/dataModel";
import * as workflow from "../../convex/finishedGoods/workflow";
import * as scanning from "../../convex/finishedGoods/scanning";
import { list as listLocations } from "../../convex/storageLayouts/locationCatalogue";
import { archiveStorageBuilding } from "../../convex/storageLayouts/writes";
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

async function units(world: Awaited<ReturnType<typeof setup>>, count = 3) {
  const productId = id(
    await call(world, workflow.saveProduct, {
      warehouseId: world.warehouseId,
      requestId: "product",
      sku: "SCAN",
      name: "Scanned boxes",
      unit: "pieces",
      storageFormat: "BOX",
      storageCondition: "Dry",
      draft: false,
    }),
  );
  const result = [];
  for (let n = 0; n < count; n++) {
    const unitId = id(
      await call(world, workflow.createPallet, {
        warehouseId: world.warehouseId,
        requestId: `unit-${n}`,
        productId,
      }),
    );
    const resolved = value(
      await call(world, scanning.resolvePackageCode, {
        warehouseId: world.warehouseId,
        code: `ISAS:PALLET:1:${unitId}`,
      }),
    );
    expect(resolved.ok).toBe(true);
    const unit = resolved.unit as { id: string; version: number };
    result.push({
      unitId: unit.id,
      version: unit.version,
      fillPercent: 100 - n * 25,
    });
  }
  return result;
}
async function payload(world: Awaited<ReturnType<typeof setup>>) {
  const ordered = await units(world);
  const resolved = value(
    await call(world, scanning.resolveLocationCode, {
      warehouseId: world.warehouseId,
      code: "BLDG-A-F01-Z01",
    }),
  );
  expect(resolved.ok).toBe(true);
  const location = resolved.location as { zoneId: string; version: string };
  return {
    warehouseId: world.warehouseId,
    requestId: "scan-assignment",
    units: ordered,
    location: { ...location, code: "BLDG-A-F01-Z01", method: "SCAN" },
    sameSize: false,
    physicalConfirmed: true,
  };
}
describe("ordered package scanning", () => {
  it("distinguishes an unregistered barcode from an unavailable package", async () => {
    const world = await setup();
    expect(
      value(
        await call(world, scanning.resolvePackageCode, {
          warehouseId: world.warehouseId,
          code: "8859748903645",
        }),
      ),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });
  it("saves unmeasured units in canonical order, preserves quantities, reads receipts and replays once", async () => {
    const world = await setup();
    const input = await payload(world);
    input.units.reverse();
    const assignmentId = id(
      await call(world, scanning.confirmScanAssignment, input),
    );
    const receipt = value(
      await call(world, scanning.getScanAssignment, {
        warehouseId: world.warehouseId,
        assignmentId,
      }),
    );
    expect(receipt.orderedUnitIds).toEqual(input.units.map((u) => u.unitId));
    expect(
      (receipt.orderedUnits as { fillPercent: number }[]).map(
        (u) => u.fillPercent,
      ),
    ).toEqual([50, 75, 100]);
    expect(
      value(await call(world, scanning.confirmScanAssignment, input)),
    ).toMatchObject({ documentId: assignmentId, replayed: true });
    error(
      await call(world, scanning.confirmScanAssignment, {
        ...input,
        sameSize: true,
      }),
      "REQUEST_ARGUMENT_CONFLICT",
    );
    await world.t.run(async (ctx) => {
      const placements = await ctx.db
        .query("finishedGoodsPlacements")
        .collect();
      expect(placements).toHaveLength(3);
      for (const row of placements) {
        expect(row).toMatchObject({ mode: "LOCATION_ONLY", status: "STORED" });
        expect(row).not.toHaveProperty("xMm");
      }
      for (const u of input.units) {
        const row = await ctx.db.get(u.unitId as Id<"finishedGoodsPallets">);
        expect(row).toMatchObject({ quantity: 1, status: "STORED" });
      }
    });
    const catalogue = value(
      await call(world, listLocations, { warehouseId: world.warehouseId }),
    ) as unknown as {
      palletCount: number;
      measuredAreaPartial: boolean;
      occupiedFootprintAreaSqMm: number;
    }[];
    expect(catalogue[0]).toMatchObject({
      palletCount: 3,
      measuredAreaPartial: true,
      occupiedFootprintAreaSqMm: 0,
    });
  });
  it("preflights the final member before writing any placement", async () => {
    const world = await setup();
    const input = await payload(world);
    input.units[2]!.version -= 1;
    error(
      await call(world, scanning.confirmScanAssignment, input),
      "UNIT_CHANGED",
    );
    await world.t.run(async (ctx) => {
      expect(
        await ctx.db.query("finishedGoodsPlacements").collect(),
      ).toHaveLength(0);
      expect(
        await ctx.db.query("finishedGoodsScanAssignments").collect(),
      ).toHaveLength(0);
    });
  });
  it("rejects duplicates, invalid fullness, stale destinations and assignment without explicit confirmation", async () => {
    const world = await setup();
    const input = await payload(world);
    error(
      await call(world, scanning.confirmScanAssignment, {
        ...input,
        units: [input.units[0], input.units[0]],
      }),
      "DUPLICATE_UNIT",
    );
    for (const fillPercent of [0, 101, 1.5])
      error(
        await call(world, scanning.confirmScanAssignment, {
          ...input,
          units: [{ ...input.units[0], fillPercent }],
        }),
        "FILL_PERCENT_INVALID",
      );
    error(
      await call(world, scanning.confirmScanAssignment, {
        ...input,
        location: { ...input.location, version: "old" },
      }),
      "LOCATION_CHANGED",
    );
    error(
      await call(world, scanning.confirmScanAssignment, {
        ...input,
        physicalConfirmed: false,
      }),
      "PHYSICAL_CONFIRMATION_REQUIRED",
    );
  });
  it("rejects another assignment and protects occupied locations", async () => {
    const world = await setup();
    const input = await payload(world);
    id(await call(world, scanning.confirmScanAssignment, input));
    error(
      await call(world, scanning.confirmScanAssignment, {
        ...input,
        requestId: "other-worker",
      }),
      "UNIT_UNAVAILABLE",
    );
    const blocked = await call(world, archiveStorageBuilding, {
      warehouseId: world.warehouseId,
      buildingId: world.buildingId,
      requestId: "archive",
      expectedVersion: 1,
    });
    expect(JSON.stringify(blocked)).toContain("OCCUPIED");
  });
  it("rejects inactive hierarchy and foreign warehouse identities", async () => {
    const world = await setup();
    await units(world);
    await expect(
      call(world, scanning.resolvePackageCode, {
        warehouseId: world.warehouses.bravoA,
        code: "P-000001",
      }),
    ).rejects.toThrow("WAREHOUSE_OUT_OF_SCOPE");
    await world.t.run((ctx) =>
      ctx.db.patch(world.buildingId, { status: "DRAFT" }),
    );
    expect(
      value(
        await call(world, scanning.resolveLocationCode, {
          warehouseId: world.warehouseId,
          code: "BLDG-A-F01-Z01",
        }),
      ),
    ).toMatchObject({ ok: false, error: { code: "LOCATION_UNAVAILABLE" } });
  });
  it("resolves real position QR and barcode aliases without creating support geometry", async () => {
    const world = await setup();
    const position = await world.t.run(async (ctx) => {
      const locationId = await ctx.db.insert("locations", {
        orgId: world.orgA,
        warehouseId: world.warehouseId,
        code: "RACK-A",
        locationType: "RACK_BIN",
        status: "ACTIVE",
      });
      const positionId = await ctx.db.insert("storagePositions", {
        orgId: world.orgA,
        warehouseId: world.warehouseId,
        buildingId: world.buildingId,
        floorId: world.floorId,
        zoneId: world.zoneId,
        locationId,
        code: "RACK-A",
        label: "Rack A",
        qrValue: `ISAS:LOCATION:1:${locationId}`,
        kind: "RACK_SLOT",
        isDefault: false,
        status: "ACTIVE",
        createdAt: 1,
        updatedAt: 1,
        createdByUserId: world.userA,
        updatedByUserId: world.userA,
      });
      return { positionId, qr: `ISAS:LOCATION:1:${locationId}` };
    });
    const barcode = value(
      await call(world, scanning.resolveLocationCode, {
        warehouseId: world.warehouseId,
        code: "RACK-A",
      }),
    );
    const qr = value(
      await call(world, scanning.resolveLocationCode, {
        warehouseId: world.warehouseId,
        code: position.qr,
      }),
    );
    expect(barcode).toEqual(qr);
    expect(barcode).toMatchObject({
      ok: true,
      location: { supportPositionId: position.positionId },
    });
    const input = await payload(world);
    const location = qr.location as Record<string, unknown>;
    const assignmentId = id(
      await call(world, scanning.confirmScanAssignment, {
        ...input,
        location: {
          zoneId: location.zoneId,
          supportPositionId: location.supportPositionId,
          version: location.version,
          code: position.qr,
          method: "SCAN",
        },
      }),
    );
    expect(
      value(
        await call(world, scanning.getScanAssignment, {
          warehouseId: world.warehouseId,
          assignmentId,
        }),
      ),
    ).toMatchObject({
      supportPositionId: position.positionId,
      verificationMethod: "SCAN",
    });
  });
  it("serializes competing confirmations to a single stored group", async () => {
    const world = await setup();
    const input = await payload(world);
    const results = await Promise.all([
      call(world, scanning.confirmScanAssignment, input),
      call(world, scanning.confirmScanAssignment, {
        ...input,
        requestId: "competing",
      }),
    ]);
    expect(results.map(value).filter((result) => result.written)).toHaveLength(
      1,
    );
    await world.t.run(async (ctx) => {
      expect(
        await ctx.db.query("finishedGoodsScanAssignments").collect(),
      ).toHaveLength(1);
    });
  });
  it("preserves existing measured reservations before allowing mixed stored occupancy", async () => {
    const world = await setup();
    const input = await payload(world);
    const reservedId = await world.t.run(async (ctx) => {
      const first = await ctx.db.get(
        input.units[0]!.unitId as Id<"finishedGoodsPallets">,
      );
      if (!first) throw new Error("Missing unit");
      const { _id, _creationTime, ...copy } = first;
      void _id;
      void _creationTime;
      const palletId = await ctx.db.insert("finishedGoodsPallets", {
        ...copy,
        code: "P-RESERVED",
        status: "RESERVED",
      });
      const placementId = await ctx.db.insert("finishedGoodsPlacements", {
        orgId: world.orgA,
        warehouseId: world.warehouseId,
        palletId,
        buildingId: world.buildingId,
        floorId: world.floorId,
        zoneId: world.zoneId,
        locationId: world.locationId,
        status: "RESERVED",
        positionCode: "HELD",
        qrValue: "HELD",
        xMm: 0,
        yMm: 0,
        zMm: 0,
        widthMm: 1000,
        depthMm: 1000,
        heightMm: 1000,
        rotation: 0,
        createdAt: 1,
        updatedAt: 1,
        createdByUserId: world.userA,
        updatedByUserId: world.userA,
      });
      await ctx.db.patch(palletId, { placementId });
      return placementId;
    });
    error(
      await call(world, scanning.confirmScanAssignment, input),
      "LOCATION_HAS_ACTIVE_RESERVATIONS",
    );
    await world.t.run(async (ctx) => {
      expect(
        await ctx.db.query("finishedGoodsScanAssignments").collect(),
      ).toHaveLength(0);
      expect(
        await ctx.db.query("finishedGoodsPlacements").collect(),
      ).toHaveLength(1);
      const held = await ctx.db.get(reservedId);
      expect(held?.status).toBe("RESERVED");
      if (!held) throw new Error("Missing hold");
      await ctx.db.patch(reservedId, { status: "STORED" });
      await ctx.db.patch(held.palletId, { status: "STORED" });
    });
    id(await call(world, scanning.confirmScanAssignment, input));
    const catalogue = value(
      await call(world, listLocations, { warehouseId: world.warehouseId }),
    ) as unknown as {
      palletCount: number;
      unmeasuredPalletCount: number;
      measuredAreaPartial: boolean;
      occupiedFootprintAreaSqMm: number;
    }[];
    expect(catalogue[0]).toMatchObject({
      palletCount: 4,
      unmeasuredPalletCount: 3,
      measuredAreaPartial: true,
      occupiedFootprintAreaSqMm: 1000000,
    });
  });
});
