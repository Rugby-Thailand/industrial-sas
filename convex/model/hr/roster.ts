/**
 * Named FIXED shift definitions and dated roster assignments.
 *
 * Status: one fixed shift per employee per business date. A definition has
 * a site-unique code, a name, an optional description, a palette colour and
 * the existing fixed schedule semantics (local start/end, explicit "ends next
 * day" flag, aggregate unpaid break minutes). Hour-count and freelance modes,
 * break windows, period grids, auto-OT and repeat patterns are NOT modelled:
 * their HRZoft algorithms were not observed (S04-03/05/06/17/18).
 *
 * A dated assignment is one of:
 * - SHIFT: a snapshot of the definition's version and fixed times, so a later
 *   definition edit never silently changes an already planned date;
 * - OFF: an explicit nonworking override, distinct from a missing row;
 * - CLEARED: a versioned tombstone that restores the weekly schedule
 *   fallback while keeping the cell's revision monotonic (ABA-safe).
 *
 * Plan precedence for a date without a captured attendance plan is OUR
 * preserved rule, not observed HRZoft behaviour: site holiday, then dated
 * assignment (SHIFT/OFF), then the employee's weekly schedule.
 */
import { fail, ok, type Result } from "../result";
import { datesInRange, type IsoDate } from "./calendar";
import {
  planFor,
  validateSchedule,
  type DayPlan,
  type RosterProvenance,
  type Schedule,
  type ScheduleError,
  type ValidatedSchedule,
} from "./schedule";

export type { RosterProvenance };

export const SHIFT_COLORS = [
  "sky",
  "teal",
  "green",
  "amber",
  "rose",
  "violet",
  "slate",
] as const;
export type ShiftColor = (typeof SHIFT_COLORS)[number];

export const MAX_SHIFT_CODE_LENGTH = 20;
export const MAX_SHIFT_NAME_LENGTH = 120;
export const MAX_SHIFT_DESCRIPTION_LENGTH = 500;
/** One bounded page: the catalogue read is `take(MAX_SITE_SHIFTS + 1)`. */
export const MAX_SITE_SHIFTS = 99;
/**
 * Employees one roster save covers. The roster grid itself is paged (20/50
 * per page); callers that omit a page size get one page of this many.
 */
export const MAX_ROSTER_EMPLOYEES = 50;
/** One site/month, up to 50 employees × 31 days, in one atomic command. */
export const MAX_ROSTER_CELLS = 1550;

const SHIFT_CODE = /^[A-Z0-9][A-Z0-9_-]*$/;

/** The fixed working times a definition (and its snapshot) carries. */
export interface FixedTimes {
  readonly startTime: string;
  readonly endTime: string;
  readonly endsNextDay: boolean;
  readonly breakMinutes: number;
}

export interface ShiftDraft extends FixedTimes {
  readonly code: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly color: string;
}

export interface ValidShiftDraft extends FixedTimes {
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly color: ShiftColor;
}

export type ShiftDraftError =
  | { readonly code: "SHIFT_CODE_INVALID"; readonly field: "code" }
  | { readonly code: "SHIFT_NAME_INVALID"; readonly field: "name" }
  | {
      readonly code: "SHIFT_DESCRIPTION_INVALID";
      readonly field: "description";
    }
  | { readonly code: "SHIFT_COLOR_INVALID"; readonly field: "color" }
  | (ScheduleError & { readonly field?: string });

/** Canonical comparison key for duplicate-code protection within a site. */
export const shiftCodeKey = (code: string): string => code.trim().toUpperCase();

/** Reuses `validateSchedule` with every weekday: a dated shift has no weekdays. */
export function validateFixedTimes(
  times: FixedTimes,
): Result<FixedTimes, ScheduleError> {
  const valid = validateSchedule({
    workDays: [1, 2, 3, 4, 5, 6, 7],
    startTime: times.startTime,
    endTime: times.endTime,
    endsNextDay: times.endsNextDay,
    breakMinutes: times.breakMinutes,
  });
  if (!valid.ok) return valid;
  return ok(
    Object.freeze({
      startTime: valid.value.startTime,
      endTime: valid.value.endTime,
      endsNextDay: valid.value.endsNextDay,
      breakMinutes: valid.value.breakMinutes,
    }),
  );
}

export function validateShiftDraft(
  draft: ShiftDraft,
): Result<ValidShiftDraft, ShiftDraftError> {
  const code = shiftCodeKey(draft.code);
  if (
    code.length < 1 ||
    code.length > MAX_SHIFT_CODE_LENGTH ||
    !SHIFT_CODE.test(code) ||
    code === "OFF"
  )
    return fail({ code: "SHIFT_CODE_INVALID", field: "code" });
  const name = draft.name.trim();
  if (name.length < 1 || name.length > MAX_SHIFT_NAME_LENGTH)
    return fail({ code: "SHIFT_NAME_INVALID", field: "name" });
  const description = draft.description?.trim();
  if (
    description !== undefined &&
    description.length > MAX_SHIFT_DESCRIPTION_LENGTH
  )
    return fail({ code: "SHIFT_DESCRIPTION_INVALID", field: "description" });
  if (!(SHIFT_COLORS as readonly string[]).includes(draft.color))
    return fail({ code: "SHIFT_COLOR_INVALID", field: "color" });
  const times = validateFixedTimes(draft);
  if (!times.ok) return times;
  return ok(
    Object.freeze({
      code,
      name,
      ...(description === undefined || description === ""
        ? {}
        : { description }),
      color: draft.color as ShiftColor,
      ...times.value,
    }),
  );
}

/** A live dated assignment as plan input; CLEARED rows are passed as undefined. */
export type RosterAssignment =
  | {
      readonly kind: "SHIFT";
      readonly revision: number;
      readonly shiftId: string;
      readonly shiftCode: string;
      readonly shiftVersion: number;
      readonly times: FixedTimes;
    }
  | { readonly kind: "OFF"; readonly revision: number };

export function provenanceOf(assignment: RosterAssignment): RosterProvenance {
  return assignment.kind === "SHIFT"
    ? Object.freeze({
        kind: "SHIFT",
        revision: assignment.revision,
        shiftId: assignment.shiftId,
        shiftCode: assignment.shiftCode,
        shiftVersion: assignment.shiftVersion,
      })
    : Object.freeze({ kind: "OFF", revision: assignment.revision });
}

/**
 * The live plan of one unrecorded date: holiday, then dated assignment, then
 * the weekly schedule fallback. A captured attendance plan always wins over
 * this and is never recomputed.
 */
export function rosterPlanFor(input: {
  readonly date: IsoDate;
  readonly schedule: Schedule | ValidatedSchedule | undefined;
  readonly assignment: RosterAssignment | undefined;
  readonly holidayName: string | undefined;
  readonly offsetMinutes: number;
}): DayPlan {
  const { assignment } = input;
  if (input.holidayName !== undefined || assignment === undefined)
    return planFor(input);
  const roster = provenanceOf(assignment);
  if (assignment.kind === "OFF")
    return Object.freeze({
      kind: "NONWORKING",
      reason: "OFF",
      breakMinutes: 0,
      roster,
    });
  const plan = planFor({
    date: input.date,
    // Every weekday: the assignment, not the weekly pattern, names this date.
    schedule: { workDays: [1, 2, 3, 4, 5, 6, 7], ...assignment.times },
    holidayName: undefined,
    offsetMinutes: input.offsetMinutes,
  });
  return Object.freeze({ ...plan, roster });
}

/** Every valid date of one `YYYY-MM` calendar month, or null when invalid. */
export function monthDates(month: string): readonly IsoDate[] | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (match === null) return null;
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (year < 1900 || year > 2200 || monthNumber < 1 || monthNumber > 12)
    return null;
  const last = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return datesInRange(
    `${month}-01`,
    `${month}-${String(last).padStart(2, "0")}`,
  );
}
