"use client";

import { useTranslations } from "next-intl";

import type { Feature } from "../../../convex/model/aiUsage/usage";
import type { UsageFormat } from "./format";
import { costState, type Report } from "./report";
import { CELL, NUMERIC, UsageTable } from "./UsageTable";

/** Contribution of each user, warehouse and model; the feature is row detail. */
export function UsageBreakdown({
  report,
  featureLabel,
  format,
}: {
  readonly report: Report;
  readonly featureLabel: (feature: Feature) => string;
  readonly format: UsageFormat;
}) {
  const t = useTranslations("AiUsage");
  const { num, usd, thb } = format;
  const columns = [
    { key: "user", label: t("colUser") },
    { key: "warehouse", label: t("warehouse") },
    { key: "model", label: t("colModel") },
    { key: "calls", label: t("colCalls"), numeric: true },
    { key: "usd", label: t("colCostUsd"), numeric: true },
    { key: "thb", label: t("colCostThb"), numeric: true },
  ];
  return (
    <section aria-labelledby="usage-breakdown" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="usage-breakdown" className="text-lg font-semibold sm:text-xl">
          {t("breakdown")}
        </h2>
        <p className="text-xs text-muted tabular-nums sm:text-sm">
          {t("rangeWithZone", {
            from: report.range.from,
            to: report.range.to,
            timezone: report.range.timezone,
          })}
        </p>
      </div>
      <UsageTable
        label={t("breakdown")}
        columns={columns}
        minWidth="min-w-[720px]"
        {...(report.breakdown.length ? {} : { empty: t("breakdownEmpty") })}
      >
        {report.breakdown.map((row, i) => {
          const unconfirmed = costState(row.metrics) === "UNCONFIRMED";
          const m = row.metrics;
          return (
            <tr key={i} className="border-b border-border last:border-b-0">
              <th scope="row" className={`${CELL} text-left font-medium`}>
                <span className="block break-words">
                  {report.users.find((u) => u.id === row.actorUserId)?.name ??
                    t("unknownUser")}
                </span>
                <span className="block text-xs font-normal text-muted">
                  {featureLabel(row.feature)}
                </span>
              </th>
              <td className={`${CELL} break-words`}>
                {row.warehouseId === undefined
                  ? t("noWarehouse")
                  : (report.warehouses.find((w) => w.id === row.warehouseId)
                      ?.name ?? t("unknownWarehouse"))}
              </td>
              <td className={`${CELL} max-w-56`}>
                <span className="block break-words">{row.requestedModel}</span>
                <span className="block text-xs text-muted">
                  {row.environment}
                </span>
              </td>
              <td className={`${CELL} ${NUMERIC}`}>
                <span className="block">{num(m.attemptCount)}</span>
                <span className="block text-xs text-muted">
                  {t("operationsSuccess", {
                    operations: m.operationCount,
                    success: m.successCount,
                  })}
                </span>
                <span className="block text-xs text-muted">
                  {m.finishedOperationCount
                    ? t("averageDuration", {
                        seconds: num(
                          m.totalDurationMs / m.finishedOperationCount / 1000,
                          1,
                        ),
                      })
                    : null}
                </span>
              </td>
              <td className={`${CELL} ${NUMERIC} wrap-anywhere`}>
                {unconfirmed ? (
                  <span className="text-warning">{t("costUnconfirmed")}</span>
                ) : (
                  usd(m.knownCostUsdNano)
                )}
                {m.unknownAttemptCount ? (
                  <span className="mt-1 block text-xs text-warning">
                    {t("unknown", { count: m.unknownAttemptCount })}
                  </span>
                ) : null}
              </td>
              <td className={`${CELL} ${NUMERIC} text-muted`}>
                {unconfirmed ? "—" : (thb(m.knownCostUsdNano) ?? "—")}
              </td>
            </tr>
          );
        })}
      </UsageTable>
    </section>
  );
}
