/**
 * Kiro diagnostic probes (UI). Each test asserts the EXPECTED behaviour; a
 * failure on current source is evidence of the defect. Convex is mocked as a
 * map of query results, following src/features/hr/EmployeesNavigation.test.tsx.
 *
 * Run: pnpm exec vitest run --config docs/reviews/daily-bug-search-2026-10-13/expanded/kiro/vitest.config.mts hr-ui
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { useSyncExternalStore, type ComponentProps } from "react";
import { beforeEach, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";

const state = vi.hoisted(() => ({
  queries: new Map<string, unknown>(),
  mutate: vi.fn(),
}));
vi.mock("convex/react", async () => {
  const { getFunctionName: name } = await import("convex/server");
  return {
    useQuery: (reference: Parameters<typeof name>[0], args: unknown) =>
      args === "skip" ? undefined : state.queries.get(name(reference)),
    useMutation: () => state.mutate,
  };
});
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => ({
    status: "READY",
    permissions: [
      "hr.self.access",
      "hr.team.review",
      "hr.admin.manage",
      "hr.period.close",
      "hr.period.export",
    ],
    timezoneSupported: true,
    timezone: "Asia/Bangkok",
    today: "2026-10-13",
    identityKey: "kiro-org:kiro-user",
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
import { trackAppHistory } from "@/lib/browser/appHistory";
import { hrRefs } from "@/lib/convex/hrApi";
import { HrEmployeesScreen } from "@/features/hr/EmployeesScreen";
import { HrPeriodDetailScreen } from "@/features/hr/PeriodDetailScreen";

const employee = (version: number, supervisorName?: string) => ({
  id: "e7",
  code: "EMP-007",
  displayName: "Somsak",
  status: "ACTIVE",
  siteId: "w1",
  siteCode: "HQ",
  linkedActive: false,
  employmentStartDate: "2026-01-05",
  ...(supervisorName ? { supervisorName } : {}),
  version,
});

beforeEach(() => {
  state.queries.clear();
  state.mutate.mockReset();
  window.sessionStorage.clear();
  window.history.replaceState({ appNavigationIndex: 0 }, "", "/en/hr/today");
  trackAppHistory();
});

it("KIRO-10 an unsaved employee edit survives another admin's save of the same record", async () => {
  state.queries.set(getFunctionName(hrRefs.listEmployees), {
    ok: true,
    value: { items: [employee(4)], complete: true },
  });
  state.queries.set(getFunctionName(hrRefs.employee), {
    ok: true,
    value: { ok: true, employee: employee(4) },
  });
  state.queries.set(getFunctionName(hrRefs.memberOptions), {
    ok: true,
    value: { ok: true, items: [] },
  });
  window.history.pushState({}, "", "/en/hr/employees");
  const page = () => (
    <DraftGuardProvider>
      <main>
        <HrEmployeesScreen />
      </main>
    </DraftGuardProvider>
  );
  const view = renderWithIntl(page(), {
    locale: "en",
    workspace: false,
    preserveProviders: true,
  });
  fireEvent.click(screen.getAllByRole("button", { name: /Edit.*Somsak/ })[0]!);
  const form = await screen.findByTestId("hr-employee-form");
  const name = within(form).getByDisplayValue("Somsak");
  fireEvent.change(name, {
    target: { value: "Somsak Jaidee (typed, unsaved)" },
  });
  expect(
    within(form).getByDisplayValue("Somsak Jaidee (typed, unsaved)"),
  ).toBeTruthy();

  // Another administrator saves the same employee: the live query moves to v5.
  state.queries.set(getFunctionName(hrRefs.employee), {
    ok: true,
    value: { ok: true, employee: employee(5) },
  });
  view.rerender(page());
  const after = await screen.findByTestId("hr-employee-form");
  const typedStillThere =
    within(after).queryByDisplayValue("Somsak Jaidee (typed, unsaved)") !==
    null;
  console.info("KIRO-10 evidence", {
    typedStillThere,
    nameField: (within(after).getAllByRole("textbox")[1] as HTMLInputElement)
      .value,
    promptShown: screen.queryByRole("alertdialog") !== null,
  });
  expect(typedStillThere).toBe(true);
});

it("KIRO-11 the draft period work list shows every unresolved exception (or says it is cut)", async () => {
  const plan = {
    kind: "SCHEDULED",
    startAt: 0,
    endAt: 0,
    startTime: "08:30",
    endTime: "17:30",
    endsNextDay: false,
    breakMinutes: 60,
  };
  // 12 employees x the 18 remaining days of the period (14-31 Oct), then one
  // past MISSING_RECORD exception for the 13th employee (rows sort by code).
  const rows: unknown[] = [];
  for (let e = 1; e <= 12; e += 1)
    for (let d = 14; d <= 31; d += 1)
      rows.push({
        employeeId: `e${e}`,
        employeeCode: `EMP-${String(e).padStart(3, "0")}`,
        employeeName: `Worker ${e}`,
        businessDate: `2026-10-${d}`,
        plan,
        workedMinutes: 0,
        outsideShiftMinutes: 0,
        status: "UPCOMING",
        disposition: null,
      });
  rows.push({
    employeeId: "e13",
    employeeCode: "EMP-013",
    employeeName: "Worker thirteen",
    businessDate: "2026-10-05",
    plan,
    workedMinutes: 0,
    outsideShiftMinutes: 0,
    status: "EXCEPTION",
    issue: "MISSING_RECORD",
    disposition: null,
  });
  state.queries.set(getFunctionName(hrRefs.periodPreview), {
    ok: true,
    value: {
      ok: true,
      period: {
        id: "p1",
        siteCode: "HQ",
        siteName: "Head office",
        startDate: "2026-10-01",
        endDate: "2026-10-31",
        status: "DRAFT",
        draftVersion: 1,
        latestClosedVersion: 0,
        timezone: "Asia/Bangkok",
        timezoneSupported: true,
        today: "2026-10-13",
      },
      versions: [],
      versionsComplete: true,
      view: {
        kind: "DRAFT",
        totals: {
          employees: 13,
          days: rows.length,
          ready: 0,
          exceptions: 1,
          unfinished: rows.length - 1,
          workedMinutes: 0,
          outsideShiftMinutes: 0,
          absentDays: 0,
          leaveDays: 0,
          nonworkingDays: 0,
        },
        blocker: "PERIOD_INCLUDES_FUTURE",
        fingerprint: "kiro",
        rows,
      },
    },
  });
  window.history.pushState({}, "", "/en/hr/periods/p1");
  renderWithIntl(
    <DraftGuardProvider>
      <main>
        <HrPeriodDetailScreen periodId="p1" />
      </main>
    </DraftGuardProvider>,
    { locale: "en", workspace: false },
  );
  const heading = await screen.findByRole("heading", {
    name: /days still open/i,
  });
  const section = heading.closest("section")!;
  const listed = within(section).getAllByRole("listitem");
  const exceptionListed = section.textContent?.includes("EMP-013") ?? false;
  console.info("KIRO-11 evidence", {
    unresolvedRows: rows.length,
    listed: listed.length,
    exceptionListed,
  });
  await waitFor(() => expect(exceptionListed).toBe(true));
});
