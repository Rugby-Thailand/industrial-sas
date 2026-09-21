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
}: {
  outcome: CatalogueOutcome | undefined;
  continuation: Continuation;
  paging: Controller;
  resetKey?: string;
  hasRows?: (value: ReadyResult) => boolean;
}) {
  const resetAttempt = useRef<string | null>(null);
  useEffect(() => {
    if (!outcome?.ok) return;
    const value = outcome.value;
    if (value.status === "scanning") {
      continuation.advance(value.scanCursor);
      return;
    }
    if (value.status === "reset") {
      const key = resetKey ?? "default";
      if (
        resetAttempt.current !== key &&
        (paging.cursor || continuation.cursor)
      ) {
        resetAttempt.current = key;
        continuation.advance();
        paging.reset();
      }
      return;
    }
    if (value.status === "ready") resetAttempt.current = null;
    if (
      value.status === "ready" &&
      value.isDone &&
      !hasRows(value) &&
      paging.canPrevious
    ) {
      paging.previous();
    }
  }, [outcome, continuation, paging, resetKey, hasRows]);
}
