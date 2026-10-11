"use client";

import { ChevronDown, ExternalLink } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import {
  FUNDING_SOURCE_DOCS,
  FX_SOURCE_DOCS,
  type SourceState,
  type UsageEstimate,
} from "@/lib/aiUsage/estimateSources";

import type { UsageFormat } from "./format";

type EstimateProps = {
  /** Undefined while loading. */
  readonly estimate: UsageEstimate | undefined;
  readonly format: UsageFormat;
  readonly timezone: string;
};

/**
 * The read-only automatic estimate inputs: the daily USD/THB reference rate
 * and OpenRouter's published card funding policy, each with its source,
 * date and status. Nothing here is user-entered or saved.
 */
export function AutomaticEstimate({
  estimate,
  format,
  timezone,
}: EstimateProps) {
  const t = useTranslations("AiUsage");
  const [open, setOpen] = useState(false);
  return (
    <section
      aria-labelledby="usage-estimate"
      aria-busy={estimate === undefined}
      data-testid="usage-estimate"
    >
      <details
        className="group"
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-sm text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          <h2 id="usage-estimate" className="text-sm font-medium">
            {t("estimateTitle")}
          </h2>
          <ChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 group-open:rotate-180"
          />
        </summary>
        {open ? (
          <EstimateDetails
            estimate={estimate}
            format={format}
            timezone={timezone}
          />
        ) : null}
      </details>
    </section>
  );
}

/** Formatting and source presentation are only needed while expanded. */
function EstimateDetails({ estimate, format, timezone }: EstimateProps) {
  const t = useTranslations("AiUsage");
  const formatter = useFormatter();
  const when = (time: number) =>
    formatter.dateTime(time, {
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
        {t("sourceStale", { time: when(source.value.fetchedAt) })}
      </span>
    ) : (
      <span className="text-success">
        {t("sourceReady", { time: when(source.value.fetchedAt) })}
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
  const sources = [
    {
      label: t("estimateRateLabel"),
      value:
        fx && fx.status !== "UNAVAILABLE" ? format.num(fx.value.rate, 4) : "—",
      detail:
        fx && fx.status !== "UNAVAILABLE"
          ? t("rateDate", { date: fx.value.date })
          : null,
      href: FX_SOURCE_DOCS,
      name: "Frankfurter",
      source: fx,
    },
    {
      label: t("estimateFeeLabel"),
      value:
        funding && funding.status !== "UNAVAILABLE"
          ? `${format.num(funding.value.percent, 1)}%`
          : "—",
      detail:
        funding && funding.status !== "UNAVAILABLE"
          ? t("feeMinimum", {
              minimum: format.num(funding.value.minimumUsd, 2),
            })
          : null,
      href: FUNDING_SOURCE_DOCS,
      name: t("fundingSourceName"),
      source: funding,
    },
  ];
  return (
    <div className="space-y-4 pt-3">
      <dl className="grid gap-4 text-sm sm:grid-cols-3 sm:gap-6">
        {sources.map(({ label, value, detail, href, name, source }) => (
          <div key={href} className="min-w-0 space-y-1">
            <dt className="text-muted">{label}</dt>
            <dd className="text-base font-semibold tabular-nums sm:text-lg">
              {value}
            </dd>
            <dd className="text-xs leading-relaxed text-muted">
              {detail} {link(href, name)}
            </dd>
            <dd className="text-xs">{state(source)}</dd>
          </div>
        ))}
        <div className="min-w-0 space-y-1">
          <dt className="text-muted">{t("estimateSnapshotLabel")}</dt>
          <dd className="text-xs tabular-nums sm:text-sm">
            {estimate ? when(estimate.loadedAt) : t("estimateLoading")}
          </dd>
          <dd className="text-xs leading-relaxed text-muted">
            {t("snapshotNote")}
          </dd>
        </div>
      </dl>
      <p className="max-w-prose text-xs leading-relaxed text-muted">
        {t("estimateNote")}
      </p>
    </div>
  );
}
