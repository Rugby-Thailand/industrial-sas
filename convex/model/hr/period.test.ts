import { describe, expect, it } from "vitest";

import { fromLocal } from "./calendar";
import {
  attendanceCsvFileName,
  CSV_V1_COLUMNS,
  formulaSafe,
  renderAttendanceCsv,
} from "./csv";
import { validateEmployeeDraft } from "./employee";
import {
  buildPeriodRows,
  closeBlocker,
  periodTotals,
  rangesOverlap,
  validatePeriodRange,
  type PeriodEmployee,
} from "./period";

const OFFSET = 420;
const at = (date: string, minute: number) => fromLocal(date, minute, OFFSET);

const employees: PeriodEmployee[] = [
  {
    id: "e2",
    code: "EMP-002",
    name: "Wipa",
    employment: { startDate: "2026-01-01" },
    schedule: {
      workDays: [1, 2, 3, 4, 5],
      startTime: "08:30",
      endTime: "17:30",
      endsNextDay: false,
      breakMinutes: 60,
    },
  },
  {
    id: "e1",
    code: "EMP-001",
    name: "Somchai",
    employment: { startDate: "2026-10-06", endDate: "2026-10-07" },
    schedule: {
      workDays: [1, 2, 3, 4, 5],
      startTime: "08:30",
      endTime: "17:30",
      endsNextDay: false,
      breakMinutes: 60,
    },
  },
];

describe("period ranges", () => {
  it("validates real, ordered and bounded ranges", () => {
    expect(validatePeriodRange("2026-10-01", "2026-10-31")).toEqual({
      ok: true,
      value: { days: 31 },
    });
    expect(validatePeriodRange("2026-10-01", "2026-11-01")).toMatchObject({
      ok: false,
      error: { code: "PERIOD_TOO_LARGE" },
    });
    expect(validatePeriodRange("2026-10-05", "2026-10-01")).toMatchObject({
      ok: false,
      error: { code: "PERIOD_RANGE_INVALID" },
    });
    expect(validatePeriodRange("2026-02-30", "2026-03-01")).toMatchObject({
      ok: false,
      error: { code: "PERIOD_DATE_INVALID" },
    });
  });

  it("detects overlapping inclusive ranges", () => {
    const a = { startDate: "2026-10-01", endDate: "2026-10-15" };
    expect(
      rangesOverlap(a, { startDate: "2026-10-15", endDate: "2026-10-31" }),
    ).toBe(true);
    expect(
      rangesOverlap(a, { startDate: "2026-10-16", endDate: "2026-10-31" }),
    ).toBe(false);
  });
});

describe("period rows", () => {
  const build = (recorded = new Map<string, number>()) =>
    buildPeriodRows({
      startDate: "2026-10-05",
      endDate: "2026-10-11",
      employees,
      offsetMinutes: OFFSET,
      now: at("2026-10-12", 600),
      holidayName: (date) =>
        date === "2026-10-09" ? "Site holiday" : undefined,
      recorded: (employeeId, date) => {
        const start = recorded.get(`${employeeId}:${date}`);
        if (start === undefined) return undefined;
        return {
          plan: {
            kind: "SCHEDULED",
            startAt: at(date, 510),
            endAt: at(date, 1050),
            breakMinutes: 60,
            startTime: "08:30",
            endTime: "17:30",
            endsNextDay: false,
          },
          revision: 1,
          clockInAt: start,
          clockOutAt: start + 9 * 3_600_000,
        };
      },
      pending: () => false,
    });

  it("generates scheduled days without attendance so an empty period is not complete", () => {
    const rows = build();
    expect(
      rows.map((row) => `${row.employeeCode}:${row.businessDate}`),
    ).toEqual([
      "EMP-001:2026-10-06",
      "EMP-001:2026-10-07",
      "EMP-002:2026-10-05",
      "EMP-002:2026-10-06",
      "EMP-002:2026-10-07",
      "EMP-002:2026-10-08",
      "EMP-002:2026-10-09",
      "EMP-002:2026-10-10",
      "EMP-002:2026-10-11",
    ]);
    const totals = periodTotals(rows);
    expect(totals).toMatchObject({
      employees: 2,
      days: 9,
      exceptions: 6,
      nonworkingDays: 3,
    });
    expect(
      closeBlocker({ endDate: "2026-10-11", today: "2026-10-12", rows }),
    ).toBe("PERIOD_NOT_READY");
  });

  it("totals match the row values and closes when every day is ready", () => {
    const recorded = new Map<string, number>();
    for (const [id, date] of [
      ["e1", "2026-10-06"],
      ["e1", "2026-10-07"],
      ["e2", "2026-10-05"],
      ["e2", "2026-10-06"],
      ["e2", "2026-10-07"],
      ["e2", "2026-10-08"],
    ] as const)
      recorded.set(`${id}:${date}`, at(date, 510));
    const rows = build(recorded);
    const totals = periodTotals(rows);
    expect(totals.workedMinutes).toBe(
      rows.reduce((sum, row) => sum + row.workedMinutes, 0),
    );
    expect(totals.workedMinutes).toBe(6 * 480);
    expect(totals.exceptions).toBe(0);
    expect(
      closeBlocker({ endDate: "2026-10-11", today: "2026-10-12", rows }),
    ).toBeNull();
    expect(
      closeBlocker({ endDate: "2026-10-11", today: "2026-10-11", rows }),
    ).toBe("PERIOD_INCLUDES_FUTURE");
  });
});

describe("CSV v1", () => {
  const version = {
    periodId: "p1",
    version: 2,
    siteCode: "HQ",
    timezone: "Asia/Bangkok",
    startDate: "2026-10-01",
    endDate: "2026-10-31",
  };

  it("quotes Thai, comma, quote and newline text and neutralises formulas (A13)", () => {
    const csv = renderAttendanceCsv(version, [
      {
        employeeCode: "=HYPERLINK(1)",
        employeeName: 'สมชาย "ใจดี", Jr.\nline',
        businessDate: "2026-10-08",
        plannedStartAt: at("2026-10-08", 510),
        plannedEndAt: at("2026-10-08", 1050),
        actualStartAt: at("2026-10-08", 503),
        actualEndAt: at("2026-10-08", 1060),
        workedMinutes: 497,
        outsideShiftMinutes: 17,
        disposition: "WORKED",
        correctionReason: "+forgot",
      },
      {
        employeeCode: "EMP-002",
        employeeName: "-Minus",
        businessDate: "2026-10-09",
        workedMinutes: 0,
        outsideShiftMinutes: 0,
        disposition: "ABSENT",
      },
    ]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe(CSV_V1_COLUMNS.join(","));
    expect(lines[1]).toBe(
      [
        "p1",
        "2",
        "HQ",
        "'=HYPERLINK(1)",
        '"สมชาย ""ใจดี"", Jr.\nline"',
        "2026-10-08",
        "Asia/Bangkok",
        "2026-10-08T01:30:00Z",
        "2026-10-08T10:30:00Z",
        "2026-10-08T01:23:00Z",
        "2026-10-08T10:40:00Z",
        "497",
        "17",
        "WORKED",
        "'+forgot",
      ].join(","),
    );
    expect(lines[2]).toBe(
      "p1,2,HQ,EMP-002,'-Minus,2026-10-09,Asia/Bangkok,,,,,0,0,ABSENT,",
    );
    expect(csv.endsWith("\r\n")).toBe(true);
    // Repeatable for the same frozen rows.
    expect(renderAttendanceCsv(version, [])).toBe(
      renderAttendanceCsv(version, []),
    );
  });

  it("names the file by site, range and version", () => {
    expect(attendanceCsvFileName({ ...version, siteCode: "HQ/1 ไทย" })).toBe(
      // "/", " " and the three Thai letters each become "_".
      "attendance_HQ_1_____2026-10-01_2026-10-31_v2.csv",
    );
    expect(formulaSafe("@SUM")).toBe("'@SUM");
    expect(formulaSafe("Normal")).toBe("Normal");
  });
});

describe("employee drafts", () => {
  it("normalises codes and refuses self-supervision", () => {
    expect(
      validateEmployeeDraft({
        code: " emp-001 ",
        displayName: "  Somchai   Jaidee ",
        employmentStartDate: "2026-01-01",
      }),
    ).toMatchObject({
      ok: true,
      value: { code: "EMP-001", displayName: "Somchai Jaidee" },
    });
    expect(
      validateEmployeeDraft({
        code: "EMP-1",
        displayName: "A",
        employmentStartDate: "2026-01-01",
        userId: "u1",
        supervisorUserId: "u1",
      }),
    ).toMatchObject({ ok: false, error: { code: "SELF_SUPERVISOR" } });
    expect(
      validateEmployeeDraft({
        code: "EMP-1",
        displayName: "A",
        employmentStartDate: "2026-02-01",
        employmentEndDate: "2026-01-01",
      }),
    ).toMatchObject({ ok: false, error: { code: "EMPLOYMENT_RANGE_INVALID" } });
  });
});
