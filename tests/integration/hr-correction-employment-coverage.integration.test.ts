import type { GenericMutationCtx } from "convex/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as employeeProfile from "../../convex/hr/employeeProfile";
import * as review from "../../convex/hr/review";
import * as self from "../../convex/hr/self";
import * as setup from "../../convex/hr/setup";
import type { DataModel } from "../../convex/schema";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  seedSecondActorForOrgA,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";

type Runtime = {
  _handler: (ctx: GenericMutationCtx<DataModel>, args: unknown) => Promise<any>;
};
const ADMIN = { subject: "user_fixture_a", org_id: "org_fixture_a" };
async function call(
  world: ConvexTenantWorld,
  fn: unknown,
  args: unknown,
  identity = ADMIN,
) {
  const result = await world.t
    .withIdentity(identity)
    .run((ctx) =>
      (fn as Runtime)._handler(ctx as GenericMutationCtx<DataModel>, args),
    );
  expect(result).toMatchObject({ ok: true });
  return result.value;
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T03:00:00Z"));
});
afterEach(() => vi.useRealTimers());

it("refuses certifying a pending correction after retroactive offboarding removes its business date", async () => {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, { roleA: "HR_ADMIN" });
  const employee = await seedSecondActorForOrgA(world, "HR_EMPLOYEE");
  const saved = await call(world, setup.saveEmployee, {
    requestId: "probe-employee-0001",
    warehouseId: world.warehouses.alphaA,
    code: "EMP-PROBE",
    displayName: "Probe worker",
    userId: employee.userId,
    supervisorUserId: world.userA,
    employmentStartDate: "2020-01-01",
    status: "ACTIVE",
    schedule: {
      workDays: [1, 2, 3, 4, 5],
      startTime: "08:30",
      endTime: "17:30",
      endsNextDay: false,
      breakMinutes: 60,
    },
  });
  expect(saved).toMatchObject({ written: true });
  const employeeId = saved.documentId;
  const pending = await call(
    world,
    self.submitCorrection,
    {
      requestId: "probe-correction-0001",
      businessDate: "2026-10-09",
      start: { minute: 510, nextDay: false },
      end: { minute: 1050, nextDay: false },
      reason: "Forgot to clock a completed shift",
    },
    { subject: employee.clerkUserId, org_id: ADMIN.org_id },
  );
  expect(pending).toMatchObject({ written: true });
  expect(
    await call(world, employeeProfile.recordEmploymentEvent, {
      requestId: "probe-offboard-0001",
      employeeId,
      expectedVersion: 1,
      kind: "OFFBOARD",
      effectiveDate: "2026-10-08",
      separationType: "RESIGNATION",
      reason: "Corrected final working date",
    }),
  ).toMatchObject({ written: true });
  // The other review mutation already refuses attendance outside employment.
  expect(
    await call(world, review.disposeDay, {
      requestId: "probe-disposition-0001",
      employeeId,
      businessDate: "2026-10-09",
      expectedRevision: 0,
      disposition: "ABSENT",
      reason: "Check employment guard",
    }),
  ).toMatchObject({ written: false, error: { code: "HR_OUTSIDE_EMPLOYMENT" } });
  // The still-open correction review can submit the original request version.
  const decision = await call(world, review.decideCorrection, {
    requestId: "probe-certify-0001",
    correctionId: pending.documentId,
    expectedVersion: 1,
    decision: "CERTIFY",
  });
  const days = await world.t.run((ctx) =>
    ctx.db.query("hrAttendanceDays").collect(),
  );
  expect.soft(Number(decision.written)).toBe(0);
  expect(decision).toMatchObject({
    written: false,
    error: { code: "HR_OUTSIDE_EMPLOYMENT" },
  });
  expect(
    days.filter(
      (day) =>
        day.businessDate === "2026-10-09" &&
        day.certification?.disposition === "WORKED",
    ).length,
  ).toBe(0);
});
