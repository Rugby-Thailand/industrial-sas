import { axe } from "jest-axe";
import { describe, expect, it, vi } from "vitest";

import { navigationMock } from "../../../tests/fixtures/navigation-mock";

vi.mock("@/i18n/navigation", () => navigationMock);

import {
  previewEnvironment,
  renderWithIntl,
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

import { ImportWorkbench } from "@/features/inbound/ImportWorkbench";
import { ReceiptLineForm } from "@/features/inbound/InboundForms";
import { ConfirmPutawayForm } from "@/features/inbound/PutawayTasks";
import { DispositionForm } from "@/features/inbound/QualityInspections";
import { PutawayRecommendationPanel } from "@/features/inbound/PutawayRecommendation";
import { ApproveDispositionControl } from "@/features/inbound/QualityApproval";
import {
  previewImportOutcome,
  previewInspectionsFor,
  previewOrderLinesFor,
  previewPrintJobsFor,
  previewPurchaseOrdersFor,
  previewPutawayTasksFor,
  previewReceivableLines,
  previewReceiptLinesFor,
  previewReceiptsFor,
} from "@/lib/preview/inboundPreview";

/**
 * `INV-0010-09` for the inbound screens.
 *
 * Both locales, because Thai and English differ in more than glyphs: every
 * accessible name — header, label, badge, caption — comes from the catalogue,
 * and a name that is empty in one language is a violation only in that language.
 *
 * The *forms* are the part worth checking hardest. A table is accessible while
 * it is a table; a form breaks the moment it grows a select, a hint, a live
 * region, and an error — which is exactly the state an operator reaches it in.
 */
const BANG_PU = "prv_wh_bangpoo";
const LOCALES = ["th", "en"] as const;
const importOutcome = previewImportOutcome("BATCH-1");

/*
 * Thunks rather than elements: an array of JSX is an array React would want keys
 * for, and these are rendered one at a time rather than as a list.
 */
const cases = [
  [
    "PurchaseOrdersTable",
    () => <PurchaseOrdersTable rows={previewPurchaseOrdersFor(BANG_PU)} />,
  ],
  [
    "PurchaseOrderLinesTable",
    () => (
      <PurchaseOrderLinesTable rows={previewOrderLinesFor("prv_po_2601")} />
    ),
  ],
  [
    "ImportAcceptedTable",
    () => (
      <ImportAcceptedTable
        rows={importOutcome.ok ? importOutcome.accepted : []}
      />
    ),
  ],
  [
    "ImportRejectedTable",
    () => (
      <ImportRejectedTable
        rows={importOutcome.ok ? importOutcome.rejected : []}
      />
    ),
  ],
  ["ReceiptsTable", () => <ReceiptsTable rows={previewReceiptsFor(BANG_PU)} />],
  [
    "ReceiptLinesTable",
    () => <ReceiptLinesTable rows={previewReceiptLinesFor("prv_rcpt_5001")} />,
  ],
  [
    "InspectionsTable",
    () => <InspectionsTable rows={previewInspectionsFor(BANG_PU)} />,
  ],
  [
    "PutawayTasksTable",
    () => <PutawayTasksTable rows={previewPutawayTasksFor(BANG_PU)} />,
  ],
  [
    "PrintJobsTable",
    () => <PrintJobsTable rows={previewPrintJobsFor("prv_hu_pallet_01")} />,
  ],
  [
    "PutawayRecommendationPanel",
    () => (
      <PutawayRecommendationPanel
        warehouseId={BANG_PU}
        putawayTaskId="prv_task_4001"
      />
    ),
  ],
] as const;

describe("inbound table accessibility", () => {
  for (const [name, render] of cases) {
    it.each(LOCALES)(
      `${name} has no detectable axe violations in %s`,
      async (locale) => {
        const { container } = renderWithIntl(render(), {
          locale,
          environment: previewEnvironment,
        });
        expect(await axe(container)).toHaveNoViolations();
      },
    );
  }
});

describe("inbound form accessibility", () => {
  /** Every inbound write is warehouse-scoped; the forms need a selection. */
  const seed = () => writeStoredWarehouse(BANG_PU);

  it.each(LOCALES)(
    "the receiving capture form is clean in %s",
    async (locale) => {
      seed();
      const { container } = renderWithIntl(
        <ReceiptLineForm
          receiptId="prv_rcpt_5001"
          lines={previewReceivableLines()}
          locationId="prv_loc_DOCK-IN-1"
        />,
        { locale, environment: previewEnvironment },
      );
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it.each(LOCALES)("the QC disposition form is clean in %s", async (locale) => {
    seed();
    const { container } = renderWithIntl(
      <DispositionForm inspectionId="prv_qc_3001" />,
      { locale, environment: previewEnvironment },
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it.each(LOCALES)("the approval control is clean in %s", async (locale) => {
    seed();
    const { container } = renderWithIntl(<ApproveDispositionControl />, {
      locale,
      environment: previewEnvironment,
    });
    expect(await axe(container)).toHaveNoViolations();
  });

  it.each(LOCALES)(
    "the putaway confirmation is clean in %s",
    async (locale) => {
      seed();
      const { container } = renderWithIntl(
        <ConfirmPutawayForm
          putawayTaskId="prv_task_4001"
          locations={[
            { value: "prv_loc_A01-02-1", label: "A01-02-1" },
            { value: "prv_loc_B04-11-3", label: "B04-11-3" },
          ]}
        />,
        { locale, environment: previewEnvironment },
      );
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it.each(LOCALES)("the import workbench is clean in %s", async (locale) => {
    seed();
    const { container } = renderWithIntl(<ImportWorkbench />, {
      locale,
      environment: previewEnvironment,
    });
    expect(await axe(container)).toHaveNoViolations();
  });
});
