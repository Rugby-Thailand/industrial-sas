import { messagesFor } from "@/i18n/messages";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import { chooseOption } from "@tests/fixtures/select-control";

vi.mock("@/components/ui/PageBackLink", () => ({
  PageBackLink: () => null,
}));

import { ColumnFilter } from "./CatalogueFilterControls";
import {
  newFilters,
  type CatalogueFilters,
  type FilterColumn,
} from "./catalogueFilters";

function showColumnFilter(
  column: FilterColumn,
  filters: CatalogueFilters = newFilters(),
) {
  const onChange = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={messagesFor("en")}>
      <ColumnFilter
        column={column}
        tab="products"
        filters={filters}
        units={["PCS", "KG"]}
        onChange={onChange}
      >
        <span>{column}</span>
      </ColumnFilter>
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Filter and sort/ }));
  return onChange;
}

describe("catalogue filter selects", () => {
  it("uses an app-style select and clears a quantity range when its unit is removed", () => {
    const onChange = showColumnFilter("quantity", {
      ...newFilters(),
      unit: "PCS",
      quantity: { min: "10", max: "" },
    });

    expect(
      screen.getByRole("combobox", { name: "Counting unit" }),
    ).toHaveAttribute("data-slot", "select-trigger");
    chooseOption("Counting unit", "All units");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        unit: "",
        quantity: { min: "", max: "" },
      }),
    );
  });

  it("commits a measurement filter selected from the app-style menu", () => {
    const onChange = showColumnFilter("dimensions");

    chooseOption("Measurement", "Measured");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ measurement: "measured" }),
    );
  });

  it("commits a selected sort option", () => {
    const onChange = showColumnFilter("record");

    chooseOption("Sort by", "Product name · Ascending");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ sort: "name:asc" }),
    );
  });
});
