"use client";

/**
 * One receipt: what was posted against it, and what was made from that.
 *
 * Every identifier on this screen comes from a server read. The receipt is read
 * by ID, the order behind it comes from the receipt, the lines that may be
 * received against come from that order narrowed to `OPEN`, the dock comes from
 * the tenant's own receiving locations, and the pallet the label is generated
 * for comes from the lines already posted. None of it is assumed: a screen that
 * hard-coded a dock could send an invalid reference to a real mutation.
 *
 * Each step is gated on the step before it. A pallet cannot be built from no
 * lines, and a label cannot be generated for no pallet — so those sections say
 * what is missing rather than offering a control whose refusal would name a
 * field the operator could not fill.
 */
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { Notice } from "@/components/ui/Notice";
import { SelectControl } from "@/components/ui/SelectControl";
import type { LocationRow } from "@/lib/convex/masterDataApi";

import { BuildPalletForm, LabelForm, ReceiptLineForm } from "./InboundForms";
import {
  OpenOrderLines,
  PostedReceiptLines,
  Receipt,
  ReceivingLocations,
} from "./InboundOptions";
import { PrintJobsPanel, ReceiptLinesPanel } from "./InboundPanels";
import { InboundSection } from "./InboundPrimitives";

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
                    placeholder={t("selectLocation")}
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
 * The shared Radix Select, not a native one. The native control was chosen for
 * its keyboard behaviour and for the full-screen list a scanner's browser draws
 * from it — both real, and both bought at the price of a popup the application
 * cannot style, which on a dark-scheme device meant a white menu in the middle
 * of a dark screen. The shared control keeps the keyboard contract (Radix
 * implements the same one) and renders in the tenant's own colours.
 *
 * A Select rather than an autocomplete because a site's receiving locations are
 * a short, bounded, server-supplied list. The moment this has to reach the whole
 * location register it becomes a server-backed lookup instead; a menu of two
 * thousand aisles is not a menu.
 */
export function LocationChooser({
  locations,
  value,
  onChange,
  label,
  placeholder,
}: {
  readonly locations: readonly LocationRow[];
  readonly value: string;
  readonly onChange: (locationId: string) => void;
  readonly label: string;
  /**
   * What the empty control says. Distinct from the label on purpose: "Received
   * to" above an empty box that also reads "Received to" states the field twice
   * and the outstanding choice not at all.
   */
  readonly placeholder: string;
}) {
  const controlId = useId();

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={controlId} className="text-sm font-medium text-text">
        {label}
      </label>
      <SelectControl
        id={controlId}
        value={value}
        onValueChange={onChange}
        placeholder={placeholder}
        emptyLabel={placeholder}
        testId="receiving-location"
        options={locations.map((location) => ({
          value: location.locationId,
          label: location.code,
        }))}
      />
    </div>
  );
}
