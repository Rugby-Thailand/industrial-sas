import type { GenericMutationCtx } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as policies from "../../convex/hr/policies";
import * as leave from "../../convex/hr/leave";
import * as self from "../../convex/hr/self";
import type { Id } from "../../convex/_generated/dataModel";
import type { DataModel } from "../../convex/schema";
import {
  type ACCOUNT_TYPES,
  accountPeriod,
  thailandDefaults,
} from "../../convex/model/hr/policy";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";
type Runtime = {
  _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
};
type Outcome = {
  ok: boolean;
  value?: Record<string, unknown> & {
    written?: boolean;
    error?: { code: string };
  };
};
const ADMIN = { subject: "user_fixture_a", org_id: "org_fixture_a" };
const EMPLOYEE = { subject: "user_leave_employee", org_id: "org_fixture_a" };
const OTHER = { subject: "user_fixture_a", org_id: "org_fixture_b" };
let sequence = 0;
const rid = () => `leave-policy-test-${++sequence}`;
async function call(
  world: ConvexTenantWorld,
  fn: unknown,
  args: unknown,
  identity = ADMIN,
) {
  return (await world.t
    .withIdentity(identity)
    .run((ctx) =>
      (fn as Runtime)._handler(ctx as GenericMutationCtx<DataModel>, args),
    )) as Outcome;
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
const today = "2026-10-12";
async function fixture() {
  const world = await createConvexTenantWorld();
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
  return await call(world, policies.saveDraft, {
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
  return await call(world, policies.reconcileOpening, {
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
    await call(world, policies.activate, {
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
) => result(await call(world, leave.preview, args, identity));
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
    leave.submit,
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
describe("policy gate, legal floors and real opening migration", () => {
  it("prefills a draft without inventing employee accounts and keeps employee writes gated", async () => {
    const { world } = await fixture();
    expect(
      result(await call(world, policies.current, { capability: "LEAVE" })),
    ).toMatchObject({
      ok: true,
      draft: { version: 0, config: { annualDays: 6, maternityDays: 120 } },
      active: null,
    });
    expect(await account(world)).toBeNull();
    refused(await submit(world), "POLICY_NOT_ACTIVE");
  });
  it("rejects below-minimum drafts and requires real opening balances before activation", async () => {
    const { world } = await fixture();
    refused(
      await save(world, 0, { ...thailandDefaults(), annualDays: 5 }),
      "POLICY_INVALID",
    );
    written(await save(world));
    refused(
      await call(world, policies.activate, {
        requestId: rid(),
        capability: "LEAVE",
        expectedVersion: 1,
        coverageConfirmed: true,
        existingBenefitsReviewed: true,
      }),
      "POLICY_NOT_READY",
    );
  });
  it("activates an immutable policy exactly once and rejects reducing a higher benefit", async () => {
    const { world, employeeId } = await fixture();
    written(await save(world, 0, { ...thailandDefaults(), annualDays: 10 }));
    for (const [type, grant] of [
      ["ANNUAL", 10],
      ["SICK", 30],
      ["PERSONAL", 3],
      ["MILITARY", 60],
    ] as const)
      written(await opening(world, employeeId, type, grant));
    const args = {
      requestId: rid(),
      capability: "LEAVE",
      expectedVersion: 1,
      coverageConfirmed: true,
      existingBenefitsReviewed: true,
    };
    written(await call(world, policies.activate, args));
    expect(written(await call(world, policies.activate, args))).toMatchObject({
      replayed: true,
    });
    refused(await save(world, 1), "POLICY_INVALID");
    expect(
      await world.t.run((ctx) => ctx.db.query("hrPolicyVersions").collect()),
    ).toHaveLength(1);
  });
  it("cannot edit another organization's employee or expose policies to an employee", async () => {
    const { world, employeeId } = await fixture();
    const out = await call(
      world,
      policies.reconcileOpening,
      {
        requestId: rid(),
        employeeId,
        type: "ANNUAL",
        asOf: today,
        granted: 6,
        used: 0,
        reserved: 0,
        paidUsed: 0,
        paidReserved: 0,
        sourceReference: "Foreign fake source",
        expectedVersion: 0,
      },
      OTHER,
    );
    refused(out, "NOT_FOUND");
    expect(
      (await call(world, policies.current, { capability: "LEAVE" }, EMPLOYEE))
        .ok,
    ).toBe(false);
  });
  it("leaves unsupported payslip capability blocked independently from attendance", async () => {
    const { world } = await fixture();
    const args = {
      requestId: rid(),
      capability: "PAYSLIPS",
      expectedVersion: 0,
      effectiveDate: today,
      config: thailandDefaults(),
    };
    written(await call(world, policies.saveDraft, args));
    refused(
      await call(world, policies.activate, {
        requestId: rid(),
        capability: "PAYSLIPS",
        expectedVersion: 1,
        coverageConfirmed: true,
        existingBenefitsReviewed: true,
      }),
      "POLICY_NOT_READY",
    );
    expect(result(await call(world, self.today, {}, EMPLOYEE))).toHaveProperty(
      "nextAction",
    );
  });
});
describe("atomic leave reservation, evidence and decisions", () => {
  it("reserves once across retries and releases a withdrawn request exactly once", async () => {
    const { world, employeeId } = await fixture();
    await activate(world, employeeId);
    const args = {
      requestId: rid(),
      type: "ANNUAL",
      from: "2026-10-13",
      to: "2026-10-14",
      reason: "Annual family leave",
    };
    Object.assign(args, {
      expectedPreviewHash: (
        await preview(world, {
          type: args.type,
          from: args.from,
          to: args.to,
          reason: args.reason,
        })
      ).previewHash,
    });
    const first = written(await call(world, leave.submit, args, EMPLOYEE));
    written(await call(world, leave.submit, args, EMPLOYEE));
    expect(await account(world)).toMatchObject({ reserved: 2, used: 0 });
    const cancelArgs = {
      requestId: rid(),
      leaveRequestId: first.documentId,
      expectedVersion: 1,
    };
    written(await call(world, leave.cancel, cancelArgs, EMPLOYEE));
    written(await call(world, leave.cancel, cancelArgs, EMPLOYEE));
    expect(await account(world)).toMatchObject({ reserved: 0, used: 0 });
  });
  it("approves into captured attendance, consumes once and confirms cancellation before restoring", async () => {
    const { world, employeeId } = await fixture();
    await activate(world, employeeId);
    const created = written(await submit(world));
    written(
      await call(world, leave.decide, {
        requestId: rid(),
        leaveRequestId: created.documentId,
        expectedVersion: 1,
        decision: "APPROVE",
      }),
    );
    expect(await account(world)).toMatchObject({ used: 1, reserved: 0 });
    expect(
      await world.t.run((ctx) => ctx.db.query("hrAttendanceDays").first()),
    ).toMatchObject({
      approvedLeaveRequestId: created.documentId,
      certification: { disposition: "LEAVE" },
    });
    written(
      await call(
        world,
        leave.cancel,
        {
          requestId: rid(),
          leaveRequestId: created.documentId,
          expectedVersion: 2,
        },
        EMPLOYEE,
      ),
    );
    expect(await account(world)).toMatchObject({ used: 1 });
    written(
      await call(world, leave.decide, {
        requestId: rid(),
        leaveRequestId: created.documentId,
        expectedVersion: 3,
        decision: "CONFIRM_CANCEL",
      }),
    );
    expect(await account(world)).toMatchObject({ used: 0, reserved: 0 });
  });
  it("accepts sickness beyond 30 working days while employer paid allowance remains exhausted", async () => {
    const { world, employeeId } = await fixture();
    await activate(world, employeeId);
    await world.t.run(async (ctx) => {
      const row = (await ctx.db
        .query("hrLeaveAccounts")
        .filter((q) => q.eq(q.field("type"), "SICK"))
        .first())!;
      await ctx.db.patch("hrLeaveAccounts", row._id, {
        used: 30,
        paidUsed: 30,
      });
    });
    const created = written(await submit(world, "SICK"));
    expect(created).toMatchObject({ paidDays: 0 });
    written(
      await call(world, leave.decide, {
        requestId: rid(),
        leaveRequestId: created.documentId,
        expectedVersion: 1,
        decision: "APPROVE",
      }),
    );
    expect(await account(world, "SICK")).toMatchObject({
      used: 31,
      paidUsed: 30,
    });
  });
  it("counts maternity holidays, enforces event limits and keeps newborn care conditional", async () => {
    const { world, employeeId } = await fixture();
    await activate(world, employeeId);
    const maternity = written(
      await submit(world, "MATERNITY", "2026-10-13", "2026-10-19", {
        eventDate: "2026-10-13",
      }),
    );
    expect(maternity.days).toBe(7);
    refused(
      await submit(world, "MATERNITY", "2026-10-20", "2027-03-01", {
        eventDate: "2026-10-13",
      }),
      "LEAVE_EVENT_LIMIT",
    );
    refused(
      await submit(world, "NEWBORN_CARE", "2026-10-20", "2026-10-20", {
        eventDate: "2026-10-13",
        evidence: "Medical report for qualifying condition",
      }),
      "NEWBORN_CARE_AFTER_MATERNITY_REQUIRED",
    );
  });
  it("rejects out-of-window spouse leave and self review without altering reservations", async () => {
    const { world, employeeId } = await fixture();
    await activate(world, employeeId);
    refused(
      await submit(world, "SPOUSE", "2026-10-13", "2026-10-13", {
        eventDate: "2026-01-01",
      }),
      "SPOUSE_BIRTH_WINDOW_INVALID",
    );
    const created = written(await submit(world));
    await world.t.run((ctx) =>
      ctx.db.patch("hrEmployees", employeeId, { userId: world.userA }),
    );
    refused(
      await call(world, leave.decide, {
        requestId: rid(),
        leaveRequestId: created.documentId,
        expectedVersion: 1,
        decision: "APPROVE",
      }),
      "SELF_REVIEW",
    );
    expect(await account(world)).toMatchObject({ used: 0, reserved: 1 });
  });
  it("refuses approval after a conflicting clock event without partially certifying other dates", async () => {
    const { world, employeeId } = await fixture();
    await activate(world, employeeId);
    const created = written(
      await submit(world, "ANNUAL", "2026-10-13", "2026-10-14"),
    );
    await world.t.run((ctx) =>
      ctx.db.insert("hrAttendanceDays", {
        orgId: world.orgA,
        employeeId,
        warehouseId: world.warehouses.alphaA,
        businessDate: "2026-10-14",
        plan: {
          kind: "SCHEDULED",
          startAt: Date.now(),
          endAt: Date.now() + 1000,
          breakMinutes: 0,
        },
        clockInAt: Date.now(),
        open: true,
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    refused(
      await call(world, leave.decide, {
        requestId: rid(),
        leaveRequestId: created.documentId,
        expectedVersion: 1,
        decision: "APPROVE",
      }),
      "LEAVE_ATTENDANCE_CONFLICT",
    );
    const rows = await world.t.run((ctx) =>
      ctx.db.query("hrAttendanceDays").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(await account(world)).toMatchObject({ used: 0, reserved: 2 });
  });
  it("restores only specified started days through an audited HR adjustment", async () => {
    const { world, employeeId } = await fixture();
    await activate(world, employeeId);
    const created = written(
      await submit(world, "ANNUAL", "2026-10-13", "2026-10-14"),
    );
    written(
      await call(world, leave.decide, {
        requestId: rid(),
        leaveRequestId: created.documentId,
        expectedVersion: 1,
        decision: "APPROVE",
      }),
    );
    vi.setSystemTime(new Date("2026-10-14T03:00:00Z"));
    refused(
      await call(
        world,
        leave.cancel,
        {
          requestId: rid(),
          leaveRequestId: created.documentId,
          expectedVersion: 2,
        },
        EMPLOYEE,
      ),
      "LEAVE_STARTED_HR_ADJUSTMENT_REQUIRED",
    );
    written(
      await call(world, leave.adjust, {
        requestId: rid(),
        leaveRequestId: created.documentId,
        expectedVersion: 2,
        restoreDates: ["2026-10-14"],
        reason: "Employee returned to work; HR verified",
      }),
    );
    expect(await account(world)).toMatchObject({ used: 1, paidUsed: 1 });
  });
  it("preserves annual unused days across a new year without replay creating another grant", async () => {
    const { world, employeeId } = await fixture();
    await activate(world, employeeId);
    await world.t.run(async (ctx) => {
      const row = (await ctx.db
        .query("hrLeaveAccounts")
        .filter((q) => q.eq(q.field("type"), "ANNUAL"))
        .first())!;
      await ctx.db.patch("hrLeaveAccounts", row._id, { used: 2, paidUsed: 2 });
    });
    vi.setSystemTime(new Date("2027-01-01T03:00:00Z"));
    const args = { requestId: rid() };
    written(await call(world, leave.renewEntitlements, args, EMPLOYEE));
    written(await call(world, leave.renewEntitlements, args, EMPLOYEE));
    const period = accountPeriod("ANNUAL", "2020-01-01", "2027-01-01");
    const rows = await world.t.run((ctx) =>
      ctx.db.query("hrLeaveAccounts").collect(),
    );
    expect(
      rows.filter(
        (row) => row.type === "ANNUAL" && row.periodStart === period.start,
      ),
    ).toMatchObject([{ granted: 10, used: 0, baseGrant: 6 }]);
    expect(rows.filter((row) => row.type === "ANNUAL")).toHaveLength(2);
  });
  it("pins the old request policy and day plan while a future benefit increase adds only a positive grant", async () => {
    const { world, employeeId } = await fixture();
    await activate(world, employeeId);
    const created = written(
      await submit(world, "ANNUAL", "2026-10-13", "2026-10-14"),
    );
    written(
      await call(world, policies.saveDraft, {
        requestId: rid(),
        capability: "LEAVE",
        expectedVersion: 1,
        effectiveDate: "2026-10-13",
        config: { ...thailandDefaults(), annualDays: 10 },
      }),
    );
    written(
      await call(world, policies.activate, {
        requestId: rid(),
        capability: "LEAVE",
        expectedVersion: 2,
        coverageConfirmed: true,
        existingBenefitsReviewed: true,
      }),
    );
    vi.setSystemTime(new Date("2026-10-13T03:00:00Z"));
    expect(result(await call(world, leave.self, {}, EMPLOYEE))).toMatchObject({
      gate: "OPENING_BALANCE_REQUIRED",
    });
    const args = { requestId: rid() };
    written(await call(world, leave.renewEntitlements, args, EMPLOYEE));
    written(await call(world, leave.renewEntitlements, args, EMPLOYEE));
    await world.t.run((ctx) =>
      ctx.db.patch("hrEmployees", employeeId, {
        schedule: {
          workDays: [1, 2, 3, 4, 5],
          startTime: "10:30",
          endTime: "19:30",
          endsNextDay: false,
          breakMinutes: 60,
        },
      }),
    );
    const decision = {
      requestId: rid(),
      leaveRequestId: created.documentId,
      expectedVersion: 1,
      decision: "APPROVE",
    };
    written(await call(world, leave.decide, decision));
    written(await call(world, leave.decide, decision));
    expect(await account(world)).toMatchObject({
      granted: 10,
      baseGrant: 10,
      used: 2,
      reserved: 0,
    });
    const stored = await world.t.run((ctx) =>
      ctx.db.query("hrLeaveRequests").first(),
    );
    expect(stored?.policyConfig.annualDays).toBe(6);
    const days = await world.t.run((ctx) =>
      ctx.db.query("hrAttendanceDays").collect(),
    );
    expect(days.every((day) => day.plan.startTime === "08:30")).toBe(true);
    expect(
      await world.t.run((ctx) => ctx.db.query("hrNotifications").collect()),
    ).toHaveLength(1);
  });
  it("refuses a closed-period request before reservation and allows HR adjustment only after revision reopens", async () => {
    const { world, employeeId } = await fixture();
    await activate(world, employeeId);
    const created = written(await submit(world));
    written(
      await call(world, leave.decide, {
        requestId: rid(),
        leaveRequestId: created.documentId,
        expectedVersion: 1,
        decision: "APPROVE",
      }),
    );
    const periodId = await world.t.run((ctx) =>
      ctx.db.insert("hrPeriods", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        startDate: "2026-10-01",
        endDate: "2026-10-31",
        status: "CLOSED",
        draftVersion: 1,
        latestClosedVersion: 1,
        createdAt: 1,
        createdByUserId: world.userA,
        updatedAt: 1,
        updatedByUserId: world.userA,
      }),
    );
    refused(await submit(world, "PERSONAL", "2026-10-15"), "HR_PERIOD_CLOSED");
    const adjustment = {
      requestId: rid(),
      leaveRequestId: created.documentId,
      expectedVersion: 2,
      restoreDates: ["2026-10-13"],
      reason: "HR verified actual return; reopened revision",
    };
    refused(await call(world, leave.adjust, adjustment), "HR_PERIOD_CLOSED");
    expect(await account(world)).toMatchObject({ used: 1 });
    await world.t.run((ctx) =>
      ctx.db.patch("hrPeriods", periodId, {
        status: "DRAFT",
        draftVersion: 2,
        revisionReason: "Reviewed leave correction",
      }),
    );
    written(await call(world, leave.adjust, adjustment));
    expect(await account(world)).toMatchObject({ used: 0 });
  });
  it("releases the exact day claim on withdrawal so a corrected request can use the same date", async () => {
    const { world, employeeId } = await fixture();
    await activate(world, employeeId);
    const first = written(await submit(world));
    refused(await submit(world, "PERSONAL"), "LEAVE_OVERLAP");
    written(
      await call(
        world,
        leave.cancel,
        {
          requestId: rid(),
          leaveRequestId: first.documentId,
          expectedVersion: 1,
        },
        EMPLOYEE,
      ),
    );
    written(await submit(world, "PERSONAL"));
    expect(
      await world.t.run((ctx) => ctx.db.query("hrLeaveDayClaims").collect()),
    ).toHaveLength(1);
  });
  it("makes a previous-year audited restoration available in the current annual account", async () => {
    const { world, employeeId } = await fixture();
    await activate(world, employeeId);
    const created = written(
      await submit(world, "ANNUAL", "2026-12-30", "2026-12-31"),
    );
    written(
      await call(world, leave.decide, {
        requestId: rid(),
        leaveRequestId: created.documentId,
        expectedVersion: 1,
        decision: "APPROVE",
      }),
    );
    vi.setSystemTime(new Date("2027-01-01T03:00:00Z"));
    written(
      await call(
        world,
        leave.renewEntitlements,
        { requestId: rid() },
        EMPLOYEE,
      ),
    );
    written(
      await call(world, leave.adjust, {
        requestId: rid(),
        leaveRequestId: created.documentId,
        expectedVersion: 2,
        restoreDates: ["2026-12-31"],
        reason: "HR verified actual worked day",
      }),
    );
    const accounts = await world.t.run((ctx) =>
      ctx.db.query("hrLeaveAccounts").collect(),
    );
    expect(
      accounts.find(
        (row) => row.type === "ANNUAL" && row.periodStart === "2027-01-01",
      ),
    ).toMatchObject({ granted: 11, used: 0 });
    expect(
      accounts.find(
        (row) => row.type === "ANNUAL" && row.periodStart === "2026-01-01",
      ),
    ).toMatchObject({ granted: 1, used: 1 });
  });
});

describe("exact employee leave notification destinations", () => {
  it("opens an owned retained request outside the first page even after current policy is unavailable", async () => {
    const { world, employeeId } = await fixture();
    await activate(world, employeeId);
    const created = written(await submit(world));
    await world.t.run(async (ctx) => {
      const row = await ctx.db.get(created.documentId as Id<"hrLeaveRequests">);
      if (!row) throw new Error("Missing fixture request");
      const { _id: _requestId, _creationTime: _createdAt, ...fields } = row;
      for (let index = 1; index <= 55; index++)
        await ctx.db.insert("hrLeaveRequests", {
          ...fields,
          submittedAt: row.submittedAt + index,
          status: "WITHDRAWN",
        });
      for (const policy of await ctx.db.query("hrPolicyVersions").collect())
        await ctx.db.delete(policy._id);
    });
    expect(
      result(
        await call(
          world,
          leave.selfDetail,
          { leaveRequestId: created.documentId },
          EMPLOYEE,
        ),
      ),
    ).toMatchObject({
      ok: true,
      today,
      item: { _id: created.documentId, reason: "Real employee request" },
    });
  });
  it("does not expose a different employee or another organization's request", async () => {
    const { world, employeeId } = await fixture();
    await activate(world, employeeId);
    const created = written(await submit(world));
    const foreign = await world.t.run(async (ctx) => {
      const employee = await ctx.db.get(employeeId);
      const row = await ctx.db.get(created.documentId as Id<"hrLeaveRequests">);
      if (!employee || !row) throw new Error("Missing fixture");
      const { _id: _eid, _creationTime: _eat, ...employeeFields } = employee;
      const otherA = await ctx.db.insert("hrEmployees", {
        ...employeeFields,
        code: "OTHER-A",
        userId: world.userA,
      });
      const otherB = await ctx.db.insert("hrEmployees", {
        ...employeeFields,
        orgId: world.orgB,
        warehouseId: world.warehouses.alphaB,
        code: "OTHER-B",
        userId: world.userA,
      });
      const { _id: _rid, _creationTime: _rat, ...requestFields } = row;
      const otherRequest = await ctx.db.insert("hrLeaveRequests", {
        ...requestFields,
        employeeId: otherA,
      });
      return { otherRequest, otherB };
    });
    expect(
      result(
        await call(
          world,
          leave.selfDetail,
          { leaveRequestId: foreign.otherRequest },
          EMPLOYEE,
        ),
      ),
    ).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(
      result(
        await call(
          world,
          leave.selfDetail,
          { leaveRequestId: created.documentId },
          OTHER,
        ),
      ),
    ).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("server charge preview and retained returned resubmission", () => {
  const draft = (extra: Record<string, unknown> = {}) => ({
    type: "ANNUAL",
    from: "2026-10-13",
    to: "2026-10-18",
    reason: "Planned family absence",
    ...extra,
  });
  it("previews real holidays and schedules without financial writes, then persists exactly those charges", async () => {
    const { world, employeeId } = await fixture();
    await activate(world, employeeId);
    await world.t.run((ctx) =>
      ctx.db.insert("hrHolidays", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        date: "2026-10-14",
        name: "Real company holiday",
        createdAt: 1,
        createdByUserId: world.userA,
      }),
    );
    const before = await world.t.run(async (ctx) => ({
      ledger: await ctx.db.query("hrLeaveLedger").collect(),
      requests: await ctx.db.query("hrLeaveRequests").collect(),
      claims: await ctx.db.query("hrLeaveDayClaims").collect(),
    }));
    const fields = draft();
    const prepared = await preview(world, fields);
    expect(prepared).toMatchObject({
      ok: true,
      days: 3,
      paidDays: 3,
      payPercent: 100,
      dates: ["2026-10-13", "2026-10-15", "2026-10-16"],
      daySnapshots: expect.arrayContaining([
        expect.objectContaining({
          date: "2026-10-14",
          holidayName: "Real company holiday",
          scheduled: false,
        }),
      ]),
    });
    expect(
      await world.t.run(async (ctx) => ({
        ledger: await ctx.db.query("hrLeaveLedger").collect(),
        requests: await ctx.db.query("hrLeaveRequests").collect(),
        claims: await ctx.db.query("hrLeaveDayClaims").collect(),
      })),
    ).toEqual(before);
    const created = written(
      await call(
        world,
        leave.submit,
        {
          requestId: rid(),
          ...fields,
          expectedPreviewHash: prepared.previewHash,
        },
        EMPLOYEE,
      ),
    );
    const row = await world.t.run((ctx) =>
      ctx.db.get(created.documentId as Id<"hrLeaveRequests">),
    );
    expect(row).toMatchObject({
      dates: prepared.dates,
      days: prepared.days,
      paidDays: prepared.paidDays,
      payPercent: prepared.payPercent,
      policyVersionId: prepared.policyVersionId,
      policyConfig: prepared.policyConfig,
      daySnapshots: prepared.daySnapshots,
    });
    expect(await account(world)).toMatchObject({
      reserved: 3,
      paidReserved: 3,
      used: 0,
    });
  });
  it("refuses missing preview and changed arguments or account state before any reservation", async () => {
    const { world, employeeId } = await fixture();
    await activate(world, employeeId);
    const fields = draft({ to: "2026-10-13" });
    const prepared = await preview(world, fields);
    refused(
      await call(
        world,
        leave.submit,
        { requestId: rid(), ...fields, expectedPreviewHash: "" },
        EMPLOYEE,
      ),
      "LEAVE_PREVIEW_REQUIRED",
    );
    refused(
      await call(
        world,
        leave.submit,
        {
          requestId: rid(),
          ...fields,
          reason: "Different approved absence",
          expectedPreviewHash: prepared.previewHash,
        },
        EMPLOYEE,
      ),
      "LEAVE_PREVIEW_STALE",
    );
    written(await submit(world, "ANNUAL", "2026-10-20"));
    refused(
      await call(
        world,
        leave.submit,
        {
          requestId: rid(),
          ...fields,
          expectedPreviewHash: prepared.previewHash,
        },
        EMPLOYEE,
      ),
      "LEAVE_PREVIEW_STALE",
    );
    expect(await account(world)).toMatchObject({ reserved: 1 });
    expect(
      await world.t.run((ctx) => ctx.db.query("hrLeaveRequests").collect()),
    ).toHaveLength(1);
    expect(
      await world.t.run((ctx) => ctx.db.query("hrLeaveDayClaims").collect()),
    ).toHaveLength(1);
  });
  it("refuses a preview when a real policy activation or changed schedule alters its source", async () => {
    const { world, employeeId } = await fixture();
    await activate(world, employeeId);
    const fields = draft();
    const prepared = await preview(world, fields);
    written(
      await call(world, policies.saveDraft, {
        requestId: rid(),
        capability: "LEAVE",
        expectedVersion: 1,
        effectiveDate: "2026-10-13",
        config: { ...thailandDefaults(), firstYearAnnualDays: 1 },
      }),
    );
    written(
      await call(world, policies.activate, {
        requestId: rid(),
        capability: "LEAVE",
        expectedVersion: 2,
        coverageConfirmed: true,
        existingBenefitsReviewed: true,
      }),
    );
    refused(
      await call(
        world,
        leave.submit,
        {
          requestId: rid(),
          ...fields,
          expectedPreviewHash: prepared.previewHash,
        },
        EMPLOYEE,
      ),
      "LEAVE_PREVIEW_STALE",
    );
    const refreshed = await preview(world, fields);
    await world.t.run(async (ctx) => {
      const employee = await ctx.db.get(employeeId);
      if (!employee?.schedule) throw new Error("Missing fixture schedule");
      await ctx.db.patch(employeeId, {
        schedule: { ...employee.schedule, workDays: [1, 2, 3, 4] },
        version: 2,
      });
    });
    refused(
      await call(
        world,
        leave.submit,
        {
          requestId: rid(),
          ...fields,
          expectedPreviewHash: refreshed.previewHash,
        },
        EMPLOYEE,
      ),
      "LEAVE_PREVIEW_STALE",
    );
    expect(await account(world)).toMatchObject({ reserved: 0 });
    expect(
      await world.t.run((ctx) => ctx.db.query("hrLeaveRequests").collect()),
    ).toHaveLength(0);
  });
  it("retains the returned request ID, archives immutable charges, and re-reserves exactly once", async () => {
    const { world, employeeId } = await fixture();
    await activate(world, employeeId);
    const original = written(await submit(world));
    const returned = written(
      await call(world, leave.decide, {
        requestId: rid(),
        leaveRequestId: original.documentId,
        expectedVersion: 1,
        decision: "RETURN",
        reason: "Please correct the dates and type",
      }),
    );
    expect(returned).toMatchObject({ status: "RETURNED", version: 2 });
    expect(await account(world)).toMatchObject({ reserved: 0 });
    const fields = draft({
      type: "PERSONAL",
      from: "2026-10-15",
      to: "2026-10-16",
      reason: "Corrected required personal absence",
      leaveRequestId: original.documentId,
      expectedVersion: 2,
    });
    const prepared = await preview(world, fields);
    expect(prepared).toMatchObject({ ok: true, days: 2, paidDays: 2 });
    const command = {
      ...fields,
      requestId: rid(),
      expectedPreviewHash: prepared.previewHash,
    };
    const resent = written(
      await call(world, leave.resubmit, command, EMPLOYEE),
    );
    expect(resent).toMatchObject({
      documentId: original.documentId,
      version: 3,
      status: "PENDING",
    });
    expect(
      written(await call(world, leave.resubmit, command, EMPLOYEE)),
    ).toMatchObject({ documentId: original.documentId, replayed: true });
    refused(
      await call(
        world,
        leave.resubmit,
        { ...command, requestId: rid() },
        EMPLOYEE,
      ),
      "LEAVE_STALE",
    );
    expect(await account(world, "PERSONAL")).toMatchObject({
      reserved: 2,
      paidReserved: 2,
    });
    expect(await account(world)).toMatchObject({ reserved: 0 });
    const detail = result(
      await call(
        world,
        leave.selfDetail,
        { leaveRequestId: original.documentId },
        EMPLOYEE,
      ),
    );
    expect(detail).toMatchObject({
      ok: true,
      item: {
        _id: original.documentId,
        version: 3,
        type: "PERSONAL",
        history: [
          { action: "SUBMITTED" },
          { action: "RETURNED" },
          { action: "RESUBMITTED" },
        ],
      },
      revisions: [
        {
          version: 2,
          snapshot: {
            type: "ANNUAL",
            from: "2026-10-13",
            days: 1,
            status: "RETURNED",
            version: 2,
            history: [{ action: "SUBMITTED" }, { action: "RETURNED" }],
          },
        },
      ],
    });
    const before = await world.t.run((ctx) =>
      ctx.db.query("hrLeaveRequestRevisions").collect(),
    );
    written(
      await call(world, leave.decide, {
        requestId: rid(),
        leaveRequestId: original.documentId,
        expectedVersion: 3,
        decision: "APPROVE",
      }),
    );
    expect(
      await world.t.run((ctx) =>
        ctx.db.query("hrLeaveRequestRevisions").collect(),
      ),
    ).toEqual(before);
    expect(
      await world.t.run((ctx) => ctx.db.query("hrLeaveRequests").collect()),
    ).toHaveLength(1);
    const ledger = await world.t.run((ctx) =>
      ctx.db.query("hrLeaveLedger").collect(),
    );
    expect(
      ledger.filter(
        (entry) =>
          entry.leaveRequestId === original.documentId &&
          entry.kind === "RESERVE",
      ),
    ).toMatchObject([
      { leaveRequestVersion: 1, reservedDelta: 1 },
      { leaveRequestVersion: 3, reservedDelta: 2 },
    ]);
  });
  it("binds resubmit preview to the retained version and refuses unowned returned requests", async () => {
    const { world, employeeId } = await fixture();
    await activate(world, employeeId);
    const original = written(await submit(world));
    written(
      await call(world, leave.decide, {
        requestId: rid(),
        leaveRequestId: original.documentId,
        expectedVersion: 1,
        decision: "RETURN",
        reason: "Correct the requested dates",
      }),
    );
    const fields = draft({
      from: "2026-10-15",
      to: "2026-10-15",
      leaveRequestId: original.documentId,
      expectedVersion: 2,
    });
    const prepared = await preview(world, fields);
    written(await submit(world, "ANNUAL", "2026-10-20"));
    refused(
      await call(
        world,
        leave.resubmit,
        {
          ...fields,
          requestId: rid(),
          expectedPreviewHash: prepared.previewHash,
        },
        EMPLOYEE,
      ),
      "LEAVE_PREVIEW_STALE",
    );
    const foreignId = await world.t.run(async (ctx) => {
      const employee = await ctx.db.get(employeeId);
      const row = await ctx.db.get(
        original.documentId as Id<"hrLeaveRequests">,
      );
      if (!employee || !row) throw new Error("Missing fixture");
      const { _id: _eid, _creationTime: _eat, ...employeeFields } = employee;
      const other = await ctx.db.insert("hrEmployees", {
        ...employeeFields,
        code: "OTHER-RETURN",
        userId: world.userA,
      });
      const { _id: _rid, _creationTime: _rat, ...requestFields } = row;
      return await ctx.db.insert("hrLeaveRequests", {
        ...requestFields,
        employeeId: other,
      });
    });
    const foreignFields = { ...fields, leaveRequestId: foreignId };
    expect(await preview(world, foreignFields)).toMatchObject({
      ok: false,
      code: "NOT_FOUND",
    });
    refused(
      await call(
        world,
        leave.resubmit,
        { ...foreignFields, requestId: rid(), expectedPreviewHash: "" },
        EMPLOYEE,
      ),
      "NOT_FOUND",
    );
    expect(
      await world.t.run((ctx) =>
        ctx.db.query("hrLeaveRequestRevisions").collect(),
      ),
    ).toHaveLength(0);
    expect(await account(world)).toMatchObject({ reserved: 1 });
  });
});

describe("paged leave review queue", () => {
  it("reaches every reviewable request beyond the former 500 refusal", async () => {
    const { world, employeeId } = await fixture();
    await activate(world, employeeId);
    const created = written(await submit(world));
    const foreignEmployee = await world.t.run(async (ctx) => {
      const row = await ctx.db.get(created.documentId as Id<"hrLeaveRequests">);
      const employee = await ctx.db.get(employeeId);
      if (!row || !employee) throw new Error("Missing fixture request");
      const { _id: _rid, _creationTime: _rat, ...fields } = row;
      for (let index = 1; index <= 510; index++)
        await ctx.db.insert("hrLeaveRequests", {
          ...fields,
          submittedAt: row.submittedAt + index,
        });
      for (let index = 1; index <= 12; index++)
        await ctx.db.insert("hrLeaveRequests", {
          ...fields,
          submittedAt: row.submittedAt + 1000 + index,
          status: "CANCELLATION_REQUESTED",
        });
      // Decided requests are not part of the queue.
      await ctx.db.insert("hrLeaveRequests", { ...fields, status: "APPROVED" });
      const { _id: _eid, _creationTime: _eat, ...employeeFields } = employee;
      // The reviewer's own request is never reviewable by them.
      const own = await ctx.db.insert("hrEmployees", {
        ...employeeFields,
        code: "SELF",
        userId: world.userA,
      });
      await ctx.db.insert("hrLeaveRequests", { ...fields, employeeId: own });
      return own;
    });
    // The former queue fails outright beyond its bounded complete read.
    await expect(call(world, leave.queue, {})).rejects.toThrow(
      /CAPACITY_DATA_LIMIT/,
    );

    const seen: any[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 100; guard += 1) {
      let scanCursor: string | undefined;
      let page: any;
      do {
        page = result(
          await call(world, leave.queuePage, {
            pageSize: 50,
            ...(cursor ? { cursor } : {}),
            ...(scanCursor ? { scanCursor } : {}),
          }),
        );
        scanCursor = page.scanCursor;
      } while (page.status === "scanning");
      expect(page.status).toBe("ready");
      expect(page.page.length).toBeLessThanOrEqual(50);
      seen.push(...page.page);
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    expect(seen).toHaveLength(523);
    expect(new Set(seen.map((item) => item._id)).size).toBe(523);
    expect(seen.every((item) => item.employeeId === employeeId)).toBe(true);
    expect(seen.some((item) => item.employeeId === foreignEmployee)).toBe(
      false,
    );
    // Pending first, then cancellation requests, newest first in each.
    const statuses = seen.map((item) => item.status);
    expect(statuses.indexOf("CANCELLATION_REQUESTED")).toBe(511);
    expect(seen[0].submittedAt).toBeGreaterThan(seen[510].submittedAt);
    expect(seen[0]).toMatchObject({
      employeeName: "Employee 1",
      employeeCode: "EMP1",
    });
    expect(
      result(await call(world, leave.queuePage, { pageSize: 100 })),
    ).toEqual({ ok: false, code: "PAGE_SIZE_INVALID" });
  });

  it("reaches a request at a warehouse grant beyond the first 50 and drops it on revocation", async () => {
    const { world, employeeId } = await fixture();
    await activate(world, employeeId);
    const created = written(await submit(world));
    // The reviewer is warehouse-scoped with 55 grants; the employee's site
    // is one of them, wherever it sorts. The former queue refused outright.
    const late = await world.t.run(async (ctx) => {
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_orgId_userId", (q) =>
          q.eq("orgId", world.orgA).eq("userId", world.userA),
        )
        .unique();
      await ctx.db.patch("memberships", membership!._id, {
        scopeMode: "WAREHOUSE_SCOPED",
      });
      const sites = [];
      for (let index = 0; index < 55; index += 1) {
        const site = await ctx.db.insert("warehouses", {
          orgId: world.orgA,
          code: `G-${String(index).padStart(2, "0")}`,
          name: `Granted ${index}`,
          status: "ACTIVE",
        });
        sites.push(site);
        await ctx.db.insert("membershipWarehouses", {
          orgId: world.orgA,
          membershipId: membership!._id,
          warehouseId: site,
        });
      }
      const [first] = await ctx.db
        .query("membershipWarehouses")
        .withIndex("by_orgId_membershipId_warehouseId", (q) =>
          q.eq("orgId", world.orgA).eq("membershipId", membership!._id),
        )
        .collect()
        .then((rows) => rows.slice(-1));
      await ctx.db.patch("hrEmployees", employeeId, {
        warehouseId: first!.warehouseId,
      });
      await ctx.db.patch(
        "hrLeaveRequests",
        created.documentId as Id<"hrLeaveRequests">,
        { warehouseId: first!.warehouseId },
      );
      return { grant: first!._id, sites };
    });
    expect(late.sites).toHaveLength(55);
    const read = async () => {
      let scanCursor: string | undefined;
      let page: any;
      do {
        page = result(
          await call(world, leave.queuePage, {
            ...(scanCursor ? { scanCursor } : {}),
          }),
        );
        scanCursor = page.scanCursor;
      } while (page.status === "scanning");
      return page;
    };
    expect((await read()).page.map((row: any) => row._id)).toEqual([
      created.documentId,
    ]);
    expect(
      result(
        await call(world, leave.detail, {
          leaveRequestId: created.documentId,
        }),
      ),
    ).toMatchObject({ ok: true });

    await world.t.run((ctx) => ctx.db.delete(late.grant));
    expect((await read()).page).toEqual([]);
    expect(
      result(
        await call(world, leave.detail, {
          leaveRequestId: created.documentId,
        }),
      ),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
  });
});
