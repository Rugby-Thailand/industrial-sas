"use client";

import { sceneColors } from "@/components/storageScene/sceneColors";
import { useLocale } from "next-intl";

/** Physical floor footprint; stored and held footprints are disjoint unions. */
export function AreaOverview({
  grossAreaSqMm,
  usableAreaSqMm,
  storedFootprintAreaSqMm = 0,
  heldFootprintAreaSqMm = 0,
}: {
  readonly grossAreaSqMm: number;
  readonly usableAreaSqMm: number;
  readonly storedFootprintAreaSqMm?: number;
  readonly heldFootprintAreaSqMm?: number;
}) {
  const locale = useLocale();
  const th = locale === "th";
  const finite = (n: number) => (Number.isFinite(n) ? Math.max(0, n) : 0);
  const gross = finite(grossAreaSqMm);
  const usable = Math.min(gross, finite(usableAreaSqMm));
  const stored = Math.min(usable, finite(storedFootprintAreaSqMm));
  const held = Math.min(usable - stored, finite(heldFootprintAreaSqMm));
  const free = usable - stored - held;
  const ratio = gross === 0 ? 0 : free / gross;
  const percentage =
    ratio === 0 || ratio === 1
      ? ratio * 100
      : Math.max(0.1, Math.min(99.9, Math.round(ratio * 1000) / 10));
  const format = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const percent = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
  }).format(percentage);
  const unit = th ? "ตร.ม." : "m²";
  const label = th ? "พื้นที่ว่างคงเหลือ" : "Remaining floor space";
  const segments = [
    { value: free, color: sceneColors.free, label: th ? "ว่าง" : "Free" },
    {
      value: stored,
      color: sceneColors.stored,
      label: th ? "จัดเก็บแล้ว" : "Stored",
    },
    {
      value: held,
      color: sceneColors.reserved,
      label: th ? "จองแล้ว" : "Reserved",
    },
    {
      value: gross - usable,
      color: sceneColors.unavailable,
      label: th ? "ใช้งานไม่ได้" : "Unavailable",
    },
  ];
  const description = segments
    .map((s) => `${s.label} ${format.format(s.value / 1_000_000)} ${unit}`)
    .join(" · ");
  let offset = 0;
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="relative size-16 shrink-0" title={description}>
        <svg
          viewBox="0 0 64 64"
          className="size-full -rotate-90"
          role="img"
          aria-label={description}
        >
          <circle
            cx="32"
            cy="32"
            r="27"
            fill="none"
            strokeWidth="6"
            className="stroke-border"
          />
          {segments.map((segment) => {
            const length = gross > 0 ? (segment.value / gross) * 100 : 0;
            const start = offset;
            offset += length;
            return (
              <circle
                key={segment.label}
                cx="32"
                cy="32"
                r="27"
                fill="none"
                strokeWidth="6"
                pathLength="100"
                stroke={segment.color}
                strokeDasharray={`${length} 100`}
                strokeDashoffset={-start}
              />
            );
          })}
        </svg>
        <span
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-text tabular-nums"
        >
          {percent}%
        </span>
      </div>
      <div className="min-w-0 text-sm">
        <p className="font-medium text-text">
          {label}
          <span className="sr-only">: {percent}%</span>
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          {th ? "ว่าง" : "Free"} {format.format(free / 1_000_000)} {unit}
        </p>
      </div>
    </div>
  );
}
