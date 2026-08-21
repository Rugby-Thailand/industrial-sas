"use client";

import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { EntityWriteForm } from "@/features/masterData/EntityWriteForm";
import { QueryGate } from "@/components/system/QueryGate";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { Notice } from "@/components/ui/Notice";
import {
  createCountPlanRef,
  releaseCountPlanRef,
} from "@/lib/convex/countingApi";
import {
  DEFAULT_LEDGER_PAGE_SIZE,
  listBalancesRef,
  type BalanceRow,
} from "@/lib/convex/ledgerApi";
import { describeBucketKey } from "@/lib/inventory/bucketIdentity";
import { previewBalancesFor } from "@/lib/preview/ledgerPreview";

export function CountPlanBuilder() {
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId, preview) =>
        preview ? (
          <CountPlanForm
            warehouseId={warehouseId}
            balances={previewBalancesFor(warehouseId)}
            preview
          />
        ) : (
          <ServerCountPlanBuilder warehouseId={warehouseId} />
        )
      }
    </QueryGate>
  );
}

function ServerCountPlanBuilder({
  warehouseId,
}: {
  readonly warehouseId: string;
}) {
  const outcome = useQuery(listBalancesRef, {
    warehouseId,
    maxPageSize: DEFAULT_LEDGER_PAGE_SIZE,
  });
  if (outcome === undefined)
    return <LedgerPanelStatus state={{ kind: "LOADING" }} />;
  if (!outcome.ok)
    return (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: outcome.requestId }}
      />
    );
  if (!outcome.value.ok)
    return (
      <LedgerPanelStatus
        state={{ kind: "ERROR", code: outcome.value.error.code }}
      />
    );
  return (
    <CountPlanForm warehouseId={warehouseId} balances={outcome.value.items} />
  );
}

function physicalBalances(rows: readonly BalanceRow[]) {
  return rows.filter((row) =>
    describeBucketKey(row.bucketKey).some(
      (part) => part.dimension === "location",
    ),
  );
}

function savedDocumentId(outcome: Record<string, unknown>): string | undefined {
  const value = outcome["value"] as Record<string, unknown> | undefined;
  return typeof value?.["documentId"] === "string"
    ? value["documentId"]
    : undefined;
}

function CountPlanForm({
  warehouseId,
  balances,
  preview = false,
}: {
  readonly warehouseId: string;
  readonly balances: readonly BalanceRow[];
  readonly preview?: boolean;
}) {
  const t = useTranslations("Count");
  const [planId, setPlanId] = useState<string>();
  const targets = physicalBalances(balances);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
      <EntityWriteForm
        mutationRef={createCountPlanRef}
        legend={t("planLegend")}
        description={t("planDescription")}
        submitLabel={t("createPlan")}
        requiredMessage={t("required")}
        fields={[
          {
            name: "planNumber",
            label: t("planNumber"),
            kind: "text",
            required: true,
            initialValue: "COUNT-",
            monospace: true,
          },
          {
            name: "scope",
            label: t("scope"),
            kind: "select",
            required: true,
            initialValue: "CYCLE",
            options: ["FULL", "CYCLE", "SPOT"].map((value) => ({
              value,
              label: value,
            })),
          },
          {
            name: "visibility",
            label: t("visibility"),
            kind: "select",
            required: true,
            initialValue: "BLIND",
            options: ["BLIND", "VISIBLE"].map((value) => ({
              value,
              label: value,
            })),
          },
          {
            name: "movementPolicy",
            label: t("movementPolicy"),
            kind: "select",
            required: true,
            initialValue: "MOVEMENT_AWARE",
            options: ["MOVEMENT_AWARE", "FROZEN"].map((value) => ({
              value,
              label: value,
            })),
          },
          {
            name: "quantityThreshold",
            label: t("quantityThreshold"),
            kind: "number",
            required: true,
            initialValue: "1000",
          },
          {
            name: "valueThreshold",
            label: t("valueThreshold"),
            kind: "number",
            required: true,
            initialValue: "100000",
          },
          {
            name: "itemClass",
            label: t("itemClass"),
            kind: "text",
            required: true,
            initialValue: "C",
            monospace: true,
          },
          {
            name: "unitValue",
            label: t("unitValue"),
            kind: "number",
            required: true,
            initialValue: "0",
          },
          {
            name: "targetBucket",
            label: t("targetBucket"),
            kind: "select",
            required: true,
            placeholder: t("selectTarget"),
            options: targets.map((row) => ({
              value: row.bucketKey,
              label: `${describeBucketKey(row.bucketKey)
                .map((part) => `${part.dimension}: ${part.value}`)
                .join(" · ")} · ${row.minorUnits} ${row.uom}`,
            })),
          },
        ]}
        toArgs={(values, requestId) => ({
          requestId,
          warehouseId,
          planNumber: values["planNumber"] ?? "",
          scope: (values["scope"] ?? "CYCLE") as "FULL" | "CYCLE" | "SPOT",
          visibility: (values["visibility"] ?? "BLIND") as "BLIND" | "VISIBLE",
          movementPolicy: (values["movementPolicy"] ?? "MOVEMENT_AWARE") as
            "FROZEN" | "MOVEMENT_AWARE",
          ...((values["movementPolicy"] ?? "") === "FROZEN"
            ? { freezeExpiresAt: Date.now() + 60 * 60 * 1000 }
            : {}),
          quantityThresholdBaseMinorUnits: Number(values["quantityThreshold"]),
          valueThresholdMinorUnits: Number(values["valueThreshold"]),
          targets: [
            {
              bucketKey: values["targetBucket"] ?? "",
              itemClass: values["itemClass"] ?? "C",
              unitValueMinorUnits: Number(values["unitValue"]),
            },
          ],
        })}
        onSaved={(outcome) => setPlanId(savedDocumentId(outcome))}
        onDemonstrated={() => setPlanId("preview-count-plan")}
        testId="count-plan-form"
      />

      <div className="flex flex-col gap-4">
        {preview ? (
          <Notice tone="accent" title={t("previewOnly")} />
        ) : targets.length === 0 ? (
          <Notice tone="muted" title={t("selectTarget")} />
        ) : null}
        {planId === undefined ? null : (
          <EntityWriteForm
            key={planId}
            mutationRef={releaseCountPlanRef}
            legend={t("releasePlan")}
            submitLabel={t("releasePlan")}
            requiredMessage={t("required")}
            fields={[
              {
                name: "countPlanId",
                label: t("planNumber"),
                kind: "text",
                required: true,
                initialValue: planId,
                monospace: true,
              },
            ]}
            toArgs={(values, requestId) => ({
              requestId,
              warehouseId,
              countPlanId: values["countPlanId"] ?? "",
            })}
          />
        )}
      </div>
    </div>
  );
}
