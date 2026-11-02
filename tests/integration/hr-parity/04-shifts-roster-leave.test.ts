import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  type ACCOUNT_TYPES,
  thailandDefaults,
} from "../../../convex/model/hr/policy";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../../fixtures/convex-tenant-world";
type Outcome = {
  ok: boolean;
  value?: Record<string, unknown> & {
    written?: boolean;
    error?: { code: string };
  };
};
const ADMIN = { subject: "user_fixture_a", org_id: "org_fixture_a" };
const EMPLOYEE = { subject: "user_leave_employee", org_id: "org_fixture_a" };
let sequence = 0;
const rid = () => `leave-policy-test-${++sequence}`;
async function call(
  world: ConvexTenantWorld,
  name: string,
  args: object,
  identity = ADMIN,
) {
  const client = world.t.withIdentity(identity);
  return (await (name === "hr/leave:preview"
    ? client.query(makeFunctionReference<"query">(name), args as never)
    : client.mutation(
        makeFunctionReference<"mutation">(name),
        args as never,
      ))) as Outcome;
}
function result(outcome: Outcome) {
  expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
  return outcome.value!;
}
function written(outcome: Outcome) {
  const value = result(outcome);
  expect(value, JSON.stringify(value)).toMatchObject({ written: true });
  return value;
}
const today = "2026-10-12";
async function fixture() {
  const world = await createConvexTenantWorld({
    "../convex/hr/leave.ts": () => import("../../../convex/hr/leave"),
    "../convex/hr/policies.ts": () => import("../../../convex/hr/policies"),
    "../convex/hr/roster.ts": () => import("../../../convex/hr/roster"),
  });
  const auth = await seedConvexAuthorization(world, {
    roleA: "HR_ADMIN",
    roleB: "HR_ADMIN",
  });
  const seeded = await world.t.run(async (ctx) => {
    await ctx.db.patch("memberships", auth.identities.membershipA, {
      scopeMode: "ORG_WIDE",
    });
    const employeeUser = await ctx.db.insert("users", {
      clerkUserId: EMPLOYEE.subject,
      displayName: "Employee",
      status: "ACTIVE",
    });
    const membership = await ctx.db.insert("memberships", {
      orgId: world.orgA,
      userId: employeeUser,
      clerkMembershipId: "member_leave_employee",
      status: "ACTIVE",
      scopeMode: "ORG_WIDE",
      effectiveFrom: 0,
    });
    await ctx.db.insert("membershipRoles", {
      orgId: world.orgA,
      membershipId: membership,
      roleId: auth.rolesA.get("HR_EMPLOYEE")!,
      grantedAt: 0,
    });
    const employeeId = await ctx.db.insert("hrEmployees", {
      orgId: world.orgA,
      warehouseId: world.warehouses.alphaA,
      code: "EMP1",
      displayName: "Employee 1",
      userId: employeeUser,
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
      version: 1,
      createdAt: 1,
      createdByUserId: world.userA,
      updatedAt: 1,
      updatedByUserId: world.userA,
    });
    for (const date of [
      "2026-01-01",
      "2026-01-02",
      "2026-02-02",
      "2026-03-02",
      "2026-04-06",
      "2026-04-13",
      "2026-04-14",
      "2026-04-15",
      "2026-05-01",
      "2026-05-04",
      "2026-06-03",
      "2026-07-28",
      "2026-08-12",
    ]) {
      await ctx.db.insert("hrHolidays", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        date,
        name: "Company holiday",
        createdAt: 1,
        createdByUserId: world.userA,
      });
    }
    return { employeeId, employeeUser };
  });
  return { world, ...seeded };
}
async function save(
  world: ConvexTenantWorld,
  expectedVersion = 0,
  config = thailandDefaults(),
) {
  return await call(world, "hr/policies:saveDraft", {
    requestId: rid(),
    capability: "LEAVE",
    expectedVersion,
    effectiveDate: today,
    config,
  });
}
async function opening(
  world: ConvexTenantWorld,
  employeeId: Id<"hrEmployees">,
  type: (typeof ACCOUNT_TYPES)[number],
  granted: number,
  used = 0,
) {
  return await call(world, "hr/policies:reconcileOpening", {
    requestId: rid(),
    employeeId,
    type,
    asOf: today,
    granted,
    used,
    reserved: 0,
    paidUsed: used,
    paidReserved: 0,
    sourceReference: "Signed HR source register 2026",
    expectedVersion: 0,
  });
}
async function activate(
  world: ConvexTenantWorld,
  employeeId: Id<"hrEmployees">,
) {
  written(await save(world));
  for (const [type, grant] of [
    ["ANNUAL", 6],
    ["SICK", 30],
    ["PERSONAL", 3],
    ["MILITARY", 60],
  ] as const)
    written(await opening(world, employeeId, type, grant));
  return written(
    await call(world, "hr/policies:activate", {
      requestId: rid(),
      capability: "LEAVE",
      expectedVersion: 1,
      coverageConfirmed: true,
      existingBenefitsReviewed: true,
    }),
  );
}
const preview = async (
  world: ConvexTenantWorld,
  args: Record<string, unknown>,
  identity = EMPLOYEE,
) => result(await call(world, "hr/leave:preview", args, identity));
const submit = async (
  world: ConvexTenantWorld,
  type = "ANNUAL",
  from = "2026-10-13",
  to = from,
  extra: Record<string, unknown> = {},
) => {
  const fields = { type, from, to, reason: "Real employee request", ...extra };
  const prepared = await preview(world, fields);
  return await call(
    world,
    "hr/leave:submit",
    {
      requestId: rid(),
      ...fields,
      expectedPreviewHash: prepared.ok ? prepared.previewHash : "",
    },
    EMPLOYEE,
  );
};
const account = (world: ConvexTenantWorld, type = "ANNUAL") =>
  world.t.run((ctx) =>
    ctx.db
      .query("hrLeaveAccounts")
      .filter((q) => q.eq(q.field("type"), type))
      .first(),
  );
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-12T03:00:00Z"));
});
afterEach(() => vi.useRealTimers());

it("registered approval refuses a roster change after leave captured its plan without spending the reservation", async () => {
  const { world, employeeId } = await fixture();
  await activate(world, employeeId);
  const request = written(await submit(world));
  written(
    await call(world, "hr/roster:assignRoster", {
      requestId: rid(),
      warehouseId: world.warehouses.alphaA,
      action: { kind: "OFF" },
      cells: [{ employeeId, date: "2026-10-13", expectedRevision: 0 }],
    }),
  );
  const decision = result(
    await call(world, "hr/leave:decide", {
      requestId: rid(),
      leaveRequestId: request.documentId,
      expectedVersion: 1,
      decision: "APPROVE",
    }),
  );
  // Capture every invariant in a single failed run; the first bad result must
  // not hide the actual account/attendance consequences from the handoff.
  expect.soft(decision).toMatchObject({
    written: false,
    error: { code: "LEAVE_PLAN_STALE" },
  });
  expect.soft(await account(world)).toMatchObject({ used: 0, reserved: 1 });
  expect
    .soft(
      await world.t.run((ctx) => ctx.db.query("hrAttendanceDays").collect()),
    )
    .toEqual([]);
});
