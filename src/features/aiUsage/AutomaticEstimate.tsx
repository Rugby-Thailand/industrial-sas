"use client";

import { ExternalLink } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import {
  FUNDING_SOURCE_DOCS,
  FX_SOURCE_DOCS,
  type SourceState,
  type UsageEstimate,
} from "@/lib/aiUsage/estimateSources";
import type { UsageFormat } from "./format";

/**
 * The read-only automatic estimate inputs: the daily USD/THB reference rate
 * and OpenRouter's published card funding policy, each with its source,
 * date and status. Nothing here is user-entered or saved.
 */
export function AutomaticEstimate({
  estimate,
  format,
  timezone,
}: {
  /** Undefined while loading. */
  readonly estimate: UsageEstimate | undefined;
  readonly format: UsageFormat;
  readonly timezone: string;
}) {
  const t = useTranslations("AiUsage");
  const locale = useLocale();
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  });
  const state = (source: SourceState<{ fetchedAt: number }> | undefined) =>
    !source ? (
      <span className="text-muted">{t("estimateLoading")}</span>
    ) : source.status === "UNAVAILABLE" ? (
      <span className="font-medium text-warning">{t("sourceUnavailable")}</span>
    ) : source.status === "STALE" ? (
      <span className="font-medium text-warning">
        {t("sourceStale", { time: when.format(source.value.fetchedAt) })}
      </span>
    ) : (
      <span className="text-success">
        {t("sourceReady", { time: when.format(source.value.fetchedAt) })}
      </span>
    );
  const link = (href: string, label: string) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-link underline-offset-4 hover:underline"
    >
      {label}
      <ExternalLink aria-hidden="true" className="size-3" />
      <span className="sr-only">{t("opensInNewTab")}</span>
    </a>
  );
  const fx = estimate?.fx,
    funding = estimate?.funding;
  return (
    <section
      aria-labelledby="usage-estimate"
      aria-busy={estimate === undefined}
      className="space-y-3"
      data-testid="usage-estimate"
    >
      <h2 id="usage-estimate" className="text-lg font-semibold sm:text-xl">
        {t("estimateTitle")}
      </h2>
      <dl className="grid grid-cols-3 gap-3 text-xs sm:gap-6 sm:text-sm">
        <div className="min-w-0 space-y-1">
          <dt className="text-muted">{t("estimateRateLabel")}</dt>
          <dd className="text-base font-semibold tabular-nums sm:text-lg">
            {fx && fx.status !== "UNAVAILABLE"
              ? format.num(fx.value.rate, 4)
              : "—"}
          </dd>
          <dd className="text-xs leading-relaxed text-muted">
            {fx && fx.status !== "UNAVAILABLE"
              ? t("rateDate", { date: fx.value.date })
              : null}{" "}
            {link(FX_SOURCE_DOCS, "Frankfurter")}
          </dd>
          <dd className="text-xs">{state(fx)}</dd>
        </div>
        <div className="min-w-0 space-y-1">
          <dt className="text-muted">{t("estimateFeeLabel")}</dt>
          <dd className="text-base font-semibold tabular-nums sm:text-lg">
            {funding && funding.status !== "UNAVAILABLE"
              ? `${format.num(funding.value.percent, 1)}%`
              : "—"}
          </dd>
          <dd className="text-xs leading-relaxed text-muted">
            {funding && funding.status !== "UNAVAILABLE"
              ? t("feeMinimum", {
                  minimum: format.num(funding.value.minimumUsd, 2),
                })
              : null}{" "}
            {link(FUNDING_SOURCE_DOCS, t("fundingSourceName"))}
          </dd>
          <dd className="text-xs">{state(funding)}</dd>
        </div>
        <div className="min-w-0 space-y-1">
          <dt className="text-muted">{t("estimateSnapshotLabel")}</dt>
          <dd className="text-xs tabular-nums sm:text-sm">
            {estimate ? when.format(estimate.loadedAt) : t("estimateLoading")}
          </dd>
          <dd className="text-xs leading-relaxed text-muted">
            {t("snapshotNote")}
          </dd>
        </div>
      </dl>
      <p className="max-w-prose text-xs leading-relaxed text-muted">
        {t("estimateNote")}
      </p>
    </section>
  );
}
