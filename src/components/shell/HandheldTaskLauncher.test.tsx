import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { navigationMock } from "../../../tests/fixtures/navigation-mock";

vi.mock("@/i18n/navigation", () => navigationMock);

import { HandheldTaskLauncher } from "./HandheldTaskLauncher";
import * as WorkspaceModule from "@/components/providers/WorkspaceProvider";

const labels = {
  tasks: {
    taskReceive: "Receive goods",
    taskCount: "Count stock",
    taskPallet: "Build a pallet",
  },
  unavailable: "Not available yet",
  unavailableTitle: "This task is not built yet.",
  loading: "Preparing tasks.",
};

function workspace(
  overrides: Partial<WorkspaceModule.WorkspaceContextValue> = {},
): WorkspaceModule.WorkspaceContextValue {
  return {
    organization: { id: "org_1", name: "Siam" },
    warehouses: [],
    selectedWarehouseId: undefined,
    selectable: false,
    complete: true,
    loading: false,
    denied: false,
    navigationPermissions: ["receiving.receipt.read"],
    permissionsReady: true,
    selectWarehouse: vi.fn(),
    ...overrides,
  };
}

describe("HandheldTaskLauncher", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows granted tasks, hides denied tasks, and explains unavailable work", () => {
    vi.spyOn(WorkspaceModule, "useWorkspace").mockReturnValue(workspace());

    render(<HandheldTaskLauncher labels={labels} />);

    expect(screen.getByRole("link", { name: "Receive goods" })).toHaveAttribute(
      "href",
      "/handheld/receive",
    );
    expect(screen.queryByRole("link", { name: "Count stock" })).toBeNull();
    expect(screen.getByText("Build a pallet")).toBeInTheDocument();
    expect(screen.getByText("Not available yet")).toBeInTheDocument();
  });

  it("decorates each task with icons without touching its accessible name", () => {
    /*
     * The task glyph and the forward chevron are for scanning with the eyes,
     * not for the accessibility tree: both are `aria-hidden`, so the link's
     * name stays exactly the translated label the tests above rely on.
     */
    vi.spyOn(WorkspaceModule, "useWorkspace").mockReturnValue(workspace());

    render(<HandheldTaskLauncher labels={labels} />);

    const link = screen.getByRole("link", { name: "Receive goods" });
    const icons = link.querySelectorAll('svg[aria-hidden="true"]');
    expect(icons).toHaveLength(2); // task glyph + forward chevron
    expect(link.querySelector("svg:not([aria-hidden])")).toBeNull();
  });

  it("does not reveal task destinations before permissions are ready", () => {
    vi.spyOn(WorkspaceModule, "useWorkspace").mockReturnValue(
      workspace({ permissionsReady: false, navigationPermissions: [] }),
    );

    render(<HandheldTaskLauncher labels={labels} />);

    expect(screen.getByRole("status")).toHaveTextContent("Preparing tasks.");
    expect(screen.queryByRole("link")).toBeNull();
  });
});
