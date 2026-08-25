import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";

import type { AppEnvironment } from "../environment";

import {
  canSubmit,
  invalidField,
  isBusy,
  isTerminal,
  newRequestId,
  REQUEST_ID_PREFIX,
  resolveWriteGate,
  toWriteState,
} from "./writeState";

const environment = (overrides: Partial<AppEnvironment> = {}): AppEnvironment =>
  ({
    backendConfigured: true,
    identityConfigured: true,
    ...overrides,
  }) as AppEnvironment;

describe("resolveWriteGate", () => {
  it("refuses to submit before a backend exists", () => {
    expect(
      resolveWriteGate(environment({ backendConfigured: false })).kind,
    ).toBe("BACKEND_MISSING");
  });

  it("refuses to submit before an identity provider exists", () => {
    expect(
      resolveWriteGate(environment({ identityConfigured: false })).kind,
    ).toBe("SIGN_IN_REQUIRED");
  });

  it("permits a submission only when configured", () => {
    expect(canSubmit({ kind: "READY" })).toBe(true);
    expect(canSubmit({ kind: "BACKEND_MISSING" })).toBe(false);
    expect(canSubmit({ kind: "SIGN_IN_REQUIRED" })).toBe(false);
  });
});

describe("toWriteState", () => {
  it("is submitting while there is no answer", () => {
    expect(toWriteState({})).toEqual({ kind: "SUBMITTING" });
  });

  it("reports a write, and whether the server replayed it", () => {
    expect(
      toWriteState({
        outcome: {
          ok: true,
          requestId: "req_1",
          value: { written: true, documentId: "doc_1", replayed: false },
        },
      }),
    ).toEqual({ kind: "SAVED", documentId: "doc_1", replayed: false });

    expect(
      toWriteState({
        outcome: {
          ok: true,
          requestId: "req_1",
          value: { written: true, documentId: "doc_1", replayed: true },
        },
      }),
    ).toEqual({ kind: "SAVED", documentId: "doc_1", replayed: true });
  });

  it("carries the request ID out of a denial and nothing else", () => {
    const state = toWriteState({
      outcome: {
        ok: false,
        requestId: "req_denied",
        denial: {
          kind: "AUTHORIZATION_DENIED",
          code: "AUTHORIZATION_DENIED",
          requestId: "req_denied",
          message: "not permitted",
        },
      },
    });

    expect(state).toEqual({ kind: "DENIED", requestId: "req_denied" });

    expect(JSON.stringify(state)).not.toContain("NO_PERMISSION");
  });

  it("names the field a refusal blames, without the value", () => {
    const state = toWriteState({
      outcome: {
        ok: true,
        requestId: "req_2",
        value: {
          written: false,
          error: { code: "FIELD_INVALID", field: "sku" },
        },
      },
    });

    expect(state).toEqual({
      kind: "REFUSED",
      code: "FIELD_INVALID",
      field: "sku",
    });
    expect(invalidField(state)).toBe("sku");
  });

  it("leaves the field absent when the refusal blames none", () => {
    const state = toWriteState({
      outcome: {
        ok: true,
        requestId: "req_3",
        value: { written: false, error: { code: "DUPLICATE_KEY" } },
      },
    });

    expect(state).toEqual({ kind: "REFUSED", code: "DUPLICATE_KEY" });
    expect(invalidField(state)).toBeUndefined();
  });

  it("still refuses when the answer has no readable code", () => {
    const state = toWriteState({
      outcome: {
        ok: true,
        requestId: "req_4",
        value: { written: false, error: { code: "" } },
      },
    });
    expect(state).toEqual({ kind: "REFUSED", code: "UNKNOWN" });
  });

  it("reads the code out of a thrown Convex error", () => {
    const state = toWriteState({
      failure: new ConvexError({ code: "RATE_LIMITED" }),
    });
    expect(state).toEqual({ kind: "FAILED", code: "RATE_LIMITED" });
  });

  it("reports an anonymous throw as a failure, not a denial", () => {
    expect(
      toWriteState({ failure: new ConvexError({ code: "ANONYMOUS" }) }),
    ).toEqual({ kind: "FAILED", code: "ANONYMOUS" });
  });

  it("reports an unreadable throw under UNKNOWN rather than its message", () => {
    const state = toWriteState({ failure: new Error("connection reset") });
    expect(state).toEqual({ kind: "FAILED", code: "UNKNOWN" });
    expect(JSON.stringify(state)).not.toContain("connection reset");
  });
});

describe("terminality", () => {
  it.each([
    ["SAVED", { kind: "SAVED" as const, documentId: "d", replayed: false }],
    ["DENIED", { kind: "DENIED" as const, requestId: "r" }],
    ["REFUSED", { kind: "REFUSED" as const, code: "FIELD_INVALID" }],
  ])("treats %s as final", (_name, state) => {
    expect(isTerminal(state)).toBe(true);
  });

  it("does not treat a transport failure as final", () => {
    expect(isTerminal({ kind: "FAILED", code: "UNKNOWN" })).toBe(false);
  });

  it("is busy only while submitting", () => {
    expect(isBusy({ kind: "SUBMITTING" })).toBe(true);
    expect(isBusy({ kind: "IDLE" })).toBe(false);
    expect(isBusy({ kind: "FAILED", code: "UNKNOWN" })).toBe(false);
  });
});

describe("newRequestId", () => {
  it("marks the key as browser-minted", () => {
    expect(newRequestId().startsWith(REQUEST_ID_PREFIX)).toBe(true);
  });

  it("does not repeat itself", () => {
    const keys = new Set(Array.from({ length: 500 }, () => newRequestId()));
    expect(keys.size).toBe(500);
  });
});
