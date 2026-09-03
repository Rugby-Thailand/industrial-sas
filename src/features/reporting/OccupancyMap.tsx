"use client";

import { useFormatter, useTranslations } from "next-intl";

import { Notice } from "@/components/ui/Notice";
import { Progress } from "@/components/ui/progress";
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

function utilizationTone(percent: number): string {
  if (percent >= 90) {
    return "bg-danger/20 *:data-[slot=progress-indicator]:bg-danger";
  }
  if (percent >= 70) {
    return "bg-warning/20 *:data-[slot=progress-indicator]:bg-warning";
  }
  return "bg-success/20 *:data-[slot=progress-indicator]:bg-success";
}

function UtilizationProgress({
  used,
  total,
}: {
  readonly used: number;
  readonly total: number;
}) {
  const t = useTranslations("Occupancy");
  const format = useFormatter();
  const percent = total === 0 ? 0 : Math.round((used / total) * 100);

  return (
    <section
      className="rounded-xl border border-border bg-raised p-4"
      aria-labelledby="occupancy-utilization-title"
      data-testid="occupancy-utilization"
    >
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h3
            id="occupancy-utilization-title"
            className="text-sm font-semibold text-text"
          >
            {t("usedTitle")}
          </h3>
          <p className="mt-0.5 text-xs text-muted">
            {t("usedSummary", {
              used: format.number(used),
              total: format.number(total),
            })}
          </p>
        </div>
        <strong className="font-mono text-3xl font-semibold tracking-tight text-text tabular-nums">
          {percent}%
        </strong>
      </div>
      <Progress
        aria-label={t("usedProgress", { percent })}
        className={`h-3 ${utilizationTone(percent)}`}
        data-testid="occupancy-capacity-bar"
        value={percent}
      />
    </section>
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
  const format = useFormatter();

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
  const used = cells.filter(({ band }) => band !== "EMPTY").length;

  return (
    <div className="flex flex-col gap-3" data-testid="occupancy-map">
      <UtilizationProgress used={used} total={cells.length} />

      <ul
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
        aria-label={t("legend")}
      >
        {counts.map((entry) => (
          <li
            key={entry.band}
            className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-raised px-3 py-2 text-sm text-text"
          >
            <span
              aria-hidden="true"
              className={`inline-block size-3 shrink-0 rounded-full border border-border ${
                BAND_CLASSES[entry.band] ?? ""
              }`}
            />
            <span
              className="flex min-w-0 flex-1 items-center justify-between gap-2"
              data-testid={`legend-${entry.band}`}
            >
              <span className="truncate">{bandT(entry.band)}</span>
              <strong className="font-mono tabular-nums">
                {format.number(entry.total)}
              </strong>
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

      <section aria-labelledby="occupancy-locations-title">
        <h3
          id="occupancy-locations-title"
          className="mb-2 text-sm font-semibold text-text"
        >
          {t("locationsTitle")}
        </h3>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full table-fixed border-collapse text-sm">
            <caption className="sr-only">{t("caption")}</caption>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={row[0]?.locationId ?? rowIndex}>
                  {row.map((cell) => (
                    <td
                      key={cell.locationId}
                      data-testid={`occupancy-${cell.code}`}
                      className={`min-h-touch border border-border p-3 align-top ${
                        BAND_CLASSES[cell.band] ?? ""
                      }`}
                    >
                      <span
                        className="block truncate font-mono text-xs font-semibold"
                        title={cell.code}
                      >
                        {cell.code}
                      </span>
                      {/*
                       * The band as a word and the count as a number. Either alone
                       * would make colour load-bearing, which is the one thing a
                       * heat map must not do.
                       */}
                      <span className="mt-1 block truncate text-xs">
                        {bandT(cell.band)} ·{" "}
                        {t("bucketCount", {
                          count: format.number(cell.distinctBuckets),
                        })}
                      </span>
                    </td>
                  ))}
                  {Array.from({ length: MAP_COLUMNS - row.length }).map(
                    (_, emptyIndex) => (
                      <td
                        aria-hidden="true"
                        className="border border-border bg-raised"
                        key={`empty-${rowIndex}-${emptyIndex}`}
                      />
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
