/**
 * Exact rational arithmetic for UOM conversion (`G-039`, `INV-0004-03`).
 *
 * Status: **implemented.** No schema stores a ratio and no Convex function
 * consumes one yet.
 *
 * A conversion factor is a reduced fraction of positive integers, never a
 * float. `1 CASE = 12 PCS` is `12/1`; `1 PCS = 1/3 M` is `1/3`, which no binary
 * float can hold. Every operation here either produces an exact integer result
 * or reports that it cannot: nothing rounds (`INV-0004-05`).
 *
 * Overflow is a first-class outcome rather than a silent wrap. JavaScript
 * numbers hold integers exactly only up to 2^53-1, and a product past that
 * limit is a different number that still looks like an integer. Every
 * multiplication below is therefore checked with `Number.isSafeInteger` *after*
 * the multiply — a product above 2^53-1 rounds to a double that is not a safe
 * integer, so the check catches it — and components are additionally bounded by
 * `MAX_RATIO_COMPONENT` so ordinary arithmetic stays far from the limit.
 *
 * BigInt is not used: a BigInt cannot be stored in a Convex document, and a type
 * that has to be converted at the boundary would put the rounding decision back
 * where we removed it.
 *
 * Pure module (plan §6.2): no Convex imports.
 */
import { fail, ok, type Result } from "../result";

/**
 * The largest numerator or denominator a conversion may declare. A pack factor
 * of a million is already implausible, and the bound keeps every intermediate
 * product in `composeRatios` (at most 10^12) exactly representable.
 */
export const MAX_RATIO_COMPONENT = 1_000_000;

/**
 * A positive, reduced conversion factor: `numerator / denominator`. Only
 * `makeRatio` produces one, and every consumer re-validates, so a hand-built
 * object literal cannot smuggle a zero denominator past a check.
 */
export interface Ratio {
  readonly numerator: number;
  readonly denominator: number;
}

/**
 * A signed exact value that is *not* necessarily an integer: the honest answer
 * when a conversion does not land on a whole minor unit. The numerator carries
 * the sign, the denominator is positive, and the pair is reduced. It exists so a
 * rejected conversion can explain itself ("3 CASE is 1.5 KG, and KG is stored in
 * thousandths of 1") instead of being rounded into the ledger.
 */
export interface ExactFraction {
  readonly numerator: number;
  readonly denominator: number;
}

export type RatioError =
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

/**
 * Builds a reduced ratio. Rejects zero and negative components: a UOM factor of
 * zero would make stock vanish, and a negative one would invert a posting's
 * sign, so both fail closed rather than being normalized.
 */
export function makeRatio(
  numerator: number,
  denominator: number,
): Result<Ratio, RatioError> {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    return fail({ code: "NOT_AN_INTEGER", numerator, denominator });
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

/** The identity factor. `1 X = 1 X`. */
export const UNIT_RATIO: Ratio = Object.freeze({
  numerator: 1,
  denominator: 1,
});

/**
 * Multiplies two factors exactly. Cross-reduces before multiplying, so
 * `(1000/3) × (3/1000)` is `1/1` rather than an overflow, and rejects the result
 * if either component leaves the declared range.
 */
export function composeRatios(
  left: Ratio,
  right: Ratio,
): Result<Ratio, RatioError> {
  const validated = validatePair(left, right);
  if (!validated.ok) return validated;

  const leftDivisor = greatestCommonDivisor(left.numerator, right.denominator);
  const rightDivisor = greatestCommonDivisor(right.numerator, left.denominator);
  const numerator =
    (left.numerator / leftDivisor) * (right.numerator / rightDivisor);
  const denominator =
    (left.denominator / rightDivisor) * (right.denominator / leftDivisor);
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    return fail({ code: "OVERFLOW", left, right });
  }
  return makeRatio(numerator, denominator);
}

/** Swaps numerator and denominator: base-to-alternate from alternate-to-base. */
export function invertRatio(ratio: Ratio): Result<Ratio, RatioError> {
  return makeRatio(ratio.denominator, ratio.numerator);
}

/** -1, 0, or 1 by exact cross-multiplication; both products stay bounded. */
export function compareRatios(left: Ratio, right: Ratio): number {
  const leftProduct = left.numerator * right.denominator;
  const rightProduct = right.numerator * left.denominator;
  if (leftProduct === rightProduct) return 0;
  return leftProduct < rightProduct ? -1 : 1;
}

/** Reduced ratios are equal exactly when their components are. */
export const ratiosEqual = (left: Ratio, right: Ratio): boolean =>
  left.numerator === right.numerator && left.denominator === right.denominator;

/** `numerator/denominator`, for logs and error rendering. Never parsed back. */
export const formatRatio = (ratio: Ratio | ExactFraction): string =>
  `${ratio.numerator}/${ratio.denominator}`;

/**
 * The outcome of scaling an integer by a ratio. `EXACT` is the only outcome a
 * ledger posting may use; `INEXACT` hands back the true value as a fraction so
 * the caller can explain the rejection; `OVERFLOW` means the exact product
 * cannot be represented and is never approximated.
 */
export type ScaledInteger =
  | { readonly kind: "EXACT"; readonly value: number }
  | { readonly kind: "INEXACT"; readonly exact: ExactFraction }
  | { readonly kind: "OVERFLOW" };

/**
 * Multiplies a signed integer by a ratio, exactly.
 *
 * The value is reduced against the denominator first, so exactness is decided
 * before any multiplication: with a reduced ratio, `denominator | value × n`
 * holds if and only if `denominator | value`. That also keeps the product as
 * small as the arithmetic allows, which is what makes overflow rare rather than
 * routine.
 */
export function scaleInteger(value: number, ratio: Ratio): ScaledInteger {
  if (!Number.isSafeInteger(value)) return { kind: "OVERFLOW" };
  const sign = value < 0 ? -1 : 1;
  const magnitude = Math.abs(value);

  const divisor = greatestCommonDivisor(magnitude, ratio.denominator);
  const reducedValue = magnitude / divisor;
  const reducedDenominator = ratio.denominator / divisor;
  const product = reducedValue * ratio.numerator;
  if (!Number.isSafeInteger(product)) return { kind: "OVERFLOW" };

  if (reducedDenominator === 1) {
    return { kind: "EXACT", value: sign * product };
  }
  return {
    kind: "INEXACT",
    exact: Object.freeze({
      numerator: sign * product,
      denominator: reducedDenominator,
    }),
  };
}

/**
 * Euclid's algorithm on magnitudes. `gcd(0, n) === n` and `gcd(0, 0) === 0`,
 * which is why every caller either passes a positive denominator or handles the
 * zero case first.
 */
export function greatestCommonDivisor(left: number, right: number): number {
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
function validatePair(left: Ratio, right: Ratio): Result<true, RatioError> {
  for (const ratio of [left, right]) {
    const revalidated = makeRatio(ratio.numerator, ratio.denominator);
    if (!revalidated.ok) return revalidated;
  }
  return ok(true);
}
