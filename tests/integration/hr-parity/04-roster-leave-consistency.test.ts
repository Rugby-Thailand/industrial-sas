/**
 * A pending leave request captures each date's work plan and claims its
 * working dates; approval records that captured plan and consumes the day.
 * Before this regression, a later roster OFF/SHIFT/Clear on a claimed date
 * was accepted and then silently overwritten by approval, and a later
 * separation/reinstatement gap was recorded and charged anyway. Adapted
 * from the original roster/leave consistency probe.
 */
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
const QUERIES = new Set(["hr/leave:preview", "hr/roster:roster"]);
let sequence = 0;
const rid = () => `roster-leave-test-${++sequence}`;
async function call(
  world: ConvexTenantWorld,
  name: string,
  args: object,
  identity = ADMIN,
) {
  const client = world.t.withIdentity(identity);
  return (await (QUERIES.has(name)
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
function refused(outcome: Outcome, code: string) {
  expect(result(outcome)).toMatchObject({ written: false, error: { code } });
}
const today = "2026-10-12"; // Monday
async function fixture() {
  const world = await createConvexTenantWorld({
    "../convex/hr/leave.ts": () => import("../../../convex/hr/leave"),
    "../convex/hr/policies.ts": () => import("../../../convex/hr/policies"),
    "../convex/hr/roster.ts": () => import("../../../convex/hr/roster"),
    "../convex/hr/setup.ts": () => import("../../../convex/hr/setup"),
    "../convex/hr/employeeProfile.ts": () =>
      import("../../../convex/hr/employeeProfile"),
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
    // Leave activation requires the site's statutory holiday calendar.
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
    ])
      await ctx.db.insert("hrHolidays", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        date,
        name: "Company holiday",
        createdAt: 1,
        createdByUserId: world.userA,
      });
    return { employeeId };
  });
  return { world, ...seeded };
}
async function activate(
  world: ConvexTenantWorld,
  employeeId: Id<"hrEmployees">,
) {
  written(
    await call(world, "hr/policies:saveDraft", {
      requestId: rid(),
      capability: "LEAVE",
      expectedVersion: 0,
      effectiveDate: today,
      config: thailandDefaults(),
    }),
  );
  for (const [type, granted] of [
    ["ANNUAL", 6],
    ["SICK", 30],
    ["PERSONAL", 3],
    ["MILITARY", 60],
  ] as const satisfies readonly [(typeof ACCOUNT_TYPES)[number], number][])
    written(
      await call(world, "hr/policies:reconcileOpening", {
        requestId: rid(),
        employeeId,
        type,
        asOf: today,
        granted,
        used: 0,
        reserved: 0,
        paidUsed: 0,
        paidReserved: 0,
        sourceReference: "Signed HR source register 2026",
        expectedVersion: 0,
      }),
    );
  written(
    await call(world, "hr/policies:activate", {
      requestId: rid(),
      capability: "LEAVE",
      expectedVersion: 1,
      coverageConfirmed: true,
      existingBenefitsReviewed: true,
    }),
  );
}
async function submit(
  world: ConvexTenantWorld,
  from = "2026-10-13",
  to = from,
  type = "ANNUAL",
) {
  const fields = { type, from, to, reason: "Real employee request" };
  const prepared = result(
    await call(world, "hr/leave:preview", fields, EMPLOYEE),
  );
  return written(
    await call(
      world,
      "hr/leave:submit",
      {
        requestId: rid(),
        ...fields,
        expectedPreviewHash: prepared.ok ? prepared.previewHash : "",
      },
      EMPLOYEE,
    ),
  );
}
const approve = (world: ConvexTenantWorld, leaveRequestId: unknown) =>
  call(world, "hr/leave:decide", {
    requestId: rid(),
    leaveRequestId,
    expectedVersion: 1,
    decision: "APPROVE",
  });
const assign = (
  world: ConvexTenantWorld,
  action: object,
  cells: readonly { employeeId: string; date: string; revision?: number }[],
) =>
  call(world, "hr/roster:assignRoster", {
    requestId: rid(),
    warehouseId: world.warehouses.alphaA,
    action,
    cells: cells.map(({ employeeId, date, revision }) => ({
      employeeId,
      date,
      expectedRevision: revision ?? 0,
    })),
  });
async function activeShift(world: ConvexTenantWorld) {
  const shift = written(
    await call(world, "hr/roster:saveShift", {
      requestId: rid(),
      warehouseId: world.warehouses.alphaA,
      code: "NIGHT",
      name: "Night",
      color: "violet",
      status: "ACTIVE",
      startTime: "20:00",
      endTime: "05:00",
      endsNextDay: true,
      breakMinutes: 60,
    }),
  );
  return {
    kind: "SHIFT",
    shiftId: shift.documentId,
    expectedShiftVersion: 1,
  };
}
const state = (world: ConvexTenantWorld) =>
  world.t.run(async (ctx) => ({
    account: await ctx.db
      .query("hrLeaveAccounts")
      .filter((q) => q.eq(q.field("type"), "ANNUAL"))
      .first(),
    days: await ctx.db.query("hrAttendanceDays").collect(),
    roster: await ctx.db.query("hrRosterAssignments").collect(),
    requests: await ctx.db.query("hrLeaveRequests").collect(),
  }));
async function cellOf(
  world: ConvexTenantWorld,
  employeeId: string,
  date: string,
) {
  const roster = result(
    await call(world, "hr/roster:roster", {
      warehouseId: world.warehouses.alphaA,
      month: date.slice(0, 7),
    }),
  ) as unknown as {
    employees: { id: string; cells: { date: string; lock: unknown }[] }[];
  };
  return roster.employees
    .find((row) => row.id === employeeId)!
    .cells.find((cell) => cell.date === date)!;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T03:00:00Z"));
});
afterEach(() => vi.useRealTimers());

it.each([["OFF"], ["SHIFT"], ["CLEAR"]] as const)(
  "roster %s on a date claimed by a pending leave request is refused for the whole batch and approval keeps the captured plan",
  async (kind) => {
    const { world, employeeId } = await fixture();
    await activate(world, employeeId);
    const request = await submit(world);
    const action =
      kind === "SHIFT" ? await activeShift(world) : ({ kind } satisfies object);
    expect(await cellOf(world, employeeId, "2026-10-13")).toMatchObject({
      lock: "LEAVE_CLAIMED",
    });
    // An unclaimed date in the same batch is not written either.
    refused(
      await assign(world, action, [
        { employeeId, date: "2026-10-14" },
        { employeeId, date: "2026-10-13" },
      ]),
      "ROSTER_DAY_LEAVE_CLAIMED",
    );
    expect((await state(world)).roster).toEqual([]);
    written(await approve(world, request.documentId));
    const after = await state(world);
    expect(after.account).toMatchObject({ used: 1, reserved: 0 });
    expect(after.days).toHaveLength(1);
    expect(after.days[0]).toMatchObject({
      businessDate: "2026-10-13",
      plan: { kind: "SCHEDULED", startTime: "08:30", endTime: "17:30" },
      certification: { disposition: "LEAVE" },
    });
    // Approved leave is recorded attendance: the roster stays refused.
    expect(await cellOf(world, employeeId, "2026-10-13")).toMatchObject({
      lock: "RECORDED",
    });
    refused(
      await assign(world, action, [{ employeeId, date: "2026-10-13" }]),
      "ROSTER_DAY_RECORDED",
    );
    // The neighbouring unclaimed date remained assignable throughout.
    written(await assign(world, action, [{ employeeId, date: "2026-10-14" }]));
  },
);

it("a withdrawn pending request releases its claim so the roster can change the date again", async () => {
  const { world, employeeId } = await fixture();
  await activate(world, employeeId);
  const request = await submit(world);
  written(
    await call(
      world,
      "hr/leave:cancel",
      {
        requestId: rid(),
        leaveRequestId: request.documentId,
        expectedVersion: 1,
      },
      EMPLOYEE,
    ),
  );
  expect(await cellOf(world, employeeId, "2026-10-13")).toMatchObject({
    lock: null,
  });
  written(
    await assign(world, { kind: "OFF" }, [{ employeeId, date: "2026-10-13" }]),
  );
  expect((await state(world)).account).toMatchObject({ used: 0, reserved: 0 });
});

it("approval refuses atomically when a later separation and reinstatement left one pending date outside employment", async () => {
  const { world, employeeId } = await fixture();
  await activate(world, employeeId);
  // Tuesday to Thursday, still pending while HR later records an exit after
  // Wednesday and a Friday return; lifecycle dates must be past when recorded.
  const request = await submit(world, "2026-10-13", "2026-10-15");
  expect((await state(world)).account).toMatchObject({ used: 0, reserved: 3 });
  vi.setSystemTime(new Date("2026-10-20T03:00:00Z"));
  written(
    await call(world, "hr/employeeProfile:recordEmploymentEvent", {
      requestId: rid(),
      employeeId,
      expectedVersion: 1,
      kind: "OFFBOARD",
      effectiveDate: "2026-10-14",
      separationType: "RESIGNATION",
      reason: "Resigned for family move",
    }),
  );
  written(
    await call(world, "hr/employeeProfile:recordEmploymentEvent", {
      requestId: rid(),
      employeeId,
      expectedVersion: 2,
      kind: "REINSTATE",
      effectiveDate: "2026-10-16",
      reason: "Returned after the move",
    }),
  );
  refused(await approve(world, request.documentId), "LEAVE_EMPLOYMENT_CHANGED");
  const after = await state(world);
  // The two still-employed dates are not recorded ahead of the refused one.
  expect(after.days).toEqual([]);
  expect(after.account).toMatchObject({ used: 0, reserved: 3 });
  expect(after.requests[0]).toMatchObject({ status: "PENDING", version: 1 });
});
