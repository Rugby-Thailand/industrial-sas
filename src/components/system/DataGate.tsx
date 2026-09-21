"use client";

import type { ReactNode } from "react";

import type { TenantOutcome } from "@/lib/convex/ledgerApi";

import { LedgerPanelStatus } from "./LedgerPanelStatus";

/**
 * Presents the transport states shared by tenant scoped Convex reads.
 * Keeping the denial request id here prevents feature screens from replacing
 * an authorization result with a misleading empty or missing state.
 */
export function DataGate<Value>({
  outcome,
  children,
}: {
  readonly outcome: TenantOutcome<Value> | undefined;
  readonly children: (value: Value, requestId: string) => ReactNode;
}): ReactNode {
  if (outcome === undefined) {
    return <LedgerPanelStatus state={{ kind: "LOADING" }} />;
  }
  if (!outcome.ok) {
    return (
      <LedgerPanelStatus
        state={{ kind: "DENIED", requestId: outcome.requestId }}
      />
    );
  }
  return <>{children(outcome.value, outcome.requestId)}</>;
}
