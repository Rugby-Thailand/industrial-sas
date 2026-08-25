"use client";

import { useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

import { useAppEnvironment } from "@/components/providers/EnvironmentProvider";
import { useObservability } from "@/components/providers/ObservabilityProvider";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { QueryGate } from "@/components/system/QueryGate";
import {
  DEFAULT_LEDGER_PAGE_SIZE,
  type LedgerPage,
  type LedgerPageArgs,
  type TenantOutcome,
} from "@/lib/convex/ledgerApi";
import {
  failureCodeOf,
  toLedgerPanelState,
  type LedgerPanelState,
} from "@/lib/convex/ledgerState";
import {
  advance,
  currentCursor,
  initialCursorState,
  isFirstPage,
  pageNumber,
  retreat,
  type CursorState,
} from "@/lib/convex/pagination";
import type { AppEnvironment } from "@/lib/environment";
import {
  recordClientError,
  type LedgerReadSurface,
} from "@/lib/observability/sli";

import { QueryErrorBoundary } from "@/components/system/QueryErrorBoundary";
import { useLedgerReadSli } from "./useLedgerReadSli";

import { Button } from "@/components/ui/button";

import { EmptyState } from "@/components/ui/EmptyState";

export interface LedgerPanelProps<Row> {
  readonly queryRef: FunctionReference<
    "query",
    "public",
    LedgerPageArgs,
    TenantOutcome<LedgerPage<Row>>
  >;

  readonly renderRows: (rows: readonly Row[]) => ReactNode;

  readonly surface: LedgerReadSurface;
}

export function LedgerPanel<Row>({
  queryRef,
  renderRows,
  surface,
}: LedgerPanelProps<Row>) {
  const environment = useAppEnvironment();

  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId) => (
        <PagedLedger
          key={warehouseId}
          queryRef={queryRef}
          renderRows={renderRows}
          surface={surface}
          warehouseId={warehouseId}
          environment={environment}
        />
      )}
    </QueryGate>
  );
}

function PagedLedger<Row>({
  queryRef,
  renderRows,
  surface,
  warehouseId,
  environment,
}: LedgerPanelProps<Row> & {
  readonly warehouseId: string;
  readonly environment: AppEnvironment;
}) {
  const observability = useObservability();
  const [cursorState, setCursorState] =
    useState<CursorState>(initialCursorState);
  const cursor = currentCursor(cursorState);

  const render = (state: LedgerPanelState<Row>) => (
    <LedgerPanelBody
      state={state}
      cursorState={cursorState}
      onAdvance={(next) => setCursorState((current) => advance(current, next))}
      onRetreat={() => setCursorState((current) => retreat(current))}
      renderRows={renderRows}
    />
  );

  return (
    <QueryErrorBoundary
      resetKey={`${warehouseId}:${cursor ?? ""}`}
      onFailure={(failure) =>
        recordClientError(observability, {
          code: failureCodeOf(failure),
          surface,
          occurredAt: Date.now(),
        })
      }
      fallback={(failure) =>
        render(
          toLedgerPanelState<Row>({
            environment,
            warehouseId,
            outcome: undefined,
            failure,
          }),
        )
      }
    >
      <ServerLedgerPanel
        queryRef={queryRef}
        warehouseId={warehouseId}
        cursor={cursor}
        surface={surface}
        environment={environment}
        render={render}
      />
    </QueryErrorBoundary>
  );
}

function ServerLedgerPanel<Row>({
  queryRef,
  warehouseId,
  cursor,
  surface,
  environment,
  render,
}: {
  readonly queryRef: LedgerPanelProps<Row>["queryRef"];
  readonly warehouseId: string;
  readonly cursor: string | undefined;
  readonly surface: LedgerReadSurface;
  readonly environment: AppEnvironment;
  readonly render: (state: LedgerPanelState<Row>) => ReactNode;
}) {
  const outcome = useQuery(queryRef, {
    warehouseId,
    maxPageSize: DEFAULT_LEDGER_PAGE_SIZE,
    ...(cursor === undefined ? {} : { cursor }),
  });
  const state = toLedgerPanelState<Row>({ environment, warehouseId, outcome });

  useLedgerReadSli({ surface, state, cursor });

  return <>{render(state)}</>;
}

function LedgerPanelBody<Row>({
  state,
  cursorState,
  onAdvance,
  onRetreat,
  renderRows,
}: {
  readonly state: LedgerPanelState<Row>;
  readonly cursorState: CursorState;
  readonly onAdvance: (nextCursor: string | null) => void;
  readonly onRetreat: () => void;
  readonly renderRows: (rows: readonly Row[]) => ReactNode;
}) {
  const panelT = useTranslations("Panel");
  const pagingT = useTranslations("Pagination");

  if (state.kind !== "READY") return <LedgerPanelStatus state={state} />;

  if (state.rows.length === 0) {
    return <EmptyState title={panelT("empty")} body={panelT("emptyHint")} />;
  }

  const page = pageNumber(cursorState);

  return (
    <div className="flex flex-col gap-4">
      {renderRows(state.rows)}
      <nav
        aria-label={pagingT("pagination")}
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <p className="text-sm text-muted">
          {state.complete
            ? pagingT("complete")
            : pagingT("pageIndicator", { page })}
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={isFirstPage(cursorState)}
            onClick={onRetreat}
          >
            {pagingT("previousPage")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={state.nextCursor === null}
            onClick={() => onAdvance(state.nextCursor)}
          >
            {pagingT("nextPage")}
          </Button>
        </div>
      </nav>
    </div>
  );
}
