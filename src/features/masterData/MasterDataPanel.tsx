"use client";

/**
 * One paged master-data read, gated and rendered.
 *
 * The sibling of `LedgerPanel`, and deliberately not a merge with it. They share
 * the state machine (`toLedgerPanelState`), the paging reducer, the status
 * component, and the error boundary — everything where a difference would be a
 * defect. What they do not share is scope: a ledger read is always
 * warehouse-scoped, and master data is mixed, so this panel takes a `scope` and
 * an argument builder rather than assuming a warehouse.
 *
 * Merging them would mean one component with two argument shapes, two gates, and
 * a boolean deciding which — which is the shape that later grows a third case
 * nobody notices.
 */
import { useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";

import { useAppEnvironment } from "@/components/providers/EnvironmentProvider";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { Notice } from "@/components/ui/Notice";
import { DEFAULT_LEDGER_PAGE_SIZE } from "@/lib/convex/ledgerApi";
import {
  resolveLedgerGate,
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
import { previewMasterDataPage } from "@/lib/preview/masterDataPreview";
import type { TenantOutcome } from "@/lib/convex/ledgerApi";

/**
 * Convex constrains a function's arguments to `Record<string, any>`. Stating
 * that constraint here rather than at each call site is what lets the panel be
 * generic over an organization-scoped argument shape and a warehouse-scoped one
 * without either of them widening the other.
 */
export type QueryArgs = Record<string, never> | Record<string, unknown>;

export interface MasterDataPanelProps<Row, Args extends QueryArgs> {
  readonly queryRef: FunctionReference<
    "query",
    "public",
    Args,
    TenantOutcome<MasterDataPage<Row>>
  >;
  /** Whether this read needs a selected warehouse. */
  readonly scope: ReadScope;
  /**
   * The query arguments, given the resolved warehouse and cursor. A function
   * rather than an object so a warehouse-scoped list can name its own argument
   * and an organization-scoped one can omit it entirely.
   */
  readonly buildArgs: (input: {
    readonly warehouseId: string;
    readonly cursor: string | undefined;
  }) => Args;
  /** Synthetic rows for the same shape, used only in preview mode. */
  readonly previewRowsFor: (warehouseId: string) => readonly Row[];
  readonly renderRows: (rows: readonly Row[]) => ReactNode;
}

export function MasterDataPanel<Row, Args extends QueryArgs>(
  props: MasterDataPanelProps<Row, Args>,
) {
  const environment = useAppEnvironment();
  const workspace = useWorkspace();

  const gate = resolveLedgerGate(
    environment,
    workspace.selectedWarehouseId,
    props.scope,
  );
  if (gate.kind !== "READY_TO_QUERY") return <LedgerPanelStatus state={gate} />;

  // Keyed by warehouse for the same reason the ledger panel is: a cursor is only
  // meaningful inside the query that produced it.
  return (
    <PagedMasterData
      key={`${props.scope}:${gate.warehouseId}`}
      {...props}
      warehouseId={gate.warehouseId}
      environment={environment}
    />
  );
}

function PagedMasterData<Row, Args extends QueryArgs>({
  queryRef,
  scope,
  buildArgs,
  previewRowsFor,
  renderRows,
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
    />
  );

  if (environment.previewMode) {
    const page = previewMasterDataPage(
      previewRowsFor(warehouseId),
      DEFAULT_LEDGER_PAGE_SIZE,
      cursor,
    );
    return (
      <>
        {render(
          page.ok
            ? {
                kind: "READY",
                rows: page.items,
                nextCursor: page.nextCursor,
                complete: page.complete,
                requestId: "preview",
              }
            : {
                kind: "READY",
                rows: [],
                nextCursor: null,
                complete: true,
                requestId: "preview",
              },
        )}
      </>
    );
  }

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
  /*
   * The generic is erased here, and only here. `useQuery`'s signature is
   * variadic — `(query, ...argsOrSkip)` — and TypeScript cannot decide whether
   * a still-generic `Args` makes that rest parameter optional, so the call does
   * not type-check while `Args` is open. Widening to the same
   * `Record<string, unknown>` Convex itself constrains arguments to keeps the
   * *caller's* types intact: `buildArgs` is checked against the reference's own
   * argument type above, which is where a wrong argument would actually be
   * written.
   */
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
}: {
  readonly state: LedgerPanelState<Row>;
  readonly cursorState: CursorState;
  readonly onAdvance: (nextCursor: string | null) => void;
  readonly onRetreat: () => void;
  readonly renderRows: (rows: readonly Row[]) => ReactNode;
}) {
  const panelT = useTranslations("Panel");
  const inventoryT = useTranslations("Inventory");

  if (state.kind !== "READY") return <LedgerPanelStatus state={state} />;

  if (state.rows.length === 0) {
    return (
      <Notice tone="muted" title={panelT("empty")} body={panelT("emptyHint")} />
    );
  }

  const page = pageNumber(cursorState);

  return (
    <div className="flex flex-col gap-4">
      {renderRows(state.rows)}
      <nav
        aria-label={inventoryT("pagination")}
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <p className="text-sm text-muted">
          {state.complete
            ? inventoryT("complete")
            : inventoryT("pageIndicator", { page })}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            className="min-h-touch rounded-md border border-border-strong px-4 font-medium disabled:text-disabled"
            disabled={isFirstPage(cursorState)}
            onClick={onRetreat}
          >
            {inventoryT("previousPage")}
          </button>
          <button
            type="button"
            className="min-h-touch rounded-md border border-border-strong px-4 font-medium disabled:text-disabled"
            disabled={state.nextCursor === null}
            onClick={() => onAdvance(state.nextCursor)}
          >
            {inventoryT("nextPage")}
          </button>
        </div>
      </nav>
    </div>
  );
}
