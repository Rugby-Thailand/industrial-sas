"use client";

/**
 * The six numbers a supervisor opens the day with.
 *
 * Presentation decisions, each avoiding a specific way a KPI tile misleads:
 *
 * - **A definition list, not a grid of `div`s.** Each tile is a term and its
 *   value, which is what it is; a screen reader then reads "receipts opened,
 *   eighteen" rather than two unrelated strings.
 * - **The number is never the only thing.** A tile carries its label, its value,
 *   and when the counter last moved. `0` with no timestamp means "this has never
 *   happened here"; `0` timestamped this morning means "the backlog is clear".
 *   Those call for opposite actions and look identical without the date.
 * - **A suspect counter says so in words.** `suspect` means a decrement once
 *   clamped at zero, so the number may be low. It is still shown — a warehouse
 *   runs fine on an approximate backlog — but it is marked, and the mark is text
 *   plus a tone rather than a colour alone (`WCAG 2.2` 1.4.1).
 * - **Digits are Latin, always.** Thai numerals would be authentic and
 *   unreadable next to a scanner display; `ADR-0010` fixes Latin digits for
 *   quantities and counts in both languages.
 */
import { useFormatter, useTranslations } from "next-intl";

import { Notice } from "@/components/ui/Notice";
import type { DashboardTile } from "@/lib/convex/reportingApi";

import { OperationsCounters } from "./ReportingSources";

/** The tiles that describe waiting work rather than cumulative volume. */
const BACKLOG_METRICS = new Set([
  "QC_PENDING",
  "QC_PARKED",
  "PUTAWAY_READY",
  "PUTAWAY_CLAIMED",
]);

export function OperationsTiles() {
  const t = useTranslations("Dashboard");

  return (
    <OperationsCounters>
      {(tiles) => <TileList tiles={tiles} label={t("tilesLabel")} />}
    </OperationsCounters>
  );
}

export function TileList({
  tiles,
  label,
}: {
  readonly tiles: readonly DashboardTile[];
  readonly label: string;
}) {
  const t = useTranslations("Dashboard");
  const metricT = useTranslations("Metric");
  const format = useFormatter();

  if (tiles.length === 0) {
    return (
      <Notice
        tone="muted"
        title={t("noTiles")}
        body={t("noTilesHint")}
        testId="dashboard-no-tiles"
      />
    );
  }

  return (
    <dl
      aria-label={label}
      data-testid="dashboard-tiles"
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
    >
      {tiles.map((tile) => (
        <div
          key={tile.metric}
          data-testid={`tile-${tile.metric}`}
          className={`rounded-lg border bg-surface p-4 ${
            tile.suspect ? "border-warning" : "border-border"
          }`}
        >
          <dt className="text-sm font-medium text-muted">
            {metricT(tile.metric)}
          </dt>
          {/*
           * Everything else lives inside the `dd`. A `dl` may only contain
           * `dt`/`dd` pairs (or a `div` wrapping them), so a sibling paragraph
           * would break the term-and-definition structure a screen reader walks.
           */}
          <dd className="mt-1">
            <span className="block font-mono text-3xl font-semibold text-text tabular-nums">
              {format.number(tile.count)}
            </span>
            <span className="mt-2 block text-xs text-muted">
              {tile.updatedAt === undefined
                ? t("tileNeverMoved")
                : t("tileAsOf", {
                    when: format.dateTime(new Date(tile.updatedAt), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }),
                  })}
            </span>
            {tile.suspect ? (
              <span
                className="mt-2 block text-xs font-medium text-warning"
                data-testid={`tile-suspect-${tile.metric}`}
              >
                {t("tileSuspect")}
              </span>
            ) : null}
            {BACKLOG_METRICS.has(tile.metric) ? null : (
              <span className="mt-2 block text-xs text-muted">
                {t("tileCumulative")}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
