/**
 * Test helpers for the pure domain modules under `convex/model/**`.
 *
 * Every domain function returns a `Result` rather than throwing, which is right
 * for production and verbose in a test that only cares about the happy path.
 * These two helpers unwrap a result and fail the test with the actual error when
 * the expectation was wrong, so a broken assertion reports the domain error code
 * instead of `undefined is not an object`.
 *
 * They are the only sanctioned way for a test to reach inside a `Result`:
 * `result.value!` would compile and hide a failed precondition.
 */
import type { Result } from "../../convex/model/result";

/** The value of a successful result, or a thrown assertion carrying the error. */
export function expectOk<T, E>(result: Result<T, E>): T {
  if (!result.ok) {
    throw new Error(
      `expected a successful result, got error ${JSON.stringify(result.error)}`,
    );
  }
  return result.value;
}

/** The error of a failed result, or a thrown assertion carrying the value. */
export function expectError<T, E>(result: Result<T, E>): E {
  if (result.ok) {
    throw new Error(
      `expected a failed result, got value ${JSON.stringify(result.value)}`,
    );
  }
  return result.error;
}
