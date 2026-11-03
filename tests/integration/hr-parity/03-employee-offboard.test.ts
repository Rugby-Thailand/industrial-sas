import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GenericMutationCtx } from "convex/server";
import type { Id } from "../../../convex/_generated/dataModel";
import type { DataModel } from "../../../convex/schema";
import type { TenantFunctionOutcome } from "../../../convex/lib/tenantFunctions";
import * as profile from "../../../convex/hr/employeeProfile";
import * as setup from "../../../convex/hr/setup";
import * as self from "../../../convex/hr/self";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  seedSecondActorForOrgA,
  type ConvexTenantWorld,
} from "../../fixtures/convex-tenant-world";

// Real registered Convex handlers against the convex-test backend; nothing is
// mocked. HRZoft's exact save/validation wording was not observed: codes and
// rules here are this app's contract (see docs/plans/hr-parity/03-employee-offboard).
// S03-08 (bulk actions), S03-22 (leave settlement) and S03-23 (login disable)
// have no implementation; S03-23 is asserted only as "offboarding leaves the
// linked account and roles untouched".

const ADMIN = { subject: "user_fixture_a", org_id: "org_fixture_a" };
const TENANT_B = { ...ADMIN, org_id: "org_fixture_b" };
// 2026-10-20 10:00 in Bangkok.
const NOW = Date.UTC(2026, 9, 20, 3);
const TODAY = "2026-10-20";
const YESTERDAY = "2026-10-19";
const TOMORROW = "2026-10-21";
let sequence = 0;
const requestId = () => `s03-request-${++sequence}`;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

async function fixture() {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, {
    roleA: "HR_ADMIN",
    roleB: "HR_ADMIN",
  });
  return world;
}
// Registered handlers are called directly; arguments are checked by the
// handler's own validation paths asserted below.
type Handler = unknown;
async function raw(
  world: ConvexTenantWorld,
  fn: Handler,
  args: object,
  identity = ADMIN,
): Promise<TenantFunctionOutcome<unknown>> {
  return await world.t.withIdentity(identity).run((ctx) =>
    (
      fn as {
        _handler: (
          ctx: GenericMutationCtx<DataModel>,
          args: object,
        ) => Promise<TenantFunctionOutcome<unknown>>;
      }
    )._handler(ctx, args),
  );
}
async function call(
  world: ConvexTenantWorld,
  fn: Handler,
  args: object,
  identity = ADMIN,
): Promise<any> {
  const out = await raw(world, fn, args, identity);
  expect(out.ok, JSON.stringify(out)).toBe(true);
  if (!out.ok) throw new Error("Unexpected authorization denial");
  return out.value;
}
const employeeArgs = (world: ConvexTenantWorld, code = "E001") => ({
  warehouseId: world.warehouses.alphaA,
  code,
  displayName: `Employee ${code}`,
  employmentStartDate: "2026-01-05",
  status: "ACTIVE" as const,
});
async function hire(
  world: ConvexTenantWorld,
  extra: Record<string, unknown> = {},
  code = "E001",
): Promise<Id<"hrEmployees">> {
  const out = await call(world, setup.saveEmployee, {
    ...employeeArgs(world, code),
    ...extra,
    requestId: requestId(),
  });
  expect(out, JSON.stringify(out)).toMatchObject({ written: true });
  return out.documentId as Id<"hrEmployees">;
}
const stored = (world: ConvexTenantWorld, id: Id<"hrEmployees">) =>
  world.t.run((ctx) => ctx.db.get(id));
const events = (world: ConvexTenantWorld) =>
  world.t.run((ctx) => ctx.db.query("hrEmploymentEvents").collect());
const snapshot = (world: ConvexTenantWorld) =>
  world.t.run(async (ctx) => ({
    employees: await ctx.db.query("hrEmployees").collect(),
    profiles: await ctx.db.query("hrEmployeeProfiles").collect(),
    payments: await ctx.db.query("hrEmployeePayments").collect(),
    events: await ctx.db.query("hrEmploymentEvents").collect(),
  }));
async function lifecycle(
  world: ConvexTenantWorld,
  id: Id<"hrEmployees">,
  args: {
    kind: "CONFIRM_PROBATION" | "OFFBOARD" | "REINSTATE";
    effectiveDate: string;
    separationType?: "RESIGNATION" | "TERMINATION";
    reason?: string;
    requestId?: string;
    expectedVersion?: number;
  },
) {
  const version =
    args.expectedVersion ?? (await stored(world, id))?.version ?? 0;
  return await call(world, profile.recordEmploymentEvent, {
    employeeId: id,
    expectedVersion: version,
    requestId: args.requestId ?? requestId(),
    kind: args.kind,
    effectiveDate: args.effectiveDate,
    ...(args.separationType === undefined
      ? {}
      : { separationType: args.separationType }),
    ...(args.reason === undefined ? {} : { reason: args.reason }),
  });
}
/** One settled first page of a scanning list (it may need several reads). */

async function settled(
  world: ConvexTenantWorld,
  fn: unknown,
  args: object,
): Promise<any> {
  let scanCursor: string | undefined;
  for (let guard = 0; guard < 50; guard += 1) {
    const answer = await call(
      world,
      fn as never,
      {
        ...args,
        ...(scanCursor === undefined ? {} : { scanCursor }),
      } as never,
    );
    expect(answer.ok, JSON.stringify(answer)).toBe(true);
    if (answer.status !== "scanning") return answer;
    scanCursor = answer.scanCursor;
  }
  throw new Error("scan did not settle");
}
async function registry(
  world: ConvexTenantWorld,
  status?: "ACTIVE" | "INACTIVE" | "PROBATION" | "FORMER" | "ALL",
): Promise<{ code: string; employmentState: string }[]> {
  const page = await settled(world, setup.employeesPage, {
    ...(status === undefined ? {} : { status }),
  });
  expect(page.isDone).toBe(true);
  return page.page.map((item: { code: string; employmentState: string }) => ({
    code: item.code,
    employmentState: item.employmentState,
  }));
}

it("[guess] S03-17 probation confirmation flips the list status from Probation to confirmed", async () => {
  const world = await fixture();
  const id = await hire(world, { probationEndDate: "2026-05-04" });
  expect(await registry(world)).toEqual([
    { code: "E001", employmentState: "PROBATION" },
  ]);
  const before = await snapshot(world);
  // Scheduled confirmation is not supported, so a future date is refused.
  expect(
    await lifecycle(world, id, {
      kind: "CONFIRM_PROBATION",
      effectiveDate: TOMORROW,
    }),
  ).toMatchObject({
    written: false,
    error: { code: "LIFECYCLE_DATE_FUTURE", field: "effectiveDate" },
  });
  expect(
    await lifecycle(world, id, {
      kind: "CONFIRM_PROBATION",
      effectiveDate: "2026-01-04",
    }),
  ).toMatchObject({ error: { code: "LIFECYCLE_DATE_BEFORE_START" } });
  expect(
    await lifecycle(world, id, {
      kind: "CONFIRM_PROBATION",
      effectiveDate: "2026-02-30",
    }),
  ).toMatchObject({ error: { code: "LIFECYCLE_DATE_INVALID" } });
  expect(await snapshot(world)).toEqual(before);

  const retried = requestId();
  const first = await lifecycle(world, id, {
    kind: "CONFIRM_PROBATION",
    effectiveDate: TODAY,
    requestId: retried,
    expectedVersion: 1,
  });
  expect(first).toMatchObject({ written: true, replayed: false });
  expect(await registry(world)).toEqual([
    { code: "E001", employmentState: "ACTIVE" },
  ]);
  expect(await stored(world, id)).toMatchObject({
    status: "ACTIVE",
    probationEndDate: "2026-05-04",
    probationConfirmedDate: TODAY,
    version: 2,
  });
  // A network retry of the same command replays without a second event.
  expect(
    await lifecycle(world, id, {
      kind: "CONFIRM_PROBATION",
      effectiveDate: TODAY,
      requestId: retried,
      expectedVersion: 1,
    }),
  ).toMatchObject({ written: true, replayed: true, documentId: id });
  // A new confirmation never moves the date: the person is no longer on probation.
  expect(
    await lifecycle(world, id, {
      kind: "CONFIRM_PROBATION",
      effectiveDate: "2026-03-01",
    }),
  ).toMatchObject({ error: { code: "LIFECYCLE_NOT_ON_PROBATION" } });
  expect((await stored(world, id))?.probationConfirmedDate).toBe(TODAY);
  expect(await events(world)).toHaveLength(1);
});

it("[seen] S03-18 employment-status changes keep an effective-dated history", async () => {
  const world = await fixture();
  const id = await hire(world, { probationEndDate: "2026-05-04" });
  await lifecycle(world, id, {
    kind: "CONFIRM_PROBATION",
    effectiveDate: "2026-05-04",
  });
  const [confirmed] = await events(world);
  vi.setSystemTime(NOW + 1000);
  await lifecycle(world, id, {
    kind: "OFFBOARD",
    separationType: "RESIGNATION",
    effectiveDate: "2026-09-30",
    reason: "Moved to another city",
  });
  vi.setSystemTime(NOW + 2000);
  await lifecycle(world, id, {
    kind: "REINSTATE",
    effectiveDate: TODAY,
    reason: "Rehired after return",
  });
  const history = await call(world, profile.employeeLifecycle, {
    employeeId: id,
  });
  expect(history).toMatchObject({
    ok: true,
    today: TODAY,
    state: "ACTIVE",
    complete: true,
    probationConfirmedDate: "2026-05-04",
  });
  expect(history.separation).toBeUndefined();
  // Newest first, each with its own effective date and transition.
  expect(
    history.events.map(
      (event: {
        type: string;
        effectiveDate: string;
        fromState: string;
        toState: string;
        reason?: string;
      }) => [
        event.type,
        event.effectiveDate,
        event.fromState,
        event.toState,
        event.reason,
      ],
    ),
  ).toEqual([
    ["REINSTATED", TODAY, "RESIGNED", "ACTIVE", "Rehired after return"],
    ["RESIGNED", "2026-09-30", "ACTIVE", "RESIGNED", "Moved to another city"],
    ["PROBATION_CONFIRMED", "2026-05-04", "PROBATION", "ACTIVE", undefined],
  ]);
  // Earlier events are never rewritten by later transitions.
  const all = await events(world);
  expect(all.find((row) => row._id === confirmed!._id)).toEqual(confirmed);
  expect(all.map((row) => row.employeeVersion)).toEqual([2, 3, 4]);
  const reinstated = await stored(world, id);
  expect(reinstated).toMatchObject({ status: "ACTIVE", version: 4 });
  expect(reinstated).not.toHaveProperty("employmentEndDate");
  expect(reinstated).not.toHaveProperty("separation");
});

it("[guess] S03-19 offboarding requires a terminal status and a valid last working day", async () => {
  const world = await fixture();
  const id = await hire(world);
  const before = await snapshot(world);
  for (const [effectiveDate, code] of [
    [TODAY, "LIFECYCLE_LAST_DAY_NOT_PAST"],
    [TOMORROW, "LIFECYCLE_LAST_DAY_NOT_PAST"],
    ["2026-01-04", "LIFECYCLE_DATE_BEFORE_START"],
    ["20261001", "LIFECYCLE_DATE_INVALID"],
  ] as const)
    expect(
      await lifecycle(world, id, {
        kind: "OFFBOARD",
        separationType: "RESIGNATION",
        effectiveDate,
        reason: "Personal reasons",
      }),
    ).toMatchObject({
      written: false,
      error: { code, field: "effectiveDate" },
    });
  expect(
    await lifecycle(world, id, {
      kind: "OFFBOARD",
      effectiveDate: YESTERDAY,
      reason: "Personal reasons",
    }),
  ).toMatchObject({
    error: { code: "LIFECYCLE_TYPE_REQUIRED", field: "separationType" },
  });
  // The person still works today, so nothing about them changed.
  expect(await snapshot(world)).toEqual(before);
  expect((await stored(world, id))?.status).toBe("ACTIVE");

  await lifecycle(world, id, {
    kind: "OFFBOARD",
    separationType: "RESIGNATION",
    effectiveDate: YESTERDAY,
    reason: "Personal reasons",
  });
  expect(await stored(world, id)).toMatchObject({
    status: "INACTIVE",
    employmentEndDate: YESTERDAY,
    separation: {
      type: "RESIGNATION",
      lastWorkingDate: YESTERDAY,
      reason: "Personal reasons",
    },
  });
  // Offboarding twice is refused; the record is retained, not deleted.
  expect(
    await lifecycle(world, id, {
      kind: "OFFBOARD",
      separationType: "TERMINATION",
      effectiveDate: "2026-10-01",
      reason: "Second attempt",
    }),
  ).toMatchObject({ error: { code: "LIFECYCLE_ALREADY_SEPARATED" } });
  // The general editor cannot silently reactivate or move the last day.
  const version = (await stored(world, id))!.version;
  expect(
    await call(world, setup.saveEmployee, {
      ...employeeArgs(world),
      employeeId: id,
      expectedVersion: version,
      requestId: requestId(),
    }),
  ).toMatchObject({ error: { code: "EMPLOYEE_SEPARATED", field: "status" } });
  expect(
    await call(world, setup.saveEmployee, {
      ...employeeArgs(world),
      status: "INACTIVE",
      employmentEndDate: "2026-10-18",
      employeeId: id,
      expectedVersion: version,
      requestId: requestId(),
    }),
  ).toMatchObject({
    error: { code: "EMPLOYEE_SEPARATED", field: "employmentEndDate" },
  });
  // Other details stay editable while the separation is kept.
  expect(
    await call(world, setup.saveEmployee, {
      ...employeeArgs(world),
      displayName: "Renamed former employee",
      status: "INACTIVE",
      employmentEndDate: YESTERDAY,
      employeeId: id,
      expectedVersion: version,
      requestId: requestId(),
    }),
  ).toMatchObject({ written: true });
  expect(await stored(world, id)).toMatchObject({
    displayName: "Renamed former employee",
    separation: { lastWorkingDate: YESTERDAY },
  });
  // Reinstatement must follow the last working day.
  expect(
    await lifecycle(world, id, {
      kind: "REINSTATE",
      effectiveDate: YESTERDAY,
      reason: "Came back",
    }),
  ).toMatchObject({ error: { code: "LIFECYCLE_REINSTATE_BEFORE_EXIT" } });
  expect(
    await lifecycle(world, id, {
      kind: "REINSTATE",
      effectiveDate: TOMORROW,
      reason: "Came back",
    }),
  ).toMatchObject({ error: { code: "LIFECYCLE_DATE_FUTURE" } });
});

it("[seen] S03-20 offboarded employees are excluded from the default active list", async () => {
  const world = await fixture();
  await hire(world, {}, "A001");
  await hire(world, { probationEndDate: "2026-12-31" }, "P001");
  await hire(world, { status: "INACTIVE" }, "I001");
  const resigned = await hire(world, {}, "R001");
  const terminated = await hire(world, {}, "T001");
  await lifecycle(world, resigned, {
    kind: "OFFBOARD",
    separationType: "RESIGNATION",
    effectiveDate: YESTERDAY,
    reason: "Resigned",
  });
  await lifecycle(world, terminated, {
    kind: "OFFBOARD",
    separationType: "TERMINATION",
    effectiveDate: "2026-10-01",
    reason: "Contract ended early",
  });
  const codes = async (
    status?: "ACTIVE" | "INACTIVE" | "PROBATION" | "FORMER" | "ALL",
  ) => (await registry(world, status)).map((row) => row.code);
  expect(await codes()).toEqual(["A001", "I001", "P001"]);
  expect(await codes("ACTIVE")).toEqual(["A001", "P001"]);
  expect(await codes("PROBATION")).toEqual(["P001"]);
  // Stored-status filters keep their meaning for existing links.
  expect(await codes("INACTIVE")).toEqual(["I001", "R001", "T001"]);
  expect(await registry(world, "FORMER")).toEqual([
    { code: "R001", employmentState: "RESIGNED" },
    { code: "T001", employmentState: "TERMINATED" },
  ]);
  expect(await codes("ALL")).toEqual(["A001", "I001", "P001", "R001", "T001"]);
  // Search and paging stay exact under the default filter.
  const page = await settled(world, setup.employeesPage, {
    search: "001",
    pageSize: 20,
  });
  expect(page.page.map((item: { code: string }) => item.code)).toEqual([
    "A001",
    "I001",
    "P001",
  ]);
  // An offboarded employee still opens by ID with a truthful state.
  expect(
    await call(world, setup.employee, { employeeId: terminated }),
  ).toMatchObject({
    ok: true,
    employee: {
      status: "INACTIVE",
      employmentState: "TERMINATED",
      separation: { type: "TERMINATION", lastWorkingDate: "2026-10-01" },
    },
  });
});

it("[guess] S03-21 offboarding records a resignation/termination type and reason", async () => {
  const world = await fixture();
  const id = await hire(world);
  const before = await snapshot(world);
  for (const reason of [undefined, "", "  x "])
    expect(
      await lifecycle(world, id, {
        kind: "OFFBOARD",
        separationType: "TERMINATION",
        effectiveDate: YESTERDAY,
        ...(reason === undefined ? {} : { reason }),
      }),
    ).toMatchObject({
      written: false,
      error: { code: "LIFECYCLE_REASON_REQUIRED", field: "reason" },
    });
  expect(await snapshot(world)).toEqual(before);
  await lifecycle(world, id, {
    kind: "OFFBOARD",
    separationType: "TERMINATION",
    effectiveDate: YESTERDAY,
    reason: "  Repeated   absence  ",
  });
  const history = await call(world, profile.employeeLifecycle, {
    employeeId: id,
  });
  expect(history).toMatchObject({
    state: "TERMINATED",
    separation: {
      type: "TERMINATION",
      lastWorkingDate: YESTERDAY,
      reason: "Repeated   absence",
    },
    events: [{ type: "TERMINATED", reason: "Repeated   absence" }],
  });
  // The registry shows the state and last day, never the private reason.
  const page = await settled(world, setup.employeesPage, { status: "FORMER" });
  expect(page.page).toHaveLength(1);
  expect(JSON.stringify(page)).not.toContain("absence");
});

it("[guess] S03-25 an employee links to at most one self-service account", async () => {
  const world = await fixture();
  const id = await hire(world, { userId: world.userA });
  expect(
    await call(world, setup.saveEmployee, {
      ...employeeArgs(world, "E002"),
      userId: world.userA,
      requestId: requestId(),
    }),
  ).toMatchObject({
    error: { code: "MEMBER_ALREADY_LINKED", field: "userId" },
  });
  // S03-23 is unknown: offboarding never disables the linked sign-in or roles.
  const access = () =>
    world.t.run(async (ctx) => ({
      users: await ctx.db.query("users").collect(),
      memberships: await ctx.db.query("memberships").collect(),
      roles: await ctx.db.query("membershipRoles").collect(),
    }));
  const accessBefore = await access();
  await lifecycle(world, id, {
    kind: "OFFBOARD",
    separationType: "RESIGNATION",
    effectiveDate: YESTERDAY,
    reason: "Resigned",
  });
  expect(await access()).toEqual(accessBefore);
  expect((await stored(world, id))?.userId).toBe(world.userA);
  // The link still blocks a second employee for the same account.
  expect(
    await call(world, setup.saveEmployee, {
      ...employeeArgs(world, "E003"),
      userId: world.userA,
      requestId: requestId(),
    }),
  ).toMatchObject({ error: { code: "MEMBER_ALREADY_LINKED" } });
});

it("an offboarded employee's earlier attendance stays readable to them and to HR", async () => {
  const world = await fixture();
  const id = await hire(world, { userId: world.userA });
  await world.t.run((ctx) =>
    ctx.db.insert("hrAttendanceDays", {
      orgId: world.orgA,
      warehouseId: world.warehouses.alphaA,
      employeeId: id,
      businessDate: "2026-10-01",
      plan: { kind: "NONWORKING", reason: "UNSCHEDULED", breakMinutes: 0 },
      open: false,
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  await lifecycle(world, id, {
    kind: "OFFBOARD",
    separationType: "RESIGNATION",
    effectiveDate: "2026-10-15",
    reason: "Resigned",
  });
  const history = await call(world, self.history, {
    from: "2026-10-01",
    to: "2026-10-02",
  });
  expect(JSON.stringify(history)).toContain("2026-10-01");
  expect(history.ok).toBe(true);
  const audit = await settled(world, setup.employeeHistoryPage, {
    employeeId: id,
  });
  expect(audit.page.length).toBeGreaterThan(0);
});

it("legacy employees without lifecycle fields keep their stored status and stay editable", async () => {
  const world = await fixture();
  const legacy = await world.t.run(async (ctx) => {
    const base = {
      orgId: world.orgA,
      warehouseId: world.warehouses.alphaA,
      employmentStartDate: "2024-01-01",
      version: 3,
      createdAt: 1,
      updatedAt: 1,
      createdByUserId: world.userA,
      updatedByUserId: world.userA,
    };
    return {
      active: await ctx.db.insert("hrEmployees", {
        ...base,
        code: "L001",
        displayName: "Legacy active",
        status: "ACTIVE",
      }),
      inactive: await ctx.db.insert("hrEmployees", {
        ...base,
        code: "L002",
        displayName: "Legacy inactive",
        status: "INACTIVE",
        employmentEndDate: "2025-12-31",
      }),
    };
  });
  expect(await registry(world)).toEqual([
    { code: "L001", employmentState: "ACTIVE" },
    { code: "L002", employmentState: "INACTIVE" },
  ]);
  expect(
    await call(world, profile.employeeProfile, { employeeId: legacy.active }),
  ).toEqual({ ok: true, profile: {}, version: 0 });
  expect(
    await call(world, profile.employeePayment, { employeeId: legacy.active }),
  ).toEqual({ ok: true, payment: null, version: 0 });
  expect(
    await call(world, setup.saveEmployee, {
      warehouseId: world.warehouses.alphaA,
      code: "L002",
      displayName: "Legacy inactive",
      employmentStartDate: "2024-01-01",
      employmentEndDate: "2025-12-31",
      status: "ACTIVE",
      employeeId: legacy.inactive,
      expectedVersion: 3,
      requestId: requestId(),
    }),
  ).toMatchObject({ written: true });
  // A legacy INACTIVE record can be offboarded to record why it ended.
  await call(world, setup.saveEmployee, {
    warehouseId: world.warehouses.alphaA,
    code: "L001",
    displayName: "Legacy active",
    employmentStartDate: "2024-01-01",
    status: "INACTIVE",
    employeeId: legacy.active,
    expectedVersion: 3,
    requestId: requestId(),
  });
  await lifecycle(world, legacy.active, {
    kind: "OFFBOARD",
    separationType: "RESIGNATION",
    effectiveDate: "2025-06-30",
    reason: "Recorded after migration",
  });
  expect(await registry(world, "FORMER")).toEqual([
    { code: "L001", employmentState: "RESIGNED" },
  ]);
  expect((await events(world))[0]).toMatchObject({
    fromState: "INACTIVE",
    toState: "RESIGNED",
  });
});

it("concurrent lifecycle and employee saves refuse the stale write and persist nothing", async () => {
  const world = await fixture();
  const id = await hire(world);
  // Both editors loaded version 1.
  await lifecycle(world, id, {
    kind: "OFFBOARD",
    separationType: "RESIGNATION",
    effectiveDate: YESTERDAY,
    reason: "Resigned",
    expectedVersion: 1,
  });
  const before = await snapshot(world);
  expect(
    await call(world, setup.saveEmployee, {
      ...employeeArgs(world),
      employeeId: id,
      expectedVersion: 1,
      requestId: requestId(),
    }),
  ).toMatchObject({ error: { code: "EMPLOYEE_STALE" } });
  expect(
    await lifecycle(world, id, {
      kind: "REINSTATE",
      effectiveDate: TODAY,
      reason: "Changed mind",
      expectedVersion: 1,
    }),
  ).toMatchObject({ error: { code: "EMPLOYEE_STALE" } });
  expect(await snapshot(world)).toEqual(before);
});

it("a lifecycle change waits while the employee's site has a staged period close in progress", async () => {
  const world = await fixture();
  const id = await hire(world, { probationEndDate: "2026-05-04" });
  const periodId = await world.t.run(async (ctx) =>
    ctx.db.insert("hrPeriods", {
      orgId: world.orgA,
      warehouseId: world.warehouses.alphaA,
      startDate: "2026-10-01",
      endDate: "2026-10-15",
      status: "CLOSING",
      draftVersion: 1,
      latestClosedVersion: 0,
      createdAt: NOW,
      createdByUserId: world.userA,
      updatedAt: NOW,
      updatedByUserId: world.userA,
    }),
  );
  const before = await snapshot(world);
  expect(
    await lifecycle(world, id, {
      kind: "OFFBOARD",
      separationType: "RESIGNATION",
      effectiveDate: YESTERDAY,
      reason: "Resigned",
    }),
  ).toMatchObject({ error: { code: "HR_PERIOD_CLOSING" } });
  expect(await snapshot(world)).toEqual(before);
  // Once the close is published the same change is accepted.
  await world.t.run((ctx) => ctx.db.patch(periodId, { status: "CLOSED" }));
  expect(
    await lifecycle(world, id, {
      kind: "CONFIRM_PROBATION",
      effectiveDate: TODAY,
    }),
  ).toMatchObject({ written: true });
});

it("personal, contact and emergency details validate, persist and never leak into the registry or audit", async () => {
  const world = await fixture();
  const id = await hire(world);
  const before = await snapshot(world);
  const save = (fields: Record<string, unknown>, expectedVersion = 0) =>
    call(world, profile.saveEmployeeProfile, {
      employeeId: id,
      expectedVersion,
      requestId: requestId(),
      ...fields,
    });
  for (const [fields, code, field] of [
    [
      { nationalId: "1234567890123" },
      "PROFILE_NATIONAL_ID_INVALID",
      "nationalId",
    ],
    [{ email: "not-mail" }, "PROFILE_EMAIL_INVALID", "email"],
    [{ phone: "call me" }, "PROFILE_PHONE_INVALID", "phone"],
    [{ postalCode: "1050" }, "PROFILE_POSTAL_CODE_INVALID", "postalCode"],
    [{ birthDate: TOMORROW }, "PROFILE_BIRTH_DATE_INVALID", "birthDate"],
    [
      { emergencyRelationship: "Mother" },
      "PROFILE_EMERGENCY_INCOMPLETE",
      "emergencyName",
    ],
    [
      { emergencyName: "Somsri" },
      "PROFILE_EMERGENCY_INCOMPLETE",
      "emergencyPhone",
    ],
    [{ nickname: "n".repeat(41) }, "PROFILE_TEXT_TOO_LONG", "nickname"],
  ] as const)
    expect(await save(fields)).toMatchObject({
      written: false,
      error: { code, field },
    });
  expect(await snapshot(world)).toEqual(before);

  const details = {
    title: "Ms",
    firstName: " Somchai ",
    lastName: "Jaidee",
    nickname: "Chai",
    gender: "FEMALE" as const,
    birthDate: "1995-02-14",
    nationalId: "1-1037-02071-56-1",
    nationality: "Thai",
    maritalStatus: "SINGLE" as const,
    email: "somchai@example.com",
    phone: "081-234-5678",
    lineId: "chai.line",
    address: "99 Example Road",
    province: "Bangkok",
    postalCode: "10500",
    emergencyName: "Somsri Jaidee",
    emergencyRelationship: "Mother",
    emergencyPhone: "+66 81 111 2222",
  };
  const retried = requestId();
  const first = await call(world, profile.saveEmployeeProfile, {
    ...details,
    employeeId: id,
    expectedVersion: 0,
    requestId: retried,
  });
  expect(first).toMatchObject({ written: true, replayed: false });
  expect(
    await call(world, profile.saveEmployeeProfile, {
      ...details,
      employeeId: id,
      expectedVersion: 0,
      requestId: retried,
    }),
  ).toMatchObject({ written: true, replayed: true });
  const read = await call(world, profile.employeeProfile, { employeeId: id });
  expect(read).toMatchObject({
    ok: true,
    version: 1,
    profile: {
      firstName: "Somchai",
      nationalId: "1103702071561",
      emergencyName: "Somsri Jaidee",
    },
  });
  // A second editor still holding version 0 cannot overwrite it.
  expect(await save({ firstName: "Other" })).toMatchObject({
    error: { code: "PROFILE_STALE" },
  });
  // Clearing a field removes it rather than storing an empty string.
  await save({ ...details, nickname: "  ", lineId: "" }, 1);
  const cleared = await call(world, profile.employeeProfile, {
    employeeId: id,
  });
  expect(cleared.profile.nickname).toBeUndefined();
  expect(cleared.profile.lineId).toBeUndefined();
  expect(cleared.version).toBe(2);
  // Only field names are audited; the registry carries none of the details.
  const audit = await world.t.run((ctx) =>
    ctx.db
      .query("auditEvents")
      .filter((q) => q.eq(q.field("action"), "hr.employee.profile.save"))
      .collect(),
  );
  const text = JSON.stringify([
    audit,
    await settled(world, setup.employeesPage, {}),
    await call(world, setup.employee, { employeeId: id }),
  ]);
  for (const secret of ["1103702071561", "Somsri", "081-234", "Jaidee"])
    expect(text).not.toContain(secret);
  expect(
    audit.find((row) => row.outcome === "ALLOWED")?.changes,
  ).toContainEqual({ field: "nationalId" });
});

it("payment details are private: bank fields validate, cash clears them and audit never stores values", async () => {
  const world = await fixture();
  const id = await hire(world, { userId: world.userA });
  const save = (fields: Record<string, unknown>, expectedVersion = 0) =>
    call(world, profile.saveEmployeePayment, {
      employeeId: id,
      expectedVersion,
      requestId: requestId(),
      ...fields,
    });
  expect(
    await save({ method: "BANK", accountNumber: "1234567890" }),
  ).toMatchObject({
    error: { code: "PAYMENT_BANK_REQUIRED", field: "bankName" },
  });
  expect(
    await save({
      method: "BANK",
      bankName: "Example Bank",
      accountNumber: "12-34",
    }),
  ).toMatchObject({
    error: { code: "PAYMENT_ACCOUNT_INVALID", field: "accountNumber" },
  });
  expect(
    await save({
      method: "BANK",
      bankName: "Example Bank",
      accountNumber: "123-4-56789-0",
      accountName: "Somchai Jaidee",
      bankBranchCode: "0012",
    }),
  ).toMatchObject({ written: true });
  expect(
    await call(world, profile.employeePayment, { employeeId: id }),
  ).toEqual({
    ok: true,
    version: 1,
    payment: {
      method: "BANK",
      bankName: "Example Bank",
      accountNumber: "1234567890",
      accountMasked: "•••• 7890",
      accountName: "Somchai Jaidee",
      bankBranchCode: "0012",
    },
  });
  await save(
    { method: "CASH", bankName: "Ignored", accountNumber: "999999" },
    1,
  );
  expect(
    await call(world, profile.employeePayment, { employeeId: id }),
  ).toEqual({ ok: true, version: 2, payment: { method: "CASH" } });
  const leaks = JSON.stringify([
    await world.t.run((ctx) => ctx.db.query("auditEvents").collect()),
    await world.t.run((ctx) => ctx.db.query("idempotencyRecords").collect()),
    await settled(world, setup.employeesPage, {}),
    await call(world, setup.listEmployees, {}),
    await call(world, setup.employee, { employeeId: id }),
    // The employee's own self-service views never include payment details.
    await call(world, self.today, {}),
  ]);
  expect(leaks).not.toContain("1234567890");
  expect(leaks).not.toContain("Example Bank");
});

it("tenant, site and permission restrictions apply to every profile, payment and lifecycle function", async () => {
  const world = await fixture();
  const id = await hire(world);
  const hidden = await world.t.run((ctx) =>
    ctx.db.insert("hrEmployees", {
      ...employeeArgs(world, "HIDDEN"),
      orgId: world.orgA,
      warehouseId: world.warehouses.bravoA,
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
      createdByUserId: world.userA,
      updatedByUserId: world.userA,
    }),
  );
  const foreign = (
    await call(
      world,
      setup.saveEmployee,
      {
        ...employeeArgs(world, "B001"),
        warehouseId: world.warehouses.alphaB,
        requestId: requestId(),
      },
      TENANT_B,
    )
  ).documentId as Id<"hrEmployees">;
  const before = await snapshot(world);
  const writes = (employeeId: Id<"hrEmployees">) =>
    [
      [
        profile.saveEmployeeProfile,
        { employeeId, expectedVersion: 0, firstName: "X" },
      ],
      [
        profile.saveEmployeePayment,
        { employeeId, expectedVersion: 0, method: "CASH" },
      ],
      [
        profile.recordEmploymentEvent,
        {
          employeeId,
          expectedVersion: 1,
          kind: "OFFBOARD",
          separationType: "RESIGNATION",
          effectiveDate: YESTERDAY,
          reason: "Not allowed",
        },
      ],
    ] as const;
  const reads = [
    profile.employeeProfile,
    profile.employeePayment,
    profile.employeeLifecycle,
  ];
  // Outside the administrator's site scope, and in another organization.
  for (const target of [hidden, foreign]) {
    for (const fn of reads)
      expect(await call(world, fn, { employeeId: target })).toEqual({
        ok: false,
        code: "NOT_FOUND",
      });
    for (const [fn, args] of writes(target))
      expect(
        await call(world, fn as never, { ...args, requestId: requestId() }),
      ).toMatchObject({ written: false, error: { code: "NOT_FOUND" } });
  }
  // A member without HR administration is denied before any read or write.
  const actor = await seedSecondActorForOrgA(world, "HR_EMPLOYEE");
  const employeeIdentity = { ...ADMIN, subject: actor.clerkUserId };
  for (const fn of reads)
    expect(
      await raw(world, fn, { employeeId: id }, employeeIdentity),
    ).toMatchObject({ ok: false, denial: { kind: "AUTHORIZATION_DENIED" } });
  for (const [fn, args] of writes(id))
    expect(
      await raw(
        world,
        fn as never,
        { ...args, requestId: requestId() } as never,
        employeeIdentity,
      ),
    ).toMatchObject({ ok: false, denial: { kind: "AUTHORIZATION_DENIED" } });
  const after = await snapshot(world);
  expect(after).toEqual(before);
  // Tenant B's administrator cannot read tenant A's employee either.
  expect(
    await call(world, profile.employeeProfile, { employeeId: id }, TENANT_B),
  ).toEqual({ ok: false, code: "NOT_FOUND" });
});

it("callers that omit slice-03 fields never erase them; only an explicit empty value clears", async () => {
  const world = await fixture();
  const id = await hire(world, { probationEndDate: "2026-05-04" });
  await lifecycle(world, id, {
    kind: "CONFIRM_PROBATION",
    effectiveDate: "2026-05-04",
  });
  // An older editor's payload knows nothing about the lifecycle fields.
  await call(world, setup.saveEmployee, {
    ...employeeArgs(world),
    displayName: "Renamed by an older tab",
    probationEndDate: "2026-05-04",
    employeeId: id,
    expectedVersion: 2,
    requestId: requestId(),
  });
  expect(await stored(world, id)).toMatchObject({
    displayName: "Renamed by an older tab",
    probationConfirmedDate: "2026-05-04",
  });

  const saveProfile = (
    fields: Record<string, unknown>,
    expectedVersion: number,
  ) =>
    call(world, profile.saveEmployeeProfile, {
      employeeId: id,
      expectedVersion,
      requestId: requestId(),
      ...fields,
    });
  await saveProfile(
    {
      firstName: "Somchai",
      gender: "MALE",
      emergencyName: "Somsri",
      emergencyPhone: "081 111 2222",
    },
    0,
  );
  // A contact-only save keeps the personal fields and the emergency contact.
  await saveProfile({ phone: "02 123 4567" }, 1);
  expect(
    (await call(world, profile.employeeProfile, { employeeId: id })).profile,
  ).toEqual({
    firstName: "Somchai",
    gender: "MALE",
    phone: "02 123 4567",
    emergencyName: "Somsri",
    emergencyPhone: "081 111 2222",
  });
  // Clearing is explicit, and validation sees the merged record.
  expect(await saveProfile({ emergencyPhone: "" }, 2)).toMatchObject({
    error: { code: "PROFILE_EMERGENCY_INCOMPLETE", field: "emergencyPhone" },
  });
  await saveProfile({ gender: "", emergencyName: "", emergencyPhone: "" }, 2);
  expect(
    (await call(world, profile.employeeProfile, { employeeId: id })).profile,
  ).toEqual({ firstName: "Somchai", phone: "02 123 4567" });

  const savePayment = (
    fields: Record<string, unknown>,
    expectedVersion: number,
  ) =>
    call(world, profile.saveEmployeePayment, {
      employeeId: id,
      expectedVersion,
      requestId: requestId(),
      ...fields,
    });
  await savePayment(
    {
      method: "BANK",
      bankName: "Example Bank",
      accountNumber: "1234567890",
      accountName: "Somchai",
      bankBranchCode: "0012",
    },
    0,
  );
  await savePayment({ method: "BANK", bankName: "Other Bank" }, 1);
  expect(
    (await call(world, profile.employeePayment, { employeeId: id })).payment,
  ).toMatchObject({
    bankName: "Other Bank",
    accountNumber: "1234567890",
    accountName: "Somchai",
    bankBranchCode: "0012",
  });
  await savePayment({ method: "BANK", bankBranchCode: "" }, 2);
  expect(
    (await call(world, profile.employeePayment, { employeeId: id })).payment,
  ).not.toHaveProperty("bankBranchCode");
});
