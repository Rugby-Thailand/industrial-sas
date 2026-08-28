import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { navigationMock } from "../../../tests/fixtures/navigation-mock";

vi.mock("@/i18n/navigation", () => navigationMock);

import {
  testEnvironment,
  renderWithIntl,
} from "../../../tests/fixtures/intl-render";
import { writeStoredWarehouse } from "@/lib/workspace/warehouseStore";

import { PurchaseOrderDetail } from "./PurchaseOrderDetail";

import { previewOrderLinesFor } from "@tests/fixtures/data/inbound";

const BANG_PU = "prv_wh_bangpoo";

describe("PurchaseOrderDetail", () => {
  const renderDetail = (locale: "th" | "en" = "th") => {
    writeStoredWarehouse(BANG_PU);
    return renderWithIntl(
      <PurchaseOrderDetail purchaseOrderId="prv_po_2601" />,
      { locale, environment: testEnvironment },
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

  it("uses compact accessible icon actions for open lines", () => {
    renderDetail();

    const actions = screen.getAllByRole("button", {
      name: "ปิดบรรทัดทั้งที่ยังไม่ครบ",
    });
    expect(actions).toHaveLength(2);
    for (const action of actions) {
      expect(action).toHaveAttribute("title", "ปิดบรรทัดทั้งที่ยังไม่ครบ");
      expect(action.querySelector("svg")).not.toBeNull();
    }
    expect(
      screen.queryByText("ปิดบรรทัดทั้งที่ยังไม่ครบ"),
    ).not.toBeInTheDocument();
  });
});
