"use client";

import { ArrowUpRight, PackageOpen } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Card } from "@/components/ui/card";
import type { DashboardTile } from "@/lib/convex/reportingApi";

import { OperationsCounters } from "./ReportingSources";

const tile = (
  tiles: readonly DashboardTile[],
  metric: DashboardTile["metric"],
) => tiles.find((candidate) => candidate.metric === metric);

export function OwnerOperationsSummaryView({
  tiles,
}: {
  readonly tiles: readonly DashboardTile[];
}) {
  const t = useTranslations("OwnerDashboard");
  const metricT = useTranslations("Metric");
  const format = useFormatter();
  const receipts = tile(tiles, "RECEIPTS_OPENED");
  const lines = tile(tiles, "RECEIPT_LINES_POSTED");
  const latest = Math.max(receipts?.updatedAt ?? 0, lines?.updatedAt ?? 0);

  return (
    <Card className="overflow-hidden shadow-sm">
      <section className="relative overflow-hidden p-5">
        <div
          aria-hidden="true"
          className="absolute -top-16 -right-16 size-44 rounded-full bg-accent/10 blur-2xl"
        />
        <div className="relative">
          <div className="flex items-start gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-accent/10 text-accent">
              <PackageOpen aria-hidden="true" className="size-5" />
            </span>
            <div>
              <h3 className="font-semibold text-text">{t("volumeTitle")}</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">
                {t("volumeHelp")}
              </p>
            </div>
          </div>
          <dl className="mt-6 grid grid-cols-2 gap-3">
            <div
              className="rounded-xl border border-border bg-raised/55 p-4"
              data-testid="owner-volume-receipts"
            >
              <dt className="text-xs font-medium text-muted">
                {metricT("RECEIPTS_OPENED")}
              </dt>
              <dd className="mt-2 font-mono text-3xl font-semibold text-text tabular-nums">
                {format.number(receipts?.count ?? 0)}
              </dd>
            </div>
            <div
              className="rounded-xl border border-border bg-raised/55 p-4"
              data-testid="owner-volume-lines"
            >
              <dt className="text-xs font-medium text-muted">
                {metricT("RECEIPT_LINES_POSTED")}
              </dt>
              <dd className="mt-2 font-mono text-3xl font-semibold text-text tabular-nums">
                {format.number(lines?.count ?? 0)}
              </dd>
            </div>
          </dl>
          {latest === 0 ? null : (
            <p className="mt-4 flex items-center gap-2 text-xs text-muted">
              <ArrowUpRight aria-hidden="true" className="size-4 text-accent" />
              {t("latestActivity", {
                when: format.dateTime(latest, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }),
              })}
            </p>
          )}
        </div>
      </section>
    </Card>
  );
}

export function OwnerOperationsSummary() {
  return (
    <OperationsCounters>
      {(tiles) => <OwnerOperationsSummaryView tiles={tiles} />}
    </OperationsCounters>
  );
}
