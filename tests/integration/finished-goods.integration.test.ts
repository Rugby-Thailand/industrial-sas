import type { Id } from "../../convex/_generated/dataModel";
import { readCurrent } from "../../convex/workspace/current";
import { v } from "convex/values";
import { queryWithOrg } from "../../convex/lib/tenantFunctions";
import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";
import * as workflow from "../../convex/finishedGoods/workflow";
import type { DataModel } from "../../convex/schema";
import { archiveStorageBuilding } from "../../convex/storageLayouts/writes";
import { updateStorageZone } from "../../convex/storageLayouts/zones";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  seedSecondActorForOrgA,
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
const fields = {
  sku: " fg-001 ",
  name: "Boxes",
  unit: "pieces",
  storageFormat: "PALLET",
  defaultQuantity: 500,
  storageCondition: "Dry",
  draft: false,
};
async function measuredPallet(
  world: Awaited<ReturnType<typeof setup>>,
  suffix = "1",
) {
  const productId = id(
    await call(world, workflow.saveProduct, {
      warehouseId: world.warehouseId,
      requestId: `product-${suffix}`,
      ...fields,
      sku: `FG-${suffix}`,
    }),
  );
  const palletId = id(
    await call(world, workflow.createPallet, {
      warehouseId: world.warehouseId,
      requestId: `pallet-${suffix}`,
      productId,
    }),
  );
  id(
    await call(world, workflow.saveMeasurement, {
      warehouseId: world.warehouseId,
      requestId: `measure-${suffix}`,
      palletId,
      quantity: 500,
      lengthMm: 1200,
      widthMm: 1000,
      heightMm: 1400,
    }),
  );
  return { productId, palletId };
}
async function reserve(
  world: Awaited<ReturnType<typeof setup>>,
  palletId: string,
  requestId = "reserve-1",
  xMm = 0,
  yMm = 0,
) {
  return call(world, workflow.reserve, {
    warehouseId: world.warehouseId,
    palletId,
    zoneId: world.zoneId,
    requestId,
    xMm,
    yMm,
    rotation: 0,
  });
}

describe("finished goods workflow", () => {
  it("keeps physical confirmation bound to the operator who verified the current reservation", async () => {
    const world = await setup();
    const actor = await seedSecondActorForOrgA(world, "ORG_ADMIN");
    const asSecond = async (fn: unknown, args: unknown) =>
      (await world.t
        .withIdentity({ subject: actor.clerkUserId, org_id: "org_fixture_a" })
        .run((ctx) =>
          (fn as RuntimeFunction)._handler(
            ctx as GenericMutationCtx<DataModel>,
            args,
          ),
        )) as Record<string, unknown>;
    const { palletId } = await measuredPallet(world);
    id(await reserve(world, palletId));
    const args = { warehouseId: world.warehouseId, palletId };
    expect(
      value(await call(world, workflow.getPallet, args))[
        "destinationVerifiedForCurrentUser"
      ],
    ).toBe(false);
    const scan = {
      ...args,
      requestId: "operator-a-scan",
      code: `ISAS:LOCATION:1:${world.locationId}`,
      method: "SCAN",
    };
    id(await call(world, workflow.verifyDestination, scan));
    expect(
      value(await call(world, workflow.getPallet, args))[
        "destinationVerifiedForCurrentUser"
      ],
    ).toBe(true);
    expect(
      value(await asSecond(workflow.getPallet, args))[
        "destinationVerifiedForCurrentUser"
      ],
    ).toBe(false);
    // Even replaying a known successful scan command cannot transfer its actor identity.
    id(await asSecond(workflow.verifyDestination, scan));
    error(
      await asSecond(workflow.confirmStored, {
        ...args,
        requestId: "operator-b-unverified",
      }),
      "DESTINATION_NOT_VERIFIED",
    );
    id(
      await asSecond(workflow.verifyDestination, {
        ...scan,
        requestId: "operator-b-scan",
      }),
    );
    expect(
      value(await asSecond(workflow.getPallet, args))[
        "destinationVerifiedForCurrentUser"
      ],
    ).toBe(true);
    expect(
      value(await call(world, workflow.getPallet, args))[
        "destinationVerifiedForCurrentUser"
      ],
    ).toBe(false);
    id(
      await asSecond(workflow.confirmStored, {
        ...args,
        requestId: "operator-b-store",
      }),
    );
    expect(
      value(await asSecond(workflow.getPallet, args))["pallet"],
    ).toMatchObject({ status: "STORED" });
  });

  it("serializes a planner geometry change racing a reservation without moving an existing hold", async () => {
    const world = await setup();
    const { palletId } = await measuredPallet(world);
    const result = await Promise.all([
      reserve(world, palletId, "race-layout-reserve"),
      call(world, updateStorageZone, {
        warehouseId: world.warehouseId,
        zoneId: world.zoneId,
        requestId: "race-layout-edit",
        label: "FG-1",
        xMm: 2_000,
        yMm: 2_000,
        widthMm: 2_000,
        depthMm: 2_000,
        maxStackHeightMm: 3_000,
      }),
    ]);
    expect(value(result[0]!)).toMatchObject({ written: true });
    const changed = value(result[1]!);
    const state = value(
      await call(world, workflow.getPallet, {
        warehouseId: world.warehouseId,
        palletId,
      }),
    );
    expect(state["pallet"]).toMatchObject({ status: "RESERVED" });
    expect(state["placement"]).toMatchObject({
      xMm: 0,
      yMm: 0,
      status: "RESERVED",
    });
    const location = await world.t.run((ctx) => ctx.db.get(world.zoneId));
    if (changed["written"] === true)
      expect(location).toMatchObject({ xMm: 2_000 });
    else {
      expect(changed).toMatchObject({
        written: false,
        error: { code: "LOCATION_OCCUPIED" },
      });
      expect(location).toMatchObject({ xMm: 1_000 });
    }
  });

  it("never commits an archived building together with a new reservation when they race", async () => {
    const world = await setup();
    const { palletId } = await measuredPallet(world);
    const result = await Promise.all([
      reserve(world, palletId, "race-archive-reserve"),
      call(world, archiveStorageBuilding, {
        warehouseId: world.warehouseId,
        buildingId: world.buildingId,
        requestId: "race-archive",
        expectedVersion: 1,
      }),
    ]);
    expect(
      result.map(value).filter((outcome) => outcome["written"] === true),
    ).toHaveLength(1);
    const state = await world.t.run(async (ctx) => ({
      building: await ctx.db.get(world.buildingId),
      placements: await ctx.db.query("finishedGoodsPlacements").collect(),
    }));
    if (state.building?.status === "ARCHIVED")
      expect(state.placements).toEqual([]);
    else
      expect(state.placements).toEqual([
        expect.objectContaining({ status: "RESERVED" }),
      ]);
  });
  it.each(["RESERVED", "STORED"] as const)(
    "protects product storage requirements for %s pallets but allows equivalent text and descriptive edits",
    async (status) => {
      const world = await setup();
      const { productId, palletId } = await measuredPallet(world);
      id(await reserve(world, palletId));
      if (status === "STORED") {
        id(
          await call(world, workflow.verifyDestination, {
            warehouseId: world.warehouseId,
            palletId,
            requestId: "condition-scan",
            code: `ISAS:LOCATION:1:${world.locationId}`,
            method: "SCAN",
          }),
        );
        id(
          await call(world, workflow.confirmStored, {
            warehouseId: world.warehouseId,
            palletId,
            requestId: "condition-store",
          }),
        );
      }
      const args = {
        ...fields,
        warehouseId: world.warehouseId,
        productId,
        sku: "FG-1",
      };
      error(
        await call(world, workflow.saveProduct, {
          ...args,
          requestId: "change-requirement",
          storageCondition: "COLD",
        }),
        "LOCATION_OCCUPIED",
      );
      id(
        await call(world, workflow.saveProduct, {
          ...args,
          requestId: "same-requirement",
          storageCondition: " dry ",
          name: "Renamed boxes",
          notes: "Updated instructions",
        }),
      );
      const product = value(
        await call(world, workflow.getProduct, {
          warehouseId: world.warehouseId,
          productId,
        }),
      );
      expect(product).toMatchObject({
        name: "Renamed boxes",
        storageCondition: "dry",
      });
      if (status === "RESERVED") {
        id(
          await call(world, workflow.cancelReservation, {
            warehouseId: world.warehouseId,
            palletId,
            requestId: "release-for-condition",
          }),
        );
        id(
          await call(world, workflow.saveProduct, {
            ...args,
            requestId: "change-after-release",
            storageCondition: "COLD",
          }),
        );
      }
    },
  );

  it("persists two creation steps, finds exact geometry, reserves, verifies and stores once", async () => {
    const world = await setup();
    const { palletId } = await measuredPallet(world);
    const recommendations = value(
      await call(world, workflow.recommend, {
        warehouseId: world.warehouseId,
        palletId,
      }),
    );
    expect(recommendations["candidates"]).toMatchObject([
      {
        locationName: "FG-1",
        xMm: 0,
        yMm: 0,
        widthMm: 1000,
        depthMm: 1200,
        heightMm: 1400,
        zone: { xMm: 1000, yMm: 2000 },
        checks: { storageCondition: "UNKNOWN" },
      },
    ]);
    const placementId = id(await reserve(world, palletId));
    const before = value(
      await call(world, workflow.getPallet, {
        warehouseId: world.warehouseId,
        palletId,
      }),
    );
    expect(before).toMatchObject({
      pallet: { code: "P-000001", status: "RESERVED" },
      placement: {
        _id: placementId,
        positionCode: "POS-000001",
        status: "RESERVED",
      },
    });
    error(
      await call(world, workflow.confirmStored, {
        warehouseId: world.warehouseId,
        palletId,
        requestId: "store-before-scan",
      }),
      "DESTINATION_NOT_VERIFIED",
    );
    error(
      await call(world, workflow.verifyDestination, {
        warehouseId: world.warehouseId,
        palletId,
        requestId: "bad-scan",
        code: "UNKNOWN",
        method: "SCAN",
      }),
      "DESTINATION_MISMATCH",
    );
    id(
      await call(world, workflow.verifyDestination, {
        warehouseId: world.warehouseId,
        palletId,
        requestId: "good-scan",
        code: `ISAS:LOCATION:1:${world.locationId}`,
        method: "SCAN",
      }),
    );
    const args = {
      warehouseId: world.warehouseId,
      palletId,
      requestId: "store",
    };
    id(await call(world, workflow.confirmStored, args));
    expect(
      value(await call(world, workflow.confirmStored, args)),
    ).toMatchObject({ written: true, replayed: true });
    id(
      await call(world, workflow.confirmStored, {
        ...args,
        requestId: "store-again",
      }),
    );
    expect(
      value(
        await call(world, workflow.getPallet, {
          warehouseId: world.warehouseId,
          palletId,
        }),
      ),
    ).toMatchObject({
      pallet: { status: "STORED" },
      placement: { status: "STORED", verificationMethod: "SCAN" },
    });
    const stored = await world.t.run((ctx) =>
      ctx.db.query("finishedGoodsPlacements").collect(),
    );
    expect(stored).toHaveLength(1);
    expect(
      (await world.t.run((ctx) => ctx.db.query("auditEvents").collect())).some(
        (e) => e.action === "finishedGoods.pallet.store",
      ),
    ).toBe(true);
  });
  it("saves incomplete drafts, resumes them and rejects invalid or duplicate products", async () => {
    const world = await setup();
    const draft = {
      warehouseId: world.warehouseId,
      requestId: "draft",
      ...fields,
      sku: "",
      name: "",
      unit: "",
      storageCondition: "",
      defaultQuantity: undefined,
      draft: true,
    };
    const productId = id(await call(world, workflow.saveProduct, draft));
    expect(value(await call(world, workflow.saveProduct, draft))).toMatchObject(
      { documentId: productId, replayed: true },
    );
    error(
      await call(world, workflow.createPallet, {
        warehouseId: world.warehouseId,
        productId,
        requestId: "draft-pallet",
      }),
      "PRODUCT_DRAFT",
    );
    error(
      await call(world, workflow.saveProduct, {
        ...draft,
        requestId: "invalid-active",
        draft: false,
      }),
      "FIELD_INVALID",
    );
    id(
      await call(world, workflow.saveProduct, {
        warehouseId: world.warehouseId,
        requestId: "activate",
        productId,
        ...fields,
      }),
    );
    error(
      await call(world, workflow.saveProduct, {
        warehouseId: world.warehouseId,
        requestId: "duplicate",
        ...fields,
        sku: "FG-001",
      }),
      "DUPLICATE_KEY",
    );
    error(
      await call(world, workflow.saveProduct, {
        warehouseId: world.warehouseId,
        requestId: "activate",
        productId,
        ...fields,
        name: "Different",
      }),
      "REQUEST_ARGUMENT_CONFLICT",
    );
  });
  it("accepts measurement drafts but rejects zero, negative, fractional mm and excessive inputs", async () => {
    const world = await setup();
    const { palletId } = await measuredPallet(world);
    for (const [index, patch] of [
      { lengthMm: 0 },
      { heightMm: -1 },
      { widthMm: 1.5 },
      { lengthMm: 100001 },
      { quantity: 0 },
      { weightKg: -1 },
      { lot: "x".repeat(101) },
    ].entries())
      error(
        await call(world, workflow.saveMeasurement, {
          warehouseId: world.warehouseId,
          palletId,
          requestId: `invalid-${index}`,
          quantity: 5,
          lengthMm: 1000,
          widthMm: 1000,
          heightMm: 1000,
          ...patch,
        }),
        "FIELD_INVALID",
      );
    id(
      await call(world, workflow.saveMeasurement, {
        warehouseId: world.warehouseId,
        palletId,
        requestId: "partial",
        quantity: 7,
        lengthMm: 1000,
      }),
    );
    expect(
      value(
        await call(world, workflow.recommend, {
          warehouseId: world.warehouseId,
          palletId,
        }),
      ),
    ).toEqual({ candidates: [], reasons: ["MEASUREMENTS_REQUIRED"] });
    expect(
      value(
        await call(world, workflow.getPallet, {
          warehouseId: world.warehouseId,
          palletId,
        }),
      ),
    ).toMatchObject({
      pallet: { status: "AWAITING_MEASUREMENT", quantity: 7, lengthMm: 1000 },
    });
  });
  it("rechecks collisions, preserves old hold on failed replacement, and releases cancelled holds", async () => {
    const world = await setup();
    const a = await measuredPallet(world, "1"),
      b = await measuredPallet(world, "2");
    const firstId = id(await reserve(world, a.palletId));
    error(await reserve(world, b.palletId, "conflict"), "SPACE_OCCUPIED");
    id(await reserve(world, b.palletId, "reserve-b", 1000, 0));
    error(
      await reserve(world, a.palletId, "change-a", 1000, 0),
      "SPACE_OCCUPIED",
    );
    expect(
      value(
        await call(world, workflow.getPallet, {
          warehouseId: world.warehouseId,
          palletId: a.palletId,
        }),
      ),
    ).toMatchObject({ placement: { _id: firstId, status: "RESERVED" } });
    error(
      await call(world, workflow.saveMeasurement, {
        warehouseId: world.warehouseId,
        palletId: a.palletId,
        requestId: "reserved-edit",
        quantity: 1,
        lengthMm: 100,
        widthMm: 100,
        heightMm: 100,
      }),
      "RELEASE_RESERVATION_FIRST",
    );
    id(
      await call(world, workflow.cancelReservation, {
        warehouseId: world.warehouseId,
        palletId: a.palletId,
        requestId: "cancel",
      }),
    );
    id(await reserve(world, b.palletId, "replace-b", 0, 0));
    expect(
      value(
        await call(world, workflow.getPallet, {
          warehouseId: world.warehouseId,
          palletId: b.palletId,
        }),
      ),
    ).toMatchObject({ placement: { xMm: 0, yMm: 0, status: "RESERVED" } });
    const rows = await world.t.run((ctx) =>
      ctx.db.query("finishedGoodsPlacements").collect(),
    );
    expect(rows.filter((p) => p.status === "RESERVED")).toHaveLength(1);
  });
  it("only admits active compatible destinations and revalidates after scan", async () => {
    const world = await setup();
    const { palletId } = await measuredPallet(world);
    await world.t.run((ctx) =>
      ctx.db.patch(world.buildingId, { status: "DRAFT" }),
    );
    expect(
      value(
        await call(world, workflow.recommend, {
          warehouseId: world.warehouseId,
          palletId,
        }),
      ),
    ).toMatchObject({ candidates: [], reasons: ["NO_ACTIVE_LOCATIONS"] });
    error(await reserve(world, palletId), "LOCATION_UNAVAILABLE");
    await world.t.run(async (ctx) => {
      await ctx.db.patch(world.buildingId, { status: "ACTIVE" });
      await ctx.db.patch(world.zoneId, { storageCondition: "Cold" });
    });
    expect(
      value(
        await call(world, workflow.recommend, {
          warehouseId: world.warehouseId,
          palletId,
        }),
      ),
    ).toMatchObject({
      candidates: [],
      reasons: ["STORAGE_CONDITION_MISMATCH"],
    });
    error(await reserve(world, palletId), "STORAGE_CONDITION_MISMATCH");
    await world.t.run((ctx) =>
      ctx.db.patch(world.zoneId, { storageCondition: "dry" }),
    );
    id(await reserve(world, palletId));
    id(
      await call(world, workflow.verifyDestination, {
        warehouseId: world.warehouseId,
        palletId,
        requestId: "manual",
        code: "BLDG-A-F01-Z01",
        method: "MANUAL",
      }),
    );
    await world.t.run((ctx) =>
      ctx.db.patch(world.buildingId, { status: "ARCHIVED" }),
    );
    error(
      await call(world, workflow.confirmStored, {
        warehouseId: world.warehouseId,
        palletId,
        requestId: "store",
      }),
      "LOCATION_UNAVAILABLE",
    );
  });
  it("denies unauthenticated, read-only, cross-tenant and mismatched-warehouse operations", async () => {
    const world = await setup();
    const { palletId, productId } = await measuredPallet(world);
    await expect(
      call(world, workflow.list, { warehouseId: world.warehouseId }, false),
    ).rejects.toThrow("ANONYMOUS");
    await expect(
      call(world, workflow.list, { warehouseId: world.warehouses.alphaB }),
    ).rejects.toThrow();
    await world.t.run(async (ctx) => {
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_orgId_userId", (q) =>
          q.eq("orgId", world.orgA).eq("userId", world.userA),
        )
        .unique();
      await ctx.db.patch(membership!._id, { scopeMode: "ORG_WIDE" });
    });
    expect(
      (
        await call(world, workflow.getPallet, {
          warehouseId: world.warehouses.bravoA,
          palletId,
        })
      )["value"],
    ).toBeNull();
    error(
      await call(world, workflow.createPallet, {
        warehouseId: world.warehouses.bravoA,
        productId,
        requestId: "wrong-warehouse",
      }),
      "NOT_FOUND",
    );
    const readOnly = await setup("SUPERVISOR");
    expect(
      await call(readOnly, workflow.saveProduct, {
        warehouseId: readOnly.warehouseId,
        requestId: "denied",
        ...fields,
      }),
    ).toMatchObject({ ok: false });
    expect(
      value(
        await call(readOnly, workflow.list, {
          warehouseId: readOnly.warehouseId,
        }),
      ),
    ).toEqual({ products: [], pallets: [] });
  });
  it("rejects malformed placement bounds and stale measurement snapshots", async () => {
    const world = await setup();
    const { palletId } = await measuredPallet(world);
    error(await reserve(world, palletId, "negative", -1), "POSITION_INVALID");
    error(await reserve(world, palletId, "edge", 1200), "OUTSIDE_LOCATION");
    error(
      await call(world, workflow.reserve, {
        warehouseId: world.warehouseId,
        palletId,
        zoneId: world.zoneId,
        requestId: "stale",
        xMm: 0,
        yMm: 0,
        rotation: 0,
        expectedMeasurementUpdatedAt: 1,
      }),
      "MEASUREMENT_CHANGED",
    );
  });
  it("projects unavailable area presentation without changing its bounds", async () => {
    const world = await setup();
    const { palletId } = await measuredPallet(world);
    const blockId = await world.t.run((ctx) =>
      ctx.db.insert("storageFloorReservedBlocks", {
        orgId: world.orgA,
        warehouseId: world.warehouseId,
        buildingId: world.buildingId,
        floorId: world.floorId,
        label: "Equipment",
        color: "#123456",
        xMm: 2700,
        yMm: 3700,
        widthMm: 200,
        depthMm: 200,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const recommendation = value(
      await call(world, workflow.recommend, {
        warehouseId: world.warehouseId,
        palletId,
      }),
    );
    expect(recommendation).toMatchObject({
      candidates: [
        expect.objectContaining({
          unavailable: [
            {
              id: blockId,
              label: "Equipment",
              color: "#123456",
              xMm: 1700,
              yMm: 1700,
              widthMm: 200,
              depthMm: 200,
            },
          ],
        }),
      ],
    });
  });
  it("never silently drops blockers past one query page", async () => {
    const world = await setup();
    const { palletId } = await measuredPallet(world);
    await world.t.run(async (ctx) => {
      for (let i = 0; i < 101; i++)
        await ctx.db.insert("storageFloorReservedBlocks", {
          orgId: world.orgA,
          warehouseId: world.warehouseId,
          buildingId: world.buildingId,
          floorId: world.floorId,
          label: `Block ${i}`,
          xMm: i === 100 ? 1000 : 9000,
          yMm: i === 100 ? 2000 : 9000,
          widthMm: i === 100 ? 2000 : 1,
          depthMm: i === 100 ? 2000 : 1,
          createdAt: 1,
          updatedAt: 1,
        });
    });
    expect(
      value(
        await call(world, workflow.recommend, {
          warehouseId: world.warehouseId,
          palletId,
        }),
      ),
    ).toMatchObject({ candidates: [], reasons: ["NO_FREE_FOOTPRINT"] });
    error(await reserve(world, palletId), "UNAVAILABLE_AREA");
  });
  it("admits only one overlapping reservation when operators race", async () => {
    const world = await setup();
    const a = await measuredPallet(world, "race-a"),
      b = await measuredPallet(world, "race-b");
    const results = await Promise.all([
      reserve(world, a.palletId, "race-1"),
      reserve(world, b.palletId, "race-2"),
    ]);
    expect(
      results.map(value).filter((result) => result["written"] === true),
    ).toHaveLength(1);
    expect(
      results.map(value).filter((result) => result["written"] === false),
    ).toMatchObject([{ error: { code: "SPACE_OCCUPIED" } }]);
  });
  it("limits rack height below the next supporting shelf and verifies selected surface identity", async () => {
    const world = await setup();
    const { palletId } = await measuredPallet(world);
    const positions = await world.t.run(async (ctx) => {
      await ctx.db.patch(world.zoneId, { mode: "RACK" });
      const ids = [];
      for (let level = 0; level < 2; level++)
        ids.push(
          await ctx.db.insert("storagePositions", {
            orgId: world.orgA,
            warehouseId: world.warehouseId,
            buildingId: world.buildingId,
            floorId: world.floorId,
            zoneId: world.zoneId,
            locationId: world.locationId,
            code: `SHELF-${level}`,
            label: `Shelf ${level}`,
            qrValue: `SHELF-QR-${level}`,
            kind: "RACK_SLOT",
            isDefault: false,
            xMm: 1000,
            yMm: 2000,
            widthMm: 2000,
            depthMm: 2000,
            elevationMm: level * 1000,
            status: "ACTIVE",
            createdAt: 1,
            createdByUserId: world.userA,
            updatedAt: 1,
            updatedByUserId: world.userA,
          }),
        );
      return ids;
    });
    const recommendations = value(
      await call(world, workflow.recommend, {
        warehouseId: world.warehouseId,
        palletId,
      }),
    );
    expect(recommendations["candidates"]).toMatchObject([
      {
        supportPositionId: positions[1],
        supportLabel: "Shelf 1",
        supportCode: "SHELF-1",
        zMm: 1000,
        support: { heightMm: 2000 },
      },
    ]);
    id(
      await call(world, workflow.reserve, {
        warehouseId: world.warehouseId,
        palletId,
        zoneId: world.zoneId,
        supportPositionId: positions[1],
        requestId: "rack-reserve",
        xMm: 0,
        yMm: 0,
        rotation: 0,
      }),
    );
    error(
      await call(world, workflow.verifyDestination, {
        warehouseId: world.warehouseId,
        palletId,
        requestId: "wrong-shelf",
        code: "SHELF-QR-0",
        method: "SCAN",
      }),
      "DESTINATION_MISMATCH",
    );
    id(
      await call(world, workflow.verifyDestination, {
        warehouseId: world.warehouseId,
        palletId,
        requestId: "right-shelf",
        code: "SHELF-QR-1",
        method: "SCAN",
      }),
    );
    error(
      await call(world, workflow.verifyDestination, {
        warehouseId: world.warehouseId,
        palletId,
        requestId: "wrong-again",
        code: "SHELF-QR-0",
        method: "SCAN",
      }),
      "DESTINATION_MISMATCH",
    );
    error(
      await call(world, workflow.confirmStored, {
        warehouseId: world.warehouseId,
        palletId,
        requestId: "not-verified",
      }),
      "DESTINATION_NOT_VERIFIED",
    );
  });
  it("fails a complete tenant batch explicitly when its configured bound is exceeded", async () => {
    const world = await setup();
    await measuredPallet(world, "one");
    await measuredPallet(world, "two");
    const bounded = queryWithOrg({
      args: { warehouseId: v.id("warehouses") },
      returns: v.any(),
      permissionCode: "masterData.storageLayout.read",
      target: { table: "finishedGoodsProducts" },
      warehouseId: (a) => a.warehouseId,
      handler: async (ctx, args) =>
        ctx.tenantDb
          .byIndex("finishedGoodsProducts", "by_orgId_warehouseId_sku", [
            { field: "warehouseId", value: args.warehouseId },
          ])
          .all(1),
    });
    await expect(
      call(world, bounded, { warehouseId: world.warehouseId }),
    ).rejects.toThrow("CAPACITY_DATA_LIMIT");
  });
  it("treats product ANY as no extra constraint while unconfigured locations stay unknown", async () => {
    const world = await setup();
    const { palletId, productId } = await measuredPallet(world);
    await world.t.run(async (ctx) => {
      await ctx.db.patch(productId as Id<"finishedGoodsProducts">, {
        storageCondition: "ANY",
      });
      await ctx.db.patch(world.zoneId, { storageCondition: "COOL" });
    });
    expect(
      value(
        await call(world, workflow.recommend, {
          warehouseId: world.warehouseId,
          palletId,
        }),
      )["candidates"],
    ).toMatchObject([{ checks: { storageCondition: "MATCH" } }]);
    await world.t.run((ctx) =>
      ctx.db.patch(world.zoneId, { storageCondition: undefined }),
    );
    expect(
      value(
        await call(world, workflow.recommend, {
          warehouseId: world.warehouseId,
          palletId,
        }),
      )["candidates"],
    ).toMatchObject([{ checks: { storageCondition: "UNKNOWN" } }]);
  });
  it("exposes actual manage grants for UI affordances without granting supervisor writes", async () => {
    const admin = await setup();
    const supervisor = await setup("SUPERVISOR");
    expect(
      value(await call(admin, readCurrent, {}))["navigationPermissions"],
    ).toContain("masterData.storageLayout.manage");
    expect(
      value(await call(supervisor, readCurrent, {}))["navigationPermissions"],
    ).not.toContain("masterData.storageLayout.manage");
    expect(
      value(await call(supervisor, readCurrent, {}))["navigationPermissions"],
    ).toContain("masterData.storageLayout.read");
  });
});
