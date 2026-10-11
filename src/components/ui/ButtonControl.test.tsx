import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";

describe("Button pending", () => {
  it("blocks repeat activation, announces busy and shows the pending label", async () => {
    const save = vi.fn();
    const { rerender } = render(
      <Button pendingLabel="Saving…" onClick={save}>
        Save
      </Button>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledTimes(1);

    rerender(
      <Button pending pendingLabel="Saving…" onClick={save}>
        Save
      </Button>,
    );
    const busy = screen.getByRole("button", { name: "Saving…" });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    await user.click(busy);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("keeps a pending slotted link unavailable to mouse and keyboard", async () => {
    const navigate = vi.fn((event: { preventDefault: () => void }) =>
      event.preventDefault(),
    );
    const { rerender } = render(
      <Button asChild>
        <a href="https://example.com/next" onClick={navigate}>
          Continue
        </a>
      </Button>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("link", { name: "Continue" }));
    expect(navigate).toHaveBeenCalledTimes(1);

    rerender(
      <Button asChild pending>
        <a href="https://example.com/next" onClick={navigate}>
          Continue
        </a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Continue" });
    expect(link).toHaveAttribute("aria-disabled", "true");
    expect(link).toHaveAttribute("aria-busy", "true");
    // Still discoverable by keyboard, but activation does nothing.
    link.focus();
    await user.keyboard("{Enter}");
    fireEvent.click(link);
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
