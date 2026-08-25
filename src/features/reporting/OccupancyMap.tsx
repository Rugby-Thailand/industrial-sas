"use client";

import { useTranslations } from "next-intl";

import { Notice } from "@/components/ui/Notice";
import type { OccupancyCell } from "@/lib/convex/reportingApi";

import { Occupancy } from "./ReportingSources";

import { EmptyState } from "@/components/ui/EmptyState";

export const MAP_COLUMNS = 6;

const BAND_CLASSES: Readonly<Record<string, string>> = Object.freeze({
  EMPTY: "bg-band-empty text-muted",
  LIGHT: "bg-band-light text-text",
  BUSY: "bg-band-busy text-text",
  FULL: "bg-band-full text-text",
});

export function OccupancyMap() {
  return (
    <Occupancy>
      {(answer) => (
        <OccupancyGrid cells={answer.cells} complete={answer.complete} />
      )}
    </Occupancy>
  );
}

function CapacityBar({
  counts,
  total,
  label,
}: {
  readonly counts: readonly { readonly band: string; readonly total: number }[];
  readonly total: number;
  readonly label: string;
}) {
  if (total === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-muted">{label}</p>
      <div
        aria-hidden="true"
        data-testid="occupancy-capacity-bar"
        className="flex h-3 w-full overflow-hidden rounded-full border border-border"
      >
        {counts
          .filter((entry) => entry.total > 0)
          .map((entry) => (
            <span
              key={entry.band}
              className={BAND_CLASSES[entry.band] ?? ""}
              style={{ width: `${(entry.total / total) * 100}%` }}
            />
          ))}
      </div>
    </div>
  );
}

export function OccupancyGrid({
  cells,
  complete,
}: {
  readonly cells: readonly OccupancyCell[];
  readonly complete: boolean;
}) {
  const t = useTranslations("Occupancy");
  const bandT = useTranslations("OccupancyBand");

  if (cells.length === 0) {
    return (
      <EmptyState
        title={t("empty")}
        body={t("emptyHint")}
        testId="occupancy-empty"
      />
    );
  }

  const rows: OccupancyCell[][] = [];
  for (let index = 0; index < cells.length; index += MAP_COLUMNS) {
    rows.push([...cells.slice(index, index + MAP_COLUMNS)]);
  }

  const counts = ["EMPTY", "LIGHT", "BUSY", "FULL"].map((band) => ({
    band,
    total: cells.filter((cell) => cell.band === band).length,
  }));
  return (
    <div className="flex flex-col gap-4" data-testid="occupancy-map">
      <CapacityBar counts={counts} total={cells.length} label={t("capacity")} />

      <ul className="flex flex-wrap gap-3" aria-label={t("legend")}>
        {counts.map((entry) => (
          <li
            key={entry.band}
            className="flex items-center gap-2 text-sm text-text"
          >
            <span
              aria-hidden="true"
              className={`inline-block h-4 w-4 rounded border border-border ${
                BAND_CLASSES[entry.band] ?? ""
              }`}
            />
            <span data-testid={`legend-${entry.band}`}>
              {bandT(entry.band)} · {entry.total}
            </span>
          </li>
        ))}
      </ul>

      {complete ? null : (
        <Notice
          tone="warning"
          title={t("partial")}
          body={t("partialHint")}
          testId="occupancy-partial"
        />
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="pb-2 text-left text-sm text-muted">
            {t("caption")}
          </caption>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={row[0]?.locationId ?? rowIndex}>
                {row.map((cell) => (
                  <td
                    key={cell.locationId}
                    data-testid={`occupancy-${cell.code}`}
                    className={`min-h-touch border border-border p-2 align-top ${
                      BAND_CLASSES[cell.band] ?? ""
                    }`}
                  >
                    <span className="block font-mono text-xs font-semibold">
                      {cell.code}
                    </span>
                    {/*
                     * The band as a word and the count as a number. Either alone
                     * would make colour load-bearing, which is the one thing a
                     * heat map must not do.
                     */}
                    <span className="block text-xs">{bandT(cell.band)}</span>
                    <span className="block font-mono text-xs tabular-nums">
                      {cell.distinctBuckets}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
