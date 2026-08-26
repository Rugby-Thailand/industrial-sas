import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";

import { MasterDataCreateLayout } from "./MasterDataCreateLayout";

function renderLayout() {
  return renderWithIntl(
    <MasterDataCreateLayout
      title="Locations"
      description="Location help"
      notice="Changes are audited"
      registerTitle="Register"
      createLabel="Add a location"
      closeLabel="Close form"
      register={<div data-testid="location-register" />}
      form={<div data-testid="location-form" />}
    />,
    { locale: "en", workspace: false },
  );
}

describe("MasterDataCreateLayout", () => {
  it("keeps the form closed behind one clear plus action", async () => {
    const user = userEvent.setup();
    renderLayout();

    const add = screen.getByRole("button", { name: "Add a location" });
    expect(add.querySelector("svg")).toHaveClass("lucide-plus");
    expect(screen.queryByTestId("location-form")).not.toBeInTheDocument();
    expect(screen.getByTestId("location-register")).toBeInTheDocument();

    await user.click(add);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("location-form")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Add" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close form" })).toBeVisible();
  });

  it("closes the same one-layer form from the page action", async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.click(screen.getByRole("button", { name: "Add a location" }));
    await user.click(screen.getByRole("button", { name: "Close form" }));

    expect(screen.queryByTestId("location-form")).not.toBeInTheDocument();
  });
});
