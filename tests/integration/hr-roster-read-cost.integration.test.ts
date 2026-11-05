import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";
import * as roster from "../../convex/hr/roster";
import { isoWeekday } from "../../convex/model/hr/calendar";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";
import { measured, type ReadStats } from "../fixtures/query-read-stats";

/**
 * Read cost of one roster page in the middle of a month, under the deployed
 * transaction limits (4096 index queries, 32k documents) at the largest
 * accepted page size.
 *
 * October 2026 on day 20: the first half is a closed period whose close
 * froze every employee's dates, attendance is recorded on every weekday up
 * to the 19th, a year of earlier semimonthly periods exists, and ten
 * employees also have frozen plans in the open second half (one with three
 * versions, beyond one range read's bound).
 *
 * The per-cell implementation (e0b011fb) issued one `hrPeriodRows` lookup
 * for every cell that was neither recorded nor period-closed and read every
 * site period. This test's convex-test counts, index queries / documents:
 *   size 20, before: 353 / 454, 353 / 314, 183 / 174
 *   size 20, after:   98 / 471,  93 / 290,  53 / 150
 *   size 50, before: 863 / 874, then an empty last page 12 / 34
 *   size 50, after:  218 / 891, then 12 / 10
 * The first page reads 41 more frozen rows than before: one range returns
 * every version, and rows under recorded dates, where a lookup per open
 * cell read at most one row each. Every page reads 24 fewer periods.
 */

const MONTH = "2026-10";
const EMPLOYEES = 50;
const FROZEN_EMPLOYEES = 10;
/** Employee index whose open-half dates have three frozen versions. */
const REVISED = 1;
const date = (day: number) => `${MONTH}-${String(day).padStart(2, "0")}`;
const DAYS = Array.from({ length: 31 }, (_, index) => index + 1);
const weekday = (day: number) => isoWeekday(date(day)) <= 5;
const recorded = (day: number) => day <= 19 && weekday(day);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 20, 3));
});
afterEach(() => vi.useRealTimers());

async function midMonthSite() {
  const w = await createConvexTenantWorld(
    { "../convex/hr/roster.ts": () => import("../../convex/hr/roster") },
    { transactionLimits: true },
  );
  await seedConvexAuthorization(w, { roleA: "HR_ADMIN", roleB: "HR_ADMIN" });
  const audit = {
    createdAt: 1,
    createdByUserId: w.userA,
    updatedAt: 1,
    updatedByUserId: w.userA,
  };
  const ids = await w.t.run(async (ctx) => {
    const ids: Id<"hrEmployees">[] = [];
    for (let index = 0; index < EMPLOYEES; index += 1)
      ids.push(
        await ctx.db.insert("hrEmployees", {
          orgId: w.orgA,
          warehouseId: w.warehouses.alphaA,
          code: `M${String(index).padStart(2, "0")}`,
          displayName: `Member ${index}`,
          employmentStartDate: "2025-01-01",
          status: "ACTIVE",
          schedule: {
            workDays: [1, 2, 3, 4, 5],
            startTime: "09:00",
            endTime: "18:00",
            endsNextDay: false,
            breakMinutes: 60,
          },
          version: 1,
          ...audit,
        }),
      );
    return ids;
  });

  const period = (
    startDate: string,
    endDate: string,
    status: "DRAFT" | "CLOSED",
  ) =>
    w.t.run((ctx) =>
      ctx.db.insert("hrPeriods", {
        orgId: w.orgA,
        warehouseId: w.warehouses.alphaA,
        startDate,
        endDate,
        status,
        draftVersion: status === "DRAFT" ? 2 : 1,
        latestClosedVersion: 1,
        ...audit,
      }),
    );
  const version = (
    periodId: Id<"hrPeriods">,
    number: number,
    startDate: string,
    endDate: string,
  ) =>
    w.t.run((ctx) =>
      ctx.db.insert("hrPeriodVersions", {
        orgId: w.orgA,
        warehouseId: w.warehouses.alphaA,
        periodId,
        version: number,
        startDate,
        endDate,
        timezone: "Asia/Bangkok",
        siteCode: "ALPHA",
        siteName: "Alpha",
        fingerprint: `v${number}`,
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
        closedAt: 1,
      }),
    );
  const frozen = (
    versionId: Id<"hrPeriodVersions">,
    rows: readonly [Id<"hrEmployees">, number][],
  ) =>
    w.t.run(async (ctx) => {
      for (const [employeeId, day] of rows)
        await ctx.db.insert("hrPeriodRows", {
          orgId: w.orgA,
          versionId,
          employeeId,
          employeeCode: "M",
          employeeName: "M",
          businessDate: date(day),
          plan: { kind: "NONWORKING", reason: "UNSCHEDULED", breakMinutes: 0 },
          workedMinutes: 0,
          outsideShiftMinutes: 0,
          disposition: "NONWORKING",
        });
    });

  // A year of earlier semimonthly periods, all closed.
  for (let month = 0; month < 12; month += 1) {
    const year = month < 3 ? 2025 : 2026;
    const value = String(((month + 9) % 12) + 1).padStart(2, "0");
    const end = new Date(
      Date.UTC(year, ((month + 9) % 12) + 1, 0),
    ).getUTCDate();
    await period(`${year}-${value}-01`, `${year}-${value}-15`, "CLOSED");
    await period(`${year}-${value}-16`, `${year}-${value}-${end}`, "CLOSED");
  }
  // This month: the closed first half froze every employee's dates.
  const closed = await period(date(1), date(15), "CLOSED");
  const closedVersion = await version(closed, 1, date(1), date(15));
  await frozen(
    closedVersion,
    ids.flatMap((id) =>
      DAYS.filter((day) => day <= 15).map((day) => [id, day] as const),
    ),
  );
  // The open second half was closed and reopened for ten employees' plans.
  const open = await period(date(16), date(31), "DRAFT");
  for (let number = 1; number <= 3; number += 1) {
    const versionId = await version(open, number, date(16), date(31));
    await frozen(
      versionId,
      ids
        .slice(0, FROZEN_EMPLOYEES)
        .filter((_id, index) => number === 1 || index === REVISED)
        .flatMap((id) =>
          DAYS.filter((day) => day >= 16).map((day) => [id, day] as const),
        ),
    );
  }
  await w.t.run(async (ctx) => {
    for (const employeeId of ids)
      for (const day of DAYS.filter(recorded))
        await ctx.db.insert("hrAttendanceDays", {
          orgId: w.orgA,
          warehouseId: w.warehouses.alphaA,
          employeeId,
          businessDate: date(day),
          plan: { kind: "NONWORKING", reason: "UNSCHEDULED", breakMinutes: 0 },
          open: false,
          revision: 0,
          createdAt: 1,
          updatedAt: 1,
        });
  });
  return w;
}

type Page = {
  status: string;
  isDone: boolean;
  continueCursor: string;
  page: {
    code: string;
    cells: { date: string; lock: string | null; recorded: boolean }[];
  }[];
};

const sum = (values: Record<string, number>) =>
  Object.values(values).reduce((total, value) => total + value, 0);
const docsOf = (stats: ReadStats) => sum(stats.rangeDocs) + sum(stats.gets);
const queriesOf = (stats: ReadStats) => sum(stats.ranges) + sum(stats.gets);

async function walk(w: ConvexTenantWorld, pageSize: 20 | 50) {
  const pages: { page: Page; stats: ReadStats }[] = [];
  let cursor: string | undefined;
  do {
    const { value, stats } = await measured<Page>(w, roster.roster, {
      warehouseId: w.warehouses.alphaA,
      month: MONTH,
      pageSize,
      ...(cursor ? { cursor } : {}),
    });
    expect(value.status).toBe("ready");
    pages.push({ page: value, stats });
    cursor = value.isDone ? undefined : value.continueCursor;
  } while (cursor !== undefined);
  return pages;
}

describe("HR roster page read cost", () => {
  it("reads each employee's frozen plans in one range and only the periods that can overlap the month", async () => {
    const w = await midMonthSite();
    const sizes = [20, 50] as const;
    const walks = [];
    for (const pageSize of sizes) walks.push(await walk(w, pageSize));
    for (const [index, pages] of walks.entries())
      process.stderr.write(
        `roster read cost pageSize=${sizes[index]}: ` +
          pages
            .map(
              ({ stats }) =>
                `${queriesOf(stats)} queries (hrPeriodRows ${stats.ranges.hrPeriodRows ?? 0}) / ${docsOf(stats)} docs (hrPeriods ${stats.rangeDocs.hrPeriods ?? 0}, hrPeriodRows ${stats.rangeDocs.hrPeriodRows ?? 0})`,
            )
            .join("; ") +
          "\n",
      );
    for (const pages of walks) {
      expect(
        pages.flatMap(({ page }) => page.page.map((row) => row.code)),
      ).toEqual(
        Array.from(
          { length: EMPLOYEES },
          (_, index) => `M${String(index).padStart(2, "0")}`,
        ),
      );
      for (const { page, stats } of pages) {
        // Locks are exactly the per-cell rule: recorded, then period-closed,
        // then frozen, then (here) open.
        for (const row of page.page) {
          const index = Number(row.code.slice(1));
          expect(row.cells.map((cell) => cell.lock)).toEqual(
            DAYS.map((day) =>
              recorded(day)
                ? "RECORDED"
                : day <= 15
                  ? "PERIOD_CLOSED"
                  : index < FROZEN_EMPLOYEES
                    ? "FROZEN"
                    : null,
            ),
          );
        }
        // The former per-cell rule: one lookup per cell that is neither
        // recorded nor period-closed (14 per employee here).
        const perCell = page.page
          .flatMap((row) => row.cells)
          .filter(
            (cell) => !cell.recorded && cell.lock !== "PERIOD_CLOSED",
          ).length;
        expect(perCell).toBe(page.page.length * 14);
        // Now one range per employee over the open half, plus point lookups
        // after the bound for the employee with three versions.
        const revised = page.page.some((row) => row.code === "M01");
        expect(stats.ranges.hrPeriodRows ?? 0).toBe(
          page.page.length + (revised ? 5 : 0),
        );
        // Frozen rows under the closed half are never read.
        expect(stats.rangeDocs.hrPeriodRows ?? 0).toBe(
          page.page.filter(
            (row) => Number(row.code.slice(1)) < FROZEN_EMPLOYEES,
          ).length *
            16 +
            (revised ? 32 - 16 + 5 : 0),
        );
        // Only this month's two periods, not the 24 earlier ones.
        expect(stats.rangeDocs.hrPeriods ?? 0).toBe(2);
        // Per employee: assignments, attendance, claims and frozen plans,
        // plus about a dozen site, scan and authorization reads per page.
        expect(queriesOf(stats)).toBeLessThanOrEqual(
          page.page.length * 4 + (revised ? 5 : 0) + 15,
        );
      }
    }
  }, 120_000);
});
