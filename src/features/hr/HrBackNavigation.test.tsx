import { fireEvent, screen, waitFor, act } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { useSyncExternalStore } from "react";
import type { ComponentProps } from "react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";

const state = vi.hoisted(() => ({
  queries: new Map<string, unknown>(),
  create: vi.fn(),
}));
vi.mock("convex/react", async () => {
  const { getFunctionName: name } = await import("convex/server");
  return {
    useQuery: (reference: Parameters<typeof name>[0], args: unknown) =>
      args === "skip" ? undefined : state.queries.get(name(reference)),
    useMutation: () => state.create,
  };
});
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => ({
    status: "READY",
    permissions: [
      "hr.admin.manage",
      "hr.period.close",
      "hr.team.review",
      "hr.self.access",
    ],
    timezoneSupported: true,
    timezone: "Asia/Bangkok",
    today: "2026-10-09",
    identityKey: "audit-org:audit-user",
    sites: [{ id: "w1", code: "HQ", name: "Head office" }],
  }),
  useHrCan: () => true,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => {
    const query = useSyncExternalStore(
      (listener) => {
        window.addEventListener("app-query-state", listener);
        window.addEventListener("popstate", listener);
        return () => {
          window.removeEventListener("app-query-state", listener);
          window.removeEventListener("popstate", listener);
        };
      },
      () => window.location.search,
    );
    return new URLSearchParams(query);
  },
}));
vi.mock("@/i18n/navigation", () => {
  function navigate(href: string, mode: "pushState" | "replaceState") {
    window.history[mode]({}, "", `/en${href}`);
    window.dispatchEvent(new Event("app-query-state"));
  }
  const router = {
    push: (href: string) => navigate(href, "pushState"),
    replace: (href: string) => navigate(href, "replaceState"),
    back: () => window.history.back(),
    forward: () => window.history.forward(),
  };
  return {
    Link: (props: ComponentProps<"a">) => <a {...props} />,
    useRouter: () => router,
  };
});
import { DraftGuardProvider } from "@/components/providers/DraftGuardProvider";
import { hrRefs } from "@/lib/convex/hrApi";
import { trackAppHistory, appHistoryIndex } from "@/lib/browser/appHistory";
import { HrPeriodsScreen } from "@/features/hr/PeriodsScreen";
import { HrReviewScreen } from "@/features/hr/ReviewScreen";
import { HrRequestDetailScreen } from "@/features/hr/RequestsScreen";
import { HrPeriodDetailScreen } from "@/features/hr/PeriodDetailScreen";
import { HrDayScreen } from "@/features/hr/DayScreen";

let stopTracking: () => void;
const snapshot = () => ({
  url: window.location.pathname + window.location.search,
  index: appHistoryIndex(),
});
beforeEach(() => {
  window.sessionStorage.clear();
  state.queries.clear();
  state.create.mockReset();
  state.queries.set(getFunctionName(hrRefs.periodsPage), {
    ok: true,
    value: {
      ok: true,
      status: "ready",
      page: [],
      continueCursor: "",
      isDone: true,
    },
  });
  state.queries.set(getFunctionName(hrRefs.queuePage), {
    ok: true,
    value: {
      ok: true,
      status: "ready",
      continueCursor: "",
      isDone: true,
      page: [
        {
          items: [
            {
              businessDate: "2026-10-09",
              status: "EXCEPTION",
              certified: false,
              issue: "MISSING_END",
              disposition: null,
            },
          ],
          employeeId: "e7",
          employeeName: "Somsak",
          employeeCode: "EMP-007",
          siteCode: "HQ",
          businessDate: "2026-10-09",
          status: "EXCEPTION",
          certified: false,
          issue: "MISSING_END",
          disposition: null,
        },
      ],
    },
  });
  window.history.replaceState({ appNavigationIndex: 0 }, "", "/en/hr/today");
  stopTracking = trackAppHistory();
});
afterEach(() => stopTracking());
async function navigateBack(method: "header" | "native") {
  await act(async () => {
    const pop = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    if (method === "header")
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
    else window.history.back();
    await pop;
  });
}
it.each(["header", "native"] as const)(
  "%s Back closes pristine Period creation before page departure",
  async (method) => {
    window.history.pushState({}, "", "/en/hr/periods");
    renderWithIntl(
      <DraftGuardProvider>
        <HrPeriodsScreen />
      </DraftGuardProvider>,
      { locale: "en", workspace: false },
    );
    fireEvent.click(screen.getByTestId("hr-period-new"));
    expect(screen.getByTestId("hr-period-create")).toBeInTheDocument();
    await navigateBack(method);
    expect(window.location.pathname).toBe("/en/hr/periods");
    expect(screen.queryByTestId("hr-period-create")).toBeNull();
  },
);
it("Review Back to list followed by header Back does not reopen closed detail", async () => {
  window.history.pushState({}, "", "/en/hr/review?tab=OPEN");
  renderWithIntl(
    <DraftGuardProvider>
      <HrReviewScreen />
    </DraftGuardProvider>,
    { locale: "en", workspace: false },
  );
  const trace = [snapshot()];
  fireEvent.click(screen.getByRole("button", { name: /Somsak/ }));
  trace.push(snapshot());
  expect(new URLSearchParams(window.location.search).get("employee")).toBe(
    "e7",
  );
  fireEvent.click(screen.getByRole("button", { name: "Back to the list" }));
  trace.push(snapshot());
  await waitFor(() =>
    expect(
      new URLSearchParams(window.location.search).get("employee"),
    ).toBeNull(),
  );
  await navigateBack("header");
  trace.push(snapshot());
  expect(window.location.pathname).toBe("/en/hr/today");
});
it("direct request detail header Back uses Requests parent", async () => {
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/en/hr/requests/request-a?focus=decision",
  );
  renderWithIntl(<HrRequestDetailScreen requestId="request-a" />, {
    locale: "en",
    workspace: false,
  });
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(window.location.pathname).toBe("/en/hr/requests");
});
it.each(["header", "native"] as const)(
  "%s Back collapses Period close confirmation before page departure",
  async (method) => {
    state.queries.set(getFunctionName(hrRefs.periodPreview), {
      ok: true,
      value: {
        ok: true,
        period: {
          id: "p1",
          siteCode: "HQ",
          siteName: "Head office",
          startDate: "2026-09-01",
          endDate: "2026-09-30",
          status: "DRAFT",
          draftVersion: 1,
          latestClosedVersion: 0,
          timezone: "Asia/Bangkok",
        },
        versions: [],
        versionsComplete: true,
        view: {
          kind: "DRAFT",
          fingerprint: "audit",
          blocker: null,
          rows: [],
          totals: {
            workedMinutes: 0,
            exceptions: 0,
            unfinished: 0,
            employees: 0,
            days: 0,
            absentDays: 0,
            leaveDays: 0,
          },
        },
      },
    });
    window.history.pushState({}, "", "/en/hr/periods/p1");
    renderWithIntl(
      <DraftGuardProvider>
        <HrPeriodDetailScreen periodId="p1" />
      </DraftGuardProvider>,
      { locale: "en", workspace: false },
    );
    fireEvent.click(screen.getByTestId("hr-period-close"));
    expect(screen.getByTestId("hr-period-close-confirm")).toBeInTheDocument();
    await navigateBack(method);
    expect(window.location.pathname).toBe("/en/hr/periods/p1");
    expect(screen.queryByTestId("hr-period-close-confirm")).toBeNull();
  },
);
it("direct Period detail header Back uses Periods parent", () => {
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/en/hr/periods/p1?version=3",
  );
  renderWithIntl(<HrPeriodDetailScreen periodId="p1" />, {
    locale: "en",
    workspace: false,
  });
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(window.location.pathname).toBe("/en/hr/periods");
});
it("direct Day detail header Back uses time parent", () => {
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/en/hr/time/2026-10-09?focus=correction",
  );
  renderWithIntl(<HrDayScreen businessDate="2026-10-09" />, {
    locale: "en",
    workspace: false,
  });
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(window.location.pathname).toBe("/en/hr/time");
});

it("successful Period creation consumes its owned form before returning to the originating list", async () => {
  window.history.pushState({}, "", "/en/hr/periods?kept=yes#list");
  let finish!: (result: unknown) => void;
  state.create.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  renderWithIntl(
    <DraftGuardProvider>
      <HrPeriodsScreen />
    </DraftGuardProvider>,
    { locale: "en", workspace: false },
  );
  fireEvent.click(screen.getByTestId("hr-period-new"));
  fireEvent.change(screen.getByLabelText("From"), {
    target: { value: "2026-02-02" },
  });
  fireEvent.click(screen.getByTestId("hr-period-create"));
  await waitFor(() => expect(state.create).toHaveBeenCalledOnce());
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await act(async () =>
    finish({ ok: true, value: { written: true, documentId: "period-new" } }),
  );
  await waitFor(() =>
    expect(window.location.pathname).toBe("/en/hr/periods/period-new"),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  act(() => window.history.back());
  await waitFor(() =>
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe("/en/hr/periods?kept=yes#list"),
  );
});

it("dirty Period Cancel consumes its guard and creation entries before the next native Back restores the actual caller", async () => {
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/th/hr/time?q=kept#origin",
  );
  window.history.pushState({}, "", "/en/hr/periods?kept=yes#list");
  renderWithIntl(
    <DraftGuardProvider>
      <HrPeriodsScreen />
    </DraftGuardProvider>,
    { locale: "en", workspace: false },
  );
  fireEvent.click(screen.getByTestId("hr-period-new"));
  fireEvent.change(screen.getByLabelText("From"), {
    target: { value: "2026-02-02" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(screen.queryByTestId("hr-period-create")).toBeNull(),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(
    window.location.pathname + window.location.search + window.location.hash,
  ).toBe("/en/hr/periods?kept=yes#list");
  await act(async () => {
    window.history.back();
  });
  await waitFor(() =>
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe("/th/hr/time?q=kept#origin"),
  );
});

it("locale replacement retains Review selection ownership so Back to list and next native Back restore the actual caller", async () => {
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/th/finished-goods?q=kept#origin",
  );
  window.history.pushState({}, "", "/en/hr/review?tab=OPEN&site=w1#queue");
  renderWithIntl(
    <DraftGuardProvider>
      <HrReviewScreen />
    </DraftGuardProvider>,
    { locale: "en", workspace: false },
  );
  fireEvent.click(screen.getByRole("button", { name: /Somsak/ }));
  expect(new URLSearchParams(window.location.search).get("employee")).toBe(
    "e7",
  );
  // Next locale replacement preserves this entry's depth but omits custom metadata.
  act(() => {
    window.history.replaceState(
      { __NA: true },
      "",
      `/th/hr/review${window.location.search}${window.location.hash}`,
    );
  });
  fireEvent.click(screen.getByRole("button", { name: "Back to the list" }));
  await waitFor(() =>
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe("/en/hr/review?tab=OPEN&site=w1#queue"),
  );
  await act(async () => {
    window.history.back();
  });
  await waitFor(() =>
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe("/th/finished-goods?q=kept#origin"),
  );
});

it.each([
  "https://external.example/hr/review",
  "//external.example/hr/review",
  "/en/hr/employees",
])(
  "Review locale replacement rejects unsafe selection provenance %s",
  async (pathname) => {
    window.history.pushState({}, "", "/en/hr/review?tab=OPEN&site=w1#queue");
    renderWithIntl(
      <DraftGuardProvider>
        <HrReviewScreen />
      </DraftGuardProvider>,
      { locale: "en", workspace: false },
    );
    fireEvent.click(screen.getByRole("button", { name: /Somsak/ }));
    act(() => {
      window.history.replaceState(
        {
          ...window.history.state,
          hrReviewSelectionOrigin: { pathname, index: appHistoryIndex() },
        },
        "",
        window.location.href,
      );
      window.history.replaceState(
        { __NA: true },
        "",
        `/th/hr/review${window.location.search}${window.location.hash}`,
      );
    });
    expect(window.history.state.hrReviewSelectionOrigin).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Back to the list" }));
    await waitFor(() =>
      expect(
        new URLSearchParams(window.location.search).get("employee"),
      ).toBeNull(),
    );
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe("/th/hr/review?tab=OPEN&site=w1#queue");
  },
);
