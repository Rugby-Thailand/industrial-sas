import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "../../../tests/fixtures/intl-render";
import { AreaColorPicker } from "./AreaColorPicker";

function setup(value?: string) {
  const onChange = vi.fn();
  const view = renderWithIntl(
    <AreaColorPicker
      {...(value === undefined ? {} : { value })}
      onChange={onChange}
    />,
    { locale: "en" },
  );
  return { ...view, onChange, user: userEvent.setup() };
}

describe("AreaColorPicker", () => {
  it("selects a named preset and displays the existing preset selection", async () => {
    const { user, onChange } = setup("#145CA1");
    expect(screen.getByRole("button", { name: "Office" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Walkway" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await user.click(screen.getByRole("button", { name: "Walkway" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("#FFB889");
  });

  it.each(["a1b2c3", "#a1b2c3"])(
    "applies and normalizes custom input %s only on Apply",
    async (input) => {
      const { user, onChange } = setup("#123456");
      await user.click(screen.getByRole("button", { name: "More colors" }));
      const hex = screen.getByRole("textbox", { name: "Hex color" });
      expect(hex).toHaveValue("#123456");
      await user.clear(hex);
      await user.type(hex, input);
      expect(onChange).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "Use this color" }));
      expect(onChange).toHaveBeenCalledExactlyOnceWith("#A1B2C3");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    },
  );

  it.each(["red", "#123", "#12345678", "linear-gradient(red, blue)"])(
    "rejects invalid custom color %s",
    async (input) => {
      const { user, onChange } = setup();
      await user.click(screen.getByRole("button", { name: "More colors" }));
      const hex = screen.getByRole("textbox", { name: "Hex color" });
      fireEvent.change(hex, { target: { value: input } });
      expect(hex).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Enter six hexadecimal digits",
      );
      expect(
        screen.getByRole("button", { name: "Use this color" }),
      ).toBeDisabled();
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it.each(["close", "Escape"])(
    "discards custom edits on %s and restores trigger focus",
    async (action) => {
      const { user, onChange } = setup("#123456");
      const trigger = screen.getByRole("button", { name: "More colors" });
      await user.click(trigger);
      const hex = screen.getByRole("textbox", { name: "Hex color" });
      await user.clear(hex);
      await user.type(hex, "#ABCDEF");
      if (action === "close")
        await user.click(
          screen.getByRole("button", { name: "Close color picker" }),
        );
      else await user.keyboard("{Escape}");
      expect(onChange).not.toHaveBeenCalled();
      await waitFor(() => expect(trigger).toHaveFocus());
      await user.click(trigger);
      expect(screen.getByRole("textbox", { name: "Hex color" })).toHaveValue(
        "#123456",
      );
    },
  );

  it("keeps visual color input local until applied", async () => {
    const { user, onChange } = setup();
    await user.click(screen.getByRole("button", { name: "More colors" }));
    fireEvent.change(screen.getByLabelText("Visual color picker"), {
      target: { value: "#abcdef" },
    });
    expect(screen.getByRole("textbox", { name: "Hex color" })).toHaveValue(
      "#ABCDEF",
    );
    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Use this color" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("#ABCDEF");
  });

  it("provides accessible Thai presets and custom controls", async () => {
    const user = userEvent.setup();
    const { container } = renderWithIntl(
      <AreaColorPicker onChange={vi.fn()} />,
      { locale: "th" },
    );
    expect(
      screen.getByRole("group", { name: "สีพื้นที่" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ค่าเริ่มต้น" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole("button", { name: "สีเพิ่มเติม" }));
    const dialog = screen.getByRole("dialog", { name: "เลือกสีเพิ่มเติม" });
    expect(
      screen.getByRole("textbox", { name: "รหัสสี Hex" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ใช้สีนี้" })).toBeEnabled();
    expect(await axe(dialog)).toHaveNoViolations();
  });
});
