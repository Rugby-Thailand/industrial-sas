"use client";

/** Quantity evidence plus the one-action supervisor recovery path. */
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { QuantityEntryField } from "@/components/operator/QuantityEntryField";
import { Notice } from "@/components/ui/Notice";
import { Button } from "@/components/ui/button";
import type { ConnectionStatus } from "@/lib/convex/connection";
import {
  recordTaskEvidenceRef,
  type OperatorTaskRow,
} from "@/lib/convex/platformApi";
import { readOrCreateInstallationId } from "@/lib/device/installationId";
import { availabilityFor } from "@/lib/offline/commandAvailability";

import { RowWriteRegion } from "../masterData/RowWriteRegion";
import {
  SupervisorStepUpPanel,
  type StepUpGrant,
} from "./SupervisorStepUpPanel";

export function TaskQuantityEvidence({
  task,
  connectionStatus,
}: {
  readonly task: OperatorTaskRow;
  readonly connectionStatus: ConnectionStatus;
}) {
  const t = useTranslations("QuantityEntry");
  const locale = useLocale();
  const [quantity, setQuantity] = useState("");
  const [uom, setUom] = useState(task.baseUom ?? "");
  const [approval, setApproval] = useState<StepUpGrant>();
  const availability = availabilityFor({
    operation: "work.evidence.record",
    status: connectionStatus,
  });

  if (task.baseUom === undefined) {
    return (
      <section className="rounded-xl border border-border bg-surface p-4">
        <Notice
          tone="warning"
          title={t("noItemTitle")}
          body={t("noItemBody")}
          testId="task-quantity-no-item"
        />
      </section>
    );
  }

  const expected =
    task.expectedBaseMinorUnits === undefined
      ? undefined
      : new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(
          task.expectedBaseMinorUnits / 1_000,
        );

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-labelledby={`task-quantity-title-${task.operatorTaskId}`}
        className="rounded-xl border border-border bg-surface p-4"
        data-testid="task-quantity-evidence"
      >
        <h2
          id={`task-quantity-title-${task.operatorTaskId}`}
          className="text-lg font-semibold text-text"
        >
          {t("title")}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {expected === undefined
            ? t("descriptionNoExpectation")
            : t("description", { expected, uom: task.baseUom })}
        </p>

        <div className="mt-4 flex flex-col gap-4">
          <QuantityEntryField
            value={quantity}
            onValueChange={setQuantity}
            uom={uom}
            onUomChange={setUom}
            uomOptions={[{ value: task.baseUom, label: task.baseUom }]}
            disabled={!availability.available}
            testId="task-quantity-input"
            labels={{
              quantityLabel: t("quantityLabel"),
              uomLabel: t("uomLabel"),
              uomPlaceholder: t("uomPlaceholder"),
              previewLabel: t("previewLabel"),
              errors: {
                ENTRY_REQUIRED: t("error.ENTRY_REQUIRED"),
                ENTRY_TOO_LONG: t("error.ENTRY_TOO_LONG"),
                MIXED_NUMERAL_SYSTEMS: t("error.MIXED_NUMERAL_SYSTEMS"),
                MALFORMED_GROUPING: t("error.MALFORMED_GROUPING"),
                MALFORMED_ENTRY: t("error.MALFORMED_ENTRY"),
                PRECISION_EXCEEDED: t("error.PRECISION_EXCEEDED"),
                NEGATIVE_NOT_ALLOWED: t("error.NEGATIVE_NOT_ALLOWED"),
                ZERO_NOT_ALLOWED: t("error.ZERO_NOT_ALLOWED"),
              },
              genericError: t("genericError"),
            }}
          />

          {approval === undefined ? null : (
            <Notice
              tone="success"
              title={t("approvalReadyTitle")}
              body={t("approvalReadyBody", {
                time: new Intl.DateTimeFormat(locale, {
                  timeStyle: "short",
                  timeZone: "Asia/Bangkok",
                }).format(approval.expiresAt),
              })}
              testId="task-quantity-approval-ready"
            />
          )}

          {!availability.available ? (
            <Notice
              tone="warning"
              title={t("offlineTitle")}
              body={t("offlineBody")}
              testId="task-quantity-offline"
            />
          ) : null}

          <RowWriteRegion
            mutationRef={recordTaskEvidenceRef}
            onSaved={() => {
              setQuantity("");
              setApproval(undefined);
            }}
          >
            {({ submit, busy, state }) => (
              <div className="flex flex-col gap-3">
                {state.kind === "REFUSED" &&
                state.code === "PLAUSIBILITY_APPROVAL_REQUIRED" ? (
                  <Notice
                    tone="warning"
                    title={t("plausibility.implausibleTitle")}
                    body={t("plausibility.implausibleBody")}
                    testId="task-quantity-approval-required"
                  />
                ) : null}
                <Button
                  type="button"
                  disabled={
                    busy ||
                    !availability.available ||
                    quantity.trim().length === 0 ||
                    uom.length === 0
                  }
                  data-testid="task-quantity-confirm"
                  onClick={() =>
                    submit(`${quantity}:${uom}`, (requestId) => ({
                      requestId,
                      warehouseId: task.warehouseId,
                      operatorTaskId: task.operatorTaskId,
                      kind: "QUANTITY" as const,
                      quantityText: quantity,
                      entryUom: uom,
                      installationId: readOrCreateInstallationId(),
                      ...(approval === undefined
                        ? {}
                        : { stepUpApprovalId: approval.approvalId }),
                    }))
                  }
                >
                  {approval === undefined
                    ? t("record")
                    : t("recordWithApproval")}
                </Button>
              </div>
            )}
          </RowWriteRegion>
        </div>
      </section>

      <SupervisorStepUpPanel
        task={task}
        connectionStatus={connectionStatus}
        onApproved={setApproval}
      />
    </div>
  );
}
