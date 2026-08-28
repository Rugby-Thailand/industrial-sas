"use client";

import { useQuery } from "convex/react";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { DataTable } from "@/components/table/DataTable";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { QueryGate } from "@/components/system/QueryGate";
import { Notice } from "@/components/ui/Notice";
import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
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

type StockView = "BALANCE" | "SKU" | "LOT" | "MOVEMENT";
const STOCK_VIEWS: readonly StockView[] = ["BALANCE", "SKU", "LOT", "MOVEMENT"];

type ReportOutcome<Payload> =
  | undefined
  | { readonly ok: false; readonly requestId: string }
  | { readonly ok: true; readonly requestId: string; readonly value: Payload };

export function OperationalReportsWorkbench() {
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId) => <ServerOperationalReports warehouseId={warehouseId} />}
    </QueryGate>
  );
}

export function ServerOperationalReports({
  warehouseId,
}: {
  readonly warehouseId: string;
}) {
  const stock = useQuery(readStockReportsRef, { warehouseId });
  const movements = useQuery(readStockMovementsRef, { warehouseId });
  const exceptions = useQuery(readOperationalExceptionsRef, { warehouseId });
  return (
    <OperationalReports
      stock={stock}
      movements={movements}
      exceptions={exceptions}
    />
  );
}

function OperationalReports({
  stock,
  movements,
  exceptions,
}: {
  readonly stock: ReportOutcome<StockReportsPayload>;
  readonly movements: ReportOutcome<StockMovementsPayload>;
  readonly exceptions: ReportOutcome<OperationalExceptionsPayload>;
}) {
  return (
    <div className="space-y-6">
      <ExceptionCenter outcome={exceptions} />
      <StockReportTabs stock={stock} movements={movements} />
    </div>
  );
}

function ExceptionCenter({
  outcome,
}: {
  readonly outcome: ReportOutcome<OperationalExceptionsPayload>;
}) {
  const t = useTranslations("OperationalReports");
  const locale = useLocale() as AppLocale;
  return (
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
      <ReportOutcomeState outcome={outcome}>
        {(exceptions) =>
          exceptions.exceptions.length === 0 ? (
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
          )
        }
      </ReportOutcomeState>
    </section>
  );
}

function StockReportTabs({
  stock,
  movements,
}: {
  readonly stock: ReportOutcome<StockReportsPayload>;
  readonly movements: ReportOutcome<StockMovementsPayload>;
}) {
  const t = useTranslations("OperationalReports");
  const [view, setView] = useState<StockView>("BALANCE");
  const tabRefs = useRef<Partial<Record<StockView, HTMLButtonElement | null>>>(
    {},
  );
  const selectAndFocus = (next: StockView) => {
    setView(next);
    tabRefs.current[next]?.focus();
  };
  const onTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    current: StockView,
  ) => {
    const index = STOCK_VIEWS.indexOf(current);
    let next: StockView | undefined;
    if (event.key === "ArrowRight")
      next = STOCK_VIEWS[(index + 1) % STOCK_VIEWS.length];
    if (event.key === "ArrowLeft")
      next = STOCK_VIEWS[(index - 1 + STOCK_VIEWS.length) % STOCK_VIEWS.length];
    if (event.key === "Home") next = STOCK_VIEWS[0];
    if (event.key === "End") next = STOCK_VIEWS.at(-1);
    if (next === undefined) return;
    event.preventDefault();
    selectAndFocus(next);
  };

  return (
    <section aria-labelledby="stock-reports-title" className="space-y-4">
      <div>
        <h2
          id="stock-reports-title"
          className="text-xl font-semibold text-text"
        >
          {t("stockTitle")}
        </h2>
      </div>
      <div
        role="tablist"
        aria-label={t("viewChooser")}
        className="flex flex-wrap gap-2"
      >
        {STOCK_VIEWS.map((option) => (
          <button
            key={option}
            ref={(node) => {
              tabRefs.current[option] = node;
            }}
            id={`stock-report-tab-${option.toLowerCase()}`}
            type="button"
            role="tab"
            tabIndex={view === option ? 0 : -1}
            aria-selected={view === option}
            aria-controls="stock-report-panel"
            className={`min-h-touch rounded-md border px-4 py-2 text-sm font-semibold ${view === option ? "border-accent bg-raised text-accent" : "border-border text-muted"}`}
            onClick={() => setView(option)}
            onKeyDown={(event) => onTabKeyDown(event, option)}
          >
            {t(`view.${option}`)}
          </button>
        ))}
      </div>
      <div
        id="stock-report-panel"
        role="tabpanel"
        aria-labelledby={`stock-report-tab-${view.toLowerCase()}`}
        tabIndex={0}
      >
        {view === "MOVEMENT" ? (
          <ReportOutcomeState outcome={movements}>
            {(payload) => (
              <ReportPayloadMeta payload={payload}>
                <MovementReport payload={payload} />
              </ReportPayloadMeta>
            )}
          </ReportOutcomeState>
        ) : (
          <ReportOutcomeState outcome={stock}>
            {(payload) => (
              <ReportPayloadMeta payload={payload}>
                {view === "BALANCE" ? (
                  <BalanceReport payload={payload} />
                ) : null}
                {view === "SKU" ? <SkuReport payload={payload} /> : null}
                {view === "LOT" ? <LotReport payload={payload} /> : null}
              </ReportPayloadMeta>
            )}
          </ReportOutcomeState>
        )}
      </div>
    </section>
  );
}

function ReportOutcomeState<Payload>({
  outcome,
  children,
}: {
  readonly outcome: ReportOutcome<Payload>;
  readonly children: (payload: Payload) => ReactNode;
}) {
  if (outcome === undefined)
    return <LedgerPanelStatus state={{ kind: "LOADING" }} />;
  if (!outcome.ok)
    return (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: outcome.requestId }}
      />
    );
  return <>{children(outcome.value)}</>;
}

function ReportPayloadMeta({
  payload,
  children,
}: {
  readonly payload: { readonly asOf: number; readonly complete: boolean };
  readonly children: ReactNode;
}) {
  const t = useTranslations("OperationalReports");
  const locale = useLocale() as AppLocale;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {t("asOf", { value: formatInstant(payload.asOf, locale) })}
        </p>
        <StatusBadge
          tone={payload.complete ? "success" : "warning"}
          label={payload.complete ? t("complete") : t("boundedPartial")}
        />
      </div>
      {!payload.complete ? (
        <Notice tone="warning" title={t("partialWarning")} />
      ) : null}
      {children}
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
  const dataRows = rows.map((cells, index) => ({
    key: String(index),
    cells,
  }));

  return (
    <DataTable<(typeof dataRows)[number]>
      caption={caption}
      testId={testId}
      rows={dataRows}
      rowKey={(row) => row.key}
      columns={headers.map((header, index) => ({
        key: String(index),
        header,
        rowHeader: index === 0,
        monospace: false,
        cellClassName:
          index === 0 ? "font-semibold whitespace-nowrap" : "whitespace-nowrap",
        render: (row) => row.cells[index],
      }))}
    />
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
