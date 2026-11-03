import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { thailandDefaults } from "../../convex/model/hr/policy";
import { fromLocal } from "../../convex/model/hr/calendar";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  seedSecondActorForOrgA,
} from "../fixtures/convex-tenant-world";

const ADMIN = { subject: "user_fixture_a", org_id: "org_fixture_a" };
const NOW = fromLocal("2026-10-13", 600, 420);
let sequence = 0;
const rid = () => `closing-source-${++sequence}`;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());
function value<T>(
  result: { readonly ok: true; readonly value: T } | { readonly ok: false },
): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("Expected authorized result");
  return result.value;
}
const success = (result: any) => {
  expect(result, JSON.stringify(result)).toMatchObject({
    ok: true,
    value: { written: true },
  });
  return result.value;
};
const closing = (result: any) =>
  expect(result).toMatchObject({
    ok: true,
    value: { written: false, error: { code: "HR_PERIOD_CLOSING" } },
  });

async function fixture(state: "BUILDING" | "READY" | "CANCELLING") {
  const w = await createConvexTenantWorld({
    "../convex/hr/policies.ts": () => import("../../convex/hr/policies"),
    "../convex/hr/leave.ts": () => import("../../convex/hr/leave"),
    "../convex/hr/self.ts": () => import("../../convex/hr/self"),
    "../convex/hr/setup.ts": () => import("../../convex/hr/setup"),
    "../convex/hr/review.ts": () => import("../../convex/hr/review"),
    "../convex/hr/periodClose.ts": () => import("../../convex/hr/periodClose"),
    "../convex/hr/periods.ts": () => import("../../convex/hr/periods"),
  });
  const auth = await seedConvexAuthorization(w, { roleA: "HR_ADMIN" });
  await w.t.run((ctx) =>
    ctx.db.patch(auth.identities.membershipA, { scopeMode: "ORG_WIDE" }),
  );
  const second = await seedSecondActorForOrgA(w, "HR_EMPLOYEE");
  const admin = w.t.withIdentity(ADMIN);
  const employee = w.t.withIdentity({
    subject: second.clerkUserId,
    org_id: ADMIN.org_id,
  });
  const employeeFields = {
    warehouseId: w.warehouses.alphaA,
    schedule: {
      workDays: [1, 2, 3, 4, 5],
      startTime: "08:30",
      endTime: "17:30",
      endsNextDay: false,
      breakMinutes: 60,
    },
    code: "TARGET",
    displayName: "Target",
    employmentStartDate: "2020-01-01",
    status: "ACTIVE" as const,
  };
  const employeeId = success(
    await admin.mutation(api.hr.setup.saveEmployee, {
      ...employeeFields,
      requestId: rid(),
      userId: second.userId,
    }),
  ).documentId;
  const transferId = success(
    await admin.mutation(api.hr.setup.saveEmployee, {
      ...employeeFields,
      code: "TRANSFER",
      requestId: rid(),
    }),
  ).documentId;
  const incomingId = success(
    await admin.mutation(api.hr.setup.saveEmployee, {
      ...employeeFields,
      code: "INCOMING",
      warehouseId: w.warehouses.bravoA,
      requestId: rid(),
    }),
  ).documentId;
  const correctionId = success(
    await employee.mutation(api.hr.self.submitCorrection, {
      requestId: rid(),
      businessDate: "2026-10-05",
      start: { minute: 510, nextDay: false },
      end: { minute: 1050, nextDay: false },
      reason: "Forgot clock",
    }),
  ).documentId;
  const holidayId = success(
    await admin.mutation(api.hr.setup.saveHoliday, {
      requestId: rid(),
      warehouseId: w.warehouses.alphaA,
      date: "2026-10-07",
      name: "Holiday",
    }),
  ).documentId;
  const periodId = success(
    await admin.mutation(api.hr.periods.create, {
      requestId: rid(),
      warehouseId: w.warehouses.alphaA,
      startDate: "2026-10-05",
      endDate: "2026-10-07",
    }),
  ).documentId;
  // Synthetic persisted-state guard fixture: deliberately retains a pending
  // correction even in READY. This tests source-write refusal independently
  // of build validation; it does not represent a reachable READY UI journey.
  await w.t.run(async (ctx) => {
    const versionId = await ctx.db.insert("hrPeriodVersions", {
      orgId: w.orgA,
      periodId,
      warehouseId: w.warehouses.alphaA,
      version: 1,
      startDate: "2026-10-05",
      endDate: "2026-10-07",
      timezone: "Asia/Bangkok",
      siteCode: "ALPHA",
      siteName: "Alpha",
      fingerprint: "guard-fixture",
      totals: {
        employees: 0,
        days: 0,
        workedMinutes: 0,
        outsideShiftMinutes: 0,
        absentDays: 0,
        leaveDays: 0,
        nonworkingDays: 0,
      },
      closedByUserId: w.userA,
      closedAt: NOW,
      build: { state, step: 1, snapshotAt: NOW, offsetMinutes: 420 },
    });
    await ctx.db.patch(periodId, {
      status: "CLOSING",
      closingVersionId: versionId,
    });
  });
  const sources = () =>
    w.t.run(async (ctx) => ({
      employees: await ctx.db.query("hrEmployees").collect(),
      days: await ctx.db.query("hrAttendanceDays").collect(),
      corrections: await ctx.db.query("hrCorrectionRequests").collect(),
      holidays: await ctx.db.query("hrHolidays").collect(),
      notifications: await ctx.db.query("hrNotifications").collect(),
    }));
  return {
    ...w,
    auth,
    admin,
    employee,
    employeeFields,
    employeeId,
    transferId,
    incomingId,
    correctionId,
    holidayId,
    periodId,
    sources,
  };
}

describe.each(["BUILDING", "READY", "CANCELLING"] as const)(
  "CLOSING source guards in %s",
  (state) => {
    it("refuses correction decisions and boundary day certifications without source effects", async () => {
      const w = await fixture(state);
      const before = await w.sources();
      for (const decision of ["CERTIFY", "RETURN"] as const)
        closing(
          await w.admin.mutation(api.hr.review.decideCorrection, {
            requestId: rid(),
            correctionId: w.correctionId,
            expectedVersion: 1,
            decision,
            reason: "Reviewed",
          }),
        );
      for (const businessDate of ["2026-10-05", "2026-10-07"])
        closing(
          await w.admin.mutation(api.hr.review.disposeDay, {
            requestId: rid(),
            employeeId: w.employeeId,
            businessDate,
            expectedRevision: businessDate.endsWith("05") ? 1 : 0,
            disposition: "ABSENT",
            reason: "Reviewed absence",
          }),
        );
      expect(await w.sources()).toEqual(before);
      success(
        await w.admin.mutation(api.hr.review.disposeDay, {
          requestId: rid(),
          employeeId: w.employeeId,
          businessDate: "2026-10-08",
          expectedRevision: 0,
          disposition: "ABSENT",
          reason: "Unrelated period",
        }),
      );
    });
    it("refuses holiday deletion and roster create/update/transfers in both directions", async () => {
      const w = await fixture(state);
      const before = await w.sources();
      closing(
        await w.admin.mutation(api.hr.setup.deleteHoliday, {
          requestId: rid(),
          holidayId: w.holidayId,
        }),
      );
      closing(
        await w.admin.mutation(api.hr.setup.saveEmployee, {
          ...w.employeeFields,
          requestId: rid(),
          code: "NEW",
        }),
      );
      closing(
        await w.admin.mutation(api.hr.setup.saveEmployee, {
          ...w.employeeFields,
          requestId: rid(),
          employeeId: w.transferId,
          expectedVersion: 1,
          code: "TRANSFER",
          displayName: "Changed",
        }),
      );
      closing(
        await w.admin.mutation(api.hr.setup.saveEmployee, {
          ...w.employeeFields,
          requestId: rid(),
          employeeId: w.transferId,
          expectedVersion: 1,
          code: "TRANSFER",
          warehouseId: w.warehouses.bravoA,
        }),
      );
      closing(
        await w.admin.mutation(api.hr.setup.saveEmployee, {
          ...w.employeeFields,
          requestId: rid(),
          employeeId: w.incomingId,
          expectedVersion: 1,
          code: "INCOMING",
        }),
      );
      expect(await w.sources()).toEqual(before);
      success(
        await w.admin.mutation(api.hr.setup.saveEmployee, {
          ...w.employeeFields,
          requestId: rid(),
          warehouseId: w.warehouses.bravoA,
          code: "UNRELATED",
        }),
      );
    });
  },
);

// PR121 already covers overlapping leave locks and refusal precedence. These
// cases add explicit persisted build phases and compare the whole leave ledger.
it.each(["BUILDING", "READY", "CANCELLING"] as const)(
  "keeps leave source effects frozen in %s",
  async (state) => {
    const w = await fixture(state);
    // Prepare a valid request before installing its historical period lock.
    await w.t.run((ctx) =>
      ctx.db.patch(w.periodId, {
        status: "DRAFT",
      }),
    );
    vi.setSystemTime(fromLocal("2026-10-04", 600, 420));
    success(
      await w.admin.mutation(api.hr.policies.saveDraft, {
        requestId: rid(),
        capability: "LEAVE",
        expectedVersion: 0,
        effectiveDate: "2026-10-04",
        config: thailandDefaults(),
      }),
    );
    for (const employeeId of [w.employeeId, w.transferId, w.incomingId]) {
      for (const [type, granted] of [
        ["ANNUAL", 6],
        ["SICK", 30],
        ["PERSONAL", 3],
        ["MILITARY", 60],
      ] as const)
        success(
          await w.admin.mutation(api.hr.policies.reconcileOpening, {
            requestId: rid(),
            employeeId,
            type,
            asOf: "2026-10-04",
            granted,
            used: 0,
            reserved: 0,
            paidUsed: 0,
            paidReserved: 0,
            sourceReference: "Verified source register",
            expectedVersion: 0,
          }),
        );
    }
    for (const warehouseId of [w.warehouses.alphaA, w.warehouses.bravoA])
      for (let day = 1; day <= 13; day++)
        success(
          await w.admin.mutation(api.hr.setup.saveHoliday, {
            requestId: rid(),
            warehouseId,
            date:
              day === 13
                ? "2026-05-01"
                : `2026-01-${String(day).padStart(2, "0")}`,
            name: "Company holiday",
          }),
        );
    success(
      await w.admin.mutation(api.hr.policies.activate, {
        requestId: rid(),
        capability: "LEAVE",
        expectedVersion: 1,
        coverageConfirmed: true,
        existingBenefitsReviewed: true,
      }),
    );
    const fields = {
      type: "ANNUAL" as const,
      from: "2026-10-06",
      to: "2026-10-06",
      reason: "Annual leave",
    };
    const preview = value(await w.employee.query(api.hr.leave.preview, fields));
    if (!preview.ok) throw new Error("Expected leave preview");
    const ledger = () =>
      w.t.run(async (ctx) => ({
        requests: await ctx.db.query("hrLeaveRequests").collect(),
        accounts: await ctx.db.query("hrLeaveAccounts").collect(),
        movements: await ctx.db.query("hrLeaveLedger").collect(),
        claims: await ctx.db.query("hrLeaveDayClaims").collect(),
        days: await ctx.db.query("hrAttendanceDays").collect(),
      }));
    await w.t.run((ctx) => ctx.db.patch(w.periodId, { status: "CLOSING" }));
    const unsubmitted = await ledger();
    closing(
      await w.employee.mutation(api.hr.leave.submit, {
        ...fields,
        requestId: rid(),
        expectedPreviewHash: preview.previewHash,
      }),
    );
    expect(await ledger()).toEqual(unsubmitted);
    await w.t.run((ctx) => ctx.db.patch(w.periodId, { status: "DRAFT" }));
    const requestId = success(
      await w.employee.mutation(api.hr.leave.submit, {
        ...fields,
        requestId: rid(),
        expectedPreviewHash: preview.previewHash,
      }),
    ).documentId;
    await w.t.run((ctx) => ctx.db.patch(w.periodId, { status: "CLOSING" }));
    let before = await ledger();
    closing(
      await w.admin.mutation(api.hr.leave.decide, {
        requestId: rid(),
        leaveRequestId: requestId,
        expectedVersion: 1,
        decision: "APPROVE",
      }),
    );
    expect(await ledger()).toEqual(before);
    await w.t.run((ctx) => ctx.db.patch(w.periodId, { status: "DRAFT" }));
    success(
      await w.admin.mutation(api.hr.leave.decide, {
        requestId: rid(),
        leaveRequestId: requestId,
        expectedVersion: 1,
        decision: "APPROVE",
      }),
    );
    await w.t.run((ctx) => ctx.db.patch(w.periodId, { status: "CLOSING" }));
    before = await ledger();
    closing(
      await w.admin.mutation(api.hr.leave.adjust, {
        requestId: rid(),
        leaveRequestId: requestId,
        expectedVersion: 2,
        restoreDates: ["2026-10-06"],
        reason: "Verified return",
      }),
    );
    expect(await ledger()).toEqual(before);
    // Asking to cancel is metadata only; the confirmation changes frozen days.
    await w.t.run((ctx) => ctx.db.patch(w.periodId, { status: "CLOSING" }));
    success(
      await w.employee.mutation(api.hr.leave.cancel, {
        requestId: rid(),
        leaveRequestId: requestId,
        expectedVersion: 2,
      }),
    );
    before = await ledger();
    closing(
      await w.admin.mutation(api.hr.leave.decide, {
        requestId: rid(),
        leaveRequestId: requestId,
        expectedVersion: 3,
        decision: "CONFIRM_CANCEL",
      }),
    );
    expect(await ledger()).toEqual(before);
  },
);

it.each(["BUILDING", "READY", "CANCELLING"] as const)(
  "applies revoked driver permissions and site scope on the next command and read in %s",
  async (state) => {
    const w = await fixture(state);
    const period = await w.t.run((ctx) => ctx.db.get("hrPeriods", w.periodId));
    const before = await w.sources();
    await w.t.run((ctx) => ctx.db.delete(w.auth.membershipRoleA));
    expect(
      await w.admin.mutation(api.hr.periodClose.advance, {
        requestId: rid(),
        periodId: w.periodId,
        versionId: period!.closingVersionId!,
        step: 1,
      }),
    ).toMatchObject({ ok: false });
    expect(
      await w.admin.query(api.hr.periods.preview, {
        periodId: w.periodId,
        clockFree: true,
      }),
    ).toMatchObject({ ok: false });
    await w.t.run(async (ctx) => {
      await ctx.db.insert("membershipRoles", {
        orgId: w.orgA,
        membershipId: w.auth.identities.membershipA,
        roleId: w.auth.rolesA.get("HR_ADMIN")!,
        grantedAt: NOW,
      });
      await ctx.db.patch(w.auth.identities.membershipA, {
        scopeMode: "WAREHOUSE_SCOPED",
      });
      await ctx.db.delete(w.auth.identities.scopeA);
      await ctx.db.insert("membershipWarehouses", {
        orgId: w.orgA,
        membershipId: w.auth.identities.membershipA,
        warehouseId: w.warehouses.bravoA,
      });
    });
    const advance = await w.admin.mutation(api.hr.periodClose.advance, {
      requestId: rid(),
      periodId: w.periodId,
      versionId: period!.closingVersionId!,
      step: 1,
    });
    expect(advance).toMatchObject({
      ok: true,
      value: { written: false, error: { code: "NOT_FOUND" } },
    });
    expect(
      value(
        await w.admin.query(api.hr.periods.preview, {
          periodId: w.periodId,
          clockFree: true,
        }),
      ),
    ).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await w.sources()).toEqual(before);
    expect(await w.t.run((ctx) => ctx.db.get("hrPeriods", w.periodId))).toEqual(
      period,
    );
  },
);

it.each(["BUILDING", "READY", "CANCELLING"] as const)(
  "guards overnight clock-out by its prior business date in legacy %s fixture",
  async (state) => {
    const w = await fixture(state);
    // Artificial past-clock legacy fixture: a close cannot normally begin while
    // its last day is current. Rewind only to prove both clock guards use the
    // source business date, including an overnight out on the following date.
    vi.setSystemTime(fromLocal("2026-10-07", 1380, 420));
    closing(
      await w.employee.mutation(api.hr.self.clockIn, {
        requestId: rid(),
        expectedBusinessDate: "2026-10-07",
      }),
    );
    await w.t.run((ctx) => ctx.db.patch(w.periodId, { status: "DRAFT" }));
    const worker = await w.t.run((ctx) =>
      ctx.db.get("hrEmployees", w.employeeId),
    );
    success(
      await w.admin.mutation(api.hr.setup.saveEmployee, {
        ...w.employeeFields,
        requestId: rid(),
        employeeId: w.employeeId,
        expectedVersion: 1,
        ...(worker!.userId ? { userId: worker!.userId } : {}),
        schedule: {
          workDays: [1, 2, 3, 4, 5],
          startTime: "22:00",
          endTime: "06:00",
          endsNextDay: true,
          breakMinutes: 60,
        },
      }),
    );
    success(
      await w.employee.mutation(api.hr.self.clockIn, {
        requestId: rid(),
        expectedBusinessDate: "2026-10-07",
      }),
    );
    await w.t.run((ctx) => ctx.db.patch(w.periodId, { status: "CLOSING" }));
    const before = await w.sources();
    vi.setSystemTime(fromLocal("2026-10-08", 420, 420));
    closing(
      await w.employee.mutation(api.hr.self.clockOut, {
        requestId: rid(),
        expectedBusinessDate: "2026-10-07",
      }),
    );
    expect(await w.sources()).toEqual(before);
    expect(
      await w.t.run((ctx) => ctx.db.query("hrAttendanceEvents").collect()),
    ).toHaveLength(1);
  },
);

it.each(["BUILDING", "READY"] as const)(
  "restores source editability after public cancellation of %s",
  async (state) => {
    const w = await fixture(state);
    const period = await w.t.run((ctx) => ctx.db.get("hrPeriods", w.periodId));
    success(
      await w.admin.mutation(api.hr.periodClose.cancel, {
        requestId: rid(),
        periodId: w.periodId,
        versionId: period!.closingVersionId!,
      }),
    );
    success(
      await w.admin.mutation(api.hr.setup.deleteHoliday, {
        requestId: rid(),
        holidayId: w.holidayId,
      }),
    );
    success(
      await w.admin.mutation(api.hr.review.decideCorrection, {
        requestId: rid(),
        correctionId: w.correctionId,
        expectedVersion: 1,
        decision: "CERTIFY",
      }),
    );
    success(
      await w.admin.mutation(api.hr.setup.saveEmployee, {
        ...w.employeeFields,
        requestId: rid(),
        employeeId: w.transferId,
        expectedVersion: 1,
        code: "TRANSFER",
        displayName: "After cancellation",
      }),
    );
    expect(
      await w.t.run((ctx) => ctx.db.get("hrPeriods", w.periodId)),
    ).toMatchObject({ status: "DRAFT" });
    expect(
      await w.t.run((ctx) =>
        ctx.db.get("hrCorrectionRequests", w.correctionId),
      ),
    ).toMatchObject({ status: "CERTIFIED", version: 2 });
    expect(
      await w.t.run((ctx) => ctx.db.get("hrHolidays", w.holidayId)),
    ).toBeNull();
  },
);
