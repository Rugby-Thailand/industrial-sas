import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../../convex/_generated/api";
import {
  JOB_TICKET_PROVIDER_POLICY,
  requestJobTicketProvider,
  type JobTicketProviderPolicy,
} from "../../convex/finishedGoods/jobScans";
import {
  PUBLIC_API_ACTOR,
  createPublicApiWorld,
} from "../fixtures/public-api-examples";

// Synthetic values only. None may appear in any provider outcome or log line.
const BODY_SENTINEL = "SENTINEL-PROVIDER-BODY customer=Somchai Sentinel";
const KEY_SENTINEL = "synthetic-sentinel-provider-key";
const IMAGE_SENTINEL = "data:image/jpeg;base64,U0VOVElORUxJTUFHRQ==";
const CONTENT_SENTINEL = "SENTINEL-MODEL-CONTENT FBN-SENTINEL-BOX-00F";

const FAST: JobTicketProviderPolicy = Object.freeze({
  attemptTimeoutMs: 40,
  totalDeadlineMs: 120,
  maxRetries: 1,
  minRetryBudgetMs: 10,
  maxResponseBytes: 1024,
});

const envelope = (content: unknown) =>
  JSON.stringify({ choices: [{ message: { content } }] });
const ok = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers });
const status = (code: number) => new Response(BODY_SENTINEL, { status: code });
const hung = () => new Promise<Response>(() => undefined);

function expectNoSentinel(value: unknown) {
  const text = JSON.stringify(value) ?? "";
  for (const sentinel of [
    BODY_SENTINEL,
    KEY_SENTINEL,
    IMAGE_SENTINEL,
    CONTENT_SENTINEL,
    "Somchai",
    "SENTINEL",
  ]) {
    expect(text).not.toContain(sentinel);
  }
}

describe("job-ticket provider deadline and retry policy", () => {
  it.each(["headers", "body"] as const)(
    "enforces the total timer despite a backward clock jump during %s",
    async (phase) => {
      vi.useFakeTimers();
      try {
        let clock = 1_000;
        const stalled = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"choices":'));
          },
        });
        const send = vi
          .fn<(signal: AbortSignal) => Promise<Response>>()
          .mockImplementationOnce(
            () =>
              new Promise((resolve) =>
                setTimeout(() => {
                  clock = -1_000;
                  resolve(status(503));
                }, 20),
              ),
          )
          .mockImplementationOnce(() =>
            phase === "headers"
              ? hung()
              : Promise.resolve(new Response(stalled)),
          );
        let settled = false;
        const pending = requestJobTicketProvider(send, {
          policy: { ...FAST, totalDeadlineMs: 55 },
          now: () => clock,
        }).then((outcome) => {
          settled = true;
          return outcome;
        });
        await vi.advanceTimersByTimeAsync(54);
        expect(send).toHaveBeenCalledTimes(2);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(await pending).toMatchObject({
          ok: false,
          reason: "timeout",
          attempts: 2,
        });
        expect(send.mock.calls[1]![0].aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it("declares an explicit bounded default policy with at most one retry", () => {
    expect(JOB_TICKET_PROVIDER_POLICY).toEqual({
      attemptTimeoutMs: 40_000,
      totalDeadlineMs: 55_000,
      maxRetries: 1,
      minRetryBudgetMs: 10_000,
      maxResponseBytes: 256 * 1024,
    });
    expect(Object.isFrozen(JOB_TICKET_PROVIDER_POLICY)).toBe(true);
    expect(JOB_TICKET_PROVIDER_POLICY.attemptTimeoutMs).toBeLessThanOrEqual(
      JOB_TICKET_PROVIDER_POLICY.totalDeadlineMs,
    );
  });

  it("returns timeout for a hung provider that ignores the abort signal, without retrying", async () => {
    const send = vi.fn((_signal: AbortSignal) => hung());
    const started = performance.now();
    const outcome = await requestJobTicketProvider(send, { policy: FAST });
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(outcome).toMatchObject({
      ok: false,
      reason: "timeout",
      attempts: 1,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toBeInstanceOf(AbortSignal);
    expect(send.mock.calls[0]![0].aborted).toBe(true);
  });

  it("times out a body that stalls after headers", async () => {
    const stalled = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"choices":'));
      },
    });
    const outcome = await requestJobTicketProvider(
      async () => new Response(stalled, { status: 200 }),
      { policy: FAST },
    );
    expect(outcome).toMatchObject({
      ok: false,
      reason: "timeout",
      attempts: 1,
    });
  });

  it("retries one 5xx answer and returns the second answer's content", async () => {
    const send = vi
      .fn<(signal: AbortSignal) => Promise<Response>>()
      .mockResolvedValueOnce(status(503))
      .mockResolvedValueOnce(ok(envelope('{"factory_order":"FO-1"}')));
    const outcome = await requestJobTicketProvider(send, { policy: FAST });
    expect(outcome).toMatchObject({
      ok: true,
      content: '{"factory_order":"FO-1"}',
      attempts: 2,
    });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("stops after the single retry and reports only the status", async () => {
    const send = vi.fn(async () => status(502));
    const outcome = await requestJobTicketProvider(send, { policy: FAST });
    expect(outcome).toMatchObject({
      ok: false,
      reason: "status",
      status: 502,
      attempts: 2,
    });
    expect(send).toHaveBeenCalledTimes(2);
    expectNoSentinel(outcome);
  });

  it("treats zero retries as a legitimate policy", async () => {
    const send = vi.fn(async () => status(500));
    const outcome = await requestJobTicketProvider(send, {
      policy: { ...FAST, maxRetries: 0 },
    });
    expect(outcome).toMatchObject({ reason: "status", attempts: 1 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401, 413, 429])("never retries HTTP %i", async (code) => {
    const send = vi.fn(async () => status(code));
    const outcome = await requestJobTicketProvider(send, { policy: FAST });
    expect(outcome).toMatchObject({
      reason: "status",
      status: code,
      attempts: 1,
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not retry when the remaining budget is below the retry minimum", async () => {
    let clock = 0;
    const send = vi.fn(async () => {
      clock += 100;
      return status(503);
    });
    const outcome = await requestJobTicketProvider(send, {
      policy: {
        ...FAST,
        attemptTimeoutMs: 1_000,
        totalDeadlineMs: 150,
        minRetryBudgetMs: 60,
      },
      now: () => clock,
    });
    expect(outcome).toMatchObject({ reason: "status", attempts: 1 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not retry network failures", async () => {
    const send = vi.fn(async () => {
      throw new TypeError(`fetch failed ${BODY_SENTINEL}`);
    });
    const outcome = await requestJobTicketProvider(send, { policy: FAST });
    expect(outcome).toMatchObject({
      ok: false,
      reason: "network",
      attempts: 1,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expectNoSentinel(outcome);
  });

  it("refuses an oversized declared or streamed body", async () => {
    const big = "x".repeat(FAST.maxResponseBytes + 1);
    await expect(
      requestJobTicketProvider(
        async () => ok(big, { "content-length": String(big.length) }),
        { policy: FAST },
      ),
    ).resolves.toMatchObject({ ok: false, reason: "too_large", attempts: 1 });
    const chunked = new ReadableStream<Uint8Array>({
      start(controller) {
        const chunk = new TextEncoder().encode("y".repeat(600));
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    });
    await expect(
      requestJobTicketProvider(async () => new Response(chunked), {
        policy: FAST,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "too_large", attempts: 1 });
  });

  it("reports a non-JSON envelope as malformed without returning its text", async () => {
    const outcome = await requestJobTicketProvider(
      async () => ok(`<html>${BODY_SENTINEL}</html>`),
      { policy: FAST },
    );
    expect(outcome).toMatchObject({ ok: false, reason: "malformed" });
    expectNoSentinel(outcome);
  });

  it("returns empty content when the envelope has no string message", async () => {
    await expect(
      requestJobTicketProvider(async () => ok(envelope({ nested: true })), {
        policy: FAST,
      }),
    ).resolves.toMatchObject({ ok: true, content: "" });
    await expect(
      requestJobTicketProvider(async () => ok("{}"), { policy: FAST }),
    ).resolves.toMatchObject({ ok: true, content: "" });
  });
});

// Registered action: the real `extractJobTicket` through convex-test, with only
// the global fetch transport mocked.
const MODULES = Object.fromEntries(
  Object.entries(
    import.meta.glob([
      "../../convex/**/*.ts",
      "!../../convex/_generated/**",
      "!../../convex/model/**",
      "!../../convex/**/*.test.ts",
      "!../../convex/schema.ts",
      "!../../convex/auth.config.ts",
    ]),
  ).map(([path, load]) => [path.replace("../../convex/", "../convex/"), load]),
);
const transport = vi.fn<typeof fetch>();

beforeEach(() => {
  transport.mockReset().mockImplementation(async () => {
    throw new Error("Unexpected provider transport.");
  });
  vi.stubGlobal("fetch", transport);
  vi.stubEnv("OPENROUTER_API_KEY", KEY_SENTINEL);
  vi.stubEnv("JOB_SCAN_DEMO_AI", "0");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function extract() {
  const world = await createPublicApiWorld(MODULES);
  return world.t
    .withIdentity(PUBLIC_API_ACTOR)
    .action(api.finishedGoods.jobScans.extractJobTicket, {
      warehouseId: world.warehouses.alphaA,
      imageUrl: IMAGE_SENTINEL,
    });
}

function logged(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.map((call) => call.map(String).join(" "));
}

describe("registered extractJobTicket provider failures", () => {
  it("returns AI_UNAVAILABLE after one bounded 5xx retry and logs no provider body, image or key", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    transport.mockImplementation(async () => status(503));

    const result = await extract();

    expect(result).toMatchObject({
      ok: true,
      value: { ok: false, error: { code: "AI_UNAVAILABLE" } },
    });
    expect(transport).toHaveBeenCalledTimes(2);
    for (const call of transport.mock.calls) {
      expect(call[1]?.signal).toBeInstanceOf(AbortSignal);
    }
    const lines = logged(errors);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({
      event: "jobScan.provider.unavailable",
      reason: "status",
      status: 503,
      attempts: 2,
      elapsedMs: expect.any(Number),
    });
    expectNoSentinel(lines);
  });

  it("maps a malformed provider envelope to AI_UNAVAILABLE instead of throwing", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    transport.mockResolvedValue(ok(`not json ${BODY_SENTINEL}`));

    const result = await extract();

    expect(result).toMatchObject({
      value: { ok: false, error: { code: "AI_UNAVAILABLE" } },
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(JSON.parse(logged(errors)[0]!)).toMatchObject({
      reason: "malformed",
      attempts: 1,
    });
    expectNoSentinel(logged(errors));
  });

  it("keeps AI_UNREADABLE for unparseable model content and never logs that content", async () => {
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    transport.mockResolvedValue(ok(envelope(`{${CONTENT_SENTINEL}`)));

    const result = await extract();

    expect(result).toMatchObject({
      value: { ok: false, error: { code: "AI_UNREADABLE" } },
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(errors).not.toHaveBeenCalled();
    expect(JSON.parse(logged(warnings)[0]!)).toEqual({
      event: "jobScan.provider.unreadable",
      attempts: 1,
      elapsedMs: expect.any(Number),
    });
    expectNoSentinel([...logged(warnings), ...logged(errors)]);
  });
});
