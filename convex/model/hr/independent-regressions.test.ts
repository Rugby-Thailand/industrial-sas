import { describe, expect, it } from "vitest";

import { outsideShiftMinutes } from "./attendance";
import { fromLocal } from "./calendar";
import { formulaSafe, renderAttendanceCsv } from "./csv";
import { planFor } from "./schedule";

describe("HR export accuracy regressions", () => {
  const at = (minute: number, seconds = 0) =>
    fromLocal("2026-10-08", minute, 420) + seconds * 1_000;
  const plan = planFor({
    date: "2026-10-08",
    offsetMinutes: 420,
    holidayName: undefined,
    schedule: {
      workDays: [1, 2, 3, 4, 5],
      startTime: "08:30",
      endTime: "17:30",
      endsNextDay: false,
      breakMinutes: 0,
    },
  });

  it("does not invent an outside minute from ten seconds before a shift", () => {
    expect(outsideShiftMinutes(plan, at(509, 50), at(1040, 50))).toBe(0);
  });

  it("rounds the actual outside duration after subtracting overlap", () => {
    expect(outsideShiftMinutes(plan, at(511, 15), at(1050, 45))).toBe(0);
    expect(outsideShiftMinutes(plan, at(509, 15), at(1050, 45))).toBe(1);
  });

  // OWASP includes LF among formula-triggering prefixes:
  // https://community.owasp.org/attacks/CSV_Injection
  it("neutralises a line-feed-prefixed formula in a user text cell", () => {
    expect(formulaSafe("\n=1+1")).toBe("'\n=1+1");
    const csv = renderAttendanceCsv(
      {
        periodId: "period-1",
        version: 1,
        siteCode: "HQ",
        timezone: "Asia/Bangkok",
        startDate: "2026-10-08",
        endDate: "2026-10-08",
      },
      [
        {
          employeeCode: "EMP-001",
          employeeName: "\n=1+1",
          businessDate: "2026-10-08",
          workedMinutes: 0,
          outsideShiftMinutes: 0,
          disposition: "ABSENT",
        },
      ],
    );
    expect(csv).toContain('"\'\n=1+1"');
  });
});
