import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { navigationMock } from "../../../tests/fixtures/navigation-mock";
import {
  chooseOption,
  openSelect,
  selectOptionLabels,
  selectedLabel,
} from "../../../tests/fixtures/select-control";

vi.mock("@/i18n/navigation", () => navigationMock);

import {
  testEnvironment,
  renderWithIntl,
  unconfiguredEnvironment,
} from "../../../tests/fixtures/intl-render";
import { writeStoredWarehouse } from "@/lib/workspace/warehouseStore";

import { HandheldReceive } from "./HandheldReceive";
import { LocationChooser, ReceiptDetail } from "./ReceiptDetail";
import { OptionGate } from "./OptionPicker";
import { PutawayWorkbench } from "./PutawayWorkbench";
import type { OptionSet } from "./OptionPicker";
import {
  previewBarcodesFor,
  previewItems,
  previewLocationsFor,
} from "@tests/fixtures/data/masterData";
import { previewOrderLinesFor } from "@tests/fixtures/data/inbound";

import { ReceiptLineForm } from "./InboundForms";

const BANG_PU = "prv_wh_bangpoo";

describe("OptionGate", () => {
  const child = (values: readonly string[]) => (
    <span data-testid="rendered">{values.join(",")}</span>
  );

  const gate = (options: OptionSet<string>) =>
    renderWithIntl(
      <OptionGate
        options={options}
        emptyTitle="ไม่มีตัวเลือก"
        emptyBody="ต้องตั้งค่าข้อมูลหลักก่อน"
        emptyTestId="none"
      >
        {child}
      </OptionGate>,
      { environment: testEnvironment },
    );

  it("says nothing is configured rather than rendering an empty picker", () => {
    gate({ kind: "READY", values: [] });

    expect(screen.getByTestId("none")).toBeInTheDocument();
    expect(screen.queryByTestId("rendered")).not.toBeInTheDocument();
  });

  it("distinguishes a read in flight from an empty answer", () => {
    gate({ kind: "LOADING" });

    expect(screen.queryByTestId("none")).not.toBeInTheDocument();
    expect(screen.queryByTestId("rendered")).not.toBeInTheDocument();
  });

  it("names the gate when the read cannot happen at all", () => {
    gate({ kind: "BLOCKED", gate: { kind: "WAREHOUSE_MISSING" } });
    expect(screen.getByTestId("panel-WAREHOUSE_MISSING")).toBeInTheDocument();
  });

  it("renders its child once there is something to choose", () => {
    gate({ kind: "READY", values: ["A", "B"] });
    expect(screen.getByTestId("rendered")).toHaveTextContent("A,B");
  });
});

describe("LocationChooser", () => {
  const chooser = (onChange: (locationId: string) => void = () => undefined) =>
    renderWithIntl(
      <LocationChooser
        locations={previewLocationsFor(BANG_PU)}
        value=""
        onChange={onChange}
        label="ตำแหน่งที่รับเข้า"
        placeholder="เลือกตำแหน่งที่รับเข้า"
      />,
      { environment: testEnvironment },
    );

  it("offers the tenant's own locations by code", () => {
    chooser();

    const options = within(openSelect("ตำแหน่งที่รับเข้า")).getAllByRole(
      "option",
    );

    expect(options.length).toBeGreaterThan(0);
    expect(
      options.every((option) =>
        (option.getAttribute("data-value") ?? "").startsWith("prv_loc_"),
      ),
    ).toBe(true);
    expect(
      options.every((option) => !(option.textContent ?? "").startsWith("prv_")),
    ).toBe(true);
  });

  it("hands the chosen dock's identifier to its caller", () => {
    const onChange = vi.fn();
    const dock = previewLocationsFor(BANG_PU)[0];
    expect(dock).toBeDefined();

    chooser(onChange);
    chooseOption("ตำแหน่งที่รับเข้า", dock?.code ?? "");

    expect(onChange).toHaveBeenCalledWith(dock?.locationId);
  });

  it("is operable by keyboard alone, because a scanner is a keyboard", () => {
    const onChange = vi.fn();
    chooser(onChange);

    const trigger = screen.getByLabelText("ตำแหน่งที่รับเข้า");
    fireEvent.keyDown(trigger, { key: "Enter" });
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    fireEvent.keyDown(options[0]!, { key: "Enter" });

    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("ReceiptDetail in real mode", () => {
  it("blocks every step rather than assuming a dock", () => {
    writeStoredWarehouse(BANG_PU);
    renderWithIntl(<ReceiptDetail receiptId="rcpt_real_1" />, {
      environment: unconfiguredEnvironment,
    });

    expect(
      screen.getAllByTestId("panel-BACKEND_MISSING").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByTestId("receiving-location")).not.toBeInTheDocument();
  });

  it("offers no label control until a pallet exists", () => {
    writeStoredWarehouse(BANG_PU);
    renderWithIntl(<ReceiptDetail receiptId="prv_rcpt_5010" />, {
      environment: testEnvironment,
    });

    expect(screen.getByTestId("label-target-missing")).toBeInTheDocument();
    expect(screen.queryByTestId("form-label")).not.toBeInTheDocument();
  });

  it("offers the label control once the receipt has a pallet", () => {
    writeStoredWarehouse(BANG_PU);
    renderWithIntl(<ReceiptDetail receiptId="prv_rcpt_5001" />, {
      environment: testEnvironment,
    });

    expect(screen.getByTestId("form-label")).toBeInTheDocument();
    expect(
      screen.queryByTestId("label-target-missing"),
    ).not.toBeInTheDocument();
  });
});

describe("HandheldReceive in real mode", () => {
  it("has no field for typing a receipt identifier", () => {
    writeStoredWarehouse(BANG_PU);
    renderWithIntl(<HandheldReceive />, { environment: testEnvironment });

    expect(screen.queryByTestId("handheld-receipt-id")).not.toBeInTheDocument();
  });

  it("lists the tenant's own open orders to choose from", () => {
    writeStoredWarehouse(BANG_PU);
    renderWithIntl(<HandheldReceive />, { environment: testEnvironment });

    // The fixture's two open orders; the draft is not offered, because a draft
    // has no lines and cannot be received against.
    expect(
      screen.getByTestId("handheld-pick-order-PO-2601"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("handheld-pick-order-PO-2603"),
    ).not.toBeInTheDocument();
  });

  it("waits for a receipt before offering the capture step", () => {
    writeStoredWarehouse(BANG_PU);
    renderWithIntl(<HandheldReceive />, { environment: testEnvironment });

    expect(screen.getByTestId("handheld-no-order")).toBeInTheDocument();
    expect(screen.queryByTestId("form-receipt-line")).not.toBeInTheDocument();
  });
});

describe("PutawayWorkbench in real mode", () => {
  it("offers no confirmation until a task is selected", () => {
    writeStoredWarehouse(BANG_PU);
    renderWithIntl(<PutawayWorkbench />, { environment: testEnvironment });

    expect(screen.getByTestId("putaway-none-selected")).toBeInTheDocument();
    expect(
      screen.queryByTestId("form-confirm-putaway"),
    ).not.toBeInTheDocument();
  });
});

describe("the receipt-line capture form", () => {
  const lines = previewOrderLinesFor("prv_po_2601");

  const render = () => {
    writeStoredWarehouse(BANG_PU);
    renderWithIntl(
      <ReceiptLineForm
        receiptId="prv_rcpt_5001"
        lines={lines}
        locationId="prv_loc_DOCK-IN-1"
      />,
      { environment: testEnvironment },
    );
  };

  it("offers the ordered items by SKU and never as an identifier", () => {
    render();

    const labels = selectOptionLabels("สินค้าที่รับ");
    expect(labels.length).toBeGreaterThan(0);

    expect(labels.every((label) => !label.startsWith("prv_"))).toBe(true);
  });

  it("selects the ordered line a scanned barcode resolves to", () => {
    render();

    const target = lines.find(
      (line) =>
        line.purchaseOrderLineId !== lines[0]?.purchaseOrderLineId &&
        previewBarcodesFor(line.itemId).some((row) => row.status === "ACTIVE"),
    );
    const barcode = previewBarcodesFor(target?.itemId ?? "").find(
      (row) => row.status === "ACTIVE",
    );
    expect(barcode).toBeDefined();

    fireEvent.change(screen.getByLabelText("สแกนกล่องสินค้า"), {
      target: { value: barcode?.barcode ?? "" },
    });
    fireEvent.click(screen.getByTestId("scan-to-item-resolve"));

    const sku = previewItems().find(
      (item) => item.itemId === target?.itemId,
    )?.sku;
    expect(sku).toBeDefined();
    expect(selectedLabel("สินค้าที่รับ")).toContain(sku ?? "");
    expect(selectedLabel("บรรทัดในใบสั่งซื้อ")).toContain(
      `#${target?.lineNumber ?? ""} · ${sku ?? ""}`,
    );
  });

  it("says a scan matched nothing rather than silently ignoring it", () => {
    render();

    fireEvent.change(screen.getByLabelText("สแกนกล่องสินค้า"), {
      target: { value: "NOT-A-REAL-LABEL" },
    });
    fireEvent.click(screen.getByTestId("scan-to-item-resolve"));

    expect(screen.getByTestId("scan-to-item-unknown")).toBeInTheDocument();
  });

  it("names an item that resolved but is not on this order", () => {
    render();

    const offOrder = previewItems().find(
      (item) =>
        item.status === "ACTIVE" &&
        !lines.some((line) => line.itemId === item.itemId),
    );
    fireEvent.change(screen.getByLabelText("สแกนกล่องสินค้า"), {
      target: { value: offOrder?.sku ?? "" },
    });
    fireEvent.click(screen.getByTestId("scan-to-item-resolve"));

    expect(
      screen.getByTestId("receiving-scan-not-on-order"),
    ).toBeInTheDocument();
  });
});
