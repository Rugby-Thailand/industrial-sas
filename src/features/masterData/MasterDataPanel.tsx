"use client";

import { useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

import { useAppEnvironment } from "@/components/providers/EnvironmentProvider";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { QueryGate } from "@/components/system/QueryGate";
import {
  toLedgerPanelState,
  type LedgerPanelState,
  type ReadScope,
} from "@/lib/convex/ledgerState";
import type { MasterDataPage } from "@/lib/convex/masterDataApi";
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
import type { TenantOutcome } from "@/lib/convex/ledgerApi";

import { Button } from "@/components/ui/button";

import { EmptyState } from "@/components/ui/EmptyState";

export type QueryArgs = Record<string, never> | Record<string, unknown>;

export interface MasterDataPanelProps<Row, Args extends QueryArgs> {
  readonly queryRef: FunctionReference<
    "query",
    "public",
    Args,
    TenantOutcome<MasterDataPage<Row>>
  >;

  readonly scope: ReadScope;

  readonly buildArgs: (input: {
    readonly warehouseId: string;
    readonly cursor: string | undefined;
  }) => Args;
  readonly renderRows: (rows: readonly Row[]) => ReactNode;

  readonly paginationLabel?: string;
}

export function MasterDataPanel<Row, Args extends QueryArgs>(
  props: MasterDataPanelProps<Row, Args>,
) {
  const environment = useAppEnvironment();

  return (
    <QueryGate scope={props.scope}>
      {(warehouseId) => (
        <PagedMasterData
          key={`${props.scope}:${warehouseId}`}
          {...props}
          warehouseId={warehouseId}
          environment={environment}
        />
      )}
    </QueryGate>
  );
}

function PagedMasterData<Row, Args extends QueryArgs>({
  queryRef,
  scope,
  buildArgs,
  renderRows,
  paginationLabel,
  warehouseId,
  environment,
}: MasterDataPanelProps<Row, Args> & {
  readonly warehouseId: string;
  readonly environment: AppEnvironment;
}) {
  const [cursorState, setCursorState] =
    useState<CursorState>(initialCursorState);
  const cursor = currentCursor(cursorState);

  const render = (state: LedgerPanelState<Row>) => (
    <MasterDataBody
      state={state}
      cursorState={cursorState}
      onAdvance={(next) => setCursorState((current) => advance(current, next))}
      onRetreat={() => setCursorState((current) => retreat(current))}
      renderRows={renderRows}
      {...(paginationLabel === undefined ? {} : { paginationLabel })}
    />
  );

  return (
    <ServerMasterData
      queryRef={queryRef}
      args={buildArgs({ warehouseId, cursor })}
      scope={scope}
      warehouseId={warehouseId}
      environment={environment}
      render={render}
    />
  );
}

function ServerMasterData<Row, Args extends QueryArgs>({
  queryRef,
  args,
  scope,
  warehouseId,
  environment,
  render,
}: {
  readonly queryRef: MasterDataPanelProps<Row, Args>["queryRef"];
  readonly args: Args;
  readonly scope: ReadScope;
  readonly warehouseId: string;
  readonly environment: AppEnvironment;
  readonly render: (state: LedgerPanelState<Row>) => ReactNode;
}) {
  const outcome = useQuery(
    queryRef as FunctionReference<
      "query",
      "public",
      Record<string, unknown>,
      TenantOutcome<MasterDataPage<Row>>
    >,
    args as Record<string, unknown>,
  );
  return (
    <>
      {render(
        toLedgerPanelState<Row>({
          environment,
          warehouseId: scope === "ORG" ? "" : warehouseId,
          outcome,
          scope,
        }),
      )}
    </>
  );
}

function MasterDataBody<Row>({
  state,
  cursorState,
  onAdvance,
  onRetreat,
  renderRows,
  paginationLabel,
}: {
  readonly state: LedgerPanelState<Row>;
  readonly cursorState: CursorState;
  readonly onAdvance: (nextCursor: string | null) => void;
  readonly onRetreat: () => void;
  readonly renderRows: (rows: readonly Row[]) => ReactNode;
  readonly paginationLabel?: string;
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
        aria-label={paginationLabel ?? pagingT("pagination")}
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
