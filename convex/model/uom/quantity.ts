import { isArray, isBoolean, isRecord, isSafeInt, isString } from "../guards";
import { fail, ok, type Result } from "../result";

export const QUANTITY_DECIMALS = 3;

export const QUANTITY_SCALE = 1000;

export const MAX_QUANTITY_MINOR_UNITS = 1_000_000_000_000;

export const MAX_UOM_CODE_LENGTH = 12;

const UOM_CODE_PATTERN = /^[A-Z][A-Z0-9]{0,11}$/;

const DECIMAL_PATTERN = /^([+-]?)(\d{1,13})(?:\.(\d{1,18}))?$/;

export type UomCode = string;

export interface Quantity {
  readonly uom: UomCode;
  readonly minorUnits: number;
}

export type QuantityError =
  | { readonly code: "NOT_A_QUANTITY"; readonly received: string }
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
  | { readonly code: "ZERO_NOT_ALLOWED"; readonly uom: UomCode }
  | {
      readonly code: "INVALID_FORMAT_OPTIONS";
      readonly field: "options" | "trimTrailingZeros";
      readonly received: string;
    };

export function normalizeUomCode(raw: string): Result<UomCode, QuantityError> {
  if (!isString(raw)) {
    return fail({ code: "INVALID_UOM_CODE", raw: describe(raw) });
  }
  const folded = raw
    .trim()
    .replace(/[a-z]/g, (character) => character.toUpperCase());
  return UOM_CODE_PATTERN.test(folded)
    ? ok(folded)
    : fail({ code: "INVALID_UOM_CODE", raw });
}

export function makeQuantity(
  minorUnits: number,
  uom: UomCode,
): Result<Quantity, QuantityError> {
  const code = normalizeUomCode(uom);
  if (!code.ok) return code;
  if (!isSafeInt(minorUnits)) {
    return fail({ code: "NOT_AN_INTEGER", value: numberOrNaN(minorUnits) });
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

      minorUnits: minorUnits === 0 ? 0 : minorUnits,
    }),
  );
}

export function validateQuantity(
  quantity: Quantity,
): Result<Quantity, QuantityError> {
  if (!isRecord(quantity)) {
    return fail({ code: "NOT_A_QUANTITY", received: describe(quantity) });
  }
  return makeQuantity(quantity.minorUnits, quantity.uom);
}

export function quantityFromBaseUnits(
  baseUnits: number,
  uom: UomCode,
): Result<Quantity, QuantityError> {
  if (!isSafeInt(baseUnits)) {
    return fail({ code: "NOT_AN_INTEGER", value: numberOrNaN(baseUnits) });
  }
  const minorUnits = baseUnits * QUANTITY_SCALE;
  if (!isSafeInt(minorUnits)) {
    return fail({ code: "NOT_AN_INTEGER", value: minorUnits });
  }
  return makeQuantity(minorUnits, uom);
}

export const zeroQuantity = (uom: UomCode): Result<Quantity, QuantityError> =>
  makeQuantity(0, uom);

export function parseDecimalQuantity(
  raw: string,
  uom: UomCode,
): Result<Quantity, QuantityError> {
  if (!isString(raw)) {
    return fail({ code: "MALFORMED_DECIMAL", raw: describe(raw) });
  }
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
  if (!isSafeInt(magnitude)) {
    return fail({
      code: "OUT_OF_RANGE",
      value: magnitude,
      limit: MAX_QUANTITY_MINOR_UNITS,
    });
  }
  return makeQuantity(sign === "-" ? -magnitude : magnitude, uom);
}

export function addQuantities(
  left: Quantity,
  right: Quantity,
): Result<Quantity, QuantityError> {
  const operands = validatePair(left, right);
  if (!operands.ok) return operands;
  const [first, second] = operands.value;
  return makeQuantity(first.minorUnits + second.minorUnits, first.uom);
}

export function subtractQuantities(
  left: Quantity,
  right: Quantity,
): Result<Quantity, QuantityError> {
  const operands = validatePair(left, right);
  if (!operands.ok) return operands;
  const [first, second] = operands.value;
  return makeQuantity(first.minorUnits - second.minorUnits, first.uom);
}

export const negateQuantity = (
  quantity: Quantity,
): Result<Quantity, QuantityError> => {
  const validated = validateQuantity(quantity);
  return validated.ok
    ? makeQuantity(-validated.value.minorUnits, validated.value.uom)
    : validated;
};

export const absoluteQuantity = (
  quantity: Quantity,
): Result<Quantity, QuantityError> => {
  const validated = validateQuantity(quantity);
  return validated.ok
    ? makeQuantity(Math.abs(validated.value.minorUnits), validated.value.uom)
    : validated;
};

export function compareQuantities(
  left: Quantity,
  right: Quantity,
): Result<number, QuantityError> {
  const operands = validatePair(left, right);
  if (!operands.ok) return operands;
  const [first, second] = operands.value;
  if (first.minorUnits === second.minorUnits) return ok(0);
  return ok(first.minorUnits < second.minorUnits ? -1 : 1);
}

export function sumQuantities(
  quantities: readonly Quantity[],
  uom: UomCode,
): Result<Quantity, QuantityError> {
  if (!isArray(quantities)) {
    return fail({ code: "NOT_A_QUANTITY", received: describe(quantities) });
  }
  let total = zeroQuantity(uom);
  for (const quantity of quantities) {
    if (!total.ok) return total;
    total = addQuantities(total.value, quantity);
  }
  return total;
}

export const isZeroQuantity = (quantity: Quantity): boolean =>
  isRecord(quantity) && quantity.minorUnits === 0;

export const requireNonZeroQuantity = (
  quantity: Quantity,
): Result<Quantity, QuantityError> => {
  const validated = validateQuantity(quantity);
  if (!validated.ok) return validated;
  return validated.value.minorUnits === 0
    ? fail({ code: "ZERO_NOT_ALLOWED", uom: validated.value.uom })
    : validated;
};

export interface QuantityFormatOptions {
  readonly trimTrailingZeros?: boolean;
}

export function formatQuantity(
  quantity: Quantity,
  options: QuantityFormatOptions = {},
): Result<string, QuantityError> {
  if (!isRecord(options) || isArray(options)) {
    return fail({
      code: "INVALID_FORMAT_OPTIONS",
      field: "options",
      received: describe(options),
    });
  }
  if (
    options.trimTrailingZeros !== undefined &&
    !isBoolean(options.trimTrailingZeros)
  ) {
    return fail({
      code: "INVALID_FORMAT_OPTIONS",
      field: "trimTrailingZeros",
      received: describe(options.trimTrailingZeros),
    });
  }
  const validated = validateQuantity(quantity);
  if (!validated.ok) return validated;
  const { minorUnits } = validated.value;
  const sign = minorUnits < 0 ? "-" : "";
  const magnitude = Math.abs(minorUnits);
  const whole = Math.floor(magnitude / QUANTITY_SCALE);
  const fraction = String(magnitude % QUANTITY_SCALE).padStart(
    QUANTITY_DECIMALS,
    "0",
  );
  const trimmed =
    options.trimTrailingZeros === true ? fraction.replace(/0+$/, "") : fraction;
  return ok(trimmed === "" ? `${sign}${whole}` : `${sign}${whole}.${trimmed}`);
}

function validatePair(
  left: Quantity,
  right: Quantity,
): Result<readonly [Quantity, Quantity], QuantityError> {
  const validatedLeft = validateQuantity(left);
  if (!validatedLeft.ok) return validatedLeft;
  const validatedRight = validateQuantity(right);
  if (!validatedRight.ok) return validatedRight;
  if (validatedLeft.value.uom !== validatedRight.value.uom) {
    return fail({
      code: "UOM_MISMATCH",
      left: validatedLeft.value.uom,
      right: validatedRight.value.uom,
    });
  }
  return ok([validatedLeft.value, validatedRight.value] as const);
}

const numberOrNaN = (value: unknown): number =>
  typeof value === "number" ? value : Number.NaN;

const describe = (value: unknown): string =>
  value === null ? "null" : typeof value;
