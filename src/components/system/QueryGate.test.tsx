import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, expect, it, vi } from "vitest";

import {
  WorkspaceProvider,
  UnavailableWorkspaceProvider,
} from "@/components/providers/WorkspaceProvider";
import { useCan } from "@/hooks/useCan";
import { WAREHOUSE_STORAGE_KEY } from "@/lib/workspace/warehouseStore";
import { pickMessages, ROUTE_NAMESPACES } from "@/i18n/clientMessages";
import { messagesFor } from "@/i18n/messages";
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

const twoWarehouses = {
  ...data,
  value: {
    ...data.value,
    warehouses: [
      { id: "warehouse-a", code: "WH-A", name: "North" },
      { id: "warehouse-b", code: "WH-B", name: "South" },
    ],
  },
};

it.each(["en", "th"] as const)(
  "translates the warehouse gate inside storage route message providers (%s)",
  (locale) => {
    mocks.query.mockReturnValue({ status: "success", data: twoWarehouses });
    const catalogue = messagesFor(locale);
    for (const scope of [
      "(desktop)/finished-goods",
      "(desktop)/master-data",
    ] as const) {
      const onError = vi.fn();
      const view = renderWithIntl(
        <NextIntlClientProvider
          locale={locale}
          messages={pickMessages(catalogue, ROUTE_NAMESPACES[scope])}
          onError={onError}
        >
          <WorkspaceProvider>
            <Content />
          </WorkspaceProvider>
        </NextIntlClientProvider>,
        { locale, workspace: false },
      );
      expect(
        screen.getByRole("combobox", { name: catalogue.Workspace.warehouse }),
      ).toHaveTextContent(catalogue.Workspace.selectWarehouse);
      expect(onError).not.toHaveBeenCalled();
      view.unmount();
    }
  },
);

it.each([
  ["en", "Warehouse", "No warehouse selected"],
  ["th", "คลังสินค้า", "ยังไม่ได้เลือกคลังสินค้า"],
] as const)(
  "lets a direct link without a stored warehouse choose one in place and renders on the same URL (%s)",
  async (locale, label, missing) => {
    const target = `/${locale}/master-data/storage-layouts/building-b/review?floor=2#issues`;
    window.history.replaceState({}, "", target);
    mocks.query.mockReturnValue({ status: "success", data: twoWarehouses });
    renderWithIntl(
      <WorkspaceProvider>
        <Content />
      </WorkspaceProvider>,
      { locale, workspace: false },
    );
    expect(screen.getByTestId("panel-WAREHOUSE_MISSING")).toHaveTextContent(
      missing,
    );
    expect(screen.queryByTestId("query-content")).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: label }));
    await user.click(screen.getByRole("option", { name: "WH-B · South" }));
    expect(await screen.findByTestId("query-content")).toHaveTextContent(
      "warehouse-b",
    );
    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe(target);
    expect(window.localStorage.getItem(WAREHOUSE_STORAGE_KEY)).toBe(
      "warehouse-b",
    );
  },
);

it("keeps an existing warehouse selection without offering a switch on gated pages", () => {
  window.localStorage.setItem(WAREHOUSE_STORAGE_KEY, "warehouse-a");
  mocks.query.mockReturnValue({ status: "success", data: twoWarehouses });
  renderWithIntl(
    <WorkspaceProvider>
      <Content />
    </WorkspaceProvider>,
    { locale: "en", workspace: false },
  );
  expect(screen.getByTestId("query-content")).toHaveTextContent("warehouse-a");
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
});

it.each([
  ["en", "No warehouse available", "Ask an organization administrator"],
  ["th", "ไม่มีคลังสินค้าที่ใช้ได้", "กรุณาขอสิทธิ์เข้าถึงคลังสินค้า"],
] as const)(
  "explains a member without an active warehouse instead of asking for a selection (%s)",
  (locale, title, hint) => {
    mocks.query.mockReturnValue({
      status: "success",
      data: { ...data, value: { ...data.value, warehouses: [] } },
    });
    renderWithIntl(
      <WorkspaceProvider>
        <Content />
      </WorkspaceProvider>,
      { locale, workspace: false },
    );
    const panel = screen.getByTestId("panel-WAREHOUSE_UNAVAILABLE");
    expect(panel).toHaveTextContent(title);
    expect(panel).toHaveTextContent(hint);
    expect(screen.queryByTestId("panel-WAREHOUSE_MISSING")).toBeNull();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByTestId("query-content")).not.toBeInTheDocument();
  },
);
