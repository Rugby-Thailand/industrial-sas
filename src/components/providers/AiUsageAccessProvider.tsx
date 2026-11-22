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
  allowPartialAccess = false,
}: {
  readonly children: ReactNode;
  readonly allowPartialAccess?: boolean;
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
      if (failureCodeOf(queryError) === "ACTIVE_ORGANIZATION_MISSING")
        return { ...UNAVAILABLE, status: "NONE" };
      if (allowPartialAccess) return UNAVAILABLE;
      throw queryError;
    }
    if (outcome === undefined) return { ...UNAVAILABLE, status: "LOADING" };
    if (!outcome.ok) return { ...UNAVAILABLE, status: "NONE" };
    return {
      status: "READY",
      permissions: outcome.value.permissions,
      organizationName: outcome.value.organizationName,
    };
  }, [allowPartialAccess, isAuthenticated, isLoading, queryError, outcome]);
  return (
    <AiUsageAccessContext.Provider value={value}>
      {children}
    </AiUsageAccessContext.Provider>
  );
}

export function useAiUsageAccess(): AiUsageAccessValue {
  return useContext(AiUsageAccessContext);
}
