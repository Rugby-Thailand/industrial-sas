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
  previewEnvironment,
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
} from "@/lib/preview/masterDataPreview";
import { previewOrderLinesFor } from "@/lib/preview/inboundPreview";

import { ReceiptLineForm } from "./InboundForms";

/**
 * What the inbound screens do when the data is real — or when it is missing.
 *
 * The preview suite proves the screens *render*; this one proves they never
 * invent an identifier to render with. Two failure shapes are covered:
 *
 * 1. **An empty-but-successful read.** A warehouse with no dock configured is a
 *    master-data job, not an error, and the screen must say which. An empty
 *    `<select>` would let an operator submit a form whose refusal names a field
 *    they were never able to fill.
 * 2. **A blocked read.** No backend, no identity, or no chosen site. That is a
 *    different fix from an empty warehouse, and telling them apart is the whole
 *    reason `OptionSet` has three states.
 */
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
      { environment: previewEnvironment },
    );

  it("says nothing is configured rather than rendering an empty picker", () => {
    gate({ kind: "READY", values: [] });

    expect(screen.getByTestId("none")).toBeInTheDocument();
    expect(screen.queryByTestId("rendered")).not.toBeInTheDocument();
  });

  it("distinguishes a read in flight from an empty answer", () => {
    // A read that has not answered has not said there is nothing.
    gate({ kind: "LOADING" });

    expect(screen.queryByTestId("none")).not.toBeInTheDocument();
    expect(screen.queryByTestId("rendered")).not.toBeInTheDocument();
  });

  it("names the gate when the read cannot happen at all", () => {
    /*
     * "You have not chosen a warehouse" is one click; "this site has no dock" is
     * a supervisor's afternoon. A screen that showed the same message for both
     * would send an operator to the wrong place.
     */
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
      />,
      { environment: previewEnvironment },
    );

  it("offers the tenant's own locations by code", () => {
    chooser();

    const options = within(openSelect("ตำแหน่งที่รับเข้า")).getAllByRole(
      "option",
    );

    /*
     * Codes on the label, document identifiers underneath. An operator reads
     * `DOCK-IN-1` off a sign; the mutation takes the ID, and asserting both is
     * what stops one being quietly substituted for the other.
     */
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
    /*
     * The receiving flow is shared by the desktop receipt screen and the
     * handheld one — the same component, the same props, one keyboard path. If
     * the dock did not come back as an ID here, the pallet and the lines on it
     * would be recorded at different places.
     */
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
    /*
     * With no backend configured there is no receiving-location read, so the
     * capture step is blocked. The screen previously hard-coded a dock here and
     * would have sent a synthetic identifier to a real mutation.
     */
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
    // A label for a pallet that does not exist would carry a `targetId` the
    // tenant does not have.
    writeStoredWarehouse(BANG_PU);
    renderWithIntl(<ReceiptDetail receiptId="prv_rcpt_5010" />, {
      environment: previewEnvironment,
    });

    expect(screen.getByTestId("label-target-missing")).toBeInTheDocument();
    expect(screen.queryByTestId("form-label")).not.toBeInTheDocument();
  });

  it("offers the label control once the receipt has a pallet", () => {
    writeStoredWarehouse(BANG_PU);
    renderWithIntl(<ReceiptDetail receiptId="prv_rcpt_5001" />, {
      environment: previewEnvironment,
    });

    expect(screen.getByTestId("form-label")).toBeInTheDocument();
    expect(
      screen.queryByTestId("label-target-missing"),
    ).not.toBeInTheDocument();
  });
});

describe("HandheldReceive in real mode", () => {
  it("has no field for typing a receipt identifier", () => {
    /*
     * The receipt ID comes out of the write that created it. Asking an operator
     * to copy a Convex document ID between screens is not a flow anybody
     * completes wearing gloves.
     */
    writeStoredWarehouse(BANG_PU);
    renderWithIntl(<HandheldReceive />, { environment: previewEnvironment });

    expect(screen.queryByTestId("handheld-receipt-id")).not.toBeInTheDocument();
  });

  it("lists the tenant's own open orders to choose from", () => {
    writeStoredWarehouse(BANG_PU);
    renderWithIntl(<HandheldReceive />, { environment: previewEnvironment });

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
    renderWithIntl(<HandheldReceive />, { environment: previewEnvironment });

    // Nothing chosen yet: the screen says which step is missing.
    expect(screen.getByTestId("handheld-no-order")).toBeInTheDocument();
    expect(screen.queryByTestId("form-receipt-line")).not.toBeInTheDocument();
  });
});

describe("PutawayWorkbench in real mode", () => {
  it("offers no confirmation until a task is selected", () => {
    writeStoredWarehouse(BANG_PU);
    renderWithIntl(<PutawayWorkbench />, { environment: previewEnvironment });

    expect(screen.getByTestId("putaway-none-selected")).toBeInTheDocument();
    expect(
      screen.queryByTestId("form-confirm-putaway"),
    ).not.toBeInTheDocument();
  });
});

describe("the receipt-line capture form", () => {
  /**
   * The form that used to ask for an item's document ID.
   *
   * A capture screen is where the free-text-identifier problem is worst: it is
   * the one an operator uses hundreds of times a shift, on a scanner, wearing
   * gloves. So the item arrives one of two ways — resolved from what is printed
   * on the carton, or picked from what the order asked for — and neither is a
   * string only somebody with database access could produce.
   */
  const lines = previewOrderLinesFor("prv_po_2601");

  const render = () => {
    writeStoredWarehouse(BANG_PU);
    renderWithIntl(
      <ReceiptLineForm
        receiptId="prv_rcpt_5001"
        lines={lines}
        locationId="prv_loc_DOCK-IN-1"
      />,
      { environment: previewEnvironment },
    );
  };

  it("offers the ordered items by SKU and never as an identifier", () => {
    render();

    const labels = selectOptionLabels("สินค้าที่รับ");
    expect(labels.length).toBeGreaterThan(0);
    // A SKU a person reads off a box, not a `prv_`-shaped document ID.
    expect(labels.every((label) => !label.startsWith("prv_"))).toBe(true);
  });

  it("selects the ordered line a scanned barcode resolves to", () => {
    render();

    /*
     * Deliberately not the first line: the form defaults to that one, so a test
     * that scanned it would pass whether or not the scan did anything.
     */
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

    /*
     * The Radix trigger shows the *label* of the chosen row rather than its
     * value, which is the better assertion anyway: a document ID proves the
     * wiring, and the SKU proves the operator can read what the scan picked.
     */
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
    /*
     * The ordinary path posts what was ordered. An unexpected delivery is a
     * second person's decision (`INV-0007-06`), so the screen says so instead of
     * quietly letting the server refuse a field the operator filled correctly.
     */
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
