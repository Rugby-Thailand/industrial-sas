/**
 * Kiro UX-flow probes — shared shell warehouse context (SS-01, SS-03).
 * Each test asserts the EXPECTED behaviour; a failure on current source is the
 * evidence. Mocks mirror src/components/shell/DesktopShell.test.tsx: only
 * Convex, Clerk, router, HR access and workspace seams are replaced. The real
 * shell (DesktopShell), WorkspaceContextBar and QueryGate are rendered.
 */
import { screen } from "@testing-library/react";
import type { MouseEvent, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";

const state = vi.hoisted(() => ({
  pathname: "/master-data/storage-layouts/building-a",
  readiness: { kind: "READY_TO_QUERY" } as { kind: string },
  organization: { id: "org-a", name: "Demo Co" } as
    | { id: string; name: string }
    | undefined,
  warehouses: [
    { id: "wh-1", code: "WH-1", name: "Main warehouse" },
    { id: "wh-2", code: "WH-2", name: "Overflow warehouse" },
  ] as { id: string; code: string; name: string }[],
  selectedWarehouseId: undefined as string | undefined,
  loading: false,
}));

vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useConvex: () => ({ query: vi.fn() }),
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
  usePathname: () => state.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  Link: ({
    href,
    children,
    onClick,
    ...rest
  }: {
    readonly href: string;
    readonly children: ReactNode;
    readonly onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  } & Record<string, unknown>) => (
    <a
      href={href}
      {...rest}
      onClick={(event) => {
        onClick?.(event);
        event.preventDefault();
      }}
    >
      {children}
    </a>
  ),
}));
vi.mock("@/components/providers/HrAccessProvider", () => ({
  useHrAccess: () => ({ status: "READY", permissions: [] }),
}));
vi.mock("@/components/providers/WorkspaceProvider", () => ({
  useWorkspace: () => ({
    readiness: state.readiness,
    organization: state.organization,
    warehouses: state.warehouses,
    selectedWarehouseId: state.selectedWarehouseId,
    selectable: state.warehouses.length > 0,
    complete: true,
    loading: state.loading,
    failed: false,
    denied: false,
    navigationPermissions: [
      "masterData.storageLayout.read",
      "masterData.storageLayout.manage",
    ],
    permissionsReady: state.readiness.kind === "READY_TO_QUERY",
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

import { DesktopShell } from "@/components/shell/DesktopShell";
import { WorkspaceContextBar } from "@/components/shell/WorkspaceContextBar";
import { QueryGate } from "@/components/system/QueryGate";

beforeEach(() => {
  state.pathname = "/master-data/storage-layouts/building-a";
  state.readiness = { kind: "READY_TO_QUERY" };
  state.organization = { id: "org-a", name: "Demo Co" };
  state.warehouses = [
    { id: "wh-1", code: "WH-1", name: "Main warehouse" },
    { id: "wh-2", code: "WH-2", name: "Overflow warehouse" },
  ];
  state.selectedWarehouseId = undefined;
  state.loading = false;
});

describe("SS-01 detail route with no selected warehouse", () => {
  it("SS-01 a building link opened without a stored warehouse offers a way to choose one", () => {
    renderWithIntl(
      <DesktopShell>
        <QueryGate scope="WAREHOUSE">
          {(warehouseId) => <p>building content for {warehouseId}</p>}
        </QueryGate>
      </DesktopShell>,
      { locale: "en", workspace: false },
    );
    // Precondition (observed): the page asks the user to choose a warehouse.
    expect(screen.getByTestId("panel-WAREHOUSE_MISSING")).toHaveTextContent(
      "Choose a warehouse to see its work and records.",
    );
    console.info(
      "SS-01 warehouse selectors rendered:",
      screen.queryAllByTestId("warehouse-select").length,
    );
    // Expected: the instruction is actionable on this page.
    expect(screen.queryAllByTestId("warehouse-select").length).toBeGreaterThan(
      0,
    );
  });

  it("SS-01 control: the same state on the catalogue route does render the selector", () => {
    state.pathname = "/master-data/storage-layouts";
    renderWithIntl(
      <DesktopShell>
        <QueryGate scope="WAREHOUSE">{() => null}</QueryGate>
      </DesktopShell>,
      { locale: "en", workspace: false },
    );
    expect(screen.queryAllByTestId("warehouse-select").length).toBeGreaterThan(
      0,
    );
  });
});

describe("SS-03 workspace context bar states", () => {
  it("SS-03 a member with an organization but no accessible warehouse is not told there is no organization", () => {
    state.warehouses = [];
    renderWithIntl(
      <>
        <WorkspaceContextBar />
        <QueryGate scope="WAREHOUSE">{() => null}</QueryGate>
      </>,
      { locale: "en", workspace: false },
    );
    console.info(
      "SS-03 zero-warehouse texts:",
      JSON.stringify(document.body.textContent),
    );
    expect(screen.queryByText("No organization context")).toBeNull();
    // Expected: no instruction to choose from an empty list.
    expect(
      screen.queryByText("Choose a warehouse to see its work and records."),
    ).toBeNull();
  });

  it("SS-03 while the workspace is still loading the bar does not claim there is no organization", () => {
    state.readiness = { kind: "LOADING" };
    state.organization = undefined;
    state.warehouses = [];
    state.loading = true;
    renderWithIntl(<WorkspaceContextBar />, {
      locale: "en",
      workspace: false,
    });
    expect(screen.queryByText("No organization context")).toBeNull();
  });
});
