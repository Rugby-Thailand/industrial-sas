import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PencilLine } from "lucide-react";
import { describe, expect, it } from "vitest";

import { renderWithIntl } from "@tests/fixtures/intl-render";

import { WriteDialog, useWriteSurface } from "./WriteDialog";

function CompleteWrite() {
  const surface = useWriteSurface();
  return (
    <button type="button" onClick={surface?.complete}>
      Complete write
    </button>
  );
}

describe("WriteDialog", () => {
  it("keeps form content out of the page until its plus action opens", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <WriteDialog
        triggerLabel="Add location"
        title="Add a location"
        description="Create one warehouse location."
        closeLabel="Close"
      >
        <div data-testid="write-content" />
      </WriteDialog>,
      { locale: "en", workspace: false },
    );

    const trigger = screen.getByRole("button", { name: "Add location" });
    expect(trigger.querySelector("svg")).toHaveClass("lucide-plus");
    expect(screen.queryByTestId("write-content")).not.toBeInTheDocument();

    await user.click(trigger);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Add a location" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("write-content")).toBeInTheDocument();
  });

  it("closes after the nested write reports successful completion", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <WriteDialog triggerLabel="Add" closeLabel="Close">
        <CompleteWrite />
      </WriteDialog>,
      { locale: "en", workspace: false },
    );

    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(screen.getByRole("button", { name: "Complete write" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toHaveFocus();
  });

  it("uses an accessible icon-only trigger when an icon is provided", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <WriteDialog
        triggerLabel="Edit"
        triggerIcon={<PencilLine aria-hidden="true" />}
        closeLabel="Close"
      >
        <div data-testid="write-content" />
      </WriteDialog>,
      { locale: "en", workspace: false },
    );

    const trigger = screen.getByRole("button", { name: "Edit" });
    expect(trigger).toHaveAttribute("data-size", "icon");
    expect(trigger).toHaveAttribute("title", "Edit");
    expect(trigger).not.toHaveTextContent("Edit");
    expect(trigger.querySelector("svg")).toHaveClass("lucide-pencil-line");

    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "Edit" })).toBeInTheDocument();
  });
});
