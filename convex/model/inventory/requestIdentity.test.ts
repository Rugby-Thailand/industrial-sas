/**
 * Unit tier — UUIDv7 request identity, the request namespace, and the canonical
 * argument form.
 *
 * The canonicalizer's contract is the one worth reading carefully: a retry must hash
 * equal and a *changed* request must not, so the accepted value set is narrow and
 * every rejection is by name.
 */
import { describe, expect, it } from "vitest";

import {
  LEDGER_OPERATIONS,
  MAX_CANONICAL_DEPTH,
  REQUEST_NAMESPACE_PREFIX,
  canonicalArgumentText,
  encodeRequestNamespace,
  requestIdTimestamp,
  validateOperation,
  validateRequestId,
} from "./requestIdentity";

const V7 = "0192f0a0-1111-7abc-8def-0123456789ab";

const text = (value: unknown): string => {
  const rendered = canonicalArgumentText(value);
  if (!rendered.ok)
    throw new Error(`expected a rendering: ${rendered.error.code}`);
  return rendered.value;
};

describe("UUIDv7 validation", () => {
  it("accepts a canonical v7 and folds case", () => {
    expect(validateRequestId(V7)).toEqual({ ok: true, value: V7 });
    expect(validateRequestId(V7.toUpperCase())).toEqual({
      ok: true,
      value: V7,
    });
  });

  it("refuses a v4, a nil UUID, and a bad variant", () => {
    const v4 = "0192f0a0-1111-4abc-8def-0123456789ab";
    const version = validateRequestId(v4);
    expect(version.ok).toBe(false);
    if (!version.ok) {
      expect(version.error.code).toBe("REQUEST_ID_WRONG_VERSION");
      expect(version.error).toMatchObject({ version: "4", expected: "7" });
    }

    const nil = validateRequestId("00000000-0000-0000-0000-000000000000");
    expect(nil.ok).toBe(false);
    if (!nil.ok) expect(nil.error.code).toBe("REQUEST_ID_WRONG_VERSION");

    for (const nibble of ["0", "7", "c", "f"]) {
      const forged = `0192f0a0-1111-7abc-${nibble}def-0123456789ab`;
      const variant = validateRequestId(forged);
      expect(variant.ok, forged).toBe(false);
      if (!variant.ok) {
        expect(variant.error.code).toBe("REQUEST_ID_WRONG_VARIANT");
      }
    }
    for (const nibble of ["8", "9", "a", "b"]) {
      const accepted = `0192f0a0-1111-7abc-${nibble}def-0123456789ab`;
      expect(validateRequestId(accepted).ok, accepted).toBe(true);
    }
  });

  it("refuses anything that is not a canonical UUID string", () => {
    for (const forged of [
      "",
      "0192f0a0111 17abc8def0123456789ab",
      "0192f0a0-1111-7abc-8def-0123456789a",
      "0192f0a0-1111-7abc-8def-0123456789abc",
      "0192f0a0_1111_7abc_8def_0123456789ab",
      "zzzzzzzz-1111-7abc-8def-0123456789ab",
      ` ${V7}`,
      `${V7} `,
    ]) {
      const refused = validateRequestId(forged);
      expect(refused.ok, JSON.stringify(forged)).toBe(false);
      if (!refused.ok) {
        expect(refused.error.code).toBe("REQUEST_ID_MALFORMED");
      }
    }
    for (const forged of [null, undefined, 7, {}, []]) {
      const refused = validateRequestId(forged as never);
      expect(refused.ok).toBe(false);
      if (!refused.ok) {
        expect(refused.error.code).toBe("REQUEST_ID_NOT_A_STRING");
      }
    }
  });

  it("reads the millisecond timestamp out of the leading 48 bits", () => {
    const timestamp = requestIdTimestamp(V7);
    expect(timestamp.ok).toBe(true);
    if (!timestamp.ok) return;
    expect(timestamp.value).toBe(Number.parseInt("0192f0a01111", 16));
    expect(Number.isSafeInteger(timestamp.value)).toBe(true);
  });

  it("has no timestamp for an invalid request ID, rather than zero", () => {
    const refused = requestIdTimestamp("nope");
    expect(refused.ok).toBe(false);
  });
});

describe("operation names", () => {
  it("accepts the ledger's own operations", () => {
    expect(validateOperation(LEDGER_OPERATIONS.post).ok).toBe(true);
    expect(validateOperation(LEDGER_OPERATIONS.reverse).ok).toBe(true);
    expect(LEDGER_OPERATIONS.post).toBe("inventory.transaction.post");
    expect(LEDGER_OPERATIONS.reverse).toBe("inventory.transaction.reverse");
  });

  it("refuses a single segment, upper case, and an over-long label", () => {
    for (const forged of [
      "post",
      "Inventory.post",
      "inventory..post",
      "inventory.transaction.",
      "a.b.c.d.e.f",
      "",
      "x".repeat(400),
    ]) {
      expect(validateOperation(forged).ok, forged).toBe(false);
    }
  });
});

describe("request namespace", () => {
  it("encodes the triple with its own prefix", () => {
    const encoded = encodeRequestNamespace({
      orgId: "org1",
      operation: LEDGER_OPERATIONS.post,
      requestId: V7,
    });
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    expect(encoded.value.startsWith(REQUEST_NAMESPACE_PREFIX)).toBe(true);
  });

  it("does not alias across the boundary between organization and operation", () => {
    const left = encodeRequestNamespace({
      orgId: "org",
      operation: "inventory.transaction.post",
      requestId: V7,
    });
    const right = encodeRequestNamespace({
      orgId: "orginventory",
      operation: "transaction.post",
      requestId: V7,
    });
    expect(left.ok && right.ok).toBe(true);
    if (!left.ok || !right.ok) return;
    expect(left.value).not.toBe(right.value);
  });

  it("refuses a forged organization, operation, or request ID", () => {
    expect(
      encodeRequestNamespace({
        orgId: "",
        operation: LEDGER_OPERATIONS.post,
        requestId: V7,
      }).ok,
    ).toBe(false);
    expect(
      encodeRequestNamespace({
        orgId: "org|1",
        operation: LEDGER_OPERATIONS.post,
        requestId: V7,
      }).ok,
    ).toBe(false);
    expect(
      encodeRequestNamespace({
        orgId: "org1",
        operation: "post",
        requestId: V7,
      }).ok,
    ).toBe(false);
    expect(
      encodeRequestNamespace({
        orgId: "org1",
        operation: LEDGER_OPERATIONS.post,
        requestId: "nope",
      }).ok,
    ).toBe(false);
  });
});

describe("canonical argument form", () => {
  it("is stable under object key order", () => {
    expect(text({ a: 1, b: 2 })).toBe(text({ b: 2, a: 1 }));
  });

  it("distinguishes an absent field from a present one", () => {
    expect(text({ a: 1 })).not.toBe(text({ a: 1, b: 2 }));
    // An `undefined` property is a Convex optional argument that was not sent.
    expect(text({ a: 1, b: undefined })).toBe(text({ a: 1 }));
  });

  it("does not alias values a naive join would collide", () => {
    expect(text(["ab", "c"])).not.toBe(text(["a", "bc"]));
    expect(text({ ab: 1, c: 2 })).not.toBe(text({ a: 1, bc: 2 }));
    expect(text("1")).not.toBe(text(1));
    expect(text(true)).not.toBe(text("true"));
    expect(text(null)).not.toBe(text("null"));
    expect(text([])).not.toBe(text({}));
  });

  it("normalizes negative zero, so two zero quantities hash alike", () => {
    expect(text({ minorUnits: -0 })).toBe(text({ minorUnits: 0 }));
  });

  it("refuses a value it cannot render, by name", () => {
    for (const forged of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      undefined,
      () => 1,
      Symbol("x"),
      new Date(0),
      new Map(),
      new Set(),
      10n,
    ]) {
      const refused = canonicalArgumentText(forged);
      expect(refused.ok, String(forged?.toString?.() ?? forged)).toBe(false);
      if (!refused.ok) {
        expect(refused.error.code).toBe("ARGUMENT_NOT_CANONICALIZABLE");
      }
    }
  });

  it("names the path of the value it refused", () => {
    const refused = canonicalArgumentText({
      lines: [{ quantity: Number.NaN }],
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error).toMatchObject({ path: "$.lines[0].quantity" });
    }
  });

  it("bounds depth instead of recursing on a cycle", () => {
    let nested: Record<string, unknown> = { leaf: 1 };
    for (let depth = 0; depth <= MAX_CANONICAL_DEPTH + 1; depth += 1) {
      nested = { nested };
    }
    const refused = canonicalArgumentText(nested);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("ARGUMENT_TOO_DEEP");
      expect(refused.error).toMatchObject({ limit: MAX_CANONICAL_DEPTH });
    }

    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    const cycle = canonicalArgumentText(cyclic);
    expect(cycle.ok).toBe(false);
    if (!cycle.ok) expect(cycle.error.code).toBe("ARGUMENT_TOO_DEEP");
  });

  it("renders a sparse array's holes as null, matching what Convex can hold", () => {
    const sparse = [1, , 3] as unknown[];
    expect(text(sparse)).toBe(text([1, null, 3]));
  });

  it("refuses a class instance, whose fields are not its identity", () => {
    class Thing {
      readonly a = 1;
    }
    expect(canonicalArgumentText(new Thing()).ok).toBe(false);
    expect(canonicalArgumentText(Object.create(null) as object).ok).toBe(true);
  });
});
