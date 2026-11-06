import { expect, it } from "vitest";

import {
  maskAccountNumber,
  validatePayment,
  validateProfile,
  validThaiNationalId,
} from "./profile";

const TODAY = "2026-10-20";

it("checks the Thai national ID check digit", () => {
  expect(validThaiNationalId("1103702071561")).toBe(true);
  expect(validThaiNationalId("1103702071562")).toBe(false);
  expect(validThaiNationalId("110370207156")).toBe(false);
});

it("normalizes profile text and drops empty fields", () => {
  expect(
    validateProfile(
      {
        firstName: "  Somchai   Lee ",
        nickname: " ",
        nationalId: "1-1037-02071-56-1",
        gender: "MALE",
        birthDate: "1990-01-01",
      },
      TODAY,
    ),
  ).toEqual({
    ok: true,
    value: {
      firstName: "Somchai Lee",
      nationalId: "1103702071561",
      gender: "MALE",
      birthDate: "1990-01-01",
    },
  });
});

it("refuses impossible birth dates at both boundaries", () => {
  expect(validateProfile({ birthDate: TODAY }, TODAY).ok).toBe(true);
  expect(validateProfile({ birthDate: "2026-10-21" }, TODAY)).toMatchObject({
    error: { code: "PROFILE_BIRTH_DATE_INVALID" },
  });
  expect(validateProfile({ birthDate: "1899-12-31" }, TODAY)).toMatchObject({
    error: { code: "PROFILE_BIRTH_DATE_INVALID" },
  });
});

it("requires a reachable emergency contact once any emergency field is set", () => {
  expect(
    validateProfile(
      { emergencyName: "Somsri", emergencyPhone: "081 111 2222" },
      TODAY,
    ).ok,
  ).toBe(true);
  expect(
    validateProfile({ emergencyPhone: "081 111 2222" }, TODAY),
  ).toMatchObject({
    error: { code: "PROFILE_EMERGENCY_INCOMPLETE", field: "emergencyName" },
  });
});

it("validates bank transfer details and stores nothing for cash", () => {
  expect(
    validatePayment({
      method: "BANK",
      bankName: " Example Bank ",
      accountNumber: "123-4 56789-0",
    }),
  ).toEqual({
    ok: true,
    value: {
      method: "BANK",
      bankName: "Example Bank",
      accountNumber: "1234567890",
    },
  });
  expect(
    validatePayment({ method: "BANK", bankName: "B", accountNumber: "12345" }),
  ).toMatchObject({ error: { code: "PAYMENT_ACCOUNT_INVALID" } });
  expect(
    validatePayment({
      method: "CASH",
      bankName: "B",
      accountNumber: "123456789",
    }),
  ).toEqual({ ok: true, value: { method: "CASH" } });
  expect(maskAccountNumber("1234567890")).toBe("•••• 7890");
  expect(maskAccountNumber("123")).toBe("••••");
});
