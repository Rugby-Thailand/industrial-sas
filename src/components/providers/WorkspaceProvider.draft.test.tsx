import { getTestMutation } from "@tests/fixtures/convex-mutation";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WAREHOUSE_STORAGE_KEY } from "@/lib/workspace/warehouseStore";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { NavigationGuardProvider } from "@/components/navigation/NavigationGuardProvider";
import { NewStorageBuildingForm } from "@/features/storageLayouts/StorageLayoutScreens";
import { trackAppHistory } from "@/lib/browser/appHistory";
import { WorkspaceProvider, useWorkspace } from "./WorkspaceProvider";

const backend = vi.hoisted(() => ({
  warehouses: [{ id: "warehouse-a", code: "A", name: "Warehouse A" }],
}));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useQuery_experimental: () => ({
    status: "success",
    data: {
      ok: true,
      requestId: "workspace",
      value: {
        organization: { id: "org", name: "Company" },
        warehouses: backend.warehouses,
        navigationPermissions: [
          "masterData.storageLayout.manage",
          "masterData.storageLayout.read",
        ],
        complete: true,
      },
    },
  }),
  useQuery: () => undefined,
  useMutation: getTestMutation,
}));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ userId: "user-a", orgId: "org-a" }),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({
    back: () => window.history.back(),
    replace: vi.fn(),
    push: vi.fn(),
  }),
  Link: (props: ComponentProps<"a">) => <a {...props} />,
}));
let stop: () => void;
beforeEach(() => {
  window.localStorage.clear();
  backend.warehouses = [{ id: "warehouse-a", code: "A", name: "Warehouse A" }];
  window.history.replaceState(
    { appNavigationIndex: 0 },
    "",
    "/en/master-data/storage-layouts",
  );
  stop = trackAppHistory();
  window.history.pushState({}, "", "/en/master-data/storage-layouts/new");
});
afterEach(() => stop());
function Current() {
  const workspace = useWorkspace();
  return (
    <output data-testid="current">
      {workspace.selectedWarehouseId ?? "none"}
    </output>
  );
}
function Caller() {
  return (
    <WorkspaceProvider>
      <NavigationGuardProvider>
        <Current />
        <NewStorageBuildingForm />
      </NavigationGuardProvider>
    </WorkspaceProvider>
  );
}
it("retains the unsaved building draft when a second warehouse is granted", async () => {
  const view = renderWithIntl(<Caller />, {
    locale: "en",
    workspace: false,
    preserveProviders: true,
  });
  expect(screen.getByTestId("current")).toHaveTextContent("warehouse-a");
  const input = screen.getByRole("textbox", { name: /building name/i });
  fireEvent.input(input, { target: { value: "Unsaved Building A" } });
  backend.warehouses = [
    ...backend.warehouses,
    { id: "warehouse-b", code: "B", name: "Warehouse B" },
  ];
  view.rerender(<Caller />);
  await waitFor(() =>
    expect(screen.getByTestId("current")).toHaveTextContent("warehouse-a"),
  );
  expect(screen.queryAllByRole("dialog").length).toBe(0);
  const retainedFields =
    screen.queryAllByDisplayValue("Unsaved Building A").length;
  expect(retainedFields).toBe(1);
});
it("retains an explicitly selected warehouse building draft when access expands", () => {
  window.localStorage.setItem(WAREHOUSE_STORAGE_KEY, "warehouse-a");
  const view = renderWithIntl(<Caller />, {
    locale: "en",
    workspace: false,
    preserveProviders: true,
  });
  fireEvent.input(screen.getByRole("textbox", { name: /building name/i }), {
    target: { value: "Retained Building A" },
  });
  backend.warehouses = [
    ...backend.warehouses,
    { id: "warehouse-b", code: "B", name: "Warehouse B" },
  ];
  view.rerender(<Caller />);
  expect(screen.queryAllByDisplayValue("Retained Building A").length).toBe(1);
});

it("still guards a cross-tab choice after retaining the implicit warehouse", async () => {
  const view = renderWithIntl(<Caller />, {
    locale: "en",
    workspace: false,
    preserveProviders: true,
  });
  fireEvent.input(screen.getByRole("textbox", { name: /building name/i }), {
    target: { value: "This tab's building" },
  });
  backend.warehouses = [
    ...backend.warehouses,
    { id: "warehouse-b", code: "B", name: "Warehouse B" },
  ];
  view.rerender(<Caller />);
  act(() => {
    window.localStorage.setItem(WAREHOUSE_STORAGE_KEY, "warehouse-b");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: WAREHOUSE_STORAGE_KEY,
        newValue: "warehouse-b",
        storageArea: window.localStorage,
      }),
    );
  });
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(screen.getByTestId("current")).toHaveTextContent("warehouse-a");
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByDisplayValue("This tab's building")).toBeVisible();
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});

it("does not retain an implicit warehouse after its authorization is revoked", () => {
  const view = renderWithIntl(<Caller />, {
    locale: "en",
    workspace: false,
    preserveProviders: true,
  });
  backend.warehouses = [
    { id: "warehouse-b", code: "B", name: "Warehouse B" },
    { id: "warehouse-c", code: "C", name: "Warehouse C" },
  ];
  view.rerender(<Caller />);
  expect(screen.getByTestId("current")).toHaveTextContent("none");
  expect(
    screen.queryByRole("textbox", { name: /building name/i }),
  ).not.toBeInTheDocument();
});
