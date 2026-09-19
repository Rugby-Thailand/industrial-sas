import type { Id } from "../../convex/_generated/dataModel";
import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";
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

async function storedWorld() {
  const world = await setup();
  const { palletId } = await measuredPallet(world);
  const sourcePlacementId = id(await reserve(world, palletId));
  const base = { warehouseId: world.warehouseId, palletId };
  id(
    await call(world, workflow.verifyDestination, {
      ...base,
      requestId: "initial-verify",
      code: "BLDG-A-F01-Z01",
      method: "MANUAL",
    }),
  );
  id(
    await call(world, workflow.confirmStored, {
      ...base,
      requestId: "initial-store",
    }),
  );
  const prepare = {
    ...base,
    requestId: "move-prepare",
    expectedSourcePlacementId: sourcePlacementId,
    zoneId: world.zoneId,
    xMm: 200,
    yMm: 300,
    rotation: 90,
  };
  return { ...world, palletId, sourcePlacementId, base, prepare };
}
async function stackingWorld() {
  const w = await storedWorld();
  const upper = await measuredPallet(w, "upper");
  const config = {
    stackable: true,

    maxStackLevels: 3,
  };
  id(
    await call(w, workflow.saveStackingLimits, {
      ...w.base,
      ...config,
      requestId: "lower-limits",
    }),
  );
  id(
    await call(w, workflow.saveStackingLimits, {
      warehouseId: w.warehouseId,
      palletId: upper.palletId,
      ...config,

      requestId: "upper-limits",
    }),
  );
  const stack = {
    warehouseId: w.warehouseId,
    palletId: upper.palletId,
    zoneId: w.zoneId,
    supportPalletId: w.palletId,
    xMm: 0,
    yMm: 0,
    rotation: 0,
    requestId: "stack-reserve",
  };
  return { ...w, upperId: upper.palletId, stack };
}
async function confirmStack(w: Awaited<ReturnType<typeof stackingWorld>>) {
  id(
    await call(w, workflow.verifyDestination, {
      ...w.stack,
      requestId: "verify-stack",
      code: "P-000001",
      method: "MANUAL",
    }),
  );
  return call(w, workflow.confirmStored, {
    warehouseId: w.warehouseId,
    palletId: w.upperId,
    requestId: "store-stack",
    palletCode: "P-000002",
    physicalConfirmed: true,
  });
}
describe("pallet stacking", () => {
  it("omits disabled pallet supports while retaining valid floor destinations", async () => {
    const w = await stackingWorld();
    id(
      await call(w, workflow.saveStackingLimits, {
        ...w.base,

        stackable: false,

        maxStackLevels: 3,
        requestId: "disable-stack",
      }),
    );
    const result = value(
      await call(w, workflow.recommend, {
        warehouseId: w.warehouseId,
        palletId: w.upperId,
      }),
    );
    const candidates = result["candidates"] as Array<{
      supportPalletId?: string;
      zMm: number;
    }>;
    expect(candidates.some((c) => c.supportPalletId === w.palletId)).toBe(
      false,
    );
    expect(candidates.some((c) => c.zMm === 0)).toBe(true);
    expect(result["candidates"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          previewSupports: expect.arrayContaining([
            expect.objectContaining({
              supportPalletId: w.palletId,
              blockedReason: "STACK_LIMITS_REQUIRED",
              surface: expect.objectContaining({ zMm: 1400 }),
            }),
          ]),
        }),
      ]),
    );
  });

  it("offers valid pallet-top Z levels in ordinary storage and move recommendations", async () => {
    const w = await stackingWorld();
    const args = { warehouseId: w.warehouseId, palletId: w.upperId };
    const recommended = value(await call(w, workflow.recommend, args));
    expect(recommended["candidates"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ supportPalletId: w.palletId, zMm: 1400 }),
        expect.objectContaining({ zMm: 0 }),
      ]),
    );
    const floor = (
      recommended["candidates"] as Array<{
        zMm: number;
        xMm: number;
        yMm: number;
        rotation: number;
      }>
    ).find((c) => c.zMm === 0)!;
    id(
      await call(w, workflow.reserve, {
        ...args,
        zoneId: w.zoneId,
        xMm: floor.xMm,
        yMm: floor.yMm,
        rotation: floor.rotation,
        requestId: "upper-floor",
      }),
    );
    id(
      await call(w, workflow.verifyDestination, {
        ...args,
        code: "BLDG-A-F01-Z01",
        method: "MANUAL",
        requestId: "upper-floor-verify",
      }),
    );
    id(
      await call(w, workflow.confirmStored, {
        ...args,
        requestId: "upper-floor-store",
      }),
    );
    const moving = value(await call(w, workflow.recommendMove, args));
    expect(moving["candidates"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ supportPalletId: w.palletId, zMm: 1400 }),
      ]),
    );
    expect(
      (moving["candidates"] as Array<{ supportPalletId?: string }>).some(
        (c) => c.supportPalletId === w.upperId,
      ),
    ).toBe(false);
  });

  it("derives height, requires both identities and physical confirmation, and locks the lower pallet", async () => {
    const w = await stackingWorld();
    const placementId = id(await call(w, workflow.reserve, w.stack));
    const p = await w.t.run((ctx) =>
      ctx.db.get(placementId as Id<"finishedGoodsPlacements">),
    );
    expect(p).toMatchObject({
      zMm: 1400,
      supportPalletId: w.palletId,
      status: "RESERVED",
    });
    error(
      await call(w, workflow.reserveMove, w.prepare),
      "PALLET_SUPPORTING_STACK",
    );
    error(
      await call(w, workflow.verifyDestination, {
        ...w.stack,
        requestId: "wrong-zone",
        code: "BLDG-A-F01-Z01",
        method: "MANUAL",
      }),
      "DESTINATION_MISMATCH",
    );
    id(
      await call(w, workflow.verifyDestination, {
        ...w.stack,
        requestId: "right-parent",
        code: "P-000001",
        method: "MANUAL",
      }),
    );
    error(
      await call(w, workflow.confirmStored, {
        ...w.stack,
        requestId: "missing-physical",
      }),
      "STACK_PHYSICAL_VERIFICATION_REQUIRED",
    );
    error(
      await call(w, workflow.confirmStored, {
        ...w.stack,
        requestId: "wrong-upper",
        physicalConfirmed: true,
        palletCode: "P-000001",
      }),
      "STACK_PHYSICAL_VERIFICATION_REQUIRED",
    );
    id(await confirmStack(w));
    const detail = value(await call(w, workflow.getPallet, w.base));
    expect(detail["stackChildren"]).toHaveLength(1);
    expect(id(await confirmStack(w))).toBe(w.upperId);
  });
  it("requires explicit permission and valid integer level limits", async () => {
    const w = await storedWorld();
    const { palletId } = await measuredPallet(w, "upper");
    const args = {
      warehouseId: w.warehouseId,
      palletId,
      zoneId: w.zoneId,
      supportPalletId: w.palletId,
      xMm: 0,
      yMm: 0,
      rotation: 0,
      requestId: "missing-weight",
    };
    error(await call(w, workflow.reserve, args), "STACK_LIMITS_REQUIRED");
    id(
      await call(w, workflow.saveStackingLimits, {
        warehouseId: w.warehouseId,
        palletId,

        stackable: false,
        requestId: "weight",
      }),
    );
    error(
      await call(w, workflow.reserve, { ...args, requestId: "missing-limits" }),
      "STACK_LIMITS_REQUIRED",
    );
    error(
      await call(w, workflow.saveStackingLimits, {
        ...w.base,

        stackable: true,

        maxStackLevels: -1,
        requestId: "negative",
      }),
      "STACK_LIMITS_REQUIRED",
    );
    error(
      await call(w, workflow.saveStackingLimits, {
        ...w.base,

        stackable: true,

        maxStackLevels: 1.5,
        requestId: "fractional",
      }),
      "STACK_LIMITS_REQUIRED",
    );
  });
  it("rejects overhang, ceiling overflow and another pallet on an occupied support", async () => {
    const w = await stackingWorld();
    error(
      await call(w, workflow.reserve, {
        ...w.stack,
        xMm: 1,
        requestId: "overhang",
      }),
      "OUTSIDE_LOCATION",
    );
    await w.t.run((ctx) =>
      ctx.db.patch(w.upperId as Id<"finishedGoodsPallets">, { heightMm: 1700 }),
    );
    error(
      await call(w, workflow.reserve, { ...w.stack, requestId: "too-tall" }),
      "HEIGHT_EXCEEDED",
    );
    await w.t.run((ctx) =>
      ctx.db.patch(w.upperId as Id<"finishedGoodsPallets">, {
        heightMm: 1400,
      }),
    );
    id(await call(w, workflow.reserve, w.stack));
    const other = await measuredPallet(w, "other");
    id(
      await call(w, workflow.saveStackingLimits, {
        warehouseId: w.warehouseId,
        palletId: other.palletId,

        stackable: false,
        requestId: "other-weight",
      }),
    );
    error(
      await call(w, workflow.reserve, {
        ...w.stack,
        palletId: other.palletId,
        requestId: "occupied",
      }),
      "STACK_SUPPORT_OCCUPIED",
    );
  });
  it("holds support capacity until reservation cancellation", async () => {
    const w = await stackingWorld();
    id(await call(w, workflow.reserve, w.stack));
    error(
      await call(w, workflow.saveStackingLimits, {
        ...w.base,

        stackable: false,
        requestId: "reduce",
      }),
      "PALLET_SUPPORTING_STACK",
    );
    id(
      await call(w, workflow.cancelReservation, {
        warehouseId: w.warehouseId,
        palletId: w.upperId,
        requestId: "cancel-stack",
      }),
    );
    id(
      await call(w, workflow.reserveMove, {
        ...w.prepare,
        requestId: "now-can-move",
      }),
    );
    error(
      await call(w, workflow.reserve, {
        ...w.stack,
        requestId: "support-moving",
      }),
      "STACK_SUPPORT_MOVING",
    );
  });
  it("checks maximum levels against every ancestor", async () => {
    const w = await stackingWorld();
    await w.t.run(async (ctx) => {
      await ctx.db.patch(w.upperId as Id<"finishedGoodsPallets">, {
        heightMm: 500,
      });
      await ctx.db.patch(w.palletId as Id<"finishedGoodsPallets">, {
        maxStackLevels: 2,
      });
    });
    id(await call(w, workflow.reserve, w.stack));
    id(await confirmStack(w));
    const third = await measuredPallet(w, "third");
    await w.t.run((ctx) =>
      ctx.db.patch(third.palletId as Id<"finishedGoodsPallets">, {
        heightMm: 500,
      }),
    );
    const args = {
      ...w.stack,
      palletId: third.palletId,
      supportPalletId: w.upperId,
      requestId: "three-levels",
    };
    error(await call(w, workflow.reserve, args), "STACK_LEVELS_EXCEEDED");
    await w.t.run((ctx) =>
      ctx.db.patch(w.palletId as Id<"finishedGoodsPallets">, {
        maxStackLevels: 3,
      }),
    );
    id(await call(w, workflow.reserve, { ...args, requestId: "exact-limit" }));
  });
  it.each([false, true])(
    "moves the upper pallet away while holding its original support until completion (checkbox=%s)",
    async (checkbox) => {
      const w = await stackingWorld();
      id(await call(w, workflow.reserve, w.stack));
      id(await confirmStack(w));
      await w.t.run((ctx) =>
        ctx.db.patch(w.zoneId, { widthMm: 5000, depthMm: 5000 }),
      );
      const upper = await w.t.run((ctx) =>
        ctx.db.get(w.upperId as Id<"finishedGoodsPallets">),
      );
      const base = { warehouseId: w.warehouseId, palletId: w.upperId };
      const moveId = id(
        await call(w, workflow.reserveMove, {
          ...base,
          requestId: "unstack",
          zoneId: w.zoneId,
          xMm: 2000,
          yMm: 0,
          rotation: 0,
          expectedSourcePlacementId: upper!.placementId,
        }),
      );
      id(
        await call(w, workflow.startMove, {
          ...base,
          moveId,
          requestId: "pickup-upper",
          ...(checkbox
            ? { confirmationMethod: "ACKNOWLEDGEMENT" }
            : { code: "P-000002", method: "MANUAL" }),
          physicalConfirmed: true,
        }),
      );
      error(
        await call(w, workflow.reserveMove, {
          ...w.prepare,
          requestId: "still-locked",
        }),
        "PALLET_SUPPORTING_STACK",
      );
      if (!checkbox)
        id(
          await call(w, workflow.verifyMoveDestination, {
            ...base,
            moveId,
            requestId: "verify-unstack",
            code: "BLDG-A-F01-Z01",
            method: "MANUAL",
          }),
        );
      id(
        await call(w, workflow.completeMove, {
          ...base,
          moveId,
          requestId: "finish-unstack",
          ...(checkbox ? { confirmationMethod: "ACKNOWLEDGEMENT" } : {}),
          physicalConfirmed: true,
        }),
      );
      id(
        await call(w, workflow.reserveMove, {
          ...w.prepare,
          requestId: "unlocked",
        }),
      );
    },
  );
  it("requires permission and warehouse scope", async () => {
    const w = await stackingWorld();
    await expect(call(w, workflow.reserve, w.stack, false)).rejects.toThrow(
      "ANONYMOUS",
    );
    error(
      await call(w, workflow.reserve, {
        ...w.stack,
        supportPalletId: w.upperId,
        requestId: "self",
      }),
      "SUPPORT_REQUIRED",
    );
    await expect(
      call(w, workflow.reserve, {
        ...w.stack,
        warehouseId: w.warehouses.bravoA,
        requestId: "other-warehouse",
      }),
    ).rejects.toThrow("WAREHOUSE_OUT_OF_SCOPE");
  });
});

it("moves an already stored upper pallet onto a support with a verified pickup and support identity", async () => {
  const w = await stackingWorld();
  await w.t.run((ctx) =>
    ctx.db.patch(w.zoneId, { widthMm: 5000, depthMm: 5000 }),
  );
  const base = { warehouseId: w.warehouseId, palletId: w.upperId };
  const old = id(await reserve(w, w.upperId, "upper-floor", 2000, 0));
  id(
    await call(w, workflow.verifyDestination, {
      ...base,
      requestId: "floor-verify",
      code: "BLDG-A-F01-Z01",
      method: "MANUAL",
    }),
  );
  id(
    await call(w, workflow.confirmStored, {
      ...base,
      requestId: "floor-store",
    }),
  );
  const moveId = id(
    await call(w, workflow.reserveMove, {
      ...w.stack,
      expectedSourcePlacementId: old,
      requestId: "move-to-stack",
    }),
  );
  error(
    await call(w, workflow.reserveMove, w.prepare),
    "PALLET_SUPPORTING_STACK",
  );
  id(
    await call(w, workflow.startMove, {
      ...base,
      moveId,
      requestId: "pickup",
      code: "P-000002",
      method: "MANUAL",
      physicalConfirmed: true,
    }),
  );
  error(
    await call(w, workflow.verifyMoveDestination, {
      ...base,
      moveId,
      requestId: "wrong-destination",
      code: "BLDG-A-F01-Z01",
      method: "MANUAL",
    }),
    "DESTINATION_MISMATCH",
  );
  id(
    await call(w, workflow.verifyMoveDestination, {
      ...base,
      moveId,
      requestId: "right-destination",
      code: `ISAS:PALLET:1:${w.palletId}`,
      method: "SCAN",
    }),
  );
  id(
    await call(w, workflow.completeMove, {
      ...base,
      moveId,
      requestId: "finish",
      physicalConfirmed: true,
    }),
  );
  const upper = await w.t.run((ctx) =>
    ctx.db.get(w.upperId as Id<"finishedGoodsPallets">),
  );
  const placed = await w.t.run((ctx) => ctx.db.get(upper!.placementId!));
  expect(placed).toMatchObject({
    supportPalletId: w.palletId,
    zMm: 1400,
    status: "STORED",
  });
  expect(upper!.quantity).toBe(500);
});
it("returns an upper pallet to its stack after an interrupted move", async () => {
  const w = await stackingWorld();
  id(await call(w, workflow.reserve, w.stack));
  id(await confirmStack(w));
  await w.t.run((ctx) =>
    ctx.db.patch(w.zoneId, { widthMm: 5000, depthMm: 5000 }),
  );
  const upper = await w.t.run((ctx) =>
    ctx.db.get(w.upperId as Id<"finishedGoodsPallets">),
  );
  const base = { warehouseId: w.warehouseId, palletId: w.upperId };
  const moveId = id(
    await call(w, workflow.reserveMove, {
      ...base,
      requestId: "unstack-return",
      zoneId: w.zoneId,
      xMm: 2000,
      yMm: 0,
      rotation: 0,
      expectedSourcePlacementId: upper!.placementId,
    }),
  );
  id(
    await call(w, workflow.startMove, {
      ...base,
      moveId,
      requestId: "pickup-return",
      code: "P-000002",
      method: "MANUAL",
      physicalConfirmed: true,
    }),
  );
  error(
    await call(w, workflow.returnMove, {
      ...base,
      moveId,
      requestId: "wrong-return",
      code: "BLDG-A-F01-Z01",
      method: "MANUAL",
      physicalConfirmed: true,
    }),
    "SOURCE_MISMATCH",
  );
  id(
    await call(w, workflow.returnMove, {
      ...base,
      moveId,
      requestId: "right-return",
      code: "P-000001",
      method: "MANUAL",
      physicalConfirmed: true,
    }),
  );
  error(
    await call(w, workflow.reserveMove, w.prepare),
    "PALLET_SUPPORTING_STACK",
  );
});

it("excludes retired/box units and uses the unit format before legacy product defaults", async () => {
  const w = await stackingWorld();
  const retired = await measuredPallet(w, "retired");
  const box = await measuredPallet(w, "box");
  await w.t.run(async (ctx) => {
    await ctx.db.patch(retired.palletId as Id<"finishedGoodsPallets">, {
      retiredAt: Date.now(),
    });
    await ctx.db.patch(box.palletId as Id<"finishedGoodsPallets">, {
      storageFormat: "BOX",
    });
  });
  const options = value(
    await call(w, workflow.stackOptions, { ...w.base, rotation: 0 }),
  );
  expect(
    (options["pallets"] as Array<{ _id: string }>).map((p) => p._id),
  ).toEqual([w.upperId]);
  error(
    await call(w, workflow.reserve, {
      ...w.stack,
      palletId: box.palletId,
      requestId: "box-stack",
    }),
    "STACK_PALLET_ONLY",
  );
  error(
    await call(w, workflow.reserve, {
      ...w.stack,
      palletId: retired.palletId,
      requestId: "retired-stack",
    }),
    "NOT_FOUND",
  );
  error(
    await call(w, workflow.saveStackingLimits, {
      ...w.base,
      palletId: box.palletId,
      stackable: true,
      maxStackLevels: 2,
      requestId: "box-limits",
    }),
    "STACK_PALLET_ONLY",
  );
});
it("configuring and stacking leaves optional measured weights and product quantities unchanged", async () => {
  const w = await stackingWorld();
  await w.t.run((ctx) =>
    ctx.db.patch(w.palletId as Id<"finishedGoodsPallets">, { weightKg: 12 }),
  );
  id(
    await call(w, workflow.saveStackingLimits, {
      ...w.base,
      stackable: true,
      maxStackLevels: 2,
      requestId: "no-weight-write",
    }),
  );
  id(await call(w, workflow.reserve, w.stack));
  id(await confirmStack(w));
  const units = await w.t.run((ctx) =>
    ctx.db.query("finishedGoodsPallets").collect(),
  );
  expect(units.map((p) => p.quantity)).toEqual([500, 500]);
  expect(units.map((p) => p.weightKg)).toEqual([12, undefined]);
});

it("serializes competing reservations and replays a retry without duplicate holds", async () => {
  const w = await stackingWorld();
  const other = await measuredPallet(w, "competitor");
  const competing = {
    ...w.stack,
    palletId: other.palletId,
    requestId: "competitor-reserve",
  };
  const results = await Promise.all([
    call(w, workflow.reserve, w.stack),
    call(w, workflow.reserve, competing),
  ]);
  const outcomes = results.map(value);
  expect(outcomes.filter((r) => r["written"])).toHaveLength(1);
  expect(outcomes.filter((r) => !r["written"])).toEqual([
    expect.objectContaining({ error: { code: "STACK_SUPPORT_OCCUPIED" } }),
  ]);
  const winner = outcomes[0]!["written"] ? w.stack : competing;
  const retry = value(await call(w, workflow.reserve, winner));
  expect(retry).toMatchObject({ written: true, replayed: true });
  const holds = await w.t.run((ctx) =>
    ctx.db.query("finishedGoodsPlacements").collect(),
  );
  expect(
    holds.filter(
      (p) => p.supportPalletId === w.palletId && p.status !== "RELEASED",
    ),
  ).toHaveLength(1);
});
it("rechecks changed limits on confirmation and keeps a failed stack reserved", async () => {
  const w = await stackingWorld();
  id(await call(w, workflow.reserve, w.stack));
  id(
    await call(w, workflow.verifyDestination, {
      ...w.stack,
      code: "P-000001",
      method: "MANUAL",
      requestId: "verify-before-change",
    }),
  );
  await w.t.run((ctx) =>
    ctx.db.patch(w.palletId as Id<"finishedGoodsPallets">, {
      stackable: false,
    }),
  );
  error(
    await call(w, workflow.confirmStored, {
      warehouseId: w.warehouseId,
      palletId: w.upperId,
      requestId: "confirm-after-change",
      palletCode: "P-000002",
      physicalConfirmed: true,
    }),
    "STACK_LIMITS_REQUIRED",
  );
  const upper = await w.t.run((ctx) =>
    ctx.db.get(w.upperId as Id<"finishedGoodsPallets">),
  );
  expect(upper?.status).toBe("RESERVED");
  id(
    await call(w, workflow.cancelReservation, {
      warehouseId: w.warehouseId,
      palletId: w.upperId,
      requestId: "cancel-invalid",
    }),
  );
  id(await call(w, workflow.reserveMove, w.prepare));
});
it("preserves the root ceiling when stacking on an elevated storage surface", async () => {
  const w = await stackingWorld();
  await w.t.run(async (ctx) => {
    await ctx.db.patch(w.zoneId, {
      baseElevationMm: 1000,
      maxStackHeightMm: 2000,
    });
    await ctx.db.patch(w.sourcePlacementId as Id<"finishedGoodsPlacements">, {
      zMm: 1000,
    });
  });
  error(await call(w, workflow.reserve, w.stack), "HEIGHT_EXCEEDED");
});

it("protects supporting batch units independently of cached status, then repacks 4 to 2 after release", async () => {
  const batches = await import("../../convex/finishedGoods/batches");
  const w = await stackingWorld();
  const product = await w.t.run((ctx) =>
    ctx.db.get(w.palletId as Id<"finishedGoodsPallets">),
  );
  const args = {
    warehouseId: w.warehouseId,
    productId: product!.productId,
    requestId: "batch-four",
    totalQuantity: 100,
    storageFormat: "PALLET",
    packages: Array.from({ length: 4 }, () => ({
      quantity: 25,
      lengthMm: 1200,
      widthMm: 1000,
      heightMm: 1400,
      dimensionsChecked: true,
    })),
  };
  const receipt = value(await call(w, batches.commitBatch, args));
  const lowerId = (receipt["palletIds"] as string[])[0]!;
  const lower = await w.t.run((ctx) =>
    ctx.db.get(lowerId as Id<"finishedGoodsPallets">),
  );
  // A stale convenience status must not bypass a physical support relationship.
  const holdId = await w.t.run(async (ctx) => {
    const original = await ctx.db.get(
      w.sourcePlacementId as Id<"finishedGoodsPlacements">,
    );
    const { _id, _creationTime, ...fields } = original!;
    void _id;
    void _creationTime;
    return ctx.db.insert("finishedGoodsPlacements", {
      ...fields,
      palletId: w.upperId as Id<"finishedGoodsPallets">,
      supportPalletId: lower!._id,
      zMm: 1400,
      status: "RESERVED",
    });
  });
  const repack = {
    ...args,
    requestId: "batch-two",
    batchId: lower!.preparationBatchId,
    expectedRevision: 1,
    packages: args.packages.slice(0, 2).map((p) => ({ ...p, quantity: 50 })),
  };
  error(await call(w, batches.commitBatch, repack), "BATCH_NOT_EDITABLE");
  await w.t.run((ctx) => ctx.db.patch(holdId, { status: "RELEASED" }));
  id(
    await call(w, workflow.saveStackingLimits, {
      warehouseId: w.warehouseId,
      palletId: lowerId,
      requestId: "old-config",
      stackable: true,
      maxStackLevels: 2,
    }),
  );
  const updated = value(
    await call(w, batches.commitBatch, {
      ...repack,
      requestId: "batch-two-retry",
    }),
  );
  expect(updated["written"]).toBe(true);
  const current = await w.t.run((ctx) =>
    ctx.db.query("finishedGoodsPallets").collect(),
  );
  const active = current.filter(
    (p) => p.preparationBatchId === lower!.preparationBatchId && !p.retiredAt,
  );
  expect(active.map((p) => p.quantity)).toEqual([50, 50]);
  expect(
    active.every(
      (p) => p.stackable === undefined && p.maxStackLevels === undefined,
    ),
  ).toBe(true);
  const options = value(
    await call(w, workflow.stackOptions, { ...w.base, rotation: 0 }),
  );
  expect(
    (options["pallets"] as Array<{ _id: string }>).some(
      (p) => p._id === lowerId,
    ),
  ).toBe(false);
});

it("retains rejected support geometry when no valid destination fits", async () => {
  const w = await stackingWorld();
  await w.t.run((ctx) =>
    ctx.db.patch(w.zoneId, {
      widthMm: 1000,
      depthMm: 1200,
      maxStackHeightMm: 2000,
    }),
  );
  const result = value(
    await call(w, workflow.recommend, {
      warehouseId: w.warehouseId,
      palletId: w.upperId,
    }),
  );
  expect(result["candidates"]).toHaveLength(0);
  expect(result["previewCandidates"]).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        previewSupports: expect.arrayContaining([
          expect.objectContaining({
            supportPalletId: w.palletId,
            surface: expect.objectContaining({ zMm: 1400, heightMm: 600 }),
          }),
        ]),
      }),
    ]),
  );
  error(await call(w, workflow.reserve, w.stack), "HEIGHT_EXCEEDED");
});
