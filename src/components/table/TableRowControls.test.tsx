import { fireEvent, render, screen } from "@testing-library/react";
import { PencilLine } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import {
  TableAction,
  TableRowActions,
  TableStatusSwitch,
} from "./TableRowControls";

describe("table row controls", () => {
  it("keeps icon actions named for assistive technology", () => {
    render(
      <TableRowActions>
        <TableAction label="Edit supplier SIAM-STEEL">
          <PencilLine aria-hidden="true" />
        </TableAction>
      </TableRowActions>,
    );

    expect(
      screen.getByRole("button", { name: "Edit supplier SIAM-STEEL" }),
    ).toHaveAttribute("title", "Edit supplier SIAM-STEEL");
  });

  it("exposes a binary status as a switch and forwards its next value", () => {
    const onCheckedChange = vi.fn();
    render(
      <TableStatusSwitch
        checked
        disabled={false}
        label="Turn supplier SIAM-STEEL on or off"
        actionLabel="Deactivate"
        onCheckedChange={onCheckedChange}
      />,
    );

    const status = screen.getByRole("switch", {
      name: "Turn supplier SIAM-STEEL on or off",
    });
    expect(status).toBeChecked();
    fireEvent.click(status);
    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });

  it("disables status mutation while another row write is pending", () => {
    render(
      <TableStatusSwitch
        checked={false}
        disabled
        label="Turn storage class AMBIENT on or off"
        actionLabel="Reactivate"
        onCheckedChange={() => undefined}
      />,
    );

    expect(screen.getByRole("switch")).toBeDisabled();
  });
});
