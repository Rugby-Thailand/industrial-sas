import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import {
  evidenceLabel,
  measurementOptions,
  observeTransition,
  summarize,
} from "../../scripts/performance/measurement.mjs";

describe("local performance evidence", () => {
  it("requires twenty completed samples and an explicit supported scenario", () => {
    expect(measurementOptions({ NODE_ENV: "test" }).samples).toBe(20);
    expect(() =>
      measurementOptions({ NODE_ENV: "test", PERFORMANCE_SAMPLES: "19" }),
    ).toThrow();
    expect(() =>
      measurementOptions({ NODE_ENV: "test", PERFORMANCE_SAMPLES: "20.5" }),
    ).toThrow();
    expect(() =>
      measurementOptions({
        NODE_ENV: "test",
        PERFORMANCE_SCENARIOS: "https://production.example",
      }),
    ).toThrow();
    expect(
      measurementOptions({
        NODE_ENV: "test",
        PERFORMANCE_SAMPLES: "40",
        PERFORMANCE_SCENARIOS: "hr",
        PERFORMANCE_WIDTHS: "390",
      }),
    ).toMatchObject({ samples: 40, scenarios: ["hr"], widths: [390] });
    expect(() => evidenceLabel("../private-fixture")).toThrow();
  });

  it("excludes errors and cancellations from descriptive latency percentiles", () => {
    const common = {
      flow: "goods-to-scan",
      width: 1440,
      locale: "en",
      cache: "warm",
    };
    const result = summarize([
      ...Array.from({ length: 20 }, (_, i) => ({
        ...common,
        status: "completed",
        urlObservedMs: i + 1,
        dataReadyMs: i + 20,
      })),
      {
        ...common,
        status: "cancelled",
        dataReadyMs: 99999,
        query: "private-query",
      },
      {
        ...common,
        status: "error",
        dataReadyMs: 99999,
        entityId: "private-entity",
      },
    ]);
    expect(result).toEqual([
      {
        ...common,
        completed: 20,
        cancellations: 1,
        errors: 1,
        timings: {
          urlObservedMs: { n: 20, p50: 10, p95: 19 },
          dataReadyMs: { n: 20, p50: 29, p95: 38 },
        },
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("private");
  });
});

// Bounded timer contract check; real framework behavior belongs to browser QA.
function timer(kind: "goods" | "floor" = "goods") {
  let now = 0;
  let loaded = false;
  let hidden = false;
  let mapLoaded = true;
  let frame: (() => void) | undefined;
  const listeners = new Map<string, () => void>();
  const location = { pathname: "/source", search: "" };
  const window = {
    location,
    performance: { now: () => now },
    requestAnimationFrame: (callback: () => void) => {
      frame = callback;
      return 1;
    },
    cancelAnimationFrame: () => {
      frame = undefined;
    },
    addEventListener: (name: string, callback: () => void) =>
      listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name),
    document: {
      querySelector: () => ({
        querySelectorAll: (selector: string) =>
          loaded && (selector !== "[data-map-zone-id]" || mapLoaded)
            ? [
                {
                  getClientRects: () => [{}],
                  closest: () => (hidden ? {} : null),
                },
              ]
            : [],
      }),
      querySelectorAll: () => [
        {
          getAttribute: () => "/target",
          click: () => {
            location.pathname = "/target";
          },
        },
      ],
    },
  };
  const result: Promise<Record<string, unknown>> = runInNewContext(
    `(${observeTransition.toString()})({ target: '/target', ready: { kind: ${JSON.stringify(kind)}, toolbar: 'Building floors' }, action: { kind: 'link', href: '/target' }, timeoutMs: 100 })`,
    window,
  );
  return {
    result,
    location,
    listeners,
    tick: (time: number, ready = false, retained = false, map = true) => {
      now = time;
      loaded = ready;
      hidden = retained;
      mapLoaded = map;
      const callback = frame;
      frame = undefined;
      callback?.();
    },
  };
}

describe("navigation timer termination", () => {
  it("observes URL and loaded data independently and removes its listeners", async () => {
    const t = timer();
    t.tick(10);
    t.tick(40, true);
    expect(await t.result).toEqual({
      status: "completed",
      urlObservedMs: 10,
      dataReadyMs: 40,
    });
    expect(t.listeners.size).toBe(0);
  });
  it("waits for the actual map zone after a Floor toolbar becomes visible", async () => {
    const t = timer("floor");
    t.tick(10, true, false, false);
    t.tick(40, true);
    expect(await t.result).toEqual({
      status: "completed",
      urlObservedMs: 10,
      dataReadyMs: 40,
    });
  });
  it("excludes retained hidden route data after URL observation", async () => {
    const t = timer();
    t.tick(10, true, true);
    t.tick(40, true);
    expect(await t.result).toEqual({
      status: "completed",
      urlObservedMs: 10,
      dataReadyMs: 40,
    });
  });
  it.each(["pagehide", "error", "unhandledrejection"])(
    "invalidates on %s without retaining diagnostic content",
    async (event) => {
      const t = timer();
      t.tick(10);
      t.listeners.get(event)?.();
      t.tick(40, true);
      expect(await t.result).toEqual({
        status: event === "pagehide" ? "cancelled" : "error",
        reason: event === "pagehide" ? "unmount" : "page-error",
        urlObservedMs: 10,
        elapsedMs: 10,
      });
      expect(t.listeners.size).toBe(0);
    },
  );
  it("invalidates a superseded URL instead of attributing successor data to it", async () => {
    const t = timer();
    t.tick(10);
    t.location.pathname = "/successor";
    t.tick(40, true);
    expect(await t.result).toEqual({
      status: "cancelled",
      reason: "superseded",
      urlObservedMs: 10,
      elapsedMs: 40,
    });
  });
  it("closes a timed out measurement without a data-ready duration", async () => {
    const t = timer();
    t.tick(101);
    expect(await t.result).toEqual({
      status: "error",
      reason: "timeout",
      urlObservedMs: 101,
      elapsedMs: 101,
    });
    expect(t.listeners.size).toBe(0);
  });
});
