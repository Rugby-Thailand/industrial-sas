"use client";

import { useQuery } from "convex/react";
import { ArrowUpRight, CircleCheckBig } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { QueryGate } from "@/components/system/QueryGate";
import { Notice } from "@/components/ui/Notice";
import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import {
  type OperationalExceptionsPayload,
  readOperationalExceptionsRef,
} from "@/lib/convex/reportingApi";
import { formatInstant } from "@/lib/formatters";

const toneOf = (
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
): BadgeTone => {
  if (severity === "CRITICAL") return "danger";
  if (severity === "HIGH") return "warning";
  if (severity === "MEDIUM") return "pending";
  return "neutral";
};

export function OwnerAttentionListView({
  payload,
}: {
  readonly payload: OperationalExceptionsPayload;
}) {
  const owner = useTranslations("OwnerDashboard");
  const reports = useTranslations("OperationalReports");
  const locale = useLocale() as AppLocale;

  if (payload.exceptions.length === 0) {
    return (
      <div className="relative overflow-hidden rounded-xl border border-success/30 bg-success/5 p-5">
        <div
          aria-hidden="true"
          className="absolute -top-12 -right-12 size-36 rounded-full bg-success/10 blur-2xl"
        />
        <div className="relative flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-success/15 text-success">
            <CircleCheckBig aria-hidden="true" className="size-6" />
          </span>
          <div>
            <p className="font-semibold text-success">
              {owner("attentionEmpty")}
            </p>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted">
              {owner("attentionEmptyBody")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {!payload.complete ? (
        <Notice tone="warning" title={owner("attentionIncomplete")} />
      ) : null}
      <ul className="mt-3 grid gap-3" data-testid="owner-attention-list">
        {payload.exceptions.slice(0, 6).map((row) => (
          <li
            key={`${row.sourceType}:${row.sourceId}`}
            className="rounded-xl border border-border bg-raised/35 p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-text">
                  {reports(`exceptionCode.${row.titleCode}`)}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  {row.detail}
                </p>
              </div>
              <StatusBadge
                tone={toneOf(row.severity)}
                label={reports(`severity.${row.severity}`)}
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted">
                {reports("occurredAt")}: {formatInstant(row.occurredAt, locale)}
              </p>
              <Link
                href={row.deepLink}
                className="inline-flex min-h-touch items-center gap-1 text-sm font-semibold text-accent underline underline-offset-4"
              >
                {reports("openSource")}
                <ArrowUpRight aria-hidden="true" className="size-4" />
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Owner-first slice of the existing bounded operational exception view. */
export function OwnerAttentionList() {
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId) => <ServerOwnerAttentionList warehouseId={warehouseId} />}
    </QueryGate>
  );
}

function ServerOwnerAttentionList({
  warehouseId,
}: {
  readonly warehouseId: string;
}) {
  const outcome = useQuery(readOperationalExceptionsRef, { warehouseId });
  if (outcome === undefined)
    return <LedgerPanelStatus state={{ kind: "LOADING" }} />;
  if (!outcome.ok) {
    return (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: outcome.requestId }}
      />
    );
  }
  return <OwnerAttentionListView payload={outcome.value} />;
}
