/**
 * The result type every pure domain module returns.
 *
 * Status: **implemented.** Used by every module under `convex/model/**`.
 *
 * Why a result and not an exception: invalid input is normal here. An operator
 * mistypes a quantity, a supplier label is malformed, a scanner emits a partial
 * string. Those are outcomes the caller must render in Thai or English, not
 * defects, and `throw` makes them invisible to the type checker — a caller that
 * forgets to handle one still compiles. Exceptions stay for programmer error
 * (a violated internal invariant), which is why no module below throws.
 *
 * Errors carry a `code` and structured fields, never a prose message: the UI
 * owns translation (D-06), so a message baked in here would be untranslatable
 * and would encourage string matching.
 *
 * Domain modules under `convex/model/**` are pure TypeScript with no Convex
 * imports (plan §6.2). This file must never import anything.
 */

/** Either a value or a named domain error. Never both, never neither. */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/**
 * A successful result. Assignable to `Result<T, E>` for any `E`.
 *
 * The wrapper is frozen, so `(result as { ok: boolean }).ok = false` throws in
 * strict mode and is a no-op otherwise instead of turning a success into a
 * failure. Freezing is **shallow**: the wrapper cannot be rewritten, and the
 * value inside it is immutable only where whatever constructed it froze its own
 * output too — which every domain value constructor under `convex/model/**` does,
 * and which the `ScaledInteger` and `UomConversionOutcome` envelopes deliberately
 * do not. `readonly` alone is a compile-time claim that a cast erases
 * (`ReadonlyMap` is an ordinary `Map` at run time), which is why this file freezes
 * rather than relying on the type.
 */
export const ok = <T>(value: T): Result<T, never> =>
  Object.freeze({ ok: true as const, value });

/**
 * A failed result. Assignable to `Result<T, E>` for any `T`. The wrapper is
 * frozen as above; the structured error it carries is a plain object.
 */
export const fail = <E>(error: E): Result<never, E> =>
  Object.freeze({ ok: false as const, error });
