import { describe, expect, it } from "vitest";

import { operationErrorCode } from "@/hooks/useAsyncOperation";
import { resolveWriteError } from "@/lib/resolveWriteError";
import { requireWritten, WriteOutcomeError } from "./mutationOutcome";

function caught(run: () => unknown) {
  try {
    run();
  } catch (error) {
    if (error instanceof WriteOutcomeError) return error;
    throw error;
  }
  throw new Error("Expected a structured write failure");
}

describe("structured mutation outcomes", () => {
  it("preserves authorization denial metadata and the existing translated copy key", () => {
    const error = caught(() =>
      requireWritten({
        ok: false,
        requestId: "denied-request",
        denial: { code: "AUTHORIZATION_DENIED", requestId: "denied-request" },
      }),
    );
    expect(error).toMatchObject({
      kind: "denial",
      code: "AUTHORIZATION_DENIED",
      requestId: "denied-request",
      replayed: undefined,
      message: "ACCESS_DENIED",
    });
    expect(operationErrorCode(error)).toBe("ACCESS_DENIED");
  });

  it("preserves domain refusal code, field, request ID and replay metadata", () => {
    const error = caught(() =>
      requireWritten({
        ok: true,
        requestId: "outer-request",
        value: {
          written: false,
          replayed: false,
          error: {
            code: "FIELD_INVALID",
            field: "quantity",
            requestId: "domain-request",
          },
        },
      }),
    );
    expect(error).toMatchObject({
      kind: "refusal",
      code: "FIELD_INVALID",
      field: "quantity",
      requestId: "domain-request",
      replayed: false,
    });
    expect(operationErrorCode(error)).toBe("FIELD_INVALID");
    expect(
      caught(() =>
        requireWritten({
          ok: true,
          requestId: "outer-request",
          value: { written: false, error: { code: "NOT_FOUND" } },
        }),
      ).requestId,
    ).toBe("outer-request");
  });

  it.each([false, true])(
    "preserves a success receipt with replayed=%s",
    (replayed) => {
      expect(
        requireWritten({
          ok: true,
          requestId: "write-request",
          value: { written: true, documentId: "scan-id", replayed },
        }),
      ).toEqual({
        written: true,
        documentId: "scan-id",
        requestId: "write-request",
        replayed,
      });
    },
  );

  it("keeps optional code/replay fields when supplied without inventing absent metadata", () => {
    expect(
      requireWritten({
        ok: true,
        value: { written: true, code: "SAVED", replayed: false },
      }),
    ).toMatchObject({ code: "SAVED", replayed: false, requestId: undefined });
    const error = caught(() =>
      requireWritten({
        ok: false,
        denial: { code: "DENIED", replayed: false },
      }),
    );
    expect(error).toMatchObject({
      code: "DENIED",
      replayed: false,
      requestId: undefined,
    });
  });

  it("uses the existing safe localized fallback for missing and unknown failures", () => {
    const t = Object.assign((key: string) => `localized:${key}`, {
      has: (key: string) => key === "FG_UNKNOWN",
    });
    for (const outcome of [
      { ok: true, requestId: "unknown-request" },
      {
        ok: true,
        requestId: "unknown-request",
        value: { written: false, error: { code: "UNRECOGNIZED_CODE" } },
      },
    ]) {
      const error = caught(() => requireWritten(outcome));
      expect(error.requestId).toBe("unknown-request");
      expect(resolveWriteError(operationErrorCode(error), t)).toBe(
        "localized:FG_UNKNOWN",
      );
    }
    expect(caught(() => requireWritten({ ok: true })).code).toBe("SAVE_FAILED");
  });
});
