"use client";

import { useConvex, useMutation, useQuery } from "convex/react";
import { useLocale, useTranslations } from "next-intl";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Download } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { dayNumber } from "../../../convex/model/hr/calendar";
import { FEATURES, type Feature } from "../../../convex/model/aiUsage/usage";
import { useAiUsageAccess } from "@/components/providers/AiUsageAccessProvider";
import { clientRef, type RefValue } from "@/lib/convex/clientRef";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Notice } from "@/components/ui/Notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/FormField";
import { SelectControl } from "@/components/ui/SelectControl";
import { estimateThb } from "./estimate";
import { RecentActivity } from "./RecentActivity";
import {
  attemptsRef,
  exportUsage,
  operationsRef,
  usageExportScope,
} from "./usageExport";

const summaryRef = clientRef(api.aiUsage.reports.summary),
  configureRef = clientRef(api.aiUsage.reports.configure);
type Report = Exclude<RefValue<typeof summaryRef>, { error: string }>;
type Settings = Report["settings"];

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
  const [period, setPeriod] = useState<"month" | "today" | "custom">("month");
  const [dates, setDates] = useState<{ from: string; to: string } | null>(null);
  const [draftFrom, setDraftFrom] = useState(""),
    [draftTo, setDraftTo] = useState(""),
    [dateError, setDateError] = useState(false);
  const [feature, setFeature] = useState(""),
    [actorUserId, setUser] = useState(""),
    [warehouseId, setWarehouse] = useState(""),
    [requestedModel, setModel] = useState(""),
    [environment, setEnvironment] = useState("");
  const [exporting, setExporting] = useState(false),
    [exportError, setExportError] = useState(false);
  const exportLife = useRef({ generation: 0 });
  useEffect(() => {
    const life = exportLife.current;
    return () => {
      life.generation++;
    };
  }, []);
  const filter = {
    ...(feature ? { feature: feature as Feature } : {}),
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
  const num = (value: number, digits = 0) =>
    new Intl.NumberFormat(locale, {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    }).format(value);
  const usd = (nano: number) =>
    `US$${new Intl.NumberFormat(locale, { minimumFractionDigits: 6, maximumFractionDigits: 9 }).format(nano / 1e9)}`;
  const money = (nano: number): ReactNode => {
    const baht = data?.settings
      ? estimateThb(nano, data.settings.usdThbRate, 0)
      : null;
    return (
      <>
        <span>{usd(nano)}</span>
        {baht ? (
          <span className="block text-xs text-muted">
            ≈ ฿{num(baht.inference, 4)}
          </span>
        ) : null}
      </>
    );
  };
  const label = (kind: Feature) => t(FEATURE_LABEL_KEYS[kind]);
  const shownFeatures = FEATURES.filter((kind) => !feature || feature === kind);
  function applyDates(event: FormEvent) {
    event.preventDefault();
    const from = draftFrom || data?.range.from || "",
      to = draftTo || data?.range.to || "",
      a = dayNumber(from),
      b = dayNumber(to);
    if (a === null || b === null || b < a || b - a > 92) {
      setDateError(true);
      return;
    }
    setDateError(false);
    setDates({ from, to });
  }
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
  const selector = (
    id: string,
    title: string,
    value: string,
    set: (value: string) => void,
    options: { value: string; label: string }[],
  ) => (
    <FormField id={id} label={title}>
      {(props) => (
        <SelectControl
          id={props.id}
          value={value}
          label={title}
          onValueChange={set}
          options={options}
          placeholder={t("all")}
          emptyLabel={t("all")}
        />
      )}
    </FormField>
  );
  const all = { value: "", label: t("all") };
  const advancedFilters = (variant: string) => (
    <>
      {selector(`usage-${variant}-user`, t("user"), actorUserId, setUser, [
        all,
        ...(data?.users.map((u) => ({ value: u.id, label: u.name })) ?? []),
      ])}
      {selector(
        `usage-${variant}-warehouse`,
        t("warehouse"),
        warehouseId,
        setWarehouse,
        [
          all,
          ...(data?.warehouses.map((w) => ({
            value: w.id,
            label: w.name,
          })) ?? []),
        ],
      )}
      {selector(
        `usage-${variant}-model`,
        t("model"),
        requestedModel,
        setModel,
        [
          all,
          ...Array.from(new Set(data?.models ?? [])).map((model) => ({
            value: model,
            label: model,
          })),
        ],
      )}
      {selector(
        `usage-${variant}-environment`,
        t("environment"),
        environment,
        setEnvironment,
        [
          all,
          ...Array.from(new Set(data?.environments ?? [])).map((env) => ({
            value: env,
            label: env,
          })),
        ],
      )}
    </>
  );
  return (
    <div className="space-y-6">
      <Panel aria-label={t("period")}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {selector(
            "usage-period",
            t("period"),
            period,
            (value) => {
              setPeriod(value as typeof period);
              setDateError(false);
            },
            [
              { value: "month", label: t("month") },
              { value: "today", label: t("today") },
              { value: "custom", label: t("custom") },
            ],
          )}
          {selector("usage-feature", t("feature"), feature, setFeature, [
            all,
            ...FEATURES.map((kind) => ({ value: kind, label: label(kind) })),
          ])}
          <div className="hidden sm:contents">{advancedFilters("desktop")}</div>
        </div>
        <details className="mt-3 sm:hidden">
          <summary className="min-h-touch cursor-pointer text-sm font-medium">
            {t("moreFilters")}
          </summary>
          <div className="mt-3 grid gap-4">{advancedFilters("mobile")}</div>
        </details>
        {period === "custom" ? (
          <form
            onSubmit={applyDates}
            className="mt-4 flex flex-wrap items-end gap-3"
          >
            <FormField id="usage-from" label={t("from")}>
              {(props) => (
                <Input
                  {...props}
                  type="date"
                  value={draftFrom || data?.range.from || ""}
                  onChange={(e) => setDraftFrom(e.target.value)}
                  required
                />
              )}
            </FormField>
            <FormField id="usage-to" label={t("to")}>
              {(props) => (
                <Input
                  {...props}
                  type="date"
                  value={draftTo || data?.range.to || ""}
                  onChange={(e) => setDraftTo(e.target.value)}
                  required
                />
              )}
            </FormField>
            <Button type="submit">{t("apply")}</Button>
            {dateError ? (
              <p role="alert" className="w-full text-sm text-danger">
                {t("dateInvalid")}
              </p>
            ) : null}
          </form>
        ) : null}
      </Panel>
      {outcome === undefined ? (
        <p role="status">{t("loading")}</p>
      ) : !data ? (
        <Notice tone="danger" title={t("queryError")} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              {data.range.from} – {data.range.to} · {data.range.timezone}
            </p>
            <Button
              variant="outline"
              onClick={() => void exportCsv()}
              disabled={exporting}
            >
              <Download aria-hidden="true" className="size-4" />
              {t(exporting ? "exporting" : "export")}
            </Button>
          </div>
          {exportError ? (
            <Notice tone="danger" title={t("exportError")} />
          ) : null}
          {!data.complete ? (
            <Notice tone="warning" title={t("partial")} />
          ) : null}
          <Panel className="overflow-hidden p-0">
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[700px] text-sm tabular-nums">
                <caption className="sr-only">{t("title")}</caption>
                <thead className="bg-surface-subtle border-b border-border text-left text-muted">
                  <tr>
                    {[
                      "feature",
                      "operations",
                      "attempts",
                      "cost",
                      "average",
                      "coverage",
                    ].map((key) => (
                      <th key={key} scope="col" className="p-4 font-medium">
                        {t(key as "feature")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shownFeatures.map((kind) => {
                    const m = data.byFeature[kind];
                    return (
                      <tr
                        key={kind}
                        className="border-b border-border last:border-b-0"
                      >
                        <th scope="row" className="p-4 text-left font-semibold">
                          {label(kind)}
                        </th>
                        <td className="p-4">{num(m.operationCount)}</td>
                        <td className="p-4">
                          {num(m.attemptCount)}
                          <span className="block text-xs text-muted">
                            {t("retries")}{" "}
                            {num(m.attemptCount - m.operationCount)}
                          </span>
                        </td>
                        <td className="p-4">{money(m.knownCostUsdNano)}</td>
                        <td className="p-4">
                          {m.completeOperationCount
                            ? money(
                                m.completeCostUsdNano /
                                  m.completeOperationCount,
                              )
                            : "—"}
                          <span className="block text-xs text-muted">
                            {num(m.completeOperationCount)} {t("known")}
                          </span>
                        </td>
                        <td className="p-4">
                          <span
                            className={
                              m.unknownAttemptCount
                                ? "text-warning"
                                : "text-muted"
                            }
                          >
                            {t("unknown", { count: m.unknownAttemptCount })}
                          </span>
                          <span className="block text-xs text-muted">
                            {t("pending", { count: m.pendingCount })}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="divide-y divide-border md:hidden">
              {shownFeatures.map((kind) => {
                const m = data.byFeature[kind];
                return (
                  <section
                    key={kind}
                    className="space-y-3 p-4"
                    aria-label={label(kind)}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h2 className="font-semibold">{label(kind)}</h2>
                      <p className="text-sm tabular-nums">
                        {num(m.operationCount)} {t("operations")}
                      </p>
                    </div>
                    <dl className="grid grid-cols-2 gap-3 text-sm tabular-nums">
                      <div>
                        <dt className="mb-1 text-xs text-muted">{t("cost")}</dt>
                        <dd>{money(m.knownCostUsdNano)}</dd>
                      </div>
                      <div>
                        <dt className="mb-1 text-xs text-muted">
                          {t("average")}
                        </dt>
                        <dd>
                          {m.completeOperationCount
                            ? money(
                                m.completeCostUsdNano /
                                  m.completeOperationCount,
                              )
                            : "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted">{t("attempts")}</dt>
                        <dd>
                          {num(m.attemptCount)} · {t("retries")}{" "}
                          {num(m.attemptCount - m.operationCount)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted">{t("coverage")}</dt>
                        <dd>
                          {t("unknown", { count: m.unknownAttemptCount })}
                        </dd>
                      </div>
                    </dl>
                    {m.pendingCount ? (
                      <p className="text-xs text-warning">
                        {t("pending", { count: m.pendingCount })}
                      </p>
                    ) : null}
                  </section>
                );
              })}
            </div>
            <p className="border-t border-border p-4 text-xs leading-relaxed text-muted">
              {t("completeAverage")}
            </p>
          </Panel>
          <p className="max-w-prose text-sm leading-relaxed text-muted">
            {data.settings
              ? t("estimate", {
                  rate: num(data.settings.usdThbRate, 4),
                  fee: num(data.settings.feePercent, 2),
                })
              : t("noFx")}
          </p>
          {data.settings ? (
            <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
              {shownFeatures.map((kind) => {
                const value = estimateThb(
                  data.byFeature[kind].knownCostUsdNano,
                  data.settings!.usdThbRate,
                  data.settings!.feePercent,
                );
                if (!value) return null;
                return (
                  <div key={kind}>
                    <dt className="text-muted">
                      {label(kind)} · {t("withFee")}
                    </dt>
                    <dd className="mt-1 font-medium tabular-nums">
                      ฿{num(value.withFundingFee, 4)}{" "}
                      <span className="text-xs font-normal text-muted">
                        ({t("fee")} ฿{num(value.fundingFee, 4)})
                      </span>
                    </dd>
                  </div>
                );
              })}
            </dl>
          ) : null}
          <section aria-labelledby="usage-breakdown">
            <h2 id="usage-breakdown" className="mb-3 text-lg font-semibold">
              {t("breakdown")}
            </h2>
            {!data.breakdown.length ? (
              <Panel>
                <p className="max-w-prose text-sm leading-relaxed text-muted">
                  {t("empty")}
                </p>
              </Panel>
            ) : (
              <Panel className="divide-y divide-border py-0">
                {data.breakdown.map((row, i) => (
                  <div
                    key={i}
                    className="grid gap-3 py-4 md:grid-cols-[2fr_1fr_1fr]"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">
                        {data.users.find((u) => u.id === row.actorUserId)
                          ?.name ?? row.actorUserId}
                      </p>
                      <p className="mt-1 text-xs break-words text-muted">
                        {label(row.feature)} ·{" "}
                        {data.warehouses.find((w) => w.id === row.warehouseId)
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
                    <div className="text-sm tabular-nums">
                      {money(row.metrics.knownCostUsdNano)}
                      {row.metrics.unknownAttemptCount ? (
                        <p className="mt-1 text-xs text-warning">
                          {t("unknown", {
                            count: row.metrics.unknownAttemptCount,
                          })}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </Panel>
            )}
            <p className="mt-3 text-xs leading-relaxed text-muted">
              {t("details")}
            </p>
          </section>
          <RecentActivity
            args={args}
            signature={JSON.stringify(data.byFeature)}
            timezone={data.range.timezone}
            featureLabel={label}
            money={money}
          />
          {data.trackingStartedAt ? (
            <p className="text-xs text-muted">
              {t("started", {
                date: new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                  timeZone: data.range.timezone,
                }).format(data.trackingStartedAt),
              })}
            </p>
          ) : null}
          {canConfigure ? <SettingsForm settings={data.settings} /> : null}
        </>
      )}
    </div>
  );
}

function SettingsForm({ settings }: { settings: Settings }) {
  const [open, setOpen] = useState(!settings);
  const t = useTranslations("AiUsage"),
    save = useMutation(configureRef);
  const [rate, setRate] = useState(settings ? String(settings.usdThbRate) : ""),
    [fee, setFee] = useState(settings ? String(settings.feePercent) : "5.5"),
    [source, setSource] = useState(settings?.source ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    setState("saving");
    try {
      const result = await save({
        usdThbRate: Number(rate),
        feePercent: Number(fee),
        source,
      });
      setState(result.ok && result.value.ok ? "saved" : "error");
    } catch {
      setState("error");
    }
  }
  return (
    <Panel>
      <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="min-h-touch cursor-pointer font-semibold">
          {t("settings")}
        </summary>
        <p className="mb-4 max-w-prose text-sm leading-relaxed text-muted">
          {t("settingsNote")}
        </p>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FormField id="usage-fx" label={t("fx")} required>
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  min="0.000001"
                  max="1000"
                  step="any"
                  value={rate}
                  onChange={(e) => {
                    setRate(e.target.value);
                    setState("idle");
                  }}
                  required
                  disabled={state === "saving"}
                />
              )}
            </FormField>
            <FormField id="usage-fee" label={t("feePercent")} required>
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  value={fee}
                  onChange={(e) => {
                    setFee(e.target.value);
                    setState("idle");
                  }}
                  required
                  disabled={state === "saving"}
                />
              )}
            </FormField>
            <FormField id="usage-source" label={t("source")} required>
              {(props) => (
                <Input
                  {...props}
                  value={source}
                  maxLength={160}
                  onChange={(e) => {
                    setSource(e.target.value);
                    setState("idle");
                  }}
                  required
                  disabled={state === "saving"}
                />
              )}
            </FormField>
          </div>
          <Button type="submit" disabled={state === "saving"}>
            {t(state === "saving" ? "saving" : "save")}
          </Button>
          {state === "error" || state === "saved" ? (
            <p
              role="status"
              className={
                state === "error"
                  ? "text-sm text-danger"
                  : "text-sm text-success"
              }
            >
              {t(state === "error" ? "settingsError" : "saved")}
            </p>
          ) : null}
        </form>
      </details>
    </Panel>
  );
}
