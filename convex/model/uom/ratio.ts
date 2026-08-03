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
 * **Every public function re-validates its operands, and every one of them
 * returns a `Result`.** `Ratio` is an interface, so `{ numerator: 1, denominator:
 * 0 } as Ratio` compiles, and a factor read back from a document is exactly that
 * kind of value. A forged operand must therefore fail as a named error rather
 * than divide by zero, invert a sign, silently scale stock to nothing, or —
 * because Euclid's algorithm does not terminate on a non-finite input — hang the
 * process. That is why `compareRatios`, `ratiosEqual`, `formatRatio`, and
 * `scaleInteger` answer a `Result` instead of a bare value, and why
 * `greatestCommonDivisor` is private: it is only ever called on operands this
 * module has already checked.
 *
 * BigInt is not used: a BigInt cannot be stored in a Convex document, and a type
 * that has to be converted at the boundary would put the rounding decision back
 * where we removed it.
 *
 * Pure module (plan §6.2): no Convex imports.
 */
import { isRecord, isSafeInt } from "../guards";
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

/**
 * Builds a reduced ratio. Rejects zero and negative components: a UOM factor of
 * zero would make stock vanish, and a negative one would invert a posting's
 * sign, so both fail closed rather than being normalized.
 */
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

/**
 * Re-checks a value that claims to be a `Ratio` and answers its reduced form.
 *
 * This is the gate every other function here goes through, and the reason a
 * forged literal cannot reach the arithmetic: a missing field, a string, a `NaN`,
 * a zero or negative component, an out-of-range component, and a non-object are
 * each a named error.
 */
export function validateRatio(ratio: Ratio): Result<Ratio, RatioError> {
  if (!isRecord(ratio)) {
    return fail({ code: "NOT_A_FRACTION", received: describe(ratio) });
  }
  return makeRatio(ratio.numerator, ratio.denominator);
}

/**
 * Builds a signed exact fraction: the value a non-integer conversion reports.
 * The numerator may be any safe integer including zero and negatives; the
 * denominator is a positive integer within `MAX_RATIO_COMPONENT`, because it can
 * only ever be a divisor of a validated ratio's denominator.
 *
 * The pair is reduced, because the type says it is and two callers depend on it:
 * an `INEXACT` conversion outcome is rendered by its components and compared by
 * them, so `2/4` and `1/2` would be two different explanations of one value.
 * Reduction only shrinks a magnitude, so a component that was in range stays in
 * range and a safe integer stays safe. Zero has one form, `0/1` — including `-0`,
 * which is a distinct double that survives JSON and that `Object.is` separates
 * from `0`, so two zero remainders would otherwise fail to compare equal.
 */
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
  // `greatestCommonDivisor` works on magnitudes and both operands are safe
  // integers by the checks above, so the divisor is at least 1 and the sign stays
  // on the numerator.
  const divisor = greatestCommonDivisor(numerator, denominator);
  return ok(
    Object.freeze({
      numerator: numerator / divisor,
      denominator: denominator / divisor,
    }),
  );
}

/**
 * Re-checks a value that claims to be an `ExactFraction` and answers its reduced
 * form. An unreduced literal compiles, and is exactly what a document read back
 * or a `JSON.parse` produces.
 */
export function validateExactFraction(
  fraction: ExactFraction,
): Result<ExactFraction, RatioError> {
  if (!isRecord(fraction)) {
    return fail({ code: "NOT_A_FRACTION", received: describe(fraction) });
  }
  return makeExactFraction(fraction.numerator, fraction.denominator);
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

/** Swaps numerator and denominator: base-to-alternate from alternate-to-base. */
export function invertRatio(ratio: Ratio): Result<Ratio, RatioError> {
  const validated = validateRatio(ratio);
  if (!validated.ok) return validated;
  return makeRatio(validated.value.denominator, validated.value.numerator);
}

/**
 * -1, 0, or 1 by exact cross-multiplication; both products stay bounded because
 * both operands were validated first. Two equal values compare 0 even when one
 * of them arrived unreduced.
 */
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

/**
 * Whether two factors denote the same value. Compares the *reduced* components,
 * so an unreduced forgery (`2/4`) is equal to `1/2` rather than quietly
 * different, and an invalid operand is an error rather than `false`.
 */
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

/**
 * `numerator/denominator`, for logs and error rendering. Never parsed back.
 *
 * Validates first, so what is rendered is the reduced form: printing `2/4` for a
 * value the type promises is `1/2`, or `1/0` or `NaN/NaN` at all, would present a
 * forged value to an operator as a fact.
 */
export function formatRatio(
  value: Ratio | ExactFraction,
): Result<string, RatioError> {
  const validated = validateExactFraction(value);
  if (!validated.ok) return validated;
  return ok(`${validated.value.numerator}/${validated.value.denominator}`);
}

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
 *
 * The ratio is validated before any of that. An unvalidated operand is not a
 * theoretical concern here: `denominator: 0` would report an exact fraction over
 * zero, `numerator: 0` would report that the stock scaled to nothing,
 * `denominator: -1` would flip a sign, and a non-finite component would put the
 * gcd loop in a state it never leaves. All four are `Result` failures.
 */
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

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Euclid's algorithm on magnitudes. `gcd(0, n) === n` and `gcd(0, 0) === 0`.
 *
 * Private, and it has to be: the loop's exit condition is `b !== 0`, and a `NaN`
 * or `Infinity` operand makes every subsequent remainder `NaN`, which is never
 * `0`. A public gcd would be a hang reachable from any caller holding a forged
 * ratio. Every call site below passes operands that `isSafeInt` has already
 * accepted.
 */
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

/** A number for an error field, so a forged operand still reports something. */
const numberOrNaN = (value: unknown): number =>
  typeof value === "number" ? value : Number.NaN;

/** The shape of a value that is not a fraction at all, for the error field. */
const describe = (value: unknown): string =>
  value === null ? "null" : typeof value;
