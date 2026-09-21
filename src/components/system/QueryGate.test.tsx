import { screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import {
  WorkspaceProvider,
  UnavailableWorkspaceProvider,
} from "@/components/providers/WorkspaceProvider";
import { useCan } from "@/hooks/useCan";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { QueryGate } from "./QueryGate";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn() }));
vi.mock("convex/react", () => ({
  useConvexAuth: mocks.auth,
  useQuery_experimental: mocks.query,
}));

const data = {
  ok: true,
  requestId: "workspace-request",
  value: {
    organization: { id: "org", name: "Org" },
    warehouses: [{ id: "warehouse", code: "WH", name: "Warehouse" }],
    navigationPermissions: ["inventory.read"],
    complete: true,
  },
};

function Content({ scope = "WAREHOUSE" }: { scope?: "ORG" | "WAREHOUSE" }) {
  const allowed = useCan("inventory.read");
  return (
    <>
      {allowed ? <span>Allowed</span> : null}
      <QueryGate scope={scope}>
        {(warehouseId) => (
          <span data-testid="query-content">
            {warehouseId || "organization"}
          </span>
        )}
      </QueryGate>
    </>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.auth
    .mockReset()
    .mockReturnValue({ isLoading: false, isAuthenticated: true });
  mocks.query.mockReset().mockReturnValue({ status: "success", data });
});

it("shares authentication readiness and hides permission actions until workspace data arrives", () => {
  mocks.query.mockReturnValue({ status: "pending" });
  const ui = (
    <WorkspaceProvider>
      <Content />
    </WorkspaceProvider>
  );
  const view = renderWithIntl(ui, {
    locale: "en",
    workspace: false,
    preserveProviders: true,
  });
  expect(screen.getByTestId("panel-LOADING")).toBeVisible();
  expect(screen.queryByText("Allowed")).not.toBeInTheDocument();
  expect(screen.queryByTestId("query-content")).not.toBeInTheDocument();
  expect(mocks.auth).toHaveBeenCalledTimes(1);
  mocks.query.mockReturnValue({ status: "success", data });
  view.rerender(
    <WorkspaceProvider>
      <Content />
    </WorkspaceProvider>,
  );
  expect(screen.getByText("Allowed")).toBeVisible();
  expect(screen.getByTestId("query-content")).toHaveTextContent("warehouse");
});

it("preserves workspace denial request IDs instead of showing a missing warehouse", () => {
  mocks.query.mockReturnValue({
    status: "success",
    data: { ok: false, requestId: "denied-workspace" },
  });
  renderWithIntl(
    <WorkspaceProvider>
      <Content />
    </WorkspaceProvider>,
    { locale: "en", workspace: false },
  );
  expect(screen.getByRole("alert")).toHaveTextContent("denied-workspace");
  expect(screen.queryByTestId("query-content")).not.toBeInTheDocument();
});

it("waits for authentication before deciding that a warehouse is missing", () => {
  mocks.auth.mockReturnValue({ isLoading: true, isAuthenticated: false });
  renderWithIntl(
    <WorkspaceProvider>
      <Content />
    </WorkspaceProvider>,
    { locale: "en", workspace: false },
  );
  expect(screen.getByTestId("panel-LOADING")).toBeVisible();
  expect(mocks.query).toHaveBeenCalledWith(
    expect.objectContaining({ args: "skip" }),
  );
});

it("allows organization reads without a selected warehouse", () => {
  mocks.query.mockReturnValue({
    status: "success",
    data: { ...data, value: { ...data.value, warehouses: [] } },
  });
  renderWithIntl(
    <WorkspaceProvider>
      <Content scope="ORG" />
    </WorkspaceProvider>,
    { locale: "en", workspace: false },
  );
  expect(screen.getByTestId("query-content")).toHaveTextContent("organization");
});

it.each(["BACKEND_MISSING", "SIGN_IN_REQUIRED"] as const)(
  "renders %s without mounting backend hooks",
  (reason) => {
    renderWithIntl(
      <UnavailableWorkspaceProvider reason={reason}>
        <Content />
      </UnavailableWorkspaceProvider>,
      { locale: "en", workspace: false },
    );
    expect(screen.getByTestId(`panel-${reason}`)).toBeVisible();
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  },
);
