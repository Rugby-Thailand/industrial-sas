"use client";

import { useLocale, useTranslations } from "next-intl";

/** Floor footprint only; stock and pallet reservations do not affect this chart. */
export function AreaOverview({
  grossAreaSqMm,
  usableAreaSqMm,
}: {
  readonly grossAreaSqMm: number;
  readonly usableAreaSqMm: number;
}) {
  const t = useTranslations("StorageLayouts");
  const locale = useLocale();
  const gross = Number.isFinite(grossAreaSqMm) ? Math.max(0, grossAreaSqMm) : 0;
  const usable = Number.isFinite(usableAreaSqMm)
    ? Math.max(0, Math.min(gross, usableAreaSqMm))
    : 0;
  const ratio = gross === 0 ? 0 : usable / gross;
  // Rounding must not imply a partially blocked floor is entirely usable (or vice versa).
  const percentage =
    ratio === 0 || ratio === 1
      ? ratio * 100
      : Math.max(0.1, Math.min(99.9, Math.round(ratio * 1000) / 10));
  const format = new Intl.NumberFormat(locale, { maximumSignificantDigits: 4 });
  const percent = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
  }).format(percentage);
  const summary = t("areaOverview", {
    usable: format.format(usable / 1_000_000),
    blocked: format.format((gross - usable) / 1_000_000),
  });

  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="relative size-16 shrink-0" aria-hidden="true">
        <svg viewBox="0 0 64 64" className="size-full -rotate-90">
          <circle
            cx="32"
            cy="32"
            r="27"
            fill="none"
            strokeWidth="6"
            className={gross === 0 ? "stroke-border" : "stroke-warning"}
          />
          <circle
            cx="32"
            cy="32"
            r="27"
            fill="none"
            strokeWidth="6"
            pathLength="100"
            strokeDasharray={`${ratio * 100} 100`}
            className="stroke-success"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-text tabular-nums">
          {percent}%
        </span>
      </div>
      <div className="min-w-0 text-sm">
        <p className="font-medium text-text">
          {t("usableArea")}
          <span className="sr-only">: {percent}%</span>
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted">{summary}</p>
      </div>
    </div>
  );
}
