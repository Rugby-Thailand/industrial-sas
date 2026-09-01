"use client";

import { useFormatter, useTranslations } from "next-intl";

import { Card } from "@/components/ui/card";
import type { DashboardTile } from "@/lib/convex/reportingApi";

import {
  Occupancy,
  OperationsCounters,
  type OccupancyAnswer,
} from "./ReportingSources";

type PressureKey =
  "inspections" | "decisions" | "putawayReady" | "putawayActive" | "capacity";

interface PressureDatum {
  readonly key: PressureKey;
  readonly label: string;
  readonly value: number;
}

const WIDTH = 400;
const HEIGHT = 330;
const CENTER_X = 200;
const CENTER_Y = 150;
const RADIUS = 96;
const LABEL_RADIUS = 142;
const RINGS = [0.25, 0.5, 0.75, 1] as const;

const tile = (
  tiles: readonly DashboardTile[],
  metric: DashboardTile["metric"],
) => tiles.find((candidate) => candidate.metric === metric);

function pointAt(index: number, radius: number, total: number) {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / total;
  return {
    x: CENTER_X + Math.cos(angle) * radius,
    y: CENTER_Y + Math.sin(angle) * radius,
  };
}

function pointsAt(radius: number, total: number): string {
  return Array.from({ length: total }, (_, index) => {
    const point = pointAt(index, radius, total);
    return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
  }).join(" ");
}

function axisMaximum(values: readonly number[]): number {
  const largest = Math.max(0, ...values);
  return Math.max(5, Math.ceil(largest / 5) * 5);
}

function textAnchor(x: number): "start" | "middle" | "end" {
  if (x < CENTER_X - 12) return "end";
  if (x > CENTER_X + 12) return "start";
  return "middle";
}

export function OwnerPressureRadarView({
  tiles,
  occupancy,
}: {
  readonly tiles: readonly DashboardTile[];
  readonly occupancy: OccupancyAnswer;
}) {
  const t = useTranslations("OwnerDashboard");
  const format = useFormatter();
  const constrained = occupancy.cells.filter(
    ({ band }) => band === "BUSY" || band === "FULL",
  ).length;
  const data: readonly PressureDatum[] = [
    {
      key: "inspections",
      label: t("pressure.axis.inspections"),
      value: tile(tiles, "QC_PENDING")?.count ?? 0,
    },
    {
      key: "decisions",
      label: t("pressure.axis.decisions"),
      value: tile(tiles, "QC_PARKED")?.count ?? 0,
    },
    {
      key: "putawayReady",
      label: t("pressure.axis.putawayReady"),
      value: tile(tiles, "PUTAWAY_READY")?.count ?? 0,
    },
    {
      key: "putawayActive",
      label: t("pressure.axis.putawayActive"),
      value: tile(tiles, "PUTAWAY_CLAIMED")?.count ?? 0,
    },
    {
      key: "capacity",
      label: t("pressure.axis.capacity"),
      value: constrained,
    },
  ];
  const maximum = axisMaximum(data.map(({ value }) => value));
  const dataPoints = data
    .map(({ value }, index) =>
      pointAt(
        index,
        (Math.min(value, maximum) / maximum) * RADIUS,
        data.length,
      ),
    )
    .map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ");
  const largest = data.reduce<PressureDatum | undefined>(
    (current, candidate) =>
      current === undefined || candidate.value > current.value
        ? candidate
        : current,
    undefined,
  );
  const clear = data.every(({ value }) => value === 0);

  return (
    <Card
      className="overflow-hidden shadow-sm"
      data-testid="owner-pressure-radar"
    >
      <section aria-labelledby="owner-pressure-radar-title" className="p-5">
        <div>
          <h3
            id="owner-pressure-radar-title"
            className="font-semibold text-text"
          >
            {t("pressure.title")}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {t("pressure.help")}
          </p>
        </div>

        <svg
          aria-hidden="true"
          className="mt-3 h-auto w-full overflow-visible"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        >
          {RINGS.map((ring) => (
            <polygon
              key={ring}
              className="fill-none stroke-border"
              points={pointsAt(RADIUS * ring, data.length)}
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {data.map((datum, index) => {
            const end = pointAt(index, RADIUS, data.length);
            return (
              <line
                key={datum.key}
                className="stroke-border"
                x1={CENTER_X}
                x2={end.x}
                y1={CENTER_Y}
                y2={end.y}
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
          <polygon
            className="fill-accent/20 stroke-accent"
            points={dataPoints}
            strokeLinejoin="round"
            strokeWidth="2.5"
            vectorEffect="non-scaling-stroke"
          />
          {data.map((datum, index) => {
            const point = pointAt(
              index,
              (Math.min(datum.value, maximum) / maximum) * RADIUS,
              data.length,
            );
            return (
              <circle
                key={datum.key}
                className="fill-accent stroke-surface"
                cx={point.x}
                cy={point.y}
                r="4"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              >
                <title>{`${datum.label}: ${format.number(datum.value)}`}</title>
              </circle>
            );
          })}
          {data.map((datum, index) => {
            const point = pointAt(index, LABEL_RADIUS, data.length);
            return (
              <text
                key={datum.key}
                className="fill-muted text-[12px] font-medium"
                dominantBaseline="middle"
                textAnchor={textAnchor(point.x)}
                x={point.x}
                y={point.y}
              >
                {datum.label}
              </text>
            );
          })}
          <text
            className="fill-muted text-[11px]"
            textAnchor="middle"
            x={CENTER_X}
            y={HEIGHT - 6}
          >
            {t("pressure.scale", { maximum: format.number(maximum) })}
          </text>
        </svg>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4 sm:grid-cols-5 xl:grid-cols-2">
          {data.map(({ key, label, value }) => (
            <div key={key} className="min-w-0" data-testid={`pressure-${key}`}>
              <dt className="truncate text-xs text-muted">{label}</dt>
              <dd className="mt-0.5 font-mono text-lg font-semibold text-text tabular-nums">
                {format.number(value)}
              </dd>
            </div>
          ))}
        </dl>

        <p
          className={`mt-4 rounded-lg px-3 py-2 text-xs font-semibold ${
            clear
              ? "bg-success-surface text-success"
              : "bg-warning-surface text-warning"
          }`}
        >
          {clear || largest === undefined
            ? t("pressure.clear")
            : t("pressure.largest", {
                label: largest.label,
                value: format.number(largest.value),
              })}
        </p>
      </section>
    </Card>
  );
}

export function OwnerPressureRadar() {
  return (
    <OperationsCounters>
      {(tiles) => (
        <Occupancy>
          {(occupancy) => (
            <OwnerPressureRadarView tiles={tiles} occupancy={occupancy} />
          )}
        </Occupancy>
      )}
    </OperationsCounters>
  );
}
