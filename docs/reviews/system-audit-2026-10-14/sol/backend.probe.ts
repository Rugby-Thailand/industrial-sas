import type { GenericMutationCtx } from "convex/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DataModel } from "../../../../convex/schema";
import * as hrReview from "../../../../convex/hr/review";
import * as hrSetup from "../../../../convex/hr/setup";
import * as workflow from "../../../../convex/finishedGoods/workflow";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "@tests/fixtures/convex-tenant-world";

interface RuntimeFunction {
  _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
}
type Outcome = {
  ok: boolean;
  value: {
    written?: boolean;
    documentId: string;
    error?: { code: string };
    [field: string]: unknown;
  };
};
async function call(world: ConvexTenantWorld, fn: unknown, args: unknown) {
  return (await world.t
    .withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_a" })
    .run((ctx) =>
      (fn as RuntimeFunction)._handler(
        ctx as GenericMutationCtx<DataModel>,
        args,
      ),
    )) as Outcome;
}
function written(result: Outcome) {
  expect(result).toMatchObject({ ok: true, value: { written: true } });
  return result.value;
}
const at = (time: string) => Date.parse(`2026-10-13T${time}+07:00`);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse("2026-10-14T10:00:00+07:00"));
});
afterEach(() => vi.useRealTimers());

it("SOL-02 demonstrates an unchanged re-review adds one attendance minute", async () => {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, { roleA: "HR_ADMIN" });
  const employeeId = written(
    await call(world, hrSetup.saveEmployee, {
      requestId: "sol-hr-employee",
      warehouseId: world.warehouses.alphaA,
      code: "EMP-SOL",
      displayName: "Audit employee",
      employmentStartDate: "2026-01-01",
      status: "ACTIVE",
      schedule: {
        workDays: [1, 2, 3, 4, 5],
        startTime: "08:30",
        endTime: "17:30",
        endsNextDay: false,
        breakMinutes: 60,
      },
    }),
  ).documentId;
  await world.t.run((ctx) =>
    ctx.db.insert("hrAttendanceDays", {
      orgId: world.orgA,
      employeeId: employeeId as never,
      warehouseId: world.warehouses.alphaA,
      businessDate: "2026-10-13",
      plan: {
        kind: "SCHEDULED",
        startAt: at("08:30:00"),
        endAt: at("17:30:00"),
        startTime: "08:30",
        endTime: "17:30",
        endsNextDay: false,
        breakMinutes: 60,
      },
      clockInAt: at("08:30:50"),
      revision: 1,
      open: true,
      createdAt: at("08:30:50"),
      updatedAt: at("08:30:50"),
    }),
  );
  written(
    await call(world, hrReview.disposeDay, {
      requestId: "sol-hr-certify",
      employeeId,
      businessDate: "2026-10-13",
      expectedRevision: 1,
      disposition: "WORKED",
      end: { minute: 1050, nextDay: false },
      reason: "Paper register supplies missing checkout",
    }),
  );
  const query = { employeeId, businessDate: "2026-10-13" };
  const before = await call(world, hrReview.dayDetail, query);
  expect(before.value.detail).toMatchObject({
    workedMinutes: 479,
    effectiveStartAt: at("08:30:50"),
    effectiveEndAt: at("17:30:00"),
  });
  // Exact minute payload emitted by DispositionForm for untouched visible fields.
  written(
    await call(world, hrReview.disposeDay, {
      requestId: "sol-hr-recertify",
      ...query,
      expectedRevision: 2,
      disposition: "WORKED",
      start: { minute: 510, nextDay: false },
      end: { minute: 1050, nextDay: false },
      reason: "Confirm same times with additional rationale",
    }),
  );
  const after = await call(world, hrReview.dayDetail, query);
  expect(after.value.detail).toMatchObject({
    workedMinutes: 480,
    effectiveStartAt: at("08:30:00"),
    effectiveEndAt: at("17:30:00"),
  });
});

it("SOL-03 demonstrates the stale stacking payload silently restores the old limit", async () => {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, { roleA: "ORG_ADMIN" });
  const warehouseId = world.warehouses.alphaA;
  const productId = written(
    await call(world, workflow.saveProduct, {
      warehouseId,
      requestId: "sol-product",
      sku: "SOL-STK",
      name: "Stacking audit",
      unit: "PCS",
      storageFormat: "PALLET",
      storageCondition: "ANY",
      draft: false,
    }),
  ).documentId;
  const palletId = written(
    await call(world, workflow.createPallet, {
      warehouseId,
      productId,
      requestId: "sol-pallet",
    }),
  ).documentId;
  const base = { warehouseId, palletId, stackable: true };
  written(
    await call(world, workflow.saveStackingLimits, {
      ...base,
      requestId: "sol-limit-a",
      maxStackLevels: 2,
    }),
  );
  written(
    await call(world, workflow.saveStackingLimits, {
      ...base,
      requestId: "sol-limit-b",
      maxStackLevels: 5,
    }),
  );
  written(
    await call(world, workflow.saveStackingLimits, {
      ...base,
      requestId: "sol-limit-stale",
      maxStackLevels: 2,
    }),
  );
  const result = await call(world, workflow.getPallet, {
    warehouseId,
    palletId,
  });
  expect(result.value.pallet).toMatchObject({ maxStackLevels: 2 });
});
