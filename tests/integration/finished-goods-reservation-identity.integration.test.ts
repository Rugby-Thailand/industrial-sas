import type { Id } from "../../convex/_generated/dataModel";
import type { GenericMutationCtx } from "convex/server";
import { expect, it } from "vitest";
import * as workflow from "../../convex/finishedGoods/workflow";
import type { DataModel } from "../../convex/schema";
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
      expectedMeasurementUpdatedAt: (await world.t.run((ctx) =>
        ctx.db.get(palletId as Id<"finishedGoodsPallets">),
      ))!.updatedAt,
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
    expectedMeasurementUpdatedAt: (await world.t.run((ctx) =>
      ctx.db.get(palletId as Id<"finishedGoodsPallets">),
    ))!.updatedAt,
    xMm,
    yMm,
    rotation: 0,
  });
}

// Reservation commands captured by tab A carry the reviewed placement identity.
// Tab B replaces the reservation before those commands reach the server.
it("a delayed physical confirmation must not store a replacement reservation", async () => {
  const world = await setup();
  const { palletId } = await measuredPallet(world);
  const first = id(await reserve(world, palletId, "reserve-a"));
  const args = { warehouseId: world.warehouseId, palletId };
  id(
    await call(world, workflow.verifyDestination, {
      ...args,
      requestId: "verify-a",
      code: "BLDG-A-F01-Z01",
      method: "MANUAL",
    }),
  );
  // A has physically placed the pallet at A's coordinates and clicked Confirm.
  const delayedStore = {
    ...args,
    expectedPlacementId: first,
    requestId: "store-from-tab-a",
  };
  // B moves the reservation within the same zone and verifies it on the same
  // user account; A's HTTP request has not yet reached the mutation handler.
  const replacement = id(await reserve(world, palletId, "reserve-b", 700, 0));
  expect(replacement).not.toBe(first);
  id(
    await call(world, workflow.verifyDestination, {
      ...args,
      requestId: "verify-b",
      code: "BLDG-A-F01-Z01",
      method: "MANUAL",
    }),
  );
  const before = await reservationState(world, palletId, replacement);
  expect(
    value(await call(world, workflow.confirmStored, delayedStore)),
  ).toMatchObject({
    written: false,
    error: { code: "RESERVATION_CHANGED" },
  });
  expect(await reservationState(world, palletId, replacement)).toEqual(before);
  const latest = await world.t.run((ctx) =>
    ctx.db.get(replacement as Id<"finishedGoodsPlacements">),
  );
  expect(latest).toMatchObject({ xMm: 700 });
  const storedAtUnconfirmedReplacement = Number(latest!.status === "STORED");
  expect(storedAtUnconfirmedReplacement).toBe(0);
});

it("a delayed release must preserve another tab's replacement reservation", async () => {
  const world = await setup();
  const { palletId } = await measuredPallet(world);
  const first = id(await reserve(world, palletId, "reserve-a"));
  const delayedCancel = {
    warehouseId: world.warehouseId,
    palletId,
    requestId: "cancel-from-tab-a",
    expectedPlacementId: first,
  };
  const replacement = id(await reserve(world, palletId, "reserve-b", 700, 0));
  const before = await reservationState(world, palletId, replacement);
  expect(
    value(await call(world, workflow.cancelReservation, delayedCancel)),
  ).toMatchObject({
    written: false,
    error: { code: "RESERVATION_CHANGED" },
  });
  expect(await reservationState(world, palletId, replacement)).toEqual(before);
  const latest = await world.t.run((ctx) =>
    ctx.db.get(replacement as Id<"finishedGoodsPlacements">),
  );
  expect(Number(latest!.status === "RESERVED")).toBe(1);
});

async function reservationState(
  world: ConvexTenantWorld,
  palletId: string,
  placementId: string,
) {
  return world.t.run(async (ctx) => ({
    pallet: await ctx.db.get(palletId as Id<"finishedGoodsPallets">),
    placement: await ctx.db.get(placementId as Id<"finishedGoodsPlacements">),
  }));
}

it("delayed verification must not verify or clear a replacement reservation", async () => {
  const world = await setup();
  const { palletId } = await measuredPallet(world);
  const first = id(await reserve(world, palletId, "reserve-a"));
  const replacement = id(await reserve(world, palletId, "reserve-b", 700, 0));
  const args = { warehouseId: world.warehouseId, palletId, method: "MANUAL" };
  const before = await reservationState(world, palletId, replacement);
  expect(
    value(
      await call(world, workflow.verifyDestination, {
        ...args,
        expectedPlacementId: first,
        requestId: "delayed-verify",
        code: "BLDG-A-F01-Z01",
      }),
    ),
  ).toMatchObject({ written: false, error: { code: "RESERVATION_CHANGED" } });
  expect(await reservationState(world, palletId, replacement)).toEqual(before);
  id(
    await call(world, workflow.verifyDestination, {
      ...args,
      expectedPlacementId: replacement,
      requestId: "verify-replacement",
      code: "BLDG-A-F01-Z01",
    }),
  );
  const verified = await reservationState(world, palletId, replacement);
  expect(
    value(
      await call(world, workflow.verifyDestination, {
        ...args,
        expectedPlacementId: first,
        requestId: "delayed-wrong-verify",
        code: "wrong-code",
      }),
    ),
  ).toMatchObject({ written: false, error: { code: "RESERVATION_CHANGED" } });
  expect(await reservationState(world, palletId, replacement)).toEqual(
    verified,
  );
});

it.each(["current placement", "legacy client"])(
  "%s commands can verify, confirm and cancel reservations",
  async (client) => {
    for (const action of ["confirm", "cancel"]) {
      const world = await setup();
      const { palletId } = await measuredPallet(world, action);
      id(await reserve(world, palletId, `reserve-first-${action}`));
      const placementId = id(
        await reserve(world, palletId, `reserve-current-${action}`, 700, 0),
      );
      const args = {
        warehouseId: world.warehouseId,
        palletId,
        ...(client === "current placement"
          ? { expectedPlacementId: placementId }
          : {}),
      };
      id(
        await call(world, workflow.verifyDestination, {
          ...args,
          requestId: `verify-${action}`,
          code: "BLDG-A-F01-Z01",
          method: "MANUAL",
        }),
      );
      id(
        await call(
          world,
          action === "confirm"
            ? workflow.confirmStored
            : workflow.cancelReservation,
          {
            ...args,
            requestId: action,
          },
        ),
      );
      const state = await reservationState(world, palletId, placementId);
      expect(state.placement!.status).toBe(
        action === "confirm" ? "STORED" : "RELEASED",
      );
      expect(state.pallet!.status).toBe(
        action === "confirm" ? "STORED" : "AWAITING_PLACEMENT",
      );
      expect(state.pallet!.placementId).toBe(
        action === "confirm" ? placementId : undefined,
      );
    }
  },
);
