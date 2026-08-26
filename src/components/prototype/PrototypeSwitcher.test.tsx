import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("view=live&variant=b"),
}));

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ replace }),
}));

import { PrototypeSwitcher } from "./PrototypeSwitcher";

const variants = [
  { id: "a", label: "A · Executive brief" },
  { id: "b", label: "B · Action queue" },
  { id: "c", label: "C · Spatial command" },
] as const;

function Switcher() {
  return (
    <PrototypeSwitcher
      variants={variants}
      current="b"
      label="Dashboard styles"
      previousLabel="Previous style"
      nextLabel="Next style"
    />
  );
}

describe("PrototypeSwitcher", () => {
  beforeEach(() => replace.mockReset());

  it("cycles styles while preserving other query parameters", async () => {
    const user = userEvent.setup();
    render(<Switcher />);

    await user.click(screen.getByRole("button", { name: "Next style" }));

    expect(replace).toHaveBeenCalledWith(
      {
        pathname: "/dashboard",
        query: { view: "live", variant: "c" },
      },
      { scroll: false },
    );
  });

  it("wraps backwards with the left arrow key", async () => {
    const user = userEvent.setup();
    render(<Switcher />);

    await user.keyboard("{ArrowLeft}");

    expect(replace).toHaveBeenCalledWith(
      {
        pathname: "/dashboard",
        query: { view: "live", variant: "a" },
      },
      { scroll: false },
    );
  });

  it("leaves arrow keys available inside form controls", async () => {
    const user = userEvent.setup();
    render(
      <>
        <input aria-label="Example input" />
        <Switcher />
      </>,
    );
    await user.click(screen.getByRole("textbox", { name: "Example input" }));

    await user.keyboard("{ArrowRight}");

    expect(replace).not.toHaveBeenCalled();
  });
});
