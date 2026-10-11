import { describe, expect, it } from "vitest";
import {
  accountPeriod,
  anniversary,
  annualPeriod,
  thailandDefaults,
  validatePolicy,
} from "./policy";
describe("Thailand minimum policy and employee anniversary arithmetic", () => {
  it("uses current maternity and personal leave amendments, with sick pay independent of leave duration", () => {
    expect(thailandDefaults()).toMatchObject({
      annualDays: 6,
      sickPaidDays: 30,
      personalDays: 3,
      maternityDays: 120,
      maternityPaidDays: 60,
      spouseDays: 15,
      newbornCareDays: 15,
      newbornCarePayPercent: 50,
      militaryPaidDays: 60,
    });
  });
  it.each([
    "annualDays",
    "sickPaidDays",
    "personalDays",
    "maternityDays",
    "maternityPaidDays",
    "spouseDays",
    "newbornCareDays",
    "militaryPaidDays",
  ] as const)("rejects lowering statutory minimum %s", (field) => {
    const config = thailandDefaults();
    config[field] -= 1;
    expect(validatePolicy(config)).toBe(field);
  });
  it("preserves existing higher benefits rather than resetting to a minimum preset", () => {
    expect(
      validatePolicy(thailandDefaults(), {
        ...thailandDefaults(),
        annualDays: 10,
      }),
    ).toBe("HIGHER_BENEFIT:annualDays");
    expect(
      validatePolicy({ ...thailandDefaults(), annualDays: 10 }),
    ).toBeNull();
  });
  it("keeps first-year discretionary entitlement separate from statutory anniversary grant", () => {
    expect(annualPeriod("2025-10-12", "2026-10-11")).toEqual({
      start: "2025-10-12",
      end: "2026-10-11",
      eligible: false,
    });
    expect(annualPeriod("2025-10-12", "2026-10-12")).toEqual({
      start: "2026-10-12",
      end: "2027-10-11",
      eligible: true,
    });
  });
  it("handles leap-day hiring without inventing an invalid anniversary", () => {
    expect(anniversary("2024-02-29", 2025)).toBe("2025-02-28");
    expect(annualPeriod("2024-02-29", "2025-02-28").eligible).toBe(true);
    expect(accountPeriod("SICK", "2024-02-29", "2026-10-12")).toEqual({
      start: "2026-01-01",
      end: "2026-12-31",
      eligible: true,
    });
  });
  it("rejects unrealistic sensitive-access expiry and pay caps beyond duration", () => {
    expect(
      validatePolicy({ ...thailandDefaults(), verificationMinutes: 0 }),
    ).toBe("verificationMinutes");
    expect(validatePolicy({ ...thailandDefaults(), downloadSeconds: 61 })).toBe(
      "downloadSeconds",
    );
    expect(
      validatePolicy({ ...thailandDefaults(), maternityPaidDays: 121 }),
    ).toBe("maternityPaidDays");
  });
});
