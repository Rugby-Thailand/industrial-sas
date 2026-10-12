import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";
import { chooseOption } from "@tests/fixtures/select-control";

/**
 * Paged HR lists in the browser: page navigation, criteria resets, scan
 * continuation, loading/empty states and restoring position and filters
 * from history (Back to the list, reload).
 */

const state = vi.hoisted(() => ({
  query: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
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
    sites: [
      { id: "w1", code: "HQ", name: "Head office" },
      { id: "w2", code: "BR", name: "Branch" },
    ],
    identityKey: "org-a:user-a:not-linked",
  } as Record<string, unknown>,
}));

vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) =>
    args === "skip" ? undefined : state.query(getFunctionName(ref), args),
  useMutation: () => vi.fn(),
}));
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => state.access,
  useHrCan: (code: string) =>
    (state.access.permissions as string[]).includes(code),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: ComponentProps<"a">) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: state.push, replace: state.replace }),
  usePathname: () => "/hr/employees",
}));
// Next keeps `useSearchParams` in step with native history writes.
vi.mock("next/navigation", async (original) => ({
  ...((await original()) as object),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { HrEmployeesScreen } from "./EmployeesScreen";
import { HrPeriodDetailScreen } from "./PeriodDetailScreen";

const envelope = (value: unknown) => ({ ok: true, requestId: "q", value });
const employee = (index: number) => ({
  id: `e${index}`,
  code: `EMP-${String(index).padStart(3, "0")}`,
  displayName: `Employee ${index}`,
  status: "ACTIVE",
  siteId: "w1",
  siteCode: "HQ",
  linkedActive: false,
  employmentStartDate: "2026-01-01",
  version: 1,
});
const ready = (page: unknown[], continueCursor = "") => ({
  ok: true,
  status: "ready",
  page,
  isDone: continueCursor === "",
  continueCursor,
  scanned: page.length,
  sitesComplete: true,
});

type Args = {
  pageSize?: number;
  cursor?: string;
  scanCursor?: string;
  search?: string;
  warehouseId?: string;
  status?: string;
};
const employeeCalls = () =>
  state.query.mock.calls
    .filter(([name]) => name === "hr/setup:employeesPage")
    .map(([, args]) => args as Args);

/** A registry of 45 employees served in cursor pages, with search. */
function registry() {
  const all = Array.from({ length: 45 }, (_, index) => employee(index));
  state.query.mockImplementation((name: string, args: Args) => {
    if (name !== "hr/setup:employeesPage") return undefined;
    const matching = all.filter(
      (row) =>
        args.search === undefined ||
        row.displayName.toLowerCase().includes(args.search.toLowerCase()),
    );
    const size = args.pageSize ?? 20;
    const start = args.cursor === undefined ? 0 : Number(args.cursor);
    const next = start + size;
    return envelope(
      ready(
        matching.slice(start, next),
        next < matching.length ? String(next) : "",
      ),
    );
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  state.query.mockReset();
  state.push.mockReset();
  state.replace.mockReset();
  window.history.replaceState(null, "", "/en/hr/employees");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("employee registry pages", () => {
  it("moves through pages, resets on criteria and page size, and shows the page", () => {
    registry();
    renderWithIntl(<HrEmployeesScreen />, { locale: "en" });
    expect(employeeCalls().at(-1)).toEqual({ pageSize: 20 });
    expect(screen.getByText("20 employees on this page")).toBeInTheDocument();
    const pager = screen.getByRole("navigation", {
      name: "Employee list pages",
    });
    expect(within(pager).getByText("Page 1")).toBeInTheDocument();
    expect(
      within(pager).getByRole("button", { name: "Previous page" }),
    ).toBeDisabled();

    fireEvent.click(within(pager).getByRole("button", { name: "Next page" }));
    expect(employeeCalls().at(-1)).toEqual({ pageSize: 20, cursor: "20" });
    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: "Employee list pages" }),
      ).getByRole("button", { name: "Next page" }),
    );
    expect(employeeCalls().at(-1)).toEqual({ pageSize: 20, cursor: "40" });
    expect(screen.getByText("5 employees on this page")).toBeInTheDocument();
    expect(screen.getAllByText("Employee 44").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();

    // A search covers the whole registry and starts again at page 1.
    fireEvent.change(screen.getByLabelText("Search employees"), {
      target: { value: "employee 4" },
    });
    act(() => vi.advanceTimersByTime(300));
    expect(employeeCalls().at(-1)).toEqual({
      pageSize: 20,
      search: "employee 4",
    });
    expect(window.location.search).toBe("?q=employee+4");
    expect(screen.getByText("6 employees on this page")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search employees"), {
      target: { value: "" },
    });
    act(() => vi.advanceTimersByTime(300));
    expect(window.location.search).toBe("");
    expect(employeeCalls().at(-1)).toEqual({ pageSize: 20 });
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(employeeCalls().at(-1)).toEqual({ pageSize: 20, cursor: "20" });
    // A page-size change starts again at page 1 with the new size; the
    // endpoint's sizes are offered, never the generic 100.
    chooseOption("Records per page", "50");
    expect(employeeCalls().at(-1)).toEqual({ pageSize: 50 });
    expect(screen.getByText("45 employees on this page")).toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: "Employee list pages" }),
    ).toBeNull();
  });

  it("offers only the page sizes the HR endpoints accept", async () => {
    registry();
    renderWithIntl(<HrEmployeesScreen />, { locale: "en" });
    const { selectOptionLabels } =
      await import("@tests/fixtures/select-control");
    expect(selectOptionLabels("Records per page")).toEqual(["20", "50"]);
  });

  it("restores the filtered page after leaving and coming Back", () => {
    registry();
    window.history.replaceState(null, "", "/en/hr/employees?q=employee");
    const first = renderWithIntl(<HrEmployeesScreen />, { locale: "en" });
    expect(screen.getByLabelText("Search employees")).toHaveValue("employee");
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(employeeCalls().at(-1)).toEqual({
      pageSize: 20,
      search: "employee",
      cursor: "20",
    });
    first.unmount();
    state.query.mockClear();
    // Back to the same history entry: same criteria (URL) and page (state).
    renderWithIntl(<HrEmployeesScreen />, { locale: "en" });
    expect(employeeCalls()[0]).toEqual({
      pageSize: 20,
      search: "employee",
      cursor: "20",
    });
    expect(screen.getByText("Page 2")).toBeInTheDocument();
  });

  it("keeps the list criteria in the editor URL and on close", () => {
    registry();
    window.history.replaceState(
      null,
      "",
      "/en/hr/employees?q=employee+1&site=w1",
    );
    renderWithIntl(<HrEmployeesScreen />, { locale: "en" });
    fireEvent.click(
      screen.getAllByRole("button", { name: "Edit Employee 1" })[0]!,
    );
    expect(state.push).toHaveBeenCalledWith(
      "/hr/employees?employee=e1&mode=edit&q=employee+1&site=w1",
      { scroll: false },
    );
  });

  it("follows scan continuations, then distinguishes no matches from an empty registry", () => {
    state.query.mockImplementation((name: string, args: Args) => {
      if (name !== "hr/setup:employeesPage") return undefined;
      if (args.search === undefined) return envelope(ready([]));
      return args.scanCursor === undefined
        ? envelope({
            ok: true,
            status: "scanning",
            page: [],
            isDone: false,
            continueCursor: "",
            scanCursor: "s1",
            scanned: 99,
          })
        : envelope(ready([]));
    });
    renderWithIntl(<HrEmployeesScreen />, { locale: "en" });
    expect(screen.getByText("No employees yet")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search employees"), {
      target: { value: "nobody" },
    });
    act(() => vi.advanceTimersByTime(300));
    // The empty registry page is not reused for another search.
    expect(employeeCalls().at(-1)).toEqual({
      pageSize: 20,
      search: "nobody",
      scanCursor: "s1",
    });
    expect(screen.getByText("No matching employees")).toBeInTheDocument();
    fireEvent.click(
      screen.getAllByRole("button", { name: "Clear filters" })[0]!,
    );
    expect(employeeCalls().at(-1)).toEqual({ pageSize: 20 });
  });

  it("shows a loading state and a server refusal", () => {
    state.query.mockReturnValue(undefined);
    const view = renderWithIntl(<HrEmployeesScreen />, { locale: "en" });
    expect(screen.getByText("Loading records…")).toBeInTheDocument();
    view.unmount();
    state.query.mockReturnValue(
      envelope({ ok: false, code: "SITE_UNAVAILABLE" }),
    );
    renderWithIntl(<HrEmployeesScreen />, { locale: "en" });
    expect(screen.getByTestId("hr-error")).toHaveTextContent(
      "The site is unavailable or outside your scope",
    );
  });
});

describe("period open days", () => {
  it("pages every open day beyond the former 200 while totals cover them all", () => {
    const rows = Array.from({ length: 230 }, (_, index) => ({
      employeeId: `e${index % 10}`,
      employeeCode: `EMP-${index % 10}`,
      employeeName: `Employee ${index % 10}`,
      businessDate: `2026-09-${String((index % 23) + 1).padStart(2, "0")}#${index}`,
      plan: { kind: "NONWORKING", reason: "NO_SCHEDULE" },
      workedMinutes: 0,
      outsideShiftMinutes: 0,
      status: "EXCEPTION",
      issue: "MISSING_RECORD",
      disposition: null,
    }));
    state.query.mockImplementation((name: string) =>
      name === "hr/periods:preview"
        ? envelope({
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
              timezoneSupported: true,
              today: "2026-10-09",
            },
            versions: [],
            versionsComplete: true,
            view: {
              kind: "DRAFT",
              totals: {
                employees: 10,
                days: 230,
                workedMinutes: 0,
                outsideShiftMinutes: 0,
                absentDays: 0,
                leaveDays: 0,
                nonworkingDays: 0,
                exceptions: 230,
              },
              blocker: "PERIOD_NOT_READY",
              fingerprint: "f",
              rows,
            },
          })
        : undefined,
    );
    renderWithIntl(<HrPeriodDetailScreen periodId="p1" />, { locale: "en" });
    const section = screen.getByRole("region", { name: "Days still open" });
    expect(
      within(section).getByText("230 days still open"),
    ).toBeInTheDocument();
    expect(within(section).getAllByRole("listitem")).toHaveLength(20);
    const pager = within(section).getByRole("navigation", {
      name: "Open day pages",
    });
    expect(within(pager).getByText("1–20 of 230")).toBeInTheDocument();
    // Every open day is reachable, including the last one beyond 200.
    chooseOption("Records per page", "50");
    for (let page = 1; page < 5; page += 1)
      fireEvent.click(
        within(section).getByRole("button", { name: "Next page" }),
      );
    expect(within(section).getByText("201–230 of 230")).toBeInTheDocument();
    expect(within(section).getAllByRole("listitem")).toHaveLength(30);
    expect(
      within(section).getByRole("button", { name: "Next page" }),
    ).toBeDisabled();
    expect(within(section).getByText(/#229/)).toBeInTheDocument();
    // The position follows history, so returning to the period restores it.
    expect(window.history.state.hrLocalPages).toMatchObject({
      "hr-period:p1:draft1:open": { page: 4, size: 50 },
    });
  });
});

describe("employee editor member choices and history", () => {
  it("keeps a chosen account through a search and pages older changes", async () => {
    const { EmployeeForm } = await import("./EmployeeForm");
    const { chooseOption: choose, selectedLabel } =
      await import("@tests/fixtures/select-control");
    const member = (userId: string, displayName: string) => ({
      userId,
      displayName,
      linked: false,
    });
    state.query.mockImplementation((name: string, args: Args) => {
      if (name === "hr/setup:memberOptionsPage")
        return envelope(
          ready(
            args.search === "zed"
              ? [member("u-zed", "Zed Needle")]
              : [member("u-free", "Free member")],
            args.search === undefined && args.cursor === undefined
              ? "more"
              : "",
          ),
        );
      if (name === "hr/setup:employeeHistoryPage")
        return envelope(
          ready(
            [
              {
                id: args.cursor ?? "newest",
                at: Date.parse("2026-10-01T09:00:00+07:00"),
                action: "hr.employee.save",
                actorName: args.cursor ? "Older admin" : "HR admin",
                changes: [{ field: "code", from: '"A"', to: '"B"' }],
              },
            ],
            args.cursor ? "" : "older",
          ),
        );
      return undefined;
    });
    renderWithIntl(
      <EmployeeForm
        employee={{
          id: "e1",
          code: "EMP-001",
          displayName: "Somchai",
          status: "ACTIVE",
          siteId: "w1",
          employmentStartDate: "2026-01-01",
          version: 1,
        }}
        sites={[{ id: "w1", code: "HQ", name: "Head office" }]}
        today="2026-10-09"
        onDone={() => undefined}
      />,
      { locale: "en" },
    );
    choose("Linked account", "Free member");
    expect(selectedLabel("Linked account")).toBe("Free member");
    fireEvent.change(screen.getByLabelText("Find for Linked account"), {
      target: { value: "zed" },
    });
    act(() => vi.advanceTimersByTime(300));
    expect(state.query).toHaveBeenCalledWith("hr/setup:memberOptionsPage", {
      search: "zed",
      pageSize: 20,
    });
    // The choice made from an earlier page keeps its name and value.
    expect(selectedLabel("Linked account")).toBe("Free member");

    const history = screen.getByTestId("hr-employee-history");
    expect(history).toHaveTextContent("HR admin");
    fireEvent.click(within(history).getByRole("button", { name: "Next page" }));
    expect(history).toHaveTextContent("Older admin");
    expect(
      within(history).getByRole("button", { name: "Next page" }),
    ).toBeDisabled();
  });
});

describe("history-backed cursor stacks of the other HR lists", () => {
  it("restores the page after Back and starts other criteria at page 1", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { useHrCursorStack } = await import("./HrPagedList");
    const first = renderHook(() =>
      useHrCursorStack("notifications", { unreadOnly: false }),
    );
    act(() => first.result.current[1](["c2"]));
    act(() => first.result.current[1]((previous) => [...previous, "c3"]));
    expect(first.result.current[0]).toEqual(["c2", "c3"]);
    first.unmount();
    // Returning to the same history entry restores the position.
    const again = renderHook(() =>
      useHrCursorStack("notifications", { unreadOnly: false }),
    );
    expect(again.result.current[0]).toEqual(["c2", "c3"]);
    // Other criteria or another identity never reuse it.
    const other = renderHook(() =>
      useHrCursorStack("notifications", { unreadOnly: true }),
    );
    expect(other.result.current[0]).toEqual([]);
    state.access.identityKey = "org-a:user-b:not-linked";
    const user = renderHook(() =>
      useHrCursorStack("notifications", { unreadOnly: false }),
    );
    expect(user.result.current[0]).toEqual([]);
    state.access.identityKey = "org-a:user-a:not-linked";
  });
});
