import { describe, expect, it } from "vitest";
import {
  thailandDefaults,
  validatePolicy,
  validatePolicyCapability,
} from "./policy";
import {
  WORK_RULES_EXECUTION,
  WORK_RULE_MAX_EXCLUDED_GROUPS,
  WORK_RULE_MAX_GROUP_KEY_LENGTH,
  WORK_RULE_MAX_MINUTES,
  WORK_RULE_MAX_TENURE_DAYS,
  validateWorkRules,
} from "./workRules";

const attendance = (fields: Record<string, unknown>) =>
  validateWorkRules({ attendance: fields });
const overtime = (fields: Record<string, unknown>) =>
  validateWorkRules({ overtime: fields });

describe("slice 02 work rules: inert storage and neutral validation", () => {
  it("adds no work-rule defaults and keeps legacy policies valid without settings", () => {
    const legacy = thailandDefaults();
    expect("workRules" in legacy).toBe(false);
    expect(validatePolicy(legacy)).toBeNull();
    expect(validateWorkRules(undefined)).toBeNull();
    expect(validateWorkRules({})).toBeNull();
    expect(validateWorkRules({ attendance: {}, overtime: {} })).toBeNull();
    expect(validatePolicyCapability("LEAVE", legacy)).toBeNull();
    expect(validatePolicyCapability("PAYSLIPS", legacy)).toBeNull();
  });

  it("reports every calculation as inactive or unsupported", () => {
    expect(WORK_RULES_EXECUTION).toEqual({
      attendanceClassification: "INACTIVE",
      lateGraceArithmetic: "INACTIVE",
      overtimeCalculation: "UNSUPPORTED",
      overtimeEligibility: "INACTIVE",
      payroll: "UNSUPPORTED",
    });
  });

  it("accepts the observed demo values only when explicitly supplied", () => {
    expect(
      validateWorkRules({
        attendance: {
          lateAfterMinutes: 5,
          veryLateAfterMinutes: 15,
          absentAfterMinutes: 30,
          excludeGraceMinutesFromLate: true,
        },
        overtime: {
          automaticCalculation: false,
          beforeShiftStartMinutes: 0,
          afterShiftEndMinutes: 30,
          minimumMinutes: 60,
          rounding: { direction: "DOWN", intervalMinutes: 30 },
          eligibility: {
            requirePassedProbation: true,
            minimumTenureDays: 90,
            excludedGroupKeys: ["contractors", "ผู้บริหาร"],
          },
        },
      }),
    ).toBeNull();
  });

  it.each([
    ["lateAfterMinutes", -1],
    ["lateAfterMinutes", 4.5],
    ["veryLateAfterMinutes", Number.NaN],
    ["absentAfterMinutes", Number.POSITIVE_INFINITY],
    ["absentAfterMinutes", Number.MAX_SAFE_INTEGER + 1],
    ["absentAfterMinutes", WORK_RULE_MAX_MINUTES + 1],
    ["lateAfterMinutes", "5"],
  ])("rejects attendance threshold %s = %s", (field, value) => {
    expect(attendance({ [field]: value })).toBe(
      `workRules.attendance.${field}`,
    );
  });

  it("accepts zero and the one-day limit for thresholds", () => {
    expect(attendance({ lateAfterMinutes: 0 })).toBeNull();
    expect(
      attendance({ absentAfterMinutes: WORK_RULE_MAX_MINUTES }),
    ).toBeNull();
    expect(
      attendance({
        lateAfterMinutes: 0,
        veryLateAfterMinutes: 1,
        absentAfterMinutes: WORK_RULE_MAX_MINUTES,
      }),
    ).toBeNull();
  });

  it("requires present thresholds to strictly increase, including across gaps", () => {
    expect(attendance({ lateAfterMinutes: 15, veryLateAfterMinutes: 15 })).toBe(
      "workRules.attendance.veryLateAfterMinutes:ORDER",
    );
    expect(attendance({ lateAfterMinutes: 15, veryLateAfterMinutes: 5 })).toBe(
      "workRules.attendance.veryLateAfterMinutes:ORDER",
    );
    expect(attendance({ lateAfterMinutes: 30, absentAfterMinutes: 30 })).toBe(
      "workRules.attendance.absentAfterMinutes:ORDER",
    );
    expect(
      attendance({ veryLateAfterMinutes: 20, absentAfterMinutes: 10 }),
    ).toBe("workRules.attendance.absentAfterMinutes:ORDER");
    expect(
      attendance({ lateAfterMinutes: 5, absentAfterMinutes: 6 }),
    ).toBeNull();
  });

  it("stores the grace checkbox only as a boolean", () => {
    expect(attendance({ excludeGraceMinutesFromLate: false })).toBeNull();
    expect(attendance({ excludeGraceMinutesFromLate: 1 })).toBe(
      "workRules.attendance.excludeGraceMinutesFromLate",
    );
  });

  it("refuses enabling automatic OT while allowing the explicit disabled preference", () => {
    expect(overtime({ automaticCalculation: false })).toBeNull();
    expect(overtime({ automaticCalculation: true })).toBe(
      "workRules.overtime.automaticCalculation:UNSUPPORTED",
    );
    expect(overtime({ automaticCalculation: "yes" })).toBe(
      "workRules.overtime.automaticCalculation",
    );
  });

  it.each([
    ["beforeShiftStartMinutes", -1],
    ["afterShiftEndMinutes", 0.25],
    ["minimumMinutes", WORK_RULE_MAX_MINUTES + 1],
    ["maximumOutsideShiftMinutes", 0],
    ["maximumOutsideShiftMinutes", 1.5],
  ])("rejects OT minutes %s = %s", (field, value) => {
    expect(overtime({ [field]: value })).toBe(`workRules.overtime.${field}`);
  });

  it("treats an omitted maximum as unconfigured and orders minimum against maximum", () => {
    expect(overtime({ minimumMinutes: 60 })).toBeNull();
    expect(
      overtime({ minimumMinutes: 60, maximumOutsideShiftMinutes: 60 }),
    ).toBeNull();
    expect(
      overtime({ minimumMinutes: 61, maximumOutsideShiftMinutes: 60 }),
    ).toBe("workRules.overtime.maximumOutsideShiftMinutes:ORDER");
    expect(
      overtime({
        beforeShiftStartMinutes: 0,
        afterShiftEndMinutes: WORK_RULE_MAX_MINUTES,
        minimumMinutes: 0,
        maximumOutsideShiftMinutes: WORK_RULE_MAX_MINUTES,
      }),
    ).toBeNull();
  });

  it("accepts only round-down with a positive whole interval", () => {
    const rounding = (value: unknown) => overtime({ rounding: value });
    expect(rounding({ direction: "DOWN", intervalMinutes: 1 })).toBeNull();
    expect(
      rounding({ direction: "DOWN", intervalMinutes: WORK_RULE_MAX_MINUTES }),
    ).toBeNull();
    expect(rounding({ direction: "UP", intervalMinutes: 30 })).toBe(
      "workRules.overtime.rounding.direction",
    );
    expect(rounding({ direction: "DOWN", intervalMinutes: 0 })).toBe(
      "workRules.overtime.rounding.intervalMinutes",
    );
    expect(rounding({ direction: "DOWN", intervalMinutes: 7.5 })).toBe(
      "workRules.overtime.rounding.intervalMinutes",
    );
    expect(rounding({ direction: "DOWN" })).toBe(
      "workRules.overtime.rounding.intervalMinutes",
    );
    expect(rounding("DOWN")).toBe("workRules.overtime.rounding");
  });

  it("validates eligibility tenure bounds and excluded group labels", () => {
    const eligibility = (value: unknown) => overtime({ eligibility: value });
    const path = "workRules.overtime.eligibility";
    expect(eligibility({ minimumTenureDays: 0 })).toBeNull();
    expect(
      eligibility({ minimumTenureDays: WORK_RULE_MAX_TENURE_DAYS }),
    ).toBeNull();
    expect(eligibility({ minimumTenureDays: -1 })).toBe(
      `${path}.minimumTenureDays`,
    );
    expect(
      eligibility({ minimumTenureDays: WORK_RULE_MAX_TENURE_DAYS + 1 }),
    ).toBe(`${path}.minimumTenureDays`);
    expect(eligibility({ requirePassedProbation: "true" })).toBe(
      `${path}.requirePassedProbation`,
    );
    expect(eligibility({ excludedGroupKeys: [] })).toBeNull();
    for (const keys of [
      [""],
      [" padded"],
      ["a", "a"],
      ["line\nbreak"],
      ["x".repeat(WORK_RULE_MAX_GROUP_KEY_LENGTH + 1)],
      [1],
      "contractors",
      Array.from(
        { length: WORK_RULE_MAX_EXCLUDED_GROUPS + 1 },
        (_, index) => `g${index}`,
      ),
    ])
      expect(eligibility({ excludedGroupKeys: keys })).toBe(
        `${path}.excludedGroupKeys`,
      );
    expect(
      eligibility({
        excludedGroupKeys: Array.from(
          { length: WORK_RULE_MAX_EXCLUDED_GROUPS },
          (_, index) => `g${index}`,
        ),
      }),
    ).toBeNull();
  });

  it("rejects unknown keys and non-object sections instead of storing them", () => {
    expect(validateWorkRules({ payroll: {} })).toBe("workRules.payroll");
    expect(validateWorkRules([])).toBe("workRules");
    expect(validateWorkRules(null)).toBe("workRules");
    expect(validateWorkRules({ attendance: 5 })).toBe("workRules.attendance");
    expect(attendance({ penaltyPoints: -1 })).toBe(
      "workRules.attendance.penaltyPoints",
    );
    expect(overtime({ rate: 1.5 })).toBe("workRules.overtime.rate");
    expect(
      overtime({
        rounding: { direction: "DOWN", intervalMinutes: 30, mode: "x" },
      }),
    ).toBe("workRules.overtime.rounding.mode");
  });

  it.each([
    [{ "": 1 }, "workRules."],
    [{ attendance: { "": 1 } }, "workRules.attendance."],
    [{ overtime: { "": 1 } }, "workRules.overtime."],
    [
      {
        overtime: {
          rounding: { direction: "DOWN", intervalMinutes: 30, "": 1 },
        },
      },
      "workRules.overtime.rounding.",
    ],
    [
      { overtime: { eligibility: { "": 1 } } },
      "workRules.overtime.eligibility.",
    ],
  ])("rejects even an empty unknown key in %j", (rules, field) => {
    expect(validateWorkRules(rules)).toBe(field);
  });

  it("surfaces work-rule errors through the existing policy validator and capability guard", () => {
    const config = {
      ...thailandDefaults(),
      workRules: { attendance: { lateAfterMinutes: -5 } },
    };
    expect(validatePolicy(config)).toBe(
      "workRules.attendance.lateAfterMinutes",
    );
    // Leave floors are still checked first and unchanged.
    expect(validatePolicy({ ...config, annualDays: 5 })).toBe("annualDays");
    const stored = { ...thailandDefaults(), workRules: {} };
    expect(validatePolicyCapability("LEAVE", stored)).toBeNull();
    expect(validatePolicyCapability("ANNOUNCEMENTS", stored)).toBe(
      "workRules:CAPABILITY",
    );
    expect(validatePolicyCapability("PAYSLIPS", stored)).toBe(
      "workRules:CAPABILITY",
    );
  });
});
