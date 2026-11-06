/**
 * Observed HRZoft work-condition and OT settings (slice 02), stored as
 * optional, inert configuration on the LEAVE policy record.
 *
 * Nothing here classifies attendance, applies grace minutes, calculates OT,
 * decides OT eligibility or feeds payroll. The research marks those
 * semantics as unconfirmed, so this module only checks that stored values
 * are well-formed and internally consistent. It deliberately has no
 * defaults: an omitted value means "not configured", never a demo or
 * statutory number. See docs/plans/hr-parity/02-rules-calendar-roles/
 * work-rules-foundation.md for the open business decisions.
 */
import { v } from "convex/values";

/** Upper bound for every minute field: one calendar day. */
export const WORK_RULE_MAX_MINUTES = 1440;
/** Upper bound for minimum tenure: 100 years of days. */
export const WORK_RULE_MAX_TENURE_DAYS = 36_500;
export const WORK_RULE_MAX_EXCLUDED_GROUPS = 50;
export const WORK_RULE_MAX_GROUP_KEY_LENGTH = 80;

export const attendanceRulesValidator = v.object({
  lateAfterMinutes: v.optional(v.number()),
  veryLateAfterMinutes: v.optional(v.number()),
  absentAfterMinutes: v.optional(v.number()),
  excludeGraceMinutesFromLate: v.optional(v.boolean()),
});
export const overtimeRulesValidator = v.object({
  automaticCalculation: v.optional(v.boolean()),
  beforeShiftStartMinutes: v.optional(v.number()),
  afterShiftEndMinutes: v.optional(v.number()),
  minimumMinutes: v.optional(v.number()),
  maximumOutsideShiftMinutes: v.optional(v.number()),
  rounding: v.optional(
    v.object({ direction: v.literal("DOWN"), intervalMinutes: v.number() }),
  ),
  eligibility: v.optional(
    v.object({
      requirePassedProbation: v.optional(v.boolean()),
      minimumTenureDays: v.optional(v.number()),
      excludedGroupKeys: v.optional(v.array(v.string())),
    }),
  ),
});
export const workRulesValidator = v.object({
  attendance: v.optional(attendanceRulesValidator),
  overtime: v.optional(overtimeRulesValidator),
});

export type AttendanceRules = {
  lateAfterMinutes?: number;
  veryLateAfterMinutes?: number;
  absentAfterMinutes?: number;
  /** Observed checkbox ยกเว้นนาทีที่ใช้นับเป็น สาย; its arithmetic is unknown. */
  excludeGraceMinutesFromLate?: boolean;
};
export type OvertimeRules = {
  /** Only `false` is accepted: automatic OT is not supported. */
  automaticCalculation?: boolean;
  beforeShiftStartMinutes?: number;
  afterShiftEndMinutes?: number;
  minimumMinutes?: number;
  /** Omitted means no cap is configured (the demo shows ไม่จำกัด). */
  maximumOutsideShiftMinutes?: number;
  rounding?: { direction: "DOWN"; intervalMinutes: number };
  eligibility?: {
    requirePassedProbation?: boolean;
    minimumTenureDays?: number;
    /** Opaque labels; no employee-group entity exists yet to resolve them. */
    excludedGroupKeys?: readonly string[];
  };
};
export type WorkRules = {
  attendance?: AttendanceRules;
  overtime?: OvertimeRules;
};

/**
 * How stored work rules affect behavior today: not at all. Returned with the
 * policy so readers cannot mistake persisted settings for active rules.
 */
export const WORK_RULES_EXECUTION = {
  attendanceClassification: "INACTIVE",
  lateGraceArithmetic: "INACTIVE",
  overtimeCalculation: "UNSUPPORTED",
  overtimeEligibility: "INACTIVE",
  payroll: "UNSUPPORTED",
} as const;

const KEYS = {
  root: ["attendance", "overtime"],
  attendance: [
    "lateAfterMinutes",
    "veryLateAfterMinutes",
    "absentAfterMinutes",
    "excludeGraceMinutesFromLate",
  ],
  overtime: [
    "automaticCalculation",
    "beforeShiftStartMinutes",
    "afterShiftEndMinutes",
    "minimumMinutes",
    "maximumOutsideShiftMinutes",
    "rounding",
    "eligibility",
  ],
  rounding: ["direction", "intervalMinutes"],
  eligibility: [
    "requirePassedProbation",
    "minimumTenureDays",
    "excludedGroupKeys",
  ],
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const unknownKey = (
  value: Record<string, unknown>,
  allowed: readonly string[],
) => Object.keys(value).find((key) => !allowed.includes(key));
const wholeNumber = (value: unknown, minimum: number, maximum: number) =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= minimum &&
  value <= maximum;
const optionalWhole = (value: unknown, minimum: number, maximum: number) =>
  value === undefined || wholeNumber(value, minimum, maximum);
const optionalBoolean = (value: unknown) =>
  value === undefined || typeof value === "boolean";
// Control characters make a label unreadable and unsafe to echo in audit text.
const CONTROL = /[\u0000-\u001f\u007f]/u;

function validateAttendance(value: unknown): string | null {
  const path = "workRules.attendance";
  if (!isRecord(value)) return path;
  const extra = unknownKey(value, KEYS.attendance);
  if (extra !== undefined) return `${path}.${extra}`;
  const thresholds = [
    "lateAfterMinutes",
    "veryLateAfterMinutes",
    "absentAfterMinutes",
  ] as const;
  for (const field of thresholds)
    if (!optionalWhole(value[field], 0, WORK_RULE_MAX_MINUTES))
      return `${path}.${field}`;
  if (!optionalBoolean(value.excludeGraceMinutesFromLate))
    return `${path}.excludeGraceMinutesFromLate`;
  // Whether a threshold is inclusive is unknown, so equal thresholds would
  // leave the order of statuses undefined. Present values must strictly rise.
  let previous: number | undefined;
  for (const field of thresholds) {
    const current = value[field] as number | undefined;
    if (current === undefined) continue;
    if (previous !== undefined && current <= previous)
      return `${path}.${field}:ORDER`;
    previous = current;
  }
  return null;
}

function validateEligibility(value: unknown): string | null {
  const path = "workRules.overtime.eligibility";
  if (!isRecord(value)) return path;
  const extra = unknownKey(value, KEYS.eligibility);
  if (extra !== undefined) return `${path}.${extra}`;
  if (!optionalBoolean(value.requirePassedProbation))
    return `${path}.requirePassedProbation`;
  if (!optionalWhole(value.minimumTenureDays, 0, WORK_RULE_MAX_TENURE_DAYS))
    return `${path}.minimumTenureDays`;
  const groups = value.excludedGroupKeys;
  if (groups === undefined) return null;
  if (!Array.isArray(groups) || groups.length > WORK_RULE_MAX_EXCLUDED_GROUPS)
    return `${path}.excludedGroupKeys`;
  const seen = new Set<string>();
  for (const key of groups as unknown[]) {
    if (
      typeof key !== "string" ||
      key.length === 0 ||
      key.length > WORK_RULE_MAX_GROUP_KEY_LENGTH ||
      key.trim() !== key ||
      CONTROL.test(key) ||
      seen.has(key)
    )
      return `${path}.excludedGroupKeys`;
    seen.add(key);
  }
  return null;
}

function validateOvertime(value: unknown): string | null {
  const path = "workRules.overtime";
  if (!isRecord(value)) return path;
  const extra = unknownKey(value, KEYS.overtime);
  if (extra !== undefined) return `${path}.${extra}`;
  if (!optionalBoolean(value.automaticCalculation))
    return `${path}.automaticCalculation`;
  // Calculation order, caps versus legal entitlement and eligibility
  // precedence are unconfirmed; enabling automatic OT is refused outright.
  if (value.automaticCalculation === true)
    return `${path}.automaticCalculation:UNSUPPORTED`;
  for (const field of [
    "beforeShiftStartMinutes",
    "afterShiftEndMinutes",
    "minimumMinutes",
  ] as const)
    if (!optionalWhole(value[field], 0, WORK_RULE_MAX_MINUTES))
      return `${path}.${field}`;
  if (
    !optionalWhole(value.maximumOutsideShiftMinutes, 1, WORK_RULE_MAX_MINUTES)
  )
    return `${path}.maximumOutsideShiftMinutes`;
  if (
    typeof value.minimumMinutes === "number" &&
    typeof value.maximumOutsideShiftMinutes === "number" &&
    value.minimumMinutes > value.maximumOutsideShiftMinutes
  )
    return `${path}.maximumOutsideShiftMinutes:ORDER`;
  if (value.rounding !== undefined) {
    const rounding = value.rounding;
    if (!isRecord(rounding)) return `${path}.rounding`;
    const extraRounding = unknownKey(rounding, KEYS.rounding);
    if (extraRounding !== undefined) return `${path}.rounding.${extraRounding}`;
    // Only round-down was observed; other directions are not modelled.
    if (rounding.direction !== "DOWN") return `${path}.rounding.direction`;
    if (!wholeNumber(rounding.intervalMinutes, 1, WORK_RULE_MAX_MINUTES))
      return `${path}.rounding.intervalMinutes`;
  }
  if (value.eligibility !== undefined)
    return validateEligibility(value.eligibility);
  return null;
}

/**
 * Neutral shape check for optional work rules. Returns the offending field
 * path, or null. `undefined` (legacy policies) is always valid.
 */
export function validateWorkRules(value: unknown): string | null {
  if (value === undefined) return null;
  if (!isRecord(value)) return "workRules";
  const extra = unknownKey(value, KEYS.root);
  if (extra !== undefined) return `workRules.${extra}`;
  if (value.attendance !== undefined) {
    const error = validateAttendance(value.attendance);
    if (error) return error;
  }
  if (value.overtime !== undefined) return validateOvertime(value.overtime);
  return null;
}
