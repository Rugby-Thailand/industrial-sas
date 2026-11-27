import { messagesFor } from "@/i18n/messages";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import { chooseOption } from "@tests/fixtures/select-control";

vi.mock("@/components/ui/PageBackLink", () => ({
  PageBackLink: () => null,
}));
vi.mock("@/components/ui/PageBreadcrumbs", () => ({
  PageBreadcrumbs: () => null,
}));
vi.mock("@/components/ui/PageBackButton", () => ({
  PageBackButton: () => null,
}));

import { CatalogueFilterBar, ColumnFilter } from "./CatalogueFilterControls";
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

  it("offers the short measurement choice as radios", () => {
    const onChange = showColumnFilter("dimensions");

    expect(screen.getByRole("radio", { name: "All" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "Measured" }));
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

it("shows range errors beside the range they describe", () => {
  showColumnFilter("dimensions");
  const length = screen.getByRole("group", { name: "Length (m)" });
  fireEvent.change(within(length).getByLabelText("Length (m) minimum"), {
    target: { value: "3" },
  });
  fireEvent.change(within(length).getByLabelText("Length (m) maximum"), {
    target: { value: "2" },
  });

  const error = within(length).getByRole("alert");
  expect(error).toHaveTextContent("Maximum must be at least the minimum.");
  expect(within(length).getByLabelText("Length (m) minimum")).toHaveAttribute(
    "aria-describedby",
    error.id,
  );
  expect(
    within(screen.getByRole("group", { name: "Width (m)" })).queryByRole(
      "alert",
    ),
  ).toBeNull();
  expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
});

it("asks for a counting unit beside a quantity range", () => {
  showColumnFilter("quantity");
  fireEvent.change(screen.getByLabelText("Quantity minimum"), {
    target: { value: "5" },
  });
  expect(
    within(screen.getByRole("group", { name: "Quantity" })).getByRole("alert"),
  ).toHaveTextContent("Choose a counting unit to apply this range.");
});

describe("catalogue filter bar", () => {
  function showBar(filters: CatalogueFilters, search = "") {
    const onChange = vi.fn();
    const onSearchChange = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={messagesFor("en")}>
        <CatalogueFilterBar
          tab="products"
          filters={filters}
          units={["PCS"]}
          onChange={onChange}
          search={search}
          onSearchChange={onSearchChange}
        />
      </NextIntlClientProvider>,
    );
    return { onChange, onSearchChange };
  }
  const applied: CatalogueFilters = {
    ...newFilters(),
    formats: ["PALLET", "BOX"],
    statuses: ["ACTIVE"],
    sort: "name:asc",
  };

  it("counts conditions, not selected values, and names each condition", () => {
    showBar(applied);
    expect(screen.getByRole("button", { name: "Filters (2)" })).toBeVisible();
    const chips = screen.getByRole("group", { name: "Active filters" });
    expect(
      within(chips).getByRole("button", {
        name: "Edit Format: Pallets, Boxes",
      }),
    ).toBeVisible();
    expect(
      within(chips).getByRole("button", { name: "Edit Status: Ready" }),
    ).toBeVisible();
    // Sort and search are not filter conditions and have their own controls.
    expect(within(chips).queryByText(/Sort/)).toBeNull();
  });

  it("removes one condition without touching the sort", () => {
    const { onChange } = showBar(applied);
    fireEvent.click(
      screen.getByRole("button", { name: "Remove filter Format" }),
    );
    expect(onChange).toHaveBeenCalledWith({
      ...applied,
      formats: [],
    });
    expect(screen.getByRole("button", { name: /^Filters/ })).toHaveFocus();
  });

  it("clears all conditions but keeps the search and sort", () => {
    const { onChange, onSearchChange } = showBar(applied, "steel");
    fireEvent.click(screen.getByRole("button", { name: "Clear all filters" }));
    expect(onChange).toHaveBeenCalledWith({
      ...newFilters(),
      sort: "name:asc",
    });
    expect(onSearchChange).not.toHaveBeenCalled();
  });

  it("offers one clear action per scope", () => {
    showBar({ ...newFilters(), statuses: ["ACTIVE"] }, "steel");
    expect(screen.getByRole("button", { name: "Filters (1)" })).toBeVisible();
    // A single condition is cleared from its chip; search has its own clear.
    expect(
      screen.queryByRole("button", { name: "Clear all filters" }),
    ).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Clear/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Clear search" })).toBeVisible();
  });

  it("hides the count and chips without conditions", () => {
    showBar({ ...newFilters(), sort: "name:asc" });
    expect(screen.getByRole("button", { name: "Filters" })).toBeVisible();
    expect(screen.queryByRole("group", { name: "Active filters" })).toBeNull();
  });

  it("edits a chip's condition alone and Cancel discards the draft", async () => {
    const { onChange } = showBar(applied);
    fireEvent.click(
      screen.getByRole("button", { name: "Edit Format: Pallets, Boxes" }),
    );
    const editor = screen.getByRole("dialog", { name: "Format" });
    expect(
      within(editor).queryByRole("checkbox", { name: "Ready" }),
    ).toBeNull();
    expect(
      within(editor).queryByRole("combobox", { name: "Sort by" }),
    ).toBeNull();
    fireEvent.click(within(editor).getByRole("checkbox", { name: "Pallets" }));
    fireEvent.click(within(editor).getByRole("button", { name: "Cancel" }));
    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => expect(editor).not.toBeInTheDocument());

    fireEvent.click(
      screen.getByRole("button", { name: "Edit Format: Pallets, Boxes" }),
    );
    const again = screen.getByRole("dialog", { name: "Format" });
    fireEvent.click(within(again).getByRole("checkbox", { name: "Pallets" }));
    fireEvent.click(within(again).getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ ...applied, formats: ["BOX"] }),
    );
  });

  it("does not repeat sort menus in the full filter editor", () => {
    showBar(applied);
    fireEvent.click(screen.getByRole("button", { name: "Filters (2)" }));
    const editor = screen.getByRole("dialog", { name: "Filters" });
    expect(
      within(editor).queryByRole("combobox", { name: "Sort by" }),
    ).toBeNull();
  });

  it("scopes the search hint to the tab", () => {
    showBar(newFilters());
    expect(
      screen.getByRole("textbox", { name: "Search finished goods" }),
    ).toHaveAttribute("placeholder", "Search name or SKU");
  });
});
