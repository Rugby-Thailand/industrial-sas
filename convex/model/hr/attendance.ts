import { fail, ok, type Result } from "../result";

export type AttendanceEventKind =
  "CLOCK_IN" | "BREAK_START" | "BREAK_END" | "CLOCK_OUT" | "CORRECTION_APPLIED";

export type AttendanceDayStatus =
  "OPEN" | "ON_BREAK" | "CLOSED" | "CORRECTED" | "ANOMALY";

export type ClockIntent = Exclude<AttendanceEventKind, "CORRECTION_APPLIED">;

export interface AttendanceDayState {
  readonly status: AttendanceDayStatus;
  readonly clockInAt?: number;
  readonly breakStartedAt?: number;
  readonly breakMinutes: number;
  readonly clockOutAt?: number;
}

export type AttendanceErrorCode =
  "IMPOSSIBLE_SEQUENCE" | "TIME_REGRESSION" | "INVALID_CORRECTION";

const MINUTE_MS = 60_000;

/**
 * The small attendance state machine used by both handheld and supervisor flows.
 * It does not trust a device clock: ordering is checked against server receipt
 * time; device time is retained only as evidence.
 */
export function applyClockIntent(
  current: AttendanceDayState | null,
  kind: ClockIntent,
  serverReceivedAt: number,
): Result<AttendanceDayState, { readonly code: AttendanceErrorCode }> {
  if (current === null) {
    return kind === "CLOCK_IN"
      ? ok({ status: "OPEN", clockInAt: serverReceivedAt, breakMinutes: 0 })
      : fail({ code: "IMPOSSIBLE_SEQUENCE" });
  }

  const lastAt =
    current.clockOutAt ?? current.breakStartedAt ?? current.clockInAt ?? 0;
  if (serverReceivedAt < lastAt) return fail({ code: "TIME_REGRESSION" });

  if (current.status === "OPEN" && kind === "BREAK_START") {
    return ok({
      ...current,
      status: "ON_BREAK",
      breakStartedAt: serverReceivedAt,
    });
  }
  if (current.status === "ON_BREAK" && kind === "BREAK_END") {
    const started = current.breakStartedAt;
    if (started === undefined) return fail({ code: "IMPOSSIBLE_SEQUENCE" });
    const { breakStartedAt: _breakStartedAt, ...withoutOpenBreak } = current;
    return ok({
      ...withoutOpenBreak,
      status: "OPEN",
      breakMinutes:
        current.breakMinutes +
        Math.max(0, Math.round((serverReceivedAt - started) / MINUTE_MS)),
    });
  }
  if (current.status === "OPEN" && kind === "CLOCK_OUT") {
    return ok({ ...current, status: "CLOSED", clockOutAt: serverReceivedAt });
  }

  return fail({ code: "IMPOSSIBLE_SEQUENCE" });
}

export function applyAttendanceCorrection(
  current: AttendanceDayState,
  clockInAt: number,
  clockOutAt: number,
  breakMinutes: number,
): Result<AttendanceDayState, { readonly code: AttendanceErrorCode }> {
  if (
    !Number.isSafeInteger(clockInAt) ||
    !Number.isSafeInteger(clockOutAt) ||
    !Number.isSafeInteger(breakMinutes) ||
    clockOutAt <= clockInAt ||
    breakMinutes < 0 ||
    breakMinutes * MINUTE_MS >= clockOutAt - clockInAt
  ) {
    return fail({ code: "INVALID_CORRECTION" });
  }
  const { breakStartedAt: _breakStartedAt, ...withoutOpenBreak } = current;
  return ok({
    ...withoutOpenBreak,
    status: "CORRECTED",
    clockInAt,
    clockOutAt,
    breakMinutes,
  });
}

/** IANA-timezone business date; cross-midnight clock-out keeps its open day. */
export function businessDateAt(epochMs: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(epochMs));
  const value = (type: "year" | "month" | "day") =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function validateLeaveRange(
  startDate: string,
  endDate: string,
  hours?: number,
): Result<true, { readonly code: "INVALID_DATE_RANGE" | "INVALID_HOURS" }> {
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  if (
    !isoDate.test(startDate) ||
    !isoDate.test(endDate) ||
    endDate < startDate
  ) {
    return fail({ code: "INVALID_DATE_RANGE" });
  }
  if (
    hours !== undefined &&
    (!Number.isFinite(hours) || hours <= 0 || hours > 24)
  ) {
    return fail({ code: "INVALID_HOURS" });
  }
  return ok(true);
}
