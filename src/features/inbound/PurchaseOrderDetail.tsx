"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import type { PurchaseOrderLineRow } from "@/lib/convex/inboundApi";

import {
  CloseLineShortForm,
  OpenReceiptForm,
  PurchaseOrderLineForm,
} from "./InboundForms";
import { PurchaseOrderLinesPanel } from "./InboundPanels";
import { InboundSection } from "./InboundPrimitives";

import { Button } from "@/components/ui/button";

export function PurchaseOrderDetail({
  purchaseOrderId,
}: {
  readonly purchaseOrderId: string;
}) {
  const t = useTranslations("Purchasing");
  const receivingT = useTranslations("Receiving");
  const [closing, setClosing] = useState<PurchaseOrderLineRow | undefined>(
    undefined,
  );

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
              <Button
                type="button"
                variant="outline"
                onClick={() => setClosing(row)}
                data-testid={`line-close-short-${row.lineNumber}`}
                className="px-3 text-xs"
              >
                {t("closeShort")}
              </Button>
            ) : null
          }
        />
      </InboundSection>

      {closing === undefined ? null : (
        <InboundSection title={t("closeShort")}>
          <CloseLineShortForm line={closing} />
        </InboundSection>
      )}

      <InboundSection title={t("lineFormLegend")}>
        <PurchaseOrderLineForm purchaseOrderId={purchaseOrderId} />
      </InboundSection>

      <InboundSection title={receivingT("sectionOpen")}>
        <OpenReceiptForm purchaseOrderId={purchaseOrderId} />
      </InboundSection>
    </div>
  );
}
