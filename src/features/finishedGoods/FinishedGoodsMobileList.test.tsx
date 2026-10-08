import { screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { renderWithIntl } from "@tests/fixtures/intl-render";
import {
  finishedGoodsList,
  finishedGoodProduct,
} from "@tests/fixtures/finished-goods-ui";
import { FinishedGoodsMobileList } from "./FinishedGoodsMobileList";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, ...props }: ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
}));

it("keeps product identity, quantity unit and next action when only enriched pallets are loaded", () => {
  const pallets = finishedGoodsList.pallets.map((pallet) => ({
    ...pallet,
    unit: "PCS",
    storageFormat: "PALLET" as const,
  }));
  renderWithIntl(
    <FinishedGoodsMobileList
      tab="pallets"
      products={[]}
      pallets={pallets}
      allProducts={[]}
      allPallets={pallets}
      canManage={false}
    />,
    { locale: "en" },
  );
  expect(screen.getByText(finishedGoodProduct.sku)).toBeVisible();
  expect(screen.getByText(finishedGoodProduct.name)).toBeVisible();
  expect(screen.getByText(/500 PCS/)).toBeVisible();
  expect(screen.getByText("Pallet")).toBeVisible();
  expect(
    screen.getByRole("link", { name: /View details P-001/ }),
  ).toHaveAttribute("href", "/finished-goods/pallets/pallet-a");
});
