import { addDays } from "../../../convex/model/hr/calendar";
import { accountPeriod } from "../../../convex/model/hr/policy";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { FunctionReference } from "convex/server";
import type { Id } from "../../../convex/_generated/dataModel";
import type { TenantFunctionOutcome } from "../../../convex/lib/tenantFunctions";
import { api } from "../../../convex/_generated/api";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../../fixtures/convex-tenant-world";
const IDENTITY = { subject: "user_fixture_a", org_id: "org_fixture_a" };
let n = 0;
const requestId = () => `independent-review-${++n}`;
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
    "../convex/hr/recovery.ts": () => import("../../../convex/hr/recovery"),
    "../convex/hr/self.ts": () => import("../../../convex/hr/self"),
    "../convex/hr/leave.ts": () => import("../../../convex/hr/leave"),
    "../convex/hr/payslips.ts": () => import("../../../convex/hr/payslips"),
    "../convex/hr/search.ts": () => import("../../../convex/hr/search"),
    "../convex/hr/review.ts": () => import("../../../convex/hr/review"),
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
const daily = {
  workDays: [1, 2, 3, 4, 5, 6, 7],
  startTime: "09:00",
  endTime: "18:00",
  endsNextDay: false,
  breakMinutes: 60,
};

it("independent chronology remains authoritative beyond 100 displayed events with equal recording timestamps", async () => {
  const w = await fixture();
  const id = await hire(w);
  for (let i = 0; i < 104; i++) {
    expect(
      (
        await event(
          w,
          id,
          i % 2 === 0 ? "OFFBOARD" : "REINSTATE",
          addDays("2026-01-05", i),
        )
      ).written,
    ).toBe(true);
  }
  const view = await query(w, api.hr.employeeProfile.employeeLifecycle, {
    employeeId: id,
  });
  expect(view.events).toHaveLength(100);
  expect(view.complete).toBe(false);
  expect(
    new Set(view.events.map((e: { recordedAt: number }) => e.recordedAt)).size,
  ).toBe(1);
  expect(view.firstEffectiveDate).toBe("2026-01-05");
  expect(view.latestEffectiveDate).toBe(addDays("2026-01-05", 103));
  expect(
    await event(w, id, "OFFBOARD", addDays("2026-01-05", 102)),
  ).toMatchObject({
    written: false,
    error: { code: "LIFECYCLE_DATE_BEFORE_EVENT" },
  });
  const before = await w.t.run((ctx) => ctx.db.get(id));
  expect(
    await mutation(w, api.hr.setup.saveEmployee, {
      ...draft(w),
      employeeId: id,
      expectedVersion: before!.version,
      employmentStartDate: "2026-01-06",
      requestId: requestId(),
    }),
  ).toMatchObject({
    written: false,
    error: { code: "EMPLOYMENT_START_AFTER_EVENT" },
  });
  expect(await w.t.run((ctx) => ctx.db.get(id))).toEqual(before);
});

it("independent legacy and modern unrelated edits retain an unchanged historic future probation plan", async () => {
  const w = await fixture();
  const id = await hire(w, { probationEndDate: "2026-12-31" });
  expect((await event(w, id, "CONFIRM_PROBATION", "2026-05-04")).written).toBe(
    true,
  );
  for (const modern of [false, true]) {
    const before = await w.t.run((ctx) => ctx.db.get(id));
    expect(
      (
        await mutation(w, api.hr.setup.saveEmployee, {
          ...draft(w),
          employeeId: id,
          expectedVersion: before!.version,
          displayName: "Unrelated change",
          ...(modern
            ? { replaceOrgFields: true, probationEndDate: "2026-12-31" }
            : {}),
          requestId: requestId(),
        })
      ).written,
    ).toBe(true);
    expect(await w.t.run((ctx) => ctx.db.get(id))).toMatchObject({
      probationEndDate: "2026-12-31",
      probationConfirmedDate: "2026-05-04",
    });
  }
});

it("independent main edits preserve two gaps and inclusive first-exit and rejoin boundaries across history and periods", async () => {
  const w = await fixture();
  const id = await hire(w, { userId: w.userA, schedule: daily });
  for (const [kind, date] of [
    ["OFFBOARD", "2026-09-30"],
    ["REINSTATE", "2026-10-03"],
    ["OFFBOARD", "2026-10-05"],
    ["REINSTATE", "2026-10-10"],
  ])
    expect((await event(w, id, kind!, date!)).written).toBe(true);
  for (const modern of [false, true]) {
    const before = await w.t.run((ctx) => ctx.db.get(id));
    expect(
      (
        await mutation(w, api.hr.setup.saveEmployee, {
          ...draft(w),
          userId: w.userA,
          schedule: daily,
          employeeId: id,
          expectedVersion: before!.version,
          employmentEndDate: "2026-10-20",
          ...(modern ? { replaceOrgFields: true } : {}),
          requestId: requestId(),
        })
      ).written,
    ).toBe(true);
  }
  const history = await query(w, api.hr.self.history, {
    from: "2026-09-30",
    to: "2026-10-10",
  });
  expect(
    history.rows.map((r: { businessDate: string }) => r.businessDate).sort(),
  ).toEqual([
    "2026-09-30",
    "2026-10-03",
    "2026-10-04",
    "2026-10-05",
    "2026-10-10",
  ]);
  const period = await mutation(w, api.hr.periods.create, {
    warehouseId: w.warehouses.alphaA,
    startDate: "2026-09-30",
    endDate: "2026-10-10",
    requestId: requestId(),
  });
  const preview = await query(w, api.hr.periods.preview, {
    periodId: period.documentId,
  });
  expect(
    preview.view.rows
      .map((r: { businessDate: string }) => r.businessDate)
      .sort(),
  ).toEqual(
    history.rows.map((r: { businessDate: string }) => r.businessDate).sort(),
  );
  expect((await w.t.run((ctx) => ctx.db.get(id)))!.employmentStartDate).toBe(
    "2026-01-05",
  );
});

it("independent correction and review disposition refuse a gap and the queue omits it", async () => {
  const w = await fixture();
  const actor = await hire(w, { userId: w.userA, schedule: daily });
  const id = await hire(w, { code: "E002", schedule: daily });
  for (const employeeId of [actor, id]) {
    await event(w, employeeId, "OFFBOARD", "2026-09-30");
    await event(w, employeeId, "REINSTATE", "2026-10-19");
  }
  expect(
    await mutation(w, api.hr.self.submitCorrection, {
      businessDate: "2026-10-05",
      reason: "Independent review",
      start: { minute: 540, nextDay: false },
      end: { minute: 1080, nextDay: false },
      requestId: requestId(),
    }),
  ).toMatchObject({ written: false, error: { code: "HR_OUTSIDE_EMPLOYMENT" } });
  expect(
    await mutation(w, api.hr.review.disposeDay, {
      employeeId: id,
      businessDate: "2026-10-05",
      expectedRevision: 0,
      disposition: "ABSENT",
      reason: "Independent review",
      requestId: requestId(),
    }),
  ).toMatchObject({ written: false, error: { code: "HR_OUTSIDE_EMPLOYMENT" } });
  expect(
    await query(w, api.hr.review.queue, {
      from: "2026-10-05",
      to: "2026-10-05",
    }),
  ).toMatchObject({ ok: true, items: [] });
});

it("independent annual opening after reinstatement keeps the original hire anniversary", async () => {
  const w = await fixture();
  const id = await hire(w, { employmentStartDate: "2024-02-29" });
  await event(w, id, "OFFBOARD", "2026-09-30");
  await event(w, id, "REINSTATE", "2026-10-19");
  expect(
    (
      await mutation(w, api.hr.policies.reconcileOpening, {
        employeeId: id,
        type: "ANNUAL",
        asOf: "2026-10-20",
        granted: 6,
        used: 0,
        reserved: 0,
        paidUsed: 0,
        paidReserved: 0,
        sourceReference: "Independent opening",
        expectedVersion: 0,
        requestId: requestId(),
      })
    ).written,
  ).toBe(true);
  const rows = await w.t.run((ctx) =>
    ctx.db.query("hrLeaveAccounts").collect(),
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    periodStart: accountPeriod("ANNUAL", "2024-02-29", "2026-10-20").start,
    periodEnd: accountPeriod("ANNUAL", "2024-02-29", "2026-10-20").end,
  });
  expect(rows[0]!.periodStart).not.toBe("2026-10-19");
});

it.each([
  "hr.employee.profile.save",
  "hr.employee.payment.save",
  "hr.employee.lifecycle",
])(
  "independent recovery %s rechecks current admin permission even while self permission remains",
  async (operation) => {
    const w = await fixture();
    await w.t.run(async (ctx) => {
      for (const p of await ctx.db.query("rolePermissions").collect())
        if (p.orgId === w.orgA && p.permissionCode === "hr.admin.manage")
          await ctx.db.delete(p._id);
    });
    expect(
      await mutation(w, api.hr.recovery.reconcileRequest, {
        operation,
        requestId: requestId(),
      }),
    ).toEqual({ resolved: false, code: "PERMISSION_DENIED" });
    expect(
      await w.t.run((ctx) => ctx.db.query("idempotencyRecords").collect()),
    ).toEqual([]);
  },
);

it.each([true, false])(
  "independent recovery and profile command race obeys a single terminal outcome, reconciliation first=%s",
  async (first) => {
    const w = await fixture();
    const id = await hire(w);
    const rid = requestId();
    const save = () =>
      mutation(w, api.hr.employeeProfile.saveEmployeeProfile, {
        employeeId: id,
        expectedVersion: 0,
        nickname: "Private race",
        requestId: rid,
      });
    const recover = () =>
      mutation(w, api.hr.recovery.reconcileRequest, {
        operation: "hr.employee.profile.save",
        requestId: rid,
      });
    const result = await Promise.all(
      first ? [recover(), save()] : [save(), recover()],
    );
    const recovery = result[first ? 0 : 1];
    const command = result[first ? 1 : 0];
    expect(recovery.resolved).toBe(true);
    if (recovery.status === "COMMITTED") expect(command.written).toBe(true);
    else {
      expect(recovery.status).toBe("FENCED");
      expect(command).toMatchObject({
        written: false,
        error: { code: "REQUEST_RETIRED" },
      });
    }
  },
);

it("independent final shift refusal follows captured plan until its exact deadline after a current schedule edit", async () => {
  const w = await fixture();
  const id = await hire(w, {
    userId: w.userA,
    schedule: {
      ...daily,
      startTime: "22:00",
      endTime: "06:00",
      endsNextDay: true,
      breakMinutes: 0,
    },
  });
  vi.setSystemTime(Date.UTC(2026, 9, 19, 15));
  expect(
    (
      await mutation(w, api.hr.self.clockIn, {
        expectedBusinessDate: "2026-10-19",
        requestId: requestId(),
      })
    ).written,
  ).toBe(true);
  const before = await w.t.run((ctx) => ctx.db.get(id));
  expect(
    (
      await mutation(w, api.hr.setup.saveEmployee, {
        ...draft(w),
        userId: w.userA,
        schedule: {
          ...daily,
          startTime: "22:00",
          endTime: "02:00",
          endsNextDay: true,
          breakMinutes: 0,
        },
        employeeId: id,
        expectedVersion: before!.version,
        requestId: requestId(),
      })
    ).written,
  ).toBe(true);
  vi.setSystemTime(Date.UTC(2026, 9, 20, 3) - 1); // 09:59:59.999 Bangkok: captured 06:00 + four-hour grace.
  expect(await event(w, id, "OFFBOARD", "2026-10-19")).toMatchObject({
    written: false,
    error: { code: "LIFECYCLE_OPEN_SHIFT" },
  });
  vi.setSystemTime(Date.UTC(2026, 9, 20, 3));
  expect(
    await mutation(w, api.hr.self.clockOut, {
      expectedBusinessDate: "2026-10-19",
      requestId: requestId(),
    }),
  ).toMatchObject({ written: false, error: { code: "HR_OPEN_DAY_EXPIRED" } });
  expect((await event(w, id, "OFFBOARD", "2026-10-19")).written).toBe(true);
});

it("independent gap direct detail never invents a missing attendance obligation", async () => {
  const w = await fixture();
  const schedule = {
    workDays: [1, 2, 3, 4, 5, 6, 7],
    startTime: "09:00",
    endTime: "18:00",
    endsNextDay: false,
    breakMinutes: 60,
  };
  const selfId = await hire(w, { userId: w.userA, schedule });
  const otherId = await hire(w, { code: "E002", schedule });
  for (const id of [selfId, otherId]) {
    expect((await event(w, id, "OFFBOARD", "2026-09-30")).written).toBe(true);
    expect((await event(w, id, "REINSTATE", "2026-10-19")).written).toBe(true);
  }
  const self = await query(w, api.hr.self.dayDetail, {
    businessDate: "2026-10-05",
  });
  const review = await query(w, api.hr.review.dayDetail, {
    employeeId: otherId,
    businessDate: "2026-10-05",
  });
  const history = await query(w, api.hr.self.history, {
    from: "2026-10-05",
    to: "2026-10-05",
  });
  const rejected = await mutation(w, api.hr.self.submitCorrection, {
    businessDate: "2026-10-05",
    start: { minute: 540, nextDay: false },
    end: { minute: 1080, nextDay: false },
    reason: "This gap was not employment",
    requestId: requestId(),
  });
  const disposition = await mutation(w, api.hr.review.disposeDay, {
    employeeId: otherId,
    businessDate: "2026-10-05",
    expectedRevision: 0,
    disposition: "ABSENT",
    reason: "This gap was not employment",
    requestId: requestId(),
  });

  expect(history.rows).toEqual([]);
  expect(rejected).toMatchObject({
    written: false,
    error: { code: "HR_OUTSIDE_EMPLOYMENT" },
  });
  expect(disposition).toMatchObject({
    written: false,
    error: { code: "HR_OUTSIDE_EMPLOYMENT" },
  });
  expect(self).toMatchObject({ ok: false, code: "HR_OUTSIDE_EMPLOYMENT" });
  expect(review).toMatchObject({ ok: false, code: "HR_OUTSIDE_EMPLOYMENT" });
});

it("captured day remains readable after employment dates exclude it", async () => {
  const w = await fixture();
  const id = await hire(w, { userId: w.userA, schedule: daily });
  vi.setSystemTime(Date.UTC(2026, 9, 5, 2));
  expect(
    (
      await mutation(w, api.hr.self.clockIn, {
        expectedBusinessDate: "2026-10-05",
        requestId: requestId(),
      })
    ).written,
  ).toBe(true);
  vi.setSystemTime(Date.UTC(2026, 9, 5, 11));
  expect(
    (
      await mutation(w, api.hr.self.clockOut, {
        expectedBusinessDate: "2026-10-05",
        requestId: requestId(),
      })
    ).written,
  ).toBe(true);
  const before = await query(w, api.hr.self.dayDetail, {
    businessDate: "2026-10-05",
  });
  vi.setSystemTime(Date.UTC(2026, 9, 20, 3));
  expect((await event(w, id, "OFFBOARD", "2026-09-30")).written).toBe(true);
  expect((await event(w, id, "REINSTATE", "2026-10-19")).written).toBe(true);
  const after = await query(w, api.hr.self.dayDetail, {
    businessDate: "2026-10-05",
  });
  expect(after.ok).toBe(true);
  expect(after.detail).toEqual(before.detail);
});
