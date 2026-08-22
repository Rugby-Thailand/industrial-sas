"use client";

/**
 * The reporting reads, gated the same way every other data source here is.
 *
 * `useQuery` throws without a `ConvexProvider`, and there is no provider when no
 * deployment is configured — so the gate is resolved first and the branch that
 * queries is a separate component. Same split as `MasterDataPanel` and the
 * inbound option sources; stated again because a new feature is exactly where
 * somebody reaches for a hook and finds out at runtime.
 *
 * Each source hands its caller the rows *and* the honest failure states, because
 * a dashboard that rendered zeroes for "denied" would be the worst version of
 * this screen: a supervisor would act on numbers that were never read.
 */
import { useQuery } from "convex/react";
import type { ReactNode } from "react";

import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";
import { QueryGate } from "@/components/system/QueryGate";
import { Notice } from "@/components/ui/Notice";
import {
  listReportJobsRef,
  readDashboardRef,
  readOccupancyRef,
  type DashboardTile,
  type OccupancyCell,
  type ReportJobRow,
} from "@/lib/convex/reportingApi";

/** What every reporting source hands its caller. */
export interface ReportingSourceProps<Value> {
  readonly children: (values: readonly Value[]) => ReactNode;
}

/** Resolve the warehouse gate, or render the reason it could not be resolved. */
function GateOr({
  render,
}: {
  readonly render: (warehouseId: string) => ReactNode;
}): ReactNode {
  return (
    <QueryGate scope="WAREHOUSE">
      {(warehouseId) => render(warehouseId)}
    </QueryGate>
  );
}

/**
 * A read that has answered, is still answering, or was refused.
 *
 * Three endings rendered in one place so no reporting screen invents a fourth.
 * `LOADING` matters here more than elsewhere: a tile that showed `0` while its
 * read was in flight would flicker from "nothing to do" to "seven waiting",
 * which is precisely the moment a supervisor decides to walk away.
 */
function Answered<Value>({
  outcome,
  rows,
  children,
}: {
  readonly outcome:
    { readonly ok: boolean; readonly requestId?: string } | undefined;
  readonly rows: () => readonly Value[];
  readonly children: (values: readonly Value[]) => ReactNode;
}): ReactNode {
  if (outcome === undefined) {
    return <LedgerPanelStatus state={{ kind: "LOADING" }} />;
  }
  if (!outcome.ok) {
    return (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: outcome.requestId ?? "" }}
      />
    );
  }
  return <>{children(rows())}</>;
}

/* -------------------------------------------------------------------------- */
/* Dashboard tiles                                                             */
/* -------------------------------------------------------------------------- */

export function OperationsCounters(props: ReportingSourceProps<DashboardTile>) {
  return (
    <GateOr
      render={(warehouseId) => (
        <ServerCounters {...props} warehouseId={warehouseId} />
      )}
    />
  );
}

function ServerCounters({
  warehouseId,
  children,
}: ReportingSourceProps<DashboardTile> & { readonly warehouseId: string }) {
  const outcome = useQuery(readDashboardRef, { warehouseId });

  return (
    <Answered
      outcome={outcome}
      rows={() => (outcome?.ok ? outcome.value.tiles : [])}
    >
      {children}
    </Answered>
  );
}

/* -------------------------------------------------------------------------- */
/* Occupancy                                                                   */
/* -------------------------------------------------------------------------- */

export interface OccupancyAnswer {
  readonly cells: readonly OccupancyCell[];
  readonly complete: boolean;
}

export function Occupancy({
  children,
}: {
  readonly children: (answer: OccupancyAnswer) => ReactNode;
}) {
  return (
    <GateOr
      render={(warehouseId) => (
        <ServerOccupancy warehouseId={warehouseId}>{children}</ServerOccupancy>
      )}
    />
  );
}

function ServerOccupancy({
  warehouseId,
  children,
}: {
  readonly warehouseId: string;
  readonly children: (answer: OccupancyAnswer) => ReactNode;
}) {
  const outcome = useQuery(readOccupancyRef, { warehouseId });

  return (
    <Answered
      outcome={outcome}
      rows={() => (outcome?.ok ? [outcome.value] : [])}
    >
      {(values) => {
        const answer = values[0];
        return answer === undefined
          ? null
          : children({ cells: answer.cells, complete: answer.complete });
      }}
    </Answered>
  );
}

/* -------------------------------------------------------------------------- */
/* Export register                                                             */
/* -------------------------------------------------------------------------- */

export function ReportJobs({
  emptyTitle,
  emptyBody,
  children,
}: ReportingSourceProps<ReportJobRow> & {
  readonly emptyTitle: string;
  readonly emptyBody: string;
}) {
  const render = (jobs: readonly ReportJobRow[]) =>
    jobs.length === 0 ? (
      <Notice
        tone="muted"
        title={emptyTitle}
        body={emptyBody}
        testId="reports-none"
      />
    ) : (
      children(jobs)
    );

  return (
    <GateOr
      render={(warehouseId) => (
        <ServerReportJobs warehouseId={warehouseId}>{render}</ServerReportJobs>
      )}
    />
  );
}

function ServerReportJobs({
  warehouseId,
  children,
}: {
  readonly warehouseId: string;
  readonly children: (jobs: readonly ReportJobRow[]) => ReactNode;
}) {
  const outcome = useQuery(listReportJobsRef, { warehouseId });

  return (
    <Answered
      outcome={outcome}
      rows={() => (outcome?.ok ? outcome.value.jobs : [])}
    >
      {children}
    </Answered>
  );
}
