"use client";

import { useTranslations } from "next-intl";

import {
  CloseLineShortForm,
  OpenReceiptForm,
  PurchaseOrderLineForm,
} from "./InboundForms";
import { PurchaseOrderLinesPanel } from "./InboundPanels";
import { InboundSection } from "./InboundPrimitives";

import { WriteDialog } from "@/features/masterData/WriteDialog";

export function PurchaseOrderDetail({
  purchaseOrderId,
}: {
  readonly purchaseOrderId: string;
}) {
  const t = useTranslations("Purchasing");
  const receivingT = useTranslations("Receiving");
  const writeT = useTranslations("Write");
  return (
    <div data-testid="purchase-order-detail">
      {/*
       * The heading names the section; the table's own caption carries the
       * count. It used to be `linesCaption` with a hard-coded `{count: 0}`,
       * which read "0 lines" above a table of two: the rows are fetched by the
       * panel below, so nothing at this level ever knew how many there were, and
       * a heading cannot wait for a read it does not perform. Two statements of
       * one number is a contradiction waiting to happen even when both are
       * right, so there is now one — in the caption, next to the rows it counts.
       */}
      <InboundSection title={t("sectionLines")}>
        <PurchaseOrderLinesPanel
          purchaseOrderId={purchaseOrderId}
          renderAction={(row) =>
            row.status === "OPEN" ? (
              <WriteDialog
                triggerLabel={t("closeShort")}
                closeLabel={writeT("closeForm")}
                showPlus={false}
                triggerVariant="outline"
                testId={`line-close-short-${row.lineNumber}`}
              >
                <CloseLineShortForm line={row} />
              </WriteDialog>
            ) : null
          }
        />
      </InboundSection>

      <div className="flex flex-wrap justify-end gap-3">
        <WriteDialog
          triggerLabel={t("lineFormLegend")}
          closeLabel={writeT("closeForm")}
        >
          <PurchaseOrderLineForm purchaseOrderId={purchaseOrderId} />
        </WriteDialog>
        <WriteDialog
          triggerLabel={receivingT("sectionOpen")}
          closeLabel={writeT("closeForm")}
        >
          <OpenReceiptForm purchaseOrderId={purchaseOrderId} />
        </WriteDialog>
      </div>
    </div>
  );
}
