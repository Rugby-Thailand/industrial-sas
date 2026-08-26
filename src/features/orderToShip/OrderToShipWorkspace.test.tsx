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
const desktopMatchMedia = window.matchMedia;
afterEach(() => {
  window.localStorage.clear();
  window.matchMedia = desktopMatchMedia;
});

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

  it("shows each customer-order column status only once in its header", () => {
    renderWorkspace("sales");

    const board = screen.getByRole("region", {
      name: "Customer order status board",
    });

    for (const label of ["Draft", "Released", "Cancelled"]) {
      const column = within(board).getByRole("region", { name: label });
      const heading = within(column).getByRole("heading", { name: label });
      const header = heading.parentElement;

      expect(header).not.toBeNull();
      expect(within(header!).getAllByText(label)).toHaveLength(1);
    }
  });

  it("creates a sales order from a centered dialog instead of an inline form", async () => {
    const user = userEvent.setup();
    renderWorkspace("sales");

    expect(screen.queryByTestId("customer-order-form")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Create sales order" }),
    );

    const dialog = screen.getByRole("dialog", {
      name: "Create customer order",
    });
    expect(dialog).toHaveAttribute("data-slot", "dialog-content");
    await user.type(
      within(dialog).getByRole("textbox", { name: "Sales order number" }),
      "SO-26020",
    );
    await user.type(
      within(dialog).getByRole("textbox", { name: "Customer record ID" }),
      "prv_customer_gold",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Save draft order" }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Create customer order" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("opens the master-card workspace as a full centered dialog", async () => {
    const user = userEvent.setup();
    renderWorkspace("engineering");

    await user.click(
      screen.getByRole("button", { name: "Release-ready master card draft" }),
    );

    const dialog = screen.getByRole("dialog", {
      name: "Release-ready master card draft",
    });
    expect(dialog).toHaveAttribute("data-slot", "dialog-content");
    expect(dialog).not.toHaveAttribute("data-side");
    expect(
      within(dialog).getByRole("heading", { name: "Product identity" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("complementary", {
        name: "Master card files",
      }),
    ).toBeInTheDocument();
  });

  it("uses the installed stepper for the master-card editor on mobile", async () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }));
    const user = userEvent.setup();
    renderWorkspace("engineering");

    await user.click(
      screen.getByRole("button", { name: "Release-ready master card draft" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Release-ready master card draft",
    });
    expect(within(dialog).getByRole("tablist")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("tab", { name: /Product identity/ }),
    ).toHaveAttribute("aria-selected", "true");

    await user.click(
      within(dialog).getByRole("tab", { name: /Structure and dimensions/ }),
    );

    expect(
      within(dialog).getByRole("textbox", { name: "Internal length (mm)" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("textbox", { name: "Master card number" }),
    ).not.toBeInTheDocument();
    expect(await axe(dialog)).toHaveNoViolations();
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
