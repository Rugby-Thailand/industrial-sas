import { cleanup, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
const queries = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  read: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    const name = getFunctionName(ref);
    queries.read(name, args);
    return queries.values.get(name);
  },
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, ...props }: ComponentProps<"a">) => (
    <a href={href} {...props} />
  ),
}));
import { HrHomeUpdates } from "./HrHomeUpdates";
const outcome = (value: unknown) => ({ ok: true, value });
beforeEach(() => {
  queries.values.clear();
  queries.read.mockClear();
});
afterEach(cleanup);
it("shows only owned update metadata and annual balance, without reading payslip amounts or writing receipts", () => {
  queries.values.set(
    "hr/leave:self",
    outcome({
      ok: true,
      gate: null,
      accounts: [{ type: "ANNUAL", available: 4 }],
    }),
  );
  queries.values.set(
    "hr/announcements:self",
    outcome({
      ok: true,
      gate: null,
      items: [{ announcement: { _id: "notice-1", title: "Safety update" } }],
    }),
  );
  queries.values.set(
    "hr/payslips:list",
    outcome({
      ok: true,
      items: [{ from: "2026-10-01", to: "2026-10-31", superseded: false }],
    }),
  );
  queries.values.set(
    "hr/notifications:list",
    outcome({ ok: true, unreadCount: 500, unreadCountComplete: false }),
  );
  renderWithIntl(<HrHomeUpdates />, { locale: "en" });
  expect(screen.getByText("4 annual leave days available")).toBeVisible();
  expect(screen.getByRole("link", { name: "Safety update" })).toHaveAttribute(
    "href",
    "/hr/announcements/notice-1",
  );
  expect(screen.getByText(/500\s*\+ unread notifications/)).toBeVisible();
  expect(screen.getByText(/Statement period:/)).toBeVisible();
  expect(queries.read.mock.calls.map(([name]) => name)).toEqual([
    "hr/leave:self",
    "hr/announcements:self",
    "hr/payslips:list",
    "hr/notifications:list",
  ]);
  expect(queries.read).toHaveBeenCalledWith("hr/announcements:self", {
    pinnedOnly: true,
    limit: 3,
  });
});
it("keeps history and working links available when policies are inactive and never invents a zero balance or unread count", () => {
  queries.values.set(
    "hr/leave:self",
    outcome({ ok: true, gate: "POLICY_NOT_ACTIVE", accounts: [] }),
  );
  queries.values.set(
    "hr/announcements:self",
    outcome({
      ok: true,
      gate: "POLICY_NOT_ACTIVE",
      items: [
        { announcement: { _id: "notice-1", title: "Published earlier" } },
      ],
    }),
  );
  queries.values.set(
    "hr/payslips:list",
    outcome({ ok: false, code: "POLICY_NOT_ACTIVE" }),
  );
  renderWithIntl(<HrHomeUpdates />, { locale: "en" });
  expect(
    screen.getAllByText(/HR must activate the company policy/),
  ).toHaveLength(3);
  expect(screen.getByRole("link", { name: "Published earlier" })).toBeVisible();
  expect(
    screen.getByRole("link", { name: "View Leave balance" }),
  ).toHaveAttribute("href", "/hr/leave");
  expect(
    screen.getByRole("link", { name: "View Latest payslip" }),
  ).toHaveAttribute("href", "/hr/payslips");
  expect(
    screen.queryByText("0 annual leave days available"),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("0 unread notifications")).not.toBeInTheDocument();
});
