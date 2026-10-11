import { cleanup, screen, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";

import { hrRefs } from "@/lib/convex/hrApi";
import type { TenantOutcome } from "@/lib/convex/ledgerApi";

const state = vi.hoisted(() => ({
  queries: new Map<string, unknown>(),
  query: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: (
    reference: Parameters<typeof getFunctionName>[0],
    args: unknown,
  ) => {
    const name = getFunctionName(reference);
    state.query(name, args);
    return state.queries.get(name);
  },
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import {
  HrShortcutCards,
  HrShortcuts,
  type HrShortcutPreference,
} from "./HrShortcuts";

type Preferences =
  | {
      readonly ok: true;
      readonly shortcuts: readonly HrShortcutPreference[];
      readonly version: number;
    }
  | { readonly ok: false; readonly code: "HR_NOT_LINKED" };

const allShortcuts: readonly HrShortcutPreference[] = [
  { key: "hr.today", visible: true },
  { key: "hr.time", visible: true },
  { key: "hr.requests", visible: true },
  { key: "hr.holidays", visible: true },
  { key: "hr.profile", visible: true },
];

function preferences(shortcuts: readonly HrShortcutPreference[]) {
  const outcome: TenantOutcome<Preferences> = {
    ok: true,
    requestId: "shortcut-query",
    value: { ok: true, shortcuts, version: 2 },
  };
  state.queries.set(getFunctionName(hrRefs.shortcutPreferences), outcome);
}

beforeEach(() => {
  state.queries.clear();
  state.query.mockClear();
});
afterEach(() => cleanup());

describe("HrShortcuts", () => {
  it("applies the current query's visibility and order to the exact destinations", () => {
    preferences(allShortcuts);
    const view = renderWithIntl(<HrShortcuts />, {
      locale: "en",
      preserveProviders: true,
    });
    expect(state.query).toHaveBeenCalledWith(
      getFunctionName(hrRefs.shortcutPreferences),
      {},
    );
    expect(
      screen
        .getAllByRole("link")
        .slice(1)
        .map((link) => link.getAttribute("href")),
    ).toEqual([
      "/hr/today",
      "/hr/time",
      "/hr/requests",
      "/hr/holidays",
      "/hr/profile",
    ]);

    preferences([
      { key: "hr.profile", visible: true },
      { key: "hr.holidays", visible: true },
      { key: "hr.today", visible: false },
      { key: "hr.requests", visible: true },
      { key: "hr.time", visible: false },
    ]);
    view.rerender(<HrShortcuts />);

    const links = screen.getAllByRole("link").slice(1);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/hr/profile",
      "/hr/holidays",
      "/hr/requests",
    ]);
    expect(links.map((link) => link.textContent)).toEqual([
      "ProfileYour employee details and work schedule.",
      "HolidaysSee the company holiday calendar.",
      "My requestsTrack your attendance correction requests.",
    ]);
    expect(
      screen.queryByRole("link", { name: /^Today/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /^Attendance history/ }),
    ).not.toBeInTheDocument();
  });

  it("keeps the customization recovery link when every shortcut is hidden", () => {
    preferences(
      allShortcuts.map((shortcut) => ({ ...shortcut, visible: false })),
    );
    renderWithIntl(<HrShortcuts />, { locale: "en" });

    expect(
      screen.getByText(
        "All shortcuts are hidden. Use Customize shortcuts to show them again.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(
      screen.getByRole("link", { name: "Customize shortcuts" }),
    ).toHaveAttribute("href", "/hr/customize");
  });

  it.each([
    { name: "loading", outcome: undefined, testId: "panel-LOADING" },
    {
      name: "denied",
      outcome: {
        ok: false,
        requestId: "shortcut-denied",
        denial: {
          kind: "AUTHORIZATION_DENIED",
          code: "FORBIDDEN",
          requestId: "shortcut-denied",
          message: "Access denied",
        },
      } satisfies TenantOutcome<Preferences>,
      testId: "panel-DENIED",
    },
    {
      name: "not linked",
      outcome: {
        ok: true,
        requestId: "shortcut-not-linked",
        value: { ok: false, code: "HR_NOT_LINKED" },
      } satisfies TenantOutcome<Preferences>,
      testId: undefined,
    },
  ])(
    "does not substitute default preference cards while $name",
    ({ outcome, testId }) => {
      state.queries.set(getFunctionName(hrRefs.shortcutPreferences), outcome);
      renderWithIntl(<HrShortcuts />, { locale: "en" });

      expect(screen.getAllByRole("link")).toHaveLength(1);
      expect(
        screen.getByRole("link", { name: "Customize shortcuts" }),
      ).toHaveAttribute("href", "/hr/customize");
      expect(
        screen.queryByText(
          "All shortcuts are hidden. Use Customize shortcuts to show them again.",
        ),
      ).not.toBeInTheDocument();
      if (testId) {
        expect(screen.getByTestId(testId)).toBeInTheDocument();
        if (testId === "panel-DENIED") {
          expect(screen.getByRole("alert")).toHaveTextContent(
            "shortcut-denied",
          );
        }
      } else {
        expect(
          screen.getByText("Link an employee profile to customize shortcuts."),
        ).toBeInTheDocument();
      }
    },
  );
});

describe("HrShortcutCards", () => {
  it("reuses the visible card presentation in preview without navigable destinations", () => {
    const shortcuts = [
      { key: "hr.holidays", visible: true },
      { key: "hr.today", visible: false },
      { key: "hr.requests", visible: true },
    ];
    const view = renderWithIntl(<HrShortcutCards shortcuts={shortcuts} />, {
      locale: "en",
      preserveProviders: true,
    });
    const cards = screen.getAllByRole("link");
    const presentation = cards.map((card) =>
      Array.from(card.children)
        .slice(0, 2)
        .map((child) => child.outerHTML),
    );
    expect(cards.map((card) => card.getAttribute("href"))).toEqual([
      "/hr/holidays",
      "/hr/requests",
    ]);

    view.rerender(<HrShortcutCards shortcuts={shortcuts} preview />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(view.container.querySelector("[href]")).toBeNull();
    expect(screen.queryByText("Today")).not.toBeInTheDocument();
    const previewCards = Array.from(view.container.firstElementChild!.children);
    expect(
      previewCards.map((card) =>
        Array.from(card.children).map((child) => child.outerHTML),
      ),
    ).toEqual(presentation);
    expect(
      within(previewCards[0] as HTMLElement).getByText("Holidays"),
    ).toBeInTheDocument();
    expect(
      within(previewCards[1] as HTMLElement).getByText("My requests"),
    ).toBeInTheDocument();
  });
});
