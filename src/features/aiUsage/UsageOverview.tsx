"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import {
  CircleCheck,
  Clock,
  ImageIcon,
  ScanLine,
  Search,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import type { Feature } from "../../../convex/model/aiUsage/usage";
import { Panel } from "@/components/ui/Panel";
import { StatusBadge } from "@/components/ui/StatusBadge";
import type { useUsageFormat } from "./format";
import {
  configuredEstimate,
  costState,
  filteredTotal,
  type Metrics,
  type Report,
  type UsageTotal,
} from "./report";

type Format = ReturnType<typeof useUsageFormat>;

const FEATURE_ICONS: Readonly<Record<Feature, LucideIcon>> = {
  JOB_TICKET_SCAN: ImageIcon,
  LOCATION_LABEL_SCAN: ScanLine,
  AI_SEARCH: Search,
};

/** Confirmed and pending coverage; unknown is never shown as zero. */
function Coverage({
  value,
}: {
  readonly value: Pick<
    UsageTotal,
    "attemptCount" | "unknownAttemptCount" | "pendingCount"
  >;
}) {
  const t = useTranslations("AiUsage");
  const state = costState(value);
  return (
    <div className="flex flex-wrap gap-2">
      {state === "NONE" ? (
        <StatusBadge tone="muted" label={t("noCalls")} />
      ) : state === "CONFIRMED" ? (
        <StatusBadge
          tone="success"
          icon={<CircleCheck className="size-3.5" />}
          label={t("allConfirmed")}
        />
      ) : (
        <StatusBadge
          tone="warning"
          icon={<TriangleAlert className="size-3.5" />}
          label={t("unknown", { count: value.unknownAttemptCount })}
        />
      )}
      {value.pendingCount ? (
        <StatusBadge
          tone="pending"
          icon={<Clock className="size-3.5" />}
          label={t("pending", { count: value.pendingCount })}
        />
      ) : null}
    </div>
  );
}

/** A confirmed amount, or an explicit "not yet confirmed" instead of zero. */
function ConfirmedCost({
  value,
  children,
}: {
  readonly value: Pick<
    UsageTotal,
    "attemptCount" | "unknownAttemptCount" | "knownCostUsdNano"
  >;
  readonly children: (nano: number) => ReactNode;
}) {
  const t = useTranslations("AiUsage");
  return costState(value) === "UNCONFIRMED" ? (
    <span className="text-warning">{t("costUnconfirmed")}</span>
  ) : (
    <>{children(value.knownCostUsdNano)}</>
  );
}

/**
 * The period statement for the features shown: confirmed provider USD, the
 * baht estimate from saved settings (inference and funding fee labelled
 * separately), and cost coverage.
 */
export function UsageStatement({
  report,
  features,
  filterCount,
  canConfigure,
  format,
}: {
  readonly report: Report;
  readonly features: readonly Feature[];
  readonly filterCount: number;
  readonly canConfigure: boolean;
  readonly format: Format;
}) {
  const t = useTranslations("AiUsage");
  const total = filteredTotal(report.byFeature, features);
  const state = costState(total);
  const estimate =
    state === "UNCONFIRMED"
      ? null
      : configuredEstimate(total.knownCostUsdNano, report.settings);
  return (
    <Panel
      aria-label={t("statement")}
      className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
    >
      <div className="min-w-0">
        <p className="text-sm text-muted">{t("cost")}</p>
        <p className="mt-2 text-2xl font-semibold wrap-anywhere tabular-nums">
          <ConfirmedCost value={total}>
            {(nano) => format.usd(nano)}
          </ConfirmedCost>
        </p>
        <p className="mt-1 text-xs text-muted">
          {filterCount
            ? t("scopeFiltered", { count: filterCount })
            : t("scopeAll")}
        </p>
      </div>
      <div className="min-w-0">
        <p className="text-sm text-muted">{t("withFee")}</p>
        {!report.settings ? (
          <>
            <p className="mt-2 text-2xl font-semibold text-muted">
              {t("notEstimated")}
            </p>
            <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted">
              {t(canConfigure ? "noFxAdmin" : "noFx")}
            </p>
          </>
        ) : estimate ? (
          <>
            <p className="mt-2 text-2xl font-semibold wrap-anywhere tabular-nums">
              ≈ {format.baht(estimate.withFundingFee)}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted tabular-nums">
              {t("estimateParts", {
                inference: format.num(estimate.inference, 4),
                percent: format.num(report.settings.feePercent, 2),
                fee: format.num(estimate.fundingFee, 4),
              })}
            </p>
            <p className="mt-1 text-xs leading-relaxed break-words text-muted">
              {t("estimateRate", {
                rate: format.num(report.settings.usdThbRate, 4),
                source: report.settings.source,
              })}
            </p>
          </>
        ) : (
          <>
            <p className="mt-2 text-2xl font-semibold text-muted">
              {t("notEstimated")}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              {t(
                state === "UNCONFIRMED"
                  ? "estimateUnconfirmed"
                  : "estimateUnavailable",
              )}
            </p>
          </>
        )}
      </div>
      <div className="min-w-0 space-y-2 md:border-l md:border-border md:pl-5">
        <p className="text-sm text-muted">{t("coverage")}</p>
        <Coverage value={total} />
      </div>
    </Panel>
  );
}

/** One card per shown feature; photo and search counts are never combined. */
export function FeatureCards({
  report,
  features,
  featureLabel,
  format,
}: {
  readonly report: Report;
  readonly features: readonly Feature[];
  readonly featureLabel: (feature: Feature) => string;
  readonly format: Format;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {features.map((kind) => (
        <FeatureCard
          key={kind}
          kind={kind}
          label={featureLabel(kind)}
          value={report.byFeature[kind]}
          format={format}
        />
      ))}
    </div>
  );
}

function FeatureCard({
  kind,
  label,
  value: m,
  format,
}: {
  readonly kind: Feature;
  readonly label: string;
  readonly value: Metrics;
  readonly format: Format;
}) {
  const t = useTranslations("AiUsage");
  const Icon = FEATURE_ICONS[kind],
    search = kind === "AI_SEARCH";
  const headingId = `usage-feature-${kind}`;
  return (
    <Panel aria-labelledby={headingId} className="min-w-0 space-y-4">
      <h2 id={headingId} className="flex items-center gap-2 font-semibold">
        <Icon className="size-4 shrink-0 text-muted" aria-hidden="true" />
        {label}
      </h2>
      {m.operationCount === 0 && m.attemptCount === 0 ? (
        <p className="text-sm leading-relaxed text-muted">
          {t("featureEmpty")}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="text-sm text-muted tabular-nums">
              {t.rich(search ? "countSearches" : "countPhotos", {
                count: m.operationCount,
                n: (chunks) => (
                  <span className="text-2xl font-semibold text-text">
                    {chunks}
                  </span>
                ),
              })}
            </p>
            <p className="text-xs text-muted tabular-nums">
              {t("callsRetries", {
                calls: m.attemptCount,
                retries: m.attemptCount - m.operationCount,
              })}
            </p>
          </div>
          <div className="text-sm tabular-nums">
            <p className="mb-1 text-xs text-muted">{t("cost")}</p>
            <div className="font-medium wrap-anywhere">
              <ConfirmedCost value={m}>{format.money}</ConfirmedCost>
            </div>
          </div>
          <div className="border-t border-border pt-4 text-sm tabular-nums">
            <p className="mb-1 text-xs text-muted">
              {t(search ? "averageSearch" : "averagePhoto")} ·{" "}
              {t("averageBasis", { count: m.completeOperationCount })}
            </p>
            <div className="font-medium wrap-anywhere">
              {m.completeOperationCount ? (
                format.money(m.completeCostUsdNano / m.completeOperationCount)
              ) : (
                <span className="text-muted">—</span>
              )}
            </div>
          </div>
          <Coverage value={m} />
        </>
      )}
    </Panel>
  );
}
