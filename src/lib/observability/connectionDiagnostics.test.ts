import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createConnectionDiagnostics } from "./connectionDiagnostics";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("document", { visibilityState: "visible" });
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("window", {
    location: { pathname: "/th/master-data/customers" },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const down = { isWebSocketConnected: false, hasEverConnected: true };
const up = { ...down, isWebSocketConnected: true };

it("retains background, offline and peak retry signals in the recovery event", () => {
  const record = vi.fn();
  const tracker = createConnectionDiagnostics({ record }, 8000, 4000);
  tracker.observe({ ...down, connectionRetries: 2 });
  vi.stubGlobal("document", { visibilityState: "hidden" });
  vi.stubGlobal("navigator", { onLine: false });
  tracker.sampleBrowser();
  vi.advanceTimersByTime(4000);
  tracker.stalled();
  tracker.stalled();
  tracker.observe({ ...down, connectionRetries: 5, inflightMutations: 1 });
  vi.stubGlobal("document", { visibilityState: "visible" });
  vi.stubGlobal("navigator", { onLine: true });
  vi.advanceTimersByTime(2000);
  tracker.observe(up);
  tracker.observe(up);
  expect(record).toHaveBeenCalledTimes(2);
  expect(record.mock.calls[1]?.[0]).toMatchObject({
    code: "connection.stall",
    severity: "info",
    dimensions: {
      phase: "dropped",
      outcome: "recovered",
      foreground: true,
      backgrounded: true,
      offline: true,
      writesPending: true,
      retries: 5,
      durationSec: 6,
      episodes: 1,
    },
  });
});

it("ignores short blips and records a recovery that precedes a throttled timer", () => {
  const record = vi.fn();
  const tracker = createConnectionDiagnostics({ record }, 8000, 4000);
  tracker.observe({ ...down, hasEverConnected: false });
  vi.advanceTimersByTime(7000);
  tracker.observe(up);
  expect(record).not.toHaveBeenCalled();
  for (let n = 0; n < 12; n++) {
    tracker.observe(down);
    vi.advanceTimersByTime(5000);
    tracker.observe(up);
  }
  expect(record).toHaveBeenCalledTimes(10);
  expect(record).toHaveBeenLastCalledWith(
    expect.objectContaining({
      dimensions: expect.objectContaining({
        episodes: 10,
        outcome: "recovered",
        durationSec: 5,
      }),
    }),
  );
});
