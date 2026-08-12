"use client";

/**
 * The inspection queue and the disposition that closes one.
 *
 * A panel and the write attached to it, in one module, because that is the pair
 * a quality screen mounts and nothing else mounts. `InboundPanels` and
 * `InboundForms` hold the purchasing and receiving equivalents; keeping the
 * quality pair there meant every quality screen reached — and shipped — the
 * ordering, receiving, and putaway vocabularies for controls it never renders.
 *
 * The conventions are the ones those files document and do not change here: the
 * write goes through `EntityWriteForm` (gate, one idempotency key per attempt,
 * the key held across a transport failure), the panel is warehouse-scoped
 * because an inspection happens at a site, and nothing here decides whether a
 * write is allowed — the server does, and a denial is shown as a denial with its
 * request ID (`INV-0002-07`).
 */
import { useTranslations } from "next-intl";

import { InspectionsTable } from "@/components/inbound/QualityTables";
import { Button } from "@/components/ui/button";
import {
  listInspectionsRef,
  submitDispositionRef,
  type InspectionRow,
} from "@/lib/convex/inboundApi";
import { previewInspectionsFor } from "@/lib/preview/inboundPreview";

import { MasterDataPanel } from "../masterData/MasterDataPanel";
import { EntityWriteForm } from "../masterData/EntityWriteForm";

import { ActiveReasonCodes } from "./CatalogueOptions";
import { pageArgs, WithWarehouse } from "./InboundPrimitives";

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
      /*
       * `STATUS_CHANGE`, because a disposition *is* one: the stock moves between
       * buckets and the reason is the audit evidence for that movement. A code
       * minted for scrap must not be offered here (`ADR-0003` §5).
       */
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
