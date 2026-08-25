import type { Result } from "../../convex/model/result";

export function expectOk<T, E>(result: Result<T, E>): T {
  if (!result.ok) {
    throw new Error(
      `expected a successful result, got error ${JSON.stringify(result.error)}`,
    );
  }
  return result.value;
}

export function expectError<T, E>(result: Result<T, E>): E {
  if (result.ok) {
    throw new Error(
      `expected a failed result, got value ${JSON.stringify(result.value)}`,
    );
  }
  return result.error;
}
