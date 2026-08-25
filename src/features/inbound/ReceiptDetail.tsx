"use client";

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
