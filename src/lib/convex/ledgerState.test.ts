import { describe, expect, it } from "vitest";

import {
  failureCodeOf,
  isReady,
  resolveLedgerGate,
  toLedgerPanelState,
  UNKNOWN_FAILURE_CODE,
} from "./ledgerState";

import { resolveAppEnvironment, type AppEnvironment } from "../environment";

import type { BalanceRow, LedgerPage, TenantOutcome } from "./ledgerApi";

const configured: AppEnvironment = resolveAppEnvironment({
  convexUrl: "https://example.convex.cloud",
  clerkPublishableKey: "pk_test_Zm9vLWJhci0xMy5jbGVyay5hY2NvdW50cy5kZXYk",
});

const row: BalanceRow = {
  bucketKey: "IB1|3:org",
  stockStatus: "AVAILABLE",
  uom: "KG",
  minorUnits: 1_000,
};

const readyPage: LedgerPage<BalanceRow> = {
  ok: true,
  items: [row],
  nextCursor: "cursor-2",
  complete: false,
};

const success: TenantOutcome<LedgerPage<BalanceRow>> = {
  ok: true,
  requestId: "req_1",
  value: readyPage,
};

describe("resolveLedgerGate", () => {
  it("blocks on a missing backend before anything else is considered", () => {
    const gate = resolveLedgerGate(resolveAppEnvironment({}), "wh_1");
    expect(gate.kind).toBe("BACKEND_MISSING");
  });

  it("blocks on a missing identity provider even when the backend is up", () => {
    const gate = resolveLedgerGate(
      resolveAppEnvironment({ convexUrl: "https://example.convex.cloud" }),
      "wh_1",
    );
    expect(gate.kind).toBe("SIGN_IN_REQUIRED");
  });

  it("blocks when no warehouse is selected", () => {
    expect(resolveLedgerGate(configured, undefined).kind).toBe(
      "WAREHOUSE_MISSING",
    );
  });

  it("carries the narrowed warehouse when a query may be issued", () => {
    const gate = resolveLedgerGate(configured, "wh_1");
    expect(gate).toEqual({ kind: "READY_TO_QUERY", warehouseId: "wh_1" });
  });
});

describe("toLedgerPanelState", () => {
  it("is loading while the query is in flight", () => {
    expect(
      toLedgerPanelState({
        environment: configured,
        warehouseId: "wh_1",
        outcome: undefined,
      }).kind,
    ).toBe("LOADING");
  });

  it("reports rows, the cursor, and completeness when the read succeeded", () => {
    const state = toLedgerPanelState({
      environment: configured,
      warehouseId: "wh_1",
      outcome: success,
    });

    expect(isReady(state)).toBe(true);
    if (!isReady(state)) throw new Error("unreachable");
    expect(state.rows).toEqual([row]);
    expect(state.nextCursor).toBe("cursor-2");
    expect(state.complete).toBe(false);
    expect(state.requestId).toBe("req_1");
  });

  it("reports an authorization denial with the request ID the audit row quotes", () => {
    const state = toLedgerPanelState({
      environment: configured,
      warehouseId: "wh_1",
      outcome: {
        ok: false,
        requestId: "req_denied",
        denial: {
          kind: "AUTHORIZATION_DENIED",
          code: "AUTHORIZATION_DENIED",
          requestId: "req_denied",
          message: "Not permitted.",
        },
      },
    });

    expect(state).toEqual({ kind: "DENIED", requestId: "req_denied" });
  });

  it("separates a ledger refusal from an authorization denial", () => {
    const state = toLedgerPanelState({
      environment: configured,
      warehouseId: "wh_1",
      outcome: {
        ok: true,
        requestId: "req_2",
        value: { ok: false, error: { code: "CURSOR_INVALID" } },
      },
    });

    expect(state).toEqual({
      kind: "LEDGER_ERROR",
      code: "CURSOR_INVALID",
      requestId: "req_2",
    });
  });

  it("maps an anonymous failure to sign-in rather than to a generic error", () => {
    const state = toLedgerPanelState({
      environment: configured,
      warehouseId: "wh_1",
      outcome: undefined,
      failure: { data: { code: "ANONYMOUS", requestId: "req_3" } },
    });

    expect(state.kind).toBe("SIGN_IN_REQUIRED");
  });

  it("reports any other thrown failure with its code", () => {
    const state = toLedgerPanelState({
      environment: configured,
      warehouseId: "wh_1",
      outcome: undefined,
      failure: { data: { code: "INTERNAL_ERROR", requestId: "req_4" } },
    });

    expect(state).toEqual({ kind: "ERROR", code: "INTERNAL_ERROR" });
  });

  it("prefers a thrown failure over a stale outcome", () => {
    const state = toLedgerPanelState({
      environment: configured,
      warehouseId: "wh_1",
      outcome: success,
      failure: { data: { code: "INTERNAL_ERROR" } },
    });

    expect(state.kind).toBe("ERROR");
  });
});

describe("failureCodeOf", () => {
  it.each([
    ["a plain network Error", new Error("fetch failed")],
    ["a string", "boom"],
    ["null", null],
    ["undefined", undefined],
    ["an object with no data", { message: "x" }],
    ["a data with no code", { data: { requestId: "r" } }],
    ["a non-string code", { data: { code: 7 } }],
    ["an empty code", { data: { code: "" } }],
  ])("answers UNKNOWN for %s", (_label, failure) => {
    expect(failureCodeOf(failure)).toBe(UNKNOWN_FAILURE_CODE);
  });

  it("never surfaces an error's own message", () => {
    expect(failureCodeOf(new Error("connection to db.internal refused"))).toBe(
      UNKNOWN_FAILURE_CODE,
    );
  });
});
