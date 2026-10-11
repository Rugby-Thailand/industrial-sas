"use client";

import { useFormatter } from "next-intl";

import type { UsageEstimate } from "@/lib/aiUsage/estimateSources";
import { automaticEstimate } from "./report";

/**
 * Locale-aware number, USD and baht presentation for the usage report. USD
 * keeps nano precision (up to nine decimals, at least two); baht estimates
 * use four decimals so sub-satang costs stay visible.
 */
export function useUsageFormat(estimate: UsageEstimate | null) {
  const formatter = useFormatter();
  const num = (value: number, digits = 0) =>
    formatter.number(value, {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    });
  const usd = (nano: number) =>
    `US$${formatter.number(nano / 1e9, { minimumFractionDigits: 2, maximumFractionDigits: 9 })}`;
  const baht = (value: number) => `฿${num(value, 4)}`;
  /** The inference-only baht estimate of a confirmed amount, if a rate exists. */
  const thb = (nano: number): string | null => {
    const value = automaticEstimate(nano, estimate);
    return value ? `≈ ${baht(value.inference)}` : null;
  };
  return { num, usd, baht, thb };
}

export type UsageFormat = ReturnType<typeof useUsageFormat>;
