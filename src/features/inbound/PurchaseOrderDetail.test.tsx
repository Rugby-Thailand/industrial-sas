import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { navigationMock } from "../../../tests/fixtures/navigation-mock";

vi.mock("@/i18n/navigation", () => navigationMock);

import {
  previewEnvironment,
  renderWithIntl,
} from "../../../tests/fixtures/intl-render";
import { writeStoredWarehouse } from "@/lib/workspace/warehouseStore";

import { PurchaseOrderDetail } from "./PurchaseOrderDetail";

import { previewOrderLinesFor } from "@/lib/preview/inboundPreview";

const BANG_PU = "prv_wh_bangpoo";

/**
 * One purchase order, and the one number on the screen.
 *
 * The audit found the heading claiming zero lines above a table of two. The
 * heading was `linesCaption` with a hard-coded `{count: 0}`: the rows are read
 * by the panel underneath, so nothing at the heading's level ever knew how many
 * there were. These assert that the count is stated once, next to the rows it
 * counts, and that it is the real one.
 */
describe("PurchaseOrderDetail", () => {
  const renderDetail = (locale: "th" | "en" = "th") => {
    writeStoredWarehouse(BANG_PU);
    return renderWithIntl(
      <PurchaseOrderDetail purchaseOrderId="prv_po_2601" />,
      { locale, environment: previewEnvironment },
    );
  };

  it("heads the lines section without claiming a count", () => {
    renderDetail();

    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "รายการสินค้าในใบสั่งซื้อ",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("รายการสินค้า 0 บรรทัด")).not.toBeInTheDocument();
  });

  it("counts the lines the table actually contains", () => {
    const lines = previewOrderLinesFor("prv_po_2601");
    expect(lines).toHaveLength(2);

    renderDetail();

    expect(
      screen.getByText(`รายการสินค้า ${lines.length} บรรทัด`),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(lines.length + 1);
  });

  it("says the same thing in English", () => {
    renderDetail("en");

    expect(
      screen.getByRole("heading", { level: 2, name: "Order lines" }),
    ).toBeInTheDocument();
    expect(screen.getByText("2 lines")).toBeInTheDocument();
    expect(screen.queryByText("0 lines")).not.toBeInTheDocument();
  });
});
