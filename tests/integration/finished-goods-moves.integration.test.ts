import type { Id } from "../../convex/_generated/dataModel";
import type { GenericMutationCtx } from "convex/server";
import { describe, expect, it } from "vitest";
import * as workflow from "../../convex/finishedGoods/workflow";
import type { DataModel } from "../../convex/schema";
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
async function preparedWorld() {
  const world = await storedWorld();
  const moveId = id(await call(world, workflow.reserveMove, world.prepare));
  const args = { ...world.base, moveId };
  return { ...world, moveId, args };
}
async function start(world: Awaited<ReturnType<typeof preparedWorld>>) {
  return call(world, workflow.startMove, {
    ...world.args,
    requestId: "pickup",
    code: "P-000001",
    method: "MANUAL",
    physicalConfirmed: true,
  });
}
async function placementState(
  world: Awaited<ReturnType<typeof preparedWorld>>,
) {
  return world.t.run(async (ctx) => ({
    source: await ctx.db.get(
      world.sourcePlacementId as Id<"finishedGoodsPlacements">,
    ),
    move: await ctx.db.get(world.moveId as Id<"finishedGoodsMoves">),
    pallet: await ctx.db.get(world.palletId as Id<"finishedGoodsPallets">),
  }));
}
describe("stored pallet moves", () => {
  it("acknowledges pickup and placement without codes, preserves quantity and records the method", async () => {
    const w = await preparedWorld();
    const ack = {
      ...w.args,
      confirmationMethod: "ACKNOWLEDGEMENT",
      physicalConfirmed: true,
    };
    error(
      await call(w, workflow.startMove, {
        ...ack,
        requestId: "unchecked-start",
        physicalConfirmed: false,
      }),
      "PHYSICAL_CONFIRMATION_REQUIRED",
    );
    id(await call(w, workflow.startMove, { ...ack, requestId: "ack-start" }));
    const moving = await placementState(w);
    expect(moving.source?.status).toBe("STORED");
    expect(moving.move?.pickupConfirmationMethod).toBe("ACKNOWLEDGEMENT");
    expect(moving.move?.verifiedAt).toBeUndefined();
    error(
      await call(w, workflow.completeMove, {
        ...ack,
        requestId: "unchecked-finish",
        physicalConfirmed: false,
      }),
      "PHYSICAL_CONFIRMATION_REQUIRED",
    );
    const finish = { ...ack, requestId: "ack-finish" };
    id(await call(w, workflow.completeMove, finish));
    id(await call(w, workflow.completeMove, finish));
    const after = await placementState(w);
    expect(after.source?.status).toBe("RELEASED");
    expect(after.move).toMatchObject({
      status: "COMPLETED",
      completionConfirmationMethod: "ACKNOWLEDGEMENT",
      updatedByUserId: moving.move?.ownerUserId,
    });
    expect(after.pallet).toMatchObject({
      quantity: 500,
      placementId: after.move?.targetPlacementId,
    });
    const target = await w.t.run((ctx) =>
      ctx.db.get(after.move!.targetPlacementId),
    );
    expect(target?.status).toBe("STORED");
    expect(target?.verificationMethod).toBeUndefined();
  });
  it("acknowledges return without a code and releases only the destination", async () => {
    const w = await preparedWorld();
    id(await start(w));
    const args = {
      ...w.args,
      requestId: "ack-return",
      confirmationMethod: "ACKNOWLEDGEMENT",
      physicalConfirmed: true,
    };
    id(await call(w, workflow.returnMove, args));
    id(await call(w, workflow.returnMove, args));
    const after = await placementState(w);
    expect(after.source?.status).toBe("STORED");
    expect(after.pallet?.placementId).toBe(w.sourcePlacementId);
    expect(after.move).toMatchObject({
      status: "RETURNED",
      completionConfirmationMethod: "ACKNOWLEDGEMENT",
    });
    expect(
      (await w.t.run((ctx) => ctx.db.get(after.move!.targetPlacementId)))
        ?.status,
    ).toBe("RELEASED");
  });
  it("still rejects a changed target for checkbox confirmation", async () => {
    const w = await preparedWorld();
    id(await start(w));
    const moving = await placementState(w);
    await w.t.run((ctx) =>
      ctx.db.patch(moving.move!.targetPlacementId, {
        updatedAt: moving.move!.targetUpdatedAt + 1,
      }),
    );
    error(
      await call(w, workflow.completeMove, {
        ...w.args,
        requestId: "stale-ack",
        confirmationMethod: "ACKNOWLEDGEMENT",
        physicalConfirmed: true,
      }),
      "MOVE_TARGET_CHANGED",
    );
    expect((await placementState(w)).source?.status).toBe("STORED");
  });

  it("atomically relocates overlapping self-footprints, preserves identity and history, and replays safely", async () => {
    const w = await preparedWorld();
    const before = await placementState(w);
    expect(before.source?.status).toBe("STORED");
    expect(before.move?.status).toBe("RESERVED");
    expect(id(await call(w, workflow.reserveMove, w.prepare))).toBe(w.moveId);
    const detail = value(await call(w, workflow.getPallet, w.base));
    expect(detail.activeMove).toMatchObject({
      status: "RESERVED",
      isOwner: true,
    });
    id(await start(w));
    expect((await placementState(w)).source?.status).toBe("STORED");
    expect(
      value(await call(w, workflow.list, { warehouseId: w.warehouseId }))
        .pallets,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ moveStatus: "IN_TRANSIT" }),
      ]),
    );
    error(
      await call(w, workflow.completeMove, {
        ...w.args,
        requestId: "unverified",
        physicalConfirmed: true,
      }),
      "DESTINATION_NOT_VERIFIED",
    );
    id(
      await call(w, workflow.verifyMoveDestination, {
        ...w.args,
        requestId: "verify",
        code: "BLDG-A-F01-Z01",
        method: "MANUAL",
      }),
    );
    error(
      await call(w, workflow.completeMove, {
        ...w.args,
        requestId: "no-ack",
        physicalConfirmed: false,
      }),
      "PHYSICAL_CONFIRMATION_REQUIRED",
    );
    const finish = { ...w.args, requestId: "finish", physicalConfirmed: true };
    id(await call(w, workflow.completeMove, finish));
    id(await call(w, workflow.completeMove, finish));
    const after = await placementState(w);
    expect(after.move?.status).toBe("COMPLETED");
    expect(after.source?.status).toBe("RELEASED");
    expect(after.pallet).toMatchObject({
      _id: before.pallet?._id,
      quantity: 500,
      productId: before.pallet?.productId,
      status: "STORED",
      placementId: after.move?.targetPlacementId,
    });
    expect(value(await call(w, workflow.getPallet, w.base))).toMatchObject({
      moveHistory: [expect.objectContaining({ status: "COMPLETED" })],
    });
    expect(
      (await w.t.run((ctx) => ctx.db.get(after.move!.targetPlacementId)))
        ?.status,
    ).toBe("STORED");
  });
  it("rejects unchanged destination, stale source, boundaries and a second active move", async () => {
    const w = await storedWorld();
    error(
      await call(w, workflow.reserveMove, {
        ...w.prepare,
        xMm: 0,
        yMm: 0,
        rotation: 0,
      }),
      "MOVE_UNCHANGED",
    );
    error(
      await call(w, workflow.reserveMove, { ...w.prepare, xMm: 5000 }),
      "OUTSIDE_LOCATION",
    );
    error(
      await call(w, workflow.reserveMove, {
        ...w.prepare,
        expectedMeasurementUpdatedAt: 1,
      }),
      "MEASUREMENT_CHANGED",
    );
    id(await call(w, workflow.reserveMove, w.prepare));
    error(
      await call(w, workflow.reserveMove, {
        ...w.prepare,
        requestId: "second",
        xMm: 300,
      }),
      "MOVE_ALREADY_ACTIVE",
    );
    error(
      await call(w, workflow.confirmStored, {
        ...w.base,
        requestId: "legacy-confirm",
      }),
      "MOVE_ALREADY_ACTIVE",
    );
  });
  it("requires the correct pallet, pickup acknowledgement and destination; wrong scans clear verification", async () => {
    const w = await preparedWorld();
    error(
      await call(w, workflow.startMove, {
        ...w.args,
        requestId: "wrong",
        code: "P-999",
        method: "MANUAL",
        physicalConfirmed: true,
      }),
      "PALLET_MISMATCH",
    );
    error(
      await call(w, workflow.startMove, {
        ...w.args,
        requestId: "ack",
        code: "P-000001",
        method: "MANUAL",
        physicalConfirmed: false,
      }),
      "PHYSICAL_CONFIRMATION_REQUIRED",
    );
    error(
      await call(w, workflow.verifyMoveDestination, {
        ...w.args,
        requestId: "early",
        code: "BLDG-A-F01-Z01",
        method: "MANUAL",
      }),
      "MOVE_PICKUP_REQUIRED",
    );
    id(await start(w));
    id(
      await call(w, workflow.verifyMoveDestination, {
        ...w.args,
        requestId: "verified",
        code: "BLDG-A-F01-Z01",
        method: "MANUAL",
      }),
    );
    error(
      await call(w, workflow.verifyMoveDestination, {
        ...w.args,
        requestId: "wrong-destination",
        code: "wrong",
        method: "SCAN",
      }),
      "DESTINATION_MISMATCH",
    );
    error(
      await call(w, workflow.completeMove, {
        ...w.args,
        requestId: "complete",
        physicalConfirmed: true,
      }),
      "DESTINATION_NOT_VERIFIED",
    );
    error(
      await call(w, workflow.cancelMove, { ...w.args, requestId: "cancel" }),
      "MOVE_RETURN_REQUIRED",
    );
    expect((await placementState(w)).source?.status).toBe("STORED");
  });
  it("cancels before pickup and releases only the target", async () => {
    const w = await preparedWorld();
    id(await call(w, workflow.cancelMove, { ...w.args, requestId: "cancel" }));
    const state = await placementState(w);
    expect(state.move?.status).toBe("CANCELLED");
    expect(state.source?.status).toBe("STORED");
    expect(state.pallet?.placementId).toBe(w.sourcePlacementId);
    expect(
      (await w.t.run((ctx) => ctx.db.get(state.move!.targetPlacementId)))
        ?.status,
    ).toBe("RELEASED");
  });
  it("persists issues without releasing holds and requires verified physical return", async () => {
    const w = await preparedWorld();
    id(await start(w));
    id(
      await call(w, workflow.reportMoveIssue, {
        ...w.args,
        requestId: "issue",
        issue: "Aisle blocked",
      }),
    );
    expect((await placementState(w)).move).toMatchObject({
      status: "IN_TRANSIT",
      issue: "Aisle blocked",
    });
    error(
      await call(w, workflow.returnMove, {
        ...w.args,
        requestId: "wrong-return",
        code: "wrong",
        method: "MANUAL",
        physicalConfirmed: true,
      }),
      "SOURCE_MISMATCH",
    );
    id(
      await call(w, workflow.returnMove, {
        ...w.args,
        requestId: "return",
        code: "BLDG-A-F01-Z01",
        method: "MANUAL",
        physicalConfirmed: true,
      }),
    );
    const state = await placementState(w);
    expect(state.move?.status).toBe("RETURNED");
    expect(state.source?.status).toBe("STORED");
    expect(state.pallet?.placementId).toBe(w.sourcePlacementId);
  });
  it.each([false, true])(
    "rejects another operator and readonly or cross-warehouse commands (checkbox=%s)",
    async (checkbox) => {
      const w = await preparedWorld();
      const actor = await seedSecondActorForOrgA(w, "ORG_ADMIN");
      const result = await w.t
        .withIdentity({ subject: actor.clerkUserId, org_id: "org_fixture_a" })
        .run((ctx) =>
          (workflow.startMove as unknown as RuntimeFunction)._handler(
            ctx as GenericMutationCtx<DataModel>,
            {
              ...w.args,
              requestId: "other",
              ...(checkbox
                ? { confirmationMethod: "ACKNOWLEDGEMENT" }
                : { code: "P-000001", method: "MANUAL" }),
              physicalConfirmed: true,
            },
          ),
        );
      error(
        result as Record<string, unknown>,
        "MOVE_OWNED_BY_ANOTHER_OPERATOR",
      );
      await expect(
        call(w, workflow.cancelMove, { ...w.args, requestId: "anon" }, false),
      ).rejects.toThrow("ANONYMOUS");
      await expect(
        call(w, workflow.cancelMove, {
          ...w.args,
          warehouseId: w.warehouses.alphaB,
          requestId: "foreign",
        }),
      ).rejects.toThrow();
    },
  );
  it("rejects stale source or target revisions without dropping either hold", async () => {
    const w = await preparedWorld();
    id(await start(w));
    await w.t.run(async (ctx) => {
      const state = await ctx.db.get(w.moveId as Id<"finishedGoodsMoves">);
      await ctx.db.patch(state!.targetPlacementId, {
        updatedAt: state!.targetUpdatedAt + 1,
      });
    });
    error(
      await call(w, workflow.verifyMoveDestination, {
        ...w.args,
        requestId: "stale-target",
        code: "BLDG-A-F01-Z01",
        method: "MANUAL",
      }),
      "MOVE_TARGET_CHANGED",
    );
    // Target corruption still permits a verified return to the held source.
    id(
      await call(w, workflow.returnMove, {
        ...w.args,
        requestId: "return",
        code: "BLDG-A-F01-Z01",
        method: "MANUAL",
        physicalConfirmed: true,
      }),
    );
    expect((await placementState(w)).source?.status).toBe("STORED");
  });
  it("keeps both source and target unavailable to other pallets", async () => {
    const w = await preparedWorld();
    const other = await measuredPallet(w, "other");
    error(
      await reserve(w, other.palletId, "occupy-source", 0, 0),
      "SPACE_OCCUPIED",
    );
    error(
      await reserve(w, other.palletId, "occupy-target", 200, 300),
      "SPACE_OCCUPIED",
    );
  });
  it("replaces destination atomically before pickup and keeps the old hold on invalid replacement", async () => {
    const w = await preparedWorld();
    const original = await placementState(w);
    error(
      await call(w, workflow.reserveMove, {
        ...w.prepare,
        moveId: w.moveId,
        requestId: "bad-replace",
        xMm: 9000,
      }),
      "OUTSIDE_LOCATION",
    );
    expect(
      (await w.t.run((ctx) => ctx.db.get(original.move!.targetPlacementId)))
        ?.status,
    ).toBe("RESERVED");
    expect(
      id(
        await call(w, workflow.reserveMove, {
          ...w.prepare,
          moveId: w.moveId,
          requestId: "replace",
          xMm: 300,
        }),
      ),
    ).toBe(w.moveId);
    const changed = await placementState(w);
    expect(changed.move?.targetPlacementId).not.toBe(
      original.move?.targetPlacementId,
    );
    expect(changed.source?.status).toBe("STORED");
    expect(
      (await w.t.run((ctx) => ctx.db.get(original.move!.targetPlacementId)))
        ?.status,
    ).toBe("RELEASED");
    id(await start(w));
    error(
      await call(w, workflow.reserveMove, {
        ...w.prepare,
        moveId: w.moveId,
        requestId: "late-replace",
        xMm: 400,
      }),
      "MOVE_RETURN_REQUIRED",
    );
  });
  it("returns to source even when a different target location has become unavailable", async () => {
    const w = await storedWorld();
    const zoneId = await w.t.run(async (ctx) => {
      const zone = await ctx.db.get(w.zoneId);
      const { _id: oldId, _creationTime: oldTime, ...fields } = zone!;
      void oldId;
      void oldTime;
      return ctx.db.insert("storageZones", {
        ...fields,
        code: "TARGET",
        label: "Target",
        xMm: 5000,
      });
    });
    const moveId = id(
      await call(w, workflow.reserveMove, { ...w.prepare, zoneId }),
    );
    const args = { ...w.base, moveId };
    id(
      await call(w, workflow.startMove, {
        ...args,
        requestId: "start",
        code: "P-000001",
        method: "MANUAL",
        physicalConfirmed: true,
      }),
    );
    await w.t.run((ctx) => ctx.db.patch(zoneId, { status: "INACTIVE" }));
    error(
      await call(w, workflow.verifyMoveDestination, {
        ...args,
        requestId: "verify",
        code: "TARGET",
        method: "MANUAL",
      }),
      "LOCATION_UNAVAILABLE",
    );
    id(
      await call(w, workflow.returnMove, {
        ...args,
        requestId: "return",
        code: "BLDG-A-F01-Z01",
        method: "MANUAL",
        physicalConfirmed: true,
      }),
    );
    expect(
      (
        await w.t.run((ctx) =>
          ctx.db.get(w.sourcePlacementId as Id<"finishedGoodsPlacements">),
        )
      )?.status,
    ).toBe("STORED");
  });
  it("rejects a source changed since preparation and still records the unresolved issue", async () => {
    const w = await preparedWorld();
    await w.t.run(async (ctx) => {
      const source = await ctx.db.get(
        w.sourcePlacementId as Id<"finishedGoodsPlacements">,
      );
      await ctx.db.patch(source!._id, { updatedAt: source!.updatedAt + 1 });
    });
    error(await start(w), "MOVE_SOURCE_CHANGED");
    id(
      await call(w, workflow.reportMoveIssue, {
        ...w.args,
        requestId: "report-stale",
        issue: "Source needs investigation",
      }),
    );
    expect((await placementState(w)).move).toMatchObject({
      status: "RESERVED",
      issue: "Source needs investigation",
    });
  });
  it("does not transfer ownership by replaying another operator's successful request", async () => {
    const w = await preparedWorld();
    const actor = await seedSecondActorForOrgA(w, "ORG_ADMIN");
    const result = await w.t
      .withIdentity({ subject: actor.clerkUserId, org_id: "org_fixture_a" })
      .run((ctx) =>
        (workflow.reserveMove as unknown as RuntimeFunction)._handler(
          ctx as GenericMutationCtx<DataModel>,
          w.prepare,
        ),
      );
    expect(value(result as Record<string, unknown>)).toMatchObject({
      written: false,
    });
    expect((await placementState(w)).move?.ownerUserId).toBe(w.userA);
  });
  it("allows a read-only operator to inspect movement but not mutate it", async () => {
    const w = await preparedWorld();
    const actor = await seedSecondActorForOrgA(w, "SUPERVISOR");
    const harness = w.t.withIdentity({
      subject: actor.clerkUserId,
      org_id: "org_fixture_a",
    });
    const detail = await harness.run((ctx) =>
      (workflow.getPallet as unknown as RuntimeFunction)._handler(
        ctx as GenericMutationCtx<DataModel>,
        w.base,
      ),
    );
    expect(value(detail as Record<string, unknown>)).toMatchObject({
      activeMove: { isOwner: false, status: "RESERVED" },
    });
    const result = await harness.run((ctx) =>
      (workflow.cancelMove as unknown as RuntimeFunction)._handler(
        ctx as GenericMutationCtx<DataModel>,
        { ...w.args, requestId: "readonly-cancel" },
      ),
    );
    expect(result).toMatchObject({ ok: false });
    expect((await placementState(w)).move?.status).toBe("RESERVED");
  });
});
