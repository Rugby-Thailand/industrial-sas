import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import AnimatedToggle from "./animated-toggle";

describe("AnimatedToggle", () => {
  it("toggles once per native keyboard activation", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<AnimatedToggle label="Dark mode" onChange={onChange} />);
    const control = screen.getByRole("switch", { name: "Dark mode" });
    await user.tab();
    await user.keyboard(" ");
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
    await user.keyboard("{Enter}");
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("uses the controlled theme and ignores input while disabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <AnimatedToggle label="Dark mode" checked onChange={onChange} />,
    );
    const control = screen.getByRole("switch", { name: "Dark mode" });
    await user.click(control);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(control).toHaveAttribute("aria-checked", "true");
    rerender(
      <AnimatedToggle
        label="Dark mode"
        checked={false}
        disabled
        onChange={onChange}
      />,
    );
    await user.click(control);
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
