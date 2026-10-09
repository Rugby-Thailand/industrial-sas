import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { applicationRenderErrorEvent } from "./applicationError";
import {
  normalizeRoute,
  OBSERVABILITY_DIMENSION_KEYS,
  ROUTE_PLACEHOLDER,
  STATIC_ROUTE_SEGMENTS,
} from "./dimensions";
import {
  MAX_REQUEST_ID_LENGTH,
  normalizeRequestId,
  observabilityEvent,
  OBSERVABILITY_EVENT_CODES,
  REJECTED_EVENT_CODE,
  redactDimensions,
  sanitizeObservabilityEvent,
  type ObservabilityEvent,
} from "./event";
import { createConsoleObservabilityPort } from "./port";
import { webVitalEvent } from "./webVitals";

// Synthetic sentinels only. None of these may survive any event or sink.
const SENTINELS = {
  name: "Somchai Sentinel",
  asciiName: "SomchaiSentinel",
  email: "sentinel.person@example.test",
  customer: "SentinelCustomerCoLtd",
  thaiCustomer: "บริษัทเซนทิเนลจำกัด",
  productCode: "FBN-SENTINEL-BOX-00F",
  image: "data:image/jpeg;base64,U0VOVElORUxJTUFHRQ==",
  imageUrl: "https://files.example.test/sentinel-ticket.jpg",
  token: "sk_live_SentinelTokenValue123",
  bearer: "Bearer synthetic-sentinel-provider-key",
} as const;

const serialized = (value: unknown) => JSON.stringify(value);

function expectNoSentinel(value: unknown) {
  const text = serialized(value);
  for (const sentinel of Object.values(SENTINELS)) {
    expect(text).not.toContain(sentinel);
  }
  for (const fragment of ["Sentinel", "sentinel", "เซนทิเนล"]) {
    expect(text).not.toContain(fragment);
  }
}

describe("observability dimension allowlist", () => {
  it("drops identifier-like and personal keys even when their values look harmless", () => {
    const dimensions = redactDimensions({
      displayName: SENTINELS.asciiName,
      name: SENTINELS.name,
      email: SENTINELS.email,
      customer: SENTINELS.customer,
      customerName: SENTINELS.thaiCustomer,
      employeeCode: "EMP0042",
      productBarcodeText: SENTINELS.productCode,
      factoryOrder: "FO69070073",
      imageUrl: SENTINELS.imageUrl,
      image: SENTINELS.image,
      token: SENTINELS.token,
      authorization: SENTINELS.bearer,
      userId: "user_3Je6gsq8cJfoVOXcjjHGs8qvDGs",
      orgId: "org_3Je6JpUXsjAZcHyLD5lodjFdLmQ",
      id: "v4-1786414500000-1234",
    });

    expect(dimensions).toEqual({});
    expectNoSentinel(dimensions);
    expect(serialized(dimensions)).not.toMatch(/EMP0042|FO6907|user_|org_/);
  });

  it("rejects sentinel values placed in allowlisted keys", () => {
    const dimensions = redactDimensions({
      boundary: SENTINELS.name,
      metric: SENTINELS.email,
      rating: SENTINELS.customer,
      navigationType: SENTINELS.token,
      value: SENTINELS.productCode,
      delta: Number.NaN,
      warehouse: SENTINELS.name,
    });

    expect(dimensions).toEqual({});
    for (const warehouse of [
      SENTINELS.email,
      SENTINELS.asciiName,
      "somchai",
      SENTINELS.thaiCustomer,
      SENTINELS.image,
      "x".repeat(65) + "1",
    ]) {
      expect(redactDimensions({ warehouse })).toEqual({});
    }
  });

  it("replaces record IDs, typed paths and unknown segments in routes", () => {
    expect(
      normalizeRoute(
        "/en/master-data/storage-layouts/n57c2n3sjmdpkjncn9jf0a19gh8ey9h5/floors/2",
      ),
    ).toBe(
      `en.master-data.storage-layouts.${ROUTE_PLACEHOLDER}.floors.${ROUTE_PLACEHOLDER}`,
    );
    const typed = normalizeRoute(
      `th/${SENTINELS.email}/${SENTINELS.customer}/${SENTINELS.productCode}`,
    );
    // `.` also splits, so the email contributes three placeholder segments.
    expect(typed).toBe(["th", ...Array(5).fill(ROUTE_PLACEHOLDER)].join("."));
    expectNoSentinel(typed);
    expect(normalizeRoute("")).toBe("root");
    expect(normalizeRoute(42)).toBeUndefined();
    expect(
      normalizeRoute(
        Array.from({ length: 40 }, () => "storage-layouts").join("/"),
      )!.length,
    ).toBeLessThanOrEqual(64);
  });

  it("keeps the useful static dimensions of every current call site", () => {
    expect(
      redactDimensions({
        route: "en.storage-layouts",
        warehouse: "warehouse-a",
      }),
    ).toEqual({ route: "en.storage-layouts" });
    expect(
      redactDimensions({ warehouse: "p17ckfaqgw6dprz8d3tfv1tkhd8ez4e6" }),
    ).toEqual({});
    expect(redactDimensions({ warehouse: "none" })).toEqual({});

    expect(applicationRenderErrorEvent("global", 10).dimensions).toEqual({
      boundary: "global",
    });
    expect(
      webVitalEvent(
        {
          name: "LCP",
          value: 2_400.5,
          delta: 12,
          rating: "needs-improvement",
          navigationType: "back-forward-cache",
        },
        10,
      ).dimensions,
    ).toEqual({
      metric: "LCP",
      value: 2_400.5,
      delta: 12,
      rating: "needs-improvement",
      navigationType: "back-forward-cache",
    });
    expect(OBSERVABILITY_DIMENSION_KEYS).toEqual([
      "boundary",
      "metric",
      "value",
      "delta",
      "rating",
      "navigationType",
      "route",
    ]);
  });

  it("covers every static segment of the current app route tree", () => {
    const appRoot = fileURLToPath(new URL("../../app", import.meta.url));
    const segments = new Set<string>();
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const name = entry.name;
        const dynamic = name.startsWith("[");
        const group = name.startsWith("(") && name.endsWith(")");
        if (!dynamic && !group && name !== "api") segments.add(name);
        if (name !== "api") walk(`${directory}/${name}`);
      }
    };
    walk(appRoot);
    expect(segments.size).toBeGreaterThan(10);
    for (const segment of segments) {
      expect(STATIC_ROUTE_SEGMENTS.has(segment), segment).toBe(true);
    }
  });
});

describe("observability events", () => {
  it("bounds request IDs and omits unsafe ones", () => {
    expect(normalizeRequestId("0f8fad5b-d9cb-469f-a165-70867728950e")).toBe(
      "0f8fad5b-d9cb-469f-a165-70867728950e",
    );
    for (const unsafe of [
      "",
      "a".repeat(MAX_REQUEST_ID_LENGTH + 1),
      SENTINELS.email,
      SENTINELS.name,
      SENTINELS.bearer,
      "req_fixture_submission",
      "req_somchai_customer",
      "req_sk_live_secret",
      "00000000-0000-0000-0000-000000000000",
      42,
    ]) {
      expect(normalizeRequestId(unsafe)).toBeUndefined();
    }
    const event = observabilityEvent({
      code: "workspace.query.failed",
      severity: "error",
      requestId: SENTINELS.email,
      occurredAt: 1,
    });
    expect(event).not.toHaveProperty("requestId");
  });

  it("drops lowercase business and credential-shaped content at the actual sink", () => {
    const lines: string[] = [];
    const port = createConsoleObservabilityPort((line) => lines.push(line));
    for (const code of [
      "customer.somchai",
      "token.sk-live-secret",
      "order.fo69070073",
      "product.fbn-box-00f",
    ]) {
      port.record({
        code,
        severity: "error",
        requestId: "req_sk_live_secret",
        dimensions: {
          warehouse: "somchai-01",
          employeeCode: "emp-0042",
          customer: "somchai",
          productCode: "fbn-box-00f",
        },
        occurredAt: 10,
      });
    }
    expect(lines.map((line) => JSON.parse(line))).toEqual(
      Array.from({ length: 4 }, () => ({
        observability: {
          code: REJECTED_EVENT_CODE,
          severity: "error",
          dimensions: {},
          occurredAt: 10,
        },
      })),
    );
    for (const warehouse of [
      "somchai-01",
      "emp-0042",
      "sk-live-secret",
      "warehouse-a",
    ])
      expect(redactDimensions({ warehouse })).toEqual({});
    expect(OBSERVABILITY_EVENT_CODES).toEqual([
      "application.render.failed",
      "web.vital",
      "workspace.query.failed",
      REJECTED_EVENT_CODE,
    ]);
    for (const code of OBSERVABILITY_EVENT_CODES)
      expect(
        observabilityEvent({ code, severity: "info", occurredAt: 1 }).code,
      ).toBe(code);
  });

  it("refuses data-bearing event codes and invalid severities", () => {
    const event = observabilityEvent({
      code: `customer.${SENTINELS.email}`,
      severity: "fatal" as never,
      occurredAt: Number.POSITIVE_INFINITY,
    });
    expect(event).toEqual({
      code: REJECTED_EVENT_CODE,
      severity: "error",
      dimensions: {},
      occurredAt: 0,
    });
    expect(
      observabilityEvent({
        code: "application.render.failed",
        severity: "warning",
        occurredAt: 5,
      }).code,
    ).toBe("application.render.failed");
  });

  it("re-sanitizes literal events in the console sink and never throws", () => {
    const lines: string[] = [];
    const port = createConsoleObservabilityPort((line) => lines.push(line));
    const literal = {
      code: "workspace.query.failed",
      severity: "error",
      requestId: SENTINELS.token,
      dimensions: {
        route: `en/finished-goods/scan/${SENTINELS.productCode}`,
        customer: SENTINELS.thaiCustomer,
        imageUrl: SENTINELS.image,
        email: SENTINELS.email,
      },
      occurredAt: 7,
    } as unknown as ObservabilityEvent;

    port.record(literal);

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({
      observability: {
        code: "workspace.query.failed",
        severity: "error",
        dimensions: {
          route: `en.finished-goods.scan.${ROUTE_PLACEHOLDER}`,
        },
        occurredAt: 7,
      },
    });
    expectNoSentinel(lines);
    expectNoSentinel(sanitizeObservabilityEvent(literal));

    const throwing = createConsoleObservabilityPort(() => {
      throw new Error("sink offline");
    });
    expect(() => throwing.record(literal)).not.toThrow();
  });
});
