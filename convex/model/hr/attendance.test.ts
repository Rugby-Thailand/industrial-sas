import { describe, expect, it } from "vitest";

import {
  evaluateDay,
  outsideShiftMinutes,
  resolveProposedInterval,
  workedMinutes,
} from "./attendance";
import { fromLocal } from "./calendar";
import {
  planFor,
  resolveClockInDate,
  validateSchedule,
  type DayPlan,
  type Schedule,
} from "./schedule";

const OFFSET = 420;
const DAY: Schedule = {
  workDays: [1, 2, 3, 4, 5],
  startTime: "08:30",
  endTime: "17:30",
  endsNextDay: false,
  breakMinutes: 60,
};
const NIGHT: Schedule = {
  workDays: [1, 2, 3, 4, 5, 6, 7],
  startTime: "22:00",
  endTime: "06:00",
  endsNextDay: true,
  breakMinutes: 30,
};
const at = (date: string, hhmm: string, nextDay = false) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return fromLocal(date, h * 60 + m + (nextDay ? 1440 : 0), OFFSET);
};
const plan = (date: string, schedule: Schedule, holiday?: string): DayPlan =>
  planFor({ date, schedule, holidayName: holiday, offsetMinutes: OFFSET });

describe("schedule validation", () => {
  it("accepts a day shift and an overnight shift", () => {
    expect(validateSchedule(DAY).ok).toBe(true);
    expect(validateSchedule(NIGHT).ok).toBe(true);
  });

  it.each([
    [{ ...DAY, endTime: "08:00" }, "SCHEDULE_DURATION_INVALID"],
    [{ ...DAY, endsNextDay: true }, "SCHEDULE_DURATION_INVALID"],
    [{ ...DAY, breakMinutes: 540 }, "SCHEDULE_BREAK_INVALID"],
    [{ ...DAY, breakMinutes: -1 }, "SCHEDULE_BREAK_INVALID"],
    [{ ...DAY, workDays: [8] }, "SCHEDULE_DAYS_INVALID"],
    [{ ...DAY, workDays: [0, 7] }, "SCHEDULE_DAYS_INVALID"],
    [{ ...DAY, workDays: [1, 1] }, "SCHEDULE_DAYS_INVALID"],
    [{ ...DAY, startTime: "8:30" }, "SCHEDULE_TIME_INVALID"],
  ])("rejects %j", (schedule, code) => {
    const result = validateSchedule(schedule);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(code);
  });
});

describe("planned days", () => {
  it("treats holidays and unscheduled weekdays as nonworking", () => {
    expect(plan("2026-10-08", DAY)).toMatchObject({ kind: "SCHEDULED" });
    expect(plan("2026-10-10", DAY)).toMatchObject({
      kind: "NONWORKING",
      reason: "UNSCHEDULED",
    });
    expect(plan("2026-10-13", DAY, "Memorial day")).toMatchObject({
      kind: "NONWORKING",
      reason: "HOLIDAY",
      holidayName: "Memorial day",
    });
  });

  it("puts an overnight shift end on the following calendar date", () => {
    const night = plan("2026-10-08", NIGHT);
    expect(night).toMatchObject({
      kind: "SCHEDULED",
      startAt: at("2026-10-08", "22:00"),
      endAt: at("2026-10-09", "06:00"),
    });
  });

  it("assigns a late overnight clock-in to the shift's start date (A5)", () => {
    const planOf = (date: string) => plan(date, NIGHT);
    expect(
      resolveClockInDate({
        now: at("2026-10-09", "00:40"),
        offsetMinutes: OFFSET,
        planOf,
        hasClockIn: () => false,
      }),
    ).toBe("2026-10-08");
    expect(
      resolveClockInDate({
        now: at("2026-10-09", "00:40"),
        offsetMinutes: OFFSET,
        planOf,
        hasClockIn: (date) => date === "2026-10-08",
      }),
    ).toBe("2026-10-09");
    expect(
      resolveClockInDate({
        now: at("2026-10-08", "21:55"),
        offsetMinutes: OFFSET,
        planOf,
        hasClockIn: () => false,
      }),
    ).toBe("2026-10-08");
  });
});

describe("day evaluation", () => {
  const base = { revision: 1, pendingCorrection: false };

  it("reports a complete ordinary day as ready with break-deducted minutes", () => {
    const result = evaluateDay({
      ...base,
      plan: plan("2026-10-08", DAY),
      now: at("2026-10-09", "09:00"),
      clockInAt: at("2026-10-08", "08:23"),
      clockOutAt: at("2026-10-08", "17:40"),
    });
    expect(result).toMatchObject({
      status: "READY",
      disposition: "WORKED",
      workedMinutes: 557 - 60,
      outsideShiftMinutes: 7 + 10,
    });
  });

  it("computes overnight minutes on the start date (A5)", () => {
    const result = evaluateDay({
      ...base,
      plan: plan("2026-10-08", NIGHT),
      now: at("2026-10-09", "12:00"),
      clockInAt: at("2026-10-08", "22:00"),
      clockOutAt: at("2026-10-09", "06:00"),
    });
    expect(result).toMatchObject({
      status: "READY",
      workedMinutes: 480 - 30,
      outsideShiftMinutes: 0,
    });
  });

  it("marks a nonworking date without events as nonworking, not absent (A6)", () => {
    expect(
      evaluateDay({
        ...base,
        plan: plan("2026-10-13", DAY, "Holiday"),
        now: at("2026-10-20", "09:00"),
      }),
    ).toMatchObject({
      status: "READY",
      disposition: "NONWORKING",
      workedMinutes: 0,
    });
  });

  it("flags missing days and missing ends after the shift (A7)", () => {
    const missing = evaluateDay({
      ...base,
      plan: plan("2026-10-08", DAY),
      now: at("2026-10-09", "09:00"),
    });
    expect(missing).toMatchObject({
      status: "EXCEPTION",
      issue: "MISSING_RECORD",
    });
    const open = {
      ...base,
      plan: plan("2026-10-08", DAY),
      clockInAt: at("2026-10-08", "08:30"),
    };
    expect(
      evaluateDay({ ...open, now: at("2026-10-08", "17:00") }),
    ).toMatchObject({ status: "IN_PROGRESS" });
    expect(
      evaluateDay({ ...open, now: at("2026-10-09", "01:00") }),
    ).toMatchObject({ status: "EXCEPTION", issue: "MISSING_END" });
    expect(
      evaluateDay({
        ...base,
        plan: plan("2026-10-08", DAY),
        now: at("2026-10-08", "12:00"),
      }),
    ).toMatchObject({ status: "UPCOMING" });
  });

  it("flags unplanned work and implausible intervals", () => {
    expect(
      evaluateDay({
        ...base,
        plan: plan("2026-10-10", DAY),
        now: at("2026-10-11", "09:00"),
        clockInAt: at("2026-10-10", "09:00"),
        clockOutAt: at("2026-10-10", "12:00"),
      }),
    ).toMatchObject({ status: "EXCEPTION", issue: "UNPLANNED_WORK" });
    expect(
      evaluateDay({
        ...base,
        plan: plan("2026-10-08", DAY),
        now: at("2026-10-10", "09:00"),
        clockInAt: at("2026-10-08", "08:00"),
        clockOutAt: at("2026-10-09", "08:00"),
      }),
    ).toMatchObject({ status: "EXCEPTION", issue: "IMPLAUSIBLE" });
  });

  it("uses a certification only for the revision it was made against", () => {
    const input = {
      plan: plan("2026-10-08", DAY),
      now: at("2026-10-09", "09:00"),
      pendingCorrection: false,
      certification: { disposition: "ABSENT" as const, revision: 3 },
    };
    expect(evaluateDay({ ...input, revision: 3 })).toMatchObject({
      status: "READY",
      disposition: "ABSENT",
      workedMinutes: 0,
      certified: true,
    });
    expect(evaluateDay({ ...input, revision: 4 })).toMatchObject({
      status: "EXCEPTION",
      issue: "MISSING_RECORD",
    });
  });

  it("keeps a day with a pending correction unresolved", () => {
    expect(
      evaluateDay({
        ...base,
        plan: plan("2026-10-08", DAY),
        now: at("2026-10-09", "09:00"),
        clockInAt: at("2026-10-08", "08:30"),
        clockOutAt: at("2026-10-08", "17:30"),
        pendingCorrection: true,
      }),
    ).toMatchObject({ status: "EXCEPTION", issue: "PENDING_CORRECTION" });
  });

  it("floors worked minutes at zero and reports outside minutes for information", () => {
    const start = at("2026-10-08", "09:00");
    expect(workedMinutes(start, start + 20 * 60_000, 60)).toBe(0);
    expect(
      outsideShiftMinutes(plan("2026-10-10", DAY), start, start + 60 * 60_000),
    ).toBe(60);
  });
});

describe("proposed corrections", () => {
  const now = at("2026-10-09", "09:00");

  it("fills a missing end from the original start (A8)", () => {
    const result = resolveProposedInterval({
      businessDate: "2026-10-08",
      offsetMinutes: OFFSET,
      now,
      end: { minute: 17 * 60 + 30, nextDay: false },
      originalStartAt: at("2026-10-08", "08:29"),
    });
    expect(result).toEqual({
      ok: true,
      value: {
        startAt: at("2026-10-08", "08:29"),
        endAt: at("2026-10-08", "17:30"),
      },
    });
  });

  it.each([
    [{}, "CORRECTION_INCOMPLETE"],
    [
      {
        start: { minute: 600, nextDay: false },
        end: { minute: 540, nextDay: false },
      },
      "CORRECTION_ORDER_INVALID",
    ],
    [
      {
        start: { minute: 0, nextDay: false },
        end: { minute: 1200, nextDay: false },
      },
      "CORRECTION_TOO_LONG",
    ],
    [
      {
        start: { minute: 600, nextDay: true },
        end: { minute: 700, nextDay: true },
      },
      "CORRECTION_IN_FUTURE",
    ],
    [
      {
        start: { minute: 2000, nextDay: false },
        end: { minute: 0, nextDay: true },
      },
      "CORRECTION_TIME_INVALID",
    ],
  ])("rejects %j", (sides, code) => {
    const result = resolveProposedInterval({
      businessDate: "2026-10-08",
      offsetMinutes: OFFSET,
      now,
      ...sides,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(code);
  });
});
