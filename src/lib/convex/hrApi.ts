/** Typed browser boundary for attendance, corrections and leave. */
import type { Infer } from "convex/values";

import { api } from "../../../convex/_generated/api";
import type { hrRequestStatus } from "../../../convex/lib/validators";

import { clientRef, type RefValue } from "./clientRef";

export const readMyHrRef = clientRef(api.hr.attendance.readMyHr);

export const listTeamInboxRef = clientRef(api.hr.attendance.listTeamInbox);

export const clockRef = clientRef(api.hr.attendance.clock);

export const requestAttendanceCorrectionRef = clientRef(
  api.hr.attendance.requestAttendanceCorrection,
);

export const requestLeaveRef = clientRef(api.hr.attendance.requestLeave);

export const decideAttendanceCorrectionRef = clientRef(
  api.hr.attendance.decideAttendanceCorrection,
);

export const decideLeaveRef = clientRef(api.hr.attendance.decideLeave);

/** The self view, which answers "no employee record" as its own branch. */
export type MyHrPayload = RefValue<typeof readMyHrRef>;

/** The self view once an active employee record has been found. */
export type MyHrRecord = Extract<MyHrPayload, { found: true }>;

export type AttendanceDayRow = MyHrRecord["days"][number];

/**
 * The closed request lifecycle, taken from the schema validator rather than the
 * self view: the read narrows what it returns to the states it can produce.
 */
export type HrRequestStatus = Infer<typeof hrRequestStatus>;

export type TeamHrInboxPayload = RefValue<typeof listTeamInboxRef>;
