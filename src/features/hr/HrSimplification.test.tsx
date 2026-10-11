import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";

const ZONE = "Asia/Bangkok";
const at = (date: string, hhmm: string) =>
  Date.parse(`${date}T${hhmm}:00+07:00`);

const state = vi.hoisted(() => ({
  queries: new Map<string, unknown>(),
  mutations: new Map<string, ReturnType<typeof vi.fn>>(),
  params: new URLSearchParams(),
  access: {
    status: "READY",
    permissions: [
      "hr.self.access",
      "hr.team.review",
      "hr.admin.manage",
      "hr.period.close",
      "hr.period.export",
    ],
    timezone: "Asia/Bangkok",
    timezoneSupported: true,
    today: "2026-10-09",
    sites: [{ id: "w1", code: "HQ", name: "Head office" }],
    identityKey: "org-a:user-a",
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
}));
vi.mock("next/navigation", async (original) => ({
  ...((await original()) as object),
  useSearchParams: () => state.params,
}));

import { DraftGuardProvider } from "@/components/providers/DraftGuardProvider";
import { hrRefs } from "@/lib/convex/hrApi";
import { guardedNavigate } from "@/lib/navigationGuard";

import { HrPeriodDetailScreen } from "./PeriodDetailScreen";
import { ReviewDetail } from "./ReviewDetail";
import { HrSettingsScreen } from "./SettingsScreen";
import { HrTodayScreen } from "./TodayScreen";

const ref = (reference: Parameters<typeof getFunctionName>[0]) =>
  getFunctionName(reference);
const mutation = (reference: Parameters<typeof getFunctionName>[0]) => {
  const key = ref(reference);
  if (!state.mutations.has(key)) state.mutations.set(key, vi.fn());
  return state.mutations.get(key)!;
};
const follows = (earlier: Element, later: Element) =>
  Boolean(
    earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING,
  );

const plan = {
  kind: "SCHEDULED",
  startTime: "08:30",
  endTime: "17:30",
  endsNextDay: false,
  breakMinutes: 60,
};

beforeEach(() => {
  state.queries.clear();
  state.mutations.clear();
  state.params = new URLSearchParams();
  window.sessionStorage.clear();
});

function reviewDay(detail: Record<string, unknown> = {}, linked = true) {
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
        linked,
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
        events: [
          {
            kind: "CLOCK_IN",
            occurredAt: at("2026-10-08", "08:29"),
            actorName: "Somchai",
          },
        ],
        pendingCorrectionId: "c1",
        corrections: [
          {
            id: "c1",
            status: "PENDING",
            proposedStartAt: at("2026-10-08", "08:29"),
            proposedEndAt: at("2026-10-08", "17:30"),
            reason: "Forgot to clock out",
            version: 1,
            stale: false,
            submittedAt: at("2026-10-08", "17:40"),
            submittedByName: "Somchai",
            history: [],
          },
        ],
        ...detail,
      },
    },
  });
}

const renderReview = () =>
  renderWithIntl(
    <DraftGuardProvider>
      <ReviewDetail employeeId="e1" businessDate="2026-10-08" />
    </DraftGuardProvider>,
    { locale: "en" },
  );

describe("review decision flow", () => {
  it("puts one Original → Requested comparison, the employee, date and reason ahead of the actions", () => {
    reviewDay();
    renderReview();
    const heading = screen.getByRole("heading", {
      level: 2,
      name: /Thursday, 8 October 2026/,
    });
    expect(heading).toHaveTextContent("Somchai · EMP-001");
    // One comparison: original and requested side by side, once.
    const table = screen.getByRole("table");
    expect(
      screen.getAllByRole("columnheader", { name: "Original" }),
    ).toHaveLength(1);
    expect(screen.getAllByText("Original")).toHaveLength(1);
    // The summary's second copy of the original times is gone, not hidden.
    expect(screen.queryByText("Original (as recorded)")).toBeNull();
    expect(screen.getByTestId("hr-compare-clockIn")).toHaveTextContent(
      "Clock-in08:2908:29",
    );
    expect(screen.getByTestId("hr-compare-clockOut")).toHaveTextContent(
      "Clock-outNo record17:30 (changed)",
    );
    const reason = screen.getByText("Forgot to clock out");
    const certify = screen.getByTestId("hr-certify");
    expect(reason).toBeVisible();
    expect(follows(heading, table)).toBe(true);
    expect(follows(table, reason)).toBe(true);
    expect(follows(reason, certify)).toBe(true);
    expect(follows(reason, screen.getByTestId("hr-return"))).toBe(true);
    // History and calculated figures are read-only and one step away.
    const details = screen.getByRole("button", {
      name: "Details and history",
    });
    expect(details).toHaveAttribute("aria-expanded", "false");
    expect(follows(certify, details)).toBe(true);
    expect(screen.getByText("Original clock events")).not.toBeVisible();
    fireEvent.click(details);
    expect(screen.getByText("Original clock events")).toBeVisible();
    expect(
      within(
        screen.getByRole("group", { name: "Details and history" }),
      ).queryByRole("textbox"),
    ).not.toBeInTheDocument();
    // Certifying is one press: no confirmation dialog in between.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps a typed draft and its guard across comment, return, cancel and history toggles, and after a refusal", async () => {
    reviewDay();
    const decide = mutation(hrRefs.decideCorrection);
    decide.mockResolvedValue({
      ok: true,
      requestId: "m",
      value: { written: false, error: { code: "SELF_REVIEW" } },
    });
    renderReview();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add a comment" }));
    const field = screen.getByRole("textbox", { name: "Comment" });
    expect(field).not.toBeRequired();
    expect(field).toHaveFocus();
    fireEvent.change(field, { target: { value: "No" } });

    // Return turns the same field into the required reason, text intact.
    fireEvent.click(screen.getByTestId("hr-return"));
    expect(decide).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: /Reason for returning/ })).toBe(
      field,
    );
    expect(field).toBeRequired();
    expect(field).toHaveValue("No");
    fireEvent.click(screen.getByTestId("hr-return-confirm"));
    expect(
      await screen.findByText("Enter a reason for returning"),
    ).toBeInTheDocument();
    expect(field).toHaveValue("No");

    // Backing out of Return keeps the text visible as a comment.
    fireEvent.click(screen.getByTestId("hr-return-cancel"));
    expect(screen.getByRole("textbox", { name: "Comment" })).toBe(field);
    expect(field).toBeVisible();
    expect(field).toHaveValue("No");
    expect(
      screen.queryByText("Enter a reason for returning"),
    ).not.toBeInTheDocument();

    // Opening and closing the history changes nothing typed.
    const details = screen.getByRole("button", {
      name: "Details and history",
    });
    fireEvent.click(details);
    fireEvent.click(details);
    expect(field).toHaveValue("No");

    // The unsent text still holds navigation with the history collapsed.
    const leave = vi.fn();
    act(() => guardedNavigate(leave));
    expect(await screen.findByRole("dialog")).toHaveTextContent("not sent");
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(leave).not.toHaveBeenCalled();
    expect(field).toHaveValue("No");

    // A typed reason is sent as it stands; a refusal keeps it for a retry.
    fireEvent.change(field, { target: { value: "Not the right day" } });
    fireEvent.click(screen.getByTestId("hr-return"));
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith(
        expect.objectContaining({
          correctionId: "c1",
          expectedVersion: 1,
          decision: "RETURN",
          reason: "Not the right day",
        }),
      ),
    );
    expect(await screen.findByTestId("hr-write-refused")).toBeVisible();
    expect(field).toBeVisible();
    expect(field).toHaveValue("Not the right day");
  });

  it("works from the keyboard: the history toggle and the return reason", async () => {
    reviewDay();
    const decide = mutation(hrRefs.decideCorrection);
    decide.mockResolvedValue({
      ok: true,
      requestId: "m",
      value: { written: true, documentId: "c1", replayed: false },
    });
    const user = userEvent.setup();
    renderReview();
    const details = screen.getByRole("button", {
      name: "Details and history",
    });
    details.focus();
    await user.keyboard("{Enter}");
    expect(details).toHaveAttribute("aria-expanded", "true");
    await user.keyboard(" ");
    expect(details).toHaveAttribute("aria-expanded", "false");

    screen.getByTestId("hr-return").focus();
    await user.keyboard("{Enter}");
    // Focus lands in the revealed reason, ready to type.
    const reason = screen.getByRole("textbox", {
      name: /Reason for returning/,
    });
    expect(reason).toHaveFocus();
    await user.keyboard("Wrong date");
    await user.tab();
    expect(screen.getByTestId("hr-return-confirm")).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(decide).toHaveBeenCalledWith(
        expect.objectContaining({ decision: "RETURN", reason: "Wrong date" }),
      ),
    );
    expect(await screen.findByText("Returned")).toBeVisible();
  });

  it("keeps stale, locked, unlinked and nothing-to-decide states visible with their recovery", () => {
    reviewDay({
      corrections: [
        {
          id: "c1",
          status: "PENDING",
          proposedStartAt: at("2026-10-08", "08:29"),
          proposedEndAt: at("2026-10-08", "17:30"),
          reason: "Forgot to clock out",
          version: 1,
          stale: true,
          submittedAt: at("2026-10-08", "17:40"),
          submittedByName: "Somchai",
          history: [],
        },
      ],
    });
    const stale = renderReview();
    expect(screen.getByTestId("hr-certify")).toBeDisabled();
    expect(screen.getByTestId("hr-return")).toBeEnabled();
    expect(
      screen.getByText(
        "It cannot be certified. Return it so the employee can resubmit.",
      ),
    ).toBeVisible();
    stale.unmount();

    // Opened without a link focus: the lock and how to lift it still show.
    reviewDay({ locked: true }, false);
    const locked = renderReview();
    expect(screen.getByTestId("hr-review-locked")).toHaveTextContent(
      "HR must start a revision before changes",
    );
    expect(screen.getByTestId("hr-review-locked")).toBeVisible();
    expect(screen.queryByTestId("hr-certify")).not.toBeInTheDocument();
    expect(screen.getByText("This employee has no user account")).toBeVisible();
    locked.unmount();

    reviewDay({
      status: "IN_PROGRESS",
      issue: undefined,
      pendingCorrectionId: undefined,
      corrections: [],
    });
    renderReview();
    expect(screen.getByTestId("hr-review-nothing")).toBeVisible();
    // The recorded times are still shown once, outside the history.
    expect(screen.getByTestId("hr-review-recorded")).toHaveTextContent("08:29");
    expect(screen.getByTestId("hr-review-recorded")).toBeVisible();
  });
});

const row = (
  employeeId: string,
  businessDate: string,
  status: string,
  issue?: string,
) => ({
  employeeId,
  employeeCode: `EMP-${employeeId}`,
  employeeName: `Employee ${employeeId}`,
  businessDate,
  status,
  issue,
  disposition: status === "READY" ? "WORKED" : null,
  workedMinutes: status === "READY" ? 480 : 0,
  outsideShiftMinutes: 0,
});

function period(input: {
  readonly status: "DRAFT" | "CLOSED";
  readonly draftVersion: number;
  readonly latestClosedVersion: number;
  readonly versions: readonly number[];
  readonly view: Record<string, unknown>;
}) {
  state.queries.set(ref(hrRefs.periodPreview), {
    ok: true,
    requestId: "q",
    value: {
      ok: true,
      period: {
        id: "p1",
        siteCode: "HQ",
        siteName: "Head office",
        startDate: "2026-09-01",
        endDate: "2026-09-07",
        status: input.status,
        draftVersion: input.draftVersion,
        latestClosedVersion: input.latestClosedVersion,
        timezone: ZONE,
      },
      versions: input.versions.map((version) => ({
        id: `ver${version}`,
        version,
        closedAt: at("2026-09-08", "10:00"),
        totals: {},
      })),
      versionsComplete: true,
      view: input.view,
    },
  });
}

const draftView = (blocker: string | null, rows: readonly unknown[]) => ({
  kind: "DRAFT",
  blocker,
  fingerprint: "fp-1",
  totals: {
    employees: 2,
    days: rows.length,
    ready: rows.length - (blocker === null ? 0 : 1),
    exceptions: blocker === null ? 0 : 1,
    unfinished: 0,
    workedMinutes: 960,
    absentDays: 0,
    leaveDays: 0,
  },
  rows,
});

const closedView = (version: number) => ({
  kind: "CLOSED",
  versionId: `ver${version}`,
  version,
  closedAt: at("2026-09-08", "10:00"),
  totals: {
    employees: 2,
    days: 2,
    workedMinutes: 960,
    outsideShiftMinutes: 0,
    absentDays: 0,
    leaveDays: 0,
    nonworkingDays: 0,
  },
  rows: [row("A", "2026-09-02", "READY"), row("B", "2026-09-03", "READY")],
});

const renderPeriod = () =>
  renderWithIntl(
    <DraftGuardProvider>
      <HrPeriodDetailScreen periodId="p1" />
    </DraftGuardProvider>,
    { locale: "en" },
  );

describe("period next action", () => {
  it("sends a blocked draft to the open day in Review, with no close or draft export", () => {
    period({
      status: "DRAFT",
      draftVersion: 2,
      latestClosedVersion: 1,
      versions: [1],
      view: draftView("PERIOD_NOT_READY", [
        row("A", "2026-09-02", "READY"),
        row("B", "2026-09-03", "EXCEPTION", "MISSING_RECORD"),
      ]),
    });
    renderPeriod();
    expect(screen.getByTestId("hr-period-shown")).toHaveTextContent(
      "Draft · v2",
    );
    expect(screen.getByTestId("hr-period-blocker")).toHaveTextContent(
      "Cannot close yet: some days need review",
    );
    expect(screen.getByTestId("hr-period-review")).toHaveAttribute(
      "href",
      "/hr/review?employee=B&date=2026-09-03",
    );
    expect(screen.getByRole("link", { name: /Employee B/ })).toHaveAttribute(
      "href",
      "/hr/review?employee=B&date=2026-09-03",
    );
    expect(screen.queryByTestId("hr-period-close")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Export|Download/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Period steps" })).toBeNull();
  });

  it("closes a ready draft through one confirmation naming the version", async () => {
    period({
      status: "DRAFT",
      draftVersion: 2,
      latestClosedVersion: 1,
      versions: [1],
      view: draftView(null, [
        row("A", "2026-09-02", "READY"),
        row("B", "2026-09-03", "READY"),
      ]),
    });
    const close = mutation(hrRefs.closePeriod);
    close.mockResolvedValue({
      ok: true,
      requestId: "m",
      value: { written: true, documentId: "v2", replayed: false },
    });
    renderPeriod();
    expect(screen.queryByTestId("hr-period-blocker")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("hr-period-close"));
    expect(close).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm closing v2" }));
    await waitFor(() =>
      expect(close).toHaveBeenCalledWith(
        expect.objectContaining({
          periodId: "p1",
          expectedFingerprint: "fp-1",
        }),
      ),
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("shows and exports the linked earlier version, unchanged, beside a newer draft", async () => {
    state.params = new URLSearchParams("version=1");
    period({
      status: "DRAFT",
      draftVersion: 3,
      latestClosedVersion: 2,
      versions: [2, 1],
      view: closedView(1),
    });
    const exportCsv = mutation(hrRefs.exportCsv);
    exportCsv.mockResolvedValue({
      ok: true,
      requestId: "m",
      value: { written: true },
    });
    renderPeriod();
    // The version on screen is the one in the URL, and says so.
    expect(screen.getByTestId("hr-period-shown")).toHaveTextContent(
      "Closed · v1",
    );
    expect(screen.getByTestId("hr-period-earlier")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Show the current version" }),
    ).toBeVisible();
    // Its version list is already open, on the linked version.
    expect(screen.getByRole("button", { name: /Versions/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(
      screen.getByRole("combobox", { name: "Version shown" }),
    ).toBeVisible();
    // The one action exports exactly this version; it cannot be revised
    // or closed from here.
    fireEvent.click(screen.getByRole("button", { name: "Download CSV v1" }));
    await waitFor(() =>
      expect(exportCsv).toHaveBeenCalledWith(
        expect.objectContaining({ versionId: "ver1" }),
      ),
    );
    expect(screen.queryByTestId("hr-period-revise")).not.toBeInTheDocument();
    expect(screen.queryByTestId("hr-period-close")).not.toBeInTheDocument();
  });

  it("keeps the revision reason and its guard when the revision section is collapsed", async () => {
    period({
      status: "CLOSED",
      draftVersion: 2,
      latestClosedVersion: 2,
      versions: [2, 1],
      view: closedView(2),
    });
    renderPeriod();
    expect(screen.getByTestId("hr-period-shown")).toHaveTextContent(
      "Closed · v2",
    );
    expect(screen.queryByTestId("hr-period-earlier")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Download CSV v2" }),
    ).toBeEnabled();
    const toggle = screen.getByTestId("hr-period-revise");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    const reason = screen.getByRole("textbox", {
      name: /Reason for the revision/,
    });
    fireEvent.change(reason, { target: { value: "Late leave form" } });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(reason).not.toBeVisible();

    const leave = vi.fn();
    act(() => guardedNavigate(leave));
    expect(await screen.findByRole("dialog")).toHaveTextContent("not sent");
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(leave).not.toHaveBeenCalled();
    fireEvent.click(toggle);
    expect(reason).toBeVisible();
    expect(reason).toHaveValue("Late leave form");
    // The outside-shift caveat is said once, beside the figure it explains.
    expect(
      screen.getAllByText(
        "Outside-shift time is informational, not approved overtime.",
      ),
    ).toHaveLength(1);
  });
});

describe("settings sections", () => {
  function settings() {
    state.queries.set(ref(hrRefs.listHolidays), {
      ok: true,
      requestId: "q",
      value: { ok: true, complete: true, items: [] },
    });
    state.queries.set(ref(hrRefs.accessMembers), {
      ok: true,
      requestId: "q",
      value: { ok: true, provisioned: true, items: [] },
    });
  }
  const policy = () =>
    screen.getByRole("button", { name: "Pilot policy and export format" });

  it("opens the linked policy section before focus moves to it, on load and on Back/Forward", () => {
    settings();
    state.params = new URLSearchParams("section=policy");
    const view = renderWithIntl(<HrSettingsScreen />, {
      locale: "en",
      preserveProviders: true,
    });
    expect(policy()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("CSV v1 columns")).toBeVisible();
    const target = document.getElementById("hr-settings-policy");
    expect(target).toHaveFocus();
    expect(target).toContainElement(screen.getByText("CSV v1 columns"));

    // Forward to another section, then Back: it opens again by itself.
    state.params = new URLSearchParams("section=holidays");
    view.rerender(<HrSettingsScreen />);
    expect(policy()).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("hr-settings-holidays")).toHaveFocus();
    state.params = new URLSearchParams("section=policy");
    view.rerender(<HrSettingsScreen />);
    expect(policy()).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById("hr-settings-policy")).toHaveFocus();
  });

  it("keeps policy detail closed by default without unmounting the holiday form", () => {
    settings();
    renderWithIntl(<HrSettingsScreen />, { locale: "en" });
    expect(policy()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("CSV v1 columns")).not.toBeVisible();
    const name = screen.getByRole("textbox", { name: /Name or reason/ });
    fireEvent.change(name, { target: { value: "Founders day" } });
    fireEvent.click(policy());
    expect(screen.getByText("CSV v1 columns")).toBeVisible();
    fireEvent.click(policy());
    expect(screen.getByRole("textbox", { name: /Name or reason/ })).toBe(name);
    expect(name).toHaveValue("Founders day");
  });
});

describe("today", () => {
  function today(overrides: Record<string, unknown> = {}) {
    state.queries.set(ref(hrRefs.today), {
      ok: true,
      requestId: "q",
      value: {
        timezone: ZONE,
        today: "2026-10-09",
        now: at("2026-10-09", "08:20"),
        state: "CLOCKED_IN",
        employee: {
          id: "e1",
          code: "EMP-001",
          displayName: "Somchai",
          status: "ACTIVE",
          site: { id: "w1", code: "HQ", name: "Head office" },
        },
        businessDate: "2026-10-09",
        plan,
        clockInAt: at("2026-10-09", "08:23"),
        nextAction: "CLOCK_OUT",
        corrections: [],
        ...overrides,
      },
    });
  }

  it("leads with the state, recorded times and next action, with the result beside the action", async () => {
    today();
    mutation(hrRefs.clockOut).mockRejectedValue(new Error("Connection lost"));
    renderWithIntl(<HrTodayScreen />, { locale: "en" });
    const action = screen.getByRole("button", { name: "Clock out" });
    expect(screen.getByTestId("hr-today-state")).toHaveTextContent(
      "Clocked in",
    );
    expect(screen.getByTestId("hr-today-in")).toHaveTextContent("08:23");
    expect(screen.getByTestId("hr-today-out")).toHaveTextContent("--:--");
    expect(follows(screen.getByTestId("hr-today-out"), action)).toBe(true);
    // Secondary plan detail comes after the action, not before it.
    expect(follows(action, screen.getByText("Planned shift"))).toBe(true);
    fireEvent.click(action);
    const group = screen.getByTestId("hr-today-action");
    expect(
      await within(group).findByTestId("hr-write-uncertain"),
    ).toBeVisible();
    expect(
      within(group).getByRole("button", { name: "Try again safely" }),
    ).toBeVisible();
  });

  it("offers the correction for an open earlier day as the one clear action", () => {
    today({
      state: "UNRESOLVED_OPEN",
      nextAction: "NONE",
      clockInAt: undefined,
      openDay: {
        businessDate: "2026-10-08",
        clockInAt: at("2026-10-08", "08:29"),
        pendingCorrection: false,
      },
    });
    renderWithIntl(<HrTodayScreen />, { locale: "en" });
    expect(screen.queryByTestId("hr-clock-action")).not.toBeInTheDocument();
    const link = within(screen.getByTestId("hr-today-action")).getByRole(
      "link",
      { name: "Request a correction" },
    );
    expect(link).toHaveAttribute(
      "href",
      "/hr/time/2026-10-08?focus=correction",
    );
    expect(
      within(screen.getByTestId("hr-open-day")).getByText(/08:29/),
    ).toBeVisible();
  });
});
