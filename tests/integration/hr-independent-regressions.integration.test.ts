import type { GenericMutationCtx } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";
import * as periods from "../../convex/hr/periods";
import * as review from "../../convex/hr/review";
import * as self from "../../convex/hr/self";
import { storedPlan } from "../../convex/hr/shared";
import { fromLocal } from "../../convex/model/hr/calendar";
import { planFor, type Schedule } from "../../convex/model/hr/schedule";
import type { DataModel } from "../../convex/schema";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";

interface RuntimeFunction {
  _handler: (
    ctx: GenericMutationCtx<DataModel>,
    args: unknown,
  ) => Promise<unknown>;
}

const DATE = "2026-10-08";
const at = (date: string, minute: number) => fromLocal(date, minute, 420);
const DAY: Schedule = {
  workDays: [1, 2, 3, 4, 5],
  startTime: "08:30",
  endTime: "17:30",
  endsNextDay: false,
  breakMinutes: 60,
};
const NIGHT: Schedule = {
  ...DAY,
  startTime: "22:00",
  endTime: "06:00",
  endsNextDay: true,
  breakMinutes: 0,
};

async function call(world: ConvexTenantWorld, fn: unknown, args: unknown) {
  return world.t
    .withIdentity({ subject: "user_fixture_a", org_id: "org_fixture_a" })
    .run((ctx) =>
      (fn as RuntimeFunction)._handler(
        ctx as GenericMutationCtx<DataModel>,
        args,
      ),
    );
}

async function setup(schedule = DAY, roleA = "HR_EMPLOYEE", linked = true) {
  const world = await createConvexTenantWorld();
  await seedConvexAuthorization(world, { roleA });
  const employeeId = await world.t.run((ctx) =>
    ctx.db.insert("hrEmployees", {
      orgId: world.orgA,
      warehouseId: world.warehouses.alphaA,
      code: "EMP-INDEPENDENT",
      displayName: "Employee",
      ...(linked ? { userId: world.userA } : { supervisorUserId: world.userA }),
      employmentStartDate: "2026-01-01",
      status: "ACTIVE",
      schedule,
      version: 1,
      createdAt: 1,
      createdByUserId: world.userA,
      updatedAt: 1,
      updatedByUserId: world.userA,
    }),
  );
  return { world, employeeId, schedule };
}

describe("HR self-service contract regressions", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at("2026-10-09", 11 * 60));
  });
  afterEach(() => vi.useRealTimers());

  it("keeps an unresolved earlier day blocked while its correction is pending", async () => {
    const { world, employeeId } = await setup();
    await world.t.run(async (ctx) => {
      const dayId = await ctx.db.insert("hrAttendanceDays", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        employeeId,
        businessDate: DATE,
        plan: storedPlan(
          planFor({
            date: DATE,
            schedule: DAY,
            offsetMinutes: 420,
            holidayName: undefined,
          }),
        ),
        clockInAt: at(DATE, 510),
        open: true,
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      const correctionId = await ctx.db.insert("hrCorrectionRequests", {
        orgId: world.orgA,
        dayId,
        employeeId,
        warehouseId: world.warehouses.alphaA,
        businessDate: DATE,
        status: "PENDING",
        proposedStartAt: at(DATE, 510),
        proposedEndAt: at(DATE, 1050),
        reason: "Forgot to clock out",
        baseRevision: 1,
        version: 1,
        submittedByUserId: world.userA,
        submittedAt: at("2026-10-09", 600),
        history: [],
      });
      await ctx.db.patch(dayId, { pendingCorrectionId: correctionId });
    });

    expect(
      await call(world, self.clockIn, { requestId: "pending-day-clock-in" }),
    ).toMatchObject({
      ok: true,
      value: { written: false, error: { code: "HR_OPEN_DAY_UNRESOLVED" } },
    });
    expect(
      await world.t.run((ctx) => ctx.db.query("hrAttendanceEvents").collect()),
    ).toHaveLength(0);
  });

  it("allows a corrected late arrival after midnight on an overnight shift's business date", async () => {
    const { world } = await setup(NIGHT);
    expect(
      await call(world, self.submitCorrection, {
        requestId: "night-late-arrival-correction",
        businessDate: DATE,
        start: { minute: 40, nextDay: true },
        end: { minute: 360, nextDay: true },
        reason: "Forgot to clock in after arriving late",
      }),
    ).toMatchObject({ ok: true, value: { written: true } });
  });

  it("does not assign a regular next-day shift to the previous business date", async () => {
    const { world } = await setup(DAY);
    expect(
      await call(world, self.submitCorrection, {
        requestId: "wrong-business-date-correction",
        businessDate: DATE,
        start: { minute: 510, nextDay: true },
        end: { minute: 600, nextDay: true },
        reason: "These events belong to the following workday",
      }),
    ).toMatchObject({ ok: true, value: { written: false } });
  });

  it("allows the supervisor to account for an overnight late arrival", async () => {
    const { world, employeeId } = await setup(NIGHT, "HR_SUPERVISOR", false);
    expect(
      await call(world, review.disposeDay, {
        requestId: "review-night-late-arrival",
        employeeId,
        businessDate: DATE,
        expectedRevision: 0,
        disposition: "WORKED",
        start: { minute: 40, nextDay: true },
        end: { minute: 360, nextDay: true },
        reason: "Checked the overnight employee's actual arrival",
      }),
    ).toMatchObject({ ok: true, value: { written: true } });
  });

  it("prevents a reviewer from certifying a regular next-day shift under yesterday's date", async () => {
    const { world, employeeId } = await setup(DAY, "HR_SUPERVISOR", false);
    expect(
      await call(world, review.disposeDay, {
        requestId: "review-wrong-business-date",
        employeeId,
        businessDate: DATE,
        expectedRevision: 0,
        disposition: "WORKED",
        start: { minute: 510, nextDay: true },
        end: { minute: 600, nextDay: true },
        reason: "The supplied times belong to the following workday",
      }),
    ).toMatchObject({ ok: true, value: { written: false } });
  });

  it("retains every existing decision when a returned request is resubmitted", async () => {
    const { world, employeeId } = await setup();
    const original = Array.from({ length: 50 }, (_, index) => ({
      action: index % 2 === 0 ? ("SUBMITTED" as const) : ("RETURNED" as const),
      actorUserId: world.userA,
      at: index + 1,
      reason: `Decision reason ${index}`,
    }));
    const correctionId: Id<"hrCorrectionRequests"> = await world.t.run(
      async (ctx) => {
        const dayId = await ctx.db.insert("hrAttendanceDays", {
          orgId: world.orgA,
          warehouseId: world.warehouses.alphaA,
          employeeId,
          businessDate: DATE,
          plan: storedPlan(
            planFor({
              date: DATE,
              schedule: DAY,
              offsetMinutes: 420,
              holidayName: undefined,
            }),
          ),
          clockInAt: at(DATE, 510),
          open: true,
          revision: 1,
          createdAt: 1,
          updatedAt: 1,
        });
        return ctx.db.insert("hrCorrectionRequests", {
          orgId: world.orgA,
          dayId,
          employeeId,
          warehouseId: world.warehouses.alphaA,
          businessDate: DATE,
          status: "RETURNED",
          proposedStartAt: at(DATE, 510),
          proposedEndAt: at(DATE, 1050),
          reason: "Forgot to clock out",
          baseRevision: 1,
          version: 25,
          submittedByUserId: world.userA,
          submittedAt: at(DATE, 1060),
          history: original,
        });
      },
    );
    const outcome = await call(world, self.submitCorrection, {
      requestId: "retain-existing-request-history",
      correctionId,
      businessDate: DATE,
      end: { minute: 1050, nextDay: false },
      reason: "Corrected explanation with supporting details",
    });
    expect(outcome).toMatchObject({ ok: true });
    const updated = await world.t.run((ctx) => ctx.db.get(correctionId));
    expect(updated?.history.slice(0, original.length)).toEqual(original);
  });

  it("shows a closed version's captured site identity and timezone after settings change", async () => {
    const { world, employeeId } = await setup(DAY, "HR_ADMIN");
    const periodId = await world.t.run(async (ctx) => {
      const id = await ctx.db.insert("hrPeriods", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        startDate: DATE,
        endDate: DATE,
        status: "CLOSED",
        draftVersion: 1,
        latestClosedVersion: 1,
        createdAt: 1,
        createdByUserId: world.userA,
        updatedAt: 2,
        updatedByUserId: world.userA,
      });
      const versionId = await ctx.db.insert("hrPeriodVersions", {
        orgId: world.orgA,
        periodId: id,
        warehouseId: world.warehouses.alphaA,
        version: 1,
        startDate: DATE,
        endDate: DATE,
        timezone: "Asia/Bangkok",
        siteCode: "CAPTURED-SITE",
        siteName: "Captured site name",
        fingerprint: "frozen-fingerprint",
        totals: {
          employees: 1,
          days: 1,
          workedMinutes: 0,
          outsideShiftMinutes: 0,
          absentDays: 0,
          leaveDays: 0,
          nonworkingDays: 1,
        },
        closedByUserId: world.userA,
        closedAt: 2,
      });
      await ctx.db.insert("hrPeriodRows", {
        orgId: world.orgA,
        versionId,
        employeeId,
        employeeCode: "CAPTURED-EMPLOYEE",
        employeeName: "Captured employee name",
        businessDate: DATE,
        plan: { kind: "NONWORKING", reason: "HOLIDAY", breakMinutes: 0 },
        workedMinutes: 0,
        outsideShiftMinutes: 0,
        disposition: "NONWORKING",
      });
      const organization = await ctx.db.get(world.orgA);
      if (organization === null)
        throw new Error("Missing fixture organization");
      await ctx.db.patch(world.orgA, {
        settings: { ...organization.settings, timezone: "Asia/Tokyo" },
      });
      await ctx.db.patch(world.warehouses.alphaA, {
        code: "RENAMED-SITE",
        name: "Renamed site name",
      });
      return id;
    });
    expect(await call(world, periods.preview, { periodId })).toMatchObject({
      ok: true,
      value: {
        ok: true,
        period: {
          timezone: "Asia/Bangkok",
          siteCode: "CAPTURED-SITE",
          siteName: "Captured site name",
        },
        view: { kind: "CLOSED", version: 1 },
      },
    });
  });
  it("selects the actual latest closed version and can retrieve versions beyond a listing page", async () => {
    const { world } = await setup(DAY, "HR_ADMIN");
    const periodId = await world.t.run(async (ctx) => {
      const id = await ctx.db.insert("hrPeriods", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        startDate: DATE,
        endDate: DATE,
        status: "CLOSED",
        draftVersion: 51,
        latestClosedVersion: 51,
        createdAt: 1,
        createdByUserId: world.userA,
        updatedAt: 2,
        updatedByUserId: world.userA,
      });
      for (let version = 1; version <= 51; version++) {
        await ctx.db.insert("hrPeriodVersions", {
          orgId: world.orgA,
          periodId: id,
          warehouseId: world.warehouses.alphaA,
          version,
          startDate: DATE,
          endDate: DATE,
          timezone: "Asia/Bangkok",
          siteCode: "CAPTURED-SITE",
          siteName: "Captured site name",
          fingerprint: `frozen-${version}`,
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
          closedAt: version,
        });
      }
      return id;
    });
    for (const version of [undefined, 1, 51]) {
      expect(
        await call(world, periods.preview, {
          periodId,
          ...(version === undefined ? {} : { version }),
        }),
      ).toMatchObject({
        ok: true,
        value: { ok: true, view: { kind: "CLOSED", version: version ?? 51 } },
      });
    }
  });

  it("lets HR correct an unlinked employee's certified day in a revision while preserving v1", async () => {
    const { world, employeeId } = await setup(DAY, "HR_ADMIN", false);
    expect(
      await call(world, review.disposeDay, {
        requestId: "unlinked-original-disposition",
        employeeId,
        businessDate: DATE,
        expectedRevision: 0,
        disposition: "ABSENT",
        reason: "Initial attendance review",
      }),
    ).toMatchObject({ ok: true, value: { written: true } });
    expect(
      await call(world, periods.create, {
        requestId: "unlinked-period-create",
        warehouseId: world.warehouses.alphaA,
        startDate: DATE,
        endDate: DATE,
      }),
    ).toMatchObject({ ok: true, value: { written: true } });
    const period = await world.t.run((ctx) =>
      ctx.db.query("hrPeriods").unique(),
    );
    if (period === null) throw new Error("Missing created period");
    const periodId = period._id;
    async function closeDraft(requestId: string) {
      const preview = (await call(world, periods.preview, {
        periodId: periodId,
      })) as {
        value: { view: { fingerprint: string } };
      };
      return call(world, periods.close, {
        requestId,
        periodId: periodId,
        expectedFingerprint: preview.value.view.fingerprint,
      });
    }
    expect(await closeDraft("unlinked-period-close-v1")).toMatchObject({
      ok: true,
      value: { written: true, version: 1 },
    });
    expect(
      await call(world, periods.startRevision, {
        requestId: "unlinked-period-revise",
        periodId: period._id,
        reason: "New paper register evidence confirms a worked day",
      }),
    ).toMatchObject({ ok: true, value: { written: true } });
    expect(
      await call(world, review.disposeDay, {
        requestId: "unlinked-revised-disposition",
        employeeId,
        businessDate: DATE,
        expectedRevision: 1,
        disposition: "WORKED",
        start: { minute: 510, nextDay: false },
        end: { minute: 1050, nextDay: false },
        reason: "Verified the newly supplied paper register",
      }),
    ).toMatchObject({ ok: true, value: { written: true } });
    expect(await closeDraft("unlinked-period-close-v2")).toMatchObject({
      ok: true,
      value: { written: true, version: 2 },
    });
    for (const [version, workedMinutes, disposition] of [
      [1, 0, "ABSENT"],
      [2, 480, "WORKED"],
    ] as const) {
      expect(
        await call(world, periods.preview, { periodId: period._id, version }),
      ).toMatchObject({
        ok: true,
        value: {
          ok: true,
          view: {
            kind: "CLOSED",
            version,
            rows: [{ employeeId, workedMinutes, disposition }],
          },
        },
      });
    }
    const history = JSON.stringify(
      await call(world, review.dayDetail, {
        employeeId,
        businessDate: DATE,
      }),
    );
    expect(history).toContain("Initial attendance review");
    expect(history).toContain("Verified the newly supplied paper register");
  });

  it("keeps closed periods discoverable after an authorized site is made inactive", async () => {
    const { world } = await setup(DAY, "HR_ADMIN");
    const periodId = await world.t.run(async (ctx) => {
      const id = await ctx.db.insert("hrPeriods", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        startDate: DATE,
        endDate: DATE,
        status: "CLOSED",
        draftVersion: 1,
        latestClosedVersion: 1,
        createdAt: 1,
        createdByUserId: world.userA,
        updatedAt: 2,
        updatedByUserId: world.userA,
      });
      await ctx.db.patch(world.warehouses.alphaA, { status: "INACTIVE" });
      return id;
    });
    expect(await call(world, periods.list, {})).toMatchObject({
      ok: true,
      value: { items: [expect.objectContaining({ id: periodId })] },
    });
  });

  it("does not report a successful CSV replay after current site access is revoked", async () => {
    const { world } = await setup(DAY, "HR_ADMIN");
    const versionId = await world.t.run(async (ctx) => {
      const periodId = await ctx.db.insert("hrPeriods", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        startDate: DATE,
        endDate: DATE,
        status: "CLOSED",
        draftVersion: 1,
        latestClosedVersion: 1,
        createdAt: 1,
        createdByUserId: world.userA,
        updatedAt: 2,
        updatedByUserId: world.userA,
      });
      return ctx.db.insert("hrPeriodVersions", {
        orgId: world.orgA,
        periodId,
        warehouseId: world.warehouses.alphaA,
        version: 1,
        startDate: DATE,
        endDate: DATE,
        timezone: "Asia/Bangkok",
        siteCode: "ALPHA",
        siteName: "Alpha",
        fingerprint: "empty-frozen",
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
        closedAt: 2,
      });
    });
    const args = { requestId: "export-with-revoked-site", versionId };
    expect(await call(world, periods.exportCsv, args)).toMatchObject({
      ok: true,
      value: { written: true, content: expect.any(String) },
    });
    await world.t.run(async (ctx) => {
      const scopes = await ctx.db
        .query("membershipWarehouses")
        .withIndex("by_orgId_membershipId_warehouseId", (q) =>
          q.eq("orgId", world.orgA),
        )
        .collect();
      for (const scope of scopes) await ctx.db.delete(scope._id);
    });
    const result = (await call(world, periods.exportCsv, args)) as {
      ok: boolean;
      value?: { written?: boolean; content?: string };
    };
    expect(result.value?.written ?? false).toBe(false);
    expect(result.value?.content).toBeUndefined();
  });

  it("identifies an incomplete review queue instead of implying all missing days were returned", async () => {
    const everyDay: Schedule = { ...DAY, workDays: [0, 1, 2, 3, 4, 5, 6] };
    const { world } = await setup(everyDay, "HR_ADMIN", false);
    await world.t.run(async (ctx) => {
      for (let number = 1; number < 17; number++) {
        await ctx.db.insert("hrEmployees", {
          orgId: world.orgA,
          warehouseId: world.warehouses.alphaA,
          code: `EMP-QUEUE-${number}`,
          displayName: `Queue employee ${number}`,
          employmentStartDate: "2026-01-01",
          status: "ACTIVE",
          schedule: everyDay,
          version: 1,
          createdAt: 1,
          createdByUserId: world.userA,
          updatedAt: 1,
          updatedByUserId: world.userA,
        });
      }
    });
    const result = (await call(world, review.queue, {
      from: "2026-09-08",
      to: DATE,
    })) as {
      ok: boolean;
      value: {
        ok: boolean;
        code?: string;
        complete?: boolean;
        items?: unknown[];
      };
    };
    expect(result.ok).toBe(true);
    if (result.value.ok === false) {
      expect(result.value.code).toMatch(/LIMIT|TOO_LARGE/);
    } else {
      expect(result.value.complete).toBe(false);
      expect(result.value.items?.length).toBeLessThan(527);
    }
  });
});
