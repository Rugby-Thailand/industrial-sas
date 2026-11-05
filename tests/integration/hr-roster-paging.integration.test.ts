import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";
import * as roster from "../../convex/hr/roster";
import { fromLocal } from "../../convex/model/hr/calendar";
import {
  createConvexTenantWorld,
  seedConvexAuthorization,
  type ConvexTenantWorld,
} from "../fixtures/convex-tenant-world";
import {
  measured,
  settlePage,
  type ReadStats,
} from "../fixtures/query-read-stats";

/**
 * The monthly roster pages employees server-side: any site size, filters
 * applied while scanning, and per-page reads proportional to the employees
 * on the page (no site-wide month load).
 *
 * Parity: `tests/fixtures/hr-roster-legacy-parity.json` holds the answer of
 * the previous, unpaged implementation (one 50-employee capped read) for a
 * site with every cell state. It was captured from that implementation with
 *   CAPTURE_ROSTER_PARITY=1 pnpm exec vitest run --project integration \
 *     tests/integration/hr-roster-paging.integration.test.ts
 * before the paging change (then formatted with Prettier), and must not be
 * refreshed from the new code.
 */

const MONTH = "2026-10";
const SNAPSHOT = join(
  process.cwd(),
  "tests/fixtures/hr-roster-legacy-parity.json",
);
const CAPTURE = process.env.CAPTURE_ROSTER_PARITY === "1";

const WEEKLY = {
  workDays: [1, 2, 3, 4, 5],
  startTime: "09:00",
  endTime: "18:00",
  endsNextDay: false,
  breakMinutes: 60,
};
const date = (day: number) => `${MONTH}-${String(day).padStart(2, "0")}`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 9, 20, 3));
});
afterEach(() => vi.useRealTimers());

async function world() {
  const value = await createConvexTenantWorld({
    "../convex/hr/roster.ts": () => import("../../convex/hr/roster"),
  });
  await seedConvexAuthorization(value, {
    roleA: "HR_ADMIN",
    roleB: "HR_ADMIN",
  });
  return value;
}

type EmployeeSeed = {
  code: string;
  displayName?: string;
  warehouseId?: Id<"warehouses">;
  status?: "ACTIVE" | "INACTIVE";
  employmentStartDate?: string;
  employmentEndDate?: string;
  employmentIntervals?: { startDate: string; endDate?: string }[];
  schedule?: typeof WEEKLY | null;
  departmentId?: Id<"hrDepartments">;
};

function seeder(w: ConvexTenantWorld) {
  const audit = {
    version: 1,
    createdAt: 1,
    createdByUserId: w.userA,
    updatedAt: 1,
    updatedByUserId: w.userA,
  };
  return {
    department: (name: string) =>
      w.t.run((ctx) =>
        ctx.db.insert("hrDepartments", {
          orgId: w.orgA,
          name,
          nameKey: name.toLowerCase(),
          status: "ACTIVE",
          ...audit,
        }),
      ),
    employees: (seeds: readonly EmployeeSeed[]) =>
      w.t.run(async (ctx) => {
        const ids: Id<"hrEmployees">[] = [];
        for (const seed of seeds) {
          const { schedule, ...fields } = seed;
          ids.push(
            await ctx.db.insert("hrEmployees", {
              orgId: w.orgA,
              warehouseId: w.warehouses.alphaA,
              displayName: `Employee ${seed.code}`,
              employmentStartDate: "2026-01-05",
              status: "ACTIVE",
              ...(schedule === null ? {} : { schedule: schedule ?? WEEKLY }),
              ...fields,
              ...audit,
            }),
          );
        }
        return ids;
      }),
    day: (
      employeeId: Id<"hrEmployees">,
      businessDate: string,
      warehouseId: Id<"warehouses"> = w.warehouses.alphaA,
    ) =>
      w.t.run((ctx) =>
        ctx.db.insert("hrAttendanceDays", {
          orgId: w.orgA,
          warehouseId,
          employeeId,
          businessDate,
          plan: {
            kind: "SCHEDULED",
            startTime: "07:00",
            endTime: "16:00",
            endsNextDay: false,
            startAt: fromLocal(businessDate, 420, 420),
            endAt: fromLocal(businessDate, 960, 420),
            breakMinutes: 60,
          },
          open: false,
          revision: 0,
          createdAt: 1,
          updatedAt: 1,
        }),
      ),
    days: (rows: readonly [Id<"hrEmployees">, string][]) =>
      w.t.run(async (ctx) => {
        for (const [employeeId, businessDate] of rows)
          await ctx.db.insert("hrAttendanceDays", {
            orgId: w.orgA,
            warehouseId: w.warehouses.alphaA,
            employeeId,
            businessDate,
            plan: {
              kind: "NONWORKING",
              reason: "UNSCHEDULED",
              breakMinutes: 0,
            },
            open: false,
            revision: 0,
            createdAt: 1,
            updatedAt: 1,
          });
      }),
    shift: () =>
      w.t.run((ctx) =>
        ctx.db.insert("hrShifts", {
          orgId: w.orgA,
          warehouseId: w.warehouses.alphaA,
          code: "DAY",
          name: "Day shift",
          color: "sky",
          status: "ACTIVE",
          startTime: "08:00",
          endTime: "17:00",
          endsNextDay: false,
          breakMinutes: 60,
          version: 2,
          createdAt: 1,
          createdByUserId: w.userA,
          updatedAt: 1,
          updatedByUserId: w.userA,
        }),
      ),
    assignment: (
      employeeId: Id<"hrEmployees">,
      businessDate: string,
      kind: "SHIFT" | "OFF" | "CLEARED",
      revision: number,
      shiftId?: Id<"hrShifts">,
      warehouseId: Id<"warehouses"> = w.warehouses.alphaA,
    ) =>
      w.t.run((ctx) =>
        ctx.db.insert("hrRosterAssignments", {
          orgId: w.orgA,
          warehouseId,
          employeeId,
          businessDate,
          kind,
          ...(kind === "SHIFT" && shiftId
            ? {
                shift: {
                  shiftId,
                  code: "DAY",
                  name: "Day shift",
                  color: "sky" as const,
                  version: 1,
                  startTime: "08:00",
                  endTime: "17:00",
                  endsNextDay: false,
                  breakMinutes: 60,
                },
              }
            : {}),
          revision,
          createdAt: 1,
          updatedAt: 1,
          updatedByUserId: w.userA,
        }),
      ),
    holiday: (day: string, name: string) =>
      w.t.run((ctx) =>
        ctx.db.insert("hrHolidays", {
          orgId: w.orgA,
          warehouseId: w.warehouses.alphaA,
          date: day,
          name,
          createdAt: 1,
          createdByUserId: w.userA,
        }),
      ),
    period: (
      startDate: string,
      endDate: string,
      status: "DRAFT" | "CLOSING" | "CLOSED",
    ) =>
      w.t.run((ctx) =>
        ctx.db.insert("hrPeriods", {
          orgId: w.orgA,
          warehouseId: w.warehouses.alphaA,
          startDate,
          endDate,
          status,
          draftVersion: 1,
          latestClosedVersion: status === "DRAFT" ? 0 : 1,
          createdAt: 1,
          updatedAt: 1,
          createdByUserId: w.userA,
          updatedByUserId: w.userA,
        }),
      ),
    /** A frozen (closed-version) row for one employee/date, at another site. */
    frozen: (employeeId: Id<"hrEmployees">, businessDate: string) =>
      w.t.run(async (ctx) => {
        const periodId = await ctx.db.insert("hrPeriods", {
          orgId: w.orgA,
          warehouseId: w.warehouses.bravoA,
          startDate: businessDate,
          endDate: businessDate,
          status: "CLOSED",
          draftVersion: 1,
          latestClosedVersion: 1,
          createdAt: 1,
          updatedAt: 1,
          createdByUserId: w.userA,
          updatedByUserId: w.userA,
        });
        const versionId = await ctx.db.insert("hrPeriodVersions", {
          orgId: w.orgA,
          warehouseId: w.warehouses.bravoA,
          periodId,
          version: 1,
          startDate: businessDate,
          endDate: businessDate,
          timezone: "Asia/Bangkok",
          siteCode: "B",
          siteName: "Bravo",
          fingerprint: "frozen",
          totals: {
            employees: 1,
            days: 1,
            workedMinutes: 0,
            outsideShiftMinutes: 0,
            absentDays: 0,
            leaveDays: 0,
            nonworkingDays: 1,
          },
          closedByUserId: w.userA,
          closedAt: 1,
        });
        await ctx.db.insert("hrPeriodRows", {
          orgId: w.orgA,
          versionId,
          employeeId,
          employeeCode: "X",
          employeeName: "X",
          businessDate,
          plan: { kind: "NONWORKING", reason: "UNSCHEDULED", breakMinutes: 0 },
          workedMinutes: 0,
          outsideShiftMinutes: 0,
          disposition: "NONWORKING",
        });
      }),
    /** An active leave claim; the request row itself is not read by the roster. */
    claim: (employeeId: Id<"hrEmployees">, businessDate: string) =>
      w.t.run(async (ctx) => {
        // The roster only reads the claim index. convex-test IDs end in the
        // table name, so this placeholder request ID keeps the fixture free
        // of leave policy setup; no request row is read.
        await ctx.db.insert("hrLeaveDayClaims", {
          orgId: w.orgA,
          employeeId,
          businessDate,
          leaveRequestId: employeeId.replace(
            /hrEmployees$/,
            "hrLeaveRequests",
          ) as Id<"hrLeaveRequests">,
        });
      }),
  };
}

/**
 * A site under 50 employees exercising every cell state: shift/OFF/cleared
 * rows, an old-site row (revision only), recorded days here and at another
 * site, closed/closing/draft periods, a frozen plan, a leave claim, a
 * holiday, mid-month hire, a rehire gap, an inactive employee, departments
 * (including a missing one), no schedule, and out-of-site/out-of-range rows.
 */
async function paritySite() {
  const w = await world();
  const seed = seeder(w);
  const sales = await seed.department("Sales");
  const ops = await seed.department("Operations");
  const gone = await seed.department("Gone");
  await w.t.run((ctx) => ctx.db.delete(gone));
  const seeds: EmployeeSeed[] = [
    { code: "A01", displayName: "Somchai Shift", departmentId: sales },
    { code: "A02", displayName: "Recorded Here", departmentId: ops },
    { code: "A03", displayName: "Moved In" },
    { code: "A04", employmentStartDate: "2026-10-14", departmentId: sales },
    { code: "A05", status: "INACTIVE" },
    { code: "A06", displayName: "Leave Claim" },
    { code: "A07", displayName: "Frozen Plan", departmentId: gone },
    {
      code: "A08",
      employmentStartDate: "2025-01-01",
      employmentEndDate: "2026-09-30",
    },
    { code: "A09", warehouseId: w.warehouses.bravoA },
    {
      code: "A10",
      employmentStartDate: "2025-01-01",
      employmentIntervals: [
        { startDate: "2025-01-01", endDate: "2026-10-09" },
        { startDate: "2026-10-23" },
      ],
    },
    { code: "A11", schedule: null, departmentId: ops },
    { code: "A12", employmentEndDate: "2026-10-05" },
    ...Array.from({ length: 4 }, (_, index) => ({
      code: `B${String(index).padStart(2, "0")}`,
      ...(index % 2 === 0 ? { departmentId: sales } : {}),
    })),
  ];
  const ids = await seed.employees(seeds);
  const codes = seeds.map((row) => row.code);
  const id = (code: string) => ids[codes.indexOf(code)]!;
  const [a01, a02, a03, a06, a07, a10] = [
    id("A01"),
    id("A02"),
    id("A03"),
    id("A06"),
    id("A07"),
    id("A10"),
  ] as const;
  const shift = await seed.shift();
  await seed.assignment(a01, date(5), "SHIFT", 2, shift);
  await seed.assignment(a01, date(6), "OFF", 1);
  await seed.assignment(a01, date(7), "CLEARED", 3);
  await seed.assignment(a01, date(15), "SHIFT", 1, shift);
  await seed.assignment(a03, date(8), "SHIFT", 4, shift, w.warehouses.bravoA);
  await seed.assignment(a10, date(24), "OFF", 1);
  await seed.day(a02, date(3));
  await seed.day(a02, date(21));
  await seed.day(a03, date(4), w.warehouses.bravoA);
  await seed.days([[a01, date(19)]]);
  await seed.holiday(date(15), "Festival");
  await seed.period(date(1), date(2), "CLOSED");
  await seed.period("2026-09-25", "2026-09-30", "CLOSED");
  await seed.period(date(28), date(28), "CLOSING");
  await seed.period(date(29), date(31), "DRAFT");
  await seed.frozen(a07, date(12));
  await seed.claim(a06, date(10));
  await seed.claim(a06, date(11));
  return { w, ids };
}

/** Replace generated IDs with stable labels so answers compare across runs. */
async function normalized(w: ConvexTenantWorld, value: unknown) {
  const entries = await w.t.run(async (ctx) => {
    const map = new Map<string, string>();
    for (const row of await ctx.db.query("hrEmployees").collect())
      map.set(row._id, `employee:${row.code}`);
    for (const row of await ctx.db.query("hrShifts").collect())
      map.set(row._id, `shift:${row.code}`);
    for (const row of await ctx.db.query("hrDepartments").collect())
      map.set(row._id, `department:${row.name}`);
    for (const [name, id] of Object.entries(w.warehouses))
      map.set(id, `site:${name}`);
    return [...map];
  });
  const labels = new Map(entries);
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "string" && labels.has(item) ? labels.get(item) : item,
    ),
  ) as unknown;
}

const totalDocs = (stats: ReadStats) =>
  Object.values(stats.rangeDocs).reduce((sum, value) => sum + value, 0) +
  Object.values(stats.gets).reduce((sum, value) => sum + value, 0);

type RosterPage = {
  ok: true;
  status: "ready" | "scanning" | "reset";
  isDone: boolean;
  continueCursor: string;
  scanCursor?: string;
  page: { id: string; code: string; departmentId: string | null }[];
  employees?: unknown;
};

/** Every page of one criteria set, as the client pager walks them. */
async function walk(
  w: ConvexTenantWorld,
  args: Record<string, unknown>,
  pageSize: 20 | 50,
) {
  const pages: { codes: string[]; docs: number; stats: ReadStats }[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 50; guard += 1) {
    const { result, stats } = await settlePage<RosterPage>(w, roster.roster, {
      warehouseId: w.warehouses.alphaA,
      month: MONTH,
      ...args,
      pageSize,
      ...(cursor ? { cursor } : {}),
    });
    expect(result.status).toBe("ready");
    pages.push({
      codes: result.page.map((row) => row.code),
      docs: totalDocs(stats),
      stats,
    });
    if (result.isDone) return pages;
    cursor = result.continueCursor;
  }
  throw new Error("roster pages did not finish");
}

describe("HR roster paging", () => {
  it("page 1 at 50 per page answers exactly like the unpaged roster for a site under 50 employees", async () => {
    const { w } = await paritySite();
    const criteria = [
      {},
      { search: "  somCHAI " },
      { search: "b0" },
      { departmentId: "" },
      { search: "nobody" },
    ];
    const sales = await w.t.run(
      async (ctx) =>
        (await ctx.db.query("hrDepartments").collect()).find(
          (row) => row.name === "Sales",
        )!._id,
    );
    const answers: Record<string, unknown> = {};
    for (const [index, args] of [
      ...criteria,
      { departmentId: sales },
    ].entries()) {
      const { value } = await measured<Record<string, unknown>>(
        w,
        roster.roster,
        {
          warehouseId: w.warehouses.alphaA,
          month: MONTH,
          ...args,
          ...(CAPTURE ? {} : { pageSize: 50 }),
        },
      );
      answers[String(index)] = await normalized(w, value);
    }
    type Answer = {
      employees?: { code: string }[];
      page?: { code: string }[];
      [key: string]: unknown;
    };
    const rowsOf = (answer: Answer) => answer.page ?? answer.employees ?? [];
    if (CAPTURE) {
      const {
        employees,
        totalEmployees: _total,
        ...site
      } = answers["0"] as Answer;
      const filtered = Object.fromEntries(
        Object.entries(answers)
          .slice(1)
          .map(([key, answer]) => [
            key,
            rowsOf(answer as Answer).map((row) => row.code),
          ]),
      );
      // One employee per line keeps a future parity failure reviewable.
      writeFileSync(
        SNAPSHOT,
        `{\n"site": ${JSON.stringify(site)},\n"filtered": ${JSON.stringify(filtered)},\n"employees": [\n${employees!
          .map((row) => JSON.stringify(row))
          .join(",\n")}\n]\n}\n`,
      );
      return;
    }
    const legacy = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as {
      site: Record<string, unknown>;
      filtered: Record<string, string[]>;
      employees: { code: string }[];
    };
    // The fixture is meaningful: every lock and assignment kind is present.
    const cells = JSON.stringify(legacy.employees);
    for (const text of [
      '"lock":"RECORDED"',
      '"lock":"PERIOD_CLOSED"',
      '"lock":"FROZEN"',
      '"lock":"LEAVE_CLAIMED"',
      '"lock":"NOT_EMPLOYED"',
      '"lock":"EMPLOYEE_INACTIVE"',
      '"kind":"SHIFT"',
      '"kind":"OFF"',
      '"departmentName":"Sales"',
    ])
      expect(cells).toContain(text);
    for (const [key, answer] of Object.entries(answers)) {
      const {
        page,
        status,
        isDone,
        continueCursor,
        scanned: _scanned,
        ...site
      } = answer as Answer;
      expect({ status, isDone, continueCursor }).toEqual({
        status: "ready",
        isDone: true,
        continueCursor: "",
      });
      if (key === "0") {
        expect(page).toEqual(legacy.employees);
        expect(site).toEqual(legacy.site);
      } else
        expect(
          (page as { code: string }[]).map((row) => row.code),
          `criteria ${key}`,
        ).toEqual(legacy.filtered[key]);
    }
    // Callers that predate paging (no pageSize) keep the `employees` rows.
    const { value: unpaged } = await measured<RosterPage>(w, roster.roster, {
      warehouseId: w.warehouses.alphaA,
      month: MONTH,
    });
    expect(await normalized(w, unpaged.employees)).toEqual(legacy.employees);
    // …once: the rows are not also sent as `page`.
    expect(unpaged).not.toHaveProperty("page");
  });

  it("pages a 153-employee site in index order with filters applied while scanning and bounded reads", async () => {
    const w = await world();
    const seed = seeder(w);
    const sales = await seed.department("Sales");
    const seeds: EmployeeSeed[] = [];
    for (let index = 0; index < 153; index += 1)
      seeds.push({
        code: `E${String(index).padStart(3, "0")}`,
        displayName: index % 10 === 7 ? `Seven ${index}` : `Person ${index}`,
        ...(index % 3 === 0 ? { departmentId: sales } : {}),
      });
    // Other sites and former employees are never part of this roster.
    for (let index = 0; index < 20; index += 1)
      seeds.push({
        code: `E${String(index * 7).padStart(3, "0")}X`,
        warehouseId: w.warehouses.bravoA,
      });
    seeds.push({
      code: "E050F",
      employmentStartDate: "2025-01-01",
      employmentEndDate: "2026-09-30",
    });
    const ids = await seed.employees(seeds);
    // Twenty recorded days for every site employee: a site-wide month load
    // would read all 3,060 of them on every page.
    const days: [Id<"hrEmployees">, string][] = [];
    for (const id of ids.slice(0, 153))
      for (let day = 1; day <= 20; day += 1) days.push([id, date(day)]);
    for (let start = 0; start < days.length; start += 500)
      await seed.days(days.slice(start, start + 500));
    const expected = seeds
      .slice(0, 153)
      .map((row) => row.code)
      .sort();
    // Clients that predate paging never receive a scanning answer they would
    // crash on: a narrow search over this 153-row site is refused instead.
    {
      const { value: narrow } = await measured(w, roster.roster, {
        warehouseId: w.warehouses.alphaA,
        month: MONTH,
        search: "Seven 1",
      });
      expect(narrow).toEqual({ ok: false, code: "LIMIT_EXCEEDED" });
      // Nor a silently truncated grid: like main, a site above the
      // 50-employee limit is refused rather than cut to its first 50.
      const { value: unpaged } = await measured<RosterPage>(w, roster.roster, {
        warehouseId: w.warehouses.alphaA,
        month: MONTH,
      });
      expect(unpaged).toEqual({ ok: false, code: "LIMIT_EXCEEDED" });
    }
    if (CAPTURE) {
      // Reads of the previous implementation, for the change record only.
      const over = await measured(w, roster.roster, {
        warehouseId: w.warehouses.alphaA,
        month: MONTH,
      });
      await w.t.run(async (ctx) => {
        for (const id of ids.slice(50, 153)) {
          for (const day of await ctx.db
            .query("hrAttendanceDays")
            .withIndex("by_orgId_employeeId_businessDate", (q) =>
              q.eq("orgId", w.orgA).eq("employeeId", id),
            )
            .collect())
            await ctx.db.delete(day._id);
          await ctx.db.delete(id);
        }
      });
      const under = await measured(w, roster.roster, {
        warehouseId: w.warehouses.alphaA,
        month: MONTH,
      });
      process.stderr.write(
        `legacy roster: 153 employees -> ${JSON.stringify(over.value).slice(0, 60)} docs=${totalDocs(over.stats)} ${JSON.stringify(over.stats.rangeDocs)}; 50 employees -> docs=${totalDocs(under.stats)} ${JSON.stringify(under.stats.rangeDocs)} gets=${JSON.stringify(under.stats.gets)}` +
          "\n",
      );
      return;
    }

    for (const pageSize of [20, 50] as const) {
      const pages = await walk(w, {}, pageSize);
      const codes = pages.flatMap((page) => page.codes);
      expect(codes).toEqual(expected);
      expect(new Set(codes).size).toBe(153);
      expect(pages).toHaveLength(Math.ceil(153 / pageSize));
      for (const page of pages) {
        // Days are read per page employee (≤ 31 each), never site-wide.
        expect(page.stats.rangeDocs.hrAttendanceDays ?? 0).toBeLessThanOrEqual(
          page.codes.length * 31,
        );
        // One native chunk per request; a page holding the former employee
        // needs a second chunk to fill.
        expect(page.stats.rangeDocs.hrEmployees ?? 0).toBeLessThanOrEqual(
          pageSize * 2,
        );
        // A site-wide month load alone is 3,060 day documents per request.
        expect(page.docs).toBeLessThan(pageSize * 23 + 200);
      }
      process.stderr.write(
        `roster pageSize=${pageSize} docs per page: ${pages
          .map((page) => page.docs)
          .join(", ")}` + "\n",
      );
    }

    // Search and department narrow pages instead of failing on the cap.
    const sevens = await walk(w, { search: "seven" }, 20);
    expect(sevens.flatMap((page) => page.codes)).toEqual(
      expected.filter((_code, index) => index % 10 === 7),
    );
    const department = await walk(w, { departmentId: sales }, 20);
    expect(department.flatMap((page) => page.codes)).toEqual(
      expected.filter((_code, index) => index % 3 === 0),
    );
    expect(department).toHaveLength(Math.ceil(51 / 20));
    const both = await walk(w, { search: "SEVEN", departmentId: sales }, 50);
    expect(both.flatMap((page) => page.codes)).toEqual(
      expected.filter((_code, index) => index % 10 === 7 && index % 3 === 0),
    );
  }, 60_000);

  it("refuses unsupported page sizes and resets a cursor bound to other criteria", async () => {
    if (CAPTURE) return;
    const w = await world();
    await seeder(w).employees(
      Array.from({ length: 25 }, (_, index) => ({ code: `R${index + 10}` })),
    );
    const { value: invalid } = await measured(w, roster.roster, {
      warehouseId: w.warehouses.alphaA,
      month: MONTH,
      pageSize: 100,
    });
    expect(invalid).toEqual({ ok: false, code: "PAGE_SIZE_INVALID" });
    const { value: first } = await measured<RosterPage>(w, roster.roster, {
      warehouseId: w.warehouses.alphaA,
      month: MONTH,
      pageSize: 20,
    });
    expect(first.isDone).toBe(false);
    const { value: other } = await measured<RosterPage>(w, roster.roster, {
      warehouseId: w.warehouses.alphaA,
      month: "2026-11",
      pageSize: 20,
      cursor: first.continueCursor,
    });
    expect(other).toMatchObject({ ok: true, status: "reset", page: [] });
  });
});
