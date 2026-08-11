"use client";

/**
 * Approving a parked disposition — the second person's control.
 *
 * Its own component and its own section, because it is a *different actor's*
 * action. Putting it beside the submit form would suggest one person does both,
 * which is exactly what `INV-0006-05` refuses: the evaluator denies when the
 * maker and the actor are the same, and the submitter pressing this gets a
 * denial with a request ID.
 *
 * ### The inspection is chosen, never typed
 *
 * The approver is a second signed-in person who did not submit the disposition.
 * Asking them for the inspection's document ID would mean obtaining it from the
 * submitter — by screenshot, or not at all. They pick it from the queue their
 * own permission already lets them read, and the queue is narrowed to exactly
 * the inspections waiting for somebody.
 *
 * The control is shown to everybody, including the submitter. Hiding it would
 * make a maker-checker rule look like a missing feature, and would hide the one
 * message that tells an administrator what to grant (`INV-0002-07`).
 */
import { useTranslations } from "next-intl";

import { Notice } from "@/components/ui/Notice";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { EntityWriteForm } from "@/features/masterData/EntityWriteForm";
import { approveDispositionRef } from "@/lib/convex/inboundApi";
import { codeLabel, type CodeTranslator } from "@/lib/domainLabels";

import { PendingInspections } from "./InboundOptions";

export function ApproveDispositionControl() {
  const t = useTranslations("Quality");
  const writeT = useTranslations("Write");
  const dispositionT = useTranslations(
    "QcDisposition",
  ) as unknown as CodeTranslator;
  const warehouseId = useWorkspace().selectedWarehouseId;

  if (warehouseId === undefined) {
    return <LedgerPanelStatus state={{ kind: "WAREHOUSE_MISSING" }} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <Notice
        tone="accent"
        title={t("approve")}
        body={t("approveHint")}
        testId="quality-approval-rule"
      />
      <PendingInspections
        emptyTitle={t("noPendingInspections")}
        emptyBody={t("noPendingInspectionsHint")}
        emptyTestId="quality-no-pending"
      >
        {(pending) => (
          <EntityWriteForm
            testId="form-approve-disposition"
            mutationRef={approveDispositionRef}
            legend={t("approve")}
            description={t("approveHint")}
            submitLabel={t("approve")}
            requiredMessage={writeT("required")}
            fields={[
              {
                name: "inspectionId",
                label: t("selectPending"),
                kind: "select",
                required: true,
                /*
                 * Labelled by what the approver is deciding — the disposition
                 * somebody proposed — rather than by an identifier. "Release" is
                 * the fact they are being asked to stand behind.
                 */
                options: pending.map((inspection) => ({
                  value: inspection.inspectionId,
                  label:
                    inspection.disposition === undefined
                      ? inspection.inspectionId
                      : codeLabel(dispositionT, inspection.disposition),
                })),
              },
            ]}
            toArgs={(values, requestId) => ({
              requestId,
              warehouseId,
              inspectionId: values["inspectionId"] ?? "",
            })}
          />
        )}
      </PendingInspections>
    </div>
  );
}
