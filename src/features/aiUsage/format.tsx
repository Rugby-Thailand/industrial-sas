"use client";

import { useLocale } from "next-intl";
import type { ReactNode } from "react";

import { configuredEstimate, type Settings } from "./report";

/** Locale-aware number, USD and baht presentation for the usage report. */
export function useUsageFormat(settings: Settings) {
  const locale = useLocale();
  const num = (value: number, digits = 0) =>
    new Intl.NumberFormat(locale, {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    }).format(value);
  const usd = (nano: number) =>
    `US$${new Intl.NumberFormat(locale, { minimumFractionDigits: 6, maximumFractionDigits: 9 }).format(nano / 1e9)}`;
  const baht = (value: number) => `฿${num(value, 4)}`;
  /** Confirmed USD with the inference-only baht estimate, when configured. */
  const money = (nano: number): ReactNode => {
    const estimate = configuredEstimate(nano, settings);
    return (
      <>
        <span>{usd(nano)}</span>
        {estimate ? (
          <span className="block text-xs text-muted">
            ≈ {baht(estimate.inference)}
          </span>
        ) : null}
      </>
    );
  };
  return { num, usd, baht, money };
}
