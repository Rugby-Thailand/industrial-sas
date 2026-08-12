import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ObservabilityProvider } from "@/components/providers/ObservabilityProvider";
import type { ObservabilityEvent } from "@/lib/observability/event";
import type { ObservabilityPort } from "@/lib/observability/port";
import { WEB_VITAL_CODE } from "@/lib/observability/webVitals";

import { WebVitals } from "./WebVitals";

interface MetricFixture {
  readonly name: "INP";
  readonly value: number;
  readonly delta: number;
  readonly rating: "poor";
  readonly navigationType: "navigate";
  readonly id: string;
  readonly entries: readonly never[];
}

const hook = vi.hoisted(() => ({
  callbacks: [] as Array<(metric: MetricFixture) => void>,
}));

vi.mock("next/web-vitals", () => ({
  useReportWebVitals: (callback: (metric: MetricFixture) => void) => {
    hook.callbacks.push(callback);
  },
}));

const recordingPort = (): ObservabilityPort & {
  readonly events: ObservabilityEvent[];
} => {
  const events: ObservabilityEvent[] = [];
  return { events, record: (event) => void events.push(event) };
};

beforeEach(() => {
  hook.callbacks.length = 0;
  vi.useRealTimers();
});

describe("WebVitals", () => {
  it("records one redacted performance event", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_786_414_500_000);
    const port = recordingPort();

    render(
      <ObservabilityProvider port={port}>
        <WebVitals />
      </ObservabilityProvider>,
    );

    hook.callbacks[0]?.({
      name: "INP",
      value: 420,
      delta: 120,
      rating: "poor",
      navigationType: "navigate",
      id: "v4-redacted",
      entries: [],
    });

    expect(port.events).toEqual([
      {
        code: WEB_VITAL_CODE,
        severity: "warning",
        dimensions: {
          metric: "INP",
          value: 420,
          delta: 120,
          rating: "poor",
          navigationType: "navigate",
        },
        occurredAt: 1_786_414_500_000,
      },
    ]);
    expect(JSON.stringify(port.events)).not.toContain("v4-redacted");
  });

  it("keeps the callback stable across parent re-renders", () => {
    const port = recordingPort();
    const view = render(
      <ObservabilityProvider port={port}>
        <WebVitals />
      </ObservabilityProvider>,
    );

    const first = hook.callbacks.at(-1);
    view.rerender(
      <ObservabilityProvider port={port}>
        <WebVitals />
      </ObservabilityProvider>,
    );

    expect(hook.callbacks.at(-1)).toBe(first);
  });
});
