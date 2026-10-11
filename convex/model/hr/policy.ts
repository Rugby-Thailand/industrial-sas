import { v } from "convex/values";
import { addDays, isIsoDate } from "./calendar";

export const POLICY_PRESET = "TH_LPA_MINIMUM_2026_10_11";
export const capabilityValidator = v.union(
  v.literal("LEAVE"),
  v.literal("ANNOUNCEMENTS"),
  v.literal("PAYSLIPS"),
);
export type PolicyCapability = "LEAVE" | "ANNOUNCEMENTS" | "PAYSLIPS";
export const policyConfigValidator = v.object({
  annualDays: v.number(),
  firstYearAnnualDays: v.number(),
  sickPaidDays: v.number(),
  personalDays: v.number(),
  maternityDays: v.number(),
  maternityPaidDays: v.number(),
  spouseDays: v.number(),
  newbornCareDays: v.number(),
  newbornCarePayPercent: v.number(),
  militaryPaidDays: v.number(),
  announcementAudience: v.union(v.literal("ORGANIZATION"), v.literal("SITE")),
  announcementAcknowledgment: v.boolean(),
  verificationMinutes: v.number(),
  downloadSeconds: v.number(),
  requireFileHash: v.boolean(),
  hashAlgorithm: v.literal("SHA256"),
});
export type PolicyConfig = {
  annualDays: number;
  firstYearAnnualDays: number;
  sickPaidDays: number;
  personalDays: number;
  maternityDays: number;
  maternityPaidDays: number;
  spouseDays: number;
  newbornCareDays: number;
  newbornCarePayPercent: number;
  militaryPaidDays: number;
  announcementAudience: "ORGANIZATION" | "SITE";
  announcementAcknowledgment: boolean;
  verificationMinutes: number;
  downloadSeconds: number;
  requireFileHash: boolean;
  hashAlgorithm: "SHA256";
};
export const thailandDefaults = (): PolicyConfig => ({
  annualDays: 6,
  firstYearAnnualDays: 0,
  sickPaidDays: 30,
  personalDays: 3,
  maternityDays: 120,
  maternityPaidDays: 60,
  spouseDays: 15,
  newbornCareDays: 15,
  newbornCarePayPercent: 50,
  militaryPaidDays: 60,
  announcementAudience: "ORGANIZATION",
  announcementAcknowledgment: false,
  verificationMinutes: 5,
  downloadSeconds: 60,
  requireFileHash: true,
  hashAlgorithm: "SHA256",
});
export const POLICY_SOURCES = [
  {
    title: "Thai employee rights / Labour Protection Act",
    url: "https://www.mol.go.th/employee/สิทธิหน้าที่นายจ้าง-ลูกจ้าง",
  },
  {
    title: "Labour Protection Act No. 7 (personal leave)",
    url: "https://www.mol.go.th/wp-content/uploads/sites/2/2019/07/labour_2541_7.pdf",
  },
  {
    title: "Labour Protection Act No. 9; effective 7 December 2025",
    url: "https://ratchakitcha.soc.go.th/documents/89818.pdf",
  },
];
const floors: Partial<Record<keyof PolicyConfig, number>> = {
  annualDays: 6,
  firstYearAnnualDays: 0,
  sickPaidDays: 30,
  personalDays: 3,
  maternityDays: 120,
  maternityPaidDays: 60,
  spouseDays: 15,
  newbornCareDays: 15,
  newbornCarePayPercent: 50,
  militaryPaidDays: 60,
};
/** Paid caps are independent from statutory leave duration (sick/military are unlimited). */
export function validatePolicy(
  config: PolicyConfig,
  previous?: PolicyConfig,
): string | null {
  for (const [field, minimum] of Object.entries(floors)) {
    const value = config[field as keyof PolicyConfig];
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < minimum ||
      value > 366
    )
      return field;
    const old = previous?.[field as keyof PolicyConfig];
    if (typeof old === "number" && value < old)
      return `HIGHER_BENEFIT:${field}`;
  }
  if (config.maternityPaidDays > config.maternityDays)
    return "maternityPaidDays";
  if (config.newbornCarePayPercent > 100) return "newbornCarePayPercent";
  if (
    !Number.isInteger(config.verificationMinutes) ||
    config.verificationMinutes < 2 ||
    config.verificationMinutes > 15
  )
    return "verificationMinutes";
  if (
    !Number.isInteger(config.downloadSeconds) ||
    config.downloadSeconds < 1 ||
    config.downloadSeconds > 60
  )
    return "downloadSeconds";
  return null;
}
/** Leap-day anniversaries mature on the last day of February in non-leap years. */
export function anniversary(startDate: string, year: number): string {
  const candidate = `${year}${startDate.slice(4)}`;
  return isIsoDate(candidate) ? candidate : `${year}-02-28`;
}
export function annualPeriod(startDate: string, date: string) {
  const year = Number(date.slice(0, 4));
  let start = anniversary(startDate, year);
  if (start > date) start = anniversary(startDate, year - 1);
  if (start < startDate) start = startDate;
  return {
    start,
    end: addDays(anniversary(startDate, Number(start.slice(0, 4)) + 1), -1),
    eligible: date >= anniversary(startDate, Number(startDate.slice(0, 4)) + 1),
  };
}
export const leaveTypeValidator = v.union(
  v.literal("ANNUAL"),
  v.literal("SICK"),
  v.literal("PERSONAL"),
  v.literal("MATERNITY"),
  v.literal("SPOUSE"),
  v.literal("NEWBORN_CARE"),
  v.literal("STERILIZATION"),
  v.literal("MILITARY"),
  v.literal("TRAINING"),
);
export type LeaveType =
  | "ANNUAL"
  | "SICK"
  | "PERSONAL"
  | "MATERNITY"
  | "SPOUSE"
  | "NEWBORN_CARE"
  | "STERILIZATION"
  | "MILITARY"
  | "TRAINING";
export const ACCOUNT_TYPES = [
  "ANNUAL",
  "SICK",
  "PERSONAL",
  "MILITARY",
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export function accountPeriod(
  type: AccountType,
  employmentStart: string,
  date: string,
) {
  return type === "ANNUAL"
    ? annualPeriod(employmentStart, date)
    : {
        start: `${date.slice(0, 4)}-01-01`,
        end: `${date.slice(0, 4)}-12-31`,
        eligible: true,
      };
}
export function grantFor(
  type: AccountType,
  config: PolicyConfig,
  eligible: boolean,
) {
  return type === "ANNUAL"
    ? eligible
      ? config.annualDays
      : config.firstYearAnnualDays
    : type === "SICK"
      ? config.sickPaidDays
      : type === "PERSONAL"
        ? config.personalDays
        : config.militaryPaidDays;
}
