"use client";

import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";

import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { QueryGate } from "@/components/system/QueryGate";
import { Notice } from "@/components/ui/Notice";
import { EntityWriteForm } from "@/features/masterData/EntityWriteForm";
import {
  listCapturedProofsOfDeliveryRef,
  reviewProofOfDeliveryRef,
  type CapturedPodRow,
} from "@/lib/convex/fulfillmentApi";

const PREVIEW_CAPTURED_AT = 1_755_388_800_000;

export function PodReviewQueue() {
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId, preview) =>
        preview ? (
          <PodReviewBody
            warehouseId={warehouseId}
            rows={[
              {
                proofOfDeliveryId: "prv_pod_1",
                shipmentId: "prv_shipment_1",
                tripId: "prv_trip_1",
                recipientName: "ผู้รับสินค้า",
                transportFileId: "prv_file_1",
                capturedByUserId: "prv_driver",
                capturedAt: PREVIEW_CAPTURED_AT,
              },
            ]}
          />
        ) : (
          <ServerPodReview warehouseId={warehouseId} />
        )
      }
    </QueryGate>
  );
}

function ServerPodReview({ warehouseId }: { readonly warehouseId: string }) {
  const outcome = useQuery(listCapturedProofsOfDeliveryRef, {
    warehouseId,
    maxPageSize: 100,
  });
  if (outcome === undefined)
    return <LedgerPanelStatus state={{ kind: "LOADING" }} />;
  if (!outcome.ok || !outcome.value.ok)
    return (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: outcome.requestId }}
      />
    );
  return (
    <PodReviewBody
      warehouseId={warehouseId}
      rows={outcome.value.items}
      incomplete={!outcome.value.complete}
    />
  );
}

function PodReviewBody({
  warehouseId,
  rows,
  incomplete = false,
}: {
  readonly warehouseId: string;
  readonly rows: readonly CapturedPodRow[];
  readonly incomplete?: boolean;
}) {
  const t = useTranslations("Transport");
  if (rows.length === 0) {
    return (
      <section className="mt-8">
        <Notice tone="muted" title={t("podReviewEmpty")} />
      </section>
    );
  }
  return (
    <section aria-labelledby="pod-review-title" className="mt-8">
      <h2 id="pod-review-title" className="text-xl font-semibold text-text">
        {t("podReviewTitle")}
      </h2>
      <p className="mt-1 text-sm text-muted">{t("podReviewHelp")}</p>
      {incomplete ? (
        <div className="mt-4">
          <Notice tone="warning" title={t("moreRecords")} />
        </div>
      ) : null}
      <div className="mt-4">
        <EntityWriteForm
          mutationRef={reviewProofOfDeliveryRef}
          legend={t("podDecision")}
          submitLabel={t("confirmPodDecision")}
          requiredMessage={t("required")}
          fields={[
            {
              name: "podId",
              label: t("podEvidence"),
              kind: "select",
              required: true,
              options: rows.map((row) => ({
                value: row.proofOfDeliveryId,
                label: `${row.shipmentId} · ${row.recipientName}`,
              })),
            },
            {
              name: "decision",
              label: t("podDecision"),
              kind: "select",
              required: true,
              initialValue: "ACCEPT",
              options: [
                { value: "ACCEPT", label: t("acceptPod") },
                { value: "REJECT", label: t("rejectPod") },
              ],
            },
            {
              name: "reason",
              label: t("podRejectReason"),
              kind: "text",
              required: false,
            },
          ]}
          toArgs={(values, requestId) => ({
            requestId,
            warehouseId,
            proofOfDeliveryId: values["podId"] ?? "",
            accept: values["decision"] === "ACCEPT",
            ...(values["decision"] === "REJECT"
              ? { rejectionReason: values["reason"] ?? "" }
              : {}),
          })}
        />
      </div>
    </section>
  );
}
