import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";

import { renderWithIntl } from "@tests/fixtures/intl-render";

const ZONE = "Asia/Bangkok";
const at = (date: string, hhmm: string) =>
  Date.parse(`${date}T${hhmm}:00+07:00`);

const state = vi.hoisted(() => ({
  queries: new Map<string, unknown>(),
  mutations: new Map<string, ReturnType<typeof vi.fn>>(),
  access: {
    status: "READY",
    permissions: ["hr.self.access", "hr.team.review"],
    timezone: "Asia/Bangkok",
    timezoneSupported: true,
    today: "2026-10-09",
    sites: [],
  } as Record<string, unknown>,
}));

vi.mock("convex/react", async () => {
  const { getFunctionName: name } = await import("convex/server");
  return {
    useQuery: (reference: Parameters<typeof name>[0], args: unknown) =>
      args === "skip" ? undefined : state.queries.get(name(reference)),
    useMutation: (reference: Parameters<typeof name>[0]) => {
      const key = name(reference);
      if (!state.mutations.has(key)) state.mutations.set(key, vi.fn());
      return state.mutations.get(key);
    },
    useConvexAuth: () => ({ isLoading: false, isAuthenticated: true }),
  };
});
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => state.access,
  useHrCan: (code: string) =>
    (state.access.permissions as string[]).includes(code),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: unknown }) => (
    <a href={href} {...props}>
      {children as never}
    </a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/hr/today",
}));

import { DraftGuardProvider } from "@/components/providers/DraftGuardProvider";
import { hrRefs } from "@/lib/convex/hrApi";
import { guardedNavigate } from "@/lib/navigationGuard";
import { HrTodayScreen } from "./TodayScreen";
import { ReviewDetail } from "./ReviewDetail";
import { classifyOutcome } from "./useHrWrite";

const ref = (reference: Parameters<typeof getFunctionName>[0]) =>
  getFunctionName(reference);
const mutation = (reference: Parameters<typeof getFunctionName>[0]) => {
  const key = ref(reference);
  if (!state.mutations.has(key)) state.mutations.set(key, vi.fn());
  return state.mutations.get(key)!;
};

const plan = {
  kind: "SCHEDULED",
  startAt: at("2026-10-09", "08:30"),
  endAt: at("2026-10-09", "17:30"),
  startTime: "08:30",
  endTime: "17:30",
  endsNextDay: false,
  breakMinutes: 60,
};

function today(overrides: Record<string, unknown> = {}) {
  state.queries.set(ref(hrRefs.today), {
    ok: true,
    requestId: "q",
    value: {
      timezone: ZONE,
      today: "2026-10-09",
      now: at("2026-10-09", "08:20"),
      state: "NOT_CLOCKED_IN",
      employee: {
        id: "e1",
        code: "EMP-001",
        displayName: "Somchai",
        status: "ACTIVE",
        site: { id: "w1", code: "HQ", name: "Head office" },
      },
      businessDate: "2026-10-09",
      plan,
      nextAction: "CLOCK_IN",
      corrections: [],
      ...overrides,
    },
  });
}

beforeEach(() => {
  state.queries.clear();
  state.mutations.clear();
  window.sessionStorage.clear();
});

describe("write outcome classification", () => {
  it("distinguishes saved, refused, denied and uncertain responses", () => {
    expect(
      classifyOutcome({ ok: true, value: { written: true, documentId: "x" } }),
    ).toMatchObject({ kind: "SAVED" });
    expect(
      classifyOutcome({
        ok: true,
        value: { written: false, error: { code: "HR_PERIOD_CLOSED" } },
      }),
    ).toEqual({ kind: "REFUSED", code: "HR_PERIOD_CLOSED" });
    expect(classifyOutcome({ ok: false, requestId: "r" })).toEqual({
      kind: "DENIED",
    });
    expect(classifyOutcome(undefined)).toEqual({ kind: "UNCERTAIN" });
  });
});

describe("Today clock action (HR-020 – HR-023, A14)", () => {
  it("shows success only after the server confirms the saved time", async () => {
    today();
    let resolve: (value: unknown) => void = () => undefined;
    mutation(hrRefs.clockIn).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    renderWithIntl(<HrTodayScreen />, { locale: "en" });
    const button = screen.getByRole("button", { name: "Clock in" });
    fireEvent.click(button);
    await waitFor(() =>
      expect(screen.getByTestId("hr-clock-action")).toBeDisabled(),
    );
    fireEvent.click(screen.getByTestId("hr-clock-action"));
    expect(mutation(hrRefs.clockIn)).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("hr-clock-saved")).not.toBeInTheDocument();
    resolve({
      ok: true,
      requestId: "m",
      value: {
        written: true,
        documentId: "event",
        replayed: false,
        occurredAt: at("2026-10-09", "08:23"),
        businessDate: "2026-10-09",
        kind: "CLOCK_IN",
      },
    });
    expect(await screen.findByTestId("hr-clock-saved")).toHaveTextContent(
      "Clocked in at 08:23",
    );
    expect(
      screen.getByRole("link", { name: "View time history" }),
    ).toHaveAttribute("href", "/hr/time");
  });

  it("keeps the request ID after a lost response and reuses it on retry", async () => {
    today();
    const send = mutation(hrRefs.clockIn);
    send
      .mockRejectedValueOnce(new Error("Connection lost"))
      .mockResolvedValueOnce({
        ok: true,
        requestId: "m",
        value: {
          written: true,
          documentId: "event",
          replayed: true,
          occurredAt: at("2026-10-09", "08:23"),
          businessDate: "2026-10-09",
          kind: "CLOCK_IN",
        },
      });
    renderWithIntl(<HrTodayScreen />, { locale: "en" });
    fireEvent.click(screen.getByRole("button", { name: "Clock in" }));
    expect(await screen.findByTestId("hr-write-uncertain")).toHaveTextContent(
      "We could not confirm whether this was saved",
    );
    expect(screen.queryByTestId("hr-clock-saved")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again safely" }));
    await screen.findByTestId("hr-clock-saved");
    const [first, second] = send.mock.calls.map(
      (call) => (call[0] as { requestId: string }).requestId,
    );
    expect(first).toBeTruthy();
    expect(second).toBe(first);
  });

  it("explains a business refusal without claiming success", async () => {
    today();
    mutation(hrRefs.clockIn).mockResolvedValue({
      ok: true,
      requestId: "m",
      value: { written: false, error: { code: "HR_PERIOD_CLOSED" } },
    });
    renderWithIntl(<HrTodayScreen />, { locale: "en" });
    fireEvent.click(screen.getByRole("button", { name: "Clock in" }));
    expect(await screen.findByTestId("hr-write-refused")).toHaveTextContent(
      "This attendance period is closed",
    );
    expect(screen.queryByTestId("hr-clock-saved")).not.toBeInTheDocument();
  });

  it("explains unlinked accounts and unresolved earlier days instead of offering a clock action", () => {
    today({ state: "NOT_LINKED" });
    const view = renderWithIntl(<HrTodayScreen />, { locale: "en" });
    expect(screen.getByTestId("hr-not-linked")).toBeInTheDocument();
    expect(screen.queryByTestId("hr-clock-action")).not.toBeInTheDocument();
    view.unmount();
    today({
      state: "UNRESOLVED_OPEN",
      nextAction: "NONE",
      openDay: {
        businessDate: "2026-10-08",
        clockInAt: at("2026-10-08", "08:29"),
        pendingCorrection: false,
      },
    });
    renderWithIntl(<HrTodayScreen />, { locale: "th" });
    expect(screen.getByTestId("hr-open-day")).toHaveTextContent("08:29");
    expect(screen.queryByTestId("hr-clock-action")).not.toBeInTheDocument();
  });

  it("never shows attendance while the query is loading or denied", () => {
    const view = renderWithIntl(<HrTodayScreen />, { locale: "en" });
    expect(screen.getByTestId("panel-LOADING")).toBeInTheDocument();
    view.unmount();
    state.queries.set(ref(hrRefs.today), { ok: false, requestId: "denied" });
    renderWithIntl(<HrTodayScreen />, { locale: "en" });
    expect(screen.getByTestId("panel-DENIED")).toBeInTheDocument();
    expect(screen.queryByTestId("hr-clock-action")).not.toBeInTheDocument();
  });
});

describe("review decisions (HR-031, HR-032, A9)", () => {
  function pendingDetail(stale = false) {
    state.queries.set(ref(hrRefs.reviewDayDetail), {
      ok: true,
      requestId: "q",
      value: {
        ok: true,
        timezone: ZONE,
        today: "2026-10-09",
        employee: {
          id: "e1",
          code: "EMP-001",
          displayName: "Somchai",
          linked: true,
          siteCode: "HQ",
          siteName: "Head office",
        },
        detail: {
          employeeId: "e1",
          businessDate: "2026-10-08",
          revision: 1,
          plan,
          status: "EXCEPTION",
          issue: "PENDING_CORRECTION",
          disposition: null,
          effectiveStartAt: at("2026-10-08", "08:29"),
          workedMinutes: 0,
          outsideShiftMinutes: 0,
          originalStartAt: at("2026-10-08", "08:29"),
          locked: false,
          events: [],
          pendingCorrectionId: "c1",
          corrections: [
            {
              id: "c1",
              status: "PENDING",
              proposedStartAt: at("2026-10-08", "08:29"),
              proposedEndAt: at("2026-10-08", "17:30"),
              reason: "Forgot to clock out",
              version: 1,
              stale,
              submittedAt: at("2026-10-08", "17:40"),
              submittedByName: "Somchai",
              history: [],
            },
          ],
        },
      },
    });
  }

  it("requires a reason to return and sends the displayed version", async () => {
    pendingDetail();
    const decide = mutation(hrRefs.decideCorrection);
    decide.mockResolvedValue({
      ok: true,
      requestId: "m",
      value: { written: true, documentId: "c1", replayed: false },
    });
    renderWithIntl(<ReviewDetail employeeId="e1" businessDate="2026-10-08" />, {
      locale: "en",
    });
    expect(screen.getByText("Forgot to clock out")).toBeInTheDocument();
    // Choosing Return reveals the labelled, required reason; nothing is sent.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("hr-return"));
    const reason = screen.getByRole("textbox", {
      name: /Reason for returning/,
    });
    expect(reason).toBeRequired();
    expect(decide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("hr-return-confirm"));
    expect(
      await screen.findByText("Enter a reason for returning"),
    ).toBeInTheDocument();
    expect(decide).not.toHaveBeenCalled();
    fireEvent.change(reason, {
      target: { value: "Please confirm the end time" },
    });
    fireEvent.click(screen.getByTestId("hr-return-confirm"));
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith(
        expect.objectContaining({
          correctionId: "c1",
          expectedVersion: 1,
          decision: "RETURN",
          reason: "Please confirm the end time",
        }),
      ),
    );
    expect(await screen.findByText("Returned")).toBeInTheDocument();
  });

  it("holds search, AI and link navigation while a certification without a comment is in flight", async () => {
    pendingDetail();
    let answer: (value: unknown) => void = () => {};
    mutation(hrRefs.decideCorrection).mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    renderWithIntl(
      <DraftGuardProvider>
        <ReviewDetail employeeId="e1" businessDate="2026-10-08" />
      </DraftGuardProvider>,
      { locale: "en" },
    );
    // No comment: the form is clean, but the decision is being sent.
    fireEvent.click(screen.getByTestId("hr-certify"));
    const leave = vi.fn();
    act(() => guardedNavigate(leave));
    expect(await screen.findByTestId("navigation-guard-pending")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Discard changes" }),
    ).toBeDisabled();
    // Staying is always possible; leaving is not.
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(leave).not.toHaveBeenCalled();
    act(() => guardedNavigate(leave));
    expect(leave).not.toHaveBeenCalled();

    // Once the server answers, nothing holds the next navigation.
    await act(async () =>
      answer({
        ok: true,
        requestId: "m",
        value: { written: true, documentId: "c1", replayed: false },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    act(() => guardedNavigate(leave));
    // The guard first removes its history buffer, then navigates.
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    });
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it("shows a stale decision refusal and blocks certifying a stale request", async () => {
    pendingDetail(true);
    renderWithIntl(<ReviewDetail employeeId="e1" businessDate="2026-10-08" />, {
      locale: "en",
    });
    expect(screen.getByTestId("hr-certify")).toBeDisabled();
    expect(
      screen.getByText("Attendance changed after this request"),
    ).toBeInTheDocument();
  });

  it("reports a server refusal such as self-review", async () => {
    pendingDetail();
    mutation(hrRefs.decideCorrection).mockResolvedValue({
      ok: true,
      requestId: "m",
      value: { written: false, error: { code: "SELF_REVIEW" } },
    });
    renderWithIntl(<ReviewDetail employeeId="e1" businessDate="2026-10-08" />, {
      locale: "en",
    });
    fireEvent.click(screen.getByTestId("hr-certify"));
    expect(await screen.findByTestId("hr-write-refused")).toHaveTextContent(
      "You cannot review your own attendance",
    );
  });

  it("answers a forged or out-of-scope employee with a not-found message", () => {
    state.queries.set(ref(hrRefs.reviewDayDetail), {
      ok: true,
      requestId: "q",
      value: { ok: false, code: "NOT_FOUND" },
    });
    renderWithIntl(
      <ReviewDetail employeeId="forged" businessDate="2026-10-08" />,
      {
        locale: "en",
      },
    );
    expect(screen.getByTestId("hr-error")).toHaveTextContent(
      "Not found, or not in your scope",
    );
  });

  it("lets a reviewer deliberately edit a certified unlinked day in an open revision", () => {
    pendingDetail();
    const outcome = state.queries.get(ref(hrRefs.reviewDayDetail)) as {
      value: { employee: { linked: boolean }; detail: Record<string, unknown> };
    };
    outcome.value.employee.linked = false;
    Object.assign(outcome.value.detail, {
      status: "READY",
      issue: undefined,
      disposition: "ABSENT",
      pendingCorrectionId: undefined,
      corrections: [],
      certification: {
        disposition: "ABSENT",
        reason: "Initial register review",
        decidedAt: at("2026-10-08", "18:00"),
        decidedByName: "Reviewer",
        current: true,
      },
    });
    renderWithIntl(<ReviewDetail employeeId="e1" businessDate="2026-10-08" />, {
      locale: "en",
    });
    // A deliberate entry step is also acceptable; keep the final requirement
    // that an unlocked certified day can be corrected through the real form.
    const edit = screen.queryByRole("button", {
      name: /edit.*review|review again|change.*review/i,
    });
    if (edit) fireEvent.click(edit);
    expect(screen.getByTestId("hr-dispose-submit")).toBeInTheDocument();
  });
});
