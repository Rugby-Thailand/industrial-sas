import { act, fireEvent, render, screen } from "@testing-library/react";
import { use, useState, type ComponentProps } from "react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, expect, it, vi } from "vitest";
import { messagesFor } from "@/i18n/messages";

const mocks = vi.hoisted(() => ({
  pending: false,
  pathname: "/en/finished-goods",
  search: "",
  push: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("next/link", () => ({
  useLinkStatus: () => ({ pending: mocks.pending }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock("@/i18n/navigationBase", () => ({
  Link: ({
    children,
    onNavigate,
    ...props
  }: ComponentProps<"a"> & {
    onNavigate?: (event: { preventDefault: () => void }) => void;
  }) => (
    <a
      {...props}
      onClick={(event) => {
        event.preventDefault();
        onNavigate?.({ preventDefault: () => {} });
      }}
    >
      {children}
    </a>
  ),
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
}));

import { Link, useRouter } from "@/i18n/navigationClient";
import {
  NavigationContent,
  NavigationProgressProvider,
} from "./NavigationProgress";

function shell(children: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={messagesFor("en")}>
      <NavigationProgressProvider>{children}</NavigationProgressProvider>
    </NextIntlClientProvider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.pending = false;
  mocks.pathname = "/en/finished-goods";
  mocks.search = "";
  window.history.replaceState({}, "", mocks.pathname);
});

it("shows loading immediately for a pending link and retains the old editor until navigation settles", () => {
  const content = () => (
    <>
      <Link href="/hr/profile">Profile</Link>
      <NavigationContent>
        <input aria-label="Draft" defaultValue="unsaved" />
      </NavigationContent>
    </>
  );
  const view = render(shell(content()));
  const draft = screen.getByRole("textbox", { name: "Draft" });
  mocks.pending = true;
  view.rerender(shell(content()));
  expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  expect(draft).not.toBeVisible();
  mocks.pending = false;
  view.rerender(shell(content()));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(draft).toBeVisible();
  expect(draft).toHaveValue("unsaved");
});

it("shows loading for programmatic navigation while the route suspends, then reveals the destination", async () => {
  let finish!: () => void;
  const route = new Promise<void>((resolve) => {
    finish = resolve;
  });
  function Destination() {
    use(route);
    return <h1>Destination</h1>;
  }
  function Page() {
    const [next, setNext] = useState(false);
    const router = useRouter();
    mocks.push.mockImplementation(() => setNext(true));
    return (
      <>
        <button onClick={() => router.push("/hr/profile")}>Navigate</button>
        <NavigationContent>
          {next ? <Destination /> : <h1>Original page</h1>}
        </NavigationContent>
      </>
    );
  }
  render(shell(<Page />));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Navigate" }));
  });
  expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  expect(
    screen.queryByRole("heading", { name: "Original page" }),
  ).not.toBeInTheDocument();
  await act(async () => {
    finish();
    await route;
  });
  expect(screen.getByRole("heading", { name: "Destination" })).toBeVisible();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("keeps replacements at the same app history depth and records pushes and Back", () => {
  const view = render(
    shell(
      <Link href="/hr/profile" replace>
        Profile
      </Link>,
    ),
  );
  expect(window.history.state.appNavigationIndex).toBe(0);
  fireEvent.click(screen.getByRole("link", { name: "Profile" }));
  window.history.replaceState({ __NA: true }, "", "/en/hr/profile");
  mocks.pathname = "/en/hr/profile";
  view.rerender(shell(<Link href="/hr/employees">Employees</Link>));
  expect(window.history.state.appNavigationIndex).toBe(0);
  fireEvent.click(screen.getByRole("link", { name: "Employees" }));
  window.history.pushState({ __NA: true }, "", "/en/hr/employees");
  mocks.pathname = "/en/hr/employees";
  view.rerender(shell(<p>Employees</p>));
  expect(window.history.state.appNavigationIndex).toBe(1);
  window.history.replaceState(
    { __NA: true, appNavigationIndex: 0 },
    "",
    "/en/hr/profile",
  );
  mocks.pathname = "/en/hr/profile";
  view.rerender(shell(<p>Profile</p>));
  expect(window.history.state.appNavigationIndex).toBe(0);
});
