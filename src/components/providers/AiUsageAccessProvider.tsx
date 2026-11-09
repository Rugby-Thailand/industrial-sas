"use client";

import { useConvexAuth, useQuery_experimental } from "convex/react";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import { failureCodeOf } from "@/lib/convex/ledgerState";
import { api } from "../../../convex/_generated/api";
import { clientRef } from "@/lib/convex/clientRef";

export const aiUsageAccessRef = clientRef(api.aiUsage.reports.access);

export interface AiUsageAccessValue {
  /** LOADING until settled; NONE when the member cannot read the report. */
  readonly status: "UNAVAILABLE" | "LOADING" | "READY" | "NONE";
  readonly permissions: readonly string[];
  readonly organizationName?: string;
}

const UNAVAILABLE: AiUsageAccessValue = Object.freeze({
  status: "UNAVAILABLE",
  permissions: [],
});

const AiUsageAccessContext = createContext<AiUsageAccessValue>(UNAVAILABLE);

/**
 * AI usage report access, queried separately from the storage workspace and
 * HR access so a member holding only the organization-scoped usage
 * permissions can find and open the report. Display only: every report
 * function authorizes on the server.
 */
export function AiUsageAccessProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const queryState = useQuery_experimental({
    query: aiUsageAccessRef,
    args: !isLoading && isAuthenticated ? {} : "skip",
  });
  const outcome = queryState.status === "success" ? queryState.data : undefined;
  const queryError =
    queryState.status === "error" ? queryState.error : undefined;
  const value = useMemo<AiUsageAccessValue>(() => {
    if (isLoading) return { ...UNAVAILABLE, status: "LOADING" };
    if (!isAuthenticated) return UNAVAILABLE;
    if (queryError !== undefined) {
      // No active organization is a normal signed-in state (the chooser
      // handles it); any other failure must still reach the error boundary.
      if (failureCodeOf(queryError) !== "ACTIVE_ORGANIZATION_MISSING")
        throw queryError;
      return { ...UNAVAILABLE, status: "NONE" };
    }
    if (outcome === undefined) return { ...UNAVAILABLE, status: "LOADING" };
    if (!outcome.ok) return { ...UNAVAILABLE, status: "NONE" };
    return {
      status: "READY",
      permissions: outcome.value.permissions,
      organizationName: outcome.value.organizationName,
    };
  }, [isAuthenticated, isLoading, queryError, outcome]);
  return (
    <AiUsageAccessContext.Provider value={value}>
      {children}
    </AiUsageAccessContext.Provider>
  );
}

export function useAiUsageAccess(): AiUsageAccessValue {
  return useContext(AiUsageAccessContext);
}
