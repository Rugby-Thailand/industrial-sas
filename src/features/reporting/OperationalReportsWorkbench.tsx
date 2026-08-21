"use client";

import { useQuery } from "convex/react";
import { useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { QueryGate } from "@/components/system/QueryGate";
import { Notice } from "@/components/ui/Notice";
import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import { TableScroller } from "@/components/ui/TableScroller";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import {
  readOperationalExceptionsRef,
  readStockMovementsRef,
  readStockReportsRef,
  type OperationalExceptionsPayload,
  type StockMovementsPayload,
  type StockReportsPayload,
} from "@/lib/convex/reportingApi";
import {
  formatBusinessDateIso,
  formatInstant,
  formatMinorUnits,
} from "@/lib/formatters";
import {
  PREVIEW_OPERATIONAL_EXCEPTIONS,
  PREVIEW_STOCK_MOVEMENTS,
  PREVIEW_STOCK_REPORTS,
} from "@/lib/preview/reportingPreview";

type StockView = "BALANCE" | "SKU" | "LOT" | "MOVEMENT";

export function OperationalReportsWorkbench() {
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId, preview) =>
        preview ? (
          <OperationalReports
            stock={PREVIEW_STOCK_REPORTS}
            movements={PREVIEW_STOCK_MOVEMENTS}
            exceptions={PREVIEW_OPERATIONAL_EXCEPTIONS}
            preview
          />
        ) : (
          <ServerOperationalReports warehouseId={warehouseId} />
        )
      }
    </QueryGate>
  );
}

function ServerOperationalReports({
  warehouseId,
}: {
  readonly warehouseId: string;
}) {
  const stock = useQuery(readStockReportsRef, { warehouseId });
  const movements = useQuery(readStockMovementsRef, { warehouseId });
  const exceptions = useQuery(readOperationalExceptionsRef, { warehouseId });
  if (
    stock === undefined ||
    movements === undefined ||
    exceptions === undefined
  ) {
    return <LedgerPanelStatus state={{ kind: "LOADING" }} />;
  }
  if (!stock.ok || !movements.ok || !exceptions.ok) {
    return (
      <LedgerPanelStatus
        state={{
          kind: "DENIED",
          requestId:
            (!stock.ok ? stock.requestId : undefined) ??
            (!movements.ok ? movements.requestId : undefined) ??
            (!exceptions.ok ? exceptions.requestId : undefined) ??
            "",
        }}
      />
    );
  }
  return (
    <OperationalReports
      stock={stock.value}
      movements={movements.value}
      exceptions={exceptions.value}
    />
  );
}

function OperationalReports({
  stock,
  movements,
  exceptions,
  preview = false,
}: {
  readonly stock: StockReportsPayload;
  readonly movements: StockMovementsPayload;
  readonly exceptions: OperationalExceptionsPayload;
  readonly preview?: boolean;
}) {
  const t = useTranslations("OperationalReports");
  const locale = useLocale() as AppLocale;
  const [view, setView] = useState<StockView>("BALANCE");
  const complete = stock.complete && movements.complete && exceptions.complete;
  const asOf = Math.min(stock.asOf, movements.asOf, exceptions.asOf);
  return (
    <div className="space-y-6">
      {preview ? <Notice tone="accent" title={t("previewOnly")} /> : null}
      <section aria-labelledby="exception-center-title" className="space-y-4">
        <div>
          <h2
            id="exception-center-title"
            className="text-xl font-semibold text-text"
          >
            {t("exceptionTitle")}
          </h2>
          <p className="mt-1 text-sm text-muted">{t("exceptionHelp")}</p>
        </div>
        {exceptions.exceptions.length === 0 ? (
          <Notice tone="muted" title={t("exceptionEmpty")} />
        ) : (
          <ul
            className="grid gap-3 xl:grid-cols-2"
            data-testid="operational-exceptions"
          >
            {exceptions.exceptions.map((row) => (
              <li
                key={`${row.sourceType}:${row.sourceId}`}
                className="rounded-lg border border-border bg-surface p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-text">
                      {t(`exceptionCode.${row.titleCode}`)}
                    </h3>
                    <p className="mt-1 text-sm text-muted">{row.detail}</p>
                  </div>
                  <StatusBadge
                    tone={severityTone(row.severity)}
                    label={t(`severity.${row.severity}`)}
                  />
                </div>
                <p className="mt-3 text-xs text-muted">
                  {t("occurredAt")}: {formatInstant(row.occurredAt, locale)}
                </p>
                <Link
                  href={row.deepLink}
                  className="mt-3 inline-flex min-h-touch items-center text-sm font-semibold text-accent underline underline-offset-4"
                >
                  {t("openSource")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="stock-reports-title" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2
              id="stock-reports-title"
              className="text-xl font-semibold text-text"
            >
              {t("stockTitle")}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {t("asOf", { value: formatInstant(asOf, locale) })}
            </p>
          </div>
          <StatusBadge
            tone={complete ? "success" : "warning"}
            label={complete ? t("complete") : t("boundedPartial")}
          />
        </div>
        {!complete ? (
          <Notice tone="warning" title={t("partialWarning")} />
        ) : null}
        <div
          role="tablist"
          aria-label={t("viewChooser")}
          className="flex flex-wrap gap-2"
        >
          {(["BALANCE", "SKU", "LOT", "MOVEMENT"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={view === option}
              className={`min-h-touch rounded-md border px-4 py-2 text-sm font-semibold ${view === option ? "border-accent bg-raised text-accent" : "border-border text-muted"}`}
              onClick={() => setView(option)}
            >
              {t(`view.${option}`)}
            </button>
          ))}
        </div>
        {view === "BALANCE" ? <BalanceReport payload={stock} /> : null}
        {view === "SKU" ? <SkuReport payload={stock} /> : null}
        {view === "LOT" ? <LotReport payload={stock} /> : null}
        {view === "MOVEMENT" ? <MovementReport payload={movements} /> : null}
      </section>
    </div>
  );
}

function ReportTable({
  caption,
  headers,
  rows,
  testId,
}: {
  readonly caption: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly ReactNode[])[];
  readonly testId: string;
}) {
  return (
    <TableScroller label={caption} testId={testId}>
      <table className="w-full border-collapse text-sm">
        <caption className="px-4 py-3 text-left text-sm text-muted">
          {caption}
        </caption>
        <thead>
          <tr className="border-b border-border-strong text-left">
            {headers.map((header) => (
              <th
                key={header}
                scope="col"
                className="px-4 py-2 font-semibold whitespace-nowrap"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-border last:border-0">
              {row.map((cell, cellIndex) =>
                cellIndex === 0 ? (
                  <th
                    key={cellIndex}
                    scope="row"
                    className="px-4 py-3 text-left font-semibold whitespace-nowrap"
                  >
                    {cell}
                  </th>
                ) : (
                  <td key={cellIndex} className="px-4 py-3 whitespace-nowrap">
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}

function BalanceReport({ payload }: { readonly payload: StockReportsPayload }) {
  const t = useTranslations("OperationalReports");
  return (
    <ReportTable
      caption={t("caption.BALANCE", { count: payload.balances.length })}
      testId="report-stock-balance"
      headers={[
        t("column.sku"),
        t("column.location"),
        t("column.lot"),
        t("column.status"),
        t("column.quantity"),
        t("column.uom"),
      ]}
      rows={payload.balances.map((row) => [
        row.sku,
        row.locationCode ?? "—",
        row.lotCode ?? "—",
        row.stockStatus,
        formatMinorUnits(row.baseMinorUnits, row.baseUom),
        row.baseUom,
      ])}
    />
  );
}

function SkuReport({ payload }: { readonly payload: StockReportsPayload }) {
  const t = useTranslations("OperationalReports");
  return (
    <ReportTable
      caption={t("caption.SKU", { count: payload.sku.length })}
      testId="report-stock-sku"
      headers={[
        t("column.sku"),
        t("column.uom"),
        t("column.available"),
        t("column.committed"),
        t("column.atp"),
        t("column.qcHold"),
        t("column.rejected"),
      ]}
      rows={payload.sku.map((row) => [
        row.sku,
        row.baseUom,
        formatMinorUnits(row.availableBaseMinorUnits, row.baseUom),
        formatMinorUnits(row.committedBaseMinorUnits, row.baseUom),
        formatMinorUnits(row.atpBaseMinorUnits, row.baseUom),
        formatMinorUnits(row.qcHoldBaseMinorUnits, row.baseUom),
        formatMinorUnits(row.rejectedBaseMinorUnits, row.baseUom),
      ])}
    />
  );
}

function LotReport({ payload }: { readonly payload: StockReportsPayload }) {
  const t = useTranslations("OperationalReports");
  return (
    <ReportTable
      caption={t("caption.LOT", { count: payload.lots.length })}
      testId="report-stock-lot"
      headers={[
        t("column.lot"),
        t("column.sku"),
        t("column.uom"),
        t("column.expiry"),
        t("column.available"),
        t("column.restricted"),
      ]}
      rows={payload.lots.map((row) => [
        row.lotCode,
        row.sku,
        row.baseUom,
        row.expirationDate === undefined
          ? "—"
          : formatBusinessDateIso(row.expirationDate),
        formatMinorUnits(row.availableBaseMinorUnits, row.baseUom),
        formatMinorUnits(row.restrictedBaseMinorUnits, row.baseUom),
      ])}
    />
  );
}

function MovementReport({
  payload,
}: {
  readonly payload: StockMovementsPayload;
}) {
  const t = useTranslations("OperationalReports");
  const locale = useLocale() as AppLocale;
  return (
    <ReportTable
      caption={t("caption.MOVEMENT", { count: payload.movements.length })}
      testId="report-stock-movement"
      headers={[
        t("column.transaction"),
        t("column.time"),
        t("column.sku"),
        t("column.location"),
        t("column.status"),
        t("column.change"),
        t("column.uom"),
        t("column.actor"),
      ]}
      rows={payload.movements.map((row) => [
        row.transactionId,
        formatInstant(row.occurredAt, locale),
        row.sku,
        row.location,
        row.stockStatus,
        formatMinorUnits(row.signedBaseMinorUnits, row.baseUom),
        row.baseUom,
        row.actorUserId,
      ])}
    />
  );
}

function severityTone(
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
): BadgeTone {
  if (severity === "CRITICAL") return "danger";
  if (severity === "HIGH") return "warning";
  if (severity === "MEDIUM") return "pending";
  return "neutral";
}
