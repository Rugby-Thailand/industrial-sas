import { fireEvent, screen } from "@testing-library/react";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import { finishedGoodProduct } from "@tests/fixtures/finished-goods-ui";
import { expect, it, vi } from "vitest";
import { FinishedGoodsTable } from "./FinishedGoodsTable";
import { newFilters } from "./catalogueFilters";

vi.mock("@/i18n/navigation", () => ({ Link: "a" }));

it("retains an open filter draft and focus across authoritative row updates", () => {
  const onChange = vi.fn();
  const filters = newFilters();
  function table(name: string) {
    const products = [{ ...finishedGoodProduct, name }];
    return (
      <FinishedGoodsTable
        tab="products"
        products={products}
        pallets={[]}
        allProducts={products}
        allPallets={[]}
        canManage
        filterControls={{
          tab: "products",
          filters,
          units: ["pieces"],
          onChange,
        }}
      />
    );
  }
  const view = renderWithIntl(table("Before update"), {
    locale: "en",
    preserveProviders: true,
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Filter and sort Product" }),
  );
  const input = screen.getByRole("textbox", { name: "Name or SKU" });
  input.focus();
  fireEvent.change(input, { target: { value: "draft filter" } });
  view.rerender(table("Authoritative update"));
  expect(screen.getByText("Authoritative update")).toBeVisible();
  expect(screen.getByRole("textbox", { name: "Name or SKU" })).toBe(input);
  expect(input).toHaveValue("draft filter");
  expect(input).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({ record: "draft filter" }),
  );
});

it("retains the focused row action while its live description changes", () => {
  function table(name: string) {
    const products = [{ ...finishedGoodProduct, name }];
    return (
      <FinishedGoodsTable
        tab="products"
        products={products}
        pallets={[]}
        allProducts={products}
        allPallets={[]}
        canManage
      />
    );
  }
  const view = renderWithIntl(table("Before"), {
    locale: "en",
    preserveProviders: true,
  });
  const action = screen.getByRole("link", { name: "Edit FG-001" });
  action.focus();
  view.rerender(table("After"));
  expect(screen.getByRole("link", { name: "Edit FG-001" })).toBe(action);
  expect(action).toHaveFocus();
  expect(screen.getByRole("link", { name: "After" })).toBeVisible();
});
