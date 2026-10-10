"use client";

import { useTranslations } from "next-intl";

import type { Feature } from "../../../convex/model/aiUsage/usage";
import { Panel } from "@/components/ui/Panel";
import type { useUsageFormat } from "./format";
import type { Report } from "./report";

/** Contribution of each user, warehouse, model and environment. */
export function UsageBreakdown({
  report,
  featureLabel,
  format,
}: {
  readonly report: Report;
  readonly featureLabel: (feature: Feature) => string;
  readonly format: ReturnType<typeof useUsageFormat>;
}) {
  const t = useTranslations("AiUsage");
  const { num, money } = format;
  return (
    <section aria-labelledby="usage-breakdown">
      <h2 id="usage-breakdown" className="mb-3 text-lg font-semibold">
        {t("breakdown")}
      </h2>
      {!report.breakdown.length ? (
        <Panel>
          <p className="max-w-prose text-sm leading-relaxed text-muted">
            {t("empty")}
          </p>
        </Panel>
      ) : (
        <Panel className="divide-y divide-border py-0">
          {report.breakdown.map((row, i) => (
            <div key={i} className="grid gap-3 py-4 md:grid-cols-[2fr_1fr_1fr]">
              <div className="min-w-0">
                <p className="font-medium break-words">
                  {report.users.find((u) => u.id === row.actorUserId)?.name ??
                    row.actorUserId}
                </p>
                <p className="mt-1 text-xs break-words text-muted">
                  {featureLabel(row.feature)} ·{" "}
                  {report.warehouses.find((w) => w.id === row.warehouseId)
                    ?.name ?? t("noWarehouse")}{" "}
                  · {row.requestedModel} · {row.environment}
                </p>
              </div>
              <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                <div>
                  <dt>{t("operations")}</dt>
                  <dd className="text-sm text-text tabular-nums">
                    {num(row.metrics.operationCount)}
                  </dd>
                </div>
                <div>
                  <dt>{t("success")}</dt>
                  <dd className="text-sm text-text tabular-nums">
                    {num(row.metrics.successCount)}
                  </dd>
                </div>
                <div>
                  <dt>{t("latency")}</dt>
                  <dd className="text-sm text-text tabular-nums">
                    {row.metrics.finishedOperationCount
                      ? `${num(row.metrics.totalDurationMs / row.metrics.finishedOperationCount / 1000, 1)} s`
                      : "—"}
                  </dd>
                </div>
              </dl>
              <div className="text-sm wrap-anywhere tabular-nums">
                {money(row.metrics.knownCostUsdNano)}
                {row.metrics.unknownAttemptCount ? (
                  <p className="mt-1 text-xs text-warning">
                    {t("unknown", { count: row.metrics.unknownAttemptCount })}
                  </p>
                ) : null}
              </div>
            </div>
          ))}
        </Panel>
      )}
      <p className="mt-3 text-xs leading-relaxed text-muted">{t("details")}</p>
    </section>
  );
}
