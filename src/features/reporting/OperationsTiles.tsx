"use client";

/**
 * The numbers a supervisor opens the day with.
 *
 * Presentation decisions, each avoiding a specific way a KPI tile misleads:
 *
 * - **A definition list, not a grid of `div`s.** Each tile is a term and its
 *   value, which is what it is; a screen reader then reads "receipts opened,
 *   eighteen" rather than two unrelated strings. The shadcn `Card` supplies the
 *   surface and nothing else — it wraps the `dt`/`dd` pair rather than replacing
 *   it, because a card is a look and a definition list is a meaning.
 * - **The number is never the only thing.** A tile carries its label, its value,
 *   and when the counter last moved. `0` with no timestamp means "this has never
 *   happened here"; `0` timestamped this morning means "the backlog is clear".
 *   Those call for opposite actions and look identical without the date.
 * - **A suspect counter says so in words.** `suspect` means a decrement once
 *   clamped at zero, so the number may be low. It is still shown — a warehouse
 *   runs fine on an approximate backlog — but it is marked, and the mark is a
 *   `Badge` whose text carries the meaning rather than a colour alone
 *   (`WCAG 2.2` 1.4.1).
 * - **Digits are Latin, always.** Thai numerals would be authentic and
 *   unreadable next to a scanner display; `ADR-0010` fixes Latin digits for
 *   quantities and counts in both languages.
 *
 * The tiles are split into waiting work and cumulative volume, which is the
 * split an operations dashboard is organised around: the first is a queue
 * somebody has to act on today, and the second is a total that only moves up.
 * Sorting them into one row each is the whole difference between a dashboard and
 * a wall of numbers.
 */
import { useFormatter, useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { DashboardTile } from "@/lib/convex/reportingApi";

import { OperationsCounters } from "./ReportingSources";

import { EmptyState } from "@/components/ui/EmptyState";

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
      <EmptyState
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
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
    >
      {tiles.map((tile) => (
        <Card
          key={tile.metric}
          size="sm"
          data-testid={`tile-${tile.metric}`}
          className={tile.suspect ? "border-warning" : ""}
        >
          {/*
           * `dt` and `dd` are direct children of the card. A `dl` may contain
           * only `dt`/`dd` pairs or a single `div` wrapping each pair, and the
           * card *is* that div — nesting the header and content wrappers inside
           * it would add a second level and break the structure a screen reader
           * walks. So the card's own padding is applied here instead.
           */}
          <dt className="px-4 text-sm font-medium text-muted">
            {metricT(tile.metric)}
          </dt>
          <dd className="px-4">
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
              <Badge
                variant="outline"
                data-testid={`tile-suspect-${tile.metric}`}
                className="mt-2 h-auto border-warning py-1 text-left text-xs font-medium whitespace-normal text-warning"
              >
                {t("tileSuspect")}
              </Badge>
            ) : null}
            {BACKLOG_METRICS.has(tile.metric) ? null : (
              <span className="mt-2 block text-xs text-muted">
                {t("tileCumulative")}
              </span>
            )}
          </dd>
        </Card>
      ))}
    </dl>
  );
}
