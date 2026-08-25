import { isRecord, isSafeInt } from "../guards";
import { fail, ok, type Result } from "../result";

export const MAX_RATIO_COMPONENT = 1_000_000;

export interface Ratio {
  readonly numerator: number;
  readonly denominator: number;
}

export interface ExactFraction {
  readonly numerator: number;
  readonly denominator: number;
}

export type RatioError =
  | { readonly code: "NOT_A_FRACTION"; readonly received: string }
  | {
      readonly code: "NOT_AN_INTEGER";
      readonly numerator: number;
      readonly denominator: number;
    }
  | {
      readonly code: "NOT_POSITIVE";
      readonly numerator: number;
      readonly denominator: number;
    }
  | {
      readonly code: "COMPONENT_OUT_OF_RANGE";
      readonly numerator: number;
      readonly denominator: number;
      readonly limit: number;
    }
  | { readonly code: "OVERFLOW"; readonly left: Ratio; readonly right: Ratio };

export function makeRatio(
  numerator: number,
  denominator: number,
): Result<Ratio, RatioError> {
  if (!isSafeInt(numerator) || !isSafeInt(denominator)) {
    return fail({
      code: "NOT_AN_INTEGER",
      numerator: numberOrNaN(numerator),
      denominator: numberOrNaN(denominator),
    });
  }
  if (numerator <= 0 || denominator <= 0) {
    return fail({ code: "NOT_POSITIVE", numerator, denominator });
  }
  if (numerator > MAX_RATIO_COMPONENT || denominator > MAX_RATIO_COMPONENT) {
    return fail({
      code: "COMPONENT_OUT_OF_RANGE",
      numerator,
      denominator,
      limit: MAX_RATIO_COMPONENT,
    });
  }
  const divisor = greatestCommonDivisor(numerator, denominator);
  return ok(
    Object.freeze({
      numerator: numerator / divisor,
      denominator: denominator / divisor,
    }),
  );
}

export function validateRatio(ratio: Ratio): Result<Ratio, RatioError> {
  if (!isRecord(ratio)) {
    return fail({ code: "NOT_A_FRACTION", received: describe(ratio) });
  }
  return makeRatio(ratio.numerator, ratio.denominator);
}

export function makeExactFraction(
  numerator: number,
  denominator: number,
): Result<ExactFraction, RatioError> {
  if (!isSafeInt(numerator) || !isSafeInt(denominator)) {
    return fail({
      code: "NOT_AN_INTEGER",
      numerator: numberOrNaN(numerator),
      denominator: numberOrNaN(denominator),
    });
  }
  if (denominator <= 0) {
    return fail({ code: "NOT_POSITIVE", numerator, denominator });
  }
  if (denominator > MAX_RATIO_COMPONENT) {
    return fail({
      code: "COMPONENT_OUT_OF_RANGE",
      numerator,
      denominator,
      limit: MAX_RATIO_COMPONENT,
    });
  }
  if (numerator === 0) {
    return ok(Object.freeze({ numerator: 0, denominator: 1 }));
  }

  const divisor = greatestCommonDivisor(numerator, denominator);
  return ok(
    Object.freeze({
      numerator: numerator / divisor,
      denominator: denominator / divisor,
    }),
  );
}

export function validateExactFraction(
  fraction: ExactFraction,
): Result<ExactFraction, RatioError> {
  if (!isRecord(fraction)) {
    return fail({ code: "NOT_A_FRACTION", received: describe(fraction) });
  }
  return makeExactFraction(fraction.numerator, fraction.denominator);
}

export const UNIT_RATIO: Ratio = Object.freeze({
  numerator: 1,
  denominator: 1,
});

export function composeRatios(
  left: Ratio,
  right: Ratio,
): Result<Ratio, RatioError> {
  const operands = validatePair(left, right);
  if (!operands.ok) return operands;
  const [first, second] = operands.value;

  const leftDivisor = greatestCommonDivisor(
    first.numerator,
    second.denominator,
  );
  const rightDivisor = greatestCommonDivisor(
    second.numerator,
    first.denominator,
  );
  const numerator =
    (first.numerator / leftDivisor) * (second.numerator / rightDivisor);
  const denominator =
    (first.denominator / rightDivisor) * (second.denominator / leftDivisor);
  if (!isSafeInt(numerator) || !isSafeInt(denominator)) {
    return fail({ code: "OVERFLOW", left: first, right: second });
  }
  return makeRatio(numerator, denominator);
}

export function invertRatio(ratio: Ratio): Result<Ratio, RatioError> {
  const validated = validateRatio(ratio);
  if (!validated.ok) return validated;
  return makeRatio(validated.value.denominator, validated.value.numerator);
}

export function compareRatios(
  left: Ratio,
  right: Ratio,
): Result<number, RatioError> {
  const operands = validatePair(left, right);
  if (!operands.ok) return operands;
  const [first, second] = operands.value;
  const leftProduct = first.numerator * second.denominator;
  const rightProduct = second.numerator * first.denominator;
  if (leftProduct === rightProduct) return ok(0);
  return ok(leftProduct < rightProduct ? -1 : 1);
}

export function ratiosEqual(
  left: Ratio,
  right: Ratio,
): Result<boolean, RatioError> {
  const operands = validatePair(left, right);
  if (!operands.ok) return operands;
  const [first, second] = operands.value;
  return ok(
    first.numerator === second.numerator &&
      first.denominator === second.denominator,
  );
}

export function formatRatio(
  value: Ratio | ExactFraction,
): Result<string, RatioError> {
  const validated = validateExactFraction(value);
  if (!validated.ok) return validated;
  return ok(`${validated.value.numerator}/${validated.value.denominator}`);
}

export type ScaledInteger =
  | { readonly kind: "EXACT"; readonly value: number }
  | { readonly kind: "INEXACT"; readonly exact: ExactFraction }
  | { readonly kind: "OVERFLOW" };

export function scaleInteger(
  value: number,
  ratio: Ratio,
): Result<ScaledInteger, RatioError> {
  const validated = validateRatio(ratio);
  if (!validated.ok) return validated;
  const factor = validated.value;

  if (!isSafeInt(value)) return ok({ kind: "OVERFLOW" });
  const sign = value < 0 ? -1 : 1;
  const magnitude = Math.abs(value);

  const divisor = greatestCommonDivisor(magnitude, factor.denominator);
  const reducedValue = magnitude / divisor;
  const reducedDenominator = factor.denominator / divisor;
  const product = reducedValue * factor.numerator;
  if (!isSafeInt(product)) return ok({ kind: "OVERFLOW" });

  if (reducedDenominator === 1) {
    return ok({
      kind: "EXACT",
      value: sign * product === 0 ? 0 : sign * product,
    });
  }
  const exact = makeExactFraction(sign * product, reducedDenominator);
  if (!exact.ok) return exact;
  return ok({ kind: "INEXACT", exact: exact.value });
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

/** Re-validates both operands: a forged literal must not reach the arithmetic. */
function validatePair(
  left: Ratio,
  right: Ratio,
): Result<readonly [Ratio, Ratio], RatioError> {
  const first = validateRatio(left);
  if (!first.ok) return first;
  const second = validateRatio(right);
  if (!second.ok) return second;
  return ok([first.value, second.value] as const);
}

const numberOrNaN = (value: unknown): number =>
  typeof value === "number" ? value : Number.NaN;

const describe = (value: unknown): string =>
  value === null ? "null" : typeof value;
