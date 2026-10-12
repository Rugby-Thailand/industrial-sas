"use client";

import { useConvex, useQuery } from "convex/react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";

import { FEATURES, type Feature } from "../../../convex/model/aiUsage/usage";
import { useAiUsageAccess } from "@/components/providers/AiUsageAccessProvider";
import { Notice } from "@/components/ui/Notice";
import { Skeleton } from "@/components/ui/skeleton";
import {
  unavailableEstimate,
  withCurrentStatus,
  type UsageEstimate,
} from "@/lib/aiUsage/estimateSources";
import { AutomaticEstimate } from "./AutomaticEstimate";
import { useUsageFormat } from "./format";
import { RecentActivity } from "./RecentActivity";
import {
  activeFilterCount,
  NO_FILTERS,
  summaryRef,
  type UsageFilters,
} from "./report";
import { useEstimateRefresh } from "./useEstimateRefresh";
import { UsageBreakdown } from "./UsageBreakdown";
import { FeatureStrip, UsageStatement } from "./UsageOverview";
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

/**
 * The AI usage report. `estimate` is the server-loaded automatic estimate
 * snapshot (public FX rate and funding policy, cached for one day); it never
 * rejects and carries no tenant data or credentials.
 */
export function AiUsageScreen({
  estimate,
}: {
  readonly estimate: Promise<UsageEstimate>;
}) {
  const t = useTranslations("AiUsage"),
    access = useAiUsageAccess();
  // Organization-scoped access, independent of warehouse permissions.
  return (
    <>
      <header className="mb-5 space-y-1.5 sm:mb-6">
        <h1 className="text-3xl leading-tight font-semibold tracking-tight text-text sm:text-4xl">
          {t("title")}
        </h1>
        <p className="text-base leading-relaxed text-muted">
          <span className="sm:hidden">{t("summaryShort")}</span>
          <span className="hidden sm:inline">{t("summary")}</span>
        </p>
      </header>
      {access.status === "LOADING" ? (
        <p role="status">{t("loading")}</p>
      ) : access.status === "READY" &&
        access.permissions.includes("aiUsage.read") ? (
        <UsageReport estimate={estimate} />
      ) : (
        <Notice title={t("denied")} />
      )}
    </>
  );
}

/** The resolved snapshot; undefined while it loads. */
function useEstimate(source: Promise<UsageEstimate>) {
  const [loaded, setLoaded] = useState<{
    source: Promise<UsageEstimate>;
    value: UsageEstimate;
  } | null>(null);
  useEffect(() => {
    let current = true;
    source.then(
      (value) => current && setLoaded({ source, value }),
      () =>
        current &&
        setLoaded({ source, value: unavailableEstimate(Date.now()) }),
    );
    return () => {
      current = false;
    };
  }, [source]);
  return loaded?.source === source ? loaded.value : undefined;
}

function UsageReport({
  estimate: source,
}: {
  estimate: Promise<UsageEstimate>;
}) {
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
  const loadedEstimate = useEstimate(source);
  useEstimateRefresh(loadedEstimate);
  // A page left open past a source's refresh window shows it as stale; the
  // CSV freezes exactly this snapshot.
  const estimate = useMemo(
    () =>
      loadedEstimate && withCurrentStatus(loadedEstimate, refreshKey * 1800000),
    [loadedEstimate, refreshKey],
  );
  const format = useUsageFormat(estimate ?? null);
  const label = (kind: Feature) => t(FEATURE_LABEL_KEYS[kind]);
  const shownFeatures = FEATURES.filter((kind) => !feature || feature === kind);
  async function exportCsv() {
    if (!data || !estimate) return;
    // One lifecycle per export: a newer export or the report's unmount (an
    // organization switch or sign-out unmounts it) invalidates this one.
    const life = exportLife.current,
      generation = ++life.generation,
      isCurrent = () => life.generation === generation;
    const scope = usageExportScope(data, filter, estimate);
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
    <div className="min-w-0 space-y-8">
      <UsageToolbar
        period={period}
        onPeriod={setPeriod}
        range={data?.range ?? null}
        timezone={data?.range.timezone ?? null}
        onDates={setDates}
        filters={filters}
        onFilters={setFilters}
        options={data ?? options}
        featureLabel={label}
      />
      {outcome === undefined ? (
        <div aria-busy="true" className="space-y-4">
          <p role="status" className="sr-only">
            {t("loading")}
          </p>
          <Skeleton className="h-24 w-full rounded-lg" />
          <div className="grid gap-4 sm:grid-cols-3">
            {FEATURES.map((kind) => (
              <Skeleton key={kind} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        </div>
      ) : !outcome.ok ? (
        <Notice tone="danger" role="alert" title={t("denied")} />
      ) : !data ? (
        <Notice tone="danger" role="alert" title={t("queryError")} />
      ) : (
        <>
          {data.trackingStartedAt ? (
            <p className="-mt-3 text-xs text-muted">
              {t("started", {
                date: new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                  timeZone: data.range.timezone,
                }).format(data.trackingStartedAt),
              })}
            </p>
          ) : null}
          {exportError ? (
            <Notice tone="danger" role="alert" title={t("exportError")} />
          ) : null}
          {!data.complete ? (
            <Notice tone="warning" title={t("partial")} />
          ) : null}
          <div>
            <UsageStatement
              report={data}
              features={shownFeatures}
              filterCount={activeFilterCount(filters)}
              estimate={estimate}
              format={format}
            />
            <FeatureStrip
              report={data}
              features={shownFeatures}
              selected={feature}
              onSelect={(next) => setFilters({ ...filters, feature: next })}
              featureLabel={label}
              format={format}
            />
            {shownFeatures.some(
              (kind) => data.byFeature[kind].operationCount > 0,
            ) ? (
              <p className="mt-2 max-w-prose text-xs leading-relaxed text-muted">
                {t("completeAverage")}
              </p>
            ) : null}
          </div>
          <UsageBreakdown
            report={data}
            featureLabel={label}
            format={format}
            csvExport={{
              canExport: estimate !== undefined,
              exporting,
              filtered: activeFilterCount(filters) > 0,
              onExport: () => void exportCsv(),
            }}
          />
          <RecentActivity
            args={args}
            signature={JSON.stringify(data.byFeature)}
            timezone={data.range.timezone}
            featureLabel={label}
            usd={format.usd}
            thb={format.thb}
          />
          <AutomaticEstimate
            estimate={estimate}
            format={format}
            timezone={data.range.timezone}
          />
        </>
      )}
    </div>
  );
}
