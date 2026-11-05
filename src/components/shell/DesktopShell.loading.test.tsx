import { act, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";

const state = vi.hoisted(() => ({
  hr: { status: "LOADING", organizationName: undefined as string | undefined },
  usage: {
    status: "LOADING",
    organizationName: undefined as string | undefined,
  },
  workspace: {
    loading: true,
    organization: undefined as { id: string; name: string } | undefined,
  },
  connected: true,
}));

vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useAction: () => vi.fn(),
  useConvex: () => ({
    query: vi.fn(),
    connectionState: () => ({
      isWebSocketConnected: state.connected,
      hasEverConnected: state.connected,
      connectionCount: state.connected ? 1 : 0,
    }),
    subscribeToConnectionState: () => () => undefined,
  }),
}));
vi.mock("@/lib/ai/client", () => ({ interpretAiSearch: vi.fn() }));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    userId: "user-a",
    orgId: "org-a",
    getToken: async () => "token",
  }),
}));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/finished-goods",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({
    href,
    children,
    prefetch: _prefetch,
    onNavigate: _onNavigate,
    ...rest
  }: {
    readonly href: string;
    readonly children: ReactNode;
  } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => ({ ...state.hr, permissions: [], sites: [] }),
}));
vi.mock("@/components/providers/AiUsageAccessProvider", () => ({
  useAiUsageAccess: () => ({ ...state.usage, permissions: [] }),
}));
vi.mock("@/components/providers/WorkspaceProvider", () => ({
  useWorkspace: () => ({
    readiness: { kind: state.workspace.loading ? "LOADING" : "READY_TO_QUERY" },
    organization: state.workspace.organization,
    warehouses: [],
    selectedWarehouseId: undefined,
    selectable: false,
    complete: !state.workspace.loading,
    loading: state.workspace.loading,
    failed: false,
    denied: false,
    navigationPermissions: [],
    permissionsReady: !state.workspace.loading,
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

import { DesktopShell } from "./DesktopShell";

const originalMatchMedia = window.matchMedia;
beforeEach(() => {
  state.hr = { status: "LOADING", organizationName: undefined };
  state.usage = { status: "LOADING", organizationName: undefined };
  state.workspace = { loading: true, organization: undefined };
  state.connected = true;
  window.matchMedia = ((query: string) => ({
    matches: false,
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
  vi.useRealTimers();
});

function renderShell() {
  renderWithIntl(
    <DesktopShell>
      <h1>Page</h1>
    </DesktopShell>,
    { locale: "en" },
  );
  return {
    header: screen.getByRole("banner"),
    sidebar: screen.getByRole("complementary", { name: "Primary navigation" }),
  };
}

describe("shell while the organization loads", () => {
  it("holds the organization's place with placeholders instead of repeating the product name", () => {
    const { header, sidebar } = renderShell();

    expect(within(header).getByTestId("header-brand-loading")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(within(header).queryByText("Yongkit")).toBeNull();
    expect(
      within(sidebar).getByTestId("sidebar-organization-loading"),
    ).toBeInTheDocument();
    // The product name stays, once, in the sidebar brand.
    expect(screen.getAllByText("Yongkit")).toHaveLength(1);
  });

  it("names the organization as soon as any access source knows it", () => {
    state.hr = { status: "READY", organizationName: "Demo Co" };
    const { header, sidebar } = renderShell();

    expect(within(header).getByText("Demo Co")).toBeVisible();
    expect(within(header).queryByTestId("header-brand-loading")).toBeNull();
    expect(
      within(sidebar).getByTestId("sidebar-organization"),
    ).toHaveTextContent("Demo Co");
  });

  it("falls back to the product name once every source settled without an organization", () => {
    state.hr = { status: "NONE", organizationName: undefined };
    state.usage = { status: "NONE", organizationName: undefined };
    state.workspace = { loading: false, organization: undefined };
    const { header } = renderShell();

    expect(within(header).getByText("Yongkit")).toBeVisible();
    expect(screen.queryByTestId("header-brand-loading")).toBeNull();
  });
});

describe("shell connection status", () => {
  it("shows the unreachable-backend warning inside the banner, not over the page", () => {
    vi.useFakeTimers();
    state.connected = false;
    const { header } = renderShell();
    expect(screen.queryByTestId("connection-notice")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(8_000);
    });

    const warning = within(header).getByTestId("connection-notice");
    expect(warning).toHaveAttribute("role", "status");
    expect(warning).toHaveTextContent("Can't reach the server");
    expect(screen.getByRole("main")).toHaveTextContent("Page");
  });

  it("stops presenting the sidebar and header as loading once the connection stalls", () => {
    vi.useFakeTimers();
    state.connected = false;
    const { header, sidebar } = renderShell();
    expect(within(sidebar).getAllByRole("status")).toHaveLength(2);
    expect(within(header).getByTestId("header-brand-loading")).toHaveClass(
      "animate-pulse",
    );

    act(() => {
      vi.advanceTimersByTime(8_000);
    });

    // The banner's notice is the one announcement of the outage (the
    // shell's empty navigation announcer aside).
    expect(
      screen
        .getAllByRole("status")
        .filter((region) => region.textContent !== ""),
    ).toEqual([within(header).getByTestId("connection-notice")]);
    expect(
      within(sidebar).getByTestId("sidebar-navigation-loading"),
    ).toHaveTextContent("Available work appears once connected");
    expect(within(sidebar).getByTestId("sidebar-warehouse")).toHaveTextContent(
      "Waiting for connection…",
    );
    expect(sidebar).not.toHaveTextContent("Loading");
    expect(within(header).getByTestId("header-brand-loading")).not.toHaveClass(
      "animate-pulse",
    );
    expect(
      within(sidebar).getByTestId("sidebar-organization-loading"),
    ).not.toHaveClass("animate-pulse");
  });
});
