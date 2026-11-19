"use client";

import { useQuery } from "convex/react";
import { useRef, type ReactNode } from "react";

import { api } from "../../../convex/_generated/api";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { LedgerPanelStatus } from "@/components/system/LedgerPanelStatus";

/**
 * Customers are organization records. Once the member is signed in, the
 * customer queries authorize themselves, so the page depends on sign-in
 * alone: a pending, refused or failing warehouse workspace read never holds
 * it back or unmounts an open form. Before sign-in settles the page keeps
 * its header (`frame`).
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
  const { authenticated, readiness } = useWorkspace();
  if (authenticated) return <>{children}</>;
  return (
    <>
      {frame}
      <LedgerPanelStatus
        state={
          readiness.kind === "READY_TO_QUERY" ? { kind: "LOADING" } : readiness
        }
        label={loadingLabel}
      />
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
 * One command per submission, held in memory only. A transport retry of the
 * same submission resends the identical command: the same request ID and the
 * same frozen arguments (an edit's expected version), so the server can
 * replay it. Another form, another draft or any answered attempt starts a new
 * command. No field value is ever persisted.
 */
export function useSubmissionIdentity() {
  const last = useRef<{
    key: string;
    requestId: string;
    frozen: unknown;
  } | null>(null);
  return {
    request<T>(key: string, frozen: T): { requestId: string; frozen: T } {
      if (last.current?.key === key)
        return {
          requestId: last.current.requestId,
          frozen: last.current.frozen as T,
        };
      const requestId = crypto.randomUUID();
      last.current = { key, requestId, frozen };
      return { requestId, frozen };
    },
    clear() {
      last.current = null;
    },
  };
}
