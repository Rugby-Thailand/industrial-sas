/**
 * Unit tier — the result wrapper.
 *
 * There is almost nothing to test here except the one claim the type cannot make:
 * that a result is immutable at run time. `readonly ok: true` is erased, so
 * without the freeze `(result as { ok: boolean }).ok = false` turns a success into
 * something every caller reads as a failure — with a `value` still attached.
 */
import { describe, expect, it } from "vitest";

import { fail, ok, type Result } from "./result";

describe("ok and fail", () => {
  it("carry exactly one of a value and an error", () => {
    expect(ok(7)).toEqual({ ok: true, value: 7 });
    expect(fail({ code: "NOPE" })).toEqual({
      ok: false,
      error: { code: "NOPE" },
    });
  });

  it("freezes the wrapper so a cast cannot flip the verdict", () => {
    const success: Result<number, never> = ok(7);
    expect(Object.isFrozen(success)).toBe(true);
    expect(() => {
      (success as { ok: boolean }).ok = false;
    }).toThrow(TypeError);
    expect(success.ok).toBe(true);

    const failure: Result<string, string> = fail("BROKEN");
    expect(Object.isFrozen(failure)).toBe(true);
    expect(() => {
      (failure as { error: string }).error = "FINE";
    }).toThrow(TypeError);
    expect(failure.ok).toBe(false);
    if (failure.ok) return;
    expect(failure.error).toBe("BROKEN");
  });

  it("is shallow: the value is immutable only if its constructor froze it", () => {
    // Stated rather than hidden. Every constructor under `convex/model/**` freezes
    // what it returns, which is what makes the guarantee hold end to end.
    const wrapped: Result<{ mutable: number }, never> = ok({ mutable: 1 });
    expect(Object.isFrozen(wrapped)).toBe(true);
    if (!wrapped.ok) return;
    wrapped.value.mutable = 2;
    expect(wrapped.value.mutable).toBe(2);
  });
});
