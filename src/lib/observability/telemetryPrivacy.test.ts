import { afterEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { observabilityEvent } from "./event";
import {
  sentryDataCollection,
  sentryObservabilityEvent,
  sanitizeSentryEvent,
  sanitizeSentrySpan,
  privateSentryTransport,
} from "./sentryPolicy";
import { beforeSpeedInsightsSend, speedInsightsPayload } from "./speedInsights";
import { POST } from "@/app/api/observability/speed-insights/route";

const secret = "person-SENTINEL@example.test";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("external telemetry boundary", () => {
  it("drops raw routes, business DOM selectors and SDK enrichment", () => {
    const input = {
      metrics: [
        {
          id: secret,
          type: "LCP",
          value: 456,
          route: secret,
          href: `https://app.example.test/en/finished-goods/products/${secret}?token=${secret}#${secret}`,
          attribution: { eventTarget: secret },
        },
      ],
      speed: secret,
      user: secret,
    };
    const safe = speedInsightsPayload(input, "https://app.example.test");
    expect(safe?.metrics[0]).toMatchObject({
      type: "LCP",
      value: 456,
      route: "/en/finished-goods/products/[id]/[id]",
    });
    expect(JSON.stringify(safe)).not.toContain("SENTINEL");
    // Vercel's collector requires this wire field even when network dimensions
    // are deliberately excluded. Empty means unknown, not a fabricated speed.
    expect(safe).toHaveProperty("speed", "");
    expect(safe?.metrics[0]).not.toHaveProperty("attribution");
    expect(
      beforeSpeedInsightsSend({
        type: "vital",
        url: `https://app.example.test/en/scan?email=${secret}`,
      }),
    ).toEqual({
      type: "vital",
      url: "https://app.example.test/en/scan",
      route: "/en/scan",
    });
  });
  it("rejects invalid metric values, oversized batches and foreign origins", () => {
    for (const value of [Number.NaN, Infinity, -1, secret])
      expect(
        speedInsightsPayload(
          {
            metrics: [
              { type: "LCP", value, href: "https://app.example.test/en" },
            ],
          },
          "https://app.example.test",
        ),
      ).toBeNull();
    expect(
      speedInsightsPayload(
        { metrics: Array(7).fill({}) },
        "https://app.example.test",
      ),
    ).toBeNull();
    expect(
      speedInsightsPayload(
        {
          metrics: [
            { type: "LCP", value: 1, href: "https://foreign.example.test/en" },
          ],
        },
        "https://app.example.test",
      ),
    ).toBeNull();
  });
  it("re-sanitizes errors after SDK enrichment and only retains hashed build frames", () => {
    const event = sanitizeSentryEvent({
      type: undefined,
      message: secret,
      request: {
        url: secret,
        data: secret,
        headers: { authorization: secret },
      },
      user: { email: secret },
      extra: { record: secret },
      breadcrumbs: [{ message: secret }],
      debug_meta: {
        images: [
          {
            type: "sourcemap",
            code_file: "https://app.example.test/_next/static/chunks/a123b.js",
            debug_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          },
          { type: "sourcemap", code_file: secret, debug_id: secret },
        ],
      },
      exception: {
        values: [
          {
            type: secret,
            value: secret,
            stacktrace: {
              frames: [
                {
                  filename: `https://app.example.test/_next/static/chunks/a123b.js`,
                  lineno: 2,
                  colno: 3,
                  vars: { name: secret },
                  context_line: secret,
                },
                { filename: `/Users/${secret}/src/${secret}.ts` },
              ],
            },
          },
        ],
      },
      tags: { route: `en/finished-goods/${secret}`, email: secret },
    });
    expect(event.message).toBe("application.unhandled.failed");
    expect(event.exception?.values?.[0]?.stacktrace?.frames).toEqual([
      { filename: "app:///_next/static/chunks/a123b.js", lineno: 2, colno: 3 },
    ]);
    expect(JSON.stringify(event)).not.toContain("SENTINEL");
    expect(event).not.toHaveProperty("user");
    expect(event).not.toHaveProperty("request");
    expect(event.debug_meta?.images).toEqual([
      {
        type: "sourcemap",
        code_file: "app:///_next/static/chunks/a123b.js",
        debug_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      },
    ]);
  });
  it("sanitizes the installed SDK's streamed-span format", () => {
    const span = sanitizeSentrySpan({
      trace_id: "a".repeat(32),
      span_id: "b".repeat(16),
      name: `ui.route/en/finished-goods/${secret}`,
      start_timestamp: 1,
      end_timestamp: 2,
      status: "ok",
      is_segment: true,
      attributes: { "http.url": secret, "user.email": secret },
      links: [],
    });
    expect(span.attributes).toEqual({ "sentry.op": "ui.route" });
    expect(JSON.stringify(span)).not.toContain("SENTINEL");
  });
  it("captures a safe error through the real SDK transport without external delivery", async () => {
    const envelopes: unknown[] = [];
    Sentry.init({
      dsn: "https://public@o1.ingest.sentry.io/2",
      defaultIntegrations: false,
      dataCollection: sentryDataCollection,
      beforeSend: sanitizeSentryEvent,
      tracesSampleRate: 1,
      beforeSendSpan: sanitizeSentrySpan,
      transport: () =>
        privateSentryTransport({
          send: async (envelope: unknown) => {
            envelopes.push(envelope);
            return { statusCode: 200 };
          },
          flush: async () => true,
        }),
    });
    Sentry.setUser({ email: secret });
    Sentry.setContext("business", { record: secret });
    Sentry.setTag("unsafe", secret);
    const span = Sentry.startInactiveSpan({
      name: `ui.route/en/finished-goods/${secret}`,
      op: "ui.route",
      attributes: { "http.url": secret, record: secret },
      forceTransaction: true,
    });
    span.end();
    Sentry.captureEvent({
      ...sentryObservabilityEvent(
        observabilityEvent({
          code: "workspace.query.failed",
          severity: "error",
          occurredAt: 1,
          dimensions: { route: `en/storage/${secret}`, name: secret },
        }),
      ),
      extra: { secret },
    });
    await Sentry.flush(2000);
    expect(envelopes.length).toBeGreaterThan(0);
    expect(JSON.stringify(envelopes)).not.toContain("SENTINEL");
    await Sentry.close(2000);
    Sentry.setUser(null);
    Sentry.setContext("business", null);
    Sentry.setTag("unsafe", null);
  });
  it("forwards only allowlisted metrics and never forwards request credentials", async () => {
    vi.stubEnv("NEXT_PUBLIC_SPEED_INSIGHTS_ENABLED", "1");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
    const send = vi.fn(async (_url: URL, options: RequestInit) => {
      const body =
        typeof options.body === "string" ? JSON.parse(options.body) : {};
      // The live collector rejects a missing speed field with HTTP 400.
      return new Response(null, {
        status: typeof body.speed === "string" ? 204 : 400,
      });
    });
    vi.stubGlobal("fetch", send);
    const request = new Request(
      "https://candidate.example.test/api/observability/speed-insights",
      {
        method: "POST",
        headers: { origin: "https://candidate.example.test", cookie: secret },
        body: JSON.stringify({
          speed: secret,
          metrics: [
            {
              type: "INP",
              value: 22,
              href: `https://candidate.example.test/en/scan?token=${secret}`,
              attribution: { eventTarget: secret },
            },
          ],
        }),
      },
    );
    expect((await POST(request)).status).toBe(204);
    expect(send).toHaveBeenCalledOnce();
    expect(JSON.stringify(send.mock.calls)).not.toContain("SENTINEL");
    expect(send.mock.calls[0]?.[0].href).toBe(
      "https://app.example.test/_vercel/speed-insights/vitals",
    );
  });
  it("refuses cross-origin and oversized telemetry bodies", async () => {
    vi.stubEnv("NEXT_PUBLIC_SPEED_INSIGHTS_ENABLED", "1");
    expect(
      (
        await POST(
          new Request(
            "https://app.example.test/api/observability/speed-insights",
            {
              method: "POST",
              headers: { origin: "https://evil.example.test" },
              body: "{}",
            },
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await POST(
          new Request(
            "https://app.example.test/api/observability/speed-insights",
            {
              method: "POST",
              headers: { origin: "https://app.example.test" },
              body: "x".repeat(8193),
            },
          ),
        )
      ).status,
    ).toBe(413);
  });
});
