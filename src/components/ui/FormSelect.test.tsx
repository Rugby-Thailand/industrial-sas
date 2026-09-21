import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithIntl } from "../../../tests/fixtures/intl-render";
import { FormSelect } from "./FormSelect";

describe("FormSelect", () => {
  it("forwards hint and validation state to the select trigger", () => {
    renderWithIntl(
      <FormSelect
        id="format"
        label="Format"
        hint="Choose a storage format"
        error="Choose a format"
        value=""
        onValueChange={() => undefined}
        options={[{ value: "BOX", label: "Box" }]}
        placeholder="Choose format"
        emptyLabel="No formats"
        required
      />,
    );

    const trigger = screen.getByRole("combobox", { name: "Format" });
    expect(trigger).toHaveAttribute("aria-invalid", "true");
    expect(trigger).toHaveAttribute("aria-required", "true");
    expect(trigger).toHaveAccessibleDescription(
      "Choose a storage format Choose a format",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a format");
  });
});
