import { isRecord, isSafeInt, isString } from "../guards";
import { fail, ok, type Result } from "../result";
import {
  convertToBase,
  type ItemUomProfile,
  type ItemUomError,
} from "../uom/itemUom";
import {
  MAX_QUANTITY_MINOR_UNITS,
  QUANTITY_DECIMALS,
  makeQuantity,
  normalizeUomCode,
  type Quantity,
  type QuantityError,
} from "../uom/quantity";

const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";

export const MAX_QUANTITY_ENTRY_LENGTH = 24;

const GROUPING = /[,   ']/g;

const NORMALIZED_PATTERN = /^([+-]?)(\d{1,13})(?:\.(\d{1,18}))?$/;

const GROUPED_INTEGER = /^\d{1,3}(?:,\d{3})+$/;

export type QuantityEntryError =
  | { readonly code: "ENTRY_REQUIRED" }
  | {
      readonly code: "ENTRY_TOO_LONG";
      readonly limit: number;
      readonly actualLength: number;
    }
  | { readonly code: "MIXED_NUMERAL_SYSTEMS" }
  | { readonly code: "MALFORMED_GROUPING" }
  | { readonly code: "MALFORMED_ENTRY" }
  | {
      readonly code: "PRECISION_EXCEEDED";
      readonly maximumDecimals: number;
    }
  | { readonly code: "NEGATIVE_NOT_ALLOWED" }
  | { readonly code: "ZERO_NOT_ALLOWED" }
  | { readonly code: "QUANTITY_INVALID"; readonly cause: QuantityError }
  | { readonly code: "UOM_NOT_CONVERTIBLE"; readonly cause: ItemUomError }
  /**
   * The entry converts to a fraction of a base minor unit — half a case of an
   * odd pack size. Not rounded: `ADR-0004` §5 rejects rather than rounds, and
   * an operator who is told "enter this in eaches" loses nothing but a keystroke.
   */
  | { readonly code: "UOM_CONVERSION_INEXACT"; readonly baseUom: string };

export function normalizeThaiDigits(
  raw: string,
): Result<string, QuantityEntryError> {
  if (!isString(raw)) return fail({ code: "ENTRY_REQUIRED" });
  const hasThai = /[๐-๙]/u.test(raw);
  if (!hasThai) return ok(raw);
  if (/[0-9]/u.test(raw)) return fail({ code: "MIXED_NUMERAL_SYSTEMS" });
  return ok(
    raw.replace(/[๐-๙]/gu, (digit) => String(THAI_DIGITS.indexOf(digit))),
  );
}

export function normalizeQuantityEntry(
  raw: string,
): Result<string, QuantityEntryError> {
  if (!isString(raw)) return fail({ code: "ENTRY_REQUIRED" });
  const trimmed = raw.trim();
  if (trimmed.length === 0) return fail({ code: "ENTRY_REQUIRED" });
  if (trimmed.length > MAX_QUANTITY_ENTRY_LENGTH) {
    return fail({
      code: "ENTRY_TOO_LONG",
      limit: MAX_QUANTITY_ENTRY_LENGTH,
      actualLength: trimmed.length,
    });
  }

  const ascii = normalizeThaiDigits(trimmed);
  if (!ascii.ok) return ascii;

  const signMatch = /^([+-]?)(.*)$/.exec(ascii.value);
  const sign = signMatch?.[1] ?? "";
  const body = signMatch?.[2] ?? "";

  const parts = body.split(".");
  if (parts.length > 2) return fail({ code: "MALFORMED_ENTRY" });
  const [integerPart = "", fractionPart] = parts;

  const spaced = integerPart.replace(/[   ']/g, ",");
  const hasGrouping = spaced.includes(",");
  const ungrouped = hasGrouping ? spaced.replace(GROUPING, "") : integerPart;
  if (hasGrouping && !GROUPED_INTEGER.test(spaced)) {
    return fail({ code: "MALFORMED_GROUPING" });
  }
  if (fractionPart !== undefined && GROUPING.test(fractionPart)) {
    return fail({ code: "MALFORMED_GROUPING" });
  }

  const candidate =
    fractionPart === undefined
      ? `${sign}${ungrouped}`
      : `${sign}${ungrouped}.${fractionPart}`;
  const match = NORMALIZED_PATTERN.exec(candidate);
  if (match === null) return fail({ code: "MALFORMED_ENTRY" });
  if ((match[3]?.length ?? 0) > QUANTITY_DECIMALS) {
    return fail({
      code: "PRECISION_EXCEEDED",
      maximumDecimals: QUANTITY_DECIMALS,
    });
  }
  return ok(candidate);
}

export interface QuantityEntryInput {
  readonly text: string;

  readonly entryUom: string;

  readonly profile?: ItemUomProfile | undefined;

  readonly allowNegative?: boolean;

  readonly allowZero?: boolean;
}

export interface CapturedQuantity {
  readonly entered: Quantity;

  readonly base: Quantity;

  readonly converted: boolean;
}

export function captureQuantity(
  input: QuantityEntryInput,
): Result<CapturedQuantity, QuantityEntryError> {
  if (!isRecord(input)) return fail({ code: "ENTRY_REQUIRED" });

  const text = normalizeQuantityEntry(input.text);
  if (!text.ok) return text;

  const uom = normalizeUomCode(input.entryUom);
  if (!uom.ok) return fail({ code: "QUANTITY_INVALID", cause: uom.error });

  const minorUnits = decimalToMinorUnits(text.value);
  if (!minorUnits.ok) return minorUnits;

  if (minorUnits.value < 0 && input.allowNegative !== true) {
    return fail({ code: "NEGATIVE_NOT_ALLOWED" });
  }
  if (minorUnits.value === 0 && input.allowZero !== true) {
    return fail({ code: "ZERO_NOT_ALLOWED" });
  }

  const entered = makeQuantity(minorUnits.value, uom.value);
  if (!entered.ok) {
    return fail({ code: "QUANTITY_INVALID", cause: entered.error });
  }

  if (input.profile === undefined) {
    return ok(
      Object.freeze({
        entered: entered.value,
        base: entered.value,
        converted: false,
      }),
    );
  }

  const converted = convertToBase(
    input.profile,
    entered.value.uom,
    entered.value.minorUnits,
  );
  if (converted.kind === "REJECTED") {
    return fail({ code: "UOM_NOT_CONVERTIBLE", cause: converted.error });
  }
  if (converted.kind === "INEXACT") {
    return fail({ code: "UOM_CONVERSION_INEXACT", baseUom: converted.uom });
  }
  return ok(
    Object.freeze({
      entered: entered.value,
      base: converted.quantity,
      converted: converted.quantity.uom !== entered.value.uom,
    }),
  );
}

export const PLAUSIBILITY_FACTOR = 3;

export type PlausibilityVerdict =
  | { readonly kind: "PLAUSIBLE" }
  /** No expectation was available, so nothing was checked. Not "fine". */
  | { readonly kind: "UNCHECKED" }
  | {
      readonly kind: "IMPLAUSIBLE";
      readonly expectedBaseMinorUnits: number;
      readonly enteredBaseMinorUnits: number;

      readonly factor: number;
    };

export function judgePlausibility(input: {
  readonly enteredBaseMinorUnits: number;
  readonly expectedBaseMinorUnits?: number | undefined;
  readonly factor?: number;
}): PlausibilityVerdict {
  if (!isRecord(input) || !isSafeInt(input.enteredBaseMinorUnits)) {
    return { kind: "UNCHECKED" };
  }
  const expected = input.expectedBaseMinorUnits;
  if (expected === undefined || !isSafeInt(expected) || expected <= 0) {
    return { kind: "UNCHECKED" };
  }
  const factor =
    typeof input.factor === "number" && input.factor > 0
      ? input.factor
      : PLAUSIBILITY_FACTOR;

  const entered = Math.abs(input.enteredBaseMinorUnits);
  if (entered <= expected * factor) return { kind: "PLAUSIBLE" };
  return {
    kind: "IMPLAUSIBLE",
    expectedBaseMinorUnits: expected,
    enteredBaseMinorUnits: input.enteredBaseMinorUnits,
    factor: Math.floor((entered / expected) * 100) / 100,
  };
}

function decimalToMinorUnits(text: string): Result<number, QuantityEntryError> {
  const match = NORMALIZED_PATTERN.exec(text);
  if (match === null) return fail({ code: "MALFORMED_ENTRY" });
  const [, sign, whole = "0", decimals] = match;
  const fraction = (decimals ?? "").padEnd(QUANTITY_DECIMALS, "0");
  const magnitude = Number(`${whole}${fraction}`);
  if (!isSafeInt(magnitude) || magnitude > MAX_QUANTITY_MINOR_UNITS) {
    return fail({
      code: "QUANTITY_INVALID",
      cause: {
        code: "OUT_OF_RANGE",
        value: magnitude,
        limit: MAX_QUANTITY_MINOR_UNITS,
      },
    });
  }
  return ok(sign === "-" ? -magnitude : magnitude);
}
