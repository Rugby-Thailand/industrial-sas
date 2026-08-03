/**
 * Quantity: integer minor units of an item's base UOM (`G-029`, `G-038`,
 * `ADR-0004`, `INV-0004-01`, `INV-0004-06`).
 *
 * Status: **implemented** as pure arithmetic. No table stores a quantity, and no
 * Convex function posts one; the ledger this exists for does not exist yet.
 *
 * One scale, everywhere: a quantity is an integer count of **thousandths** of the
 * base UOM. `1.005 KG` is `1005`. Three decimals is the cap B-12 sets, and a
 * fixed scale means no call site decides precision — the alternative, decimal
 * strings parsed at each use, pushes the rounding decision into every screen.
 *
 * Every path validates. Construction, arithmetic, parsing, and formatting each
 * re-check `Number.isSafeInteger` and the magnitude bound, so a value that was
 * built by hand rather than through `makeQuantity` still cannot enter a sum. The
 * bound is not decoration: at 2^53 an addition stops being exact, and a ledger
 * that must replay to the same number cannot afford one inexact addition.
 *
 * A quantity carries the UOM code it is measured in, and arithmetic requires the
 * codes to match. That is what stops `12 PCS + 3 KG`. It does **not** stop
 * `item A's KG + item B's KG`; that is the item layer's job
 * (`convex/model/uom/itemUom.ts`), because a UOM code is opaque master data and
 * the conversion table that gives it meaning belongs to the item.
 *
 * Money is not here and never will be (`INV-0004-07`): THB minor units are a
 * different type with a different scale, and sharing one type is how a price
 * ends up in a balance.
 *
 * Pure module (plan §6.2): no Convex imports.
 */
import { fail, ok, type Result } from "../result";

/* -------------------------------------------------------------------------- */
/* Scale and bounds                                                            */
/* -------------------------------------------------------------------------- */

/** Decimal places a quantity can express (B-12). */
export const QUANTITY_DECIMALS = 3;

/** Minor units per base unit. `10 ** QUANTITY_DECIMALS`, stated as a literal. */
export const QUANTITY_SCALE = 1000;

/**
 * The magnitude bound, in minor units: 10^12 thousandths, i.e. one billion base
 * units. Chosen so that a sum of two quantities (up to 2·10^12) and a scaled
 * quantity are still exact integers far below 2^53-1, while leaving room for a
 * warehouse-scale balance. A value past it is rejected, never truncated.
 */
export const MAX_QUANTITY_MINOR_UNITS = 1_000_000_000_000;

/** Longest UOM code accepted. Master data owns the vocabulary, not this module. */
export const MAX_UOM_CODE_LENGTH = 12;

/** `KG`, `PCS`, `CASE20`. Uppercase, starts with a letter, no punctuation. */
const UOM_CODE_PATTERN = /^[A-Z][A-Z0-9]{0,11}$/;

/**
 * Optional sign, 1-13 integer digits, and an optional fraction. The fraction is
 * matched up to 18 digits so that too much precision is reported as
 * `PRECISION_EXCEEDED` rather than as a malformed string; beyond that the input
 * is not a quantity anyone typed.
 */
const DECIMAL_PATTERN = /^([+-]?)(\d{1,13})(?:\.(\d{1,18}))?$/;

/* -------------------------------------------------------------------------- */
/* Values                                                                      */
/* -------------------------------------------------------------------------- */

/** A validated UOM code. Uppercase ASCII; see `normalizeUomCode`. */
export type UomCode = string;

/**
 * A signed quantity in minor units of `uom`. Signed because a ledger line is a
 * signed posting; zero is representable because a running balance may be zero,
 * and `requireNonZeroQuantity` is what a posting uses (`INV-0003-03`).
 */
export interface Quantity {
  readonly uom: UomCode;
  readonly minorUnits: number;
}

export type QuantityError =
  | { readonly code: "NOT_AN_INTEGER"; readonly value: number }
  | {
      readonly code: "OUT_OF_RANGE";
      readonly value: number;
      readonly limit: number;
    }
  | {
      readonly code: "UOM_MISMATCH";
      readonly left: UomCode;
      readonly right: UomCode;
    }
  | { readonly code: "INVALID_UOM_CODE"; readonly raw: string }
  | { readonly code: "MALFORMED_DECIMAL"; readonly raw: string }
  | {
      readonly code: "PRECISION_EXCEEDED";
      readonly raw: string;
      readonly maximumDecimals: number;
    }
  | { readonly code: "ZERO_NOT_ALLOWED"; readonly uom: UomCode };

/* -------------------------------------------------------------------------- */
/* Construction                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Normalizes and validates a UOM code. Folds ASCII lower case only: `toUpperCase`
 * on arbitrary Unicode can change a string's length (`ß` becomes `SS`), and a
 * normalizer that changes length is not one.
 */
export function normalizeUomCode(raw: string): Result<UomCode, QuantityError> {
  const folded = raw
    .trim()
    .replace(/[a-z]/g, (character) => character.toUpperCase());
  return UOM_CODE_PATTERN.test(folded)
    ? ok(folded)
    : fail({ code: "INVALID_UOM_CODE", raw });
}

/** The only constructor: an integer count of minor units, within bounds. */
export function makeQuantity(
  minorUnits: number,
  uom: UomCode,
): Result<Quantity, QuantityError> {
  const code = normalizeUomCode(uom);
  if (!code.ok) return code;
  if (!Number.isSafeInteger(minorUnits)) {
    return fail({ code: "NOT_AN_INTEGER", value: minorUnits });
  }
  if (Math.abs(minorUnits) > MAX_QUANTITY_MINOR_UNITS) {
    return fail({
      code: "OUT_OF_RANGE",
      value: minorUnits,
      limit: MAX_QUANTITY_MINOR_UNITS,
    });
  }
  return ok(
    Object.freeze({
      uom: code.value,
      // `-0` is a distinct double that `Object.is` separates from `0`, survives
      // JSON, and would make two zero balances look unequal. Normalize it once,
      // here, rather than in every comparison.
      minorUnits: minorUnits === 0 ? 0 : minorUnits,
    }),
  );
}

/** `5 KG` from whole base units, without the caller multiplying by the scale. */
export function quantityFromBaseUnits(
  baseUnits: number,
  uom: UomCode,
): Result<Quantity, QuantityError> {
  if (!Number.isSafeInteger(baseUnits)) {
    return fail({ code: "NOT_AN_INTEGER", value: baseUnits });
  }
  const minorUnits = baseUnits * QUANTITY_SCALE;
  if (!Number.isSafeInteger(minorUnits)) {
    return fail({ code: "NOT_AN_INTEGER", value: minorUnits });
  }
  return makeQuantity(minorUnits, uom);
}

/** The additive identity for a UOM. */
export const zeroQuantity = (uom: UomCode): Result<Quantity, QuantityError> =>
  makeQuantity(0, uom);

/**
 * Parses operator or file input such as `"12"`, `"1.005"`, `"-0.25"`.
 *
 * Digit arithmetic only: `Number("0.001") * 1000` is a float multiplication and
 * `parseFloat` accepts `"1e3"`, `"0x10"`, and `"12abc"`. Rejects a bare sign, a
 * trailing dot, whitespace, exponents, thousands separators, and non-ASCII
 * digits. More than three decimals is `PRECISION_EXCEEDED` rather than a silent
 * round (`INV-0004-05`) — even when the extra digits are zeros, because
 * accepting `"1.0000"` and rejecting `"1.0001"` on the same screen is the kind of
 * inconsistency operators cannot predict.
 */
export function parseDecimalQuantity(
  raw: string,
  uom: UomCode,
): Result<Quantity, QuantityError> {
  const match = DECIMAL_PATTERN.exec(raw);
  if (match === null) return fail({ code: "MALFORMED_DECIMAL", raw });
  const [, sign, whole, decimals] = match;
  if (decimals !== undefined && decimals.length > QUANTITY_DECIMALS) {
    return fail({
      code: "PRECISION_EXCEEDED",
      raw,
      maximumDecimals: QUANTITY_DECIMALS,
    });
  }
  const fraction = (decimals ?? "").padEnd(QUANTITY_DECIMALS, "0");
  const magnitude = Number(`${whole}${fraction}`);
  if (!Number.isSafeInteger(magnitude)) {
    return fail({
      code: "OUT_OF_RANGE",
      value: magnitude,
      limit: MAX_QUANTITY_MINOR_UNITS,
    });
  }
  return makeQuantity(sign === "-" ? -magnitude : magnitude, uom);
}

/* -------------------------------------------------------------------------- */
/* Arithmetic                                                                  */
/* -------------------------------------------------------------------------- */

/** Adds two quantities of the same UOM. Total: every failure is named. */
export function addQuantities(
  left: Quantity,
  right: Quantity,
): Result<Quantity, QuantityError> {
  const operands = validatePair(left, right);
  if (!operands.ok) return operands;
  return makeQuantity(left.minorUnits + right.minorUnits, left.uom);
}

/** Subtracts `right` from `left`. Negative results are legal (a reversal). */
export function subtractQuantities(
  left: Quantity,
  right: Quantity,
): Result<Quantity, QuantityError> {
  const operands = validatePair(left, right);
  if (!operands.ok) return operands;
  return makeQuantity(left.minorUnits - right.minorUnits, left.uom);
}

/** Flips the sign. The compensating line of a reversal is exactly this. */
export const negateQuantity = (
  quantity: Quantity,
): Result<Quantity, QuantityError> =>
  makeQuantity(-quantity.minorUnits, quantity.uom);

/** Magnitude, for display and tolerance checks. */
export const absoluteQuantity = (
  quantity: Quantity,
): Result<Quantity, QuantityError> =>
  makeQuantity(Math.abs(quantity.minorUnits), quantity.uom);

/**
 * -1, 0, or 1, or a `UOM_MISMATCH`. A comparison across UOMs has no answer, so
 * it returns a result rather than a number that would sort silently wrong.
 */
export function compareQuantities(
  left: Quantity,
  right: Quantity,
): Result<number, QuantityError> {
  const operands = validatePair(left, right);
  if (!operands.ok) return operands;
  if (left.minorUnits === right.minorUnits) return ok(0);
  return ok(left.minorUnits < right.minorUnits ? -1 : 1);
}

/** Sums a list. The UOM is explicit so an empty list still has one. */
export function sumQuantities(
  quantities: readonly Quantity[],
  uom: UomCode,
): Result<Quantity, QuantityError> {
  let total = zeroQuantity(uom);
  for (const quantity of quantities) {
    if (!total.ok) return total;
    total = addQuantities(total.value, quantity);
  }
  return total;
}

/** True for an exact zero. Cheap, and does not validate: use before arithmetic. */
export const isZeroQuantity = (quantity: Quantity): boolean =>
  quantity.minorUnits === 0;

/** The gate a ledger posting owes (`INV-0003-03`): no zero-quantity line. */
export const requireNonZeroQuantity = (
  quantity: Quantity,
): Result<Quantity, QuantityError> =>
  isZeroQuantity(quantity)
    ? fail({ code: "ZERO_NOT_ALLOWED", uom: quantity.uom })
    : makeQuantity(quantity.minorUnits, quantity.uom);

/* -------------------------------------------------------------------------- */
/* Display                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Renders a quantity for humans. Rounding is display-only and here there is
 * none: the digits shown are the digits stored (`ADR-0004` §5). No `Intl` and no
 * grouping separators — a locale-dependent decimal mark on a warehouse screen is
 * how `1.005` becomes `1,005`.
 */
export function formatQuantity(
  quantity: Quantity,
  options: { readonly trimTrailingZeros?: boolean } = {},
): string {
  const sign = quantity.minorUnits < 0 ? "-" : "";
  const magnitude = Math.abs(quantity.minorUnits);
  const whole = Math.floor(magnitude / QUANTITY_SCALE);
  const fraction = String(magnitude % QUANTITY_SCALE).padStart(
    QUANTITY_DECIMALS,
    "0",
  );
  const trimmed =
    options.trimTrailingZeros === true ? fraction.replace(/0+$/, "") : fraction;
  return trimmed === "" ? `${sign}${whole}` : `${sign}${whole}.${trimmed}`;
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/** Re-validates both operands and proves the UOMs agree before any arithmetic. */
function validatePair(
  left: Quantity,
  right: Quantity,
): Result<true, QuantityError> {
  const validatedLeft = makeQuantity(left.minorUnits, left.uom);
  if (!validatedLeft.ok) return validatedLeft;
  const validatedRight = makeQuantity(right.minorUnits, right.uom);
  if (!validatedRight.ok) return validatedRight;
  if (validatedLeft.value.uom !== validatedRight.value.uom) {
    return fail({
      code: "UOM_MISMATCH",
      left: validatedLeft.value.uom,
      right: validatedRight.value.uom,
    });
  }
  return ok(true);
}
