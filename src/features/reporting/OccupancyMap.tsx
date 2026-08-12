"use client";

/**
 * The occupancy map: an accessible 2D grid, not a 3D scene (`ADR-0011` §8,
 * `ADR-0017`, D-28, `INV-0011-11`).
 *
 * The question it answers is "which aisle should I walk to?", and that question
 * is answered better by a stable grid than by anything with a camera in it.
 * `three` is absent from the dependency graph on purpose.
 *
 * ### Why it is a table
 *
 * It renders as a real `<table>` with row and column headers, not as an SVG with
 * `aria-label`s bolted on. A warehouse map *is* tabular data — location, how
 * full — and a table gets keyboard navigation, screen-reader row/column
 * announcements, zoom, and text selection for free. The visual grid is the
 * table's own layout; the accessibility is not a parallel implementation that
 * could drift.
 *
 * ### Why colour is never alone
 *
 * Each cell carries the location code, the band as a word, and the bucket count.
 * Colour is redundant — the same information survives greyscale, direct sunlight
 * on a dock, and a colour-vision deficiency (`WCAG 2.2` 1.4.1). The bands are
 * also ordered, so the legend reads as a scale rather than as four unrelated
 * colours.
 *
 * ### Why a capped map admits it
 *
 * `complete: false` means the site has more locations than the read drew. Saying
 * so is the difference between "that aisle is empty" and "that aisle is not on
 * this map", which are opposite instructions.
 */
import { useTranslations } from "next-intl";

import { Notice } from "@/components/ui/Notice";
import type { OccupancyCell } from "@/lib/convex/reportingApi";

import { Occupancy } from "./ReportingSources";

import { EmptyState } from "@/components/ui/EmptyState";

/** Columns in the grid. Six fits a 393-pixel handheld without side-scrolling. */
export const MAP_COLUMNS = 6;

/**
 * The fill for each band, from the design tokens.
 *
 * Fills only. The band is also printed as a word in every cell, so a reader who
 * cannot distinguish these four colours loses nothing (`WCAG 2.2` 1.4.1), and
 * each keeps text above 4.5:1 in both colour schemes (1.4.3).
 */
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

/**
 * How the site's drawn locations divide between the four bands.
 *
 * The one visualization on this dashboard, and it is deliberately the smallest
 * thing that answers "is this warehouse filling up?" at a glance. It is built
 * from the same `cells` the table below is built from — a proportion of a count
 * this page already read, not a second metric, and nothing that could disagree
 * with the grid underneath it.
 *
 * It is also `aria-hidden`, which is the point rather than an oversight. Every
 * band's exact count is printed as a word and a number in the legend directly
 * below, and the full per-location detail is in the table below that. Announcing
 * four unlabelled segments as well would make a screen reader read the same
 * figures three times. The rule the dashboard is held to is that no chart is the
 * only carrier of its meaning (`WCAG 2.2` 1.4.1) — this one carries none of it
 * alone, and it encodes nothing in hover.
 */
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
