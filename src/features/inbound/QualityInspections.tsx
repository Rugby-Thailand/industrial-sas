"use client";

import { useTranslations } from "next-intl";

import { InspectionsTable } from "@/components/inbound/QualityTables";
import { Button } from "@/components/ui/button";
import {
  listInspectionsRef,
  submitDispositionRef,
  type InspectionRow,
} from "@/lib/convex/inboundApi";

import { MasterDataPanel } from "../masterData/MasterDataPanel";
import { EntityWriteForm } from "../masterData/EntityWriteForm";

import { ActiveReasonCodes } from "./CatalogueOptions";
import { pageArgs, WithWarehouse } from "./InboundPrimitives";

export function InspectionsPanel({
  onSelect,
}: {
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
      renderRows={(rows) => (
        <InspectionsTable
          rows={rows}
          {...(onSelect === undefined
            ? {}
            : {
                renderAction: (row: InspectionRow) =>
                  row.status === "OPEN" ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => onSelect(row)}
                      data-testid={`inspection-select-${row.inspectionId}`}
                      className="px-3 text-xs"
                    >
                      {t("sectionDisposition")}
                    </Button>
                  ) : null,
              })}
        />
      )}
    />
  );
}

export function DispositionForm({
  inspectionId,
}: {
  readonly inspectionId: string;
}) {
  const t = useTranslations("Quality");
  const dispositionT = useTranslations("QcDisposition");
  const writeT = useTranslations("Write");

  return (
    <ActiveReasonCodes
      scope="STATUS_CHANGE"
      emptyTitle={writeT("noReasonCodes")}
      emptyBody={writeT("noReasonCodesHint")}
      emptyTestId="disposition-no-reasons"
    >
      {(reasons) => (
        <WithWarehouse
          render={(warehouseId) => (
            <EntityWriteForm
              testId="form-disposition"
              mutationRef={submitDispositionRef}
              legend={t("dispositionLegend")}
              description={t("dispositionDescription")}
              submitLabel={t("dispositionSubmit")}
              requiredMessage={writeT("required")}
              fields={[
                {
                  name: "disposition",
                  label: t("fieldDisposition"),
                  kind: "select",
                  required: true,
                  placeholder: t("selectDisposition"),
                  options: (
                    [
                      "RELEASE",
                      "QUARANTINE",
                      "REJECT",
                      "SCRAP",
                      "REWORK",
                    ] as const
                  ).map((value) => ({ value, label: dispositionT(value) })),
                },
                {
                  name: "reasonCodeId",
                  label: writeT("reasonCodeLabel"),
                  kind: "select",
                  required: true,
                  placeholder: writeT("selectReasonCode"),
                  options: reasons.map((reason) => ({
                    value: reason.reasonCodeId,
                    label: `${reason.code} · ${reason.name}`,
                  })),
                },
              ]}
              toArgs={(values, requestId) => ({
                requestId,
                warehouseId,
                inspectionId,
                disposition: (values["disposition"] ?? "REJECT") as
                  "RELEASE" | "QUARANTINE" | "REJECT" | "SCRAP" | "REWORK",
                reasonCodeId: values["reasonCodeId"] ?? "",
              })}
            />
          )}
        />
      )}
    </ActiveReasonCodes>
  );
}
