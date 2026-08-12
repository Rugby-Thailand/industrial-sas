import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { navigationMock } from "../../../tests/fixtures/navigation-mock";
import {
  chooseOption,
  selectOptionLabels,
  selectTrigger,
} from "../../../tests/fixtures/select-control";

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
  PrintJobsTable,
  PurchaseOrderLinesTable,
  PurchaseOrdersTable,
  ReceiptLinesTable,
  ReceiptsTable,
} from "./InboundTables";
import { PutawayTasksTable } from "./PutawayTables";
import { InspectionsTable } from "./QualityTables";

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
    // 500 ordered, 180 received, both in the item's base unit.
    expect(screen.getByText("320.000 KG")).toBeInTheDocument();
  });

  it("names the unit of every quantity, including the base-unit ones", () => {
    /*
     * The audit found "40.000 CASE" ordered against a bare "0" received and a
     * bare "480" outstanding: three figures under three headings in two units,
     * with only one of them saying which. The received and outstanding columns
     * are in the item's base unit, and they now say so.
     */
    renderWithIntl(
      <PurchaseOrderLinesTable rows={previewOrderLinesFor("prv_po_2601")} />,
    );

    expect(screen.getByText("40.000 CASE")).toBeInTheDocument();
    expect(screen.getByText("0.000 EA")).toBeInTheDocument();
    expect(screen.getByText("480.000 EA")).toBeInTheDocument();
  });

  it("marks a quantity unrenderable when its base unit is unknown", () => {
    /*
     * The base unit is read from the item document, so a dangling item reference
     * leaves it absent. A bare number beside "40.000 CASE" would be read as
     * cases; the marker cannot be.
     */
    const [, ordered] = previewOrderLinesFor("prv_po_2601");
    const { baseUom: _baseUom, ...withoutUnit } = ordered!;

    renderWithIntl(<PurchaseOrderLinesTable rows={[withoutUnit]} />);

    expect(screen.getByText("40.000 CASE")).toBeInTheDocument();
    expect(screen.getAllByText("——")).toHaveLength(2);
  });

  it("counts one line as one line in English", () => {
    renderWithIntl(
      <PurchaseOrderLinesTable
        rows={previewOrderLinesFor("prv_po_2602").slice(0, 1)}
      />,
      { locale: "en" },
    );
    expect(screen.getByText("1 line")).toBeInTheDocument();
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

  it("names the item by its whole identifier", () => {
    /*
     * It used to be abbreviated to `…m_resin_hd`: the prefix that says what kind
     * of document the ID names was the part thrown away, and two different IDs
     * sharing a tail rendered identically. The column scrolls instead.
     */
    renderWithIntl(
      <ReceiptLinesTable rows={previewReceiptLinesFor("prv_rcpt_5002")} />,
    );

    expect(
      screen.getByRole("rowheader", { name: "prv_item_resin_hd" }),
    ).toBeInTheDocument();
  });

  it("counts one received line as one line in English", () => {
    // `1 received lines` was in the audit. English chooses its noun by the
    // count; Thai marks no plural and its caption is unchanged.
    renderWithIntl(
      <ReceiptLinesTable rows={previewReceiptLinesFor("prv_rcpt_5002")} />,
      { locale: "en" },
    );

    expect(screen.getByText("1 received line")).toBeInTheDocument();
  });
});

describe("ReceiptsTable", () => {
  it("shows the business date verbatim, not through a locale formatter", () => {
    renderWithIntl(<ReceiptsTable rows={previewReceiptsFor(BANG_PU)} />);
    expect(screen.getByText("2026-08-10")).toBeInTheDocument();
  });

  it("names the order the way the purchasing register names it", () => {
    /*
     * `prv_po_2601` is a document ID. `PO-2601` is what the register shows, what
     * the supplier's paperwork says, and what somebody at a dock can read out.
     * One order, one name.
     */
    renderWithIntl(<ReceiptsTable rows={previewReceiptsFor(BANG_PU)} />);

    expect(screen.getByText("PO-2601")).toBeInTheDocument();
    expect(screen.queryByText("prv_po_2601")).not.toBeInTheDocument();
  });

  it("leaves the order column empty for a blind receipt", () => {
    // A blind receipt has no order behind it — that is what "blind" means — so
    // there is no number to show and nothing is invented in its place.
    renderWithIntl(
      <ReceiptsTable rows={previewReceiptsFor("prv_wh_lamphun")} />,
    );

    expect(screen.getByText("GRN-5010")).toBeInTheDocument();
    expect(screen.getByText("——")).toBeInTheDocument();
  });

  it("counts one receipt as one receipt in English", () => {
    renderWithIntl(
      <ReceiptsTable rows={previewReceiptsFor("prv_wh_lamphun")} />,
      {
        locale: "en",
      },
    );
    expect(screen.getByText("1 receipt")).toBeInTheDocument();
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
     * `RG-004` open). Every job is `GENERATED`, and what an operator reads is
     * the catalogue's label for it rather than the stored code.
     */
    renderWithIntl(
      <PrintJobsTable rows={previewPrintJobsFor("prv_hu_pallet_01")} />,
    );

    expect(screen.getAllByText("สร้างข้อมูลป้ายแล้ว")).toHaveLength(2);
    expect(screen.queryByText("GENERATED")).not.toBeInTheDocument();
    expect(screen.queryByText("PRINTED")).not.toBeInTheDocument();
  });

  it("distinguishes a reprint from a first print, in words", () => {
    renderWithIntl(
      <PrintJobsTable rows={previewPrintJobsFor("prv_hu_pallet_01")} />,
    );

    expect(screen.getByText("พิมพ์ครั้งแรก")).toBeInTheDocument();
    expect(screen.getByText("พิมพ์ซ้ำ")).toBeInTheDocument();
    expect(screen.queryByText("INITIAL")).not.toBeInTheDocument();
    expect(screen.queryByText("REPRINT")).not.toBeInTheDocument();
  });

  it("says the same thing in English, and still not in enum case", () => {
    renderWithIntl(
      <PrintJobsTable rows={previewPrintJobsFor("prv_hu_pallet_01")} />,
      { locale: "en" },
    );

    expect(screen.getByText("First print")).toBeInTheDocument();
    expect(screen.getByText("Reprint")).toBeInTheDocument();
    expect(screen.getAllByText("Payload generated")).toHaveLength(2);
  });

  it("falls back to the raw code for a reason the catalogue does not know", () => {
    // A server deployed ahead of the browser reading it. The code is the string
    // the audit row and the logs carry, so it is reportable; a placeholder or a
    // blank cell would not be.
    const [job] = previewPrintJobsFor("prv_hu_pallet_01");

    renderWithIntl(
      <PrintJobsTable
        rows={[
          {
            ...job!,
            reason: "SOME_FUTURE_REASON" as never,
            status: "SOME_FUTURE_STATUS" as never,
          },
        ]}
      />,
    );

    expect(screen.getByText("SOME_FUTURE_REASON")).toBeInTheDocument();
    expect(screen.getByText("SOME_FUTURE_STATUS")).toBeInTheDocument();
  });

  it("counts one label record as one in English", () => {
    const [job] = previewPrintJobsFor("prv_hu_pallet_01");
    renderWithIntl(<PrintJobsTable rows={[job!]} />, { locale: "en" });

    expect(screen.getByText("1 label record")).toBeInTheDocument();
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

    const options = selectOptionLabels("ประเภทข้อยกเว้น");
    expect(options).not.toContain("ตามใบสั่งซื้อ");
    expect(options).toContain("รับโดยไม่มีใบสั่งซื้อ");
  });

  it("demonstrates in preview without pretending to persist", () => {
    withWarehouse();
    renderWithIntl(<ReceivingExceptionForm />, {
      environment: previewEnvironment,
    });

    /*
     * Both selects are answered explicitly, because both are `required` and the
     * form no longer pre-selects a first option for either.
     *
     * This used to be one `fireEvent.change` against the reason code, which was
     * doing nothing at all: the control is a Radix trigger — a `<button>` — and
     * `change` on a button changes nothing. The submission only ever succeeded
     * because `EntityForm` silently defaulted every select to `options[0]`, so
     * the test passed while asserting that an operator can file an exception
     * without stating its kind. Choosing through the menu is what an operator
     * does and what the keyboard contract promises.
     */
    chooseOption("ประเภทข้อยกเว้น", "รับโดยไม่มีใบสั่งซื้อ");
    // A document ID, chosen from the tenant's own reason codes rather than
    // typed: a typed value would be a value nobody has.
    chooseOption("รหัสเหตุผล", "CYCLE-COUNT · ปรับปรุงจากการนับสต็อก");
    fireEvent.click(screen.getByRole("button", { name: "แจ้งข้อยกเว้น" }));

    expect(screen.getByTestId("write-DEMONSTRATED")).toHaveTextContent(
      "ไม่ได้บันทึกข้อมูล",
    );
  });

  it("refuses to file an exception whose kind nobody chose", () => {
    /*
     * The reason the test above had to change. An exception report names what
     * went wrong; filing one as whichever kind sorted first is a maker-checker
     * record that misstates the event it exists to document.
     */
    withWarehouse();
    renderWithIntl(<ReceivingExceptionForm />, {
      environment: previewEnvironment,
    });

    fireEvent.click(screen.getByRole("button", { name: "แจ้งข้อยกเว้น" }));

    expect(screen.queryByTestId("write-DEMONSTRATED")).toBeNull();
    expect(selectTrigger("ประเภทข้อยกเว้น")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });
});
