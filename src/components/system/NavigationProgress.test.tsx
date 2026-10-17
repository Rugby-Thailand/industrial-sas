import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  StrictMode,
  startTransition,
  use,
  useState,
  type ComponentProps,
} from "react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { messagesFor } from "@/i18n/messages";

const mocks = vi.hoisted(() => ({
  pending: false,
  pathname: "/en/finished-goods",
  search: "",
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
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
  useRouter: () => ({
    push: mocks.push,
    replace: mocks.replace,
    back: mocks.back,
  }),
  getPathname: ({ href, locale }: { href: string; locale: string }) =>
    href.startsWith("/") ? `/${locale}${href}` : href,
}));

import { Link, useRouter } from "@/i18n/navigationClient";
import { PageBackButton } from "@/components/ui/PageBackButton";
import {
  registerNavigationGuardOwner,
  registerHistoryBackHandler,
  announceNavigationBlocked,
} from "@/lib/navigationGuard";
import {
  updateBrowserQuery,
  updateHistoryMetadata,
} from "@/lib/browser/history";
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
  vi.spyOn(window.history, "back").mockImplementation(mocks.back);
});
afterEach(() => vi.restoreAllMocks());

it("shows Back feedback only after consent and prevents duplicate traversal before popstate", () => {
  window.history.replaceState(
    { __NA: true, appNavigationIndex: 1 },
    "",
    mocks.pathname,
  );
  let permitted: (() => void) | undefined;
  const release = registerNavigationGuardOwner({
    requestTransition: (action) => {
      permitted = action;
    },
    isTraversing: () => false,
  });
  try {
    render(
      shell(
        <>
          <PageBackButton fallbackHref="/hr/profile" />
          <NavigationContent>
            <h1>Catalogue</h1>
          </NavigationContent>
        </>,
      ),
    );
    const back = screen.getByRole("button", { name: "Back" });
    fireEvent.click(back);
    expect(back).toBeEnabled();
    expect(back).not.toHaveAttribute("aria-busy", "true");
    expect(mocks.back).not.toHaveBeenCalled();
    act(() => permitted?.());
    expect(back).toHaveAttribute("aria-busy", "true");
    expect(back).toHaveAttribute("aria-disabled", "true");
    expect(back.querySelector('[data-slot="spinner"]')).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Catalogue" })).toBeVisible();
    fireEvent.click(back);
    expect(mocks.back).toHaveBeenCalledOnce();
    act(() =>
      window.dispatchEvent(
        new PopStateEvent("popstate", { state: window.history.state }),
      ),
    );
    expect(back).toBeEnabled();
    expect(back).not.toHaveAttribute("aria-busy", "true");
  } finally {
    release();
  }
});

it("does not start route feedback when Back dismisses a foreground", () => {
  const dismiss = vi.fn(() => true);
  const release = registerHistoryBackHandler(dismiss);
  try {
    render(
      shell(
        <>
          <PageBackButton fallbackHref={null} />
          <NavigationContent>
            <h1>Editor</h1>
          </NavigationContent>
        </>,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(dismiss).toHaveBeenCalledOnce();
    expect(mocks.back).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Back" })).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  } finally {
    release();
  }
});

it("keeps a same-page Back visible and clears its spinner when query and hash are restored", () => {
  window.history.replaceState(
    { __NA: true, appNavigationIndex: 1 },
    "",
    mocks.pathname + "?fg=filtered#products",
  );
  render(
    shell(
      <>
        <PageBackButton fallbackHref={null} />
        <NavigationContent>
          <h1>Catalogue</h1>
        </NavigationContent>
      </>,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByRole("heading", { name: "Catalogue" })).toBeVisible();
  act(() => {
    window.history.replaceState(
      { __NA: true, appNavigationIndex: 0 },
      "",
      mocks.pathname + "?fg=original#stock",
    );
    window.dispatchEvent(
      new PopStateEvent("popstate", { state: window.history.state }),
    );
  });
  expect(screen.getByRole("heading", { name: "Catalogue" })).toBeVisible();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(window.location.search + window.location.hash).toBe(
    "?fg=original#stock",
  );
});

it("releases requested Back feedback when a newer draft blocks native traversal", () => {
  window.history.replaceState(
    { __NA: true, appNavigationIndex: 1 },
    "",
    mocks.pathname,
  );
  render(
    shell(
      <>
        <PageBackButton fallbackHref="/hr/profile" />
        <NavigationContent>
          <h1>Editor</h1>
        </NavigationContent>
      </>,
    ),
  );
  const back = screen.getByRole("button", { name: "Back" });
  fireEvent.click(back);
  expect(back).toHaveAttribute("aria-disabled", "true");
  act(() => announceNavigationBlocked());
  expect(back).toBeEnabled();
  expect(back).not.toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("heading", { name: "Editor" })).toBeVisible();
});

it("releases requested Back feedback when Forward restores the document from browser cache", () => {
  window.history.replaceState(
    { __NA: true, appNavigationIndex: 1 },
    "",
    mocks.pathname,
  );
  render(shell(<PageBackButton fallbackHref="/hr/profile" />));
  const back = screen.getByRole("button", { name: "Back" });
  fireEvent.click(back);
  expect(back).toHaveAttribute("aria-busy", "true");
  act(() =>
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    ),
  );
  expect(back).toBeEnabled();
  expect(back).not.toHaveAttribute("aria-busy", "true");
});

it("hands Back feedback to the route loader until the restored route commits", () => {
  window.history.replaceState(
    { __NA: true, appNavigationIndex: 1 },
    "",
    mocks.pathname,
  );
  const content = (title: string) => (
    <>
      <PageBackButton fallbackHref="/hr/profile" />
      <NavigationContent>
        <h1>{title}</h1>
      </NavigationContent>
    </>
  );
  const view = render(shell(content("Catalogue")));
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  act(() => {
    window.history.replaceState(
      { __NA: true, appNavigationIndex: 0 },
      "",
      "/en/hr/profile?from=back#details",
    );
    window.dispatchEvent(
      new PopStateEvent("popstate", { state: window.history.state }),
    );
  });
  expect(screen.getByRole("status")).toHaveTextContent("Loading");
  expect(
    screen.getByRole("status").querySelector('[data-slot="spinner"]'),
  ).not.toBeNull();
  mocks.pathname = "/en/hr/profile";
  view.rerender(shell(content("Profile")));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Profile" })).toBeVisible();
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

it("clears completed Back navigation before leaving and returning to the scan page", () => {
  const content = (name: string) => (
    <>
      <Link href="/finished-goods">Finished goods</Link>
      <Link href="/finished-goods/scan">Scan job tickets</Link>
      <NavigationContent>
        <h1>{name}</h1>
      </NavigationContent>
    </>
  );
  const view = render(shell(content("Finished goods")));
  act(() => {
    window.history.replaceState({ __NA: true }, "", "/en/finished-goods/scan");
    window.dispatchEvent(
      new PopStateEvent("popstate", { state: window.history.state }),
    );
  });
  expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  mocks.pathname = "/en/finished-goods/scan";
  view.rerender(shell(content("Scan job tickets")));
  expect(
    screen.getByRole("heading", { name: "Scan job tickets" }),
  ).toBeVisible();

  fireEvent.click(screen.getByRole("link", { name: "Finished goods" }));
  mocks.pathname = "/en/finished-goods";
  window.history.pushState({}, "", mocks.pathname);
  view.rerender(shell(content("Finished goods")));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Finished goods" })).toBeVisible();

  fireEvent.click(screen.getByRole("link", { name: "Scan job tickets" }));
  mocks.pathname = "/en/finished-goods/scan";
  window.history.pushState({}, "", mocks.pathname);
  view.rerender(shell(content("Scan job tickets")));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Scan job tickets" }),
  ).toBeVisible();
});

it("lets a sidebar navigation supersede a pending history destination", () => {
  const content = (name: string) => (
    <>
      <Link href="/finished-goods/scan">Scan job tickets</Link>
      <NavigationContent>
        <h1>{name}</h1>
      </NavigationContent>
    </>
  );
  const view = render(shell(content("Finished goods")));
  act(() => {
    window.history.replaceState({ __NA: true }, "", "/en/hr/profile");
    window.dispatchEvent(
      new PopStateEvent("popstate", { state: window.history.state }),
    );
  });
  expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");

  fireEvent.click(screen.getByRole("link", { name: "Scan job tickets" }));
  mocks.pathname = "/en/finished-goods/scan";
  window.history.pushState({}, "", mocks.pathname);
  view.rerender(shell(content("Scan job tickets")));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Scan job tickets" }),
  ).toBeVisible();
});

it("preserves Back after Next rewrites the current entry when its active link is clicked again", () => {
  window.history.replaceState(
    { __NA: true, appNavigationIndex: 2 },
    "",
    mocks.pathname,
  );
  render(
    shell(
      <>
        <Link href="/finished-goods">Finished goods</Link>
        <PageBackButton fallbackHref="/master-data/storage-layouts" />
      </>,
    ),
  );
  fireEvent.click(screen.getByRole("link", { name: "Finished goods" }));
  // Next also replaces history on same-URL refreshes: pathname/search do not
  // change, so an effect subscribed only to them cannot restore our metadata.
  act(() => {
    window.history.replaceState({ __NA: true }, "", mocks.pathname);
  });
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(mocks.back).toHaveBeenCalledOnce();
  expect(mocks.replace).not.toHaveBeenCalled();
  expect(window.history.state.appNavigationIndex).toBe(2);
});

it("tracks hash navigation and restores its depth when Next replaces the same entry", () => {
  render(shell(<Link href="/finished-goods#products">Products</Link>));
  fireEvent.click(screen.getByRole("link", { name: "Products" }));
  act(() => {
    window.history.pushState({ __NA: true }, "", `${mocks.pathname}#products`);
    window.history.replaceState(
      { __NA: true },
      "",
      `${mocks.pathname}#products`,
    );
  });
  expect(window.history.state.appNavigationIndex).toBe(1);
});

it("does not add duplicate history steps for an unchanged query", () => {
  render(shell(<p>Catalogue</p>));
  const push = vi.spyOn(window.history, "pushState");
  act(() => updateBrowserQuery(() => {}, { mode: "push" }));
  expect(push).not.toHaveBeenCalled();
  expect(window.history.state.appNavigationIndex).toBe(0);
  push.mockRestore();
});

it("reveals the committed page when a history destination redirects to a different route", () => {
  const view = render(
    shell(
      <NavigationContent>
        <h1>Original</h1>
      </NavigationContent>,
    ),
  );
  act(() => {
    window.history.replaceState({ __NA: true }, "", "/en/hr");
    window.dispatchEvent(
      new PopStateEvent("popstate", { state: window.history.state }),
    );
  });
  expect(screen.getByRole("status")).toBeInTheDocument();
  mocks.pathname = "/en/hr/today";
  window.history.replaceState({ __NA: true }, "", mocks.pathname);
  view.rerender(
    shell(
      <NavigationContent>
        <h1>Today</h1>
      </NavigationContent>,
    ),
  );
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Today" })).toBeVisible();
});

it("counts a real push once in Strict Mode and stops tracking after the shell unmounts", () => {
  const view = render(<StrictMode>{shell(<p>Catalogue</p>)}</StrictMode>);
  act(() => window.history.pushState({ __NA: true }, "", "/en/hr/profile"));
  expect(window.history.state.appNavigationIndex).toBe(1);
  view.unmount();
  window.history.pushState({ __NA: true }, "", "/en/hr/today");
  expect(window.history.state.appNavigationIndex).toBeUndefined();
});

it("keeps a draft buffer at its page depth and permits intentional metadata removal", () => {
  render(shell(<p>Catalogue</p>));
  act(() => {
    window.history.pushState(
      { ...window.history.state, __storageWorkspaceGuard: "draft" },
      "",
      window.location.href,
    );
    window.history.replaceState(
      { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { tree: "refreshed" } },
      "",
      window.location.href,
    );
  });
  expect(window.history.state.appNavigationIndex).toBe(0);
  expect(window.history.state.__storageWorkspaceGuard).toBe("draft");
  expect(window.history.state.__PRIVATE_NEXTJS_INTERNALS_TREE).toEqual({
    tree: "refreshed",
  });
  act(() =>
    updateHistoryMetadata((state) => {
      delete state.__storageWorkspaceGuard;
    }),
  );
  expect(window.history.state.__storageWorkspaceGuard).toBeUndefined();
});

it("does not hide the page for a native history entry that Next cannot restore", () => {
  render(
    shell(
      <NavigationContent>
        <h1>Current page</h1>
      </NavigationContent>,
    ),
  );
  act(() => {
    window.history.replaceState(null, "", "/en/hr/profile#main-content");
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
  });
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Current page" })).toBeVisible();
});

it.each([
  "/finished-goods?fg=filtered",
  "#products",
  { pathname: "/finished-goods", query: { fg: "filtered" } },
])(
  "keeps the current page visible while a same-page link to %j is pending",
  (href) => {
    const content = () => (
      <>
        <Link href={href}>Filter</Link>
        <NavigationContent>
          <h1>Catalogue</h1>
        </NavigationContent>
      </>
    );
    const view = render(shell(content()));
    mocks.pending = true;
    view.rerender(shell(content()));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Catalogue" })).toBeVisible();
  },
);

it("still shows progress when a same-page link changes locale", () => {
  const content = () => (
    <>
      <Link href="/finished-goods" locale="th">
        Thai
      </Link>
      <NavigationContent>
        <h1>Catalogue</h1>
      </NavigationContent>
    </>
  );
  const view = render(shell(content()));
  mocks.pending = true;
  view.rerender(shell(content()));
  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Catalogue", hidden: true }),
  ).not.toBeVisible();
});

it("keeps the original record visible while a programmatic query-only navigation suspends", async () => {
  let finish!: () => void;
  const route = new Promise<void>((resolve) => {
    finish = resolve;
  });
  function Record() {
    use(route);
    return <h1>Selected record</h1>;
  }
  function Page() {
    const [next, setNext] = useState(false);
    const router = useRouter();
    // Next's router starts its own transition; query changes must not also
    // trigger the shell's full-page loading cover.
    mocks.push.mockImplementation(() => startTransition(() => setNext(true)));
    return (
      <>
        <button onClick={() => router.push("/finished-goods?record=second")}>
          Select record
        </button>
        <NavigationContent>
          {next ? <Record /> : <h1>Original record</h1>}
        </NavigationContent>
      </>
    );
  }
  render(shell(<Page />));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Select record" }));
  });
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Original record" }),
  ).toBeVisible();
  await act(async () => {
    finish();
    await route;
  });
  expect(
    screen.getByRole("heading", { name: "Selected record" }),
  ).toBeVisible();
});

// Keep last: it leaves the captured wrapper installed, as Next's Router would.
it("passes through a wrapper Next captured and reactivates it on remount without stacking", () => {
  const view = render(shell(<p>Catalogue</p>));
  // Next's Router effect runs after the shell and wraps whatever it finds.
  const captured = window.history.pushState;
  const nextPatch: History["pushState"] = (data, unused, url) =>
    captured.call(window.history, data, unused, url);
  window.history.pushState = nextPatch;
  view.unmount();
  expect(window.history.pushState).toBe(nextPatch);
  act(() => window.history.pushState({ __NA: true }, "", "/en/hr/profile"));
  expect(window.history.state.appNavigationIndex).toBeUndefined();

  const again = render(shell(<p>Profile</p>));
  expect(window.history.pushState).toBe(nextPatch);
  expect(window.history.state.appNavigationIndex).toBe(0);
  act(() => window.history.pushState({ __NA: true }, "", "/en/hr/today"));
  expect(window.history.state.appNavigationIndex).toBe(1);
  again.unmount();
});
