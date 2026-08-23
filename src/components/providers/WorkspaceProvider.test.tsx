import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readCurrentWorkspaceRef } from "@/lib/convex/workspaceApi";
import {
  WAREHOUSE_STORAGE_KEY,
  writeStoredWarehouse,
} from "@/lib/workspace/warehouseStore";

import { useWorkspace, WorkspaceProvider } from "./WorkspaceProvider";

const { useConvexAuthMock, useQueryMock } = vi.hoisted(() => ({
  useConvexAuthMock: vi.fn(),
  useQueryMock: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useConvexAuth: useConvexAuthMock,
  useQuery: useQueryMock,
}));

const workspaceOutcome = {
  ok: true as const,
  requestId: "req_workspace",
  value: {
    organization: { id: "org_1", name: "Siam Industrial" },
    warehouses: [
      { id: "wh_bpu", code: "BPU", name: "Bang Pu" },
      { id: "wh_lph", code: "LPH", name: "Lamphun" },
    ],
    navigationPermissions: [
      "reporting.dashboard.read",
      "inventory.balance.read",
    ],
    complete: true,
  },
};

function Consumer({ index }: { readonly index: number }) {
  const workspace = useWorkspace();
  return (
    <span data-testid={`consumer-${index}`}>
      {workspace.selectedWarehouseId ?? "none"}
    </span>
  );
}

function State() {
  const workspace = useWorkspace();
  return (
    <span data-testid="workspace-state">
      {JSON.stringify({
        complete: workspace.complete,
        denied: workspace.denied,
        loading: workspace.loading,
        organization: workspace.organization?.id,
        navigationPermissions: workspace.navigationPermissions,
        permissionsReady: workspace.permissionsReady,
        warehouses: workspace.warehouses.map((warehouse) => warehouse.id),
      })}
    </span>
  );
}

const consumers = (count: number) =>
  Array.from({ length: count }, (_, index) => (
    <Consumer key={index} index={index} />
  ));

describe("the workspace provider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useConvexAuthMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    });
    useQueryMock.mockReturnValue(workspaceOutcome);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("subscribes to storage once for the screen", () => {
    const addEventListener = vi.spyOn(window, "addEventListener");
    render(<WorkspaceProvider>{consumers(20)}</WorkspaceProvider>);

    expect(
      addEventListener.mock.calls.filter(([type]) => type === "storage"),
    ).toHaveLength(1);
  });

  it("restores a server-approved warehouse", () => {
    window.localStorage.setItem(WAREHOUSE_STORAGE_KEY, "wh_lph");
    render(<WorkspaceProvider>{consumers(2)}</WorkspaceProvider>);

    expect(screen.getByTestId("consumer-1")).toHaveTextContent("wh_lph");
  });

  it("follows a warehouse switch", () => {
    render(<WorkspaceProvider>{consumers(2)}</WorkspaceProvider>);

    act(() => writeStoredWarehouse("wh_bpu"));

    expect(screen.getByTestId("consumer-0")).toHaveTextContent("wh_bpu");
  });

  it("skips the tenant query while authentication is loading", () => {
    useConvexAuthMock.mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
    });

    render(
      <WorkspaceProvider>
        <State />
      </WorkspaceProvider>,
    );

    expect(useQueryMock.mock.calls.at(-1)?.[0]).toBe(readCurrentWorkspaceRef);
    expect(useQueryMock.mock.calls.at(-1)?.[1]).toBe("skip");
    expect(screen.getByTestId("workspace-state")).toHaveTextContent(
      JSON.stringify({
        complete: true,
        denied: false,
        loading: true,
        navigationPermissions: [],
        permissionsReady: false,
        warehouses: [],
      }),
    );
  });

  it("skips the tenant query for a signed-out session without reporting denial", () => {
    useConvexAuthMock.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
    });

    render(
      <WorkspaceProvider>
        <State />
      </WorkspaceProvider>,
    );

    expect(useQueryMock.mock.calls.at(-1)?.[0]).toBe(readCurrentWorkspaceRef);
    expect(useQueryMock.mock.calls.at(-1)?.[1]).toBe("skip");
    expect(screen.getByTestId("workspace-state")).toHaveTextContent(
      JSON.stringify({
        complete: true,
        denied: false,
        loading: false,
        navigationPermissions: [],
        permissionsReady: false,
        warehouses: [],
      }),
    );
  });

  it("exposes loading without inventing workspace data once authenticated", () => {
    useQueryMock.mockReturnValue(undefined);

    render(
      <WorkspaceProvider>
        <State />
      </WorkspaceProvider>,
    );

    expect(useQueryMock.mock.calls.at(-1)?.[0]).toBe(readCurrentWorkspaceRef);
    expect(useQueryMock.mock.calls.at(-1)?.[1]).toEqual({});
    expect(screen.getByTestId("workspace-state")).toHaveTextContent(
      JSON.stringify({
        complete: true,
        denied: false,
        loading: true,
        navigationPermissions: [],
        permissionsReady: false,
        warehouses: [],
      }),
    );
  });

  it("exposes an authenticated workspace result", () => {
    render(
      <WorkspaceProvider>
        <State />
      </WorkspaceProvider>,
    );

    expect(screen.getByTestId("workspace-state")).toHaveTextContent(
      JSON.stringify({
        complete: true,
        denied: false,
        loading: false,
        organization: "org_1",
        navigationPermissions: [
          "reporting.dashboard.read",
          "inventory.balance.read",
        ],
        permissionsReady: true,
        warehouses: ["wh_bpu", "wh_lph"],
      }),
    );
  });

  it("reports a tenant denial only after authentication succeeds", () => {
    useQueryMock.mockReturnValue({
      ok: false,
      error: { code: "FORBIDDEN", message: "Access denied" },
      requestId: "req_denied",
    });

    render(
      <WorkspaceProvider>
        <State />
      </WorkspaceProvider>,
    );

    expect(screen.getByTestId("workspace-state")).toHaveTextContent(
      JSON.stringify({
        complete: true,
        denied: true,
        loading: false,
        navigationPermissions: [],
        permissionsReady: false,
        warehouses: [],
      }),
    );
  });
});
