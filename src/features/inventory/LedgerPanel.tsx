"use client";

/**
 * One paged ledger read, from environment gate to rendered rows.
 *
 * Both inventory screens are the same component with a different function
 * reference and a different table, because the interesting part is identical:
 * decide whether the read is even possible, ask the server (or the preview
 * fixture), map the answer onto the states in `ledgerState.ts`, and page.
 *
 * ### The order of the checks
 *
 * The gate runs *before* anything is asked. `BACKEND_MISSING`,
 * `SIGN_IN_REQUIRED`, and `WAREHOUSE_MISSING` are decided from the environment
 * and the workspace alone, so an unconfigured machine shows the reason
 * immediately instead of a spinner that becomes a denial one round trip later —
 * and, just as importantly, `useQuery` is never called without a
 * `ConvexProvider` above it, which would throw.
 *
 * ### Why paging resets on a warehouse change
 *
 * A cursor is only meaningful inside the query that produced it. Carrying one
 * across warehouses asks the server to resume a scan of a different index, and
 * the honest outcomes are a refusal or, worse, a page of the wrong site's rows.
 *
 * ### What this component cannot do
 *
 * Write. There is no mutation here, no optimistic update, and no local edit of a
 * balance: `INV-0003-11` is that no API sets a balance, and `INV-0009-04` is
 * that no client cache pretends one changed. Convex query subscriptions are
 * live, so a confirmed posting arrives on its own — which is the only way a
 * number on this screen ever changes.
 */
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
import { previewPage } from "@/lib/preview/ledgerPreview";

import { LedgerErrorBoundary } from "./LedgerErrorBoundary";
import { useLedgerReadSli } from "./useLedgerReadSli";

import { Button } from "@/components/ui/button";

import { EmptyState } from "@/components/ui/EmptyState";

export interface LedgerPanelProps<Row> {
  /** The public query this panel reads. */
  readonly queryRef: FunctionReference<
    "query",
    "public",
    LedgerPageArgs,
    TenantOutcome<LedgerPage<Row>>
  >;
  /** Synthetic rows of the same shape, used only in preview mode. */
  readonly previewRowsFor: (warehouseId: string) => readonly Row[];
  /** Renders one page of rows. */
  readonly renderRows: (rows: readonly Row[]) => ReactNode;
  /**
   * Which screen is asking. A closed set, because it becomes a telemetry
   * dimension and a free-form label there is an unbounded cardinality problem.
   */
  readonly surface: LedgerReadSurface;
}

export function LedgerPanel<Row>({
  queryRef,
  previewRowsFor,
  renderRows,
  surface,
}: LedgerPanelProps<Row>) {
  const environment = useAppEnvironment();

  /*
   * `key` is how the paging state resets when the warehouse changes. The
   * alternative — an effect that sets the cursor back to the first page — is a
   * cascading render and, worse, leaves one render in which the old cursor is
   * paired with the new warehouse. Remounting makes the reset atomic, and it is
   * React's own answer to "state that should not survive an input change".
   */
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId) => (
        <PagedLedger
          key={warehouseId}
          queryRef={queryRef}
          previewRowsFor={previewRowsFor}
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
  previewRowsFor,
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

  if (environment.previewMode) {
    return (
      <PreviewLedgerPanel
        warehouseId={warehouseId}
        cursor={cursor}
        previewRowsFor={previewRowsFor}
        surface={surface}
        render={render}
      />
    );
  }

  return (
    <LedgerErrorBoundary
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
    </LedgerErrorBoundary>
  );
}

/* -------------------------------------------------------------------------- */
/* Sources                                                                     */
/* -------------------------------------------------------------------------- */

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

  useLedgerReadSli({ surface, state, preview: false, cursor });

  return <>{render(state)}</>;
}

/**
 * The preview source, paged through the same contract the server uses.
 *
 * `previewPage` can only refuse on a malformed cursor, which the controls below
 * cannot produce; an out-of-range cursor collapses to an empty final page rather
 * than a fabricated error, because a synthetic failure would be indistinguishable
 * on screen from a real one.
 */
function PreviewLedgerPanel<Row>({
  warehouseId,
  cursor,
  previewRowsFor,
  surface,
  render,
}: {
  readonly warehouseId: string;
  readonly cursor: string | undefined;
  readonly previewRowsFor: (warehouseId: string) => readonly Row[];
  readonly surface: LedgerReadSurface;
  readonly render: (state: LedgerPanelState<Row>) => ReactNode;
}) {
  const page = previewPage(
    previewRowsFor(warehouseId),
    DEFAULT_LEDGER_PAGE_SIZE,
    cursor,
  );
  const state: LedgerPanelState<Row> = page.ok
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
      };

  /*
   * Preview reads are recorded too, and carry `preview: true`. An SLI series
   * that silently mixed synthetic and real reads would be worse than one that
   * omitted the synthetic ones; a dimension makes them separable.
   */
  useLedgerReadSli({ surface, state, preview: true, cursor });

  return <>{render(state)}</>;
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                   */
/* -------------------------------------------------------------------------- */

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
