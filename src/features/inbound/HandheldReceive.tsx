"use client";

/**
 * Receiving on a scanner: pick an order, open a receipt, scan the lines.
 *
 * Three steps because an operator at a dock does them at different moments and
 * with different hands free. Each step is gated on the one before it, and a step
 * that cannot yet be taken says what is missing rather than showing a control
 * whose refusal would name a field nobody could fill.
 *
 * ### Every identifier comes from the server
 *
 * The orders are the tenant's own open orders, the lines are that order's open
 * lines, the dock is one of the tenant's receiving locations, and — the one that
 * matters most on a handheld — **the receipt ID comes out of the write that
 * created it**. Making an operator read a Convex document ID off one screen and
 * type it into the next is not a flow anybody completes wearing gloves.
 */
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Notice } from "@/components/ui/Notice";
import type { PurchaseOrderRow } from "@/lib/convex/inboundApi";

import {
  OpenOrderLines,
  OpenPurchaseOrders,
  ReceivingLocations,
} from "./InboundOptions";
import { OpenReceiptForm, ReceiptLineForm } from "./InboundForms";
import { InboundSection } from "./InboundPrimitives";
import { LocationChooser } from "./ReceiptDetail";

import { Button } from "@/components/ui/button";

export function HandheldReceive() {
  const t = useTranslations("Receiving");
  const purchasingT = useTranslations("Purchasing");

  const [order, setOrder] = useState<PurchaseOrderRow | undefined>(undefined);
  const [receiptId, setReceiptId] = useState<string | undefined>(undefined);
  const [locationId, setLocationId] = useState<string | undefined>(undefined);

  return (
    <div className="flex flex-col gap-6" data-testid="handheld-receive">
      <InboundSection title={purchasingT("ordersTitle")}>
        <OpenPurchaseOrders
          emptyTitle={t("noOpenOrders")}
          emptyBody={t("noOpenOrdersHint")}
          emptyTestId="handheld-no-open-orders"
        >
          {(orders) => (
            /*
             * Large buttons rather than a table row action: the handheld list is
             * scrolled with a thumb, and a per-row control doubles the row height
             * on the smallest screen the product targets.
             */
            <ul className="flex flex-col gap-2">
              {orders.map((candidate) => (
                <li key={candidate.purchaseOrderId}>
                  <Button
                    type="button"
                    variant="outline"
                    data-testid={`handheld-pick-order-${candidate.poNumber}`}
                    aria-pressed={
                      order?.purchaseOrderId === candidate.purchaseOrderId
                    }
                    onClick={() => {
                      setOrder(candidate);
                      // A different order means a different receipt; carrying the
                      // old one over would post lines onto the wrong document.
                      setReceiptId(undefined);
                    }}
                    className="w-full justify-start border-2 py-2 text-base"
                  >
                    {candidate.poNumber}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </OpenPurchaseOrders>
      </InboundSection>

      {order === undefined ? (
        <Notice
          tone="muted"
          title={t("selectOrderFirst")}
          body={t("selectOrderFirstHint")}
          testId="handheld-no-order"
        />
      ) : (
        <>
          <InboundSection title={t("sectionOpen")}>
            <OpenReceiptForm
              purchaseOrderId={order.purchaseOrderId}
              /*
               * The receipt the next step posts against, taken from the write
               * that created it. `documentId` is the receipt's own ID, which is
               * exactly what `postReceiptLine` needs.
               */
              onOpened={(opened) => {
                setReceiptId(opened);
              }}
            />
          </InboundSection>

          <InboundSection title={t("sectionCapture")}>
            {receiptId === undefined ? (
              <Notice
                tone="muted"
                title={t("receiptUnavailable")}
                body={t("receiptUnavailableHint")}
                testId="handheld-no-receipt"
              />
            ) : (
              <ReceivingLocations
                emptyTitle={t("noReceivingLocations")}
                emptyBody={t("noReceivingLocationsHint")}
                emptyTestId="handheld-no-locations"
              >
                {(locations) => (
                  <div className="flex flex-col gap-4">
                    <LocationChooser
                      locations={locations}
                      value={locationId ?? locations[0]?.locationId ?? ""}
                      onChange={setLocationId}
                      label={t("fieldLocation")}
                      placeholder={t("selectLocation")}
                    />
                    <OpenOrderLines
                      purchaseOrderId={order.purchaseOrderId}
                      emptyTitle={t("noOpenLines")}
                      emptyBody={t("noOpenLinesHint")}
                      emptyTestId="handheld-no-open-lines"
                    >
                      {(lines) => (
                        <ReceiptLineForm
                          receiptId={receiptId}
                          lines={lines}
                          locationId={
                            locationId ?? locations[0]?.locationId ?? ""
                          }
                        />
                      )}
                    </OpenOrderLines>
                  </div>
                )}
              </ReceivingLocations>
            )}
          </InboundSection>
        </>
      )}
    </div>
  );
}
