import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fromLocal } from "../../../convex/model/hr/calendar";
import { HrAccessProvider, useHrAccess } from "./HrAccessProvider";
import {
  businessDateAt,
  msUntilNextBusinessDate,
  useBusinessDate,
} from "./useBusinessDate";

const mock = vi.hoisted(() => ({
  names: [] as string[],
  value: {
    permissions: ["hr.self.access"],
    organizationId: "org-one",
    actorUserId: "actor-one",
    organizationName: "Test organization",
    timezone: "Asia/Bangkok",
    timezoneSupported: true,
    offsetMinutes: 420 as number | undefined,
    sites: [],
    sitesComplete: true,
  },
}));
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
    useQuery: (ref: Parameters<typeof getFunctionName>[0]) => {
      mock.names.push(getFunctionName(ref));
      return { ok: true, value: mock.value };
    },
  };
});

const BANGKOK = 420;

describe("organization business date on the client", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["Date", "setTimeout", "clearTimeout"],
    });
    mock.names.length = 0;
    mock.value = { ...mock.value, timezoneSupported: true, offsetMinutes: 420 };
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("uses the organization offset, not the device timezone, across UTC midnight", () => {
    // 2026-10-12 23:30 UTC is already 06:30 on the 13th in Bangkok.
    const instant = Date.UTC(2026, 9, 12, 23, 30);
    expect(businessDateAt(instant, BANGKOK)).toBe("2026-10-13");
    expect(businessDateAt(instant, 0)).toBe("2026-10-12");
    expect(businessDateAt(instant, -300)).toBe("2026-10-12");
    expect(
      msUntilNextBusinessDate(
        fromLocal("2026-10-13", 23 * 60, BANGKOK),
        BANGKOK,
      ),
    ).toBe(60 * 60_000);
    expect(
      msUntilNextBusinessDate(fromLocal("2026-10-13", 0, BANGKOK), BANGKOK),
    ).toBe(86_400_000);
  });

  it("rolls the date over at local midnight without a new server request", () => {
    vi.setSystemTime(fromLocal("2026-10-13", 23 * 60 + 59, BANGKOK));
    const hook = renderHook(() => useBusinessDate(BANGKOK));
    expect(hook.result.current).toBe("2026-10-13");
    act(() => {
      vi.advanceTimersByTime(60_000 + 1_000);
    });
    expect(hook.result.current).toBe("2026-10-14");
  });

  it("re-checks when a background tab becomes visible again", () => {
    vi.setSystemTime(fromLocal("2026-10-13", 12 * 60, BANGKOK));
    const hook = renderHook(() => useBusinessDate(BANGKOK));
    expect(hook.result.current).toBe("2026-10-13");
    // A suspended tab's timer did not fire; the clock moved on regardless.
    vi.setSystemTime(fromLocal("2026-10-15", 9 * 60, BANGKOK));
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(hook.result.current).toBe("2026-10-15");
  });

  it("has no date for an unsupported timezone", () => {
    const hook = renderHook(() => useBusinessDate(undefined));
    expect(hook.result.current).toBeUndefined();
  });

  it("subscribes to the clock-free access query and derives today from its offset", () => {
    vi.setSystemTime(fromLocal("2026-10-13", 23 * 60 + 59, BANGKOK));
    const wrapper = ({ children }: { children: ReactNode }) => (
      <HrAccessProvider>{children}</HrAccessProvider>
    );
    const hook = renderHook(() => useHrAccess(), { wrapper });
    expect(new Set(mock.names)).toEqual(new Set(["hr/access:display"]));
    expect(hook.result.current).toMatchObject({
      status: "READY",
      timezone: "Asia/Bangkok",
      timezoneSupported: true,
      today: "2026-10-13",
    });
    act(() => {
      vi.advanceTimersByTime(2 * 60_000);
    });
    expect(hook.result.current.today).toBe("2026-10-14");

    mock.value = {
      ...mock.value,
      timezone: "Mars/Olympus",
      timezoneSupported: false,
      offsetMinutes: undefined,
    };
    hook.rerender();
    expect(hook.result.current.timezoneSupported).toBe(false);
    expect(hook.result.current.today).toBeUndefined();
  });
});
