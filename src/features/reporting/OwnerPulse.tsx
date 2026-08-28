"use client";

import { AlertTriangle, ClipboardCheck, Gauge, Warehouse } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import type { DashboardTile } from "@/lib/convex/reportingApi";
import { cn } from "@/lib/utils";

import {
  Occupancy,
  OperationsCounters,
  type OccupancyAnswer,
} from "./ReportingSources";

type MetricKey = "inspections" | "decisions" | "putaway";

function MetricCard({
  metric,
  value,
  updatedAt,
  suspect = false,
  icon,
}: {
  readonly metric: MetricKey;
  readonly value: number;
  readonly updatedAt?: number | undefined;
  readonly suspect?: boolean | undefined;
  readonly icon: ReactNode;
}) {
  const t = useTranslations("OwnerDashboard");
  const format = useFormatter();
  const active = value > 0;

  return (
    <Card
      className="relative min-h-44 overflow-hidden p-0 shadow-sm"
      data-testid={`owner-metric-${metric}`}
    >
      <div
        aria-hidden="true"
        className={`h-1 w-full ${active ? "bg-warning" : "bg-success"}`}
      />
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-muted">
              {t(`metric.${metric}`)}
            </p>
            <p className="mt-2 font-mono text-4xl font-semibold tracking-tight text-text tabular-nums">
              {format.number(value)}
            </p>
          </div>
          <span
            className={`grid size-11 shrink-0 place-items-center rounded-xl ${
              active
                ? "bg-warning-surface text-warning"
                : "bg-success-surface text-success"
            }`}
          >
            {icon}
          </span>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`size-2 rounded-full ${active ? "bg-warning" : "bg-success"}`}
          />
          <span
            className={`text-xs font-semibold ${active ? "text-warning" : "text-success"}`}
          >
            {active ? t("metric.attentionLabel") : t("metric.clearLabel")}
          </span>
        </div>
        {updatedAt === undefined ? null : (
          <p className="mt-3 border-t border-border pt-3 text-xs text-muted">
            {t("metric.asOf", {
              when: format.dateTime(updatedAt, {
                dateStyle: "medium",
                timeStyle: "short",
              }),
            })}
          </p>
        )}
      </div>
      {suspect ? (
        <span
          className="absolute right-4 bottom-4 text-warning"
          title={t("metric.suspect")}
        >
          <AlertTriangle aria-hidden="true" className="size-4" />
          <span className="sr-only">{t("metric.suspect")}</span>
        </span>
      ) : null}
    </Card>
  );
}

function CapacityMetricCard({
  constrained,
  occupancy,
}: {
  readonly constrained: number;
  readonly occupancy: OccupancyAnswer;
}) {
  const t = useTranslations("OwnerDashboard");
  const pressure =
    occupancy.cells.length === 0
      ? 0
      : Math.round((constrained / occupancy.cells.length) * 100);
  const active = constrained > 0;

  return (
    <Card
      className="relative min-h-44 overflow-hidden p-0 shadow-sm"
      data-testid="owner-metric-capacity"
    >
      <div
        aria-hidden="true"
        className={`h-1 w-full ${active ? "bg-warning" : "bg-success"}`}
      />
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-muted">
              {t("metric.capacity")}
            </p>
            <p className="mt-2 font-mono text-4xl font-semibold tracking-tight text-text tabular-nums">
              {pressure}%
            </p>
          </div>
          <span
            className={`grid size-11 shrink-0 place-items-center rounded-xl ${
              active
                ? "bg-warning-surface text-warning"
                : "bg-success-surface text-success"
            }`}
          >
            {active ? (
              <AlertTriangle aria-hidden="true" className="size-5" />
            ) : (
              <Warehouse aria-hidden="true" className="size-5" />
            )}
          </span>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`size-2 rounded-full ${active ? "bg-warning" : "bg-success"}`}
          />
          <span
            className={`text-xs font-semibold ${active ? "text-warning" : "text-success"}`}
          >
            {active ? t("metric.attentionLabel") : t("metric.clearLabel")}
          </span>
        </div>
        <p className="mt-3 border-t border-border pt-3 text-xs text-muted">
          {occupancy.complete
            ? t("metric.capacityComplete", { count: occupancy.cells.length })
            : t("metric.capacityPartial")}
        </p>
      </div>
    </Card>
  );
}

const tile = (
  tiles: readonly DashboardTile[],
  metric: DashboardTile["metric"],
) => tiles.find((candidate) => candidate.metric === metric);

export function OwnerPulseCards({
  tiles,
  occupancy,
  layout = "grid",
}: {
  readonly tiles: readonly DashboardTile[];
  readonly occupancy: OccupancyAnswer;
  readonly layout?: "grid" | "compact";
}) {
  const inspections = tile(tiles, "QC_PENDING");
  const decisions = tile(tiles, "QC_PARKED");
  const ready = tile(tiles, "PUTAWAY_READY");
  const claimed = tile(tiles, "PUTAWAY_CLAIMED");
  const putawayCount = (ready?.count ?? 0) + (claimed?.count ?? 0);
  const putawayUpdatedAt =
    Math.max(ready?.updatedAt ?? 0, claimed?.updatedAt ?? 0) || undefined;
  const constrained = occupancy.cells.filter(
    ({ band }) => band === "BUSY" || band === "FULL",
  ).length;

  return (
    <div
      className={cn(
        "grid gap-3 sm:grid-cols-2",
        layout === "grid" && "xl:grid-cols-4",
      )}
    >
      <MetricCard
        metric="inspections"
        value={inspections?.count ?? 0}
        updatedAt={inspections?.updatedAt}
        suspect={inspections?.suspect}
        icon={<ClipboardCheck aria-hidden="true" className="size-5" />}
      />
      <MetricCard
        metric="decisions"
        value={decisions?.count ?? 0}
        updatedAt={decisions?.updatedAt}
        suspect={decisions?.suspect}
        icon={<Gauge aria-hidden="true" className="size-5" />}
      />
      <MetricCard
        metric="putaway"
        value={putawayCount}
        updatedAt={putawayUpdatedAt}
        suspect={Boolean(ready?.suspect || claimed?.suspect)}
        icon={<Warehouse aria-hidden="true" className="size-5" />}
      />
      <CapacityMetricCard constrained={constrained} occupancy={occupancy} />
    </div>
  );
}

export function OwnerPulse({
  layout = "grid",
}: {
  readonly layout?: "grid" | "compact";
}) {
  return (
    <OperationsCounters>
      {(tiles) => (
        <Occupancy>
          {(occupancy) => (
            <OwnerPulseCards
              tiles={tiles}
              occupancy={occupancy}
              layout={layout}
            />
          )}
        </Occupancy>
      )}
    </OperationsCounters>
  );
}
