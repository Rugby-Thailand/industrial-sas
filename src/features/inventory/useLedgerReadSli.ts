"use client";

/**
 * Emit one SLI event per settled ledger read.
 *
 * Three details decide whether this is useful or noise:
 *
 * - **Once per settled state, not once per render.** A React tree re-renders
 *   for reasons that have nothing to do with the server; a counter that
 *   incremented on each would measure React, not the ledger. The last reported
 *   key is remembered, and `LOADING` is never reported at all — it is the
 *   absence of an outcome.
 * - **Duration is measured from the mount that asked.** `PagedLedger` is keyed
 *   by warehouse and holds the cursor, so a mount corresponds to one question;
 *   the timer restarts when the cursor changes because the hook's own
 *   dependency does.
 * - **It records rather than reacts.** Nothing here sets state, so it cannot
 *   cascade a render, and a sink that throws is already swallowed by the port.
 */
import { useEffect, useRef } from "react";

import { useObservability } from "@/components/providers/ObservabilityProvider";
import type { LedgerPanelState } from "@/lib/convex/ledgerState";
import {
  recordLedgerRead,
  type LedgerReadOutcome,
  type LedgerReadSurface,
} from "@/lib/observability/sli";

/**
 * The key that identifies "this outcome, for this question".
 *
 * The request ID is included for a settled read so a retry that produces the
 * same kind is still one event; it is a server-minted opaque value, which is
 * exactly what a correlation dimension is allowed to be.
 */
const outcomeKey = <Row>(state: LedgerPanelState<Row>): string =>
  state.kind === "READY" ||
  state.kind === "DENIED" ||
  state.kind === "LEDGER_ERROR"
    ? `${state.kind}:${state.requestId}`
    : state.kind;

export function useLedgerReadSli<Row>(input: {
  readonly surface: LedgerReadSurface;
  readonly state: LedgerPanelState<Row>;
  readonly cursor: string | undefined;
}): void {
  const port = useObservability();
  const { surface, state, cursor } = input;

  const askedAt = useRef(0);
  const reported = useRef<string | undefined>(undefined);

  useEffect(() => {
    askedAt.current = Date.now();
    reported.current = undefined;
  }, [cursor, surface]);

  useEffect(() => {
    if (state.kind === "LOADING") return;

    const key = outcomeKey(state);
    if (reported.current === key) return;
    reported.current = key;

    const requestId =
      state.kind === "READY" ||
      state.kind === "DENIED" ||
      state.kind === "LEDGER_ERROR"
        ? state.requestId
        : undefined;

    recordLedgerRead(port, {
      surface,
      outcome: state.kind as LedgerReadOutcome,
      occurredAt: Date.now(),
      ...(askedAt.current === 0
        ? {}
        : { durationMs: Date.now() - askedAt.current }),
      ...(requestId === undefined ? {} : { requestId }),
    });
  }, [port, state, surface]);
}
