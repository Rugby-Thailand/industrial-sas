import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UsageEstimate } from "@/lib/aiUsage/estimateSources";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
import { useEstimateRefresh } from "./useEstimateRefresh";

const now = Date.parse("2026-10-11T07:00:00Z");
const ready: UsageEstimate = {
  version: 1,
  loadedAt: now,
  fx: {
    status: "READY",
    value: { rate: 33.583, date: "2026-10-11", fetchedAt: now },
  },
  funding: {
    status: "READY",
    value: { percent: 5.5, minimumUsd: 0.8, fetchedAt: now },
  },
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  refresh.mockReset();
});
afterEach(() => vi.useRealTimers());

it("refreshes a long-open report at daily expiry, preserves the cache window, and cleans up", () => {
  const { unmount } = renderHook(() => useEstimateRefresh(ready));
  act(() => vi.advanceTimersByTime(86_400_000 - 1));
  expect(refresh).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(refresh).toHaveBeenCalledTimes(1);
  act(() => {
    window.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(599_999);
  });
  expect(refresh).toHaveBeenCalledTimes(1);
  unmount();
  act(() => {
    vi.advanceTimersByTime(3_600_000);
    window.dispatchEvent(new Event("focus"));
  });
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("retries an unavailable source after ten minutes without a focus request storm", () => {
  renderHook(() =>
    useEstimateRefresh({ ...ready, funding: { status: "UNAVAILABLE" } }),
  );
  act(() => vi.advanceTimersByTime(600_000));
  expect(refresh).toHaveBeenCalledTimes(1);
  act(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("focus"));
  });
  expect(refresh).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(600_000));
  expect(refresh).toHaveBeenCalledTimes(2);
});
