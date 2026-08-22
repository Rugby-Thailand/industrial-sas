/**
 * The shared quantity-entry contract: what an operator types, and what the
 * server is allowed to believe it meant (plan §8 `FF-P1-10`, `ADR-0004`,
 * `ADR-0010`).
 *
 * Status: **implemented.** Every quantity a handheld captures — count, scrap,
 * short pick, output report — goes through this module, so the rules below are
 * decided once rather than per screen.
 *
 * ### What this adds over `convex/model/uom/quantity.ts`
 *
 * `parseDecimalQuantity` is deliberately strict: ASCII digits, one dot, no
 * separators, no exponent. That strictness is right for a file import and wrong
 * for a Thai keypad, which is where three real inputs come from:
 *
 * 1. **Thai digits.** `๑๒` is twelve. A Thai keyboard produces them, an
 *    operator reading a printed sheet copies them, and refusing them is the
 *    system telling somebody their own numerals are invalid (`ADR-0010`).
 *    They are mapped to ASCII, never mixed: `1๒` is refused, because a string
 *    with two numeral systems in it is a paste accident, and guessing which one
 *    the operator meant is how a 12 becomes a 1.
 * 2. **Grouping separators.** `1,200` and `1 200` are how people write twelve
 *    hundred. Both are accepted **only in the integer part** and only in
 *    well-formed groups of three, so `1,20` and `1,2,00` are refused rather
 *    than silently read as 120 or 1200.
 * 3. **Decimal marks.** Thai uses `.`, so there is exactly one decimal mark and
 *    a comma is never one. `1,5` is one thousand five hundred with a malformed
 *    group — refused — and never one-and-a-half. That ambiguity is the reason
 *    the separator rules are strict rather than forgiving.
 *
 * ### Entry UOM is not base UOM
 *
 * An operator counts in cases; the ledger stores eaches. The conversion is
 * exact and happens **server-side** through the item's own profile
 * (`convex/model/uom/itemUom.ts`), because a browser that converted would be a
 * second, unversioned copy of the conversion table.
 *
 * ### Plausibility is a confirmation, not a ceiling
 *
 * A count of 10,000 where 100 was expected is usually a keypad slip and
 * occasionally the truth. So an entry beyond the expectation is not refused —
 * it is returned as `IMPLAUSIBLE` with the factor by which it exceeds, and the
 * caller decides what evidence it needs (a supervisor step-up, in
 * `convex/platform/tasks.ts`). Refusing outright would make the system unable
 * to record reality; accepting silently would let a slip post as fact.
 *
 * Pure module (plan §6.2): no Convex imports.
 */
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

/* -------------------------------------------------------------------------- */
/* Digits and separators                                                       */
/* -------------------------------------------------------------------------- */

/** Thai digits ๐–๙, in value order. */
const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";

/** Longest raw entry accepted, before normalization. */
export const MAX_QUANTITY_ENTRY_LENGTH = 24;

/** Grouping separators an operator may type in the integer part. */
const GROUPING = /[,   ']/g;

/** A normalized entry: optional sign, digits, optional dot and digits. */
const NORMALIZED_PATTERN = /^([+-]?)(\d{1,13})(?:\.(\d{1,18}))?$/;

/** How grouping must look if it is used at all: 1,234,567. */
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

/**
 * Map Thai digits to ASCII, refusing a string that mixes the two systems.
 *
 * Returns the text unchanged when it contains no Thai digit, so the common
 * case costs one regular-expression test.
 */
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

/**
 * Turn what an operator typed into the strict decimal text the UOM kernel
 * parses, or say exactly why it cannot be one.
 *
 * The order matters: Thai digits first (so grouping rules see ASCII), then the
 * decimal split, then grouping validation on the integer part only. Validating
 * grouping before the split would accept `1.234,567`, which is a European
 * format this system does not use and which would read as a different number.
 */
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

  // Grouping is legal only in the integer part, and only in threes. A separator
  // anywhere else is a paste artefact, not a number.
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

/* -------------------------------------------------------------------------- */
/* Capture                                                                     */
/* -------------------------------------------------------------------------- */

export interface QuantityEntryInput {
  /** Exactly what the operator typed, before any repair. */
  readonly text: string;
  /** The unit the operator says they counted in. */
  readonly entryUom: string;
  /**
   * The item's conversion profile, so the entry unit reaches base units
   * exactly. Absent means "the entry unit is the base unit", which is what a
   * screen with no alternate units offers.
   */
  readonly profile?: ItemUomProfile | undefined;
  /** Negative entries are refused unless the caller says otherwise. */
  readonly allowNegative?: boolean;
  /** Zero is refused unless the caller says otherwise (a count of zero is real). */
  readonly allowZero?: boolean;
}

export interface CapturedQuantity {
  /** What the operator typed, normalized but still in their unit. */
  readonly entered: Quantity;
  /** The same amount in the item's base unit, exactly converted. */
  readonly base: Quantity;
  /** True when the entry unit was not the base unit. */
  readonly converted: boolean;
}

/**
 * Capture one quantity: normalize the text, build the entered quantity, and
 * convert it to base minor units.
 *
 * Both quantities are returned, and both are stored by callers: the entered
 * value is what the operator will be asked about ("you said 3 cases"), and the
 * base value is what the ledger balances. Keeping only the base value makes
 * every later conversation about a quantity a translation exercise.
 */
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

/* -------------------------------------------------------------------------- */
/* Plausibility                                                                */
/* -------------------------------------------------------------------------- */

/**
 * How far past the expectation an entry may go before it needs confirming.
 *
 * Three times, and it is a code-owned constant rather than a tenant setting for
 * the same reason the lease is: a tenant that raised it to a hundred would have
 * disabled the check without anyone noticing, and the confirmation costs one
 * approval rather than a refusal.
 */
export const PLAUSIBILITY_FACTOR = 3;

export type PlausibilityVerdict =
  | { readonly kind: "PLAUSIBLE" }
  /** No expectation was available, so nothing was checked. Not "fine". */
  | { readonly kind: "UNCHECKED" }
  | {
      readonly kind: "IMPLAUSIBLE";
      readonly expectedBaseMinorUnits: number;
      readonly enteredBaseMinorUnits: number;
      /** How many times the expectation the entry is, rounded down to 2 dp. */
      readonly factor: number;
    };

/**
 * Judge one captured quantity against what the task expected.
 *
 * `UNCHECKED` is a distinct answer from `PLAUSIBLE`, because a screen that
 * showed "looks right" for an entry nothing was compared against would be
 * inventing reassurance. A blind count legitimately has no expectation.
 */
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

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Strict decimal text to minor units, by digit arithmetic.
 *
 * Not `Number(text) * 1000`: that is a float multiplication, and `0.29 * 1000`
 * is `289.99999999999994`. The kernel makes the same choice for the same
 * reason; this is its entry-side twin because the normalized text has already
 * been validated here and re-parsing it in two places would be two chances to
 * disagree about `PRECISION_EXCEEDED`.
 */
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
