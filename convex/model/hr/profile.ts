/**
 * Employee personal, contact, emergency-contact and payment details.
 *
 * Status: implemented. Every field is optional text; empty values clear the
 * field instead of storing empty strings. Formats are checked only where the
 * format is certain (ISO dates, Thai 13-digit ID check digit, 5-digit postcode,
 * e-mail shape, phone characters, bank account digits). No payroll arithmetic
 * and no transfer action live here; payment details are stored for HR only.
 */
import { fail, ok, type Result } from "../result";
import { compareDates, isIsoDate } from "./calendar";

export const GENDERS = ["MALE", "FEMALE", "OTHER"] as const;
export const MARITAL_STATUSES = [
  "SINGLE",
  "MARRIED",
  "DIVORCED",
  "WIDOWED",
] as const;
export const PAY_METHODS = ["BANK", "CASH"] as const;

export type Gender = (typeof GENDERS)[number];
export type MaritalStatus = (typeof MARITAL_STATUSES)[number];
export type PayMethod = (typeof PAY_METHODS)[number];

/** Text fields and their maximum lengths, in display order. */
export const PROFILE_TEXT_FIELDS = {
  title: 30,
  firstName: 80,
  lastName: 80,
  firstNameEn: 80,
  lastNameEn: 80,
  nickname: 40,
  nationalId: 13,
  nationality: 60,
  religion: 60,
  email: 120,
  phone: 30,
  lineId: 60,
  address: 300,
  province: 80,
  postalCode: 5,
  emergencyName: 120,
  emergencyRelationship: 60,
  emergencyPhone: 30,
} as const;

export type ProfileTextField = keyof typeof PROFILE_TEXT_FIELDS;

export type ProfileDraft = {
  readonly [Key in ProfileTextField]?: string | undefined;
} & {
  readonly gender?: Gender | undefined;
  readonly maritalStatus?: MaritalStatus | undefined;
  readonly birthDate?: string | undefined;
};

export type ProfileErrorCode =
  | "PROFILE_TEXT_TOO_LONG"
  | "PROFILE_NATIONAL_ID_INVALID"
  | "PROFILE_EMAIL_INVALID"
  | "PROFILE_PHONE_INVALID"
  | "PROFILE_POSTAL_CODE_INVALID"
  | "PROFILE_BIRTH_DATE_INVALID"
  | "PROFILE_EMERGENCY_INCOMPLETE";

export interface ProfileError {
  readonly code: ProfileErrorCode;
  readonly field: string;
}

const trimmed = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  const text = value.trim().replace(/\s+/g, " ");
  return text === "" ? undefined : text;
};

/** The Thai 13-digit identification number check digit (mod 11). */
export function validThaiNationalId(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false;
  let sum = 0;
  for (let index = 0; index < 12; index += 1)
    sum += Number(value[index]) * (13 - index);
  return (11 - (sum % 11)) % 10 === Number(value[12]);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9][0-9 ()-]{5,28}$/;

/** A normalized profile with empty fields removed, or the first error. */
export function validateProfile(
  draft: ProfileDraft,
  today: string,
): Result<ProfileDraft, ProfileError> {
  const out: Record<string, string> = {};
  for (const [field, max] of Object.entries(PROFILE_TEXT_FIELDS)) {
    let value = trimmed(draft[field as ProfileTextField]);
    if (value === undefined) continue;
    if (field === "nationalId") value = value.replace(/[\s-]/g, "");
    if (value.length > max)
      return fail({ code: "PROFILE_TEXT_TOO_LONG", field });
    out[field] = value;
  }
  if (out.nationalId !== undefined && !validThaiNationalId(out.nationalId))
    return fail({ code: "PROFILE_NATIONAL_ID_INVALID", field: "nationalId" });
  if (out.email !== undefined && !EMAIL.test(out.email))
    return fail({ code: "PROFILE_EMAIL_INVALID", field: "email" });
  for (const field of ["phone", "emergencyPhone"] as const)
    if (out[field] !== undefined && !PHONE.test(out[field]))
      return fail({ code: "PROFILE_PHONE_INVALID", field });
  if (out.postalCode !== undefined && !/^\d{5}$/.test(out.postalCode))
    return fail({ code: "PROFILE_POSTAL_CODE_INVALID", field: "postalCode" });
  const birthDate = trimmed(draft.birthDate);
  if (
    birthDate !== undefined &&
    (!isIsoDate(birthDate) ||
      compareDates(birthDate, "1900-01-01") < 0 ||
      compareDates(birthDate, today) > 0)
  )
    return fail({ code: "PROFILE_BIRTH_DATE_INVALID", field: "birthDate" });
  // An emergency contact is a person who can be reached.
  const emergency =
    out.emergencyName !== undefined ||
    out.emergencyRelationship !== undefined ||
    out.emergencyPhone !== undefined;
  if (emergency && out.emergencyName === undefined)
    return fail({
      code: "PROFILE_EMERGENCY_INCOMPLETE",
      field: "emergencyName",
    });
  if (emergency && out.emergencyPhone === undefined)
    return fail({
      code: "PROFILE_EMERGENCY_INCOMPLETE",
      field: "emergencyPhone",
    });
  return ok(
    Object.freeze({
      ...out,
      ...(draft.gender === undefined ? {} : { gender: draft.gender }),
      ...(draft.maritalStatus === undefined
        ? {}
        : { maritalStatus: draft.maritalStatus }),
      ...(birthDate === undefined ? {} : { birthDate }),
    }),
  );
}

export interface PaymentDraft {
  readonly method: PayMethod;
  readonly bankName?: string | undefined;
  readonly accountNumber?: string | undefined;
  readonly accountName?: string | undefined;
  readonly bankBranchCode?: string | undefined;
}

export type PaymentErrorCode =
  | "PAYMENT_BANK_REQUIRED"
  | "PAYMENT_ACCOUNT_INVALID"
  | "PAYMENT_TEXT_TOO_LONG"
  | "PAYMENT_BRANCH_CODE_INVALID";

export interface PaymentError {
  readonly code: PaymentErrorCode;
  readonly field: string;
}

/**
 * A normalized payment method. Bank transfer needs a bank and a 6–20 digit
 * account number (separators removed); cash stores no bank details.
 */
export function validatePayment(
  draft: PaymentDraft,
): Result<PaymentDraft, PaymentError> {
  if (draft.method === "CASH") return ok(Object.freeze({ method: "CASH" }));
  const bankName = trimmed(draft.bankName);
  if (bankName === undefined)
    return fail({ code: "PAYMENT_BANK_REQUIRED", field: "bankName" });
  if (bankName.length > 80)
    return fail({ code: "PAYMENT_TEXT_TOO_LONG", field: "bankName" });
  const accountNumber = (draft.accountNumber ?? "").replace(/[\s-]/g, "");
  if (!/^\d{6,20}$/.test(accountNumber))
    return fail({ code: "PAYMENT_ACCOUNT_INVALID", field: "accountNumber" });
  const accountName = trimmed(draft.accountName);
  if (accountName !== undefined && accountName.length > 120)
    return fail({ code: "PAYMENT_TEXT_TOO_LONG", field: "accountName" });
  const bankBranchCode = trimmed(draft.bankBranchCode);
  if (
    bankBranchCode !== undefined &&
    !/^[0-9A-Za-z-]{1,10}$/.test(bankBranchCode)
  )
    return fail({
      code: "PAYMENT_BRANCH_CODE_INVALID",
      field: "bankBranchCode",
    });
  return ok(
    Object.freeze({
      method: "BANK" as const,
      bankName,
      accountNumber,
      ...(accountName === undefined ? {} : { accountName }),
      ...(bankBranchCode === undefined ? {} : { bankBranchCode }),
    }),
  );
}

/** The last four digits only, for lists, receipts and audit. */
export const maskAccountNumber = (value: string): string =>
  value.length <= 4 ? "••••" : `•••• ${value.slice(-4)}`;
