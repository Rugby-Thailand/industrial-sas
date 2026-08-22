import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceProvider } from "@/components/providers/WorkspaceProvider";
import { writeStoredWarehouse } from "@/lib/workspace/warehouseStore";

import {
  testEnvironment,
  renderWithIntl,
} from "../../../tests/fixtures/intl-render";
import { navigationMock } from "../../../tests/fixtures/navigation-mock";

vi.mock("@/i18n/navigation", () => navigationMock);

import {
  OrderToShipWorkspace,
  type OrderToShipView,
} from "./OrderToShipWorkspace";

const renderWorkspace = (view: OrderToShipView, locale: "th" | "en" = "en") =>
  renderWithIntl(
    <WorkspaceProvider>
      <OrderToShipWorkspace view={view} />
    </WorkspaceProvider>,
    { locale, environment: testEnvironment },
  );

beforeEach(() => writeStoredWarehouse("prv_wh_bangpoo"));
afterEach(() => window.localStorage.clear());

describe("OrderToShipWorkspace", () => {
  it("makes customer product identity and the human-confirmation rule visible", () => {
    renderWorkspace("sales");
    expect(
      screen.getByText(/customer product code decide exact reuse/i),
    ).toBeInTheDocument();
    expect(screen.getByText("SO-26018")).toBeInTheDocument();
  });

  it("groups customer orders into system-controlled status columns", () => {
    renderWorkspace("sales");

    const board = screen.getByRole("region", {
      name: "Customer order status board",
    });
    const draft = within(board).getByRole("region", { name: "Draft" });
    const released = within(board).getByRole("region", { name: "Released" });
    const cancelled = within(board).getByRole("region", { name: "Cancelled" });

    expect(within(draft).getByText("SO-26019")).toBeInTheDocument();
    expect(within(draft).queryByText("SO-26018")).not.toBeInTheDocument();
    expect(within(released).getByText("SO-26018")).toBeInTheDocument();
    expect(within(cancelled).getByText("No data")).toBeInTheDocument();
  });

  it("creates a sales order from a sheet instead of an inline form", async () => {
    const user = userEvent.setup();
    renderWorkspace("sales");

    expect(screen.queryByTestId("customer-order-form")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Create sales order" }),
    );

    const sheet = screen.getByRole("dialog", {
      name: "Create customer order",
    });
    await user.type(
      within(sheet).getByRole("textbox", { name: "Sales order number" }),
      "SO-26020",
    );
    await user.type(
      within(sheet).getByRole("textbox", { name: "Customer record ID" }),
      "prv_customer_gold",
    );
    await user.click(
      within(sheet).getByRole("button", { name: "Save draft order" }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Create customer order" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("shows overdue engineering work without relying on colour", () => {
    renderWorkspace("engineering");
    expect(screen.getAllByText("GOLD-BOX-991").length).toBeGreaterThan(0);
    expect(screen.getByText("Overdue")).toBeInTheDocument();
  });

  it("renders the immutable factory evidence snapshot", () => {
    renderWorkspace("factory");
    expect(screen.getByText("SO-26018-1")).toBeInTheDocument();
    expect(screen.getByText(/PO-GOLD-8812/)).toBeInTheDocument();
    expect(screen.getByText("PRN-01")).toBeInTheDocument();
  });

  it.each(["sales", "engineering", "factory"] as const)(
    "has no detectable accessibility violations in the %s view",
    async (view) => {
      const { container } = renderWorkspace(view, "th");
      expect(await axe(container)).toHaveNoViolations();
    },
  );
});
