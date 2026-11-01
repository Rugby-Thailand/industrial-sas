import { describe, expect, it } from "vitest";
import {
  deriveManagementView,
  normalizedNameKey,
  MAX_LOGO_BYTES,
  validateCompanyLogo,
  suggestEmployeeCode,
  validTaxId,
  validateBranchCodes,
} from "./org";

describe("organization validation and derivation", () => {
  it.each([
    ["0105500000001", true],
    ["010550000001", false],
    ["01055000000011", false],
    ["010550000000A", false],
    ["０１０５５０００００００１", false],
    [" 0105500000001", false],
  ])("validates ASCII tax ID %s", (taxId, valid) =>
    expect(validTaxId(taxId)).toBe(valid),
  );

  it.each(["00000", "00012"])(
    "accepts revenue branch %s and trims SSO account",
    (code) => {
      expect(
        validateBranchCodes(
          code,
          " 123-45 ",
          code === "00000" ? "HEAD_OFFICE" : "BRANCH",
        ),
      ).toEqual({
        ok: true,
        value: { revenueBranchNo: code, ssoEmployerAccount: "123-45" },
      });
    },
  );
  it.each([
    ["12", "1", "REVENUE_BRANCH_NO_INVALID"],
    ["ABCDE", "1", "REVENUE_BRANCH_NO_INVALID"],
    ["00000", " ", "SSO_EMPLOYER_ACCOUNT_REQUIRED"],
    ["00000", "abc", "SSO_EMPLOYER_ACCOUNT_INVALID"],
    ["00000", "1".repeat(21), "SSO_EMPLOYER_ACCOUNT_INVALID"],
  ])("refuses invalid branch codes %s / %s", (branch, sso, code) => {
    expect(validateBranchCodes(branch, sso, "HEAD_OFFICE")).toMatchObject({
      ok: false,
      error: { code },
    });
  });
  it.each([
    ["00000", "BRANCH"],
    ["00012", "HEAD_OFFICE"],
  ] as const)("rejects a branch type inconsistent with %s", (code, type) => {
    expect(validateBranchCodes(code, "123-45", type)).toEqual({
      ok: false,
      error: { code: "BRANCH_TYPE_MISMATCH", field: "type" },
    });
  });
  it("uses the CE 2026 prefix", () => {
    expect(suggestEmployeeCode([], Date.UTC(2026, 9, 20))).toEqual({
      ok: true,
      value: "2600001",
    });
  });
  it("normalizes master uniqueness with trimming and case folding", () => {
    expect(normalizedNameKey("  SALES ")).toBe("sales");
  });
  it("suggests the next matching sequence and ignores other years and malformed codes", () => {
    expect(
      suggestEmployeeCode(
        ["2400010", "2400001", "249999X", "24999999", "2309999", "EMP-1"],
        Date.UTC(2024, 5, 1),
      ),
    ).toEqual({ ok: true, value: "2400011" });
  });
  it("changes the CE prefix at Bangkok midnight and restarts in the new year", () => {
    const boundary = Date.UTC(2024, 11, 31, 17);
    expect(suggestEmployeeCode(["2400010"], boundary - 1)).toEqual({
      ok: true,
      value: "2400011",
    });
    expect(suggestEmployeeCode(["2400010"], boundary)).toEqual({
      ok: true,
      value: "2500001",
    });
  });
  it("pads single digit years and refuses sequence overflow", () => {
    expect(suggestEmployeeCode([], Date.UTC(2003, 0, 1))).toEqual({
      ok: true,
      value: "0300001",
    });
    expect(suggestEmployeeCode(["2499999"], Date.UTC(2024, 5, 1))).toEqual({
      ok: false,
      error: { code: "EMPLOYEE_CODE_EXHAUSTED" },
    });
  });
  it("lists each management relation once and never matches unlinked supervisors", () => {
    const department = { _id: "sales", managerEmployeeId: "manager" };
    const subordinate = { _id: "e1", supervisorUserId: "u1" };
    expect(
      deriveManagementView(
        { _id: "manager", userId: "u1" },
        [department, { _id: "other" }],
        [subordinate, { _id: "other" }],
      ),
    ).toEqual({
      responsibleDepartments: [department],
      subordinates: [subordinate],
    });
    expect(
      deriveManagementView(
        { _id: "manager" },
        [department],
        [{ _id: "unlinked" }],
      ).subordinates,
    ).toEqual([]);
  });
});

it.each([
  ["image/png", "\x89PNG\r\n\x1a\n"],
  ["image/jpeg", "\xff\xd8\xff"],
  ["image/webp", "RIFF\x00\x00\x00\x00WEBP"],
])("validates %s magic bytes", (mimeType, signature) => {
  expect(validateCompanyLogo(mimeType, btoa(signature))).toEqual({
    ok: true,
    value: { mimeType, base64: btoa(signature) },
  });
  expect(validateCompanyLogo(mimeType, btoa("wrong bytes"))).toMatchObject({
    ok: false,
    error: { code: "LOGO_FILE_INVALID" },
  });
});

it.each([
  ["image/gif", "R0lGODlh"],
  ["image/png", ""],
  ["image/png", "not base64!"],
  ["image/png", "iVBORw0KGgp="], // Noncanonical padding bits.
  ["image/png", btoa("\xff\xd8\xff")],
  ["image/webp", btoa("RIFFWEBP")],
])("refuses invalid logo data %s / %s", (mimeType, base64) => {
  expect(validateCompanyLogo(mimeType, base64)).toMatchObject({
    ok: false,
    error: { code: "LOGO_FILE_INVALID" },
  });
});

it("accepts exactly 256 KiB decoded and refuses the next byte", () => {
  const bytes = "\x89PNG\r\n\x1a\n" + "\x00".repeat(MAX_LOGO_BYTES - 8);
  expect(validateCompanyLogo("image/png", btoa(bytes)).ok).toBe(true);
  // 256 KiB + 1 has the same encoded length; the decoded limit still applies.
  expect(validateCompanyLogo("image/png", btoa(bytes + "\x00"))).toMatchObject({
    ok: false,
    error: { code: "LOGO_TOO_LARGE", field: "base64" },
  });
  expect(
    validateCompanyLogo("image/png", btoa(bytes + "\x00\x00\x00")),
  ).toMatchObject({
    ok: false,
    error: { code: "LOGO_TOO_LARGE" },
  });
});
