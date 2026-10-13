import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";

const state = vi.hoisted(() => ({
  query: vi.fn(),
  access: {
    status: "READY",
    permissions: ["hr.self.access"],
    timezone: "Asia/Bangkok",
    timezoneSupported: true,
    today: "2026-12-31",
    sites: [],
  },
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) =>
    args === "skip" ? undefined : state.query(getFunctionName(ref), args),
}));
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => state.access,
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: ComponentProps<"a">) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/hr/requests",
}));

import {
  HrFrozenPeriodsScreen,
  HrFrozenPeriodDetailScreen,
} from "./FrozenPeriodsScreen";
import { HrHolidaysScreen, HrUpcomingHoliday } from "./HolidaysScreen";
import { HrHistoryScreen } from "./HistoryScreen";
import { HrRequestDetailScreen, HrRequestsScreen } from "./RequestsScreen";

const envelope = (value: unknown) => ({ ok: true, value });
const employee = {
  id: "employee",
  code: "EMP",
  displayName: "Employee",
  site: { id: "site", name: "Main workplace" },
};
const calendar = {
  ok: true,
  employee,
  year: 2026,
  today: "2026-12-31",
  timezone: "Asia/Bangkok",
  complete: true,
  holidays: [{ id: "holiday", date: "2026-12-31", name: "Year end" }],
  nextHoliday: { id: "holiday", date: "2026-12-31", name: "Year end" },
};

beforeEach(() => {
  state.query.mockReset();
  state.access.permissions = ["hr.self.access"];
});
afterEach(() => cleanup());

it("does not query holiday data without employee access", () => {
  state.access.permissions = [];
  renderWithIntl(<HrHolidaysScreen />, { locale: "en" });
  expect(state.query).not.toHaveBeenCalled();
  expect(screen.getByTestId("hr-denied")).toBeInTheDocument();
});

it("converts the Thai Buddhist year to the canonical query and recovers an empty year", () => {
  state.query.mockImplementation((_ref, args: { year: number }) =>
    envelope(
      args.year === 2026
        ? calendar
        : { ...calendar, year: args.year, holidays: [], nextHoliday: null },
    ),
  );
  renderWithIntl(<HrHolidaysScreen />, { locale: "th" });
  const year = screen.getByLabelText("ปี พ.ศ.");
  expect(year).toHaveValue(2569);
  expect(state.query).toHaveBeenLastCalledWith("hr/self:holidays", {
    clockRefresh: expect.any(Number),
    year: 2026,
  });
  fireEvent.change(year, { target: { value: "2570" } });
  expect(screen.getByText("ยังไม่กำหนดวันหยุดสำหรับปีนี้")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "ดาวน์โหลด CSV" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "ปีปัจจุบัน" }));
  expect(year).toHaveValue(2569);
  expect(screen.getByText("Year end")).toBeInTheDocument();
});

it("shows next January only after the next-year calendar finishes loading", () => {
  let next: unknown;
  state.query.mockImplementation((_ref, args: { year: number }) =>
    args.year === 2026
      ? envelope({ ...calendar, holidays: [], nextHoliday: null })
      : next,
  );
  const view = renderWithIntl(<HrUpcomingHoliday today="2026-12-31" />, {
    locale: "en",
    preserveProviders: true,
  });
  expect(
    screen.queryByText("No upcoming holiday configured"),
  ).not.toBeInTheDocument();
  next = envelope({
    ...calendar,
    year: 2027,
    holidays: [{ id: "jan", date: "2027-01-01", name: "New year" }],
    nextHoliday: { id: "jan", date: "2027-01-01", name: "New year" },
  });
  view.rerender(<HrUpcomingHoliday today="2026-12-31" />);
  expect(screen.getByText("New year")).toBeInTheDocument();
});

it("shows refused holiday queries without offering an export", () => {
  state.query.mockReturnValue(envelope({ ok: false, code: "HR_NOT_LINKED" }));
  renderWithIntl(<HrHolidaysScreen />, { locale: "en" });
  expect(screen.getByTestId("hr-error")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Download CSV" }),
  ).not.toBeInTheDocument();
});

it("browses older correction pages and opens the exact request record", () => {
  state.query.mockImplementation((_ref, args: { cursor?: string }) =>
    envelope({
      ok: true,
      items: [
        {
          id: args.cursor ? "old-request" : "new-request",
          businessDate: args.cursor ? "2024-01-02" : "2026-12-30",
          status: "RETURNED",
          reason: args.cursor
            ? "Older retained correction"
            : "Recent correction",
        },
      ],
      isDone: Boolean(args.cursor),
      continueCursor: args.cursor ? "" : "next-cursor",
    }),
  );
  renderWithIntl(<HrRequestsScreen />, { locale: "en" });
  expect(
    screen.getByRole("link", { name: /Recent correction/ }),
  ).toHaveAttribute("href", "/hr/requests/new-request");
  fireEvent.click(screen.getByRole("button", { name: "Older page" }));
  expect(state.query).toHaveBeenLastCalledWith("hr/self:requests", {
    clockRefresh: expect.any(Number),
    limit: 20,
    cursor: "next-cursor",
  });
  expect(
    screen.getByRole("link", { name: /Older retained correction/ }),
  ).toHaveAttribute("href", "/hr/requests/old-request");
  expect(screen.getByRole("button", { name: "Older page" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Newer page" }));
  expect(screen.getByText("Recent correction")).toBeInTheDocument();
});

it("shows the full saved timeline with dates and times in the organization timezone", () => {
  const at = Date.parse("2026-12-31T18:30:00Z");
  state.query.mockReturnValue(
    envelope({
      ok: true,
      timezone: "Asia/Bangkok",
      businessDate: "2026-12-31",
      detail: {
        status: "RETURNED",
        reason: "Correction",
        proposedStartAt: at,
        proposedEndAt: at + 3600000,
        history: [
          { action: "SUBMITTED", at, actorName: "Employee" },
          {
            action: "RETURNED",
            at: at + 60000,
            actorName: "Supervisor",
            reason: "Please explain",
          },
        ],
      },
    }),
  );
  renderWithIntl(<HrRequestDetailScreen requestId="exact-request" />, {
    locale: "en",
  });
  expect(screen.getByText(/1 Jan 2027, 01:30/)).toBeInTheDocument();
  expect(screen.getByText("Please explain")).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: /View attendance day/ }),
  ).toHaveAttribute("href", "/hr/time/2026-12-31");
});

it("reconciles summary filters to the exact bounded attendance rows", () => {
  const rows = [
    { businessDate: "2026-12-29", status: "READY", workedMinutes: 480 },
    {
      businessDate: "2026-12-30",
      status: "EXCEPTION",
      issue: "MISSING_END",
      workedMinutes: 0,
    },
    { businessDate: "2026-12-31", status: "IN_PROGRESS", workedMinutes: 0 },
  ].map((row) => ({
    ...row,
    plan: { kind: "SCHEDULED", startTime: "08:30", endTime: "17:30" },
  }));
  state.query.mockReturnValue(
    envelope({ ok: true, timezone: "Asia/Bangkok", rows }),
  );
  renderWithIntl(<HrHistoryScreen />, { locale: "en" });
  fireEvent.click(screen.getByRole("button", { name: /Needs review\s*1/ }));
  const table = screen.getByRole("table");
  expect(within(table).getAllByRole("row")).toHaveLength(2);
  expect(
    screen.getByText("Showing 1 day of 3 days in the selected range."),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Calendar month"), {
    target: { value: "2026-11" },
  });
  expect(state.query).toHaveBeenLastCalledWith("hr/self:history", {
    clockRefresh: expect.any(Number),
    from: "2026-11-01",
    to: "2026-11-30",
  });
});

it("keeps scanning filtered requests and resets the cursor when applying search", () => {
  state.query.mockImplementation(
    (_ref, args: { cursor?: string; text?: string }) =>
      envelope({
        ok: true,
        timezone: "Asia/Bangkok",
        items: [],
        isDone: false,
        continueCursor: args.cursor ? "page3" : "page2",
      }),
  );
  renderWithIntl(<HrRequestsScreen />, { locale: "en" });
  expect(screen.getByText("No matches in this batch")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Older page" }));
  fireEvent.change(screen.getByLabelText("Search requests"), {
    target: { value: " missed punch " },
  });
  fireEvent.change(screen.getByLabelText("From date"), {
    target: { value: "2026-10-01" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
  expect(state.query).toHaveBeenLastCalledWith("hr/self:requests", {
    clockRefresh: expect.any(Number),
    limit: 20,
    text: " missed punch ",
    from: "2026-10-01",
  });
  expect(screen.getByRole("button", { name: "Newer page" })).toBeDisabled();
});
it("distinguishes empty frozen history batches from exhausted personal history", () => {
  state.query.mockImplementation((_ref, args: { cursor?: string }) =>
    envelope({
      ok: true,
      items: [],
      isDone: Boolean(args.cursor),
      continueCursor: args.cursor ? "" : "next",
    }),
  );
  renderWithIntl(<HrFrozenPeriodsScreen />, { locale: "en" });
  expect(
    screen.getByText("No personal records in this batch"),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("No closed periods found")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
});
it("shows captured original punches separately and leaves older originals unknown", () => {
  const at = Date.parse("2026-10-01T01:30:00Z");
  state.query.mockReturnValue(
    envelope({
      ok: true,
      version: {
        id: "exact",
        from: "2026-10-01",
        to: "2026-10-02",
        revision: 2,
        closedAt: at,
        timezone: "Asia/Bangkok",
        siteCode: "S1",
        siteName: "Frozen workplace",
      },
      employee: { code: "EMP", name: "Frozen name" },
      summary: {
        workedMinutes: 480,
        outsideShiftMinutes: 0,
        leaveDays: 0,
        absentDays: 0,
      },
      rows: [
        {
          date: "2026-10-01",
          originalCaptured: true,
          originalStart: at,
          effectiveStart: at + 3600000,
          effectiveEnd: at + 3600000 * 9,
          workedMinutes: 480,
          outsideShiftMinutes: 0,
          disposition: "WORKED",
        },
        {
          date: "2026-10-02",
          originalCaptured: false,
          effectiveStart: at,
          workedMinutes: 0,
          outsideShiftMinutes: 0,
          disposition: "NONWORKING",
        },
      ],
    }),
  );
  renderWithIntl(<HrFrozenPeriodDetailScreen versionId="exact" />, {
    locale: "en",
  });
  expect(state.query).toHaveBeenCalledWith("hr/selfPeriods:detail", {
    versionId: "exact",
  });
  expect(
    screen.getByText("Not captured in this older version"),
  ).toBeInTheDocument();
  const row = screen.getAllByRole("row")[1]!;
  expect(within(row).getByText("09:30")).toBeInTheDocument();
  expect(within(row).getByText("08:30")).toBeInTheDocument();
});
it("does not request frozen employee data without permission", () => {
  state.access.permissions = [];
  renderWithIntl(<HrFrozenPeriodDetailScreen versionId="forged" />, {
    locale: "en",
  });
  expect(state.query).not.toHaveBeenCalled();
});
