"use client";

/**
 * The putaway board and the confirmation that closes a task.
 *
 * Split out of `InboundPanels` and `InboundForms` for the reason
 * `QualityInspections` documents: putaway is a terminal inbound workflow, so a
 * putaway screen has no use for the ordering, receiving, or quality
 * vocabularies, and while these two lived beside those controls it shipped all
 * of them.
 *
 * The claim control sits inside `renderRows`, so it exists only when there are
 * rows to act on: a claim button rendered above a `DENIED` notice would be a
 * control the server has already said this operator may not use.
 */
import { useTranslations } from "next-intl";

import { PutawayTasksTable } from "@/components/inbound/PutawayTables";
import { Button } from "@/components/ui/button";
import {
  claimPutawayTaskRef,
  confirmPutawayRef,
  listPutawayTasksRef,
  type PutawayTaskRow,
} from "@/lib/convex/inboundApi";
import { previewPutawayTasksFor } from "@/lib/preview/inboundPreview";

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
      previewRowsFor={previewPutawayTasksFor}
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
                      /*
                       * A claimed task still offers the control, and the label
                       * is an *action* rather than a state. It used to read
                       * "Already claimed", which is a fact about the task and
                       * not a thing pressing the button does — a terminal state
                       * dressed as an enabled control, which the audit found.
                       * The state itself is in the status column, once, as a
                       * static glyph-and-word badge.
                       *
                       * The control stays live because re-claiming your own task
                       * after a reconnect succeeds; claiming somebody else's is
                       * refused by the server with a message that says which
                       * (`INV-0007-11`), and the hint says so before it is
                       * pressed. Disabling it would make a reconnect look like a
                       * lost task.
                       */
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
  /** The ranked locations, so the operator chooses from what was recommended. */
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
                  /*
                   * A select over the *ranked* locations. A free-text box would let
                   * an operator name a bin a hard constraint rejected, and the
                   * server would refuse it — correctly, but only after the pallet
                   * had already been moved.
                   */
                  options: [...locations],
                },
                {
                  /*
                   * Optional: taking the top recommendation needs no reason. The
                   * empty choice is first and explicit, so an operator who did take
                   * it is not nudged into inventing one.
                   */
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
