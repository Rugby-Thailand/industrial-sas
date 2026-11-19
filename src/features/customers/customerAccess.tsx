"use client";

import { useQuery } from "convex/react";
import { useRef, type ReactNode } from "react";

import { api } from "../../../convex/_generated/api";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";

/**
 * Customers are organization records. The warehouse workspace feed refuses a
 * member without warehouse access, but that refusal says nothing about
 * customers: once identity is settled, customer queries authorize themselves.
 * While identity is still settling, the page keeps its header (`frame`).
 */
export function CustomerGate({
  frame,
  loadingLabel,
  children,
}: {
  readonly frame?: ReactNode;
  readonly loadingLabel: string;
  readonly children: ReactNode;
}) {
  const { readiness } = useWorkspace();
  if (readiness.kind === "READY_TO_QUERY" || readiness.kind === "DENIED")
    return <>{children}</>;
  return (
    <>
      {frame}
      <LedgerPanelStatus state={readiness} label={loadingLabel} />
    </>
  );
}

/** Display affordance from the customer grants themselves; every write is still authorized. */
export function useCustomerAccess(): {
  readonly ready: boolean;
  readonly canManage: boolean;
} {
  const outcome = useQuery(api.customers.catalogue.viewer, {});
  return {
    ready: outcome !== undefined,
    canManage: outcome?.ok === true && outcome.value.canManage,
  };
}

/**
 * One command identity per submission, held in memory only: a transport
 * retry of the same submission reuses it, while another form, another draft
 * or any answered attempt gets a new one. No field value is ever persisted.
 */
export function useSubmissionIdentity() {
  const last = useRef<{ key: string; requestId: string } | null>(null);
  return {
    request(key: string): string {
      if (last.current?.key === key) return last.current.requestId;
      const requestId = crypto.randomUUID();
      last.current = { key, requestId };
      return requestId;
    },
    clear() {
      last.current = null;
    },
  };
}
