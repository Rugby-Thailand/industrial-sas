import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";

const state = vi.hoisted(() => ({
  mobile: false,
  pathname: "/master-data/storage-layouts",
  push: vi.fn(),
  replace: vi.fn(),
  action: vi.fn(),
  oneShot: vi.fn(),
  selectWarehouse: vi.fn(),
  // The workspace and actor the shell is rendered for; reset per test.
  organizationId: "org-a",
  warehouseId: "wh-1",
  // An HR-only member: the warehouse workspace is refused.
  workspaceDenied: false,
  actorKey: "org-a:user-a",
  hrPermissions: [
    "hr.self.access",
    "hr.team.review",
    "hr.admin.manage",
    "hr.period.close",
  ],
  connection: {
    isWebSocketConnected: true,
    hasEverConnected: true,
    connectionCount: 1,
  },
  connectionListeners: new Set<() => void>(),
}));

// Search queries nothing until text is typed; static page results need none.
vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useAction: () => state.action,
  useConvex: () => ({
    query: state.oneShot,
    connectionState: () => state.connection,
    subscribeToConnectionState: (listener: () => void) => {
      state.connectionListeners.add(listener);
      return () => state.connectionListeners.delete(listener);
    },
  }),
}));
vi.mock("@/lib/ai/client", () => ({ interpretAiSearch: state.action }));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    userId: state.actorKey.split(":")[1],
    orgId: state.actorKey.split(":")[0],
    getToken: async () => "cached-convex-token",
  }),
}));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => state.pathname,
  useRouter: () => ({ push: state.push, replace: state.replace }),
  // Like next/link, a click is a client-side move, not a document load.
  Link: ({
    href,
    children,
    onClick,
    onNavigate,
    ...rest
  }: {
    readonly href: string;
    readonly children: ReactNode;
    readonly onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
    readonly onNavigate?: (event: { preventDefault: () => void }) => void;
  } & Record<string, unknown>) => (
    <a
      href={href}
      {...rest}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        onNavigate?.({ preventDefault: () => undefined });
      }}
    >
      {children}
    </a>
  ),
}));
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => ({
    status: "READY",
    permissions: state.hrPermissions,
    today: "2026-10-09",
    timezone: "Asia/Bangkok",
    timezoneSupported: true,
    employee: { code: "EMP-DEMO-010", displayName: "Lead" },
    sites: [],
    identityKey: state.actorKey,
    organizationName: "Demo Co",
  }),
}));
vi.mock("@/components/providers/WorkspaceProvider", () => ({
  useWorkspace: () => ({
    readiness: { kind: "READY_TO_QUERY" },
    organization: { id: state.organizationId, name: "Demo Co" },
    warehouses: [
      { id: "wh-1", code: "WH-1", name: "Main warehouse" },
      { id: "wh-2", code: "WH-2", name: "Overflow warehouse" },
    ],
    selectedWarehouseId: state.warehouseId,
    selectable: true,
    complete: true,
    loading: false,
    failed: false,
    denied: false,
    navigationPermissions: ["masterData.storageLayout.read"],
    permissionsReady: true,
    selectWarehouse: state.selectWarehouse,
    ...(state.workspaceDenied
      ? {
          organization: undefined,
          warehouses: [],
          selectedWarehouseId: undefined,
          selectable: false,
          denied: true,
        }
      : {}),
  }),
}));
vi.mock("@/components/shell/AccountButton", () => ({
  SidebarAccount: () => null,
}));
vi.mock("@/components/shell/HrLandingRedirect", () => ({
  HrLandingRedirect: () => null,
}));
vi.mock("@/components/shell/NavigationPendingIndicator", () => ({
  NavigationPendingIndicator: () => null,
}));

vi.mock("@/components/providers/AiUsageAccessProvider", () => ({
  useAiUsageAccess: () => ({
    status: "READY",
    permissions: ["aiUsage.report.read"],
  }),
}));

import { DesktopShell } from "./DesktopShell";
import { SidebarNavigation } from "@/components/shell/SidebarNavigation";
import { GlobalSearchProvider } from "@/components/shell/search/GlobalSearchProvider";
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";

const SEARCH_ROW = /^Search pages or employees/;

const arrival = { notify: () => undefined as void };
/** The page section a deep link focuses once navigation has happened. */
function Destination() {
  const [arrived, setArrived] = useState(0);
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    arrival.notify = () => setArrived((count) => count + 1);
  }, []);
  useEffect(() => {
    if (arrived > 0) section.current?.focus();
  }, [arrived]);
  return (
    <section ref={section} id="destination" tabIndex={-1}>
      Destination section
    </section>
  );
}

const originalMatchMedia = window.matchMedia;
beforeEach(() => {
  state.mobile = false;
  state.hrPermissions = [
    "hr.self.access",
    "hr.team.review",
    "hr.admin.manage",
    "hr.period.close",
  ];
  state.pathname = "/master-data/storage-layouts";
  state.organizationId = "org-a";
  state.warehouseId = "wh-1";
  state.workspaceDenied = false;
  state.actorKey = "org-a:user-a";
  state.selectWarehouse.mockReset();
  state.push.mockReset();
  state.push.mockImplementation(() => arrival.notify());
  // The shell's single breakpoint question: below the navigation rail?
  window.matchMedia = ((query: string) => ({
    matches: state.mobile,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

const shell = () => (
  <DesktopShell>
    <Destination />
  </DesktopShell>
);

function renderShell() {
  renderWithIntl(shell(), { locale: "en" });
  return screen.getByRole("banner");
}

const drawer = () =>
  screen.queryByRole("dialog", { name: "Primary navigation" });
const searchDialog = () => screen.queryByTestId("global-search");

async function openDrawer(header: HTMLElement) {
  const menu = within(header).getByRole("button", { name: "Open menu" });
  act(() => menu.focus());
  fireEvent.click(menu);
  return { menu, sheet: await screen.findByRole("dialog") };
}

/** Lets a closing Radix dialog run its deferred focus hand-back. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

it("skips to the shell's main region without adding an unmanaged fragment history entry", () => {
  renderShell();
  const before = { href: window.location.href, length: window.history.length };
  fireEvent.click(screen.getByRole("link", { name: "Skip to main content" }));
  expect(screen.getByRole("main")).toHaveFocus();
  expect(window.location.href).toBe(before.href);
  expect(window.history.length).toBe(before.length);
});

describe("sidebar hierarchy", () => {
  it.each([
    [false, "/finished-goods"],
    [false, "/finished-goods/scan"],
    [false, "/finished-goods/products/product-1"],
    [false, "/master-data/storage-layouts/building-1"],
    [false, "/hr/today"],
    [true, "/finished-goods"],
    [true, "/finished-goods/scan"],
    [true, "/finished-goods/products/product-1"],
    [true, "/master-data/storage-layouts/building-1"],
    [true, "/hr/today"],
  ])(
    "can choose a warehouse without leaving the page (mobile=%s, route=%s)",
    async (mobile, pathname) => {
      state.mobile = mobile;
      state.pathname = pathname;
      const header = renderShell();
      if (mobile) await openDrawer(header);
      const picker = screen.getByRole("combobox", {
        name: "Current warehouse",
      });
      expect(picker).toBeEnabled();
      fireEvent.keyDown(picker, { key: "ArrowDown" });
      fireEvent.click(
        await screen.findByRole("option", {
          name: "WH-2 · Overflow warehouse",
        }),
      );
      expect(state.selectWarehouse).toHaveBeenCalledExactlyOnceWith("wh-2");
      expect(state.push).not.toHaveBeenCalled();
      expect(state.replace).not.toHaveBeenCalled();
      expect(state.pathname).toBe(pathname);
    },
  );

  it("starts expanded with a language button in the header and exactly one disclosure inside the desktop sidebar", () => {
    const header = renderShell();
    const sidebar = screen.getByRole("complementary", {
      name: "Primary navigation",
    });
    expect(
      within(header).queryByRole("button", { name: /sidebar/i }),
    ).toBeNull();
    expect(
      within(header).getByRole("button", { name: "Switch language to ไทย" }),
    ).toBeInTheDocument();
    // Desktop search lives in the sidebar only.
    expect(
      within(header).queryByRole("button", { name: /search/i }),
    ).toBeNull();
    expect(sidebar).toContainElement(
      screen.getByRole("button", { name: "Collapse sidebar" }),
    );
    expect(sidebar).toContainElement(
      screen.getByRole("button", { name: SEARCH_ROW }),
    );
    expect(screen.queryByTestId("sidebar-ai-search")).toBeNull();
  });

  it("draws a panel glyph, not the phone menu glyph, on the desktop collapse toggle", () => {
    renderShell();
    const toggle = screen.getByRole("button", { name: "Collapse sidebar" });
    expect(
      within(toggle).getByTestId("sidebar-toggle-icon"),
    ).toBeInTheDocument();
    expect(within(toggle).queryByTestId("menu-open-icon")).toBeNull();
  });

  it.each([
    ["closed", "Open menu", "menu-open-icon"],
    ["open", "Close menu", "menu-close-icon"],
  ])(
    "draws the phone menu button's %s state with its own glyph",
    async (drawerState, name, icon) => {
      state.mobile = true;
      const header = renderShell();
      if (drawerState === "open") await openDrawer(header);
      // The open drawer hides the page behind it from the accessibility tree.
      const button = within(header).getByRole("button", { name, hidden: true });
      expect(within(button).getByTestId(icon)).toBeInTheDocument();
      expect(within(button).queryByTestId("sidebar-toggle-icon")).toBeNull();
    },
  );

  it("starts on the icon rail when the member last collapsed it", () => {
    renderWithIntl(
      <DesktopShell defaultOpen={false}>
        <Destination />
      </DesktopShell>,
      { locale: "en" },
    );
    expect(
      screen.getByRole("button", { name: "Expand sidebar" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("header-warehouse")).toBeInTheDocument();
  });

  it("keeps a phone's drawer closed whatever the desktop sidebar last was", () => {
    state.mobile = true;
    renderWithIntl(
      <DesktopShell defaultOpen={false}>
        <Destination />
      </DesktopShell>,
      { locale: "en" },
    );
    expect(
      within(screen.getByRole("banner")).getByRole("button", {
        name: "Open menu",
      }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(drawer()).toBeNull();
  });

  it("keeps subpages inside closed parent menus until the user expands them", () => {
    renderShell();
    for (const name of [
      "Attendance",
      "Leave",
      "Announcements",
      "Payslips",
      "HR administration",
    ]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    }
    expect(screen.queryByRole("link", { name: "Review leave" })).toBeNull();
    expect(
      screen.queryByRole("link", { name: "Manage announcements" }),
    ).toBeNull();
    expect(screen.queryByRole("link", { name: "Import payslips" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(screen.getByRole("link", { name: "My leave" })).toHaveAttribute(
      "href",
      "/hr/leave",
    );
    expect(screen.getByRole("link", { name: "Review leave" })).toHaveAttribute(
      "href",
      "/hr/leave/review",
    );
    expect(
      screen.getByRole("link", { name: "Company holidays" }),
    ).toBeVisible();
  });

  it("opens and highlights the correct submenu on a direct child route", () => {
    state.pathname = "/hr/leave/review";
    renderShell();
    expect(screen.getByRole("button", { name: "Leave" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("link", { name: "Review leave" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "My leave" })).not.toHaveAttribute(
      "aria-current",
    );
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(screen.queryByRole("link", { name: "Review leave" })).toBeNull();
  });

  it("filters permissions before grouping so employee menus never expose management links", () => {
    state.hrPermissions = ["hr.self.access"];
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(screen.getByRole("link", { name: "My leave" })).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Review leave", hidden: true }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "HR administration" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Payslips" }));
    expect(screen.getByRole("link", { name: "My payslips" })).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Import payslips", hidden: true }),
    ).toBeNull();
  });

  it("keeps review-only destinations reachable under their parent without self access", () => {
    state.hrPermissions = ["hr.team.review"];
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(screen.getByRole("link", { name: "Review leave" })).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "My leave", hidden: true }),
    ).toBeNull();
  });

  it("keeps the collapse and expand controls in the sidebar and expands a rail submenu on click", () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    const sidebar = screen.getByRole("complementary", {
      name: "Primary navigation",
    });
    expect(sidebar).toContainElement(
      screen.getByRole("button", { name: "Expand sidebar" }),
    );
    expect(screen.queryByRole("link", { name: "Review leave" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(
      screen.getByRole("button", { name: "Collapse sidebar" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review leave" })).toBeVisible();
  });

  it("names each destination list by its section and nests submenus as lists", () => {
    renderShell();
    const people = screen.getByRole("list", { name: "People" });
    const toggle = within(people).getByRole("button", { name: "Leave" });
    const leave = document.getElementById(
      toggle.getAttribute("aria-controls")!,
    );
    expect(leave).not.toBeVisible();
    fireEvent.click(toggle);
    expect(within(people).getByRole("list", { name: "Leave" })).toBe(leave);
    expect(within(leave!).getAllByRole("listitem")).toHaveLength(3);
  });

  it("hands focus to the warehouse selector when the rail warehouse expands the sidebar", () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    fireEvent.click(screen.getByTestId("sidebar-warehouse-rail"));
    expect(
      screen.getByRole("button", { name: "Collapse sidebar" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("warehouse-select")).toHaveFocus();
  });

  it("keeps search in the sidebar on the AI usage page as well", () => {
    state.pathname = "/ai-usage";
    const header = renderShell();
    expect(
      within(header).queryByRole("button", { name: SEARCH_ROW }),
    ).toBeNull();
    expect(
      screen.getByRole("complementary", { name: "Primary navigation" }),
    ).toContainElement(screen.getByTestId("sidebar-search"));
  });

  it("finds hidden subpages through search without expanding the sidebar, then reveals the selected route", async () => {
    const view = renderWithIntl(shell(), {
      locale: "en",
      preserveProviders: true,
    });
    const leave = screen.getByRole("button", { name: "Leave" });
    fireEvent.click(screen.getByRole("button", { name: SEARCH_ROW }));
    const dialog = await screen.findByTestId("global-search");
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Search" }), {
      target: { value: "leave review" },
    });
    const option = await screen.findByRole("option", { name: /Review leave/ });
    expect(leave).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(option);
    await waitFor(() =>
      expect(state.push).toHaveBeenCalledWith("/hr/leave/review"),
    );
    state.pathname = "/hr/leave/review";
    view.rerender(shell());
    await waitFor(() => expect(searchDialog()).toBeNull());
    expect(screen.getByRole("button", { name: "Leave" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("link", { name: "Review leave" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});

describe("selected warehouse in the header", () => {
  const LABEL = "WH-1 · Main warehouse";

  it("names the warehouse under the organization on a phone, without opening the drawer", () => {
    state.mobile = true;
    const header = renderShell();
    const brand = within(header).getByTestId("header-brand");
    const line = within(brand).getByTestId("header-warehouse");
    expect(brand).toHaveTextContent("Demo Co");
    expect(line).toHaveAttribute("title", LABEL);
    expect(
      within(line).getByText(`Current warehouse: ${LABEL}`),
    ).toBeInTheDocument();
    expect(drawer()).toBeNull();
  });

  it("leaves it to the expanded sidebar and shows it again beside the collapsed rail", () => {
    const header = renderShell();
    expect(within(header).queryByTestId("header-warehouse")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(within(header).getByTestId("header-warehouse")).toHaveAttribute(
      "title",
      LABEL,
    );
    // The rail control names the warehouse too, for its tooltip and readers.
    expect(screen.getByTestId("sidebar-warehouse-rail")).toHaveAccessibleName(
      `Current warehouse: ${LABEL}`,
    );
  });

  it.each([
    ["an HR-only member", { workspaceDenied: true }],
    ["no warehouse chosen yet", { warehouseId: "" }],
  ])("adds nothing for %s", (_case, overrides) => {
    state.mobile = true;
    Object.assign(state, overrides);
    const header = renderShell();
    expect(within(header).getByTestId("header-brand")).toHaveTextContent(
      "Demo Co",
    );
    expect(within(header).queryByTestId("header-warehouse")).toBeNull();
  });
});

describe("phone drawer search", () => {
  beforeEach(() => {
    state.mobile = true;
  });

  it("keeps warehouse context inside the drawer and offers search in both the header and the drawer", async () => {
    const header = renderShell();
    const search = within(header).getByRole("button", {
      name: "Search pages or employees",
    });
    const language = within(header).getByRole("button", {
      name: "Switch language to ไทย",
    });
    // Search comes first in the header's right-hand controls.
    expect(search.compareDocumentPosition(language)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    const { sheet } = await openDrawer(header);
    expect(sheet).toContainElement(screen.getByTestId("warehouse-select"));
    expect(
      within(sheet).getAllByRole("button", { name: SEARCH_ROW }),
    ).toHaveLength(1);
  });

  it("opens normal search from the header and returns focus to it on Escape", async () => {
    const header = renderShell();
    const search = within(header).getByTestId("header-search");
    fireEvent.click(search);
    const dialog = await screen.findByTestId("global-search");
    expect(
      within(dialog).getByRole("heading", { name: "Search" }),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("combobox", { name: "Search" }),
    ).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(searchDialog()).toBeNull());
    await settle();
    expect(search).toHaveFocus();
  });

  it("closes the drawer before opening search and restores focus to the mobile menu", async () => {
    const header = renderShell();
    const { menu, sheet } = await openDrawer(header);
    fireEvent.click(within(sheet).getByRole("button", { name: SEARCH_ROW }));
    expect(searchDialog()).toBeNull();
    const dialog = await screen.findByTestId("global-search");
    expect(drawer()).toBeNull();
    expect(
      within(dialog).getByRole("combobox", { name: "Search" }),
    ).toHaveFocus();
    // An empty box offers AI through its examples (D10), not a button.
    expect(
      within(dialog).getByTestId("global-search-group-ask"),
    ).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(searchDialog()).toBeNull());
    await settle();
    expect(menu).toHaveFocus();
  });

  it("closes the drawer after selecting a nested destination", async () => {
    const { sheet } = await openDrawer(renderShell());
    fireEvent.click(within(sheet).getByRole("button", { name: "Leave" }));
    fireEvent.click(within(sheet).getByRole("link", { name: "Review leave" }));
    await waitFor(() => expect(drawer()).toBeNull());
    expect(searchDialog()).toBeNull();
  });

  it("drops a queued search when the workspace changes while the drawer closes", async () => {
    const view = renderWithIntl(shell(), {
      locale: "en",
      preserveProviders: true,
    });
    const { sheet } = await openDrawer(screen.getByRole("banner"));
    fireEvent.click(within(sheet).getByRole("button", { name: SEARCH_ROW }));
    state.organizationId = "org-b";
    view.rerender(shell());
    await settle();
    expect(searchDialog()).toBeNull();
  });
});

describe("phone drawer reopening", () => {
  it("restores the active group on reopen even if the exit animation keeps it mounted", () => {
    state.mobile = true;
    state.pathname = "/hr/leave/review";
    function PersistentDrawer() {
      const { setOpenMobile } = useSidebar();
      return (
        <>
          <button onClick={() => setOpenMobile(true)}>Open fixture</button>
          <button onClick={() => setOpenMobile(false)}>Close fixture</button>
          <SidebarNavigation id="fixture-nav" collapsed={false} />
        </>
      );
    }
    renderWithIntl(
      <GlobalSearchProvider>
        <SidebarProvider>
          <PersistentDrawer />
        </SidebarProvider>
      </GlobalSearchProvider>,
      { locale: "en" },
    );
    fireEvent.click(screen.getByText("Open fixture"));
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(screen.queryByRole("link", { name: "Review leave" })).toBeNull();
    fireEvent.click(screen.getByText("Close fixture"));
    fireEvent.click(screen.getByText("Open fixture"));
    expect(screen.getByRole("link", { name: "Review leave" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    expect(screen.queryByRole("link", { name: "Review leave" })).toBeNull();
  });

  // jsdom has no layout: the drawer list is 400px tall, the current page's
  // row starts 900px down it, and `scrollTop` is recorded per element.
  const scrollTops = new WeakMap<Element, number>();
  // Drawer lookup is asynchronous: keep reveal pending until the test chooses
  // whether user input happens before or after the animation frame.
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  let requestFrameSpy: ReturnType<typeof vi.spyOn>;
  let cancelFrameSpy: ReturnType<typeof vi.spyOn>;
  let rectSpy: ReturnType<typeof vi.spyOn>;
  let scrollTopSpy: PropertyDescriptor | undefined;
  beforeEach(() => {
    frames.clear();
    frameId = 0;
    requestFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        const id = ++frameId;
        frames.set(id, callback);
        return id;
      });
    cancelFrameSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation((id) => {
        frames.delete(id);
      });
    state.mobile = true;
    state.pathname = "/hr/leave/review";
    scrollTopSpy = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "scrollTop",
    );
    Object.defineProperty(Element.prototype, "scrollTop", {
      configurable: true,
      get(this: Element) {
        return scrollTops.get(this) ?? 0;
      },
      set(this: Element, value: number) {
        scrollTops.set(this, value);
      },
    });
    rectSpy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        const box = (top: number, height: number) =>
          ({ top, bottom: top + height, height }) as DOMRect;
        if (this.getAttribute("data-sidebar") === "content") return box(0, 400);
        if (this.getAttribute("aria-current") === "page")
          return box(
            900 -
              (scrollTops.get(this.closest("[data-sidebar=content]")!) ?? 0),
            40,
          );
        return box(0, 0);
      });
  });
  afterEach(() => {
    requestFrameSpy.mockRestore();
    cancelFrameSpy.mockRestore();
    frames.clear();
    rectSpy.mockRestore();
    if (scrollTopSpy)
      Object.defineProperty(Element.prototype, "scrollTop", scrollTopSpy);
  });
  const list = (sheet: HTMLElement) =>
    sheet.querySelector<HTMLElement>("[data-sidebar=content]")!;
  const frame = () => {
    act(() => {
      const pending = [...frames];
      for (const [id, callback] of pending) {
        if (!frames.delete(id)) continue;
        callback(0);
      }
    });
  };

  it("scrolls only the drawer list to the current page on every opening, without moving focus", async () => {
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const header = renderShell();
    let { sheet } = await openDrawer(header);
    const focused = document.activeElement;
    expect(list(sheet).scrollTop).toBe(0);
    frame();
    expect(
      within(sheet).getByRole("link", { name: "Review leave" }),
    ).toHaveAttribute("aria-current", "page");
    // Centred: 900 − (400 − 40) / 2.
    expect(list(sheet).scrollTop).toBe(720);
    expect(document.activeElement).toBe(focused);
    expect(scrollTo).not.toHaveBeenCalled();

    fireEvent.keyDown(sheet, { key: "Escape" });
    await waitFor(() => expect(drawer()).toBeNull());
    ({ sheet } = await openDrawer(header));
    expect(list(sheet).scrollTop).toBe(0);
    frame();
    expect(list(sheet).scrollTop).toBe(720);
    scrollTo.mockRestore();
  });

  it("marks more destinations below in its own strip, never over a row", async () => {
    // Like browsers, each observed element is reported once.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private readonly report: () => void) {}
        observe() {
          queueMicrotask(this.report);
        }
        unobserve() {}
        disconnect() {}
      },
    );
    // A 400px list window whose last row ends at 1292px, above 8px of
    // padding: the cue follows the last row, not the padded scroll box.
    const spies = [
      vi
        .spyOn(Element.prototype, "clientHeight", "get")
        .mockImplementation(function (this: Element) {
          return this.getAttribute("data-sidebar") === "content" ? 400 : 0;
        }),
      vi
        .spyOn(Element.prototype, "getBoundingClientRect")
        .mockImplementation(function (this: Element) {
          if (this.getAttribute("data-sidebar") === "content")
            return DOMRect.fromRect({ height: 400 });
          const content = this.closest("[data-sidebar=content]");
          if (this.getAttribute("data-sidebar") !== "menu-item" || !content)
            return DOMRect.fromRect();
          return DOMRect.fromRect({
            y: 1252 - content.scrollTop,
            height: 40,
          });
        }),
    ];
    onTestFinished(() => {
      for (const spy of spies) spy.mockRestore();
      vi.unstubAllGlobals();
    });

    const { sheet } = await openDrawer(renderShell());
    await act(async () => {});
    const cue = within(sheet).getByTestId("sidebar-overflow-cue");
    expect(cue).toHaveAttribute("data-visible", "true");
    expect(cue).toHaveAttribute("aria-hidden", "true");
    // It follows the list in the layout instead of lying over its last rows,
    // so no label is washed out and no tap can land on it.
    expect(cue.previousElementSibling).toBe(list(sheet));
    expect(list(sheet)).not.toContainElement(cue);
    expect(cue).not.toHaveClass("absolute");
    expect(cue).toHaveClass("pointer-events-none");

    // At the end of the list there is nothing more to point at.
    list(sheet).scrollTop = 900;
    fireEvent.scroll(list(sheet));
    expect(cue).toHaveAttribute("data-visible", "false");
    // The last row in view with only the list's bottom padding cut off.
    list(sheet).scrollTop = 893;
    fireEvent.scroll(list(sheet));
    expect(cue).toHaveAttribute("data-visible", "false");
    list(sheet).scrollTop = 880;
    fireEvent.scroll(list(sheet));
    expect(cue).toHaveAttribute("data-visible", "true");
  });

  it("leaves the list alone once the user starts scrolling it", async () => {
    const { sheet } = await openDrawer(renderShell());
    expect(list(sheet).scrollTop).toBe(0);
    fireEvent.wheel(list(sheet));
    frame();
    expect(list(sheet).scrollTop).toBe(0);
  });
});
