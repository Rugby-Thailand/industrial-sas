"use client";

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
        title={t("approvalRule")}
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
            legend={t("approveLegend")}
            submitLabel={t("approve")}
            requiredMessage={writeT("required")}
            fields={[
              {
                name: "inspectionId",
                label: t("selectPending"),
                kind: "select",
                required: true,

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
