"use client";

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
