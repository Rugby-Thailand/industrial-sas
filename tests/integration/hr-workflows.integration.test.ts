import type { GenericMutationCtx } from "convex/server";
import type { GenericId } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as access from "../../convex/hr/access";
import * as periods from "../../convex/hr/periods";
import * as review from "../../convex/hr/review";
import * as self from "../../convex/hr/self";
import * as setup from "../../convex/hr/setup";
import * as provisioning from "../../convex/hr/provisioning";
import * as workspace from "../../convex/workspace/current";
import { HR_PERMISSION_CODES } from "../../convex/lib/permissions";
import { fromLocal } from "../../convex/model/hr/calendar";
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
type Outcome = {
  ok: boolean;
  value?: Record<string, unknown> & {
    written?: boolean;
    error?: { code: string };
  };
};

const EMPLOYEE = "user_fixture_a";
const SUPERVISOR = "user_hr_supervisor";
const OTHER_SUPERVISOR = "user_hr_other_supervisor";
const HR_ADMIN = "user_hr_admin";
const MANAGER = "user_warehouse_manager";

const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return fromLocal(date, h * 60 + m, 420);
};
const setNow = (date: string, hhmm: string) => vi.setSystemTime(at(date, hhmm));

let sequence = 0;
const rid = (label: string) => `${label}-${(sequence += 1)}-req`;

async function call(
  world: ConvexTenantWorld,
  fn: unknown,
  args: unknown,
  subject = EMPLOYEE,
  orgId = "org_fixture_a",
): Promise<Outcome> {
  return (await world.t
    .withIdentity({ subject, org_id: orgId })
    .run((ctx) =>
      (fn as RuntimeFunction)._handler(
        ctx as GenericMutationCtx<DataModel>,
        args,
      ),
    )) as Outcome;
}

function written(outcome: Outcome) {
  expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
  expect(outcome.value?.written, JSON.stringify(outcome.value)).toBe(true);
  return outcome.value!;
}
function refused(outcome: Outcome, code: string) {
  expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
  expect(outcome.value, JSON.stringify(outcome.value)).toMatchObject({
    written: false,
    error: { code },
  });
}
function value(outcome: Outcome) {
  expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
  return outcome.value as Record<string, any>;
}

async function addActor(
  world: ConvexTenantWorld,
  clerkUserId: string,
  roleKey: string,
  sites: readonly GenericId<"warehouses">[] | "ORG_WIDE",
) {
  return await world.t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      clerkUserId,
      displayName: clerkUserId.replace("user_", ""),
      status: "ACTIVE",
    });
    const membershipId = await ctx.db.insert("memberships", {
      orgId: world.orgA,
      userId,
      clerkMembershipId: `orgmem_${clerkUserId}`,
      status: "ACTIVE",
      scopeMode: sites === "ORG_WIDE" ? "ORG_WIDE" : "WAREHOUSE_SCOPED",
      effectiveFrom: 0,
    });
    if (sites !== "ORG_WIDE")
      for (const warehouseId of sites)
        await ctx.db.insert("membershipWarehouses", {
          orgId: world.orgA,
          membershipId,
          warehouseId,
        });
    const role = await ctx.db
      .query("roles")
      .withIndex("by_orgId_key", (q) =>
        q.eq("orgId", world.orgA).eq("key", roleKey),
      )
      .unique();
    await ctx.db.insert("membershipRoles", {
      orgId: world.orgA,
      membershipId,
      roleId: role!._id,
      grantedAt: 0,
    });
    return userId;
  });
}

const DAY_SHIFT = {
  workDays: [1, 2, 3, 4, 5],
  startTime: "08:30",
  endTime: "17:30",
  endsNextDay: false,
  breakMinutes: 60,
};

async function hrWorld() {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, { roleA: "HR_EMPLOYEE" });
  const supervisorId = await addActor(world, SUPERVISOR, "HR_SUPERVISOR", [
    world.warehouses.alphaA,
  ]);
  const otherSupervisorId = await addActor(
    world,
    OTHER_SUPERVISOR,
    "HR_SUPERVISOR",
    [world.warehouses.alphaA],
  );
  const adminId = await addActor(world, HR_ADMIN, "HR_ADMIN", "ORG_WIDE");
  await addActor(world, MANAGER, "WAREHOUSE_MANAGER", "ORG_WIDE");
  setNow("2026-10-01", "09:00");
  const employee = written(
    await call(
      world,
      setup.saveEmployee,
      {
        requestId: rid("employee"),
        warehouseId: world.warehouses.alphaA,
        code: "emp-001",
        displayName: 'สมชาย "ใจดี", Jr.',
        userId: world.userA,
        supervisorUserId: supervisorId,
        employmentStartDate: "2026-01-01",
        status: "ACTIVE",
        schedule: DAY_SHIFT,
      },
      HR_ADMIN,
    ),
  );
  const unlinked = written(
    await call(
      world,
      setup.saveEmployee,
      {
        requestId: rid("unlinked"),
        warehouseId: world.warehouses.alphaA,
        code: "EMP-002",
        displayName: "=Unlinked Worker",
        supervisorUserId: supervisorId,
        employmentStartDate: "2026-01-01",
        status: "ACTIVE",
        schedule: DAY_SHIFT,
      },
      HR_ADMIN,
    ),
  );
  return {
    world,
    supervisorId,
    otherSupervisorId,
    adminId,
    employeeId: employee.documentId as GenericId<"hrEmployees">,
    unlinkedId: unlinked.documentId as GenericId<"hrEmployees">,
  };
}

const rows = <Table extends keyof DataModel>(
  world: ConvexTenantWorld,
  table: Table,
) =>
  world.t.run(
    (ctx) =>
      ctx.db.query(table).collect() as Promise<DataModel[Table]["document"][]>,
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => vi.useRealTimers());

describe("HR roles and the shell boundary (HR-002, A15)", () => {
  it("lets an HR-only employee reach HR without storage access, and keeps warehouse managers out of HR", async () => {
    const { world } = await hrWorld();
    expect(await call(world, workspace.readCurrent, {})).toMatchObject({
      ok: false,
    });
    expect(value(await call(world, access.current, {}))).toMatchObject({
      permissions: ["hr.self.access"],
      employee: { code: "EMP-001" },
    });
    expect(await call(world, access.current, {}, MANAGER)).toMatchObject({
      ok: false,
    });
    expect(await call(world, setup.listEmployees, {}, MANAGER)).toMatchObject({
      ok: false,
    });
    expect(
      value(await call(world, workspace.readCurrent, {}, MANAGER)),
    ).toMatchObject({ navigationPermissions: expect.any(Array) });
    expect(
      value(await call(world, access.current, {}, HR_ADMIN)).permissions,
    ).toEqual(HR_PERMISSION_CODES);
  });

  it("provisions HR for an existing organization without broadening customized roles", async () => {
    const world = await createConvexTenantWorld();
    const roleIds = await world.t.run(async (ctx) => {
      const legacy = [
        "masterData.warehouse.read",
        "masterData.storageLayout.read",
        "masterData.storageLayout.manage",
        "masterData.storageLayout.activate",
      ];
      const make = async (
        orgId: GenericId<"organizations">,
        codes: string[],
      ) => {
        const roleId = await ctx.db.insert("roles", {
          orgId,
          key: "ORG_ADMIN",
          name: "Organization administrator",
          status: "ACTIVE",
          seeded: true,
        });
        for (const permissionCode of codes)
          await ctx.db.insert("rolePermissions", {
            orgId,
            roleId,
            permissionCode,
          });
        return roleId;
      };
      return {
        legacy: await make(world.orgA, legacy),
        custom: await make(world.orgB, legacy.slice(0, 2)),
      };
    });
    const run = (clerkOrganizationId: string) =>
      world.t.run((ctx) =>
        (
          provisioning.provisionOrganization as unknown as RuntimeFunction
        )._handler(ctx as GenericMutationCtx<DataModel>, {
          clerkOrganizationId,
        }),
      );
    expect(await run("org_fixture_a")).toMatchObject({
      orgAdmin: "UPGRADED",
      hrPermissionsAdded: HR_PERMISSION_CODES.length,
    });
    expect(await run("org_fixture_a")).toMatchObject({ orgAdmin: "CURRENT" });
    expect(await run("org_fixture_b")).toMatchObject({
      orgAdmin: "CUSTOMIZED",
      hrPermissionsAdded: 0,
    });
    const grants = await world.t.run((ctx) =>
      ctx.db.query("rolePermissions").collect(),
    );
    expect(grants.filter((g) => g.roleId === roleIds.custom)).toHaveLength(2);
    expect(grants.filter((g) => g.roleId === roleIds.legacy)).toHaveLength(9);
    const managers = await world.t.run((ctx) =>
      ctx.db
        .query("roles")
        .withIndex("by_orgId_key", (q) =>
          q.eq("orgId", world.orgA).eq("key", "WAREHOUSE_MANAGER"),
        )
        .unique(),
    );
    expect(
      grants
        .filter((g) => g.roleId === managers!._id)
        .map((g) => g.permissionCode)
        .some((code) => code.startsWith("hr.")),
    ).toBe(false);
  });
});

describe("employee setup (HR-010, HR-011)", () => {
  it("validates codes, account links and supervisors", async () => {
    const { world, supervisorId } = await hrWorld();
    const base = {
      warehouseId: world.warehouses.alphaA,
      displayName: "Another",
      employmentStartDate: "2026-01-01",
      status: "ACTIVE",
    };
    refused(
      await call(
        world,
        setup.saveEmployee,
        { ...base, requestId: rid("dup"), code: "EMP-001" },
        HR_ADMIN,
      ),
      "EMPLOYEE_CODE_TAKEN",
    );
    refused(
      await call(
        world,
        setup.saveEmployee,
        {
          ...base,
          requestId: rid("link"),
          code: "EMP-003",
          userId: world.userA,
        },
        HR_ADMIN,
      ),
      "MEMBER_ALREADY_LINKED",
    );
    refused(
      await call(
        world,
        setup.saveEmployee,
        {
          ...base,
          requestId: rid("self"),
          code: "EMP-004",
          userId: supervisorId,
          supervisorUserId: supervisorId,
        },
        HR_ADMIN,
      ),
      "SELF_SUPERVISOR",
    );
    refused(
      await call(
        world,
        setup.saveEmployee,
        {
          ...base,
          requestId: rid("foreign"),
          code: "EMP-005",
          warehouseId: world.warehouses.alphaB,
        },
        HR_ADMIN,
      ),
      "SITE_UNAVAILABLE",
    );
    refused(
      await call(
        world,
        setup.saveEmployee,
        {
          ...base,
          requestId: rid("shift"),
          code: "EMP-006",
          schedule: { ...DAY_SHIFT, breakMinutes: 600 },
        },
        HR_ADMIN,
      ),
      "SCHEDULE_BREAK_INVALID",
    );
    const options = value(await call(world, setup.memberOptions, {}, HR_ADMIN));
    expect(
      options.items.map((item: { displayName: string }) => item.displayName),
    ).toContain("hr_supervisor");
  });
});

describe("attendance (HR-020 – HR-025)", () => {
  it("records a clock-in/out pair with server times, stable replay and audit (A1, A2)", async () => {
    const { world, employeeId } = await hrWorld();
    setNow("2026-10-08", "08:23");
    const today = value(await call(world, self.today, {}));
    expect(today).toMatchObject({
      state: "NOT_CLOCKED_IN",
      nextAction: "CLOCK_IN",
      businessDate: "2026-10-08",
      plan: { kind: "SCHEDULED", startTime: "08:30" },
    });
    const requestId = rid("clock-in");
    const first = written(await call(world, self.clockIn, { requestId }));
    expect(first).toMatchObject({
      replayed: false,
      businessDate: "2026-10-08",
      occurredAt: at("2026-10-08", "08:23"),
    });
    const replay = written(await call(world, self.clockIn, { requestId }));
    expect(replay).toMatchObject({
      replayed: true,
      documentId: first.documentId,
      occurredAt: first.occurredAt,
    });
    refused(
      await call(world, self.clockIn, { requestId }, SUPERVISOR),
      "REQUEST_ARGUMENT_CONFLICT",
    );
    refused(
      await call(world, self.clockIn, { requestId: rid("again") }),
      "HR_ALREADY_CLOCKED_IN",
    );
    setNow("2026-10-08", "17:40");
    written(await call(world, self.clockOut, { requestId: rid("clock-out") }));
    refused(
      await call(world, self.clockOut, { requestId: rid("clock-out") }),
      "HR_NOT_CLOCKED_IN",
    );
    expect(await rows(world, "hrAttendanceEvents")).toHaveLength(2);
    setNow("2026-10-09", "09:00");
    const history = value(
      await call(world, self.history, { from: "2026-10-06", to: "2026-10-09" }),
    );
    const day = history.rows.find(
      (row: { businessDate: string }) => row.businessDate === "2026-10-08",
    );
    expect(day).toMatchObject({
      status: "READY",
      disposition: "WORKED",
      workedMinutes: 557 - 60,
      outsideShiftMinutes: 17,
      originalStartAt: at("2026-10-08", "08:23"),
    });
    const audits = (await rows(world, "auditEvents")).filter(
      (row) =>
        row.action === "hr.attendance.clockIn" && row.outcome === "ALLOWED",
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ requestId, actorKind: "USER" });
    const detail = value(
      await call(
        world,
        review.dayDetail,
        { employeeId, businessDate: "2026-10-08" },
        SUPERVISOR,
      ),
    );
    expect(detail.detail.events).toHaveLength(2);
  });

  it("refuses clock-out without clock-in and unlinked/inactive/out-of-employment self-service (A4)", async () => {
    const { world, employeeId } = await hrWorld();
    setNow("2026-10-08", "08:00");
    refused(
      await call(world, self.clockOut, { requestId: rid("no-in") }),
      "HR_NOT_CLOCKED_IN",
    );
    refused(
      await call(
        world,
        self.clockIn,
        { requestId: rid("unlinked") },
        SUPERVISOR,
      ),
      "HR_NOT_LINKED",
    );
    expect(value(await call(world, self.today, {}, SUPERVISOR))).toMatchObject({
      state: "NOT_LINKED",
    });
    await world.t.run((ctx) =>
      ctx.db.patch(employeeId, { employmentEndDate: "2026-10-07" }),
    );
    refused(
      await call(world, self.clockIn, { requestId: rid("ended") }),
      "HR_OUTSIDE_EMPLOYMENT",
    );
    await world.t.run((ctx) =>
      ctx.db.patch(employeeId, { status: "INACTIVE" }),
    );
    refused(
      await call(world, self.clockIn, { requestId: rid("inactive") }),
      "HR_EMPLOYEE_INACTIVE",
    );
    expect(value(await call(world, self.today, {}))).toMatchObject({
      state: "INACTIVE",
    });
    await world.t.run(async (ctx) => {
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_orgId_userId", (q) =>
          q.eq("orgId", world.orgA).eq("userId", world.userA),
        )
        .unique();
      await ctx.db.patch(membership!._id, { status: "SUSPENDED" });
    });
    await expect(
      call(world, self.clockIn, { requestId: rid("suspended") }),
    ).rejects.toThrow();
    expect(await rows(world, "hrAttendanceEvents")).toHaveLength(0);
  });

  it("attaches an overnight clock-out to the shift's start business date (A5)", async () => {
    const { world, employeeId } = await hrWorld();
    await world.t.run((ctx) =>
      ctx.db.patch(employeeId, {
        schedule: {
          workDays: [1, 2, 3, 4, 5, 6, 7],
          startTime: "22:00",
          endTime: "06:00",
          endsNextDay: true,
          breakMinutes: 30,
        },
      }),
    );
    setNow("2026-10-08", "22:00");
    written(await call(world, self.clockIn, { requestId: rid("night-in") }));
    setNow("2026-10-09", "06:00");
    expect(value(await call(world, self.today, {}))).toMatchObject({
      state: "CLOCKED_IN",
      businessDate: "2026-10-08",
    });
    const out = written(
      await call(world, self.clockOut, { requestId: rid("night-out") }),
    );
    expect(out.businessDate).toBe("2026-10-08");
    setNow("2026-10-09", "12:00");
    const history = value(
      await call(world, self.history, { from: "2026-10-08", to: "2026-10-09" }),
    );
    expect(
      history.rows.find(
        (row: { businessDate: string }) => row.businessDate === "2026-10-08",
      ),
    ).toMatchObject({
      status: "READY",
      workedMinutes: 450,
      outsideShiftMinutes: 0,
    });
  });
});

describe("corrections and review (HR-030 – HR-034)", () => {
  async function missingEnd() {
    const context = await hrWorld();
    setNow("2026-10-08", "08:29");
    written(await call(context.world, self.clockIn, { requestId: rid("in") }));
    setNow("2026-10-09", "07:00");
    expect(value(await call(context.world, self.today, {}))).toMatchObject({
      state: "UNRESOLVED_OPEN",
      nextAction: "NONE",
      openDay: { businessDate: "2026-10-08" },
    });
    refused(
      await call(context.world, self.clockIn, { requestId: rid("blocked") }),
      "HR_OPEN_DAY_UNRESOLVED",
    );
    const submitted = written(
      await call(context.world, self.submitCorrection, {
        requestId: rid("correction"),
        businessDate: "2026-10-08",
        end: { minute: 17 * 60 + 30, nextDay: false },
        reason: "ลืมลงเวลาออก",
      }),
    );
    refused(
      await call(context.world, self.submitCorrection, {
        requestId: rid("second"),
        businessDate: "2026-10-08",
        end: { minute: 17 * 60, nextDay: false },
        reason: "Another request",
      }),
      "CORRECTION_ALREADY_PENDING",
    );
    return { ...context, correctionId: submitted.documentId as string };
  }

  it("certifies a missing end and keeps the original event (A8)", async () => {
    const { world, employeeId, correctionId } = await missingEnd();
    const queue = value(
      await call(
        world,
        review.queue,
        { from: "2026-10-01", to: "2026-10-09" },
        SUPERVISOR,
      ),
    );
    expect(
      queue.items.find(
        (item: { employeeId: string; businessDate: string }) =>
          item.employeeId === employeeId && item.businessDate === "2026-10-08",
      ),
    ).toMatchObject({
      issue: "PENDING_CORRECTION",
      pendingCorrectionId: correctionId,
    });
    written(
      await call(
        world,
        review.decideCorrection,
        {
          requestId: rid("certify"),
          correctionId,
          expectedVersion: 1,
          decision: "CERTIFY",
        },
        SUPERVISOR,
      ),
    );
    refused(
      await call(
        world,
        review.decideCorrection,
        {
          requestId: rid("again"),
          correctionId,
          expectedVersion: 1,
          decision: "CERTIFY",
        },
        SUPERVISOR,
      ),
      "DECISION_STALE",
    );
    const detail = value(
      await call(world, self.dayDetail, { businessDate: "2026-10-08" }),
    );
    expect(detail.detail).toMatchObject({
      status: "READY",
      originalStartAt: at("2026-10-08", "08:29"),
      effectiveEndAt: at("2026-10-08", "17:30"),
      workedMinutes: 541 - 60,
      certification: {
        disposition: "WORKED",
        reason: "ลืมลงเวลาออก",
        current: true,
      },
      corrections: [{ status: "CERTIFIED" }],
    });
    expect(detail.detail.originalEndAt).toBeUndefined();
    expect(
      detail.detail.corrections[0].history.map(
        (h: { action: string }) => h.action,
      ),
    ).toEqual(["SUBMITTED", "CERTIFIED"]);
    written(await call(world, self.clockIn, { requestId: rid("next-day") }));
  });

  it("returns with a reason, rejects self, foreign and stale decisions (A9)", async () => {
    const { world, employeeId, correctionId } = await missingEnd();
    const decide = (subject: string, extra: Record<string, unknown>) =>
      call(
        world,
        review.decideCorrection,
        {
          requestId: rid("decide"),
          correctionId,
          expectedVersion: 1,
          decision: "RETURN",
          ...extra,
        },
        subject,
      );
    refused(await decide(SUPERVISOR, {}), "REASON_REQUIRED");
    refused(
      await decide(OTHER_SUPERVISOR, { reason: "Not mine" }),
      "NOT_FOUND",
    );
    refused(
      await decide(SUPERVISOR, { expectedVersion: 7, reason: "Old screen" }),
      "DECISION_STALE",
    );
    // The employee holds no review permission, so forged review is denied outright.
    expect(await decide(EMPLOYEE, { reason: "Approve myself" })).toMatchObject({
      ok: false,
    });
    written(
      await decide(SUPERVISOR, { reason: "Please give the real end time" }),
    );
    const detail = value(
      await call(world, self.dayDetail, { businessDate: "2026-10-08" }),
    );
    expect(detail.detail).toMatchObject({
      status: "EXCEPTION",
      issue: "MISSING_END",
      workedMinutes: 0,
      corrections: [
        { status: "RETURNED", decisionReason: "Please give the real end time" },
      ],
    });
    // Resubmission keeps the decision history.
    written(
      await call(world, self.submitCorrection, {
        requestId: rid("resubmit"),
        correctionId,
        businessDate: "2026-10-08",
        end: { minute: 17 * 60 + 35, nextDay: false },
        reason: "Left at 17:35 after handover",
      }),
    );
    const again = value(
      await call(world, self.dayDetail, { businessDate: "2026-10-08" }),
    );
    expect(
      again.detail.corrections[0].history.map(
        (h: { action: string }) => h.action,
      ),
    ).toEqual(["SUBMITTED", "RETURNED", "SUBMITTED"]);
    // An HR administrator who is also the employee cannot review themself.
    await world.t.run(async (ctx) => {
      const admin = await ctx.db
        .query("users")
        .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", HR_ADMIN))
        .unique();
      await ctx.db.patch(employeeId, { userId: admin!._id });
    });
    refused(
      await call(
        world,
        review.decideCorrection,
        {
          requestId: rid("self"),
          correctionId,
          expectedVersion: 3,
          decision: "CERTIFY",
        },
        HR_ADMIN,
      ),
      "SELF_REVIEW",
    );
  });

  it("disposes missing days, including unlinked employees, without inventing hours (A7, HR-033)", async () => {
    const { world, unlinkedId } = await hrWorld();
    setNow("2026-10-09", "09:00");
    const detail = value(
      await call(
        world,
        review.dayDetail,
        { employeeId: unlinkedId, businessDate: "2026-10-08" },
        SUPERVISOR,
      ),
    );
    expect(detail.detail).toMatchObject({
      status: "EXCEPTION",
      issue: "MISSING_RECORD",
      revision: 0,
    });
    refused(
      await call(
        world,
        review.disposeDay,
        {
          requestId: rid("future"),
          employeeId: unlinkedId,
          businessDate: "2026-10-09",
          expectedRevision: 0,
          disposition: "ABSENT",
          reason: "Not here",
        },
        SUPERVISOR,
      ),
      "DAY_NOT_EXCEPTION",
    );
    written(
      await call(
        world,
        review.disposeDay,
        {
          requestId: rid("absent"),
          employeeId: unlinkedId,
          businessDate: "2026-10-08",
          expectedRevision: 0,
          disposition: "ABSENT",
          reason: "No show, confirmed by phone",
        },
        SUPERVISOR,
      ),
    );
    refused(
      await call(
        world,
        review.disposeDay,
        {
          requestId: rid("stale"),
          employeeId: unlinkedId,
          businessDate: "2026-10-08",
          expectedRevision: 0,
          disposition: "LEAVE",
          reason: "Changed mind",
        },
        SUPERVISOR,
      ),
      "DECISION_STALE",
    );
    const after = value(
      await call(
        world,
        review.dayDetail,
        { employeeId: unlinkedId, businessDate: "2026-10-08" },
        SUPERVISOR,
      ),
    );
    expect(after.detail).toMatchObject({
      status: "READY",
      disposition: "ABSENT",
      workedMinutes: 0,
    });
  });
});

describe("periods and CSV export (HR-040 – HR-043)", () => {
  async function readyWeek() {
    const context = await hrWorld();
    const { world, unlinkedId } = context;
    // Site holiday on Friday 2026-10-09.
    written(
      await call(
        world,
        setup.saveHoliday,
        {
          requestId: rid("holiday"),
          warehouseId: world.warehouses.alphaA,
          date: "2026-10-09",
          name: "Site holiday",
        },
        HR_ADMIN,
      ),
    );
    for (const date of [
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
    ]) {
      setNow(date, "08:30");
      written(await call(world, self.clockIn, { requestId: rid("in") }));
      setNow(date, "17:30");
      written(await call(world, self.clockOut, { requestId: rid("out") }));
    }
    return { ...context, unlinkedId };
  }

  it("creates, blocks, closes, exports, locks and revises a period (A6, A7, A10–A13)", async () => {
    const { world, unlinkedId } = await readyWeek();
    setNow("2026-10-10", "10:00");
    const site = world.warehouses.alphaA;
    refused(
      await call(
        world,
        periods.create,
        {
          requestId: rid("big"),
          warehouseId: site,
          startDate: "2026-09-01",
          endDate: "2026-10-05",
        },
        HR_ADMIN,
      ),
      "PERIOD_TOO_LARGE",
    );
    refused(
      await call(
        world,
        periods.create,
        {
          requestId: rid("foreign"),
          warehouseId: world.warehouses.alphaB,
          startDate: "2026-10-05",
          endDate: "2026-10-09",
        },
        HR_ADMIN,
      ),
      "SITE_UNAVAILABLE",
    );
    const periodId = written(
      await call(
        world,
        periods.create,
        {
          requestId: rid("create"),
          warehouseId: site,
          startDate: "2026-10-05",
          endDate: "2026-10-11",
        },
        HR_ADMIN,
      ),
    ).documentId as string;
    refused(
      await call(
        world,
        periods.create,
        {
          requestId: rid("overlap"),
          warehouseId: site,
          startDate: "2026-10-11",
          endDate: "2026-10-12",
        },
        HR_ADMIN,
      ),
      "PERIOD_OVERLAP",
    );
    let preview = value(
      await call(world, periods.preview, { periodId }, HR_ADMIN),
    );
    expect(preview.view).toMatchObject({
      kind: "DRAFT",
      blocker: "PERIOD_INCLUDES_FUTURE",
    });
    const holiday = preview.view.rows.find(
      (row: { employeeCode: string; businessDate: string }) =>
        row.employeeCode === "EMP-001" && row.businessDate === "2026-10-09",
    );
    expect(holiday).toMatchObject({
      status: "READY",
      disposition: "NONWORKING",
      workedMinutes: 0,
    });
    refused(
      await call(
        world,
        periods.close,
        {
          requestId: rid("future"),
          periodId,
          expectedFingerprint: preview.view.fingerprint,
        },
        HR_ADMIN,
      ),
      "PERIOD_INCLUDES_FUTURE",
    );

    setNow("2026-10-12", "10:00");
    preview = value(await call(world, periods.preview, { periodId }, HR_ADMIN));
    expect(preview.view.blocker).toBe("PERIOD_NOT_READY");
    // The unlinked employee's four missing scheduled days are exceptions.
    expect(preview.view.totals.exceptions).toBe(4);
    refused(
      await call(
        world,
        periods.close,
        {
          requestId: rid("blocked"),
          periodId,
          expectedFingerprint: preview.view.fingerprint,
        },
        HR_ADMIN,
      ),
      "PERIOD_NOT_READY",
    );
    for (const date of ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"])
      written(
        await call(
          world,
          review.disposeDay,
          {
            requestId: rid("leave"),
            employeeId: unlinkedId,
            businessDate: date,
            expectedRevision: 0,
            disposition: "LEAVE",
            reason: "Leave recorded in the paper register",
          },
          HR_ADMIN,
        ),
      );
    refused(
      await call(
        world,
        periods.close,
        {
          requestId: rid("stale"),
          periodId,
          expectedFingerprint: preview.view.fingerprint,
        },
        HR_ADMIN,
      ),
      "PERIOD_STALE",
    );
    preview = value(await call(world, periods.preview, { periodId }, HR_ADMIN));
    expect(preview.view.blocker).toBeNull();
    expect(preview.view.totals).toMatchObject({
      workedMinutes: 4 * 480,
      leaveDays: 4,
      nonworkingDays: 6,
    });
    const closeRequest = rid("close");
    const closed = written(
      await call(
        world,
        periods.close,
        {
          requestId: closeRequest,
          periodId,
          expectedFingerprint: preview.view.fingerprint,
        },
        HR_ADMIN,
      ),
    );
    expect(closed.version).toBe(1);
    expect(
      written(
        await call(
          world,
          periods.close,
          {
            requestId: closeRequest,
            periodId,
            expectedFingerprint: preview.view.fingerprint,
          },
          HR_ADMIN,
        ),
      ),
    ).toMatchObject({ replayed: true, documentId: closed.documentId });
    expect(
      (
        await call(
          world,
          periods.close,
          {
            requestId: rid("close-again"),
            periodId,
            expectedFingerprint: preview.view.fingerprint,
          },
          HR_ADMIN,
        )
      ).value,
    ).toMatchObject({ error: { code: "PERIOD_ALREADY_CLOSED" } });

    const versionId = closed.documentId as string;
    expect(
      await call(world, periods.exportCsv, {
        requestId: rid("emp-export"),
        versionId,
      }),
    ).toMatchObject({ ok: false });
    const exported = written(
      await call(
        world,
        periods.exportCsv,
        { requestId: rid("export"), versionId },
        HR_ADMIN,
      ),
    );
    const csv = exported.content as string;
    expect(exported.fileName).toBe(
      "attendance_ALPHA_2026-10-05_2026-10-11_v1.csv",
    );
    expect(
      csv.startsWith("\uFEFFperiod_id,period_version,site_code,employee_code"),
    ).toBe(true);
    expect(csv).toContain('"สมชาย ""ใจดี"", Jr."');
    expect(csv).toContain("'=Unlinked Worker");
    expect(csv).toContain(
      ",2026-10-05,Asia/Bangkok,2026-10-05T01:30:00Z,2026-10-05T10:30:00Z,2026-10-05T01:30:00Z,2026-10-05T10:30:00Z,480,0,WORKED,",
    );
    expect(csv).toContain(",LEAVE,Leave recorded in the paper register");
    const csvLines = csv.trim().split("\r\n");
    expect(csvLines).toHaveLength(1 + 14);
    const workedTotal = csvLines
      .slice(1)
      .map((line) => line.split(","))
      .reduce((sum, cells) => sum + Number(cells.at(-4)), 0);
    expect(workedTotal).toBe(preview.view.totals.workedMinutes);
    const exportAudits = (await rows(world, "auditEvents")).filter(
      (row) =>
        row.action === "hr.period.exportVersion" && row.outcome === "ALLOWED",
    );
    expect(exportAudits).toHaveLength(1);

    // Closed data cannot be changed by normal writes.
    setNow("2026-10-12", "11:00");
    refused(
      await call(world, self.submitCorrection, {
        requestId: rid("locked"),
        businessDate: "2026-10-08",
        end: { minute: 1080, nextDay: false },
        reason: "Left later",
      }),
      "HR_PERIOD_CLOSED",
    );
    // Revision needs a reason, keeps v1, and closes as v2.
    refused(
      await call(
        world,
        periods.startRevision,
        { requestId: rid("rev"), periodId, reason: "" },
        HR_ADMIN,
      ),
      "REASON_REQUIRED",
    );
    written(
      await call(
        world,
        periods.startRevision,
        {
          requestId: rid("rev"),
          periodId,
          reason: "Employee left later on 8 Oct",
        },
        HR_ADMIN,
      ),
    );
    written(
      await call(world, self.submitCorrection, {
        requestId: rid("revised"),
        businessDate: "2026-10-08",
        end: { minute: 1080, nextDay: false },
        reason: "Left later after audit",
      }),
    );
    const pending = value(
      await call(world, self.dayDetail, { businessDate: "2026-10-08" }),
    );
    written(
      await call(
        world,
        review.decideCorrection,
        {
          requestId: rid("cert"),
          correctionId: pending.detail.pendingCorrectionId,
          expectedVersion: 1,
          decision: "CERTIFY",
        },
        SUPERVISOR,
      ),
    );
    preview = value(await call(world, periods.preview, { periodId }, HR_ADMIN));
    expect(preview.view.totals.workedMinutes).toBe(4 * 480 + 30);
    const v2 = written(
      await call(
        world,
        periods.close,
        {
          requestId: rid("close-v2"),
          periodId,
          expectedFingerprint: preview.view.fingerprint,
        },
        HR_ADMIN,
      ),
    );
    expect(v2.version).toBe(2);
    expect(v2.documentId).not.toBe(versionId);
    const v1Again = written(
      await call(
        world,
        periods.exportCsv,
        { requestId: rid("export-v1"), versionId },
        HR_ADMIN,
      ),
    );
    expect(v1Again.content).toBe(csv);
    const v1Preview = value(
      await call(world, periods.preview, { periodId, version: 1 }, HR_ADMIN),
    );
    expect(v1Preview.view).toMatchObject({
      kind: "CLOSED",
      version: 1,
      totals: { workedMinutes: 4 * 480 },
    });
    expect(
      v1Preview.versions.map((v: { version: number }) => v.version),
    ).toEqual([2, 1]);
  });

  it("does not leak another organization's period through a forged version ID (A3)", async () => {
    const { world } = await readyWeek();
    const foreignVersion = await world.t.run(async (ctx) => {
      const periodId = await ctx.db.insert("hrPeriods", {
        orgId: world.orgB,
        warehouseId: world.warehouses.alphaB,
        startDate: "2026-10-05",
        endDate: "2026-10-05",
        status: "CLOSED",
        draftVersion: 1,
        latestClosedVersion: 1,
        createdAt: 1,
        createdByUserId: world.userA,
        updatedAt: 1,
        updatedByUserId: world.userA,
      });
      return await ctx.db.insert("hrPeriodVersions", {
        orgId: world.orgB,
        periodId,
        warehouseId: world.warehouses.alphaB,
        version: 1,
        startDate: "2026-10-05",
        endDate: "2026-10-05",
        timezone: "Asia/Bangkok",
        siteCode: "ALPHA",
        siteName: "B",
        fingerprint: "x",
        totals: {
          employees: 0,
          days: 0,
          workedMinutes: 0,
          outsideShiftMinutes: 0,
          absentDays: 0,
          leaveDays: 0,
          nonworkingDays: 0,
        },
        closedByUserId: world.userA,
        closedAt: 1,
      });
    });
    refused(
      await call(
        world,
        periods.exportCsv,
        { requestId: rid("forged"), versionId: foreignVersion },
        HR_ADMIN,
      ),
      "NOT_FOUND",
    );
    const employeeB = await world.t.run((ctx) =>
      ctx.db.insert("hrEmployees", {
        orgId: world.orgB,
        warehouseId: world.warehouses.alphaB,
        code: "B-1",
        displayName: "Foreign",
        employmentStartDate: "2026-01-01",
        status: "ACTIVE",
        version: 1,
        createdAt: 1,
        createdByUserId: world.userA,
        updatedAt: 1,
        updatedByUserId: world.userA,
      }),
    );
    expect(
      value(
        await call(
          world,
          review.dayDetail,
          { employeeId: employeeB, businessDate: "2026-10-05" },
          HR_ADMIN,
        ),
      ),
    ).toMatchObject({ ok: false, code: "NOT_FOUND" });
    refused(
      await call(
        world,
        review.disposeDay,
        {
          requestId: rid("forged-day"),
          employeeId: employeeB,
          businessDate: "2026-10-05",
          expectedRevision: 0,
          disposition: "ABSENT",
          reason: "Forged",
        },
        HR_ADMIN,
      ),
      "NOT_FOUND",
    );
    const daysB = (await rows(world, "hrAttendanceDays")).filter(
      (row) => row.orgId === world.orgB,
    );
    expect(daysB).toHaveLength(0);
  });
});
