"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import {
  ChartNoAxesColumn,
  ChevronRight,
  CircleCheck,
  Clock,
  DollarSign,
  ImageIcon,
  Info,
  ScanText,
  Search,
  ShieldCheck,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import type { Feature } from "../../../convex/model/aiUsage/usage";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { UsageEstimate } from "@/lib/aiUsage/estimateSources";
import type { UsageFormat } from "./format";
import {
  automaticEstimate,
  costState,
  filteredTotal,
  type Metrics,
  type Report,
  type UsageTotal,
} from "./report";

type Tone = "accent" | "teal" | "amber";

const TONES: Readonly<Record<Tone, string>> = {
  accent:
    "border border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  teal: "border border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  amber: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
};

export const FEATURE_ICONS: Readonly<
  Record<Feature, { icon: LucideIcon; tone: Tone }>
> = {
  JOB_TICKET_SCAN: { icon: ImageIcon, tone: "accent" },
  LOCATION_LABEL_SCAN: { icon: ScanText, tone: "accent" },
  AI_SEARCH: { icon: Search, tone: "amber" },
};

function IconDisc({
  icon: Icon,
  tone,
  size = "lg",
}: {
  readonly icon: LucideIcon;
  readonly tone: Tone;
  readonly size?: "lg" | "md";
}) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full ${TONES[tone]} ${
        size === "lg"
          ? "size-6 min-[480px]:size-9 sm:size-14"
          : "size-10 sm:size-11"
      }`}
    >
      <Icon
        className={
          size === "lg" ? "size-4 min-[480px]:size-5 sm:size-6" : "size-5"
        }
      />
    </span>
  );
}

/** Confirmed and pending coverage; unknown is never shown as zero. */
function Coverage({
  value,
  compact = false,
}: {
  readonly value: Pick<
    UsageTotal,
    "attemptCount" | "unknownAttemptCount" | "pendingCount"
  >;
  readonly compact?: boolean;
}) {
  const t = useTranslations("AiUsage");
  const state = costState(value);
  const line = compact
    ? "flex items-center gap-1 text-xs"
    : "flex items-start gap-1.5 text-[0.6875rem] min-[480px]:text-xs sm:text-base";
  const icon = compact ? "size-3.5 shrink-0" : "mt-0.5 size-4 shrink-0";
  // Spans only: the compact form sits inside a feature button.
  return (
    <span className="block min-w-0 space-y-1">
      {state === "NONE" ? (
        compact ? null : (
          <span className={`${line} text-muted`}>{t("noCalls")}</span>
        )
      ) : state === "CONFIRMED" ? (
        compact ? null : (
          <span className={`${line} font-medium text-success`}>
            <CircleCheck aria-hidden="true" className={icon} />
            <span>{t("allConfirmed")}</span>
          </span>
        )
      ) : (
        <span className={`${line} font-medium text-warning`}>
          <TriangleAlert aria-hidden="true" className={icon} />
          <span>{t("unknown", { count: value.unknownAttemptCount })}</span>
        </span>
      )}
      {value.pendingCount ? (
        <span className={`${line} font-medium text-pending`}>
          <Clock aria-hidden="true" className={icon} />
          <span>{t("pending", { count: value.pendingCount })}</span>
        </span>
      ) : null}
    </span>
  );
}

function StatementColumn({
  icon,
  tone,
  label,
  children,
}: {
  readonly icon: LucideIcon;
  readonly tone: Tone;
  readonly label: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-1.5 px-2 first:pl-0 last:pr-0 min-[480px]:gap-2 sm:items-center sm:gap-4 sm:px-5 lg:px-8">
      <IconDisc icon={icon} tone={tone} />
      <div className="min-w-0 flex-1">
        <div className="text-[0.6875rem] leading-snug text-muted min-[480px]:text-xs sm:text-sm">
          {label}
        </div>
        {children}
      </div>
    </div>
  );
}

const VALUE =
  "mt-0.5 text-sm leading-tight font-semibold wrap-anywhere text-text tabular-nums sm:mt-1 sm:text-2xl";
const SUB =
  "mt-1 text-[0.6875rem] leading-relaxed sm:text-xs wrap-anywhere text-muted tabular-nums";

/**
 * The period statement for the features shown, as three open columns: the
 * confirmed provider USD with its baht equivalent, the estimated total with
 * the funding fee estimate labelled separately, and cost coverage.
 */
export function UsageStatement({
  report,
  features,
  filterCount,
  estimate,
  format,
}: {
  readonly report: Report;
  readonly features: readonly Feature[];
  readonly filterCount: number;
  /** Undefined while the automatic estimate is still loading. */
  readonly estimate: UsageEstimate | null | undefined;
  readonly format: UsageFormat;
}) {
  const t = useTranslations("AiUsage");
  const total = filteredTotal(report.byFeature, features);
  const state = costState(total);
  const thb =
    state === "UNCONFIRMED"
      ? null
      : automaticEstimate(total.knownCostUsdNano, estimate ?? null);
  const fee =
    estimate && estimate.funding.status !== "UNAVAILABLE"
      ? estimate.funding.value.percent
      : null;
  return (
    <section
      aria-label={t("statement")}
      className="grid grid-cols-3 divide-x divide-border border-b border-border pb-5 sm:pb-6"
    >
      <StatementColumn icon={DollarSign} tone="accent" label={t("cost")}>
        <p className={VALUE}>
          {state === "UNCONFIRMED" ? (
            <span className="text-warning">{t("costUnconfirmed")}</span>
          ) : (
            format.usd(total.knownCostUsdNano)
          )}
        </p>
        {thb ? <p className={SUB}>≈ {format.baht(thb.inference)}</p> : null}
        <p
          className={
            state === "NONE" && !filterCount
              ? "sr-only"
              : "mt-0.5 text-xs leading-relaxed text-muted"
          }
        >
          {filterCount
            ? t("scopeFiltered", { count: filterCount })
            : t("scopeAll")}
        </p>
      </StatementColumn>
      <StatementColumn
        icon={ChartNoAxesColumn}
        tone="teal"
        label={t("estimatedTotal")}
      >
        {thb && thb.withFundingFee !== null && thb.fundingFee !== null ? (
          <>
            <p className={VALUE}>≈ {format.baht(thb.withFundingFee)}</p>
            <p className={SUB}>
              {state === "NONE"
                ? t("estimateFeeIncluded", { percent: format.num(fee ?? 0, 1) })
                : t("estimateParts", {
                    inference: format.num(thb.inference, 4),
                    percent: format.num(fee ?? 0, 2),
                    fee: format.num(thb.fundingFee, 4),
                  })}
            </p>
          </>
        ) : thb ? (
          // A rate without a published fee: no total is claimed. The baht
          // equivalent of confirmed USD stays under the first column.
          <>
            <p className={`${VALUE} text-muted`}>{t("notEstimated")}</p>
            <p className={SUB}>{t("estimateNoFee")}</p>
          </>
        ) : (
          <>
            <p className={`${VALUE} text-muted`}>{t("notEstimated")}</p>
            <p className={SUB}>
              {estimate === undefined
                ? t("estimateLoading")
                : state === "UNCONFIRMED"
                  ? t("estimateUnconfirmed")
                  : t("noRate")}
            </p>
          </>
        )}
        {estimate &&
        (estimate.fx.status === "STALE" ||
          estimate.funding.status === "STALE") ? (
          <p className={`${SUB} text-warning`}>{t("estimateStale")}</p>
        ) : null}
      </StatementColumn>
      <StatementColumn
        icon={ShieldCheck}
        tone="teal"
        label={
          <span className="inline-flex flex-wrap items-center gap-x-0.5">
            {t("coverage")}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={t("coverageHelpLabel")}
                    className="-my-1 inline-flex size-6 items-center justify-center rounded-full text-muted hover:text-text focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <Info aria-hidden="true" className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t("coverageHelp")}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </span>
        }
      >
        <div className="mt-1">
          <Coverage value={total} />
        </div>
      </StatementColumn>
    </section>
  );
}

/**
 * Photo and search counts in one strip (one row each on phones). Each entry
 * applies, or clears, its feature filter. Counts are never combined, and
 * retries add provider calls, never photos.
 */
export function FeatureStrip({
  report,
  features,
  selected,
  onSelect,
  featureLabel,
  format,
}: {
  readonly report: Report;
  readonly features: readonly Feature[];
  readonly selected: "" | Feature;
  readonly onSelect: (feature: "" | Feature) => void;
  readonly featureLabel: (feature: Feature) => string;
  readonly format: UsageFormat;
}) {
  const t = useTranslations("AiUsage");
  return (
    <section
      aria-label={t("featureStrip")}
      className="grid divide-y divide-border border-b border-border sm:grid-cols-3 sm:divide-x sm:divide-y-0"
    >
      {features.map((kind) => (
        <FeatureEntry
          key={kind}
          kind={kind}
          label={featureLabel(kind)}
          value={report.byFeature[kind]}
          pressed={selected === kind}
          onPress={() => onSelect(selected === kind ? "" : kind)}
          action={t(selected === kind ? "featureShowAll" : "featureShowOnly")}
          format={format}
        />
      ))}
    </section>
  );
}

function FeatureEntry({
  kind,
  label,
  value: m,
  pressed,
  onPress,
  action,
  format,
}: {
  readonly kind: Feature;
  readonly label: string;
  readonly value: Metrics;
  readonly pressed: boolean;
  readonly onPress: () => void;
  readonly action: string;
  readonly format: UsageFormat;
}) {
  const t = useTranslations("AiUsage");
  const { icon, tone } = FEATURE_ICONS[kind];
  const search = kind === "AI_SEARCH";
  const used = m.operationCount > 0 || m.attemptCount > 0;
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={action}
      onClick={onPress}
      data-testid={`usage-feature-${kind}`}
      className={`group grid min-h-touch min-w-0 grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-0.5 py-3 text-left transition-colors hover:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-x-4 sm:px-5 sm:py-5 sm:first:pl-0 lg:px-8 ${
        pressed ? "bg-accent-surface/60" : ""
      }`}
    >
      <span className="col-start-1 row-span-2 row-start-1 sm:row-span-3">
        <IconDisc icon={icon} tone={tone} size="md" />
      </span>
      <span className="col-start-2 row-start-1 text-sm font-medium break-words text-text sm:font-normal sm:text-muted">
        {label}
      </span>
      <span className="col-start-3 row-span-2 row-start-1 text-lg font-semibold text-text tabular-nums sm:col-start-2 sm:row-span-1 sm:row-start-2 sm:text-2xl sm:leading-tight">
        <span aria-hidden="true">{format.num(m.operationCount)}</span>
        <span className="sr-only">
          {t(search ? "unitSearches" : "unitPhotos", {
            count: m.operationCount,
          })}
        </span>
      </span>
      <span className="col-start-2 row-start-2 min-w-0 text-xs leading-relaxed text-muted tabular-nums sm:row-start-3">
        {used ? (
          <>
            <span className="block">
              {t("callsRetries", {
                calls: m.attemptCount,
                retries: m.attemptCount - m.operationCount,
              })}
              {" · "}
              {costState(m) === "UNCONFIRMED" ? (
                <span className="text-warning">{t("costUnconfirmed")}</span>
              ) : (
                format.usd(m.knownCostUsdNano)
              )}
            </span>
            <span className="block">
              {t(search ? "averageSearch" : "averagePhoto")}{" "}
              {m.completeOperationCount
                ? format.usd(m.completeCostUsdNano / m.completeOperationCount)
                : "—"}
              {" · "}
              {t("averageBasis", { count: m.completeOperationCount })}
            </span>
            <Coverage value={m} compact />
          </>
        ) : (
          <span className="sr-only">{t("featureEmpty")}</span>
        )}
      </span>
      <ChevronRight
        aria-hidden="true"
        className="col-start-4 row-span-2 row-start-1 size-5 text-muted transition-transform group-hover:translate-x-0.5 sm:col-start-3 sm:row-span-3"
      />
      <span className="sr-only">{action}</span>
    </button>
  );
}
