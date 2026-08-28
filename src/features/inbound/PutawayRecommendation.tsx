"use client";

import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";

import { DataTable } from "@/components/table/DataTable";
import { useAppEnvironment } from "@/components/providers/EnvironmentProvider";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { Notice } from "@/components/ui/Notice";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  recommendPutawayLocationsRef,
  type PutawayRecommendationOutcome,
  type RankedLocation,
  type RejectedLocation,
} from "@/lib/convex/inboundApi";
import { resolveLedgerGate } from "@/lib/convex/ledgerState";
import { codeLabel, type CodeTranslator } from "@/lib/domainLabels";

export function PutawayRecommendationPanel({
  warehouseId,
  putawayTaskId,
}: {
  readonly warehouseId: string;
  readonly putawayTaskId: string;
}) {
  const environment = useAppEnvironment();
  const gate = resolveLedgerGate(environment, warehouseId, "WAREHOUSE");

  if (gate.kind !== "READY_TO_QUERY") return <LedgerPanelStatus state={gate} />;
  return (
    <ServerRecommendation
      warehouseId={warehouseId}
      putawayTaskId={putawayTaskId}
    />
  );
}

function ServerRecommendation({
  warehouseId,
  putawayTaskId,
}: {
  readonly warehouseId: string;
  readonly putawayTaskId: string;
}) {
  const outcome = useQuery(recommendPutawayLocationsRef, {
    warehouseId,
    putawayTaskId,
  });

  if (outcome === undefined) {
    return <LedgerPanelStatus state={{ kind: "LOADING" }} />;
  }
  if (!outcome.ok) {
    return (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: outcome.requestId }}
      />
    );
  }
  return <RecommendationBody outcome={outcome.value} />;
}

function RecommendationBody({
  outcome,
}: {
  readonly outcome: PutawayRecommendationOutcome;
}) {
  const t = useTranslations("Putaway");
  const reasonT = useTranslations(
    "PutawayFilterReason",
  ) as unknown as CodeTranslator;
  const componentT = useTranslations(
    "PutawayScoreComponent",
  ) as unknown as CodeTranslator;

  if (!outcome.ok) {
    return (
      <Notice
        tone="warning"
        title={t("noTaskSelected")}
        body={t("noTaskSelectedHint")}
        testId="recommendation-unavailable"
      >
        <code className="rounded bg-raised px-2 py-1 font-mono text-xs">
          {outcome.error.code}
        </code>
      </Notice>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="putaway-recommendation">
      <p className="text-sm text-muted">
        {t("filtersApplied", { filters: outcome.filtersApplied.join(", ") })}
      </p>

      <DataTable<RankedLocation>
        testId="table-recommendation-ranked"
        caption={t("recommendationCaption", { count: outcome.ranked.length })}
        rows={outcome.ranked}
        rowKey={(row) => row.locationId}
        columns={[
          {
            key: "code",
            header: t("columnLocation"),
            rowHeader: true,
            render: (row) => row.code,
          },
          {
            key: "score",
            header: t("columnScore"),
            monospace: true,
            render: (row) => String(row.score),
          },
          {
            key: "components",
            header: t("columnComponents"),

            render: (row) => (
              <ul className="flex flex-col gap-1">
                {row.components.map((component) => (
                  <li key={component.name} className="text-xs">
                    {t("componentPoints", {
                      name: codeLabel(componentT, component.name),
                      points: component.points,
                      weight: component.weight,
                    })}
                  </li>
                ))}
                {row.viaOverflow ? (
                  <li>
                    <StatusBadge tone="warning" label={t("overflowBadge")} />
                  </li>
                ) : null}
              </ul>
            ),
          },
        ]}
      />

      {outcome.rejected.length === 0 ? null : (
        <DataTable<RejectedLocation>
          testId="table-recommendation-rejected"
          caption={t("rejectedCaption", { count: outcome.rejected.length })}
          rows={outcome.rejected}
          rowKey={(row) => row.locationId}
          columns={[
            {
              key: "code",
              header: t("columnLocation"),
              rowHeader: true,
              render: (row) => row.code,
            },
            {
              key: "reason",
              header: t("columnReason"),
              // Translated, because this is the sentence that answers "why is my
              // bin not in the list?" — the question the panel exists for.
              render: (row) => codeLabel(reasonT, row.reason),
            },
          ]}
        />
      )}
    </div>
  );
}
