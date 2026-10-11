"use client";

import { useConvex } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { useLocale, useTranslations } from "next-intl";
import { ArrowDown, ChevronDown } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Feature } from "../../../convex/model/aiUsage/usage";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/Notice";
import { clientRef, type RefValue } from "@/lib/convex/clientRef";
import { CELL, NUMERIC, UsageTable } from "./UsageTable";

export const recentRef = clientRef(api.aiUsage.reports.recent);
type RecentPage = Exclude<RefValue<typeof recentRef>, { error: string }>;
type RecentItem = RecentPage["items"][number];
type RecentArgs = Omit<FunctionArgs<typeof recentRef>, "cursor">;

interface Loaded {
  /** The range and filters these rows answer. */
  readonly key: string;
  /** The report totals when the first page loaded; a change means newer activity. */
  readonly signature: string;
  readonly items: readonly RecentItem[];
  readonly cursor: string | null;
  readonly error: boolean;
}

const STATUS_TONE: Readonly<Record<RecentItem["status"], string>> = {
  SUCCEEDED: "text-success",
  UNREADABLE: "text-warning",
  PROVIDER_ERROR: "text-danger",
  TIMEOUT: "text-danger",
  NETWORK_ERROR: "text-danger",
  INTERRUPTED: "text-warning",
  PENDING: "text-pending",
};

function merge(
  existing: readonly RecentItem[],
  next: readonly RecentItem[],
): readonly RecentItem[] {
  const seen = new Set(existing.map((item) => item.operationId));
  return [...existing, ...next.filter((item) => !seen.has(item.operationId))];
}

/**
 * Recent operations for the report's period and filters, newest first, in
 * bounded pages. Rows answer exactly the arguments they were loaded for: a
 * response for a previous period or filter is discarded, and newer activity
 * is announced instead of silently reshuffling pages already read.
 */
export function RecentActivity({
  args,
  signature,
  timezone,
  featureLabel,
  usd,
  thb,
}: {
  readonly args: RecentArgs;
  readonly signature: string;
  readonly timezone: string;
  readonly featureLabel: (feature: Feature) => string;
  readonly usd: (nano: number) => string;
  /** The inference-only baht estimate, or null without a rate. */
  readonly thb: (nano: number) => string | null;
}) {
  const t = useTranslations("AiUsage"),
    locale = useLocale(),
    convex = useConvex();
  const key = JSON.stringify(args);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [reload, setReload] = useState(0);
  const [loadingMore, setLoadingMore] = useState<string | null>(null);
  const signatureRef = useRef(signature);
  useEffect(() => {
    signatureRef.current = signature;
  }, [signature]);
  useEffect(() => {
    let current = true;
    const requested = JSON.parse(key) as RecentArgs;
    const atSignature = signatureRef.current;
    convex.query(recentRef, requested).then(
      (outcome) => {
        if (!current) return;
        const page =
          outcome.ok && !("error" in outcome.value) ? outcome.value : null;
        setLoaded({
          key,
          signature: atSignature,
          items: page?.items ?? [],
          cursor: page?.continueCursor ?? null,
          error: page === null,
        });
      },
      () => {
        if (current)
          setLoaded({
            key,
            signature: atSignature,
            items: [],
            cursor: null,
            error: true,
          });
      },
    );
    return () => {
      current = false;
    };
  }, [convex, key, reload]);

  const shown = loaded?.key === key ? loaded : null;
  async function loadMore() {
    if (!shown?.cursor) return;
    const cursor = shown.cursor;
    setLoadingMore(cursor);
    try {
      const outcome = await convex.query(recentRef, { ...args, cursor });
      const page =
        outcome.ok && !("error" in outcome.value) ? outcome.value : null;
      // Apply only to the list this request continued.
      setLoaded((previous) =>
        previous && previous.key === key && previous.cursor === cursor
          ? page
            ? {
                ...previous,
                items: merge(previous.items, page.items),
                cursor: page.continueCursor,
              }
            : { ...previous, error: true }
          : previous,
      );
    } catch {
      setLoaded((previous) =>
        previous && previous.key === key && previous.cursor === cursor
          ? { ...previous, error: true }
          : previous,
      );
    } finally {
      setLoadingMore((pending) => (pending === cursor ? null : pending));
    }
  }

  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  });
  const num = (value: number) => new Intl.NumberFormat(locale).format(value);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const status = (item: RecentItem) => (
    <span className={`font-medium ${STATUS_TONE[item.status]}`}>
      {t(`statusLabel.${item.status}`)}
    </span>
  );
  const confirmed = (item: RecentItem) =>
    item.unknownAttemptCount < item.attemptCount;
  const actor = (item: RecentItem) => item.actorName ?? t("unknownUser");
  const warehouse = (item: RecentItem) =>
    item.warehouseId === null
      ? t("noWarehouse")
      : (item.warehouseName ?? t("unknownWarehouse"));
  const columns = [
    {
      key: "time",
      label: (
        <span className="inline-flex items-center gap-1">
          {t("time")}
          <ArrowDown aria-hidden="true" className="size-3.5" />
          <span className="sr-only">{t("newestFirst")}</span>
        </span>
      ),
    },
    { key: "user", label: t("colUser") },
    { key: "warehouse", label: t("warehouse") },
    { key: "action", label: t("colAction") },
    { key: "model", label: t("colModel") },
    { key: "usd", label: t("colCostUsd"), numeric: true },
    { key: "thb", label: t("colCostThb"), numeric: true },
  ];
  const loading = shown === null;
  const empty =
    shown && shown.items.length === 0 && !shown.error
      ? shown.cursor
        ? t("recentNoneYet")
        : t("recentEmpty")
      : undefined;

  return (
    <section
      aria-labelledby="usage-recent"
      aria-busy={loading}
      className="space-y-2"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="usage-recent" className="text-lg font-semibold sm:text-xl">
          {t("recent")}
        </h2>
        <p className="sr-only">{t("recentHint", { timezone })}</p>
      </div>
      {shown && shown.signature !== signature ? (
        <Notice tone="accent" title={t("recentStale")}>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => setReload((value) => value + 1)}
          >
            {t("recentRefresh")}
          </Button>
        </Notice>
      ) : null}
      <UsageTable
        label={t("recent")}
        columns={columns}
        minWidth="min-w-[840px]"
        {...(loading ? { status: t("recentLoading") } : {})}
        {...(empty === undefined ? {} : { empty })}
      >
        {shown?.items.map((item) => {
          const open = expanded.has(item.operationId);
          const detailsId = `usage-attempts-${item.operationId}`;
          const other = item.actualModels.filter(
            (m) => m !== item.requestedModel,
          );
          return (
            <Fragment key={item.operationId}>
              <tr
                className={`align-top ${open ? "" : "border-b border-border"}`}
              >
                <th
                  scope="row"
                  className={`${CELL} text-left font-medium whitespace-nowrap`}
                >
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={detailsId}
                    onClick={() => toggle(item.operationId)}
                    className="-m-1 inline-flex items-center gap-1.5 rounded p-1 text-left hover:text-link focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <ChevronDown
                      aria-hidden="true"
                      className={`size-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
                    />
                    <time dateTime={new Date(item.startedAt).toISOString()}>
                      {when.format(item.startedAt)}
                    </time>
                    <span className="sr-only">
                      {t(open ? "attemptsHide" : "attemptsShow")}
                    </span>
                  </button>
                </th>
                <td className={`${CELL} break-words`}>{actor(item)}</td>
                <td className={`${CELL} break-words`}>{warehouse(item)}</td>
                <td className={CELL}>
                  <span className="block">{featureLabel(item.feature)}</span>
                  <span className="block text-xs">{status(item)}</span>
                  {item.attemptCount > 1 ? (
                    <span className="block text-xs text-muted">
                      {t("callCount", { count: item.attemptCount })}
                    </span>
                  ) : null}
                </td>
                <td className={`${CELL} max-w-48 break-words`}>
                  {item.requestedModel}
                </td>
                <td className={`${CELL} ${NUMERIC} wrap-anywhere`}>
                  {confirmed(item) ? (
                    usd(item.knownCostUsdNano)
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                  {item.unknownAttemptCount ? (
                    <span className="block text-xs text-warning">
                      {item.status === "PENDING"
                        ? t("statusLabel.PENDING")
                        : t("unknown", { count: item.unknownAttemptCount })}
                    </span>
                  ) : null}
                </td>
                <td className={`${CELL} ${NUMERIC} text-muted`}>
                  {confirmed(item) ? (thb(item.knownCostUsdNano) ?? "—") : "—"}
                </td>
              </tr>
              {open ? (
                <tr id={detailsId} className="border-b border-border">
                  <td colSpan={columns.length} className="px-2 pb-3 sm:px-4">
                    <dl className="grid gap-x-6 gap-y-2 rounded-md bg-raised px-4 py-3 text-xs sm:grid-cols-4">
                      <div className="min-w-0">
                        <dt className="text-muted">{t("attempts")}</dt>
                        <dd className="tabular-nums">
                          {t("callCount", { count: item.attemptCount })}
                          {item.attemptCount > 1
                            ? ` · ${t("retries")} ${num(item.attemptCount - 1)}`
                            : null}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-muted">{t("actualModel")}</dt>
                        <dd className="break-words">
                          {(other.length ? other : item.actualModels).join(
                            ", ",
                          ) || "—"}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-muted">{t("duration")}</dt>
                        <dd className="tabular-nums">
                          {t("seconds", {
                            seconds: num(item.durationMs / 1000),
                          })}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-muted">{t("operationId")}</dt>
                        <dd className="font-mono break-all">
                          {item.operationId}
                        </dd>
                      </div>
                    </dl>
                  </td>
                </tr>
              ) : null}
            </Fragment>
          );
        })}
      </UsageTable>
      {shown?.error ? (
        <Notice tone="danger" role="alert" title={t("recentError")}>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => setReload((value) => value + 1)}
          >
            {t("recentRetry")}
          </Button>
        </Notice>
      ) : null}
      {shown?.cursor && !shown.error ? (
        <Button
          variant="outline"
          onClick={() => void loadMore()}
          disabled={loadingMore !== null}
        >
          {t(loadingMore !== null ? "recentLoadingMore" : "recentMore")}
        </Button>
      ) : null}
    </section>
  );
}
