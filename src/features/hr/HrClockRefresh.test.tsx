import { act, cleanup, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";

const transport = vi.hoisted(() => ({ read: vi.fn(), mutate: vi.fn() }));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) =>
    args === "skip" ? undefined : transport.read(getFunctionName(ref), args),
  useMutation: () => transport.mutate,
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
}));

import {
  HrAccessProvider,
  useHrAccess,
} from "@/components/providers/HrAccessProvider";
import { HrTodayScreen } from "./TodayScreen";

function AccessDate() {
  return <output data-testid="access-date">{useHrAccess().today}</output>;
}
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  sessionStorage.clear();
});

it("Today renews server-time arguments across idle midnight while shell access stays clock-free", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-13T16:59:30Z"));
  let serverDate = "2026-10-13";
  const cache = new Map<string, unknown>();
  // Convex's transport cache stays unchanged until query arguments change:
  // no fixture DB write, forced rerender or manual reload advances this view.
  transport.read.mockImplementation((name: string, args: unknown) => {
    const key = JSON.stringify([name, args]);
    if (!cache.has(key)) {
      if (name === "hr/access:display")
        cache.set(key, {
          ok: true,
          value: {
            permissions: ["hr.self.access"],
            organizationId: "org-a",
            actorUserId: "actor-a",
            timezone: "Asia/Bangkok",
            timezoneSupported: true,
            offsetMinutes: 420,
            sites: [],
          },
        });
      if (name === "hr/self:today")
        cache.set(key, {
          ok: true,
          value: {
            timezone: "Asia/Bangkok",
            today: serverDate,
            businessDate: serverDate,
            now: Date.now(),
            state: "NOT_CLOCKED_IN",
            nextAction: "CLOCK_IN",
            corrections: [],
            employee: {
              id: "employee-a",
              code: "EMP-A",
              displayName: "Employee A",
              status: "ACTIVE",
              site: { id: "site-a", code: "SITE-A", name: "Site A" },
            },
            plan: {
              kind: "SCHEDULED",
              startTime: "08:30",
              endTime: "17:30",
              breakMinutes: 60,
            },
          },
        });
    }
    return cache.get(key);
  });
  renderWithIntl(
    <HrAccessProvider>
      <AccessDate />
      <HrTodayScreen />
    </HrAccessProvider>,
    { locale: "en" },
  );
  expect(screen.getByTestId("access-date")).toHaveTextContent("2026-10-13");
  expect(
    screen.getByRole("heading", { name: /Tuesday.*13 October 2026/ }),
  ).toBeInTheDocument();
  serverDate = "2026-10-14";
  act(() => vi.advanceTimersByTime(60_000));
  expect(screen.getByTestId("access-date")).toHaveTextContent("2026-10-14");
  expect(
    screen.getByRole("heading", { name: /Wednesday.*14 October 2026/ }),
  ).toBeInTheDocument();
  expect(
    [...cache.keys()].filter((key) => key.includes("hr/access:display")),
  ).toHaveLength(1);
  expect(
    [...cache.keys()].filter((key) => key.includes("hr/self:today")).length,
  ).toBeGreaterThan(1);
  expect(transport.mutate).not.toHaveBeenCalled();
});
