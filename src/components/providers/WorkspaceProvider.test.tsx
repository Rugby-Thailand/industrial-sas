import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WAREHOUSE_STORAGE_KEY,
  writeStoredWarehouse,
} from "@/lib/workspace/warehouseStore";

import { useWorkspace, WorkspaceProvider } from "./WorkspaceProvider";

const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock("convex/react", () => ({ useQuery: useQueryMock }));

const workspaceOutcome = {
  ok: true as const,
  requestId: "req_workspace",
  value: {
    organization: { id: "org_1", name: "Siam Industrial" },
    warehouses: [
      { id: "wh_bpu", code: "BPU", name: "Bang Pu" },
      { id: "wh_lph", code: "LPH", name: "Lamphun" },
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

const consumers = (count: number) =>
  Array.from({ length: count }, (_, index) => (
    <Consumer key={index} index={index} />
  ));

describe("the workspace provider", () => {
  beforeEach(() => {
    window.localStorage.clear();
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

  it("exposes loading without inventing workspace data", () => {
    useQueryMock.mockReturnValue(undefined);
    function State() {
      const workspace = useWorkspace();
      return <span>{workspace.loading ? "loading" : "ready"}</span>;
    }

    render(
      <WorkspaceProvider>
        <State />
      </WorkspaceProvider>,
    );

    expect(screen.getByText("loading")).toBeVisible();
  });
});
