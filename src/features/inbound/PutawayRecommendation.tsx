"use client";

/**
 * Why this bin — shown as arithmetic, not as a number to be trusted.
 *
 * `ADR-0007` §13 and D-14 both require the recommendation to be *explainable* to
 * an operator or an auditor. That means three things on the screen, and this
 * panel exists because all three have to be visible at once:
 *
 * 1. **The ranked locations, with their score components.** Each component names
 *    the rule, its weight, and the points it contributed, and the components sum
 *    to the score. Somebody can check it.
 * 2. **The locations that were filtered out, and why.** A bin the operator
 *    expected to see is the question the panel most often has to answer, and
 *    "it is not in the list" is not an answer.
 * 3. **The filters that ran.** So a missing rejection means "this filter did not
 *    reject anything" rather than "this filter did not run".
 */
import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";

import { EntityTable } from "@/components/masterData/EntityTable";
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
import { previewRecommendation } from "@/lib/preview/inboundPreview";

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
  if (environment.previewMode) {
    return <RecommendationBody outcome={previewRecommendation()} />;
  }
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
    /*
     * `NO_CANDIDATE_LOCATIONS` and `ALL_CANDIDATES_FILTERED` are different
     * problems — "the warehouse has no bins" and "every bin was ruled out" send
     * a supervisor to different screens — so the code is shown rather than
     * flattened into "no recommendation".
     */
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

      <EntityTable<RankedLocation>
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
            /*
             * A list rather than a total, and each entry states the weight it
             * was scored against. The whole point of an explainable
             * recommendation is that the arithmetic can be checked.
             */
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
        <EntityTable<RejectedLocation>
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
