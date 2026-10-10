import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { beforeEach, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";

const clock = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("convex/react", () => ({
  useQuery: () => ({
    ok: true,
    requestId: "query",
    value: {
      timezone: "Asia/Bangkok",
      today: "2026-10-09",
      businessDate: "2026-10-09",
      state: "NOT_CLOCKED_IN",
      nextAction: "CLOCK_IN",
      employee: {
        id: "employee-qa",
        code: "EMP-QA",
        displayName: "QA Employee",
        status: "ACTIVE",
        site: { id: "site-qa", code: "QA", name: "QA Site" },
      },
      plan: {
        kind: "SCHEDULED",
        startTime: "08:30",
        endTime: "17:30",
        endsNextDay: false,
        breakMinutes: 60,
      },
      corrections: [],
    },
  }),
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref).endsWith(":clockIn") ? clock.send : vi.fn(),
}));
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => ({
    status: "READY",
    permissions: ["hr.self.access"],
    timezone: "Asia/Bangkok",
    timezoneSupported: true,
    identityKey: "organization-qa|actor-qa",
    sites: [],
  }),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: unknown }) => (
    <a href={href} {...props}>
      {children as never}
    </a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { DraftGuardProvider } from "@/components/providers/DraftGuardProvider";
import { guardedNavigate } from "@/lib/navigationGuard";
import { HrTodayScreen } from "./TodayScreen";

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/en/hr/today");
});

it("holds Search, AI and link navigation until a clock write receives its server answer", async () => {
  let answer: ((value: unknown) => void) | undefined;
  clock.send.mockReturnValue(
    new Promise((resolve) => {
      answer = resolve;
    }),
  );
  renderWithIntl(
    <DraftGuardProvider>
      <HrTodayScreen />
    </DraftGuardProvider>,
    { locale: "en" },
  );
  fireEvent.click(screen.getByTestId("hr-clock-action"));
  await waitFor(() => expect(clock.send).toHaveBeenCalledTimes(1));

  const leave = vi.fn();
  act(() => guardedNavigate(leave));
  expect(leave).not.toHaveBeenCalled();
  expect(await screen.findByTestId("navigation-guard-pending")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Discard changes" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));

  await act(async () => {
    answer?.({
      ok: true,
      value: {
        written: true,
        occurredAt: Date.parse("2026-10-09T08:30:00+07:00"),
        businessDate: "2026-10-09",
        kind: "CLOCK_IN",
      },
    });
  });
  expect(await screen.findByTestId("hr-clock-saved")).toBeVisible();
  act(() => guardedNavigate(leave));
  act(() => {
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
  });
  expect(leave).toHaveBeenCalledTimes(1);
});
