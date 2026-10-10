import {
  act,
  fireEvent,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";

const ZONE = "Asia/Bangkok";
const at = (date: string, hhmm: string) =>
  Date.parse(`${date}T${hhmm}:00+07:00`);

const state = vi.hoisted(() => ({
  queries: new Map<string, unknown>(),
  mutations: new Map<string, ReturnType<typeof vi.fn>>(),
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
  Link: ({ href, children }: { href: string; children: unknown }) => (
    <a href={href}>{children as never}</a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { DraftGuardProvider } from "@/components/providers/DraftGuardProvider";
import { hrRefs } from "@/lib/convex/hrApi";
import { EmployeeForm } from "./EmployeeForm";
import { HrPeriodDetailScreen } from "./PeriodDetailScreen";
import { rangeFor } from "./ReviewScreen";
import { ReviewDetail } from "./ReviewDetail";
import { useHrWrite } from "./useHrWrite";

const ref = (reference: Parameters<typeof getFunctionName>[0]) =>
  getFunctionName(reference);
const mutation = (reference: Parameters<typeof getFunctionName>[0]) => {
  const key = ref(reference);
  if (!state.mutations.has(key)) state.mutations.set(key, vi.fn());
  return state.mutations.get(key)!;
};

beforeEach(() => {
  state.queries.clear();
  state.mutations.clear();
  state.access.identityKey = "org-a:user-a";
  window.sessionStorage.clear();
});

describe("re-reviewing a certified unlinked day (HR-033, HR-042)", () => {
  function certifiedDay() {
    state.queries.set(ref(hrRefs.reviewDayDetail), {
      ok: true,
      requestId: "q",
      value: {
        ok: true,
        timezone: ZONE,
        today: "2026-10-09",
        employee: {
          id: "e2",
          code: "EMP-002",
          displayName: "Wipa",
          linked: false,
          siteCode: "HQ",
          siteName: "Head office",
        },
        detail: {
          employeeId: "e2",
          businessDate: "2026-09-25",
          revision: 2,
          plan: {
            kind: "SCHEDULED",
            startAt: at("2026-09-25", "08:30"),
            endAt: at("2026-09-25", "17:30"),
            startTime: "08:30",
            endTime: "17:30",
            endsNextDay: false,
            breakMinutes: 60,
          },
          status: "READY",
          disposition: "LEAVE",
          workedMinutes: 0,
          outsideShiftMinutes: 0,
          locked: false,
          events: [],
          certification: {
            disposition: "LEAVE",
            reason: "Paper leave form",
            decidedAt: at("2026-09-26", "09:00"),
            decidedByName: "Reviewer",
            current: true,
          },
          priorCertifications: [
            {
              disposition: "ABSENT",
              reason: "No show reported",
              decidedAt: at("2026-09-25", "18:00"),
              decidedByName: "Supervisor",
            },
          ],
          corrections: [],
        },
      },
    });
  }

  it("shows the business date first, keeps prior decisions visible, and sends a reasoned stale-checked edit", async () => {
    certifiedDay();
    const dispose = mutation(hrRefs.disposeDay);
    dispose.mockResolvedValue({
      ok: true,
      requestId: "m",
      value: { written: true, documentId: "d", replayed: false },
    });
    renderWithIntl(<ReviewDetail employeeId="e2" businessDate="2026-09-25" />, {
      locale: "en",
    });
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: /Friday, 25 September 2026/,
      }),
    ).toHaveTextContent("Wipa · EMP-002");
    // The current certification stays in the decision flow; earlier
    // decisions are read-only history, one labelled step away.
    expect(
      screen.getByText("Certified as leave recorded elsewhere"),
    ).toBeVisible();
    expect(screen.getByText("Reason: Paper leave form")).toBeVisible();
    expect(screen.getByTestId("hr-prior-decisions")).not.toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Details and history" }),
    );
    expect(screen.getByTestId("hr-prior-decisions")).toBeVisible();
    expect(screen.getByTestId("hr-prior-decisions")).toHaveTextContent(
      "No show reported",
    );
    expect(screen.getByTestId("hr-prior-decisions")).toHaveTextContent(
      "Supervisor",
    );
    expect(screen.queryByTestId("hr-dispose-submit")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review again" }));
    fireEvent.click(screen.getByTestId("hr-dispose-submit"));
    expect(
      await screen.findByText("Enter a reason of at least 3 characters"),
    ).toBeInTheDocument();
    expect(dispose).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: /Reason/ }), {
      target: { value: "Register shows a worked day" },
    });
    fireEvent.click(screen.getByTestId("hr-dispose-submit"));
    await waitFor(() =>
      expect(dispose).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId: "e2",
          businessDate: "2026-09-25",
          expectedRevision: 2,
          disposition: "LEAVE",
          reason: "Register shows a worked day",
        }),
      ),
    );
  });

  it("shows no edit control for a locked (closed) day", () => {
    certifiedDay();
    const outcome = state.queries.get(ref(hrRefs.reviewDayDetail)) as {
      value: { detail: Record<string, unknown> };
    };
    outcome.value.detail.locked = true;
    renderWithIntl(<ReviewDetail employeeId="e2" businessDate="2026-09-25" />, {
      locale: "en",
    });
    expect(
      screen.queryByRole("button", { name: "Review again" }),
    ).not.toBeInTheDocument();
  });
});

describe("older closed versions stay selectable (HR-042)", () => {
  it("offers a bounded version number picker beyond the listed versions", async () => {
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
          status: "CLOSED",
          draftVersion: 60,
          latestClosedVersion: 60,
          timezone: ZONE,
        },
        versions: Array.from({ length: 50 }, (_, index) => ({
          id: `v${60 - index}`,
          version: 60 - index,
          closedAt: at("2026-09-08", "10:00"),
          totals: {},
        })),
        versionsComplete: false,
        view: {
          kind: "CLOSED",
          versionId: "v60",
          version: 60,
          closedAt: at("2026-09-08", "10:00"),
          totals: {
            employees: 0,
            days: 0,
            workedMinutes: 0,
            outsideShiftMinutes: 0,
            absentDays: 0,
            leaveDays: 0,
            nonworkingDays: 0,
          },
          rows: [],
        },
      },
    });
    renderWithIntl(<HrPeriodDetailScreen periodId="p1" />, { locale: "en" });
    // The shown version is named; the others are one labelled step away.
    expect(screen.getByTestId("hr-period-shown")).toHaveTextContent(
      "Closed · v60",
    );
    fireEvent.click(screen.getByRole("button", { name: /Versions/ }));
    const input = screen.getByRole("spinbutton", {
      name: "Open version number",
    });
    expect(
      screen.getByText("The list shows the newest 50; versions 1–60 exist"),
    ).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "61" } });
    fireEvent.click(screen.getByRole("button", { name: "Open version" }));
    expect(
      await screen.findByText("Enter a version from 1 to 60"),
    ).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Open version" }));
    await waitFor(() =>
      expect(
        screen.queryByText("Enter a version from 1 to 60"),
      ).not.toBeInTheDocument(),
    );
  });

  it("keeps a typed revision reason when another version is opened, unless discarded", async () => {
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
          status: "CLOSED",
          draftVersion: 60,
          latestClosedVersion: 60,
          timezone: ZONE,
        },
        versions: Array.from({ length: 50 }, (_, index) => ({
          id: `v${60 - index}`,
          version: 60 - index,
          closedAt: at("2026-09-08", "10:00"),
          totals: {},
        })),
        versionsComplete: false,
        view: {
          kind: "CLOSED",
          versionId: "v60",
          version: 60,
          closedAt: at("2026-09-08", "10:00"),
          totals: {
            employees: 0,
            days: 0,
            workedMinutes: 0,
            outsideShiftMinutes: 0,
            absentDays: 0,
            leaveDays: 0,
            nonworkingDays: 0,
          },
          rows: [],
        },
      },
    });
    renderWithIntl(
      <DraftGuardProvider>
        <HrPeriodDetailScreen periodId="p1" />
      </DraftGuardProvider>,
      { locale: "en" },
    );
    fireEvent.click(screen.getByTestId("hr-period-revise"));
    const reason = screen.getByRole("textbox", {
      name: /Reason for the revision/,
    });
    fireEvent.change(reason, { target: { value: "Late leave form" } });
    fireEvent.click(screen.getByRole("button", { name: /Versions/ }));
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Open version number" }),
      { target: { value: "3" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Open version" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("not sent");
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(reason).toHaveValue("Late leave form");
  });

  it("lets closed history open while the live timezone is unsupported", () => {
    state.access.timezoneSupported = false;
    state.access.timezone = "Europe/London";
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
          status: "DRAFT",
          draftVersion: 2,
          latestClosedVersion: 1,
          timezone: "Europe/London",
        },
        versions: [
          {
            id: "v1",
            version: 1,
            closedAt: at("2026-09-08", "10:00"),
            totals: {},
          },
        ],
        versionsComplete: true,
        view: { kind: "TIMEZONE_UNSUPPORTED" },
      },
    });
    renderWithIntl(<HrPeriodDetailScreen periodId="p1" />, { locale: "en" });
    expect(screen.getByTestId("hr-timezone-unsupported")).toBeInTheDocument();
    expect(screen.getByTestId("hr-period-timezone")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Version shown" }),
    ).toBeInTheDocument();
    state.access.timezoneSupported = true;
    state.access.timezone = ZONE;
  });
});

describe("employee change history labels (HR-052)", () => {
  it("uses human labels and never prints internal identifiers", () => {
    state.queries.set(ref(hrRefs.memberOptions), {
      ok: true,
      requestId: "q",
      value: { ok: true, items: [] },
    });
    state.queries.set(ref(hrRefs.employeeHistory), {
      ok: true,
      requestId: "q",
      value: {
        ok: true,
        complete: false,
        items: [
          {
            at: at("2026-10-01", "09:00"),
            action: "hr.employee.save",
            actorName: "HR admin",
            changes: [
              { field: "displayName", from: '"Somchai"', to: '"Somchai J."' },
              {
                field: "supervisorUserId",
                from: '"user_internal_1"',
                to: '"user_internal_2"',
              },
              { field: "status", from: '"ACTIVE"', to: '"INACTIVE"' },
            ],
          },
        ],
      },
    });
    renderWithIntl(
      <EmployeeForm
        employee={{
          id: "e1",
          code: "EMP-001",
          displayName: "Somchai J.",
          status: "INACTIVE",
          siteId: "w1",
          employmentStartDate: "2026-01-01",
          version: 3,
        }}
        sites={[{ id: "w1", code: "HQ", name: "Head office" }]}
        today="2026-10-09"
        onDone={() => undefined}
      />,
      { locale: "en" },
    );
    const history = screen.getByTestId("hr-employee-history");
    expect(history).toHaveTextContent("Display name: Somchai → Somchai J.");
    expect(history).toHaveTextContent("Supervisor changed");
    expect(history).toHaveTextContent("Status: Active → Inactive");
    expect(history).not.toHaveTextContent("supervisorUserId");
    expect(history).not.toHaveTextContent("user_internal");
    expect(history).toHaveTextContent(
      "1 change shown, the newest; older history exists",
    );
  });
});

describe("write intent isolation (HR-022, HR-023)", () => {
  it("does not let a normal submit overwrite an uncertain command, and isolates identities", async () => {
    const sent: { id: string; payload: string }[] = [];
    const hook = renderHook(() => useHrWrite("form:x"));
    await act(async () => {
      await hook.result.current.submit(async (requestId) => {
        sent.push({ id: requestId, payload: "original" });
        throw new Error("lost");
      });
    });
    expect(hook.result.current.state.kind).toBe("UNCERTAIN");
    expect(hook.result.current.locked).toBe(true);
    await act(async () => {
      await hook.result.current.submit(async (requestId) => {
        sent.push({ id: requestId, payload: "edited" });
        return { ok: true, value: { written: true } };
      });
    });
    expect(sent.map((entry) => entry.payload)).toEqual([
      "original",
      "original",
    ]);
    expect(sent[1]!.id).toBe(sent[0]!.id);

    // Another signed-in account never reuses the first account's cached ID.
    const first = renderHook(() => useHrWrite("form:y"));
    const ids: string[] = [];
    await act(async () => {
      await first.result.current.submit(async (requestId) => {
        ids.push(requestId);
        throw new Error("lost");
      });
    });
    first.unmount();
    state.access.identityKey = "org-a:user-b";
    const second = renderHook(() => useHrWrite("form:y"));
    await act(async () => {
      await second.result.current.submit(async (requestId) => {
        ids.push(requestId);
        return { ok: true, value: { written: true } };
      });
    });
    expect(ids[1]).not.toBe(ids[0]);
  });

  it("returns IDLE for a late result after the intent changed, so callers skip post-processing", async () => {
    let finish: (value: unknown) => void = () => undefined;
    const hook = renderHook(({ intent }) => useHrWrite(intent), {
      initialProps: { intent: "employee:a" },
    });
    let result: Promise<{ kind: string }> | undefined;
    act(() => {
      result = hook.result.current.submit(
        () => new Promise((resolve) => (finish = resolve)),
      );
    });
    hook.rerender({ intent: "employee:b" });
    await act(async () => {
      finish({ ok: true, value: { written: true } });
      await result;
    });
    expect((await result!).kind).toBe("IDLE");
  });
});

describe("review queue tabs (round 2 polish)", () => {
  it("shows a tab-specific count and drops a selection absent from the new tab", async () => {
    const { HrReviewScreen } = await import("./ReviewScreen");
    const item = (employeeId: string, certified: boolean) => ({
      employeeId,
      employeeCode: `EMP-${employeeId}`,
      employeeName: `Employee ${employeeId}`,
      siteCode: "HQ",
      businessDate: "2026-10-08",
      status: certified ? "READY" : "EXCEPTION",
      issue: certified ? undefined : "MISSING_RECORD",
      disposition: certified ? "ABSENT" : null,
      revision: certified ? 1 : 0,
      certified,
    });
    state.queries.set(ref(hrRefs.queue), {
      ok: true,
      requestId: "q",
      value: {
        ok: true,
        complete: true,
        today: "2026-10-09",
        items: [item("A", false), item("B", false), item("C", true)],
      },
    });
    renderWithIntl(<HrReviewScreen />, { locale: "en" });
    expect(screen.getByText("2 items need review")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Employee A/ }));
    expect(
      screen.getByRole("button", { name: /Employee A/, pressed: true }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Certified/ }));
    expect(screen.getByText("1 certified item")).toBeInTheDocument();
    expect(screen.queryByText("2 items need review")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Back to the list/ }),
    ).not.toBeInTheDocument();
    // The employee code stays fully visible in a queue card.
    expect(screen.getByText("EMP-C")).toBeInTheDocument();
  });
});

describe("review window for a linked day", () => {
  it("never builds an inverted queue range, even for a future linked date", () => {
    const today = "2026-10-09";
    expect(rangeFor(today, undefined)).toEqual({
      from: "2026-09-26",
      to: today,
    });
    // Inside the default window: unchanged.
    expect(rangeFor(today, "2026-10-01")).toEqual({
      from: "2026-09-26",
      to: today,
    });
    // Earlier: the window moves back to contain it.
    expect(rangeFor(today, "2026-08-01")).toEqual({
      from: "2026-08-01",
      to: "2026-08-14",
    });
    // Future (a hand-edited link): the default window, never from > to.
    for (const date of ["2026-10-10", "2027-01-01"]) {
      const range = rangeFor(today, date);
      expect(range).toEqual({ from: "2026-09-26", to: today });
      expect(range.from <= range.to).toBe(true);
    }
  });
});
