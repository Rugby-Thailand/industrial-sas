"use client";

import { useFormatter, useTranslations } from "next-intl";

import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/Notice";
import type { DashboardTile } from "@/lib/convex/reportingApi";

import { OperationsCounters } from "./ReportingSources";

import { EmptyState } from "@/components/ui/EmptyState";

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

  const backlog = tiles.filter((tile) => BACKLOG_METRICS.has(tile.metric));
  const cumulative = tiles.filter((tile) => !BACKLOG_METRICS.has(tile.metric));

  const renderTile = (tile: DashboardTile) => (
    <Card
      key={tile.metric}
      size="sm"
      data-testid={"tile-" + tile.metric}
      className={tile.suspect ? "border-warning" : ""}
    >
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
          <div className="mt-2">
            <Notice
              tone="warning"
              title={t("tileSuspectTitle")}
              body={t("tileSuspect")}
              testId={"tile-suspect-" + tile.metric}
            />
          </div>
        ) : null}
        {BACKLOG_METRICS.has(tile.metric) ? null : (
          <span className="mt-2 block text-xs text-muted">
            {t("tileCumulative")}
          </span>
        )}
      </dd>
    </Card>
  );

  return (
    <div
      role="group"
      aria-label={label}
      data-testid="dashboard-tiles"
      className="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]"
    >
      {backlog.length === 0 ? null : (
        <section aria-labelledby="dashboard-backlog-heading">
          <h3
            id="dashboard-backlog-heading"
            className="mb-2 text-sm font-semibold text-text"
          >
            {t("backlogHeading")}
          </h3>
          <dl className="grid gap-3 sm:grid-cols-2">
            {backlog.map(renderTile)}
          </dl>
        </section>
      )}

      {cumulative.length === 0 ? null : (
        <section aria-labelledby="dashboard-volume-heading">
          <h3
            id="dashboard-volume-heading"
            className="mb-2 text-sm font-semibold text-text"
          >
            {t("volumeHeading")}
          </h3>
          <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            {cumulative.map(renderTile)}
          </dl>
        </section>
      )}
    </div>
  );
}
