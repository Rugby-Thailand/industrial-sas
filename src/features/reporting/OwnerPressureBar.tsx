"use client";

import { useFormatter, useTranslations } from "next-intl";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  XAxis,
  YAxis,
} from "recharts";

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
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
  readonly pressure: number;
  readonly formattedValue: string;
}

const tile = (
  tiles: readonly DashboardTile[],
  metric: DashboardTile["metric"],
) => tiles.find((candidate) => candidate.metric === metric);

function axisMaximum(values: readonly number[]): number {
  const largest = Math.max(0, ...values);
  return Math.max(5, Math.ceil(largest / 5) * 5);
}

export function OwnerPressureBarView({
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
  const rawData = [
    {
      key: "inspections",
      label: t("pressure.axis.inspections"),
      pressure: tile(tiles, "QC_PENDING")?.count ?? 0,
    },
    {
      key: "decisions",
      label: t("pressure.axis.decisions"),
      pressure: tile(tiles, "QC_PARKED")?.count ?? 0,
    },
    {
      key: "putawayReady",
      label: t("pressure.axis.putawayReady"),
      pressure: tile(tiles, "PUTAWAY_READY")?.count ?? 0,
    },
    {
      key: "putawayActive",
      label: t("pressure.axis.putawayActive"),
      pressure: tile(tiles, "PUTAWAY_CLAIMED")?.count ?? 0,
    },
    {
      key: "capacity",
      label: t("pressure.axis.capacity"),
      pressure: constrained,
    },
  ] as const;
  const data: readonly PressureDatum[] = rawData
    .map((datum) => ({
      ...datum,
      formattedValue: format.number(datum.pressure),
    }))
    .sort((left, right) => right.pressure - left.pressure);
  const maximum = axisMaximum(data.map(({ pressure }) => pressure));
  const largest = data[0];
  const clear = data.every(({ pressure }) => pressure === 0);
  const chartConfig = {
    pressure: {
      label: t("pressure.valueLabel"),
      color: "var(--token-accent)",
    },
  } satisfies ChartConfig;

  return (
    <Card className="shadow-sm" data-testid="owner-pressure-bar">
      <section aria-labelledby="owner-pressure-bar-title">
        <CardHeader>
          <CardTitle>
            <h3 id="owner-pressure-bar-title">{t("pressure.title")}</h3>
          </CardTitle>
        </CardHeader>

        <CardContent>
          <ChartContainer
            className="aspect-auto h-[14rem] w-full min-w-0"
            config={chartConfig}
          >
            <BarChart
              accessibilityLayer
              data={data}
              layout="vertical"
              margin={{ top: 6, right: 32, bottom: 6, left: 0 }}
            >
              <CartesianGrid horizontal={false} />
              <YAxis
                axisLine={false}
                dataKey="label"
                tick={{ fill: "var(--token-muted)", fontSize: 12 }}
                tickLine={false}
                tickMargin={8}
                type="category"
                width={102}
              />
              <XAxis
                dataKey="pressure"
                domain={[0, maximum]}
                hide
                type="number"
              />
              <ChartTooltip
                content={<ChartTooltipContent hideLabel indicator="line" />}
                cursor={false}
              />
              <Bar
                dataKey="pressure"
                fill="var(--color-pressure)"
                maxBarSize={30}
                radius={[0, 4, 4, 0]}
              >
                <LabelList
                  className="fill-text"
                  dataKey="formattedValue"
                  fontSize={12}
                  offset={8}
                  position="right"
                />
              </Bar>
            </BarChart>
          </ChartContainer>

          <dl className="sr-only">
            {data.map(({ key, label, pressure }) => (
              <div key={key} data-testid={`pressure-${key}`}>
                <dt>{label}</dt>
                <dd>{format.number(pressure)}</dd>
              </div>
            ))}
          </dl>
        </CardContent>

        <CardFooter
          className={`text-xs font-semibold ${
            clear
              ? "bg-success-surface text-success"
              : "bg-warning-surface text-warning"
          }`}
        >
          {clear || largest === undefined
            ? t("pressure.clear")
            : t("pressure.largest", {
                label: largest.label,
                value: format.number(largest.pressure),
              })}
        </CardFooter>
      </section>
    </Card>
  );
}

export function OwnerPressureBar() {
  return (
    <OperationsCounters>
      {(tiles) => (
        <Occupancy>
          {(occupancy) => (
            <OwnerPressureBarView tiles={tiles} occupancy={occupancy} />
          )}
        </Occupancy>
      )}
    </OperationsCounters>
  );
}
