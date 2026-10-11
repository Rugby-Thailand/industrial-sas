import { describe, expect, it, vi } from "vitest";

import {
  createEstimateLoader,
  ESTIMATE_CACHE_TAG,
  FAILURE_BACKOFF_MS,
  type PersistentCache,
} from "./estimateLoader";
import {
  ESTIMATE_REVALIDATE_SECONDS,
  ESTIMATE_STALE_AFTER_MS,
  FUNDING_SOURCE_URL,
  FX_SOURCE_URL,
  MAX_SOURCE_BYTES,
} from "./estimateSources";

const START = Date.parse("2026-10-11T07:00:00Z");
const FX_BODY = JSON.stringify({
  date: "2026-10-11",
  base: "USD",
  quote: "THB",
  rate: 33.583,
});
const FAQ_BODY = `export const getTotalFeeString = (type, value) => {
  if (type === 'stripe') return '5.5% ($0.80 minimum)';
  if (type === 'coinbase') return '5%';
};
`;

/**
 * An in-memory stand-in with `unstable_cache` semantics: a fulfilled result
 * is stored; a rejection is not; an entry older than `revalidate` is served
 * stale while one background refresh runs, and kept if that refresh fails.
 */
function memoryCache(clock: { now: number }) {
  const store = new Map<string, { value: unknown; at: number }>();
  const calls: { keyParts: string[]; revalidate: number; tags: string[] }[] =
    [];
  const pending: Promise<unknown>[] = [];
  const cache: PersistentCache = (load, keyParts, options) => {
    calls.push({ keyParts, ...options });
    const key = keyParts.join("/");
    return async () => {
      const entry = store.get(key);
      if (entry) {
        if (clock.now - entry.at > options.revalidate * 1000)
          pending.push(
            load().then(
              (value) => store.set(key, { value, at: clock.now }),
              () => undefined,
            ),
          );
        return entry.value as never;
      }
      const value = await load();
      store.set(key, { value, at: clock.now });
      return value;
    };
  };
  return { cache, store, calls, settle: () => Promise.all(pending) };
}

function world(
  route: (url: string, init?: RequestInit) => Promise<Response> | Response,
) {
  const clock = { now: START };
  const memory = memoryCache(clock);
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    route(String(input), init),
  );
  const load = createEstimateLoader({
    fetch: fetcher as unknown as typeof fetch,
    now: () => clock.now,
    cache: memory.cache,
    timeoutMs: 20,
  });
  const callsTo = (url: string) =>
    fetcher.mock.calls.filter(([input]) => String(input) === url).length;
  return { clock, memory, fetcher, load, callsTo };
}

const ok = (body: string) => new Response(body, { status: 200 });
const healthy = (url: string) => ok(url === FX_SOURCE_URL ? FX_BODY : FAQ_BODY);

describe("createEstimateLoader", () => {
  it("caches each public source for one day under versioned keys", async () => {
    const { load, memory, callsTo, clock } = world(healthy);
    expect(memory.calls).toEqual([
      {
        keyParts: [ESTIMATE_CACHE_TAG, "fx-usd-thb", "v1"],
        revalidate: ESTIMATE_REVALIDATE_SECONDS,
        tags: [ESTIMATE_CACHE_TAG],
      },
      {
        keyParts: [ESTIMATE_CACHE_TAG, "openrouter-card-funding", "v1"],
        revalidate: 86400,
        tags: [ESTIMATE_CACHE_TAG],
      },
    ]);
    const first = await load();
    expect(first).toEqual({
      version: 1,
      loadedAt: START,
      fx: {
        status: "READY",
        value: { rate: 33.583, date: "2026-10-11", fetchedAt: START },
      },
      funding: {
        status: "READY",
        value: { percent: 5.5, minimumUsd: 0.8, fetchedAt: START },
      },
    });
    clock.now += 23 * 3600_000;
    const second = await load();
    expect(second.fx).toEqual(first.fx);
    expect(second.loadedAt).toBe(clock.now);
    expect(callsTo(FX_SOURCE_URL)).toBe(1);
    expect(callsTo(FUNDING_SOURCE_URL)).toBe(1);
  });

  it("sends no tenant data or credentials upstream", async () => {
    const { load, fetcher } = world(healthy);
    await load();
    for (const [, init] of fetcher.mock.calls) {
      expect(Object.keys((init?.headers ?? {}) as object)).toEqual(["accept"]);
      expect(init?.cache).toBe("no-store");
      expect(init?.body).toBeUndefined();
    }
  });

  it("shares one upstream request between concurrent cold loads", async () => {
    let release!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const { load, callsTo } = world(async (url) => {
      await gate;
      return healthy(url);
    });
    const loads = [load(), load(), load()];
    release();
    const results = await Promise.all(loads);
    expect(results.every((r) => r.fx.status === "READY")).toBe(true);
    expect(callsTo(FX_SOURCE_URL)).toBe(1);
    expect(callsTo(FUNDING_SOURCE_URL)).toBe(1);
  });

  it.each([
    ["an invalid payload", () => ok('{"base":"USD","quote":"THB","rate":0}')],
    ["malformed JSON", () => ok("<html>")],
    ["an upstream error", () => new Response("down", { status: 503 })],
    [
      "a network failure",
      () => {
        throw new TypeError("fetch failed");
      },
    ],
  ])(
    "keeps the other source and caches nothing after %s",
    async (_label, failFx) => {
      const { load, memory, callsTo, clock } = world((url) =>
        url === FX_SOURCE_URL ? failFx() : healthy(url),
      );
      const estimate = await load();
      expect(estimate.fx).toEqual({ status: "UNAVAILABLE" });
      expect(estimate.funding.status).toBe("READY");
      expect([...memory.store.keys()]).toEqual([
        `${ESTIMATE_CACHE_TAG}/openrouter-card-funding/v1`,
      ]);
      // Back-off: no new request until it ends, then exactly one.
      clock.now += FAILURE_BACKOFF_MS - 1;
      expect((await load()).fx.status).toBe("UNAVAILABLE");
      expect(callsTo(FX_SOURCE_URL)).toBe(1);
      clock.now += 1;
      await load();
      expect(callsTo(FX_SOURCE_URL)).toBe(2);
    },
  );

  it.each([undefined, "1"])(
    "bounds streamed bytes even with Content-Length %s",
    async (declared) => {
      const encoder = new TextEncoder();
      const chunks = [
        encoder.encode(FAQ_BODY),
        encoder.encode("ก".repeat(Math.floor(MAX_SOURCE_BYTES / 3))),
        encoder.encode("never read"),
      ];
      let pulled = 0;
      const cancel = vi.fn();
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            const chunk = chunks[pulled++];
            if (chunk) controller.enqueue(chunk);
            else controller.close();
          },
          cancel,
        },
        { highWaterMark: 0 },
      );
      const { load, memory } = world((url) =>
        url === FUNDING_SOURCE_URL
          ? new Response(body, {
              headers: declared ? { "content-length": declared } : {},
            })
          : healthy(url),
      );
      const snapshot = await load();
      expect(snapshot.funding.status).toBe("UNAVAILABLE");
      expect(snapshot.fx.status).toBe("READY");
      expect(cancel).toHaveBeenCalledOnce();
      expect(pulled).toBe(2);
      expect([...memory.store.keys()]).toEqual([
        `${ESTIMATE_CACHE_TAG}/fx-usd-thb/v1`,
      ]);
    },
  );

  it("cancels a declared oversized body without reading it", async () => {
    const pull = vi.fn();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>(
      { pull, cancel },
      { highWaterMark: 0 },
    );
    const { load } = world((url) =>
      url === FX_SOURCE_URL
        ? new Response(body, {
            headers: { "content-length": String(MAX_SOURCE_BYTES + 1) },
          })
        : healthy(url),
    );
    expect((await load()).fx.status).toBe("UNAVAILABLE");
    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("gives up on a source that exceeds its deadline", async () => {
    const { load } = world(
      (url, init) =>
        new Promise<Response>((resolve, reject) => {
          if (url !== FX_SOURCE_URL) return resolve(healthy(url));
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const estimate = await load();
    expect(estimate.fx).toEqual({ status: "UNAVAILABLE" });
    expect(estimate.funding.status).toBe("READY");
  });

  it("refuses a funding page whose stripe policy cannot be read", async () => {
    const { load } = world((url) =>
      url === FX_SOURCE_URL ? ok(FX_BODY) : ok("# FAQ\nFees vary."),
    );
    const estimate = await load();
    expect(estimate.funding).toEqual({ status: "UNAVAILABLE" });
    expect(estimate.fx.status).toBe("READY");
  });

  it("labels a value stale when its refresh fails, and recovers after", async () => {
    let up = true;
    const { load, clock, memory, callsTo } = world((url) => {
      if (!up) throw new TypeError("offline");
      return healthy(url);
    });
    await load();
    up = false;
    clock.now = START + ESTIMATE_STALE_AFTER_MS + 1;
    const stale = await load();
    await memory.settle();
    expect(stale.fx).toEqual({
      status: "STALE",
      value: { rate: 33.583, date: "2026-10-11", fetchedAt: START },
    });
    expect(stale.funding.status).toBe("STALE");
    expect(callsTo(FX_SOURCE_URL)).toBe(2);
    up = true;
    clock.now += FAILURE_BACKOFF_MS;
    await load();
    await memory.settle();
    const fresh = await load();
    expect(fresh.fx.status).toBe("READY");
    expect(fresh.fx.status !== "UNAVAILABLE" && fresh.fx.value.fetchedAt).toBe(
      clock.now,
    );
  });

  it("refuses a corrupted cached value instead of trusting it", async () => {
    const { load, memory } = world(healthy);
    memory.store.set(`${ESTIMATE_CACHE_TAG}/fx-usd-thb/v1`, {
      value: { rate: "33", date: "2026-10-11", fetchedAt: START },
      at: START,
    });
    expect((await load()).fx).toEqual({ status: "UNAVAILABLE" });
  });
});
