"use client";

import { useTranslations } from "next-intl";

import { PutawayTasksTable } from "@/components/inbound/PutawayTables";
import { Button } from "@/components/ui/button";
import {
  claimPutawayTaskRef,
  confirmPutawayRef,
  listPutawayTasksRef,
  type PutawayTaskRow,
} from "@/lib/convex/inboundApi";

import { MasterDataPanel } from "../masterData/MasterDataPanel";
import { EntityWriteForm } from "../masterData/EntityWriteForm";
import { RowActionButton, RowWriteRegion } from "../masterData/RowWriteRegion";

import { ActiveReasonCodes } from "./CatalogueOptions";
import { pageArgs, WithWarehouse } from "./InboundPrimitives";

export function PutawayTasksPanel({
  onSelect,
}: {
  readonly onSelect?: (row: PutawayTaskRow) => void;
}) {
  const t = useTranslations("Putaway");

  return (
    <MasterDataPanel<
      PutawayTaskRow,
      { warehouseId: string; maxPageSize?: number; cursor?: string }
    >
      queryRef={listPutawayTasksRef}
      scope="WAREHOUSE"
      buildArgs={({ warehouseId, cursor }) => pageArgs(warehouseId, cursor)}
      renderRows={(rows) => (
        <RowWriteRegion mutationRef={claimPutawayTaskRef}>
          {({ submit, busy }) => (
            <PutawayTasksTable
              rows={rows}
              renderAction={(row) =>
                row.status === "CONFIRMED" ||
                row.status === "CANCELLED" ? null : (
                  <div className="flex flex-wrap gap-2">
                    <RowActionButton
                      busy={busy}
                      testId={`task-claim-${row.putawayTaskId}`}

                      label={
                        row.status === "CLAIMED" ? t("claimAgain") : t("claim")
                      }
                      {...(row.status === "CLAIMED"
                        ? { title: t("claimedHint") }
                        : {})}
                      onClick={() =>
                        submit(row.putawayTaskId, (requestId) => ({
                          requestId,
                          warehouseId: row.warehouseId,
                          putawayTaskId: row.putawayTaskId,
                        }))
                      }
                    />
                    {onSelect === undefined ? null : (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => onSelect(row)}
                        data-testid={`task-select-${row.putawayTaskId}`}
                        className="px-3 text-xs"
                      >
                        {t("sectionRecommendation")}
                      </Button>
                    )}
                  </div>
                )
              }
            />
          )}
        </RowWriteRegion>
      )}
    />
  );
}

export function ConfirmPutawayForm({
  putawayTaskId,
  locations,
}: {
  readonly putawayTaskId: string;

  readonly locations: readonly {
    readonly value: string;
    readonly label: string;
  }[];
}) {
  const t = useTranslations("Putaway");
  const writeT = useTranslations("Write");

  return (
    <ActiveReasonCodes
      scope="ADJUSTMENT"
      emptyTitle={writeT("noReasonCodes")}
      emptyBody={writeT("noReasonCodesHint")}
      emptyTestId="putaway-no-reasons"
    >
      {(reasons) => (
        <WithWarehouse
          render={(warehouseId) => (
            <EntityWriteForm
              presentation="inline"
              testId="form-confirm-putaway"
              mutationRef={confirmPutawayRef}
              legend={t("confirmLegend")}
              description={t("confirmDescription")}
              submitLabel={t("confirmSubmit")}
              requiredMessage={writeT("required")}
              fields={[
                {
                  name: "chosenLocationId",
                  label: t("fieldChosenLocation"),
                  kind: "select",
                  required: true,
                  placeholder: t("selectChosenLocation"),

                  options: [...locations],
                },
                {
                  name: "overrideReasonCodeId",
                  label: t("fieldOverrideReason"),
                  kind: "select",
                  options: [
                    { value: "", label: "—" },
                    ...reasons.map((reason) => ({
                      value: reason.reasonCodeId,
                      label: `${reason.code} · ${reason.name}`,
                    })),
                  ],
                },
              ]}
              toArgs={(values, requestId) => ({
                requestId,
                warehouseId,
                putawayTaskId,
                chosenLocationId: values["chosenLocationId"] ?? "",
                ...((values["overrideReasonCodeId"] ?? "") === ""
                  ? {}
                  : {
                      overrideReasonCodeId: values[
                        "overrideReasonCodeId"
                      ] as string,
                    }),
              })}
            />
          )}
        />
      )}
    </ActiveReasonCodes>
  );
}
