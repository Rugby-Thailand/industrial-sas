"use client";

import { useConvex } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { api } from "../../../convex/_generated/api";
import type { Feature } from "../../../convex/model/aiUsage/usage";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/Notice";
import { Panel } from "@/components/ui/Panel";
import { clientRef, type RefValue } from "@/lib/convex/clientRef";

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
  money,
}: {
  readonly args: RecentArgs;
  readonly signature: string;
  readonly timezone: string;
  readonly featureLabel: (feature: Feature) => string;
  readonly money: (nano: number) => ReactNode;
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
  const status = (item: RecentItem) => (
    <span className={`font-medium ${STATUS_TONE[item.status]}`}>
      {t(`statusLabel.${item.status}`)}
    </span>
  );
  const calls = (item: RecentItem) => (
    <>
      {t("callCount", { count: item.attemptCount })}
      {item.attemptCount > 1 ? (
        <span className="block text-xs text-muted">
          {t("retries")} {num(item.attemptCount - 1)}
        </span>
      ) : null}
    </>
  );
  const model = (item: RecentItem) => {
    const other = item.actualModels.filter((m) => m !== item.requestedModel);
    return (
      <>
        <span className="break-words">{item.requestedModel}</span>
        {other.length ? (
          <span className="block text-xs break-words text-muted">
            {t("actualModel")}: {other.join(", ")}
          </span>
        ) : null}
      </>
    );
  };
  const cost = (item: RecentItem) => (
    <>
      {item.unknownAttemptCount < item.attemptCount ? (
        money(item.knownCostUsdNano)
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
    </>
  );
  const actor = (item: RecentItem) => item.actorName ?? t("unknownUser");
  const warehouse = (item: RecentItem) =>
    item.warehouseId === null
      ? t("noWarehouse")
      : (item.warehouseName ?? t("unknownWarehouse"));

  return (
    <section aria-labelledby="usage-recent" aria-busy={shown === null}>
      <h2 id="usage-recent" className="mb-1 text-lg font-semibold">
        {t("recent")}
      </h2>
      <p className="mb-3 text-xs leading-relaxed text-muted">
        {t("recentHint", { timezone })}
      </p>
      {shown === null ? (
        <p role="status" className="text-sm text-muted">
          {t("recentLoading")}
        </p>
      ) : (
        <div className="space-y-3">
          {shown.signature !== signature ? (
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
          {shown.items.length === 0 && !shown.error ? (
            <Panel>
              <p className="max-w-prose text-sm leading-relaxed text-muted">
                {shown.cursor ? t("recentNoneYet") : t("recentEmpty")}
              </p>
            </Panel>
          ) : null}
          {shown.items.length ? (
            <Panel className="overflow-hidden p-0">
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[860px] text-sm tabular-nums">
                  <caption className="sr-only">{t("recent")}</caption>
                  <thead className="bg-surface-subtle border-b border-border text-left text-muted">
                    <tr>
                      {(
                        [
                          "time",
                          "feature",
                          "user",
                          "warehouse",
                          "model",
                          "result",
                          "attempts",
                          "cost",
                        ] as const
                      ).map((column) => (
                        <th
                          key={column}
                          scope="col"
                          className="p-3 font-medium"
                        >
                          {t(column)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.items.map((item) => (
                      <tr
                        key={item.operationId}
                        className="border-b border-border align-top last:border-b-0"
                      >
                        <th
                          scope="row"
                          className="p-3 text-left font-medium whitespace-nowrap"
                        >
                          <time
                            dateTime={new Date(item.startedAt).toISOString()}
                          >
                            {when.format(item.startedAt)}
                          </time>
                        </th>
                        <td className="p-3">{featureLabel(item.feature)}</td>
                        <td className="p-3 break-words">{actor(item)}</td>
                        <td className="p-3 break-words">{warehouse(item)}</td>
                        <td className="max-w-48 p-3">{model(item)}</td>
                        <td className="p-3">{status(item)}</td>
                        <td className="p-3">{calls(item)}</td>
                        <td className="p-3">{cost(item)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="divide-y divide-border md:hidden">
                {shown.items.map((item) => (
                  <li key={item.operationId} className="min-w-0 space-y-2 p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-semibold">
                        {featureLabel(item.feature)}
                      </p>
                      <time
                        className="text-xs text-muted"
                        dateTime={new Date(item.startedAt).toISOString()}
                      >
                        {when.format(item.startedAt)}
                      </time>
                    </div>
                    <p className="text-xs break-words text-muted">
                      {actor(item)} · {warehouse(item)}
                    </p>
                    <dl className="grid grid-cols-2 gap-3 text-sm tabular-nums">
                      <div className="min-w-0">
                        <dt className="mb-1 text-xs text-muted">
                          {t("result")}
                        </dt>
                        <dd>{status(item)}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="mb-1 text-xs text-muted">{t("cost")}</dt>
                        <dd>{cost(item)}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="mb-1 text-xs text-muted">
                          {t("attempts")}
                        </dt>
                        <dd>{calls(item)}</dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="mb-1 text-xs text-muted">
                          {t("model")}
                        </dt>
                        <dd className="text-xs">{model(item)}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
          {shown.error ? (
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
          {shown.cursor && !shown.error ? (
            <Button
              variant="outline"
              onClick={() => void loadMore()}
              disabled={loadingMore !== null}
            >
              {t(loadingMore !== null ? "recentLoadingMore" : "recentMore")}
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}
