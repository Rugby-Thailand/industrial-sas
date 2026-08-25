import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { navigationMock } from "../../../tests/fixtures/navigation-mock";

vi.mock("@/i18n/navigation", () => navigationMock);

import { renderWithIntl } from "../../../tests/fixtures/intl-render";

import { QuickActionMenu } from "./DashboardQuickActions";

const preference = {
  pageKey: "OWNER_DASHBOARD" as const,
  presetVersion: 1,
  customized: true,
  selectedActionIds: ["INVENTORY_HEALTH", "CUSTOMER_ORDERS"] as const,
  availableActionIds: [
    "CUSTOMER_ORDERS",
    "PRODUCTION_STATUS",
    "INVENTORY_HEALTH",
  ] as const,
};

describe("QuickActionMenu", () => {
  it("lets an account member reorder and extend only their available actions", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => true);

    renderWithIntl(
      <QuickActionMenu
        preference={preference}
        busy={false}
        onSave={onSave}
        onReset={vi.fn(async () => undefined)}
      />,
      { locale: "en" },
    );

    expect(
      screen.getByRole("link", { name: /Inventory health/ }),
    ).toHaveAttribute("href", "/inventory/balances");
    expect(
      screen.queryByText(
        "Your shortcuts for this account. Only actions you can access are available.",
      ),
    ).not.toBeInTheDocument();

    const customize = screen.getByRole("button", { name: "Customize" });
    expect(customize).toHaveTextContent("");
    expect(customize).toHaveAttribute("aria-label", "Customize");
    expect(customize.querySelector("svg")).toHaveClass("text-accent");

    await user.click(customize);
    await user.click(
      screen.getByRole("button", { name: "Move Customer orders up" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Add Production status" }),
    );
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(onSave).toHaveBeenCalledWith([
      "CUSTOMER_ORDERS",
      "INVENTORY_HEALTH",
      "PRODUCTION_STATUS",
    ]);
  });

  it("offers a reset to the permission-filtered owner default", async () => {
    const user = userEvent.setup();
    const onReset = vi.fn(async () => undefined);

    renderWithIntl(
      <QuickActionMenu
        preference={preference}
        busy={false}
        onSave={vi.fn(async () => true)}
        onReset={onReset}
      />,
      { locale: "en" },
    );

    await user.click(screen.getByRole("button", { name: "Customize" }));
    await user.click(
      screen.getByRole("button", { name: "Reset to owner default" }),
    );

    expect(onReset).toHaveBeenCalledOnce();
  });
});
