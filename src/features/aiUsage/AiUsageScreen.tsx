"use client";

import { useConvex, useQuery } from "convex/react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { FEATURES, type Feature } from "../../../convex/model/aiUsage/usage";
import { useAiUsageAccess } from "@/components/providers/AiUsageAccessProvider";
import { PageHeader } from "@/components/ui/PageHeader";
import { Notice } from "@/components/ui/Notice";
import { Skeleton } from "@/components/ui/skeleton";
import { useUsageFormat } from "./format";
import { RecentActivity } from "./RecentActivity";
import {
  activeFilterCount,
  NO_FILTERS,
  summaryRef,
  type UsageFilters,
} from "./report";
import { SettingsForm } from "./SettingsForm";
import { UsageBreakdown } from "./UsageBreakdown";
import { FeatureCards, UsageStatement } from "./UsageOverview";
import { UsageToolbar, type DateRange, type Period } from "./UsageToolbar";
import {
  attemptsRef,
  exportUsage,
  operationsRef,
  usageExportScope,
} from "./usageExport";

/** Translation key of each feature's label. */
export const FEATURE_LABEL_KEYS: Readonly<Record<Feature, string>> =
  Object.freeze({
    JOB_TICKET_SCAN: "image",
    LOCATION_LABEL_SCAN: "locationScan",
    AI_SEARCH: "search",
  });

export function AiUsageScreen() {
  const t = useTranslations("AiUsage"),
    access = useAiUsageAccess();
  // Organization-scoped access, independent of warehouse permissions.
  return (
    <>
      <PageHeader title={t("title")} summary={t("summary")} showBack={false} />
      {access.status === "LOADING" ? (
        <p role="status">{t("loading")}</p>
      ) : access.status === "READY" &&
        access.permissions.includes("aiUsage.read") ? (
        <UsageReport
          canConfigure={access.permissions.includes("aiUsage.configure")}
        />
      ) : (
        <Notice title={t("denied")} />
      )}
    </>
  );
}

function UsageReport({ canConfigure }: { canConfigure: boolean }) {
  const t = useTranslations("AiUsage"),
    locale = useLocale(),
    convex = useConvex();
  // Convex queries do not invalidate with time alone. Re-key at half-hour
  // boundaries, including midnight in every supported organization timezone.
  const [refreshKey, setRefreshKey] = useState(() =>
    Math.floor(Date.now() / 1800000),
  );
  useEffect(() => {
    const refresh = () => setRefreshKey(Math.floor(Date.now() / 1800000));
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  const [period, setPeriod] = useState<Period>("month");
  const [dates, setDates] = useState<DateRange | null>(null);
  const [filters, setFilters] = useState<UsageFilters>(NO_FILTERS);
  const [exporting, setExporting] = useState(false),
    [exportError, setExportError] = useState(false);
  const exportLife = useRef({ generation: 0 });
  useEffect(() => {
    const life = exportLife.current;
    return () => {
      life.generation++;
    };
  }, []);
  const { feature, actorUserId, warehouseId, requestedModel, environment } =
    filters;
  const filter = {
    ...(feature ? { feature } : {}),
    ...(actorUserId ? { actorUserId } : {}),
    ...(warehouseId ? { warehouseId } : {}),
    ...(requestedModel ? { requestedModel } : {}),
    ...(environment ? { environment } : {}),
  };
  const args = {
    refreshKey,
    ...filter,
    ...(period === "custom" && dates
      ? dates
      : {
          period: period === "today" ? ("today" as const) : ("month" as const),
        }),
  };
  const outcome = useQuery(summaryRef, args);
  const data =
    outcome?.ok && !("error" in outcome.value) ? outcome.value : null;
  // Filter choices outlive a reload, so a selected user or warehouse keeps
  // its name while the next answer loads.
  const [options, setOptions] = useState<typeof data>(null);
  if (data && data !== options) setOptions(data);
  const format = useUsageFormat(data?.settings ?? null);
  const label = (kind: Feature) => t(FEATURE_LABEL_KEYS[kind]);
  const shownFeatures = FEATURES.filter((kind) => !feature || feature === kind);
  async function exportCsv() {
    if (!data) return;
    // One lifecycle per export: a newer export or the report's unmount (an
    // organization switch or sign-out unmounts it) invalidates this one.
    const life = exportLife.current,
      generation = ++life.generation,
      isCurrent = () => life.generation === generation;
    const scope = usageExportScope(data, filter);
    setExporting(true);
    setExportError(false);
    const result = await exportUsage(
      {
        operations: (query) => convex.query(operationsRef, query),
        attempts: (query) => convex.query(attemptsRef, query),
      },
      scope,
      isCurrent,
    );
    // Checked synchronously before any state change, Blob or download.
    if (!isCurrent()) return;
    setExporting(false);
    if (result.kind !== "READY") {
      setExportError(result.kind === "FAILED");
      return;
    }
    try {
      const url = URL.createObjectURL(
        new Blob([result.csv], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = result.fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setExportError(true);
    }
  }
  return (
    <div className="min-w-0 space-y-6">
      <UsageToolbar
        period={period}
        onPeriod={setPeriod}
        range={data?.range ?? null}
        onDates={setDates}
        filters={filters}
        onFilters={setFilters}
        options={data ?? options}
        featureLabel={label}
        canExport={data !== null}
        exporting={exporting}
        onExport={() => void exportCsv()}
      />
      {outcome === undefined ? (
        <div aria-busy="true" className="space-y-4">
          <p role="status" className="sr-only">
            {t("loading")}
          </p>
          <Skeleton className="h-32 w-full rounded-lg" />
          <div className="grid gap-4 lg:grid-cols-3">
            {FEATURES.map((kind) => (
              <Skeleton key={kind} className="h-56 w-full rounded-lg" />
            ))}
          </div>
        </div>
      ) : !outcome.ok ? (
        <Notice tone="danger" role="alert" title={t("denied")} />
      ) : !data ? (
        <Notice tone="danger" role="alert" title={t("queryError")} />
      ) : (
        <>
          <div className="space-y-1 text-sm text-muted">
            <p>
              {data.range.from} – {data.range.to} · {data.range.timezone}
            </p>
            {data.trackingStartedAt ? (
              <p className="text-xs">
                {t("started", {
                  date: new Intl.DateTimeFormat(locale, {
                    dateStyle: "medium",
                    timeZone: data.range.timezone,
                  }).format(data.trackingStartedAt),
                })}
              </p>
            ) : null}
          </div>
          {exportError ? (
            <Notice tone="danger" role="alert" title={t("exportError")} />
          ) : null}
          {!data.complete ? (
            <Notice tone="warning" title={t("partial")} />
          ) : null}
          <UsageStatement
            report={data}
            features={shownFeatures}
            filterCount={activeFilterCount(filters)}
            canConfigure={canConfigure}
            format={format}
          />
          <FeatureCards
            report={data}
            features={shownFeatures}
            featureLabel={label}
            format={format}
          />
          <p className="max-w-prose text-xs leading-relaxed text-muted">
            {t("completeAverage")}{" "}
            {data.settings
              ? t("estimate", {
                  rate: format.num(data.settings.usdThbRate, 4),
                  fee: format.num(data.settings.feePercent, 2),
                })
              : null}
          </p>
          <UsageBreakdown report={data} featureLabel={label} format={format} />
          <RecentActivity
            args={args}
            signature={JSON.stringify(data.byFeature)}
            timezone={data.range.timezone}
            featureLabel={label}
            money={format.money}
          />
          {canConfigure ? <SettingsForm settings={data.settings} /> : null}
        </>
      )}
    </div>
  );
}
