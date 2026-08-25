"use client";

import { useEffect, useRef } from "react";

import { useObservability } from "@/components/providers/ObservabilityProvider";
import type { LedgerPanelState } from "@/lib/convex/ledgerState";
import {
  recordLedgerRead,
  type LedgerReadOutcome,
  type LedgerReadSurface,
} from "@/lib/observability/sli";

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
