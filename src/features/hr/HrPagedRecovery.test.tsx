import {
  act,
  cleanup,
  fireEvent,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";
import { chooseOption, selectTrigger } from "@tests/fixtures/select-control";

/**
 * Recovery and inert-row behaviour of the paged HR lists, driven through
 * the real screens and hooks: terminal cursor resets, stalled and paused
 * searches, rows of a previous page while the next loads, filter flags
 * restored from history, and the bounded cursor stack's floor.
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
    ],
    timezone: "Asia/Bangkok",
    timezoneSupported: true,
    today: "2026-10-09",
    sites: [
      { id: "w1", code: "HQ", name: "Head office" },
      { id: "w2", code: "BR", name: "Branch" },
    ],
    sitesComplete: true,
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
vi.mock("next/navigation", async (original) => ({
  ...((await original()) as object),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { HrAnnouncementsScreen } from "./AnnouncementsScreen";
import { DayDetailView, type DayDetail } from "./DayDetailView";
import { EmployeeForm } from "./EmployeeForm";
import { HrEmployeesScreen } from "./EmployeesScreen";
import { useHrCursorStack } from "./HrPagedList";
import { HrNotificationsScreen } from "./NotificationsScreen";
import { HrReviewScreen } from "./ReviewScreen";

const envelope = (value: unknown) => ({ ok: true, requestId: "q", value });
const ready = (page: unknown[], continueCursor = "") => ({
  ok: true,
  status: "ready",
  page,
  isDone: continueCursor === "",
  continueCursor,
  scanned: page.length,
  sitesComplete: true,
});
const resetPage = {
  ok: true,
  status: "reset",
  page: [],
  isDone: false,
  continueCursor: "",
  scanned: 0,
};
const scanning = (scanCursor?: string) => ({
  ok: true,
  status: "scanning",
  page: [],
  isDone: false,
  continueCursor: "",
  ...(scanCursor === undefined ? {} : { scanCursor }),
  scanned: 99,
});
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

type Args = Record<string, unknown>;
/** Distinct successive requests (a re-render repeats the same arguments). */
const callsOf = (name: string) =>
  state.query.mock.calls
    .filter(([called]) => called === name)
    .map(([, args]) => args as Args)
    .filter(
      (args, index, all) =>
        index === 0 || JSON.stringify(args) !== JSON.stringify(all[index - 1]),
    );
const EMPLOYEES = "hr/setup:employeesPage";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  state.query.mockReset();
  state.push.mockReset();
  state.replace.mockReset();
  state.access.sitesComplete = true;
  window.history.replaceState(null, "", "/en/hr/employees");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("terminal reset and stalled scans", () => {
  it("returns to page 1 once, then offers an explicit, usable recovery", () => {
    let broken = false;
    state.query.mockImplementation((name: string, args: Args) => {
      if (name !== EMPLOYEES) return undefined;
      if (args.attempt !== undefined) {
        broken = false;
        return envelope(ready([employee(0)], "next"));
      }
      if (broken) return envelope(resetPage);
      return envelope(
        args.cursor === undefined
          ? ready([employee(0), employee(1)], "next")
          : ready([employee(2)]),
      );
    });
    renderWithIntl(<HrEmployeesScreen />, { locale: "en" });
    expect(screen.getAllByText("Employee 0").length).toBeGreaterThan(0);

    // The next page's cursor and then page 1 itself are refused.
    broken = true;
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    const calls = callsOf(EMPLOYEES);
    // One automatic return to page 1 after the cursor reset, no loop.
    expect(calls.slice(-2)).toEqual([
      { pageSize: 20, cursor: "next" },
      { pageSize: 20 },
    ]);
    const before = calls.length;
    const alert = screen.getByTestId("hr-paged-interrupted");
    expect(alert).toHaveTextContent(
      "This list changed and this page can no longer continue.",
    );
    // No stale rows stay actionable, and the page size stays usable.
    expect(screen.queryByText("Employee 0")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    expect(callsOf(EMPLOYEES)).toHaveLength(before);

    // Recovery is a real new request (fresh `attempt`), not a cached one.
    fireEvent.click(
      within(alert).getByRole("button", { name: "Start again from page 1" }),
    );
    expect(callsOf(EMPLOYEES).at(-1)).toEqual({ pageSize: 20, attempt: 1 });
    expect(screen.queryByTestId("hr-paged-interrupted")).toBeNull();
    expect(screen.getAllByText("Employee 0").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled();
  });

  it("recovers a fresh first page that answers reset, and keeps page size enabled", () => {
    state.query.mockImplementation((name: string, args: Args) => {
      if (name !== EMPLOYEES) return undefined;
      return envelope(
        args.attempt === undefined && args.pageSize === 20
          ? resetPage
          : ready([employee(5)]),
      );
    });
    renderWithIntl(<HrEmployeesScreen />, { locale: "en" });
    expect(screen.getByTestId("hr-paged-interrupted")).toBeInTheDocument();
    // A fresh page 1 has no cursor to drop: no automatic retry loop.
    expect(callsOf(EMPLOYEES)).toEqual([{ pageSize: 20 }]);
    fireEvent.click(
      screen.getByRole("button", { name: "Start again from page 1" }),
    );
    expect(callsOf(EMPLOYEES).at(-1)).toEqual({ pageSize: 20, attempt: 1 });
    expect(screen.getAllByText("Employee 5").length).toBeGreaterThan(0);
  });

  it("stops a scan that does not advance and lets the user restart it", () => {
    state.query.mockImplementation((name: string, args: Args) => {
      if (name !== EMPLOYEES) return undefined;
      if (args.attempt !== undefined)
        return envelope(args.scanCursor ? ready([]) : scanning("s2"));
      // The continuation repeats the same cursor: no progress.
      return envelope(scanning("s1"));
    });
    window.history.replaceState(null, "", "/en/hr/employees?q=nobody");
    renderWithIntl(<HrEmployeesScreen />, { locale: "en" });
    const alert = screen.getByTestId("hr-paged-interrupted");
    expect(alert).toHaveTextContent(
      "The search stopped before finishing this page.",
    );
    // s1 was followed once; the repeated s1 was not followed again.
    expect(callsOf(EMPLOYEES)).toEqual([
      { pageSize: 20, search: "nobody" },
      { pageSize: 20, search: "nobody", scanCursor: "s1" },
    ]);
    fireEvent.click(
      within(alert).getByRole("button", { name: "Start again from page 1" }),
    );
    expect(callsOf(EMPLOYEES).slice(-2)).toEqual([
      { pageSize: 20, search: "nobody", attempt: 1 },
      { pageSize: 20, search: "nobody", scanCursor: "s2", attempt: 1 },
    ]);
    expect(screen.getByText("No matching employees")).toBeInTheDocument();
  });

  it("pauses a long search for the user and keeps searching on request", () => {
    let step = 0;
    state.query.mockImplementation((name: string, args: Args) => {
      if (name !== EMPLOYEES) return undefined;
      if (args.scanCursor === "s70") return envelope(ready([employee(9)]));
      step = args.scanCursor ? Number(String(args.scanCursor).slice(1)) : 0;
      return envelope(scanning(`s${step + 1}`));
    });
    window.history.replaceState(null, "", "/en/hr/employees?q=needle");
    renderWithIntl(<HrEmployeesScreen />, { locale: "en" });
    const alert = screen.getByTestId("hr-paged-interrupted");
    expect(alert).toHaveTextContent("Still searching.");
    const followed = callsOf(EMPLOYEES).length;
    expect(followed).toBe(51);
    fireEvent.click(
      within(alert).getByRole("button", { name: "Keep searching" }),
    );
    expect(callsOf(EMPLOYEES).at(-1)).toEqual({
      pageSize: 20,
      search: "needle",
      scanCursor: "s70",
    });
    expect(screen.getAllByText("Employee 9").length).toBeGreaterThan(0);
  });
});

describe("rows of the previous page while the next loads", () => {
  it("keeps employee rows visible but inert and their actions disabled", () => {
    let pending = false;
    state.query.mockImplementation((name: string, args: Args) => {
      if (name !== EMPLOYEES) return undefined;
      if (args.cursor !== undefined && pending) return undefined;
      return envelope(
        args.cursor === undefined
          ? ready([employee(0), employee(1)], "next")
          : ready([employee(2)]),
      );
    });
    const view = renderWithIntl(<HrEmployeesScreen />, {
      locale: "en",
      preserveProviders: true,
    });
    const edit = () =>
      screen.getAllByRole("button", { name: "Edit Employee 0" })[0]!;
    expect(edit()).toBeEnabled();

    pending = true;
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    const busy = screen.getByTestId("hr-paged-updating");
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(busy).toHaveAttribute("inert");
    // Still shown for footprint, but not actionable.
    for (const button of screen.getAllByRole("button", {
      name: "Edit Employee 0",
    }))
      expect(button).toBeDisabled();
    fireEvent.click(edit());
    expect(state.push).not.toHaveBeenCalled();
    // Filters stay usable while the page loads.
    expect(screen.getByLabelText("Search employees")).toBeEnabled();

    pending = false;
    view.rerender(<HrEmployeesScreen />);
    expect(screen.queryByTestId("hr-paged-updating")).toBeNull();
    expect(
      screen.getAllByRole("button", { name: "Edit Employee 2" })[0],
    ).toBeEnabled();
  });

  it("does not let a retained review queue item be selected", () => {
    let pending = false;
    const group = (id: string) => ({
      employeeId: id,
      employeeCode: `EMP-${id}`,
      employeeName: `Employee ${id}`,
      siteCode: "HQ",
      items: [
        {
          businessDate: "2026-10-08",
          status: "EXCEPTION",
          issue: "MISSING_RECORD",
          disposition: null,
          revision: 0,
          certified: false,
        },
      ],
    });
    state.query.mockImplementation((name: string, args: Args) => {
      if (name !== "hr/review:queuePage") return undefined;
      if (args.cursor !== undefined && pending) return undefined;
      return envelope({
        ...(args.cursor === undefined
          ? ready([group("A")], "next")
          : ready([group("B")])),
        today: "2026-10-09",
        tab: "OPEN",
      });
    });
    window.history.replaceState(null, "", "/en/hr/review");
    const view = renderWithIntl(<HrReviewScreen />, {
      locale: "en",
      preserveProviders: true,
    });
    const item = () => screen.getByRole("button", { name: /Employee A/ });
    expect(item()).toBeEnabled();
    pending = true;
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(item()).toBeDisabled();
    expect(screen.getByTestId("hr-paged-updating")).toHaveAttribute("inert");
    fireEvent.click(item());
    expect(state.push).not.toHaveBeenCalled();
    pending = false;
    view.rerender(<HrReviewScreen />);
    expect(screen.getByRole("button", { name: /Employee B/ })).toBeEnabled();
  });

  it("keeps a member selector pending until the next page of choices is ready", () => {
    let pending = false;
    state.query.mockImplementation((name: string, args: Args) => {
      if (name === "hr/setup:memberOptionsPage") {
        if (args.cursor !== undefined && pending) return undefined;
        return envelope(
          ready(
            [
              {
                userId: args.cursor ? "u-next" : "u-first",
                displayName: args.cursor ? "Next member" : "First member",
                linked: false,
              },
            ],
            args.cursor ? "" : "more",
          ),
        );
      }
      if (name === "hr/setup:employeeHistoryPage") return envelope(ready([]));
      return undefined;
    });
    // A new element each time, so a rerender really renders the form again.
    const form = () => (
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
      />
    );
    const view = renderWithIntl(form(), {
      locale: "en",
      preserveProviders: true,
    });
    const trigger = () => selectTrigger("Linked account");
    expect(trigger()).not.toHaveAttribute("aria-busy");
    pending = true;
    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: "Linked account choices" }),
      ).getByRole("button", { name: "Next page" }),
    );
    // The previous page's choices are not offered while the next loads.
    expect(trigger()).toHaveAttribute("aria-busy", "true");
    expect(trigger()).toBeDisabled();
    pending = false;
    view.rerender(form());
    expect(trigger()).toBeEnabled();
    chooseOption("Linked account", "Next member");
    expect(trigger()).toHaveTextContent("Next member");
  });
});

describe("filter flags restored with their pages", () => {
  const notice = (id: string, pinned: boolean) => ({
    announcement: {
      _id: id,
      title: `Notice ${id}`,
      body: "",
      status: "PUBLISHED",
      version: 1,
      publishedVersion: 1,
      publishedAt: Date.UTC(2026, 9, 1),
      pinned,
      acknowledgmentRequired: false,
      audience: { mode: "ORGANIZATION", warehouseIds: [] },
    },
    receipt: { _id: `r-${id}`, contentVersion: 1 },
    authorName: "HR",
  });
  const FEED = "hr/announcements:self";

  it("restores Pinned only and its second page after Back, reload and history traversal", () => {
    state.query.mockImplementation((name: string, args: Args) => {
      if (name !== FEED) return undefined;
      const prefix = args.pinnedOnly ? "pinned" : "all";
      return envelope({
        ok: true,
        items: [notice(`${prefix}-${String(args.cursor ?? "1")}`, true)],
        nextCursor: args.cursor ? null : `${prefix}-2`,
        gate: null,
      });
    });
    window.history.replaceState(null, "", "/en/hr/announcements");
    const first = renderWithIntl(<HrAnnouncementsScreen />, { locale: "en" });
    const pinned = () => screen.getByLabelText("Pinned announcements only");
    fireEvent.click(pinned());
    expect(window.location.search).toBe("?pinned=1");
    expect(callsOf(FEED).at(-1)).toEqual({ limit: 20, pinnedOnly: true });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(callsOf(FEED).at(-1)).toEqual({
      limit: 20,
      pinnedOnly: true,
      cursor: "pinned-2",
    });
    const filtered = {
      url: window.location.href,
      state: window.history.state,
    };
    // Open an announcement and come Back (remount, same entry): the flag
    // and the page come back together. A reload reads the same state.
    first.unmount();
    state.query.mockClear();
    renderWithIntl(<HrAnnouncementsScreen />, { locale: "en" });
    expect(pinned()).toBeChecked();
    expect(callsOf(FEED)[0]).toEqual({
      limit: 20,
      pinnedOnly: true,
      cursor: "pinned-2",
    });
    expect(screen.getByText("Page 2")).toBeInTheDocument();

    // Clearing the flag is a new entry at page 1 ...
    fireEvent.click(pinned());
    expect(window.location.search).toBe("");
    expect(callsOf(FEED).at(-1)).toEqual({ limit: 20, pinnedOnly: false });
    expect(pinned()).not.toBeChecked();
    // ... and Back to the filtered entry restores its flag and page.
    act(() => {
      window.history.replaceState(filtered.state, "", filtered.url);
      window.dispatchEvent(
        new PopStateEvent("popstate", { state: filtered.state }),
      );
    });
    expect(pinned()).toBeChecked();
    expect(callsOf(FEED).at(-1)).toEqual({
      limit: 20,
      pinnedOnly: true,
      cursor: "pinned-2",
    });
  });

  it("restores Unread only and its page for notifications", () => {
    const LIST = "hr/notifications:list";
    state.query.mockImplementation((name: string, args: Args) =>
      name === LIST
        ? envelope({
            ok: true,
            items: [
              {
                _id: `n-${String(args.cursor ?? "1")}`,
                title: "Note",
                createdAt: 1,
                unread: true,
                event: "OTHER",
              },
            ],
            nextCursor: args.cursor ? null : "u-2",
            unreadCount: 2,
            unreadCountComplete: true,
          })
        : undefined,
    );
    window.history.replaceState(null, "", "/en/hr/notifications");
    const first = renderWithIntl(<HrNotificationsScreen />, { locale: "en" });
    fireEvent.click(screen.getByLabelText("Unread notifications only"));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(callsOf(LIST).at(-1)).toEqual({
      limit: 20,
      unreadOnly: true,
      cursor: "u-2",
    });
    first.unmount();
    state.query.mockClear();
    renderWithIntl(<HrNotificationsScreen />, { locale: "en" });
    expect(screen.getByLabelText("Unread notifications only")).toBeChecked();
    expect(callsOf(LIST)[0]).toEqual({
      limit: 20,
      unreadOnly: true,
      cursor: "u-2",
    });
  });
});

describe("bounded cursor stack floor", () => {
  it("keeps 500 cursors, stops Previous at the oldest kept page and offers First", () => {
    window.history.replaceState(null, "", "/en/hr/payslips");
    const hook = renderHook(() => useHrCursorStack("bound-test"));
    // Pages 2…502: 501 cursors, one more than the stack keeps.
    for (let page = 2; page <= 502; page += 1)
      act(() => hook.result.current[2].next(`p${page}`));
    const [cursors, , nav] = hook.result.current;
    expect(cursors).toHaveLength(500);
    expect(cursors[0]).toBe("p3");
    expect(nav.page).toBe(502);
    expect(nav.truncated).toBe(true);
    for (let page = 502; page > 3; page -= 1)
      act(() => hook.result.current[2].previous());
    expect(hook.result.current[0]).toEqual(["p3"]);
    expect(hook.result.current[2].page).toBe(3);
    // Page 2 was dropped: Previous must not jump to page 1 as if it were.
    expect(hook.result.current[2].canPrevious).toBe(false);
    act(() => hook.result.current[2].previous());
    expect(hook.result.current[0]).toEqual(["p3"]);
    // The truncation survives Back/reload (history state).
    hook.unmount();
    const again = renderHook(() => useHrCursorStack("bound-test"));
    expect(again.result.current[0]).toEqual(["p3"]);
    expect(again.result.current[2]).toMatchObject({ page: 3, truncated: true });
    act(() => again.result.current[2].first());
    expect(again.result.current[0]).toEqual([]);
    expect(again.result.current[2]).toMatchObject({
      page: 1,
      truncated: false,
      canPrevious: false,
    });
  });

  it("shows an explicit First page on a truncated screen list", () => {
    const LIST = "hr/notifications:list";
    state.query.mockImplementation((name: string) =>
      name === LIST
        ? envelope({
            ok: true,
            items: [],
            nextCursor: null,
            unreadCount: 0,
            unreadCountComplete: true,
          })
        : undefined,
    );
    window.history.replaceState(
      {
        hrCursorStacks: {
          "hr:notifications:org-a:user-a:not-linked": {
            criteria: JSON.stringify({ unreadOnly: false, entry: "e1" }),
            cursors: ["c7"],
            offset: 6,
          },
        },
        hrListEntry: "e1",
      },
      "",
      "/en/hr/notifications",
    );
    renderWithIntl(<HrNotificationsScreen />, { locale: "en" });
    expect(callsOf(LIST)[0]).toEqual({
      limit: 20,
      unreadOnly: false,
      cursor: "c7",
    });
    expect(screen.getByText("Page 8")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    fireEvent.click(screen.getByTestId("hr-stack-first"));
    expect(callsOf(LIST).at(-1)).toEqual({ limit: 20, unreadOnly: false });
    expect(screen.queryByTestId("hr-stack-first")).toBeNull();
  });
});

describe("site choices beyond the preloaded list", () => {
  it("pages the employee site filter and keeps a late site's label", () => {
    state.access.sitesComplete = false;
    state.query.mockImplementation((name: string, args: Args) => {
      if (name === EMPLOYEES) return envelope(ready([employee(0)]));
      if (name === "hr/access:sitesPage")
        return envelope({
          ...ready(
            args.cursor
              ? [{ id: "w51", code: "ZZ-51", name: "Late site", active: true }]
              : [{ id: "w1", code: "HQ", name: "Head office", active: true }],
            args.cursor ? "" : "more",
          ),
          selected: null,
        });
      return undefined;
    });
    renderWithIntl(<HrEmployeesScreen />, { locale: "en" });
    fireEvent.click(
      within(
        screen.getByRole("navigation", { name: "Site choices" }),
      ).getByRole("button", { name: "Next page" }),
    );
    expect(callsOf("hr/access:sitesPage").at(-1)).toMatchObject({
      cursor: "more",
    });
    chooseOption("Site", "ZZ-51 · Late site");
    expect(window.location.search).toBe("?site=w51");
    expect(callsOf(EMPLOYEES).at(-1)).toEqual({
      pageSize: 20,
      warehouseId: "w51",
    });
  });
});

describe("older day corrections", () => {
  it("links an employee's day to every request for that date", () => {
    const detail = {
      employeeId: "e1",
      businessDate: "2026-10-08",
      revision: 1,
      plan: { kind: "NONWORKING", reason: "NO_SCHEDULE" },
      status: "READY",
      disposition: null,
      workedMinutes: 0,
      outsideShiftMinutes: 0,
      locked: false,
      events: [],
      corrections: [],
      correctionsIncomplete: true,
    } as unknown as DayDetail;
    renderWithIntl(<DayDetailView detail={detail} timezone="Asia/Bangkok" />, {
      locale: "en",
    });
    expect(
      screen.getByRole("link", { name: "See every request for this date" }),
    ).toHaveAttribute("href", "/hr/requests?from=2026-10-08&to=2026-10-08");
  });
});

describe("employee editor and the list's page", () => {
  it("carries the list page into the editor entry and back on Close, so reload keeps it", () => {
    const all = Array.from({ length: 45 }, (_, index) => employee(index));
    state.query.mockImplementation((name: string, args: Args) => {
      if (name === EMPLOYEES) {
        const start = args.cursor === undefined ? 0 : Number(args.cursor);
        const next = start + 20;
        return envelope(
          ready(all.slice(start, next), next < all.length ? String(next) : ""),
        );
      }
      if (name === "hr/setup:employee")
        return envelope({ ok: true, employee: all[20] });
      if (name === "hr/setup:memberOptionsPage") return envelope(ready([]));
      if (name === "hr/setup:employeeHistoryPage") return envelope(ready([]));
      return undefined;
    });
    // The router starts a new entry without app metadata, as Next does.
    const routerTo = (href: string, mode: "push" | "replace") =>
      window.history[mode === "push" ? "pushState" : "replaceState"](
        { __NA: true },
        "",
        `/en${href}`,
      );
    state.push.mockImplementation((href: string) => routerTo(href, "push"));
    state.replace.mockImplementation((href: string) =>
      routerTo(href, "replace"),
    );
    const view = renderWithIntl(<HrEmployeesScreen />, {
      locale: "en",
      preserveProviders: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(callsOf(EMPLOYEES).at(-1)).toEqual({ pageSize: 20, cursor: "20" });
    const position = window.history.state.cataloguePaginationScopes;
    expect(position).toBeDefined();

    fireEvent.click(
      screen.getAllByRole("button", { name: "Edit Employee 20" })[0]!,
    );
    view.rerender(<HrEmployeesScreen />);
    expect(window.location.search).toBe("?employee=e20&mode=edit");
    // The editor entry carries the list's position.
    expect(window.history.state.cataloguePaginationScopes).toEqual(position);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    view.rerender(<HrEmployeesScreen />);
    expect(state.replace).toHaveBeenCalledWith("/hr/employees", {
      scroll: false,
    });
    expect(window.history.state.cataloguePaginationScopes).toEqual(position);

    // A reload of the list after Close starts at the same page.
    view.unmount();
    state.query.mockClear();
    renderWithIntl(<HrEmployeesScreen />, { locale: "en" });
    expect(callsOf(EMPLOYEES)[0]).toEqual({ pageSize: 20, cursor: "20" });
  });
});
