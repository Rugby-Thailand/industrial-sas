import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Plus } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { CollectionToolbar } from "./CollectionToolbar";
import { IconButton } from "@/components/ui/IconButton";

describe("shared collection controls", () => {
  it("typing, clearing and Enter do not submit an enclosing editor form", async () => {
    const submit = vi.fn((event) => event.preventDefault());
    function Example() {
      const [value, setValue] = useState("");
      return (
        <form onSubmit={submit}>
          <CollectionToolbar
            value={value}
            onValueChange={setValue}
            searchLabel="Search locations"
            clearLabel="Clear search"
          />
        </form>
      );
    }
    render(<Example />);
    const user = userEvent.setup();
    await user.type(screen.getByRole("searchbox"), "A1{Enter}");
    expect(screen.getByRole("searchbox")).toHaveValue("A1");
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(submit).not.toHaveBeenCalled();
  });

  it("names icon actions and prevents pending actions from being repeated", () => {
    const action = vi.fn();
    const { rerender } = render(
      <IconButton label="Add location" onClick={action}>
        <Plus aria-hidden="true" />
      </IconButton>,
    );
    const button = screen.getByRole("button", { name: "Add location" });
    expect(button).toHaveAttribute("title", "Add location");
    expect(button).toHaveAttribute("type", "button");
    fireEvent.click(button);
    expect(action).toHaveBeenCalledTimes(1);
    rerender(
      <IconButton label="Add location" onClick={action} pending>
        <Plus aria-hidden="true" />
      </IconButton>,
    );
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    fireEvent.click(button);
    expect(action).toHaveBeenCalledTimes(1);
  });
});
