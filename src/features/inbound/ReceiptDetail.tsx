"use client";

/**
 * One receipt: what was posted against it, and what was made from that.
 *
 * Every identifier on this screen comes from a server read. The receipt is read
 * by ID, the order behind it comes from the receipt, the lines that may be
 * received against come from that order narrowed to `OPEN`, the dock comes from
 * the tenant's own receiving locations, and the pallet the label is generated
 * for comes from the lines already posted. None of it is assumed, and none of it
 * is a preview identifier: a screen that hard-coded a dock would send a
 * synthetic reference to a real mutation the moment a tenant configured a
 * deployment.
 *
 * Each step is gated on the step before it. A pallet cannot be built from no
 * lines, and a label cannot be generated for no pallet — so those sections say
 * what is missing rather than offering a control whose refusal would name a
 * field the operator could not fill.
 */
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Notice } from "@/components/ui/Notice";
import type { LocationRow } from "@/lib/convex/masterDataApi";

import { BuildPalletForm, LabelForm, ReceiptLineForm } from "./InboundForms";
import {
  OpenOrderLines,
  PostedReceiptLines,
  Receipt,
  ReceivingLocations,
} from "./InboundOptions";
import {
  InboundSection,
  PrintJobsPanel,
  ReceiptLinesPanel,
} from "./InboundPanels";

export function ReceiptDetail({ receiptId }: { readonly receiptId: string }) {
  const t = useTranslations("Receiving");
  const labelT = useTranslations("LabelEvidence");

  /*
   * The dock the operator is standing at. Defaulted to the first the tenant has
   * configured and changeable, because a site with two docks must be able to say
   * which one — and a screen that decided for them would put the pallet in the
   * wrong place in the record.
   */
  const [locationId, setLocationId] = useState<string | undefined>(undefined);

  return (
    <div data-testid="receipt-detail">
      <InboundSection title={t("sectionLines")}>
        <ReceiptLinesPanel receiptId={receiptId} />
      </InboundSection>

      <ReceivingLocations
        emptyTitle={t("noReceivingLocations")}
        emptyBody={t("noReceivingLocationsHint")}
        emptyTestId="receiving-no-locations"
      >
        {(locations) => {
          /*
           * One resolved choice for the whole screen. Capture and pallet build
           * both need *the* dock the operator is standing at, and computing it
           * twice is how the pallet ends up recorded at a different location
           * than the lines on it — `locationId ?? ""` was exactly that bug.
           */
          const chosen = locationId ?? locations[0]?.locationId ?? "";

          return (
            <>
              <InboundSection title={t("sectionCapture")}>
                <div className="flex flex-col gap-4">
                  <LocationChooser
                    locations={locations}
                    value={chosen}
                    onChange={setLocationId}
                    label={t("fieldLocation")}
                  />
                  <Receipt
                    receiptId={receiptId}
                    emptyTitle={t("receiptNotFound")}
                    emptyBody={t("receiptNotFoundHint")}
                    emptyTestId="receipt-not-found"
                  >
                    {(receipts) => (
                      <OpenOrderLines
                        purchaseOrderId={receipts[0]?.purchaseOrderId}
                        emptyTitle={t("noOpenLines")}
                        emptyBody={t("noOpenLinesHint")}
                        emptyTestId="receiving-no-open-lines"
                      >
                        {(lines) => (
                          <ReceiptLineForm
                            receiptId={receiptId}
                            lines={lines}
                            locationId={chosen}
                          />
                        )}
                      </OpenOrderLines>
                    )}
                  </Receipt>
                </div>
              </InboundSection>

              <PostedReceiptLines
                receiptId={receiptId}
                emptyTitle={t("noPalletLines")}
                emptyBody={t("noPalletLinesHint")}
                emptyTestId="receiving-no-pallet-lines"
              >
                {(posted) => {
                  /*
                   * The pallet a label is generated for, taken from the lines
                   * already posted. A label for a pallet that does not exist is
                   * a label for nothing, and its `targetId` would be a reference
                   * the tenant does not have.
                   */
                  const handlingUnitId = posted.find(
                    (line) => line.handlingUnitId !== undefined,
                  )?.handlingUnitId;

                  return (
                    <>
                      <InboundSection title={t("sectionPallet")}>
                        <BuildPalletForm
                          receiptLineIds={posted.map(
                            (line) => line.receiptLineId,
                          )}
                          locationId={chosen}
                        />
                      </InboundSection>

                      {handlingUnitId === undefined ? (
                        <InboundSection title={labelT("generateLegend")}>
                          <Notice
                            tone="muted"
                            title={t("labelTargetMissing")}
                            body={t("labelTargetMissingHint")}
                            testId="label-target-missing"
                          />
                        </InboundSection>
                      ) : (
                        <>
                          <InboundSection title={labelT("generateLegend")}>
                            <LabelForm
                              targetKind="HANDLING_UNIT"
                              targetId={handlingUnitId}
                            />
                          </InboundSection>

                          <InboundSection title={t("sectionLabels")}>
                            <PrintJobsPanel
                              targetKind="HANDLING_UNIT"
                              targetId={handlingUnitId}
                            />
                          </InboundSection>
                        </>
                      )}
                    </>
                  );
                }}
              </PostedReceiptLines>
            </>
          );
        }}
      </ReceivingLocations>
    </div>
  );
}

/**
 * Choosing which dock the stock came to.
 *
 * A native `select` rather than a custom widget: it is keyboard-navigable, it is
 * what a scanner's browser renders as a full-screen list, and it needs no focus
 * management to be correct.
 */
export function LocationChooser({
  locations,
  value,
  onChange,
  label,
}: {
  readonly locations: readonly LocationRow[];
  readonly value: string;
  readonly onChange: (locationId: string) => void;
  readonly label: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-medium text-text">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        data-testid="receiving-location"
        className="min-h-touch w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm"
      >
        {locations.map((location) => (
          <option key={location.locationId} value={location.locationId}>
            {location.code}
          </option>
        ))}
      </select>
    </label>
  );
}
