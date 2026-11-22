"use client";

import { useConvexAuth, useQuery_experimental } from "convex/react";
import { createContext, useContext, useMemo, type ReactNode } from "react";

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
  const query = useQuery_experimental({
    query: aiUsageAccessRef,
    args: !isLoading && isAuthenticated ? {} : "skip",
  });
  const failed = query.status === "error";
  const outcome = query.status === "success" ? query.data : undefined;
  const value = useMemo<AiUsageAccessValue>(() => {
    if (isLoading) return { ...UNAVAILABLE, status: "LOADING" };
    if (!isAuthenticated || failed) return UNAVAILABLE;
    if (outcome === undefined) return { ...UNAVAILABLE, status: "LOADING" };
    if (!outcome.ok) return { ...UNAVAILABLE, status: "NONE" };
    return {
      status: "READY",
      permissions: outcome.value.permissions,
      organizationName: outcome.value.organizationName,
    };
  }, [failed, isAuthenticated, isLoading, outcome]);
  return (
    <AiUsageAccessContext.Provider value={value}>
      {children}
    </AiUsageAccessContext.Provider>
  );
}

/** For environments without a configured backend or identity provider. */
export function UnavailableAiUsageAccessProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <AiUsageAccessContext.Provider value={UNAVAILABLE}>
      {children}
    </AiUsageAccessContext.Provider>
  );
}

export function useAiUsageAccess(): AiUsageAccessValue {
  return useContext(AiUsageAccessContext);
}
