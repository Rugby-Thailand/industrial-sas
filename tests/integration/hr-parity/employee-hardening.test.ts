import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { FunctionReference } from "convex/server";
import type { Id } from "../../../convex/_generated/dataModel";
import type { TenantFunctionOutcome } from "../../../convex/lib/tenantFunctions";
import { api } from "../../../convex/_generated/api";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  seedSecondActorForOrgA,
  type ConvexTenantWorld,
} from "../../fixtures/convex-tenant-world";
const IDENTITY = { subject: "user_fixture_a", org_id: "org_fixture_a" };
let n = 0;
const requestId = () => `employee-hardening-${++n}`;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 20, 3));
});
afterEach(() => vi.useRealTimers());
async function fixture() {
  const w = await createConvexTenantWorld({
    "../convex/hr/setup.ts": () => import("../../../convex/hr/setup"),
    "../convex/hr/employeeProfile.ts": () =>
      import("../../../convex/hr/employeeProfile"),
    "../convex/hr/org.ts": () => import("../../../convex/hr/org"),
    "../convex/hr/policies.ts": () => import("../../../convex/hr/policies"),
    "../convex/hr/announcements.ts": () =>
      import("../../../convex/hr/announcements"),
    "../convex/hr/periods.ts": () => import("../../../convex/hr/periods"),
    "../convex/hr/periodClose.ts": () =>
      import("../../../convex/hr/periodClose"),
    "../convex/hr/recovery.ts": () => import("../../../convex/hr/recovery"),
    "../convex/hr/self.ts": () => import("../../../convex/hr/self"),
    "../convex/hr/leave.ts": () => import("../../../convex/hr/leave"),
    "../convex/hr/payslips.ts": () => import("../../../convex/hr/payslips"),
    "../convex/hr/search.ts": () => import("../../../convex/hr/search"),
  });
  await seedConvexAuthorization(w, { roleA: "HR_ADMIN", roleB: "HR_ADMIN" });
  return w;
}
async function mutation(
  w: ConvexTenantWorld,
  fn: FunctionReference<"mutation">,
  args: object,
): Promise<any> {
  const r = (await w.t
    .withIdentity(IDENTITY)
    .mutation(fn, args as never)) as TenantFunctionOutcome<any>;
  expect(r.ok, JSON.stringify(r)).toBe(true);
  if (!r.ok) throw new Error("Unexpected authorization denial");
  return r.value;
}
async function query(
  w: ConvexTenantWorld,
  fn: FunctionReference<"query">,
  args: object,
): Promise<any> {
  const r = (await w.t
    .withIdentity(IDENTITY)
    .query(fn, args as never)) as TenantFunctionOutcome<any>;
  expect(r.ok, JSON.stringify(r)).toBe(true);
  if (!r.ok) throw new Error("Unexpected authorization denial");
  return r.value;
}
const draft = (w: ConvexTenantWorld) => ({
  warehouseId: w.warehouses.alphaA,
  code: "E001",
  displayName: "Probe Employee",
  employmentStartDate: "2026-01-05",
  status: "ACTIVE",
});
async function hire(
  w: ConvexTenantWorld,
  extra = {},
): Promise<Id<"hrEmployees">> {
  const r = await mutation(w, api.hr.setup.saveEmployee, {
    ...draft(w),
    ...extra,
    requestId: requestId(),
  });
  expect(r.written).toBe(true);
  return r.documentId as Id<"hrEmployees">;
}
async function event(
  w: ConvexTenantWorld,
  id: Id<"hrEmployees">,
  kind: string,
  date: string,
  extra = {},
) {
  const employee = await w.t.run((ctx) => ctx.db.get(id));
  return mutation(w, api.hr.employeeProfile.recordEmploymentEvent, {
    employeeId: id,
    expectedVersion: employee!.version,
    requestId: requestId(),
    kind,
    effectiveDate: date,
    reason: "Hardening scenario",
    ...(kind === "OFFBOARD" ? { separationType: "RESIGNATION" } : {}),
    ...extra,
  });
}
it("hardening R1 refuses exit before already-recorded confirmation", async () => {
  const w = await fixture();
  const id = await hire(w, { probationEndDate: "2026-10-18" });
  expect((await event(w, id, "CONFIRM_PROBATION", "2026-10-18")).written).toBe(
    true,
  );
  const r = await event(w, id, "OFFBOARD", "2026-09-30");
  expect(r.written).toBe(false);
});
it("hardening R1b refuses second exit before reinstatement", async () => {
  const w = await fixture();
  const id = await hire(w);
  await event(w, id, "OFFBOARD", "2026-09-30");
  await event(w, id, "REINSTATE", "2026-10-19");
  const r = await event(w, id, "OFFBOARD", "2026-10-01");
  expect(r.written).toBe(false);
});
it("hardening R2 reinstatement enforces live org assignment invariant", async () => {
  const w = await fixture();
  const id = await hire(w);
  await event(w, id, "OFFBOARD", "2026-09-30");
  await w.t.run(async (ctx) => {
    for (const table of ["hrDepartments", "hrPositions"] as const) {
      await ctx.db.insert(table, {
        orgId: w.orgA,
        name: "Now configured",
        nameKey: "now configured",
        status: "ACTIVE",
        version: 1,
        createdAt: 1,
        createdByUserId: w.userA,
        updatedAt: 1,
        updatedByUserId: w.userA,
      });
    }
  });
  const other = await hire(w, { status: "INACTIVE", code: "CONTROL" });
  const e = await w.t.run((ctx) => ctx.db.get(other));
  const normal = await mutation(w, api.hr.setup.saveEmployee, {
    ...draft(w),
    code: "CONTROL",
    employeeId: other,
    expectedVersion: e!.version,
    requestId: requestId(),
  });
  expect(normal.error.code).toBe("DEPARTMENT_REQUIRED");
  const r = await event(w, id, "REINSTATE", "2026-10-19");
  expect(r.written).toBe(false);
});
it("hardening R4 main save cannot invalidate confirmed employment start", async () => {
  const w = await fixture();
  const id = await hire(w, { probationEndDate: "2026-05-04" });
  await event(w, id, "CONFIRM_PROBATION", "2026-05-04");
  const r = await mutation(w, api.hr.setup.saveEmployee, {
    ...draft(w),
    employeeId: id,
    expectedVersion: 2,
    requestId: requestId(),
    probationEndDate: "2026-12-31",
    employmentStartDate: "2026-10-01",
  });
  expect(r.written).toBe(false);
});

it("hardening R5 reinstatement excludes the separation gap from live attendance period", async () => {
  const w = await fixture();
  const id = await hire(w, {
    schedule: {
      workDays: [1, 2, 3, 4, 5],
      startTime: "09:00",
      endTime: "18:00",
      endsNextDay: false,
      breakMinutes: 60,
    },
  });
  await event(w, id, "OFFBOARD", "2026-09-30");
  const created = await mutation(w, api.hr.periods.create, {
    warehouseId: w.warehouses.alphaA,
    startDate: "2026-10-05",
    endDate: "2026-10-05",
    requestId: requestId(),
  });
  expect(created.written).toBe(true);
  const before = await query(w, api.hr.periods.preview, {
    periodId: created.documentId,
  });
  await event(w, id, "REINSTATE", "2026-10-19");
  const after = await query(w, api.hr.periods.preview, {
    periodId: created.documentId,
  });
  expect(before.view.rows).toEqual([]);
  expect(after.view.rows).toEqual(before.view.rows);
});

it("hardening R6 new command recovery is supported after document reload", async () => {
  const w = await fixture();
  const id = await hire(w);
  const args = {
    employeeId: id,
    expectedVersion: 0,
    method: "CASH" as const,
    requestId: requestId(),
  };
  await mutation(w, api.hr.employeeProfile.saveEmployeePayment, args);
  const r = await mutation(w, api.hr.recovery.reconcileRequest, {
    operation: "hr.employee.payment.save",
    requestId: args.requestId,
  });
  expect(r.resolved).toBe(true);
});

it("hardening controls same-version lifecycle conflict, profile independence, omitted end protection, and idempotency", async () => {
  const w = await fixture();
  const id = await hire(w);
  const changes = await Promise.all([
    event(w, id, "OFFBOARD", "2026-10-19", { expectedVersion: 1 }),
    mutation(w, api.hr.setup.saveEmployee, {
      ...draft(w),
      employeeId: id,
      expectedVersion: 1,
      displayName: "Concurrent edit",
      requestId: requestId(),
    }),
    mutation(w, api.hr.employeeProfile.saveEmployeeProfile, {
      employeeId: id,
      expectedVersion: 0,
      nickname: "Independent",
      requestId: requestId(),
    }),
  ]);
  expect(changes.filter((r: any) => r.written)).toHaveLength(2);
  expect(
    (await query(w, api.hr.employeeProfile.employeeProfile, { employeeId: id }))
      .profile.nickname,
  ).toBe("Independent");
  const current = await w.t.run((ctx) => ctx.db.get(id));
  if (!current!.separation) await event(w, id, "OFFBOARD", "2026-10-19");
  const e = await w.t.run((ctx) => ctx.db.get(id));
  const omitted = await mutation(w, api.hr.setup.saveEmployee, {
    ...draft(w),
    employeeId: id,
    expectedVersion: e!.version,
    status: "INACTIVE",
    requestId: requestId(),
  });
  expect(omitted.error.code).toBe("EMPLOYEE_SEPARATED");
  const args = {
    employeeId: id,
    expectedVersion: 0,
    method: "BANK",
    bankName: "Private bank",
    accountNumber: "1234567890",
    requestId: requestId(),
  };
  expect(
    (await mutation(w, api.hr.employeeProfile.saveEmployeePayment, args))
      .written,
  ).toBe(true);
  expect(
    (await mutation(w, api.hr.employeeProfile.saveEmployeePayment, args))
      .replayed,
  ).toBe(true);
  expect(
    (
      await mutation(w, api.hr.employeeProfile.saveEmployeePayment, {
        ...args,
        accountNumber: "9999999999",
      })
    ).written,
  ).toBe(false);
  const conflict = await Promise.all([
    mutation(w, api.hr.employeeProfile.saveEmployeePayment, {
      employeeId: id,
      expectedVersion: 1,
      method: "CASH" as const,
      requestId: requestId(),
    }),
    mutation(w, api.hr.employeeProfile.saveEmployeePayment, {
      employeeId: id,
      expectedVersion: 1,
      method: "CASH" as const,
      requestId: requestId(),
    }),
  ]);
  expect(conflict.filter((r: any) => r.written)).toHaveLength(1);
  expect(conflict.find((r: any) => !r.written).error.code).toBe(
    "PAYMENT_STALE",
  );
});

it("hardening control Bangkok midnight uses organization date", async () => {
  const w = await fixture();
  const id = await hire(w);
  vi.setSystemTime(Date.UTC(2026, 9, 19, 16, 59));
  expect((await event(w, id, "OFFBOARD", "2026-10-19")).error.code).toBe(
    "LIFECYCLE_LAST_DAY_NOT_PAST",
  );
  vi.setSystemTime(Date.UTC(2026, 9, 19, 17));
  expect((await event(w, id, "OFFBOARD", "2026-10-19")).written).toBe(true);
});

it("hardening control HR permission revocation blocks new writes and replay", async () => {
  const w = await fixture();
  const id = await hire(w);
  const args = {
    employeeId: id,
    expectedVersion: 0,
    method: "CASH" as const,
    requestId: requestId(),
  };
  await mutation(w, api.hr.employeeProfile.saveEmployeePayment, args);
  await w.t.run(async (ctx) => {
    const rows = await ctx.db.query("membershipRoles").collect();
    for (const row of rows)
      if (row.orgId === w.orgA) await ctx.db.delete(row._id);
  });
  const replay = await w.t
    .withIdentity(IDENTITY)
    .mutation(api.hr.employeeProfile.saveEmployeePayment, args);
  expect(replay.ok).toBe(false);
  const read = await w.t
    .withIdentity(IDENTITY)
    .query(api.hr.employeeProfile.employeePayment, { employeeId: id });
  expect(read.ok).toBe(false);
});

it("hardening control historical leave/payslip access survives offboarding and payment stays absent from consumers", async () => {
  const w = await fixture();
  const id = await hire(w, { userId: w.userA });
  const { thailandDefaults } = await import("../../../convex/model/hr/policy");
  await w.t.run(async (ctx) => {
    const config = thailandDefaults();
    const policy = await ctx.db.insert("hrPolicyVersions", {
      orgId: w.orgA,
      capability: "PAYSLIPS",
      config,
      effectiveDate: "2026-01-01",
      version: 1,
      draftVersion: 1,
      preset: "test",
      coverageConfirmed: true,
      existingBenefitsReviewed: true,
      activatedAt: 1,
      activatedByUserId: w.userA,
    });
    await ctx.db.insert("hrLeaveRequests", {
      orgId: w.orgA,
      employeeId: id,
      warehouseId: w.warehouses.alphaA,
      type: "ANNUAL",
      from: "2026-09-01",
      to: "2026-09-01",
      dates: ["2026-09-01"],
      days: 1,
      paidDays: 1,
      payPercent: 100,
      reason: "Historical leave",
      policyVersionId: policy,
      policyConfig: config,
      daySnapshots: [],
      status: "APPROVED",
      version: 1,
      history: [],
      submittedAt: 1,
      updatedAt: 1,
    });
    const imported = await ctx.db.insert("hrPayslipImports", {
      orgId: w.orgA,
      from: "2026-09-01",
      to: "2026-09-30",
      sourceName: "test",
      sourceCsv: "test",
      sourceHash: "test",
      policyVersionId: policy,
      status: "PUBLISHED",
      rowCount: 1,
      createdAt: 1,
      createdByUserId: w.userA,
      publishedAt: 1,
    });
    await ctx.db.insert("hrPayslipRows", {
      orgId: w.orgA,
      importId: imported,
      employeeId: id,
      warehouseId: w.warehouses.alphaA,
      employeeCode: "E001",
      employeeName: "Probe Employee",
      from: "2026-09-01",
      to: "2026-09-30",
      paymentDate: "2026-09-30",
      gross: 300,
      deductions: 0,
      net: 300,
      sourceBase64: "PRIVATE_SOURCE",
      sourceHash: "test",
      version: 1,
      publishedAt: 1,
    });
  });
  await mutation(w, api.hr.employeeProfile.saveEmployeePayment, {
    employeeId: id,
    expectedVersion: 0,
    method: "BANK",
    bankName: "SENTINEL_BANK",
    accountNumber: "12345678901234",
    accountName: "SENTINEL_OWNER",
    requestId: requestId(),
  });
  const historical = async () => ({
    leave: await query(w, api.hr.leave.history, {
      paginationOpts: { cursor: null, numItems: 20 },
    }),
    payslip: await query(w, api.hr.payslips.list, {}),
  });
  const before = await historical();
  expect(before.leave.page).toHaveLength(1);
  expect(before.payslip.items).toHaveLength(1);
  await event(w, id, "OFFBOARD", "2026-09-30");
  const after = await historical();
  expect(after).toEqual(before);
  const consumers = [
    after,
    await query(w, api.hr.setup.employeesPage, { status: "ALL" }),
    await query(w, api.hr.setup.listEmployees, {}),
    await query(w, api.hr.setup.employee, { employeeId: id }),
    await query(w, api.hr.search.adminEmployees, { text: "Probe" }),
    await query(w, api.hr.self.today, {}),
    await w.t.run((ctx) => ctx.db.query("auditEvents").collect()),
    await w.t.run((ctx) => ctx.db.query("idempotencyRecords").collect()),
  ];
  const serialized = JSON.stringify(consumers);
  for (const secret of [
    "SENTINEL_BANK",
    "SENTINEL_OWNER",
    "12345678901234",
    "PRIVATE_SOURCE",
  ])
    expect(serialized).not.toContain(secret);
});

it("hardening R7 last-day overnight shift remains clockable after midnight", async () => {
  const w = await fixture();
  const id = await hire(w, {
    userId: w.userA,
    schedule: {
      workDays: [1, 2, 3, 4, 5, 6, 7],
      startTime: "22:00",
      endTime: "06:00",
      endsNextDay: true,
      breakMinutes: 0,
    },
  });
  vi.setSystemTime(Date.UTC(2026, 9, 19, 15));
  const start = await mutation(w, api.hr.self.clockIn, {
    requestId: requestId(),
    expectedBusinessDate: "2026-10-19",
  });
  expect(start.written).toBe(true);
  vi.setSystemTime(Date.UTC(2026, 9, 19, 17, 1));
  const exit = await event(w, id, "OFFBOARD", "2026-10-19");
  vi.setSystemTime(Date.UTC(2026, 9, 19, 23));
  const end = await mutation(w, api.hr.self.clockOut, {
    requestId: requestId(),
    expectedBusinessDate: "2026-10-19",
  });
  expect(exit).toMatchObject({
    written: false,
    error: { code: "LIFECYCLE_OPEN_SHIFT" },
  });
  expect(end.written).toBe(true);
  const day = await w.t.run((ctx) => ctx.db.query("hrAttendanceDays").first());
  expect(day).toMatchObject({
    open: false,
    businessDate: "2026-10-19",
    clockOutAt: Date.UTC(2026, 9, 19, 23),
  });
  expect((await event(w, id, "OFFBOARD", "2026-10-19")).written).toBe(true);
});

it("repeated employment intervals keep pre-exit history and frozen outputs while gaps reject live attendance and leave", async () => {
  const w = await fixture();
  const id = await hire(w, { userId: w.userA });
  // Freeze a real closed period before changing employment. No schedule means
  // a closeable nonworking row, without fabricated attendance or settlement.
  const period = await mutation(w, api.hr.periods.create, {
    requestId: requestId(),
    warehouseId: w.warehouses.alphaA,
    startDate: "2026-09-01",
    endDate: "2026-09-01",
  });
  const preview = await query(w, api.hr.periods.preview, {
    periodId: period.documentId,
  });
  expect(
    (
      await mutation(w, api.hr.periodClose.begin, {
        requestId: requestId(),
        periodId: period.documentId,
        expectedFingerprint: preview.view.fingerprint,
      })
    ).written,
  ).toBe(true);
  const frozen = await query(w, api.hr.periods.preview, {
    periodId: period.documentId,
  });
  await event(w, id, "OFFBOARD", "2026-09-01");
  await event(w, id, "REINSTATE", "2026-09-10");
  await event(w, id, "OFFBOARD", "2026-09-20");
  await event(w, id, "REINSTATE", "2026-10-19");
  const employee = await w.t.run((ctx) => ctx.db.get(id));
  expect(employee).toMatchObject({
    employmentStartDate: "2026-01-05",
    employmentIntervals: [
      { startDate: "2026-01-05", endDate: "2026-09-01" },
      { startDate: "2026-09-10", endDate: "2026-09-20" },
      { startDate: "2026-10-19" },
    ],
  });
  expect(
    await query(w, api.hr.periods.preview, { periodId: period.documentId }),
  ).toEqual(frozen);
  const history = await query(w, api.hr.self.history, {
    from: "2026-09-01",
    to: "2026-09-30",
  });
  const serialized = JSON.stringify(history);
  expect(serialized).toContain("2026-09-01");
  expect(serialized).toContain("2026-09-10");
  // Read the actual returned rows, not top-level query date bounds.
  expect(
    history.rows
      .map((row: { businessDate: string }) => row.businessDate)
      .sort(),
  ).toEqual([
    "2026-09-01",
    ...Array.from({ length: 11 }, (_, i) => `2026-09-${i + 10}`),
  ]);
  // Backdate the test clock into a gap: current ACTIVE alone must not permit
  // a clock-in or a fresh sick leave request for that date.
  vi.setSystemTime(Date.UTC(2026, 9, 5, 3));
  expect(
    await mutation(w, api.hr.self.clockIn, {
      requestId: requestId(),
      expectedBusinessDate: "2026-10-05",
    }),
  ).toMatchObject({ written: false, error: { code: "HR_OUTSIDE_EMPLOYMENT" } });
  const { thailandDefaults } = await import("../../../convex/model/hr/policy");
  await w.t.run((ctx) =>
    ctx.db.insert("hrPolicyVersions", {
      orgId: w.orgA,
      capability: "LEAVE",
      config: thailandDefaults(),
      effectiveDate: "2026-01-01",
      version: 1,
      draftVersion: 1,
      preset: "test",
      coverageConfirmed: true,
      existingBenefitsReviewed: true,
      activatedAt: 1,
      activatedByUserId: w.userA,
    }),
  );
  expect(
    await query(w, api.hr.leave.preview, {
      type: "SICK",
      from: "2026-10-05",
      to: "2026-10-05",
      reason: "Illness",
    }),
  ).toMatchObject({ ok: false, code: "HR_OUTSIDE_EMPLOYMENT" });
});

it("main legacy and replacement saves retain interval gaps and cannot move probation or end beyond recorded chronology", async () => {
  const w = await fixture();
  const id = await hire(w, { probationEndDate: "2026-05-04" });
  await event(w, id, "CONFIRM_PROBATION", "2026-05-04");
  const badProbation = await mutation(w, api.hr.setup.saveEmployee, {
    ...draft(w),
    employeeId: id,
    expectedVersion: 2,
    requestId: requestId(),
    probationEndDate: "2026-12-31",
  });
  expect(badProbation).toMatchObject({
    written: false,
    error: {
      code: "PROBATION_END_AFTER_CONFIRMATION",
      field: "probationEndDate",
    },
  });
  await event(w, id, "OFFBOARD", "2026-09-30");
  await event(w, id, "REINSTATE", "2026-10-19");
  for (const replaceOrgFields of [undefined, true]) {
    const before = await w.t.run((ctx) => ctx.db.get(id));
    expect(
      (
        await mutation(w, api.hr.setup.saveEmployee, {
          ...draft(w),
          ...(replaceOrgFields ? { replaceOrgFields } : {}),
          employeeId: id,
          expectedVersion: before!.version,
          requestId: requestId(),
          displayName: "Retained history",
        })
      ).written,
    ).toBe(true);
    expect(
      (await w.t.run((ctx) => ctx.db.get(id)))!.employmentIntervals,
    ).toEqual(before!.employmentIntervals);
  }
  const current = await w.t.run((ctx) => ctx.db.get(id));
  expect(
    await mutation(w, api.hr.setup.saveEmployee, {
      ...draft(w),
      employeeId: id,
      expectedVersion: current!.version,
      requestId: requestId(),
      employmentEndDate: "2026-10-18",
    }),
  ).toMatchObject({
    written: false,
    error: { code: "EMPLOYMENT_END_BEFORE_EVENT" },
  });
});

it("reinstatement validates org references and succeeds after inactive assignments are saved without losing the replacement protocol", async () => {
  const w = await fixture();
  const id = await hire(w);
  await event(w, id, "OFFBOARD", "2026-09-30");
  const fields = await w.t.run(async (ctx) => {
    const base = {
      orgId: w.orgA,
      status: "ACTIVE" as const,
      version: 1,
      createdAt: 1,
      createdByUserId: w.userA,
      updatedAt: 1,
      updatedByUserId: w.userA,
    };
    return {
      departmentId: await ctx.db.insert("hrDepartments", {
        ...base,
        name: "Department",
        nameKey: "department",
      }),
      positionId: await ctx.db.insert("hrPositions", {
        ...base,
        name: "Position",
        nameKey: "position",
      }),
    };
  });
  const before = await w.t.run((ctx) => ctx.db.get(id));
  expect(await event(w, id, "REINSTATE", "2026-10-19")).toMatchObject({
    written: false,
    error: { code: "DEPARTMENT_REQUIRED" },
  });
  expect(await w.t.run((ctx) => ctx.db.get(id))).toEqual(before);
  // Actual UI protocol: edit the separated INACTIVE employee, retain last day,
  // explicitly replace the org group, then retry the lifecycle command.
  expect(
    (
      await mutation(w, api.hr.setup.saveEmployee, {
        ...draft(w),
        ...fields,
        employeeId: id,
        expectedVersion: before!.version,
        status: "INACTIVE",
        employmentEndDate: "2026-09-30",
        replaceOrgFields: true,
        requestId: requestId(),
      })
    ).written,
  ).toBe(true);
  const assigned = await w.t.run((ctx) => ctx.db.get(id));
  // A legacy edit omits those assignments and must preserve them.
  expect(
    (
      await mutation(w, api.hr.setup.saveEmployee, {
        ...draft(w),
        employeeId: id,
        expectedVersion: assigned!.version,
        status: "INACTIVE",
        employmentEndDate: "2026-09-30",
        requestId: requestId(),
      })
    ).written,
  ).toBe(true);
  expect((await event(w, id, "REINSTATE", "2026-10-19")).written).toBe(true);
  expect(await w.t.run((ctx) => ctx.db.get(id))).toMatchObject({
    ...fields,
    status: "ACTIVE",
  });
});

const recoverableCommands = [
  {
    operation: "hr.employee.profile.save",
    fn: api.hr.employeeProfile.saveEmployeeProfile,
    fields: { expectedVersion: 0, nickname: "Private nickname" },
  },
  {
    operation: "hr.employee.payment.save",
    fn: api.hr.employeeProfile.saveEmployeePayment,
    fields: {
      expectedVersion: 0,
      method: "BANK",
      bankName: "Private bank",
      accountNumber: "1234567890",
    },
  },
  {
    operation: "hr.employee.lifecycle",
    fn: api.hr.employeeProfile.recordEmploymentEvent,
    fields: {
      expectedVersion: 1,
      kind: "OFFBOARD",
      effectiveDate: "2026-09-30",
      separationType: "RESIGNATION",
      reason: "Private reason",
    },
  },
];
it.each(recoverableCommands)(
  "$operation registered recovery returns status only for COMMITTED and fences requests that never reached the server",
  async ({ operation, fn, fields }) => {
    const w = await fixture();
    const id = await hire(w);
    const absent = requestId();
    expect(
      await mutation(w, api.hr.recovery.reconcileRequest, {
        operation,
        requestId: absent,
      }),
    ).toEqual({ resolved: true, status: "FENCED" });
    expect(
      await mutation(w, fn, { ...fields, employeeId: id, requestId: absent }),
    ).toMatchObject({ written: false, error: { code: "REQUEST_RETIRED" } });
    const command = { ...fields, employeeId: id, requestId: requestId() };
    expect((await mutation(w, fn, command)).written).toBe(true);
    expect(
      await mutation(w, api.hr.recovery.reconcileRequest, {
        operation,
        requestId: command.requestId,
      }),
    ).toEqual({ resolved: true, status: "COMMITTED" });
    expect((await mutation(w, fn, command)).replayed).toBe(true);
    const actor = await seedSecondActorForOrgA(w, "HR_ADMIN");
    expect(
      await w.t
        .withIdentity({ subject: actor.clerkUserId, org_id: IDENTITY.org_id })
        .mutation(api.hr.recovery.reconcileRequest, {
          operation,
          requestId: command.requestId,
        }),
    ).toMatchObject({
      ok: true,
      value: { resolved: false, code: "NOT_FOUND" },
    });
    // Tenant fencing cannot reveal this actor's request in another tenant.
    const other = await w.t
      .withIdentity({ ...IDENTITY, org_id: "org_fixture_b" })
      .mutation(api.hr.recovery.reconcileRequest, {
        operation,
        requestId: command.requestId,
      });
    expect(other).toMatchObject({
      ok: true,
      value: { resolved: true, status: "FENCED" },
    });
  },
);

it("offboarding refuses stale employee versions and permits a normally closed daytime shift", async () => {
  const w = await fixture();
  const id = await hire(w, {
    userId: w.userA,
    schedule: {
      workDays: [1, 2, 3, 4, 5, 6, 7],
      startTime: "09:00",
      endTime: "18:00",
      endsNextDay: false,
      breakMinutes: 0,
    },
  });
  vi.setSystemTime(Date.UTC(2026, 9, 19, 2));
  expect(
    (
      await mutation(w, api.hr.self.clockIn, {
        requestId: requestId(),
        expectedBusinessDate: "2026-10-19",
      })
    ).written,
  ).toBe(true);
  vi.setSystemTime(Date.UTC(2026, 9, 19, 11));
  expect(
    (
      await mutation(w, api.hr.self.clockOut, {
        requestId: requestId(),
        expectedBusinessDate: "2026-10-19",
      })
    ).written,
  ).toBe(true);
  vi.setSystemTime(Date.UTC(2026, 9, 19, 17, 1));
  const before = await w.t.run((ctx) => ctx.db.get(id));
  expect(
    await event(w, id, "OFFBOARD", "2026-10-19", { expectedVersion: 0 }),
  ).toMatchObject({ written: false, error: { code: "EMPLOYEE_STALE" } });
  expect(await w.t.run((ctx) => ctx.db.get(id))).toEqual(before);
  expect((await event(w, id, "OFFBOARD", "2026-10-19")).written).toBe(true);
});

it("registered policy readiness/opening and announcement audience eligibility exclude separation gaps", async () => {
  const w = await fixture();
  const id = await hire(w);
  await event(w, id, "OFFBOARD", "2026-09-30");
  await event(w, id, "REINSTATE", "2026-10-19");
  const { thailandDefaults } = await import("../../../convex/model/hr/policy");
  const draftId = await w.t.run(async (ctx) => {
    const membership = (await ctx.db.query("memberships").collect()).find(
      (row) => row.orgId === w.orgA && row.userId === w.userA,
    )!;
    await ctx.db.patch(membership._id, { scopeMode: "ORG_WIDE" });
    await ctx.db.insert("hrPolicyVersions", {
      orgId: w.orgA,
      capability: "ANNOUNCEMENTS",
      config: thailandDefaults(),
      effectiveDate: "2026-01-01",
      version: 1,
      draftVersion: 1,
      preset: "test",
      coverageConfirmed: true,
      existingBenefitsReviewed: true,
      activatedAt: 1,
      activatedByUserId: w.userA,
    });
    return ctx.db.insert("hrPolicyDrafts", {
      orgId: w.orgA,
      capability: "LEAVE",
      config: thailandDefaults(),
      effectiveDate: "2026-10-05",
      version: 1,
      preset: "test",
      updatedAt: 1,
      updatedByUserId: w.userA,
    });
  });
  const readiness = await query(w, api.hr.policies.current, {
    capability: "LEAVE",
  });
  expect(readiness.employees).toEqual([]);
  expect(readiness.blockers).toEqual([]);
  expect(
    await mutation(w, api.hr.policies.reconcileOpening, {
      requestId: requestId(),
      employeeId: id,
      type: "SICK",
      asOf: "2026-10-05",
      granted: 30,
      used: 0,
      reserved: 0,
      paidUsed: 0,
      paidReserved: 0,
      sourceReference: "Imported HR ledger",
      expectedVersion: 0,
    }),
  ).toMatchObject({ written: false, error: { code: "HR_OUTSIDE_EMPLOYMENT" } });
  await w.t.run((ctx) =>
    ctx.db.patch(draftId, { effectiveDate: "2026-10-19" }),
  );
  const employed = await query(w, api.hr.policies.current, {
    capability: "LEAVE",
  });
  expect(
    employed.employees.map((employee: { id: string }) => employee.id),
  ).toEqual([id]);
  expect(employed.blockers).toContain("SCHEDULE_REQUIRED:E001");
  const announcement = await mutation(w, api.hr.announcements.saveDraft, {
    requestId: requestId(),
    expectedVersion: 0,
    title: "Operations update",
    body: "Confirmed update for current employees.",
    audience: { mode: "SITES", warehouseIds: [w.warehouses.alphaA] },
    acknowledgmentRequired: false,
  });
  expect(announcement.written).toBe(true);
  vi.setSystemTime(Date.UTC(2026, 9, 5, 3));
  expect(
    await mutation(w, api.hr.announcements.publish, {
      requestId: requestId(),
      announcementId: announcement.documentId,
      expectedVersion: 1,
    }),
  ).toMatchObject({
    written: false,
    error: { code: "ANNOUNCEMENT_AUDIENCE_EMPTY" },
  });
  expect(
    await w.t.run((ctx) => ctx.db.query("hrAnnouncementRecipients").collect()),
  ).toEqual([]);
  vi.setSystemTime(Date.UTC(2026, 9, 20, 3));
  expect(
    (
      await mutation(w, api.hr.announcements.publish, {
        requestId: requestId(),
        announcementId: announcement.documentId,
        expectedVersion: 1,
      })
    ).written,
  ).toBe(true);
  expect(
    await w.t.run((ctx) => ctx.db.query("hrAnnouncementRecipients").collect()),
  ).toHaveLength(1);
});

it("same-version chronology changes serialize without appending contradictory history", async () => {
  const w = await fixture();
  const id = await hire(w, { probationEndDate: "2026-05-04" });
  const results = await Promise.all([
    event(w, id, "CONFIRM_PROBATION", "2026-10-18", { expectedVersion: 1 }),
    event(w, id, "OFFBOARD", "2026-09-30", { expectedVersion: 1 }),
  ]);
  expect(results.filter((result) => result.written)).toHaveLength(1);
  expect(results.find((result) => !result.written)).toMatchObject({
    error: { code: "EMPLOYEE_STALE" },
  });
  expect(
    await w.t.run((ctx) => ctx.db.query("hrEmploymentEvents").collect()),
  ).toHaveLength(1);
});

it("a planned probation date cannot be newly moved beyond an existing separation event", async () => {
  const w = await fixture();
  const id = await hire(w, { probationEndDate: "2026-10-10" });
  await event(w, id, "OFFBOARD", "2026-09-30");
  const before = await w.t.run((ctx) => ctx.db.get(id));
  // The original future plan remains historical truth; changing it to an even
  // later date is an implicit rewrite after the recorded exit.
  expect(
    await mutation(w, api.hr.setup.saveEmployee, {
      ...draft(w),
      employeeId: id,
      expectedVersion: before!.version,
      status: "INACTIVE",
      employmentEndDate: "2026-09-30",
      probationEndDate: "2026-12-31",
      requestId: requestId(),
    }),
  ).toMatchObject({
    written: false,
    error: { code: "PROBATION_END_AFTER_EVENT", field: "probationEndDate" },
  });
  expect(await w.t.run((ctx) => ctx.db.get(id))).toEqual(before);
});
