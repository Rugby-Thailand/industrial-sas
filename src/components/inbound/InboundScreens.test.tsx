import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { navigationMock } from "../../../tests/fixtures/navigation-mock";
import {
  chooseOption,
  selectOptionLabels,
  selectTrigger,
} from "../../../tests/fixtures/select-control";

vi.mock("@/i18n/navigation", () => navigationMock);

import {
  testEnvironment,
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
} from "@tests/fixtures/data/inbound";

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
    renderWithIntl(
      <PurchaseOrderLinesTable rows={previewOrderLinesFor("prv_po_2601")} />,
    );
    expect(screen.getByText("40.000 CASE")).toBeInTheDocument();
  });

  it("shows what is still outstanding on a partly received line", () => {
    renderWithIntl(
      <PurchaseOrderLinesTable rows={previewOrderLinesFor("prv_po_2601")} />,
    );

    expect(screen.getByText("320.000 KG")).toBeInTheDocument();
  });

  it("distinguishes a partial receipt from a line that is still waiting", () => {
    renderWithIntl(
      <PurchaseOrderLinesTable rows={previewOrderLinesFor("prv_po_2601")} />,
    );

    expect(screen.getByText("รับบางส่วน")).toBeInTheDocument();
    expect(screen.getByText("36%")).toBeInTheDocument();
    expect(screen.getByText("รอรับสินค้า")).toBeInTheDocument();
    expect(screen.queryByText("ยังรับได้")).not.toBeInTheDocument();
  });

  it("explains receiving progress on the status itself", () => {
    renderWithIntl(
      <PurchaseOrderLinesTable
        rows={previewOrderLinesFor("prv_po_2601").slice(0, 1)}
      />,
    );

    expect(
      screen.getByText("รับบางส่วน").closest("span[title]"),
    ).toHaveAttribute("title", "รับแล้ว 180.000 KG จาก 500.000 KG");
  });

  it("names the unit of every quantity, including the base-unit ones", () => {
    renderWithIntl(
      <PurchaseOrderLinesTable rows={previewOrderLinesFor("prv_po_2601")} />,
    );

    expect(screen.getByText("40.000 CASE")).toBeInTheDocument();
    expect(screen.getByText("0.000 EA")).toBeInTheDocument();
    expect(screen.getByText("480.000 EA")).toBeInTheDocument();
  });

  it("marks a quantity unrenderable when its base unit is unknown", () => {
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
    renderWithIntl(
      <ReceiptLinesTable rows={previewReceiptLinesFor("prv_rcpt_5002")} />,
    );

    expect(
      screen.getByRole("rowheader", { name: "prv_item_resin_hd" }),
    ).toBeInTheDocument();
  });

  it("counts one received line as one line in English", () => {
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
    renderWithIntl(<ReceiptsTable rows={previewReceiptsFor(BANG_PU)} />);

    expect(screen.getByText("PO-2601")).toBeInTheDocument();
    expect(screen.queryByText("prv_po_2601")).not.toBeInTheDocument();
  });

  it("leaves the order column empty for a blind receipt", () => {
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
    renderWithIntl(
      <PutawayRecommendationPanel
        warehouseId={BANG_PU}
        putawayTaskId="prv_task_4001"
      />,
      { environment: testEnvironment },
    );

    expect(screen.getByTestId("putaway-recommendation")).toBeInTheDocument();
    expect(screen.getByText("A01-02-1")).toBeInTheDocument();
    expect(screen.getByText("380")).toBeInTheDocument();
    expect(
      screen.getByText("มีสินค้าเดียวกันอยู่แล้ว 300 คะแนน (น้ำหนัก 300)"),
    ).toBeInTheDocument();
  });

  it("says why a location was filtered out", () => {
    renderWithIntl(
      <PutawayRecommendationPanel
        warehouseId={BANG_PU}
        putawayTaskId="prv_task_4001"
      />,
      { environment: testEnvironment },
    );

    expect(screen.getByText("DOCK-IN-1")).toBeInTheDocument();

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
      { environment: testEnvironment },
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
  const withWarehouse = () => writeStoredWarehouse("prv_wh_bangpoo");

  it("says no warehouse is selected before one is", () => {
    renderWithIntl(<ReceivingExceptionForm />, {
      environment: testEnvironment,
    });
    expect(screen.getByTestId("panel-WAREHOUSE_MISSING")).toBeInTheDocument();
  });

  it("does not offer ORDERED as an exception kind", () => {
    withWarehouse();

    renderWithIntl(<ReceivingExceptionForm />, {
      environment: testEnvironment,
    });

    const options = selectOptionLabels("ประเภทข้อยกเว้น");
    expect(options).not.toContain("ตามใบสั่งซื้อ");
    expect(options).toContain("รับโดยไม่มีใบสั่งซื้อ");
  });

  it("does not show a generic success notice after saving", async () => {
    withWarehouse();
    renderWithIntl(<ReceivingExceptionForm />, {
      environment: testEnvironment,
    });

    chooseOption("ประเภทข้อยกเว้น", "รับโดยไม่มีใบสั่งซื้อ");

    chooseOption("รหัสเหตุผล", "CYCLE-COUNT · ปรับปรุงจากการนับสต็อก");
    fireEvent.click(screen.getByRole("button", { name: "แจ้งข้อยกเว้น" }));

    await waitFor(() => {
      expect(screen.queryByTestId("write-SUBMITTING")).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId("write-SAVED")).not.toBeInTheDocument();
  });

  it("refuses to file an exception whose kind nobody chose", () => {
    withWarehouse();
    renderWithIntl(<ReceivingExceptionForm />, {
      environment: testEnvironment,
    });

    fireEvent.click(screen.getByRole("button", { name: "แจ้งข้อยกเว้น" }));

    expect(screen.queryByTestId("write-DEMONSTRATED")).toBeNull();
    expect(selectTrigger("ประเภทข้อยกเว้น")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });
});
