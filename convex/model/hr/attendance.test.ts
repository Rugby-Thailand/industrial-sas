import { describe, expect, it } from "vitest";

import {
  applyAttendanceCorrection,
  applyClockIntent,
  businessDateAt,
  validateLeaveRange,
} from "./attendance";

describe("HR attendance domain", () => {
  it("accepts the full shift and break sequence", () => {
    const clockIn = applyClockIntent(null, "CLOCK_IN", 1_000);
    expect(clockIn.ok).toBe(true);
    if (!clockIn.ok) return;
    const breakStart = applyClockIntent(clockIn.value, "BREAK_START", 61_000);
    expect(breakStart.ok).toBe(true);
    if (!breakStart.ok) return;
    const breakEnd = applyClockIntent(breakStart.value, "BREAK_END", 661_000);
    expect(breakEnd).toMatchObject({ ok: true, value: { breakMinutes: 10 } });
    if (!breakEnd.ok) return;
    expect(
      applyClockIntent(breakEnd.value, "CLOCK_OUT", 1_000_000),
    ).toMatchObject({
      ok: true,
      value: { status: "CLOSED", clockOutAt: 1_000_000 },
    });
  });

  it("refuses duplicates and impossible ordering", () => {
    const open = { status: "OPEN" as const, clockInAt: 100, breakMinutes: 0 };
    expect(applyClockIntent(open, "CLOCK_IN", 200)).toMatchObject({
      ok: false,
      error: { code: "IMPOSSIBLE_SEQUENCE" },
    });
    expect(applyClockIntent(open, "CLOCK_OUT", 99)).toMatchObject({
      ok: false,
      error: { code: "TIME_REGRESSION" },
    });
  });

  it("applies a traceable corrected interval without changing the original event", () => {
    expect(
      applyAttendanceCorrection(
        {
          status: "CLOSED",
          clockInAt: 1_000,
          clockOutAt: 3_601_000,
          breakMinutes: 0,
        },
        500,
        3_601_500,
        10,
      ),
    ).toMatchObject({
      ok: true,
      value: { status: "CORRECTED", clockInAt: 500 },
    });
  });

  it("derives the Bangkok business date at the UTC boundary", () => {
    expect(businessDateAt(Date.UTC(2026, 7, 17, 18), "Asia/Bangkok")).toBe(
      "2026-08-18",
    );
  });

  it("validates leave ranges and bounded hourly leave", () => {
    expect(validateLeaveRange("2026-08-18", "2026-08-17")).toMatchObject({
      ok: false,
    });
    expect(validateLeaveRange("2026-08-17", "2026-08-17", 2)).toMatchObject({
      ok: true,
    });
  });
});
