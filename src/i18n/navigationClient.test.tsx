import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";

import { messagesFor } from "./messages";

const state = vi.hoisted(() => ({
  pending: false,
  pathname: "/en/hr/employees",
}));

vi.mock("next/link", () => ({
  useLinkStatus: () => ({ pending: state.pending }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
}));
vi.mock("@/i18n/navigationBase", () => ({
  Link: ({ children, href }: ComponentProps<typeof Link>) => (
    <a href={typeof href === "string" ? href : (href.pathname ?? "")}>
      {children}
    </a>
  ),
  // The installed next-intl implementation was independently verified with
  // this app's localePrefix: "always": it prefixes absolute local paths,
  // including ones already bearing /en, and preserves query/fragment strings.
  getPathname: ({ href, locale }: { href: string; locale: string }) =>
    href.startsWith("/") ? `/${locale}${href}` : href,
}));

import {
  NavigationContent,
  NavigationProgressProvider,
} from "@/components/system/NavigationProgress";
import { Link } from "./navigationClient";

function shell(children: ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={messagesFor("en")}>
      <NavigationProgressProvider>{children}</NavigationProgressProvider>
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  state.pending = false;
  state.pathname = "/en/hr/employees";
  window.history.replaceState({}, "", state.pathname);
});

it.each([
  "/hr/employees?mode=new",
  "?mode=new",
  "#details",
  { pathname: "/hr/employees", query: { mode: "new" } },
  { query: { mode: "new" } },
  { hash: "details" },
])(
  "keeps the current editor visible while the same-page link %j is pending",
  (href) => {
    const content = () => (
      <>
        <Link href={href}>Open editor</Link>
        <NavigationContent>
          <input aria-label="Employee draft" defaultValue="unsaved" />
        </NavigationContent>
      </>
    );
    const view = render(shell(content()));
    const draft = screen.getByRole("textbox", { name: "Employee draft" });
    state.pending = true;
    view.rerender(shell(content()));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(draft).toBeVisible();
    expect(draft).toHaveValue("unsaved");
  },
);

it("shows route loading when a link changes the locale", () => {
  const content = () => (
    <>
      <Link href={{ pathname: "/hr/employees" }} locale="th">
        Thai employees
      </Link>
      <NavigationContent>
        <input aria-label="Employee draft" defaultValue="unsaved" />
      </NavigationContent>
    </>
  );
  const view = render(shell(content()));
  const draft = screen.getByRole("textbox", { name: "Employee draft" });
  state.pending = true;
  view.rerender(shell(content()));
  expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  expect(draft).not.toBeVisible();
});
