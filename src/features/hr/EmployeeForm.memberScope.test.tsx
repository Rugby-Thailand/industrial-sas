import { fireEvent, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";
import { openSelect, selectedLabel } from "@tests/fixtures/select-control";

const state = vi.hoisted(() => ({
  queries: new Map<string, unknown>(),
}));

vi.mock("convex/react", async () => {
  const { getFunctionName: name } = await import("convex/server");
  return {
    useQuery: (reference: Parameters<typeof name>[0], args: unknown) =>
      args === "skip" ? undefined : state.queries.get(name(reference)),
    useMutation: () => vi.fn(),
  };
});
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => ({ timezone: "Asia/Bangkok" }),
  useHrCan: () => true,
}));

import { hrRefs } from "@/lib/convex/hrApi";
import { EmployeeForm, type EmployeeRecord } from "./EmployeeForm";

const SITES = [{ id: "w1", code: "HQ", name: "Head office" }];
const ACCOUNT = "Linked account";

/** The server's answer for a site-scoped administrator (HR-001). */
function members(items: readonly Record<string, unknown>[]) {
  state.queries.set(getFunctionName(hrRefs.memberOptions), {
    ok: true,
    requestId: "q",
    value: { ok: true, items },
  });
}

const FREE = { userId: "u-free", displayName: "Free member", linked: false };
const IN_SCOPE = {
  userId: "u-scope",
  displayName: "Scoped member",
  linked: true,
  linkedEmployeeId: "e-scope",
  linkedEmployeeCode: "EMP-009",
};
// Linked outside the administrator's sites: no employee ID or code.
const ELSEWHERE = {
  userId: "u-elsewhere",
  displayName: "Elsewhere member",
  linked: true,
};

function render(employee?: EmployeeRecord) {
  return renderWithIntl(
    <EmployeeForm
      {...(employee === undefined ? {} : { employee })}
      sites={SITES}
      today="2026-10-09"
      onDone={() => undefined}
    />,
    { locale: "en" },
  );
}

const option = (menu: HTMLElement, value: string) =>
  menu.querySelector<HTMLElement>(`[role="option"][data-value="${value}"]`)!;

beforeEach(() => {
  state.queries.clear();
});

describe("employee account selector scope (HR-001)", () => {
  it("keeps accounts linked in or outside scope unavailable, naming only in-scope codes", () => {
    members([FREE, IN_SCOPE, ELSEWHERE]);
    render();
    const menu = openSelect(ACCOUNT);

    expect(option(menu, "u-free")).not.toHaveAttribute("data-disabled");
    expect(option(menu, "u-free")).toHaveTextContent(/^Free member$/);

    expect(option(menu, "u-scope")).toHaveAttribute("data-disabled");
    expect(option(menu, "u-scope")).toHaveTextContent(
      "Scoped member (linked to EMP-009)",
    );

    expect(option(menu, "u-elsewhere")).toHaveAttribute("data-disabled");
    expect(option(menu, "u-elsewhere")).toHaveTextContent(
      "Elsewhere member (already linked to an employee)",
    );

    // Choosing an unavailable account does nothing.
    fireEvent.keyDown(option(menu, "u-elsewhere"), { key: "Enter" });
    expect(selectedLabel(ACCOUNT)).toBe("No account");
  });

  it("still lets an employee keep and re-select their own linked account", () => {
    members([
      FREE,
      IN_SCOPE,
      {
        userId: "u-own",
        displayName: "Own member",
        linked: true,
        linkedEmployeeId: "e1",
        linkedEmployeeCode: "EMP-001",
      },
    ]);
    render({
      id: "e1",
      code: "EMP-001",
      displayName: "Somchai",
      status: "ACTIVE",
      siteId: "w1",
      linkedUserId: "u-own",
      employmentStartDate: "2026-01-01",
      version: 1,
    });
    expect(selectedLabel(ACCOUNT)).toBe("Own member");
    const menu = openSelect(ACCOUNT);
    expect(option(menu, "u-own")).not.toHaveAttribute("data-disabled");
    expect(option(menu, "u-own")).toHaveTextContent(/^Own member$/);
    expect(option(menu, "u-scope")).toHaveAttribute("data-disabled");
    expect(
      within(menu).getByRole("option", { name: "Free member" }),
    ).not.toHaveAttribute("data-disabled");
  });
});
