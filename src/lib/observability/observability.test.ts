import { describe, expect, it } from "vitest";

import {
  MAX_DIMENSION_LENGTH,
  observabilityEvent,
  redactDimensions,
} from "./event";
import {
  createConsoleObservabilityPort,
  nullObservabilityPort,
  resolveObservabilityPort,
} from "./port";
import {
  latencyBucketMs,
  LATENCY_BUCKET_BOUNDS_MS,
  ledgerReadEvent,
  recordClientError,
  recordLedgerRead,
  SLI_CODES,
} from "./sli";

import type { ObservabilityEvent } from "./event";
import type { ObservabilityPort } from "./port";

/** A port that keeps what it was given, so a test can assert on it. */
const recordingPort = (): ObservabilityPort & {
  readonly events: ObservabilityEvent[];
} => {
  const events: ObservabilityEvent[] = [];
  return { events, record: (event) => void events.push(event) };
};

describe("redactDimensions", () => {
  it("keeps closed-set codes, numbers, and booleans", () => {
    expect(
      redactDimensions({
        outcome: "DENIED",
        surface: "balances",
        latencyBucketMs: 800,
        healthy: false,
      }),
    ).toEqual({
      outcome: "DENIED",
      surface: "balances",
      latencyBucketMs: 800,
      healthy: false,
    });
  });

  /*
   * The point of the module. Each of these is a plausible thing a well-meaning
   * caller would attach, and each of them is a tenant's data leaving the
   * building.
   */
  it.each([
    ["a free-text error message", { detail: "Item BOLT-M8 not found" }],
    ["an email address", { actor: "somchai@example.co.th" }],
    ["a SKU", { sku: "BOLT-M8/2026" }],
    ["a Thai lot code", { lot: "ล็อต-2026" }],
    ["a stack frame", { stack: "at postTransaction (ledger.ts:412)" }],
    ["an object", { payload: { minorUnits: 1000 } }],
    ["an array", { rows: [1, 2, 3] }],
    ["null", { value: null }],
    ["undefined", { value: undefined }],
  ])("drops %s", (_label, dimensions) => {
    expect(redactDimensions(dimensions)).toEqual({});
  });

  it("drops rather than truncates an over-long value", () => {
    // A truncated identifier is still an identifier.
    const long = "A".repeat(MAX_DIMENSION_LENGTH + 1);
    expect(redactDimensions({ code: long })).toEqual({});
  });

  it("drops a non-finite number, which would serialize as null", () => {
    expect(
      redactDimensions({ a: Number.NaN, b: Number.POSITIVE_INFINITY }),
    ).toEqual({});
  });

  it("drops a key that is not a plain identifier", () => {
    expect(redactDimensions({ "user.email": "x", "": 1, A: 2 })).toEqual({});
  });

  it("answers a frozen record", () => {
    expect(Object.isFrozen(redactDimensions({ a: 1 }))).toBe(true);
  });
});

describe("observabilityEvent", () => {
  it("carries no message field, by construction", () => {
    const event = observabilityEvent({
      code: "ledger.read",
      severity: "info",
      occurredAt: 1_786_414_500_000,
    });
    expect(Object.keys(event).sort()).toEqual([
      "code",
      "dimensions",
      "occurredAt",
      "severity",
    ]);
  });

  it("omits an absent or empty request ID rather than sending an empty string", () => {
    expect(
      observabilityEvent({
        code: "x",
        severity: "info",
        requestId: "",
        occurredAt: 0,
      }).requestId,
    ).toBeUndefined();
  });

  it("keeps a server-minted request ID, which is the correlation handle", () => {
    expect(
      observabilityEvent({
        code: "x",
        severity: "info",
        requestId: "req_0191f2c1",
        occurredAt: 0,
      }).requestId,
    ).toBe("req_0191f2c1");
  });
});

describe("adapters", () => {
  it("defaults to discarding, so an unconfigured environment is silent", () => {
    expect(resolveObservabilityPort(undefined)).toBe(nullObservabilityPort);
    expect(resolveObservabilityPort("")).toBe(nullObservabilityPort);
    // A typo must not be a blank screen; the environment guard catches it.
    expect(resolveObservabilityPort("sentry")).toBe(nullObservabilityPort);
  });

  it("writes one JSON line per event to the console sink", () => {
    const lines: string[] = [];
    const port = createConsoleObservabilityPort(
      (line) => void lines.push(line),
    );

    port.record(
      observabilityEvent({
        code: "ledger.read",
        severity: "info",
        occurredAt: 7,
      }),
    );

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toEqual({
      observability: {
        code: "ledger.read",
        severity: "info",
        dimensions: {},
        occurredAt: 7,
      },
    });
  });

  it("swallows a sink that throws, because telemetry must not break a scan", () => {
    const port = createConsoleObservabilityPort(() => {
      throw new Error("sink down");
    });
    expect(() =>
      port.record(
        observabilityEvent({ code: "x", severity: "error", occurredAt: 0 }),
      ),
    ).not.toThrow();
  });
});

describe("latencyBucketMs", () => {
  it("maps a duration to its ladder bound", () => {
    expect(latencyBucketMs(0)).toBe(100);
    expect(latencyBucketMs(100)).toBe(100);
    expect(latencyBucketMs(101)).toBe(250);
    // The product target (ADR-0009 §8) is its own boundary, so an alert on it
    // is an alert on a real threshold.
    expect(LATENCY_BUCKET_BOUNDS_MS).toContain(800);
    expect(latencyBucketMs(800)).toBe(800);
    expect(latencyBucketMs(801)).toBe(1_500);
  });

  it("reports everything above the ladder, and every nonsense, as -1", () => {
    expect(latencyBucketMs(60_000)).toBe(-1);
    expect(latencyBucketMs(-5)).toBe(-1);
    expect(latencyBucketMs(Number.NaN)).toBe(-1);
  });
});

describe("ledger read SLI", () => {
  it("separates a successful read from a failed one by code", () => {
    expect(
      ledgerReadEvent({
        surface: "balances",
        outcome: "READY",
        occurredAt: 0,
      }).code,
    ).toBe(SLI_CODES.ledgerRead);
    expect(
      ledgerReadEvent({
        surface: "balances",
        outcome: "DENIED",
        occurredAt: 0,
      }).code,
    ).toBe(SLI_CODES.ledgerReadFailed);
  });

  it("reports a denial as a warning, not an error", () => {
    // A denial is the system working. Paging it as an error trains people to
    // ignore the channel.
    expect(
      ledgerReadEvent({
        surface: "history",
        outcome: "DENIED",
        occurredAt: 0,
      }).severity,
    ).toBe("warning");
    expect(
      ledgerReadEvent({
        surface: "history",
        outcome: "ERROR",
        occurredAt: 0,
      }).severity,
    ).toBe("error");
    expect(
      ledgerReadEvent({
        surface: "history",
        outcome: "WAREHOUSE_MISSING",
        occurredAt: 0,
      }).severity,
    ).toBe("info");
  });

  it("buckets the duration and never sends the raw milliseconds", () => {
    const port = recordingPort();
    recordLedgerRead(port, {
      surface: "balances",
      outcome: "READY",
      durationMs: 437,
      occurredAt: 0,
    });

    expect(port.events[0]?.dimensions).toMatchObject({ latencyBucketMs: 500 });
    expect(JSON.stringify(port.events[0])).not.toContain("437");
  });

  it("never reports how many rows a tenant has", () => {
    // A row count survives redaction — it is a number — and is a tenant's stock
    // profile. It is absent from the event by construction.
    const port = recordingPort();
    recordLedgerRead(port, {
      surface: "balances",
      outcome: "READY",
      occurredAt: 0,
    });
    expect(Object.keys(port.events[0]?.dimensions ?? {})).not.toContain(
      "rowCount",
    );
  });
});

describe("client error SLI", () => {
  it("carries the failure code and the surface, and no message", () => {
    const port = recordingPort();
    recordClientError(port, {
      code: "ANONYMOUS",
      surface: "balances",
      requestId: "req_1",
      occurredAt: 5,
    });

    expect(port.events[0]).toEqual({
      code: SLI_CODES.clientError,
      severity: "error",
      requestId: "req_1",
      dimensions: { failureCode: "ANONYMOUS", surface: "balances" },
      occurredAt: 5,
    });
  });
});
