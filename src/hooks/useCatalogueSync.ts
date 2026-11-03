"use client";

import { useEffect, useRef } from "react";

type ScanResult = {
  status: "scanning";
  scanCursor?: string;
};
type ResetResult = { status: "reset" };
type ReadyResult = {
  status: "ready" | "not_ready";
  isDone?: boolean;
  page?: readonly unknown[];
  products?: readonly unknown[];
  pallets?: readonly unknown[];
};
export type CatalogueOutcome =
  { ok: true; value: ScanResult | ResetResult | ReadyResult } | { ok: false };

type Controller = {
  cursor: string | null | undefined;
  canPrevious: boolean;
  reset: () => void;
  previous: () => void;
};
type Continuation = {
  cursor: string | undefined;
  advance: (cursor?: string) => void;
};

function defaultHasRows(value: ReadyResult) {
  if (value.page) return value.page.length > 0;
  return Boolean(value.products?.length || value.pallets?.length);
}

/** Synchronize bounded scans and cursor recovery for catalogue queries. */
export function useCatalogueSync({
  outcome,
  continuation,
  paging,
  resetKey,
  hasRows = defaultHasRows,
  maxAutomaticResets = 1,
}: {
  outcome: CatalogueOutcome | undefined;
  continuation: Continuation;
  paging?: Controller;
  resetKey?: string;
  hasRows?: (value: ReadyResult) => boolean;
  maxAutomaticResets?: number;
}) {
  const recovery = useRef({
    key: resetKey,
    attempts: 0,
    awaitingProgress: false,
  });
  const retry = () => {
    recovery.current = { key: resetKey, attempts: 0, awaitingProgress: true };
    continuation.advance();
    paging?.reset();
  };
  useEffect(() => {
    if (recovery.current.key !== resetKey) {
      recovery.current = {
        key: resetKey,
        attempts: 0,
        awaitingProgress: false,
      };
    }
    if (!outcome?.ok) return;
    const value = outcome.value;
    if (value.status === "scanning") {
      // Progress permits another reset, but only a completed scan replenishes
      // the budget. Otherwise continuous writes can cause an endless retry loop.
      recovery.current.awaitingProgress = false;
      continuation.advance(value.scanCursor);
      return;
    }
    if (value.status === "reset") {
      if (
        !recovery.current.awaitingProgress &&
        recovery.current.attempts < maxAutomaticResets &&
        (paging?.cursor || continuation.cursor)
      ) {
        recovery.current.attempts += 1;
        recovery.current.awaitingProgress = true;
        continuation.advance();
        paging?.reset();
      }
      return;
    }
    if (value.status === "ready") {
      recovery.current.attempts = 0;
      recovery.current.awaitingProgress = false;
    }
    if (
      value.status === "ready" &&
      value.isDone &&
      !hasRows(value) &&
      paging?.canPrevious
    ) {
      paging.previous();
    }
  }, [outcome, continuation, paging, resetKey, hasRows, maxAutomaticResets]);
  return { retry };
}
