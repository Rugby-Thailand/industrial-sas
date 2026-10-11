import { selectPayslipSource } from "./payslip";
import { describe, expect, it } from "vitest";
import {
  MAX_PDF_BYTES,
  PAYSLIP_CSV_HEADER,
  freshUntil,
  parsePayslipCsv,
  pdfBytes,
  pdfHash,
  satang,
} from "./payslip";
const now = Date.UTC(2026, 9, 12, 3, 0, 0);
const identity = { sid: "session_verified", iat: now / 1000, fva: [0, -1] };
describe("canonical real payslip source validation", () => {
  it("keeps money in exact satang instead of floating point arithmetic", () => {
    expect(satang("0.01")).toBe(1);
    expect(satang("123.1")).toBe(12310);
    expect(satang("0")).toBe(0);
    for (const value of ["-1", "1.234", "1e3", "1,000", " 1", "NaN"]) {
      expect(satang(value)).toBeNull();
    }
  });
  it("reconciles the canonical header, integer amounts and real dates before staging", () => {
    const source = `\uFEFF${PAYSLIP_CSV_HEADER}\r\nE001,2026-10-01,2026-10-31,2026-10-30,30000.00,1000.25,28999.75\r\n`;
    expect(parsePayslipCsv(source)).toEqual({
      errors: [],
      rows: [
        {
          code: "E001",
          from: "2026-10-01",
          to: "2026-10-31",
          paymentDate: "2026-10-30",
          gross: 3000000,
          deductions: 100025,
          net: 2899975,
        },
      ],
    });
  });
  it("rejects mixed header, impossible dates, duplicate mappings and mismatched source totals", () => {
    expect(parsePayslipCsv("employee,gross").errors).toEqual([
      "CSV_HEADER_INVALID",
    ]);
    const line = "E001,2026-10-01,2026-10-31,2026-10-30,3,1,2";
    expect(
      parsePayslipCsv(`${PAYSLIP_CSV_HEADER}\n${line}\n${line}`).errors,
    ).toContain("EMPLOYEE_DUPLICATE:3");
    expect(
      parsePayslipCsv(
        `${PAYSLIP_CSV_HEADER}\n${line.replace("2026-10-30", "2026-02-30")}`,
      ).errors,
    ).toContain("ROW_INVALID:2");
    expect(
      parsePayslipCsv(
        `${PAYSLIP_CSV_HEADER}\n${line.replace(",3,1,2", ",3,1,3")}`,
      ).errors,
    ).toContain("AMOUNT_INVALID:2");
  });
  it("validates private PDF byte limits and hashes the exact supplied bytes", async () => {
    const raw = "%PDF-1.7\nsource employee statement\n%%EOF\n";
    const bytes = pdfBytes(btoa(raw));
    expect(bytes).toEqual(new TextEncoder().encode(raw));
    expect(await pdfHash(bytes!)).toMatch(/^[a-f0-9]{64}$/);
    expect(await pdfHash(bytes!)).not.toBe(
      await pdfHash(new TextEncoder().encode(raw + " ")),
    );
    expect(pdfBytes(btoa("salary spreadsheet"))).toBeNull();
    expect(pdfBytes("!!!!")).toBeNull();
    expect(pdfBytes(btoa("%PDF-" + "x".repeat(MAX_PDF_BYTES)))).toBeNull();
  });
});
describe("signed provider freshness", () => {
  it("uses first-factor fva and token issuance, conservatively accounting for minute quantization", () => {
    expect(freshUntil(identity, 5, now)).toBe(now + 4 * 60000);
    expect(freshUntil({ ...identity, iat: now / 1000 - 60 }, 5, now)).toBe(
      now + 3 * 60000,
    );
    expect(freshUntil({ ...identity, fva: [2, -1] }, 5, now)).toBe(
      now + 2 * 60000,
    );
  });
  it("does not refresh old authentication merely because another token is read", () => {
    expect(
      freshUntil({ ...identity, iat: now / 1000 - 300 }, 5, now),
    ).toBeNull();
    expect(freshUntil({ ...identity, fva: [4, 0] }, 5, now)).toBeNull();
    expect(freshUntil(identity, 5, now + 4 * 60000)).toBeNull();
  });
  it("refuses unsigned/malformed freshness substitutes, future tokens and unsupported minute windows", () => {
    for (const claims of [
      {},
      { ...identity, fva: [-1, 0] },
      { ...identity, fva: [0] },
      { ...identity, fva: [0, "fresh"] },
      { ...identity, iat: now / 1000 + 10 },
      { ...identity, iat: "now" },
      { ...identity, sid: "" },
      { ...identity, verified: true, fva: undefined },
    ])
      expect(freshUntil(claims, 5, now)).toBeNull();
    expect(freshUntil(identity, 1, now)).toBeNull();
    expect(freshUntil(identity, 2, now)).toBe(now + 60000);
  });
});

it("requires explicit per-source-row exclusion reasons and never repairs included invalid amounts", () => {
  const header =
    "employee_code,period_from,period_to,payment_date,gross,deductions,net";
  const good = "E1,2026-10-01,2026-10-31,2026-10-30,100.00,10.00,90.00";
  const bad = "UNKNOWN,2026-10-01,2026-10-31,2026-10-30,,10.00,0.00";
  const csv = `${header}\n${good}\n${bad}`;
  expect(selectPayslipSource(csv).errors).toEqual(["AMOUNT_INVALID:3"]);
  expect(
    selectPayslipSource(csv, [
      { rowNumber: 3, reason: "Payroll source pending correction" },
    ]),
  ).toMatchObject({
    errors: [],
    rows: [{ code: "E1", net: 9000 }],
    exclusions: [
      {
        rowNumber: 3,
        employeeCode: "UNKNOWN",
        reason: "Payroll source pending correction",
      },
    ],
  });
  for (const exclusions of [
    [{ rowNumber: 3, reason: " " }],
    [{ rowNumber: 4, reason: "Missing source" }],
    [
      { rowNumber: 3, reason: "Missing source" },
      { rowNumber: 3, reason: "Duplicate" },
    ],
  ])
    expect(selectPayslipSource(csv, exclusions).errors).toEqual([
      "CSV_EXCLUSIONS_INVALID",
    ]);
  expect(
    selectPayslipSource(csv, [
      { rowNumber: 2, reason: "Not in scope" },
      { rowNumber: 3, reason: "Invalid source" },
    ]).errors,
  ).toEqual(["CSV_ROW_LIMIT"]);
  expect(
    selectPayslipSource(`${header}\n${good}\n${good}`, [
      { rowNumber: 3, reason: "Duplicate payroll record" },
    ]).errors,
  ).toEqual([]);
});
