"use client";

import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { useAppEnvironment } from "@/components/providers/EnvironmentProvider";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { Button } from "@/components/ui/button";
import { EntityWriteForm } from "@/features/masterData/EntityWriteForm";
import {
  confirmSimilarDesignRef,
  listSimilarReleasedDesignsRef,
} from "@/lib/convex/orderToShipApi";

export function SimilarDesignCandidates({
  designRequestId,
}: {
  readonly designRequestId: string;
}) {
  const environment = useAppEnvironment();
  const t = useTranslations("OrderToShip");
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <Button
        type="button"
        variant="outline"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? t("hideSimilarCandidates") : t("showSimilarCandidates")}
      </Button>
      {open ? (
        <CandidateResults
          designRequestId={designRequestId}
          previewMode={environment.previewMode}
          backendConfigured={environment.backendConfigured}
          identityConfigured={environment.identityConfigured}
        />
      ) : null}
    </div>
  );
}

function CandidateResults({
  designRequestId,
  previewMode,
  backendConfigured,
  identityConfigured,
}: {
  readonly designRequestId: string;
  readonly previewMode: boolean;
  readonly backendConfigured: boolean;
  readonly identityConfigured: boolean;
}) {
  const t = useTranslations("OrderToShip");
  if (previewMode) {
    return (
      <p className="mt-3 rounded border border-border bg-raised p-3 text-sm text-muted">
        {t("previewSimilarityCandidates")}
      </p>
    );
  }
  if (!backendConfigured) {
    return <LedgerPanelStatus state={{ kind: "BACKEND_MISSING" }} />;
  }
  if (!identityConfigured) {
    return <LedgerPanelStatus state={{ kind: "SIGN_IN_REQUIRED" }} />;
  }
  return <ServerCandidates designRequestId={designRequestId} />;
}

function ServerCandidates({
  designRequestId,
}: {
  readonly designRequestId: string;
}) {
  const t = useTranslations("OrderToShip");
  const outcome = useQuery(listSimilarReleasedDesignsRef, { designRequestId });
  if (outcome === undefined) {
    return <p className="mt-3 text-sm text-muted">{t("loadingCandidates")}</p>;
  }
  if (!outcome.ok) {
    return (
      <p className="mt-3 text-sm text-danger">{t("candidateLoadFailed")}</p>
    );
  }
  if (outcome.value.length === 0) {
    return (
      <p className="mt-3 text-sm text-muted">{t("noSimilarCandidates")}</p>
    );
  }
  return (
    <section className="mt-4" aria-label={t("similarCandidates")}>
      <h4 className="font-bold text-text">{t("similarCandidates")}</h4>
      <p className="mt-1 text-sm text-muted">{t("similarCandidatesDetail")}</p>
      <ul className="mt-3 grid gap-3">
        {outcome.value.map((candidate) => (
          <li
            key={candidate.masterCardRevisionId}
            className="rounded border border-accent/40 bg-raised p-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-bold text-text">
                  {candidate.cardNumber} · R{candidate.revisionNumber}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {candidate.customerProductCode} ·{" "}
                  {candidate.specification.styleCode} ·{" "}
                  {candidate.specification.boardGrade}
                </p>
              </div>
              <strong className="rounded-full bg-accent px-3 py-1 text-sm text-accent-contrast">
                {Math.round(candidate.score * 100)}%
              </strong>
            </div>
            <details className="mt-3">
              <summary className="min-h-touch cursor-pointer py-2 font-semibold text-text">
                {t("reviewAndConfirmCandidate")}
              </summary>
              <EntityWriteForm
                mutationRef={confirmSimilarDesignRef}
                legend={t("confirmSimilar")}
                description={t("confirmSimilarDetail")}
                submitLabel={t("confirmReuse")}
                requiredMessage={t("requiredField")}
                fields={[
                  {
                    name: "designRequestId",
                    label: t("designRequestId"),
                    kind: "text",
                    required: true,
                    monospace: true,
                    initialValue: designRequestId,
                  },
                  {
                    name: "masterCardRevisionId",
                    label: t("masterCardRevisionId"),
                    kind: "text",
                    required: true,
                    monospace: true,
                    initialValue: candidate.masterCardRevisionId,
                  },
                  {
                    name: "reason",
                    label: t("confirmationReason"),
                    kind: "textarea",
                    required: true,
                  },
                ]}
                toArgs={(values, requestId) => ({
                  requestId,
                  designRequestId: values.designRequestId ?? "",
                  masterCardRevisionId: values.masterCardRevisionId ?? "",
                  reason: values.reason ?? "",
                })}
              />
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
