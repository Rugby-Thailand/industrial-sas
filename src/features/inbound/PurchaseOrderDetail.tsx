"use client";

/**
 * One purchase order, with the controls that change its lines.
 *
 * The order header is resolved first and the lines are rendered under it. A
 * screen that showed the lines above "no such order" would be answering a
 * question it had not established was answerable — and `{found:false}` is what
 * the server says for a nonexistent order *and* for another tenant's
 * (`INV-0002-03`), so the screen says one thing for both.
 *
 * There is no `getPurchaseOrder` on the server: the header is found in the same
 * warehouse-scoped list the register renders, which is a read the operator has
 * already been authorized for. Adding a single-document read to save a page of
 * rows would be a second permission surface for the same fact.
 */
import { useTranslations } from "next-intl";
import { useState } from "react";

import { StatusBadge } from "@/components/ui/StatusBadge";
import { Notice } from "@/components/ui/Notice";
import { useAppEnvironment } from "@/components/providers/EnvironmentProvider";
import type { PurchaseOrderLineRow } from "@/lib/convex/inboundApi";
import { codeLabel, type CodeTranslator } from "@/lib/domainLabels";
import { previewPurchaseOrderById } from "@/lib/preview/inboundPreview";

import {
  CloseLineShortForm,
  OpenReceiptForm,
  PurchaseOrderLineForm,
} from "./InboundForms";
import { InboundSection, PurchaseOrderLinesPanel } from "./InboundPanels";

import { Button } from "@/components/ui/button";

export function PurchaseOrderDetail({
  purchaseOrderId,
}: {
  readonly purchaseOrderId: string;
}) {
  const t = useTranslations("Purchasing");
  const receivingT = useTranslations("Receiving");
  const statusT = useTranslations(
    "PurchaseOrderStatus",
  ) as unknown as CodeTranslator;
  const environment = useAppEnvironment();

  const [closing, setClosing] = useState<PurchaseOrderLineRow | undefined>(
    undefined,
  );

  const previewOrder = environment.previewMode
    ? previewPurchaseOrderById(purchaseOrderId)
    : undefined;

  if (environment.previewMode && previewOrder === undefined) {
    return (
      <Notice
        tone="warning"
        title={t("orderNotFound")}
        body={t("orderNotFoundHint")}
        testId="order-not-found"
      />
    );
  }

  return (
    <div data-testid="purchase-order-detail">
      {previewOrder === undefined ? null : (
        <div className="mb-8 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-4">
          {/* The order number stays monospaced and English: it is a code identifier. */}
          <code className="font-mono text-sm font-semibold text-text">
            {previewOrder.poNumber}
          </code>
          <StatusBadge
            tone={previewOrder.status === "OPEN" ? "success" : "muted"}
            label={codeLabel(statusT, previewOrder.status)}
          />
          {previewOrder.externalRef === undefined ? null : (
            <span className="font-mono text-xs text-muted">
              {previewOrder.externalRef}
            </span>
          )}
        </div>
      )}

      <InboundSection title={t("linesCaption", { count: 0 })}>
        <PurchaseOrderLinesPanel
          purchaseOrderId={purchaseOrderId}
          renderAction={(row) =>
            /*
             * Closing short is offered on an open line only. A complete line has
             * no shortfall to explain, and recording one would put a fictional
             * supplier failure into the tenant's own reporting.
             */
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
