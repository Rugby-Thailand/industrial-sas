"use client";

/**
 * The inbound read panels, and the write controls attached to their rows.
 *
 * Every one of these is `MasterDataPanel` with a warehouse-scoped read, because
 * a delivery arrives at a *site*: the permissions are warehouse-scoped, and a
 * panel that did not wait for a warehouse selection would ask the server a
 * question it cannot answer (`INV-0006-04`).
 *
 * The write controls sit inside `renderRows`, so they exist only when there are
 * rows to act on. A claim button rendered above a `DENIED` notice would be a
 * control the server has already said this operator may not use.
 *
 * Nothing here decides whether a write is allowed. The server does, and a denial
 * is shown as a denial with its request ID (`INV-0002-07`). Hiding a control to
 * avoid a denial would be guessing at a permission the client cannot see, and
 * would hide the one message that tells an administrator what to grant.
 */
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import {
  InspectionsTable,
  PrintJobsTable,
  PurchaseOrderLinesTable,
  PurchaseOrdersTable,
  PutawayTasksTable,
  ReceiptLinesTable,
  ReceiptsTable,
} from "@/components/inbound/InboundTables";
import { Link } from "@/i18n/navigation";
import { DEFAULT_LEDGER_PAGE_SIZE } from "@/lib/convex/ledgerApi";
import {
  claimPutawayTaskRef,
  listInspectionsRef,
  listPrintJobsForTargetRef,
  listPurchaseOrderLinesRef,
  listPurchaseOrdersRef,
  listPutawayTasksRef,
  listReceiptLinesRef,
  listReceiptsRef,
  type InspectionRow,
  type PrintJobRow,
  type PurchaseOrderLineRow,
  type PurchaseOrderRow,
  type PutawayTaskRow,
  type ReceiptLineRow,
  type ReceiptRow,
} from "@/lib/convex/inboundApi";
import { purchaseOrderPath, receiptPath } from "@/lib/navigation";
import {
  previewInspectionsFor,
  previewOrderLinesFor,
  previewPrintJobsFor,
  previewPurchaseOrdersFor,
  previewPutawayTasksFor,
  previewReceiptLinesFor,
  previewReceiptsFor,
} from "@/lib/preview/inboundPreview";

import { MasterDataPanel } from "../masterData/MasterDataPanel";
import { RowActionButton, RowWriteRegion } from "../masterData/RowWriteRegion";

/** The paging arguments every warehouse-scoped inbound list takes. */
const pageArgs = (warehouseId: string, cursor: string | undefined) => ({
  warehouseId,
  maxPageSize: DEFAULT_LEDGER_PAGE_SIZE,
  ...(cursor === undefined ? {} : { cursor }),
});

/** A titled block. `PageHeader` owns the single `<h1>`; sections start at `<h2>`. */
export function InboundSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="mb-8 flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-text">{title}</h2>
      {children}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Purchase orders                                                             */
/* -------------------------------------------------------------------------- */

export function PurchaseOrdersPanel() {
  const t = useTranslations("Purchasing");

  return (
    <MasterDataPanel<
      PurchaseOrderRow,
      { warehouseId: string; maxPageSize?: number; cursor?: string }
    >
      queryRef={listPurchaseOrdersRef}
      scope="WAREHOUSE"
      buildArgs={({ warehouseId, cursor }) => pageArgs(warehouseId, cursor)}
      previewRowsFor={previewPurchaseOrdersFor}
      renderRows={(rows) => (
        <PurchaseOrdersTable
          rows={rows}
          /*
           * A link rather than an inline expansion: an order's lines, its
           * receipts, and its short-close controls are a page, and a page inside
           * a table cell is not a page.
           */
          renderAction={(row) => (
            <Link
              href={purchaseOrderPath(row.purchaseOrderId)}
              className="inline-flex min-h-touch items-center rounded-md border border-border-strong px-3 text-xs font-semibold"
              data-testid={`order-open-${row.poNumber}`}
            >
              {t("openOrder")}
            </Link>
          )}
        />
      )}
    />
  );
}

export function PurchaseOrderLinesPanel({
  purchaseOrderId,
  renderAction,
}: {
  readonly purchaseOrderId: string;
  readonly renderAction?: (row: PurchaseOrderLineRow) => ReactNode;
}) {
  return (
    <MasterDataPanel<
      PurchaseOrderLineRow,
      {
        warehouseId: string;
        purchaseOrderId: string;
        maxPageSize?: number;
        cursor?: string;
      }
    >
      queryRef={listPurchaseOrderLinesRef}
      scope="WAREHOUSE"
      buildArgs={({ warehouseId, cursor }) => ({
        ...pageArgs(warehouseId, cursor),
        purchaseOrderId,
      })}
      previewRowsFor={() => previewOrderLinesFor(purchaseOrderId)}
      renderRows={(rows) => (
        <PurchaseOrderLinesTable
          rows={rows}
          {...(renderAction === undefined ? {} : { renderAction })}
        />
      )}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Receiving                                                                   */
/* -------------------------------------------------------------------------- */

export function ReceiptsPanel() {
  const t = useTranslations("Receiving");

  return (
    <MasterDataPanel<
      ReceiptRow,
      { warehouseId: string; maxPageSize?: number; cursor?: string }
    >
      queryRef={listReceiptsRef}
      scope="WAREHOUSE"
      buildArgs={({ warehouseId, cursor }) => pageArgs(warehouseId, cursor)}
      previewRowsFor={previewReceiptsFor}
      renderRows={(rows) => (
        <ReceiptsTable
          rows={rows}
          renderAction={(row) => (
            <Link
              href={receiptPath(row.receiptId)}
              className="inline-flex min-h-touch items-center rounded-md border border-border-strong px-3 text-xs font-semibold"
              data-testid={`receipt-open-${row.receiptNumber}`}
            >
              {t("openReceipt")}
            </Link>
          )}
        />
      )}
    />
  );
}

export function ReceiptLinesPanel({
  receiptId,
}: {
  readonly receiptId: string;
}) {
  return (
    <MasterDataPanel<
      ReceiptLineRow,
      {
        warehouseId: string;
        receiptId: string;
        maxPageSize?: number;
        cursor?: string;
      }
    >
      queryRef={listReceiptLinesRef}
      scope="WAREHOUSE"
      buildArgs={({ warehouseId, cursor }) => ({
        ...pageArgs(warehouseId, cursor),
        receiptId,
      })}
      previewRowsFor={() => previewReceiptLinesFor(receiptId)}
      renderRows={(rows) => <ReceiptLinesTable rows={rows} />}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Quality                                                                     */
/* -------------------------------------------------------------------------- */

export function InspectionsPanel({
  onSelect,
}: {
  /** Called with an inspection the operator wants to decide. */
  readonly onSelect?: (row: InspectionRow) => void;
}) {
  const t = useTranslations("Quality");

  return (
    <MasterDataPanel<
      InspectionRow,
      { warehouseId: string; maxPageSize?: number; cursor?: string }
    >
      queryRef={listInspectionsRef}
      scope="WAREHOUSE"
      buildArgs={({ warehouseId, cursor }) => pageArgs(warehouseId, cursor)}
      previewRowsFor={previewInspectionsFor}
      renderRows={(rows) => (
        <InspectionsTable
          rows={rows}
          {...(onSelect === undefined
            ? {}
            : {
                renderAction: (row: InspectionRow) =>
                  /*
                   * Only an open inspection offers the control. A parked one is
                   * waiting for a *different* person, and a disposed one is
                   * finished; offering "decide" on either would be offering an
                   * action the server will refuse for reasons the operator
                   * cannot fix from this screen.
                   */
                  row.status === "OPEN" ? (
                    <button
                      type="button"
                      onClick={() => onSelect(row)}
                      data-testid={`inspection-select-${row.inspectionId}`}
                      className="min-h-touch rounded-md border border-border-strong px-3 text-xs font-semibold"
                    >
                      {t("sectionDisposition")}
                    </button>
                  ) : null,
              })}
        />
      )}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Putaway                                                                     */
/* -------------------------------------------------------------------------- */

export function PutawayTasksPanel({
  onSelect,
}: {
  readonly onSelect?: (row: PutawayTaskRow) => void;
}) {
  const t = useTranslations("Putaway");

  return (
    <MasterDataPanel<
      PutawayTaskRow,
      { warehouseId: string; maxPageSize?: number; cursor?: string }
    >
      queryRef={listPutawayTasksRef}
      scope="WAREHOUSE"
      buildArgs={({ warehouseId, cursor }) => pageArgs(warehouseId, cursor)}
      previewRowsFor={previewPutawayTasksFor}
      renderRows={(rows) => (
        <RowWriteRegion mutationRef={claimPutawayTaskRef}>
          {({ submit, busy }) => (
            <PutawayTasksTable
              rows={rows}
              renderAction={(row) =>
                row.status === "CONFIRMED" ||
                row.status === "CANCELLED" ? null : (
                  <div className="flex flex-wrap gap-2">
                    <RowActionButton
                      busy={busy}
                      testId={`task-claim-${row.putawayTaskId}`}
                      /*
                       * A claimed task still offers the control, and the label
                       * says it is claimed. Re-claiming your own task after a
                       * reconnect succeeds; claiming somebody else's is refused
                       * by the server with a message that says which
                       * (`INV-0007-11`). Hiding the button would make a
                       * reconnect look like a lost task.
                       */
                      label={
                        row.status === "CLAIMED" ? t("claimed") : t("claim")
                      }
                      onClick={() =>
                        submit(row.putawayTaskId, (requestId) => ({
                          requestId,
                          warehouseId: row.warehouseId,
                          putawayTaskId: row.putawayTaskId,
                        }))
                      }
                    />
                    {onSelect === undefined ? null : (
                      <button
                        type="button"
                        onClick={() => onSelect(row)}
                        data-testid={`task-select-${row.putawayTaskId}`}
                        className="min-h-touch rounded-md border border-border-strong px-3 text-xs font-semibold"
                      >
                        {t("sectionRecommendation")}
                      </button>
                    )}
                  </div>
                )
              }
            />
          )}
        </RowWriteRegion>
      )}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Label evidence                                                              */
/* -------------------------------------------------------------------------- */

export function PrintJobsPanel({
  targetKind,
  targetId,
}: {
  readonly targetKind: string;
  readonly targetId: string;
}) {
  return (
    <MasterDataPanel<
      PrintJobRow,
      {
        warehouseId: string;
        targetKind: string;
        targetId: string;
        maxPageSize?: number;
        cursor?: string;
      }
    >
      queryRef={listPrintJobsForTargetRef}
      scope="WAREHOUSE"
      buildArgs={({ warehouseId, cursor }) => ({
        ...pageArgs(warehouseId, cursor),
        targetKind,
        targetId,
      })}
      previewRowsFor={() => previewPrintJobsFor(targetId)}
      renderRows={(rows) => <PrintJobsTable rows={rows} />}
    />
  );
}
