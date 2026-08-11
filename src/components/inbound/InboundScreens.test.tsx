import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { navigationMock } from "../../../tests/fixtures/navigation-mock";

vi.mock("@/i18n/navigation", () => navigationMock);

import {
  previewEnvironment,
  renderWithIntl,
  unconfiguredEnvironment,
} from "../../../tests/fixtures/intl-render";
import { writeStoredWarehouse } from "@/lib/workspace/warehouseStore";

import {
  ImportAcceptedTable,
  ImportRejectedTable,
  InspectionsTable,
  PrintJobsTable,
  PurchaseOrderLinesTable,
  PurchaseOrdersTable,
  PutawayTasksTable,
  ReceiptLinesTable,
  ReceiptsTable,
} from "./InboundTables";

import { PutawayRecommendationPanel } from "@/features/inbound/PutawayRecommendation";
import { ReceivingExceptionForm } from "@/features/inbound/InboundForms";
import {
  previewImportOutcome,
  previewInspectionsFor,
  previewOrderLinesFor,
  previewPrintJobsFor,
  previewPurchaseOrdersFor,
  previewPutawayTasksFor,
  previewReceiptLinesFor,
  previewReceiptsFor,
} from "@/lib/preview/inboundPreview";

const BANG_PU = "prv_wh_bangpoo";
const importOutcome = previewImportOutcome("BATCH-1");
const accepted = importOutcome.ok ? importOutcome.accepted : [];
const rejected = importOutcome.ok ? importOutcome.rejected : [];

describe("PurchaseOrdersTable", () => {
  it("is a real table with a caption and column headers", () => {
    renderWithIntl(
      <PurchaseOrdersTable rows={previewPurchaseOrdersFor(BANG_PU)} />,
    );

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "เลขที่ใบสั่งซื้อ" }),
    ).toBeInTheDocument();
  });

  it("shows a draft as a draft rather than as receivable", () => {
    // A draft has no lines, so it cannot be received against. Showing it as
    // open would put an empty order in front of somebody at a dock.
    renderWithIntl(
      <PurchaseOrdersTable rows={previewPurchaseOrdersFor(BANG_PU)} />,
    );
    expect(screen.getByText("ฉบับร่าง")).toBeInTheDocument();
  });

  it("keeps the order number English in both locales", () => {
    const thai = renderWithIntl(
      <PurchaseOrdersTable rows={previewPurchaseOrdersFor(BANG_PU)} />,
    );
    expect(thai.getByText("PO-2601")).toBeInTheDocument();
    thai.unmount();

    const english = renderWithIntl(
      <PurchaseOrdersTable rows={previewPurchaseOrdersFor(BANG_PU)} />,
      { locale: "en" },
    );
    expect(english.getByText("PO-2601")).toBeInTheDocument();
  });
});

describe("PurchaseOrderLinesTable", () => {
  it("shows the ordered quantity in the unit the order was written in", () => {
    /*
     * A buyer reading "40 CASE" against a supplier's paperwork must not be
     * shown the base-unit figure instead, even though that is what the ledger
     * stores.
     */
    renderWithIntl(
      <PurchaseOrderLinesTable rows={previewOrderLinesFor("prv_po_2601")} />,
    );
    expect(screen.getByText("40.000 CASE")).toBeInTheDocument();
  });

  it("shows what is still outstanding on a partly received line", () => {
    renderWithIntl(
      <PurchaseOrderLinesTable rows={previewOrderLinesFor("prv_po_2601")} />,
    );
    // 500 ordered, 180 received.
    expect(screen.getByText("320")).toBeInTheDocument();
  });

  it("marks a short-closed line rather than showing it as quietly finished", () => {
    renderWithIntl(
      <PurchaseOrderLinesTable rows={previewOrderLinesFor("prv_po_2602")} />,
    );
    expect(screen.getByText("ปิดทั้งที่ยังไม่ครบ")).toBeInTheDocument();
  });
});

describe("import tables", () => {
  it("shows each accepted row with the reference that makes it idempotent", () => {
    renderWithIntl(<ImportAcceptedTable rows={accepted} />);
    expect(screen.getByText("BATCH-1:1")).toBeInTheDocument();
  });

  it("numbers a rejected row the way the operator's spreadsheet does", () => {
    // Header is line 1, so the first data row is line 2.
    renderWithIntl(<ImportRejectedTable rows={rejected} />);
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("ไม่ได้กรอกค่าที่จำเป็น")).toBeInTheDocument();
  });
});

describe("ReceiptLinesTable", () => {
  it("distinguishes an ordinary receipt from an exception", () => {
    const rows = [
      ...previewReceiptLinesFor("prv_rcpt_5001"),
      ...previewReceiptLinesFor("prv_rcpt_5010"),
    ];
    renderWithIntl(<ReceiptLinesTable rows={rows} />);

    expect(screen.getByText("ตามใบสั่งซื้อ")).toBeInTheDocument();
    expect(screen.getByText("รับโดยไม่มีใบสั่งซื้อ")).toBeInTheDocument();
  });

  it("shows held stock as held", () => {
    // `QC_HOLD` is the state an operator most needs to see on a receipt line:
    // the stock is theirs and they may not use it.
    renderWithIntl(
      <ReceiptLinesTable rows={previewReceiptLinesFor("prv_rcpt_5002")} />,
    );
    expect(screen.getByText("รอตรวจสอบคุณภาพ")).toBeInTheDocument();
  });

  it("shows a quantity with its unit, never bare", () => {
    renderWithIntl(
      <ReceiptLinesTable rows={previewReceiptLinesFor("prv_rcpt_5001")} />,
    );
    expect(screen.getByText("180.000 KG")).toBeInTheDocument();
  });
});

describe("ReceiptsTable", () => {
  it("shows the business date verbatim, not through a locale formatter", () => {
    renderWithIntl(<ReceiptsTable rows={previewReceiptsFor(BANG_PU)} />);
    expect(screen.getByText("2026-08-10")).toBeInTheDocument();
  });
});

describe("InspectionsTable", () => {
  it("shows the sample plan as it was computed at receipt", () => {
    renderWithIntl(<InspectionsTable rows={previewInspectionsFor(BANG_PU)} />);
    expect(screen.getByText("20 จาก 200")).toBeInTheDocument();
  });

  it("distinguishes open, parked, and disposed", () => {
    /*
     * The parked state is the one that must not read as a failure: it means a
     * second person is required (`INV-0007-06`), not that anything went wrong.
     */
    renderWithIntl(<InspectionsTable rows={previewInspectionsFor(BANG_PU)} />);

    expect(screen.getByText("รอตรวจ")).toBeInTheDocument();
    expect(screen.getByText("รออนุมัติ")).toBeInTheDocument();
    expect(screen.getByText("ตัดสินแล้ว")).toBeInTheDocument();
  });

  it("offers the decide control only on an open inspection", () => {
    renderWithIntl(
      <InspectionsTable
        rows={previewInspectionsFor(BANG_PU)}
        renderAction={(row) =>
          row.status === "OPEN" ? <button type="button">decide</button> : null
        }
      />,
    );
    expect(screen.getAllByRole("button", { name: "decide" })).toHaveLength(1);
  });
});

describe("PutawayTasksTable", () => {
  it("shows the recommended and the chosen location side by side", () => {
    // Either alone says nothing about what happened; the pair *is* the override
    // record (`INV-0007-09`).
    renderWithIntl(
      <PutawayTasksTable rows={previewPutawayTasksFor(BANG_PU)} />,
    );

    expect(
      screen.getByRole("columnheader", { name: "ตำแหน่งที่แนะนำ" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "ตำแหน่งที่เลือกจริง" }),
    ).toBeInTheDocument();
  });

  it("shows a claimed task as claimed rather than hiding it", () => {
    renderWithIntl(
      <PutawayTasksTable rows={previewPutawayTasksFor(BANG_PU)} />,
    );
    expect(screen.getByText("มีผู้รับงานแล้ว")).toBeInTheDocument();
  });
});

describe("PrintJobsTable", () => {
  it("never shows a status claiming a label was printed", () => {
    /*
     * Nothing in this repository can observe a printer (`INT-04` absent,
     * `RG-004` open). Every job is `GENERATED`.
     */
    renderWithIntl(
      <PrintJobsTable rows={previewPrintJobsFor("prv_hu_pallet_01")} />,
    );

    expect(screen.getAllByText("GENERATED")).toHaveLength(2);
    expect(screen.queryByText("PRINTED")).not.toBeInTheDocument();
  });

  it("distinguishes a reprint from a first print", () => {
    renderWithIntl(
      <PrintJobsTable rows={previewPrintJobsFor("prv_hu_pallet_01")} />,
    );
    expect(screen.getByText("INITIAL")).toBeInTheDocument();
    expect(screen.getByText("REPRINT")).toBeInTheDocument();
  });
});

describe("PutawayRecommendationPanel", () => {
  it("shows the score components, and they sum to the score", () => {
    // The whole point of an explainable recommendation is that somebody can
    // check the arithmetic (D-14).
    renderWithIntl(
      <PutawayRecommendationPanel
        warehouseId={BANG_PU}
        putawayTaskId="prv_task_4001"
      />,
      { environment: previewEnvironment },
    );

    expect(screen.getByTestId("putaway-recommendation")).toBeInTheDocument();
    expect(screen.getByText("A01-02-1")).toBeInTheDocument();
    expect(screen.getByText("380")).toBeInTheDocument();
    expect(
      screen.getByText("มีสินค้าเดียวกันอยู่แล้ว 300 คะแนน (น้ำหนัก 300)"),
    ).toBeInTheDocument();
  });

  it("says why a location was filtered out", () => {
    // "Why is my bin not in the list?" is the question this panel exists for.
    renderWithIntl(
      <PutawayRecommendationPanel
        warehouseId={BANG_PU}
        putawayTaskId="prv_task_4001"
      />,
      { environment: previewEnvironment },
    );

    expect(screen.getByText("DOCK-IN-1")).toBeInTheDocument();
    // Both the dock and the staging lane were filtered out for the same reason,
    // so the message appears twice — one row each, which is the point.
    expect(
      screen.getAllByText("ไม่ใช่ตำแหน่งจัดเก็บ เช่น ท่ารับหรือพื้นที่พัก"),
    ).toHaveLength(2);
  });

  it("names the filters that ran, so a missing rejection is not ambiguous", () => {
    renderWithIntl(
      <PutawayRecommendationPanel
        warehouseId={BANG_PU}
        putawayTaskId="prv_task_4001"
      />,
      { environment: previewEnvironment },
    );
    expect(screen.getByText(/CAPACITY_SUFFICIENT/)).toBeInTheDocument();
  });

  it("explains a missing backend rather than rendering an empty panel", () => {
    renderWithIntl(
      <PutawayRecommendationPanel
        warehouseId={BANG_PU}
        putawayTaskId="prv_task_4001"
      />,
      { environment: unconfiguredEnvironment },
    );
    expect(screen.getByTestId("panel-BACKEND_MISSING")).toBeInTheDocument();
  });
});

describe("ReceivingExceptionForm", () => {
  /*
   * Every inbound write is warehouse-scoped, and the workspace resolves the
   * selection from browser storage. Seeding it is what puts the form in the
   * state an operator reaches it in; without it the screen correctly shows
   * "no warehouse selected" instead.
   */
  const withWarehouse = () => writeStoredWarehouse("prv_wh_bangpoo");

  it("says no warehouse is selected before one is", () => {
    renderWithIntl(<ReceivingExceptionForm />, {
      environment: previewEnvironment,
    });
    expect(screen.getByTestId("panel-WAREHOUSE_MISSING")).toBeInTheDocument();
  });

  it("does not offer ORDERED as an exception kind", () => {
    withWarehouse();
    /*
     * An ordinary receipt is not an exception, and raising one would create a
     * maker for a posting that needs no second person.
     */
    renderWithIntl(<ReceivingExceptionForm />, {
      environment: previewEnvironment,
    });

    const select = screen.getByLabelText("ประเภทข้อยกเว้น");
    const options = Array.from(select.querySelectorAll("option")).map(
      (option) => option.textContent,
    );
    expect(options).not.toContain("ตามใบสั่งซื้อ");
    expect(options).toContain("รับโดยไม่มีใบสั่งซื้อ");
  });

  it("demonstrates in preview without pretending to persist", () => {
    withWarehouse();
    renderWithIntl(<ReceivingExceptionForm />, {
      environment: previewEnvironment,
    });

    // Chosen from the tenant's own reason codes: the field carries a document
    // ID, so a typed value would be a value nobody has.
    fireEvent.change(screen.getByLabelText("รหัสเหตุผล"), {
      target: { value: "prv_reason_cycle_count" },
    });
    fireEvent.click(screen.getByRole("button", { name: "แจ้งข้อยกเว้น" }));

    expect(screen.getByTestId("write-DEMONSTRATED")).toHaveTextContent(
      "ไม่ได้บันทึกข้อมูล",
    );
  });
});
