"use client";

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

export interface ReportingSourceProps<Value> {
  readonly children: (values: readonly Value[]) => ReactNode;
}

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
