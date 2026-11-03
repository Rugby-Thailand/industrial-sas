import { parse } from "csv-parse/sync";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";
import {
  CORRECTION_REASON,
  MONTH_TOTALS_120,
  PROFILES,
  dateOf,
  expectedCsv,
  expectedDay,
  instant,
} from "../fixtures/hr-period-expected";

const ADMIN = { subject: "user_fixture_a", org_id: "org_fixture_a" };
let sequence = 0;
const rid = () => `realistic-close-${++sequence}`;
const csvRecords = (content: string): string[][] =>
  parse(content, { bom: true });
// Public functions return the common authorization envelope around their answer.
function answer(result: any) {
  expect(result.ok, JSON.stringify(result).slice(0, 400)).toBe(true);
  return result.value;
}
function written(result: any) {
  const value = answer(result);
  expect(value.written, JSON.stringify(value).slice(0, 400)).toBe(true);
  return value;
}

async function fixture(employees: number) {
  const world = await createConvexTenantWorld(
    {
      "../convex/hr/periods.ts": () => import("../../convex/hr/periods"),
      "../convex/hr/periodClose.ts": () =>
        import("../../convex/hr/periodClose"),
      "../convex/hr/selfPeriods.ts": () =>
        import("../../convex/hr/selfPeriods"),
      "../convex/hr/setup.ts": () => import("../../convex/hr/setup"),
    },
    { transactionLimits: true },
  );
  const auth = await seedConvexAuthorization(world, { roleA: "HR_ADMIN" });
  await world.t.run(async (ctx) => {
    await ctx.db.patch(auth.identities.membershipA, { scopeMode: "ORG_WIDE" });
    await ctx.db.insert("hrHolidays", {
      orgId: world.orgA,
      warehouseId: world.warehouses.alphaA,
      date: "2026-10-13",
      name: "วันหยุด",
      createdAt: 1,
      createdByUserId: world.userA,
    });
  });
  const employeeIds: Id<"hrEmployees">[] = [];
  // Seed one employee per transaction, keeping the fixture below write limits.
  for (let index = 0; index < employees; index += 1) {
    const id = await world.t.run(async (ctx) => {
      const profile = index % 6;
      const night = profile === 2;
      const employeeId = await ctx.db.insert("hrEmployees", {
        orgId: world.orgA,
        warehouseId: world.warehouses.alphaA,
        code: `E${String(index).padStart(4, "0")}`,
        displayName: PROFILES[profile]!.name,
        ...(index === 3 ? { userId: world.userA } : {}),
        employmentStartDate: "2020-01-01",
        status: "ACTIVE",
        version: 1,
        schedule: {
          workDays: [1, 2, 3, 4, 5],
          startTime: night ? "22:00" : "08:30",
          endTime: night ? "06:00" : "17:30",
          endsNextDay: night,
          breakMinutes: night ? 30 : 60,
        },
        createdAt: 1,
        updatedAt: 1,
        createdByUserId: world.userA,
        updatedByUserId: world.userA,
      });
      for (let day = 1; day <= 31; day += 1) {
        const weekday = new Date(`${dateOf(day)}T12:00:00Z`).getUTCDay();
        if (weekday === 0 || weekday === 6 || day === 13) continue;
        const start = instant(day, night ? "22:00" : "08:30");
        const end = night
          ? instant(day, "06:00") + 86400000
          : instant(day, "17:30");
        await ctx.db.insert("hrAttendanceDays", {
          orgId: world.orgA,
          warehouseId: world.warehouses.alphaA,
          employeeId,
          businessDate: dateOf(day),
          open: false,
          revision: 1,
          createdAt: 1,
          updatedAt: 1,
          plan: {
            kind: "SCHEDULED",
            startAt: start,
            endAt: end,
            startTime: night ? "22:00" : "08:30",
            endTime: night ? "06:00" : "17:30",
            endsNextDay: night,
            breakMinutes: night ? 30 : 60,
          },
          ...(profile < 4
            ? {
                clockInAt: profile === 1 ? instant(day, "08:15") : start,
                clockOutAt: profile === 1 ? instant(day, "17:45") : end,
              }
            : {}),
          ...(profile >= 3
            ? {
                certification: {
                  disposition:
                    profile === 3
                      ? "WORKED"
                      : profile === 4
                        ? "ABSENT"
                        : "LEAVE",
                  ...(profile === 3
                    ? { startAt: instant(day, "09:00"), endAt: end }
                    : {}),
                  revision: 1,
                  reason: CORRECTION_REASON,
                  decidedAt: 1,
                  decidedByUserId: world.userA,
                },
              }
            : {}),
        });
      }
      return employeeId;
    });
    employeeIds.push(id);
  }
  const client = world.t.withIdentity(ADMIN);
  const created = written(
    await client.mutation(api.hr.periods.create, {
      requestId: rid(),
      warehouseId: world.warehouses.alphaA,
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    }),
  );
  return {
    world,
    client,
    employeeIds,
    periodId: created.documentId as Id<"hrPeriods">,
  };
}

async function publish(
  world: ConvexTenantWorld,
  periodId: Id<"hrPeriods">,
  fingerprint?: string,
) {
  const client = world.t.withIdentity(ADMIN);
  const begun = written(
    await client.mutation(api.hr.periodClose.begin, {
      requestId: rid(),
      periodId,
      ...(fingerprint === undefined
        ? {}
        : { expectedFingerprint: fingerprint }),
    }),
  );
  for (let step = 0; step < 12; step += 1) {
    const { view } = answer(
      await client.query(api.hr.periods.preview, { periodId, clockFree: true }),
    );
    if (view.kind === "CLOSED")
      return begun.documentId as Id<"hrPeriodVersions">;
    expect(view.kind).toBe("CLOSING");
    if (view.state === "READY") {
      written(
        await client.mutation(api.hr.periodClose.publish, {
          requestId: rid(),
          periodId,
          versionId: view.versionId,
          expectedFingerprint: view.fingerprint,
        }),
      );
      return view.versionId as Id<"hrPeriodVersions">;
    }
    written(
      await client.mutation(api.hr.periodClose.advance, {
        requestId: rid(),
        periodId,
        versionId: view.versionId,
        step: view.step,
      }),
    );
  }
  throw new Error("Period build did not finish");
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-03T00:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("realistic attendance period close", () => {
  it("freezes 120 scheduled employees for 31 days with exact totals, employee history and every CSV byte", async () => {
    const { world, client, periodId } = await fixture(120);
    const versionId = await publish(world, periodId);
    const closed = answer(
      await client.query(api.hr.periods.preview, { periodId, clockFree: true }),
    );
    expect(closed.view).toMatchObject({
      kind: "CLOSED",
      rowsPaged: true,
      totals: MONTH_TOTALS_120,
    });

    let cursor: string | undefined;
    let content = "";
    const partSizes: number[] = [];
    const exportedEmployees = new Set<string>();
    for (let partIndex = 0; partIndex < 4; partIndex += 1) {
      const part = written(
        await client.mutation(api.hr.periods.exportCsv, {
          requestId: rid(),
          versionId,
          ...(cursor ? { cursor } : {}),
        }),
      );
      partSizes.push(part.rowCount);
      const partRecords = csvRecords(part.content).slice(
        partIndex === 0 ? 1 : 0,
      );
      expect(partRecords).toHaveLength(part.rowCount);
      const employeesInPart = new Set(partRecords.map((row) => row[3]!));
      for (const employee of employeesInPart) {
        expect(exportedEmployees.has(employee)).toBe(false);
        exportedEmployees.add(employee);
      }
      content += part.content;
      if (part.isDone) break;
      cursor = part.continueCursor;
    }
    // Parts stay bounded and contain whole employees, without requiring a
    // particular internal read slice size or perfectly packed parts.
    expect(partSizes).toHaveLength(2);
    expect(partSizes.reduce((sum, count) => sum + count, 0)).toBe(3720);
    for (const count of partSizes) {
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThanOrEqual(2000);
      expect(count % 31).toBe(0);
    }
    const expectedRecords = csvRecords(expectedCsv(periodId, 120));
    const records = csvRecords(content);
    expect(records).toHaveLength(expectedRecords.length);
    expect(content.match(/\uFEFF/g)).toHaveLength(1);
    expect(records.filter((row) => row[0] === "period_id")).toHaveLength(1);
    expect(
      new Set(records.slice(1).map((row) => `${row[3]}:${row[5]}`)).size,
    ).toBe(3720);
    // A real CSV parser preserves quoted CRLF; compare each cell and the bytes.
    records.forEach((record, index) =>
      expect(record).toEqual(expectedRecords[index]),
    );
    expect(content === expectedCsv(periodId, 120)).toBe(true);
    const own = answer(
      await client.query(api.hr.selfPeriods.detail, { versionId }),
    );
    expect(own.summary).toEqual({
      days: 31,
      workedMinutes: 9450,
      outsideShiftMinutes: 0,
      leaveDays: 0,
      absentDays: 0,
      nonworkingDays: 10,
    });
    expect(own.employee).toEqual({ code: "E0003", name: PROFILES[3]!.name });
    expect(own.rows).toHaveLength(31);
    for (let day = 1; day <= 31; day += 1) {
      const expected = expectedDay(3, day);
      expect(own.rows[day - 1]).toMatchObject({
        date: expected.businessDate,
        workedMinutes: expected.workedMinutes,
        disposition: expected.disposition,
      });
      expect(own.rows[day - 1].effectiveStart).toBe(expected.actualStartAt);
      expect(own.rows[day - 1].effectiveEnd).toBe(expected.actualEndAt);
      expect(own.rows[day - 1].originalStart).toBe(expected.plannedStart);
      expect(own.rows[day - 1].originalEnd).toBe(expected.plannedEnd);
      expect(own.rows[day - 1].correctionReason).toBe(
        expected.correctionReason,
      );
    }
  }, 30000);

  it.each([25, 26, 50, 51])(
    "preserves all scheduled rows at the %i-employee build and preview boundary",
    async (employees) => {
      const { world, client, periodId } = await fixture(employees);
      const { view } = answer(
        await client.query(api.hr.periods.preview, {
          periodId,
          clockFree: true,
        }),
      );
      expect(view.kind).toBe(employees <= 50 ? "DRAFT" : "PAGED");
      const versionId = await publish(
        world,
        periodId,
        employees <= 50 ? view.fingerprint : undefined,
      );
      const csv = written(
        await client.mutation(api.hr.periods.exportCsv, {
          requestId: rid(),
          versionId,
        }),
      );
      expect(csv.isDone).toBe(true);
      expect(csv.rowCount).toBe(employees * 31);
      const expected = csvRecords(expectedCsv(periodId, employees));
      const actual = csvRecords(csv.content);
      expect(actual).toHaveLength(expected.length);
      actual.forEach((record, index) =>
        expect(record).toEqual(expected[index]),
      );
    },
  );

  it("publishes a revised scheduled roster without rewriting the first version or its employee history", async () => {
    const { world, client, periodId, employeeIds } = await fixture(51);
    const first = await publish(world, periodId);
    const original = written(
      await client.mutation(api.hr.periods.exportCsv, {
        requestId: rid(),
        versionId: first,
      }),
    );
    written(
      await client.mutation(api.hr.periods.startRevision, {
        requestId: rid(),
        periodId,
        reason: "Correct employee display name",
      }),
    );
    written(
      await client.mutation(api.hr.setup.saveEmployee, {
        requestId: rid(),
        employeeId: employeeIds[3]!,
        expectedVersion: 1,
        warehouseId: world.warehouses.alphaA,
        code: "E0003",
        displayName: "Corrected revised",
        userId: world.userA,
        employmentStartDate: "2020-01-01",
        status: "ACTIVE",
        schedule: {
          workDays: [1, 2, 3, 4, 5],
          startTime: "08:30",
          endTime: "17:30",
          endsNextDay: false,
          breakMinutes: 60,
        },
      }),
    );
    const second = await publish(world, periodId);
    expect(second).not.toBe(first);
    const revised = written(
      await client.mutation(api.hr.periods.exportCsv, {
        requestId: rid(),
        versionId: second,
      }),
    );
    const expected = csvRecords(
      expectedCsv(periodId, 51)
        .replaceAll(",1,ALPHA,", ",2,ALPHA,")
        .replaceAll(",E0003,Corrected,", ",E0003,Corrected revised,"),
    );
    const records = csvRecords(revised.content);
    expect(records).toHaveLength(expected.length);
    records.forEach((record, index) => expect(record).toEqual(expected[index]));
    const firstAgain = written(
      await client.mutation(api.hr.periods.exportCsv, {
        requestId: rid(),
        versionId: first,
      }),
    );
    expect(firstAgain.content === original.content).toBe(true);
    const oldHistory = answer(
      await client.query(api.hr.selfPeriods.detail, { versionId: first }),
    );
    const newHistory = answer(
      await client.query(api.hr.selfPeriods.detail, { versionId: second }),
    );
    expect(oldHistory.employee.name).toBe("Corrected");
    expect(newHistory.employee.name).toBe("Corrected revised");
    expect(newHistory.summary).toEqual(oldHistory.summary);
    expect(newHistory.rows).toEqual(oldHistory.rows);
  });

  it("includes only employed dates and scans past former staff between active roster pages", async () => {
    const { world, client, periodId, employeeIds } = await fixture(51);
    // Historical setup: this employee joined and left inside the period.
    await world.t.run(async (ctx) => {
      await ctx.db.patch(employeeIds[0]!, {
        employmentStartDate: "2026-10-15",
        employmentEndDate: "2026-10-20",
        status: "INACTIVE",
      });
      for (let index = 0; index < 120; index += 1) {
        await ctx.db.insert("hrEmployees", {
          orgId: world.orgA,
          warehouseId: world.warehouses.alphaA,
          code: `E0000-F${String(index).padStart(3, "0")}`,
          displayName: "Former employee",
          employmentStartDate: "2020-01-01",
          employmentEndDate: "2021-01-01",
          status: "INACTIVE",
          version: 1,
          createdAt: 1,
          updatedAt: 1,
          createdByUserId: world.userA,
          updatedByUserId: world.userA,
        });
      }
    });
    const versionId = await publish(world, periodId);
    const csv = written(
      await client.mutation(api.hr.periods.exportCsv, {
        requestId: rid(),
        versionId,
      }),
    );
    expect(csv.isDone).toBe(true);
    expect(csv.rowCount).toBe(1556); // 50 full months plus six employed dates.
    const expected = csvRecords(expectedCsv(periodId, 51)).filter((record) => {
      if (record[3] !== "E0000") return true;
      return [15, 16, 17, 18, 19, 20].some((day) => record[5] === dateOf(day));
    });
    const records = csvRecords(csv.content);
    expect(records).toHaveLength(expected.length);
    records.forEach((record, index) => expect(record).toEqual(expected[index]));
  });
});
