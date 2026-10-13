import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  startTransition,
  useState,
  useSyncExternalStore,
  type ComponentProps,
} from "react";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import type { createMutableActionQueue as CreateMutableActionQueue } from "next/dist/client/components/app-router-instance";
import type {
  AppRouterState,
  ReducerState,
} from "next/dist/client/components/router-reducer/router-reducer-types";

const route = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  locale: "en" as "en" | "th",
  mobile: true,
}));
const routeEvent = "test-router-commit";
function subscribeRoute(listener: () => void) {
  window.addEventListener("popstate", listener);
  window.addEventListener(routeEvent, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(routeEvent, listener);
  };
}
function useRoutePath() {
  return useSyncExternalStore(subscribeRoute, () => window.location.pathname);
}

vi.mock("next/navigation", () => ({
  usePathname: () => useRoutePath(),
}));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => useRoutePath().replace(/^\/(en|th)(?=\/|$)/, ""),
  useRouter: () => route,
  Link: ({
    href,
    onClick,
    prefetch: _prefetch,
    onNavigate,
    locale,
    ...props
  }: ComponentProps<"a"> & {
    prefetch?: boolean;
    locale?: string;
    onNavigate?: (event: { preventDefault: () => void }) => void;
  }) => (
    <a
      {...props}
      href={`/${locale ?? route.locale}${href}`}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        if (
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          event.button !== 0
        )
          return;
        let cancelled = false;
        onNavigate?.({
          preventDefault: () => {
            cancelled = true;
          },
        });
        if (!cancelled) route.push(href);
      }}
    />
  ),
}));
vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useAction: () => vi.fn(),
  useConvex: () => ({ query: vi.fn() }),
}));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    userId: "user-a",
    orgId: "org-a",
    getToken: async () => "test-token",
  }),
}));
vi.mock("@/components/providers/AiUsageAccessProvider", () => ({
  useAiUsageAccess: () => ({ status: "READY", permissions: [] }),
}));
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => ({
    status: "READY",
    permissions: ["hr.self.access", "hr.team.review", "hr.admin.manage"],
    identityKey: "org-a:user-a",
    organizationName: "Demo Co",
    today: "2026-10-13",
    timezone: "Asia/Bangkok",
    timezoneSupported: true,
    sites: [],
  }),
}));
vi.mock("@/components/providers/WorkspaceProvider", () => ({
  useWorkspace: () => ({
    readiness: { kind: "READY_TO_QUERY" },
    organization: { id: "org-a", name: "Demo Co" },
    warehouses: [{ id: "wh-1", code: "WH-1", name: "Main warehouse" }],
    selectedWarehouseId: "wh-1",
    selectable: true,
    complete: true,
    loading: false,
    failed: false,
    denied: false,
    navigationPermissions: ["masterData.storageLayout.read"],
    permissionsReady: true,
    selectWarehouse: vi.fn(),
  }),
}));
vi.mock("@/components/shell/AccountButton", () => ({
  AccountButton: () => null,
}));
vi.mock("@/components/shell/HrLandingRedirect", () => ({
  HrLandingRedirect: () => null,
}));
vi.mock("@/components/shell/NavigationPendingIndicator", () => ({
  NavigationPendingIndicator: () => null,
}));

import { Pattern } from "./c-sidebar-2";
import { useDraftGuard } from "@/components/providers/draftGuard";

function initialRouterState(): AppRouterState {
  return {
    tree: ["", {}],
    cache: {
      rsc: null,
      prefetchRsc: null,
      prefetchHead: null,
      head: null,
      slots: null,
      scrollRef: null,
      bfcacheId: 0,
    },
    pushRef: {
      pendingPush: false,
      mpaNavigation: false,
      preserveCustomHistoryState: false,
    },
    focusAndScrollRef: {
      scrollRef: null,
      forceScroll: false,
      hashFragment: null,
      onlyHashChange: false,
    },
    canonicalUrl: window.location.href,
    renderedSearch: "",
    nextUrl: null,
    previousNextUrl: null,
    debugInfo: null,
  };
}
// Use this installed Next version's actual queue: a RESTORE supersedes a
// pending NAVIGATE. Only fetching/rendering destination RSC is substituted.
// The standalone module imports RSC bundler aliases unavailable to Vitest.
// Evaluate its unmodified queue with only the dependencies that dispatch uses;
// the server reducer is supplied below, so no RSC runtime is needed.
const nextQueueExports: {
  createMutableActionQueue?: typeof CreateMutableActionQueue;
} = {};
runInNewContext(
  readFileSync(
    createRequire(import.meta.url).resolve(
      "next/dist/client/components/app-router-instance.js",
    ),
    "utf8",
  ),
  {
    exports: nextQueueExports,
    module: { exports: nextQueueExports },
    Promise,
    process: { env: {} },
    require: (name: string) => {
      if (name === "react") return { startTransition };
      if (name.endsWith("router-reducer-types"))
        return {
          ACTION_NAVIGATE: "navigate",
          ACTION_RESTORE: "restore",
          ACTION_REFRESH: "refresh",
          ACTION_SERVER_ACTION: "server-action",
        };
      if (name.endsWith("is-thenable"))
        return { isThenable: (value: unknown) => value instanceof Promise };
      return {};
    },
  },
);
if (!nextQueueExports.createMutableActionQueue)
  throw new Error("Installed Next queue is unavailable");
const routerQueue =
  nextQueueExports.createMutableActionQueue(initialRouterState());
let finishDestination: (() => void) | undefined;
function commitRouterState(next: ReducerState) {
  if (next instanceof Promise) {
    void next.then(commitRouterState);
    return;
  }
  if (next.pushRef.pendingPush) {
    window.history[
      next.canonicalUrl === window.location.href ? "replaceState" : "pushState"
    ]({ __NA: true }, "", next.canonicalUrl);
  }
  window.dispatchEvent(new Event(routeEvent));
}
function restoreRouter() {
  routerQueue.dispatch(
    {
      type: "restore",
      url: new URL(window.location.href),
      historyState: undefined,
    },
    commitRouterState,
  );
}
const pendingRestorations = new Set<ReturnType<typeof setTimeout>>();
function restoreAfterForegroundListeners() {
  // Browsers run a microtask checkpoint between native event listeners. Next's
  // parent effect observes popstate after the foreground subscriber has closed
  // its surface and run layout effects. jsdom dispatch is synchronous instead;
  // let those effects/microtasks finish before replaying the later Next listener.
  const timer = setTimeout(() => {
    pendingRestorations.delete(timer);
    restoreRouter();
  }, 0);
  pendingRestorations.add(timer);
}

const originalMatchMedia = window.matchMedia;
beforeEach(() => {
  route.locale = "en";
  route.mobile = true;
  window.history.replaceState(
    { __NA: true, appNavigationIndex: 0 },
    "",
    "/en/finished-goods/scan?location=wh-1#scanner",
  );
  routerQueue.state = initialRouterState();
  routerQueue.pending = null;
  routerQueue.last = null;
  finishDestination = undefined;
  routerQueue.action = (state, action) => {
    if (action.type === "navigate") {
      return new Promise((resolve) => {
        finishDestination = () =>
          resolve({
            ...state,
            canonicalUrl: action.url.href,
            pushRef: { ...state.pushRef, pendingPush: true },
          });
      });
    }
    return {
      ...state,
      canonicalUrl: window.location.href,
      pushRef: { ...state.pushRef, pendingPush: false },
    };
  };
  window.addEventListener("popstate", restoreAfterForegroundListeners);
  route.push
    .mockReset()
    .mockImplementation((href: string, options?: { locale?: string }) => {
      routerQueue.dispatch(
        {
          type: "navigate",
          url: new URL(
            `/${options?.locale ?? route.locale}${href}`,
            window.location.href,
          ),
          isExternalUrl: false,
          locationSearch: window.location.search,
          navigateType: "push",
          scrollBehavior: 0,
        },
        commitRouterState,
      );
    });
  route.replace.mockReset();
  window.matchMedia = (query) => ({
    matches: query.includes("width") && route.mobile,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  });
});
afterEach(() => {
  cleanup();
  window.removeEventListener("popstate", restoreAfterForegroundListeners);
  for (const timer of pendingRestorations) clearTimeout(timer);
  pendingRestorations.clear();
  window.matchMedia = originalMatchMedia;
});

function Destination({
  dirty = false,
  pending = false,
}: {
  dirty?: boolean;
  pending?: boolean;
}) {
  const pathname = useRoutePath();
  const [draft, setDraft] = useState(dirty ? "Keep this scan note" : "");
  useDraftGuard(draft !== "", () => setDraft(""), pending);
  return (
    <>
      <h1>{pathname}</h1>
      <input
        aria-label="Scan note"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
    </>
  );
}

function todayLink(container: HTMLElement) {
  const queries = within(container);
  if (!queries.queryByRole("link", { name: /Today/ }))
    fireEvent.click(queries.getByRole("button", { name: "Attendance" }));
  return queries.getByRole("link", { name: /Today/ });
}

it("mobile sidebar navigation reaches its destination after consuming the drawer history entry", async () => {
  renderWithIntl(
    <Pattern>
      <Destination />
    </Pattern>,
    { locale: "en" },
  );
  fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
  const drawer = await screen.findByRole("dialog", {
    name: "Primary navigation",
  });
  fireEvent.click(todayLink(drawer));
  await settleDestination();
  expect(window.location.pathname).toBe("/en/hr/today");
  expect(screen.getByRole("heading", { name: "/en/hr/today" })).toBeVisible();
  expect(
    screen.queryByRole("dialog", { name: "Primary navigation" }),
  ).not.toBeInTheDocument();

  act(() => window.history.back());
  await waitFor(() =>
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe("/en/finished-goods/scan?location=wh-1#scanner"),
  );
  expect(
    screen.queryByRole("dialog", { name: "Primary navigation" }),
  ).not.toBeInTheDocument();
});

async function settleDestination() {
  // Wait on the navigation protocol, not elapsed wall time. A discarded
  // NAVIGATE never satisfies this barrier, even after its server data arrives.
  await waitFor(
    () => {
      expect(finishDestination).toBeDefined();
      expect(routerQueue.pending?.payload.type).toBe("navigate");
      expect(pendingRestorations.size).toBe(0);
      expect(
        [...new URLSearchParams(window.location.search).keys()].some((key) =>
          key.startsWith("overlay"),
        ),
      ).toBe(false);
    },
    { timeout: 3000 },
  );
  await act(async () => finishDestination?.());
}

it.each([
  ["/finished-goods/scan/records", "en"],
  ["/master-data/storage-layouts", "en"],
  ["/finished-goods/scan/records", "th"],
  ["/master-data/storage-layouts", "th"],
] as const)(
  "mobile sidebar reaches %s in %s and Back/Forward preserve the source query and hash",
  async (destination, locale) => {
    route.locale = locale;
    const origin = `/${locale}/finished-goods/scan?location=wh-1&tag=a&tag=b#scanner`;
    window.history.replaceState(
      { __NA: true, appNavigationIndex: 0 },
      "",
      origin,
    );
    renderWithIntl(
      <Pattern>
        <Destination />
      </Pattern>,
      { locale },
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: locale === "en" ? "Open menu" : "เปิดเมนู",
      }),
    );
    const drawer = await screen.findByRole("dialog");
    const link = within(drawer)
      .getAllByRole("link")
      .find(
        (candidate) =>
          candidate.getAttribute("href") === `/${locale}${destination}`,
      );
    expect(link).toBeDefined();
    fireEvent.click(link!);
    await settleDestination();
    expect(window.location.pathname).toBe(`/${locale}${destination}`);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => window.history.back());
    await waitFor(() =>
      expect(
        window.location.pathname +
          window.location.search +
          window.location.hash,
      ).toBe(origin),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    act(() => window.history.forward());
    await waitFor(() =>
      expect(window.location.pathname).toBe(`/${locale}${destination}`),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  },
);

it("mobile sidebar keeps the draft after cancelling and reaches the chosen destination after discarding", async () => {
  renderWithIntl(
    <Pattern>
      <Destination dirty />
    </Pattern>,
    { locale: "en" },
  );
  fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
  let drawer = await screen.findByRole("dialog", {
    name: "Primary navigation",
  });
  fireEvent.click(todayLink(drawer));
  expect(
    await screen.findByRole("dialog", { name: "Save changes before leaving?" }),
  ).toBeVisible();
  expect(route.push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByLabelText("Scan note")).toHaveValue("Keep this scan note");
  expect(window.location.pathname).toBe("/en/finished-goods/scan");
  drawer = await screen.findByRole("dialog", { name: "Primary navigation" });
  fireEvent.click(todayLink(drawer));
  fireEvent.click(
    await screen.findByRole("button", { name: "Discard changes" }),
  );
  await settleDestination();
  expect(window.location.pathname).toBe("/en/hr/today");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  act(() => window.history.back());
  await waitFor(() =>
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe("/en/finished-goods/scan?location=wh-1#scanner"),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("mobile sidebar cannot leave while a scan write is pending", async () => {
  const view = renderWithIntl(
    <Pattern>
      <Destination />
    </Pattern>,
    { locale: "en", preserveProviders: true },
  );
  fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
  const drawer = await screen.findByRole("dialog", {
    name: "Primary navigation",
  });
  view.rerender(
    <Pattern>
      <Destination pending />
    </Pattern>,
  );
  fireEvent.click(todayLink(drawer));
  expect(
    await screen.findByRole("dialog", { name: "Save changes before leaving?" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Discard changes" }),
  ).toBeDisabled();
  expect(route.push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(window.location.pathname).toBe("/en/finished-goods/scan");
  expect(
    screen.getByRole("dialog", { name: "Primary navigation" }),
  ).toBeVisible();
});

it.each(["native Back", "Escape", "Close"])(
  "mobile drawer %s consumes its entry before the next Back leaves the scan page",
  async (close) => {
    const previous = "/en/hr/profile?section=personal#contact";
    window.history.replaceState(
      { __NA: true, appNavigationIndex: 0 },
      "",
      previous,
    );
    window.history.pushState(
      { __NA: true, appNavigationIndex: 1 },
      "",
      "/en/finished-goods/scan?location=wh-1#scanner",
    );
    renderWithIntl(
      <Pattern>
        <Destination />
      </Pattern>,
      { locale: "en" },
    );
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const drawer = await screen.findByRole("dialog", {
      name: "Primary navigation",
    });
    if (close === "native Back") act(() => window.history.back());
    else if (close === "Escape") fireEvent.keyDown(drawer, { key: "Escape" });
    else
      fireEvent.click(
        within(drawer).getAllByRole("button", { name: "Close menu" })[0]!,
      );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(window.location.search).toBe("?location=wh-1"));
    act(() => window.history.back());
    await waitFor(() =>
      expect(
        window.location.pathname +
          window.location.search +
          window.location.hash,
      ).toBe(previous),
    );
  },
);

it.each(["metaKey", "ctrlKey", "shiftKey", "altKey"])(
  "mobile sidebar preserves browser %s clicks without closing the drawer",
  async (modifier) => {
    renderWithIntl(
      <Pattern>
        <Destination />
      </Pattern>,
      { locale: "en" },
    );
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const drawer = await screen.findByRole("dialog", {
      name: "Primary navigation",
    });
    const before = window.location.href;
    fireEvent.click(todayLink(drawer), {
      [modifier]: true,
    });
    expect(route.push).not.toHaveBeenCalled();
    expect(drawer).toBeVisible();
    expect(window.location.href).toBe(before);
  },
);

it("mobile same-page menu selection consumes the drawer and the next Back returns to the earlier route", async () => {
  const previous = "/en/hr/profile?tab=personal#details";
  window.history.replaceState(
    { __NA: true, appNavigationIndex: 0 },
    "",
    previous,
  );
  window.history.pushState(
    { __NA: true, appNavigationIndex: 1 },
    "",
    "/en/finished-goods/scan",
  );
  renderWithIntl(
    <Pattern>
      <Destination />
    </Pattern>,
    { locale: "en" },
  );
  fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
  const drawer = await screen.findByRole("dialog", {
    name: "Primary navigation",
  });
  const currentPage = within(drawer)
    .getAllByRole("link")
    .find((link) => link.getAttribute("href") === "/en/finished-goods/scan");
  expect(currentPage).toBeDefined();
  fireEvent.click(currentPage!);
  await settleDestination();
  expect(window.location.pathname + window.location.search).toBe(
    "/en/finished-goods/scan",
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  act(() => window.history.back());
  await waitFor(() =>
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe(previous),
  );
});

it("remounting the mobile shell after navigation does not revive the consumed drawer on Back", async () => {
  const view = renderWithIntl(
    <Pattern>
      <Destination />
    </Pattern>,
    { locale: "en" },
  );
  fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
  const drawer = await screen.findByRole("dialog", {
    name: "Primary navigation",
  });
  fireEvent.click(todayLink(drawer));
  await settleDestination();
  expect(window.location.pathname).toBe("/en/hr/today");
  view.unmount();
  renderWithIntl(
    <Pattern>
      <Destination />
    </Pattern>,
    { locale: "en" },
  );
  act(() => window.history.back());
  await waitFor(() =>
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe("/en/finished-goods/scan?location=wh-1#scanner"),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("desktop sidebar navigation reaches its destination without creating a foreground entry", async () => {
  route.mobile = false;
  renderWithIntl(
    <Pattern>
      <Destination />
    </Pattern>,
    { locale: "en" },
  );
  fireEvent.click(todayLink(document.body));
  await settleDestination();
  expect(window.location.pathname).toBe("/en/hr/today");
  expect(window.location.search).toBe("");
  act(() => window.history.back());
  await waitFor(() =>
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe("/en/finished-goods/scan?location=wh-1#scanner"),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

async function chooseTodayFromSearch(beforeChoose?: () => void) {
  fireEvent.keyDown(window, { key: "k", metaKey: true });
  const input = await screen.findByRole("combobox", { name: "Search" });
  fireEvent.change(input, { target: { value: "Today" } });
  await screen.findByRole("option", { name: /Today/ });
  beforeChoose?.();
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Search" }), {
    key: "Enter",
  });
}

it("mobile Search result reaches its destination after consuming the dialog entry and Back restores the scan source", async () => {
  renderWithIntl(
    <Pattern>
      <Destination />
    </Pattern>,
    { locale: "en" },
  );
  await chooseTodayFromSearch();
  await settleDestination();
  expect(window.location.pathname).toBe("/en/hr/today");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  act(() => window.history.back());
  await waitFor(() =>
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe("/en/finished-goods/scan?location=wh-1#scanner"),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  act(() => window.history.forward());
  await waitFor(() => expect(window.location.pathname).toBe("/en/hr/today"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("mobile Search preserves a cancelled draft and consumes its dialog before the approved destination", async () => {
  renderWithIntl(
    <Pattern>
      <Destination dirty />
    </Pattern>,
    { locale: "en" },
  );
  await chooseTodayFromSearch();
  expect(
    await screen.findByRole("dialog", { name: "Save changes before leaving?" }),
  ).toBeVisible();
  expect(route.push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByLabelText("Scan note")).toHaveValue("Keep this scan note");
  expect(window.location.pathname).toBe("/en/finished-goods/scan");
  expect(
    screen.queryByRole("combobox", { name: "Search" }),
  ).not.toBeInTheDocument();
  await chooseTodayFromSearch();
  fireEvent.click(
    await screen.findByRole("button", { name: "Discard changes" }),
  );
  await settleDestination();
  expect(window.location.pathname).toBe("/en/hr/today");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  act(() => window.history.back());
  await waitFor(() =>
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe("/en/finished-goods/scan?location=wh-1#scanner"),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("mobile Search cannot discard a pending scan write or leave its page", async () => {
  const view = renderWithIntl(
    <Pattern>
      <Destination />
    </Pattern>,
    { locale: "en", preserveProviders: true },
  );
  await chooseTodayFromSearch(() =>
    view.rerender(
      <Pattern>
        <Destination pending />
      </Pattern>,
    ),
  );
  expect(
    await screen.findByRole("dialog", { name: "Save changes before leaving?" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Discard changes" }),
  ).toBeDisabled();
  expect(route.push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(window.location.pathname).toBe("/en/finished-goods/scan");
  expect(
    screen.queryByRole("combobox", { name: "Search" }),
  ).toBeInTheDocument();
});

it("mobile drawer Search waits for its native Back before opening the search dialog", async () => {
  renderWithIntl(
    <Pattern>
      <Destination />
    </Pattern>,
    { locale: "en" },
  );
  fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
  const drawer = await screen.findByRole("dialog", {
    name: "Primary navigation",
  });
  const before = window.location.href;
  const nativeBack = window.history.back.bind(window.history);
  const back = vi
    .spyOn(window.history, "back")
    .mockImplementationOnce(() => {});
  try {
    fireEvent.click(
      within(drawer).getByRole("button", { name: /^Search pages and records/ }),
    );
    expect(back).toHaveBeenCalledOnce();
    // Close focus and animations may finish while the browser has not popped.
    await act(async () => {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    });
    expect(screen.queryByRole("combobox", { name: "Search" })).toBeNull();
    expect(window.location.href).toBe(before);
  } finally {
    back.mockRestore();
    act(() => nativeBack());
  }
  const input = await screen.findByRole("combobox", { name: "Search" });
  expect(
    screen.queryByRole("dialog", { name: "Primary navigation" }),
  ).toBeNull();
  fireEvent.change(input, { target: { value: "Today" } });
  await screen.findByRole("option", { name: /Today/ });
  fireEvent.keyDown(input, { key: "Enter" });
  await settleDestination();
  expect(window.location.pathname).toBe("/en/hr/today");
  act(() => window.history.back());
  await waitFor(() =>
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe("/en/finished-goods/scan?location=wh-1#scanner"),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("mobile drawer Search waits for its exit animation and keeps search input focus", async () => {
  const computedStyle = window.getComputedStyle;
  // Browser computed styles are live. Keep the real Radix Presence mounted
  // after logical close until its CSS exit animation explicitly ends.
  const styles = vi
    .spyOn(window, "getComputedStyle")
    .mockImplementation((node, pseudo) => {
      const style = computedStyle(node, pseudo);
      if (node.getAttribute("data-slot") !== "sidebar") return style;
      return new Proxy(style, {
        get(target, key) {
          if (key === "animationName")
            return node.getAttribute("data-state") === "closed"
              ? "drawer-exit"
              : "none";
          return Reflect.get(target, key);
        },
      });
    });
  try {
    renderWithIntl(
      <Pattern>
        <Destination />
      </Pattern>,
      { locale: "en" },
    );
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const drawer = await screen.findByRole("dialog", {
      name: "Primary navigation",
    });
    const drawerKey = [
      ...new URLSearchParams(window.location.search).keys(),
    ].find((key) => key.startsWith("overlay"))!;
    fireEvent.click(
      within(drawer).getByRole("button", { name: /^Search pages and records/ }),
    );
    await waitFor(() => expect(drawer).toHaveAttribute("data-state", "closed"));
    await waitFor(() =>
      expect(new URLSearchParams(window.location.search).has(drawerKey)).toBe(
        false,
      ),
    );
    // History has settled, but the closing sheet still owns its focus scope.
    await act(async () => {
      await new Promise(requestAnimationFrame);
    });
    expect(screen.queryByRole("combobox", { name: "Search" })).toBeNull();
    const end = new Event("animationend", { bubbles: true });
    Object.defineProperty(end, "animationName", { value: "drawer-exit" });
    fireEvent(drawer, end);
    const input = await screen.findByRole("combobox", { name: "Search" });
    await waitFor(() => expect(input).toHaveFocus());
    expect(drawer).not.toBeInTheDocument();
  } finally {
    cleanup();
    styles.mockRestore();
  }
});
