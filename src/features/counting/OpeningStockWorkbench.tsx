"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { QueryGate } from "@/components/system/QueryGate";
import { Notice } from "@/components/ui/Notice";
import { EntityWriteForm } from "@/features/masterData/EntityWriteForm";
import {
  approveOpeningStockBatchRef,
  createOpeningStockBatchRef,
  importOpeningStockRowsRef,
  postNextOpeningStockChunkRef,
  submitOpeningStockBatchRef,
} from "@/lib/convex/countingApi";

function savedId(outcome: Record<string, unknown>) {
  const value = outcome["value"] as Record<string, unknown> | undefined;
  return typeof value?.["documentId"] === "string"
    ? value["documentId"]
    : undefined;
}

export function OpeningStockWorkbench() {
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId, preview) => (
        <OpeningJourney warehouseId={warehouseId} preview={preview} />
      )}
    </QueryGate>
  );
}

function OpeningJourney({
  warehouseId,
  preview,
}: {
  readonly warehouseId: string;
  readonly preview: boolean;
}) {
  const t = useTranslations("Count");
  const [batchId, setBatchId] = useState<string>();
  const [imported, setImported] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [approved, setApproved] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      {preview ? <Notice tone="accent" title={t("previewOnly")} /> : null}
      <EntityWriteForm
        mutationRef={createOpeningStockBatchRef}
        legend={t("openingLegend")}
        description={t("openingDescription")}
        submitLabel={t("createAndValidate")}
        requiredMessage={t("required")}
        fields={[
          {
            name: "batchRef",
            label: t("batchRef"),
            kind: "text",
            required: true,
            initialValue: "OPEN-",
            monospace: true,
          },
          {
            name: "sourceFileName",
            label: t("sourceFileName"),
            kind: "text",
            required: true,
            initialValue: "opening-stock.csv",
          },
          {
            name: "sourceHash",
            label: t("sourceHash"),
            kind: "text",
            required: true,
            hint: t("csvHint"),
            monospace: true,
          },
          {
            name: "reasonCodeId",
            label: t("reasonCodeId"),
            kind: "text",
            required: true,
            monospace: true,
          },
        ]}
        toArgs={(values, requestId) => ({
          requestId,
          warehouseId,
          batchRef: values["batchRef"] ?? "",
          sourceFileName: values["sourceFileName"] ?? "",
          sourceHash: values["sourceHash"] ?? "",
          cutoffAt: Date.now(),
          declaredRowCount: 1,
          reasonCodeId: values["reasonCodeId"] ?? "",
        })}
        onSaved={(outcome) => setBatchId(savedId(outcome))}
        testId="opening-stock-create"
      />

      {batchId === undefined ? null : (
        <>
          <Notice tone="success" title={t("batchReady", { id: batchId })} />
          <EntityWriteForm
            mutationRef={importOpeningStockRowsRef}
            legend={t("importRow")}
            submitLabel={t("importRow")}
            requiredMessage={t("required")}
            fields={[
              {
                name: "sku",
                label: t("sku"),
                kind: "text",
                required: true,
                monospace: true,
              },
              {
                name: "locationCode",
                label: t("locationCode"),
                kind: "text",
                required: true,
                monospace: true,
              },
              {
                name: "lotCode",
                label: t("lotCode"),
                kind: "text",
                monospace: true,
              },
              {
                name: "stockStatus",
                label: t("stockStatus"),
                kind: "select",
                required: true,
                initialValue: "AVAILABLE",
                options: ["AVAILABLE", "QC_HOLD", "QUARANTINE", "REJECTED"].map(
                  (value) => ({ value, label: value }),
                ),
              },
              {
                name: "entryUom",
                label: t("uom"),
                kind: "text",
                required: true,
                initialValue: "PCS",
                monospace: true,
              },
              {
                name: "entryMinorUnits",
                label: t("minorUnits"),
                kind: "number",
                required: true,
              },
            ]}
            toArgs={(values, requestId) => ({
              requestId,
              warehouseId,
              openingStockBatchId: batchId,
              startSourceRowNumber: 1,
              rows: [
                {
                  sku: values["sku"] ?? "",
                  locationCode: values["locationCode"] ?? "",
                  ...((values["lotCode"] ?? "") === ""
                    ? {}
                    : { lotCode: values["lotCode"] }),
                  stockStatus: values["stockStatus"] ?? "AVAILABLE",
                  entryUom: values["entryUom"] ?? "",
                  entryMinorUnits: Number(values["entryMinorUnits"]),
                },
              ],
            })}
            onSaved={() => setImported(true)}
          />
        </>
      )}

      {!imported || batchId === undefined ? null : (
        <EntityWriteForm
          mutationRef={submitOpeningStockBatchRef}
          legend={t("submitReview")}
          submitLabel={t("submitReview")}
          requiredMessage={t("required")}
          fields={[
            {
              name: "batchId",
              label: t("batchId"),
              kind: "text",
              required: true,
              initialValue: batchId,
              monospace: true,
            },
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            warehouseId,
            openingStockBatchId: values["batchId"] ?? batchId,
          })}
          onSaved={() => setSubmitted(true)}
        />
      )}

      {!submitted || batchId === undefined ? null : (
        <EntityWriteForm
          mutationRef={approveOpeningStockBatchRef}
          legend={t("approve")}
          description={t("openingDescription")}
          submitLabel={t("approve")}
          requiredMessage={t("required")}
          fields={[
            {
              name: "batchId",
              label: t("batchId"),
              kind: "text",
              required: true,
              initialValue: batchId,
              monospace: true,
            },
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            warehouseId,
            openingStockBatchId: values["batchId"] ?? batchId,
          })}
          onSaved={() => setApproved(true)}
        />
      )}

      {!approved || batchId === undefined ? null : (
        <EntityWriteForm
          mutationRef={postNextOpeningStockChunkRef}
          legend={t("post")}
          submitLabel={t("post")}
          requiredMessage={t("required")}
          fields={[
            {
              name: "batchId",
              label: t("batchId"),
              kind: "text",
              required: true,
              initialValue: batchId,
              monospace: true,
            },
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            warehouseId,
            openingStockBatchId: values["batchId"] ?? batchId,
          })}
        />
      )}
    </div>
  );
}
