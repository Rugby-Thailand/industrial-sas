import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  clockIn: vi.fn(),
  clockOut: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useQuery: () => mocks.query(),
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref).endsWith(":clockIn") ? mocks.clockIn : mocks.clockOut,
}));
vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () =>
    Object.assign((key: string) => key, { has: () => true }),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: ComponentProps<"a">) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("./HrShared", () => ({
  HrGate: ({ children }: { children: ReactNode }) => children,
  HrQueryState: ({ children }: { children: () => ReactNode }) => children(),
  CorrectionBadge: () => null,
  Facts: () => null,
  PlanText: () => null,
  SectionTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  TimeText: () => null,
  WriteFeedback: ({
    state,
    onRetry,
  }: {
    state: { kind: string };
    onRetry: () => void;
  }) => (
    <div>
      {state.kind}
      {state.kind === "UNCERTAIN" ? (
        <button onClick={onRetry}>Retry original clock</button>
      ) : null}
    </div>
  ),
}));

import { HrTodayScreen } from "./TodayScreen";

const base = {
  timezone: "Asia/Bangkok",
  today: "2026-10-09",
  now: Date.UTC(2026, 9, 9, 2),
  businessDate: "2026-10-09",
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
  corrections: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("retries clock-in after a lost response even when live data has already advanced to clock-out", async () => {
  let loseResponse: ((error: Error) => void) | undefined;
  const lost = new Promise<unknown>((_, reject) => {
    loseResponse = reject;
  });
  mocks.clockIn.mockReturnValueOnce(lost).mockResolvedValue({
    ok: true,
    value: {
      written: true,
      occurredAt: base.now,
      businessDate: base.today,
      kind: "CLOCK_IN",
    },
  });
  mocks.clockOut.mockResolvedValue({ ok: true, value: { written: false } });
  mocks.query.mockReturnValue({
    ok: true,
    value: { ...base, state: "NOT_CLOCKED_IN", nextAction: "CLOCK_IN" },
  });
  const view = render(<HrTodayScreen />);
  fireEvent.click(screen.getByTestId("hr-clock-action"));
  await waitFor(() => expect(mocks.clockIn).toHaveBeenCalledTimes(1));
  const originalArgs = mocks.clockIn.mock.calls[0]?.[0];

  mocks.query.mockReturnValue({
    ok: true,
    value: {
      ...base,
      state: "CLOCKED_IN",
      nextAction: "CLOCK_OUT",
      clockInAt: base.now,
    },
  });
  view.rerender(<HrTodayScreen />);
  await act(async () => {
    loseResponse?.(new Error("Response lost after persistence"));
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "Retry original clock" }),
  );
  await waitFor(() => expect(mocks.clockIn).toHaveBeenCalledTimes(2));
  expect(mocks.clockIn.mock.calls[1]?.[0]).toEqual(originalArgs);
  expect(mocks.clockOut).not.toHaveBeenCalled();
});

it("does not show the previous employee's delayed clock receipt after the linked employee changes", async () => {
  let confirm: ((value: unknown) => void) | undefined;
  mocks.clockIn.mockReturnValue(
    new Promise<unknown>((resolve) => {
      confirm = resolve;
    }),
  );
  mocks.query.mockReturnValue({
    ok: true,
    value: { ...base, state: "NOT_CLOCKED_IN", nextAction: "CLOCK_IN" },
  });
  const view = render(<HrTodayScreen />);
  fireEvent.click(screen.getByTestId("hr-clock-action"));
  await waitFor(() => expect(mocks.clockIn).toHaveBeenCalledTimes(1));

  mocks.query.mockReturnValue({
    ok: true,
    value: {
      ...base,
      employee: {
        ...base.employee,
        id: "employee-b",
        displayName: "Employee B",
        code: "EMP-B",
      },
      state: "NOT_CLOCKED_IN",
      nextAction: "CLOCK_IN",
    },
  });
  view.rerender(<HrTodayScreen />);
  await act(async () => {
    confirm?.({
      ok: true,
      value: {
        written: true,
        occurredAt: base.now,
        businessDate: base.today,
        kind: "CLOCK_IN",
      },
    });
  });
  expect(screen.queryByTestId("hr-clock-saved")).not.toBeInTheDocument();
  expect(screen.getByTestId("hr-clock-action")).toBeEnabled();
});

it("clears an already-saved receipt when the linked employee changes", async () => {
  mocks.clockIn.mockResolvedValue({
    ok: true,
    value: {
      written: true,
      occurredAt: base.now,
      businessDate: base.today,
      kind: "CLOCK_IN",
    },
  });
  mocks.query.mockReturnValue({
    ok: true,
    value: { ...base, state: "NOT_CLOCKED_IN", nextAction: "CLOCK_IN" },
  });
  const view = render(<HrTodayScreen />);
  fireEvent.click(screen.getByTestId("hr-clock-action"));
  await screen.findByTestId("hr-clock-saved");

  mocks.query.mockReturnValue({
    ok: true,
    value: {
      ...base,
      employee: {
        ...base.employee,
        id: "employee-b",
        displayName: "Employee B",
        code: "EMP-B",
      },
      state: "NOT_CLOCKED_IN",
      nextAction: "CLOCK_IN",
    },
  });
  view.rerender(<HrTodayScreen />);
  expect(screen.queryByTestId("hr-clock-saved")).not.toBeInTheDocument();
});
