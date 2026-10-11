"use client";

import type { ReactNode } from "react";

import type { TenantOutcome } from "@/lib/convex/ledgerApi";

import { LedgerPanelStatus } from "./LedgerPanelStatus";

/**
 * The minimal transport contract shared by query outcomes: a loaded value,
 * or a refusal identified by its request ID. Feature outcomes with more
 * detail (TenantOutcome's success request ID and denial metadata, or a
 * feature's own refusal shape) satisfy it without casts or invented fields.
 */
export type GateOutcome =
  { readonly ok: true } | { readonly ok: false; readonly requestId: string };

/**
 * Presents loading (`undefined`) and refused outcomes, then renders the
 * successful outcome. The refusal keeps its request ID so a denied read is
 * never replaced by a misleading empty or missing state.
 */
export function OutcomeGate<Outcome extends GateOutcome>({
  outcome,
  children,
}: {
  readonly outcome: Outcome | undefined;
  readonly children: (outcome: Extract<Outcome, { ok: true }>) => ReactNode;
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
  return <>{children(outcome as Extract<Outcome, { ok: true }>)}</>;
}

/** OutcomeGate for tenant-scoped Convex reads, passing the success request ID. */
export function DataGate<Value>({
  outcome,
  children,
}: {
  readonly outcome: TenantOutcome<Value> | undefined;
  readonly children: (value: Value, requestId: string) => ReactNode;
}): ReactNode {
  return (
    <OutcomeGate outcome={outcome}>
      {(ok) => children(ok.value, ok.requestId)}
    </OutcomeGate>
  );
}
