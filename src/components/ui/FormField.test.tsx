import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FormField } from "./FormField";

describe("FormField", () => {
  it("associates the label, help, and validation error with its control", () => {
    const { rerender } = render(
      <FormField
        id="width"
        label="Width"
        required
        hint="Metres"
        error="Enter a positive width"
      >
        {(props) => <input {...props} required />}
      </FormField>,
    );
    const input = screen.getByRole("textbox", { name: "Width" });
    expect(input).toHaveAccessibleDescription("Metres Enter a positive width");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-required", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a positive width",
    );
    rerender(
      <FormField id="width" label="Width" hint="Metres">
        {(props) => <input {...props} />}
      </FormField>,
    );
    expect(input).toHaveAccessibleDescription("Metres");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
