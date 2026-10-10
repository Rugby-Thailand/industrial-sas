"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import { hrRefs } from "@/lib/convex/hrApi";

export interface HrSite {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface HrAccessValue {
  /** LOADING until settled; NONE when the member holds no HR permission. */
  readonly status: "UNAVAILABLE" | "LOADING" | "READY" | "NONE";
  readonly permissions: readonly string[];
  readonly organizationName?: string;
  readonly timezone?: string;
  readonly timezoneSupported: boolean;
  readonly today?: string;
  readonly employee?: { readonly code: string; readonly displayName: string };
  readonly sites: readonly HrSite[];
  /** False when the member's site scope exceeds the pilot listing bound. */
  readonly sitesComplete?: boolean;
  /** Organization and actor, so cached write intents never cross accounts. */
  readonly identityKey?: string;
}

const UNAVAILABLE: HrAccessValue = Object.freeze({
  status: "UNAVAILABLE",
  permissions: [],
  timezoneSupported: true,
  sites: [],
});

const HrAccessContext = createContext<HrAccessValue>(UNAVAILABLE);

/**
 * HR display access, queried separately from the storage workspace so a
 * member with HR access only is not stranded behind storage permissions.
 * Display only: each HR function authorizes on the server.
 */
export function HrAccessProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const outcome = useQuery(
    hrRefs.access,
    !isLoading && isAuthenticated ? {} : "skip",
  );
  const value = useMemo<HrAccessValue>(() => {
    if (isLoading) return { ...UNAVAILABLE, status: "LOADING" };
    if (!isAuthenticated) return UNAVAILABLE;
    if (outcome === undefined) return { ...UNAVAILABLE, status: "LOADING" };
    if (!outcome.ok) return { ...UNAVAILABLE, status: "NONE" };
    const access = outcome.value;
    return {
      status: "READY",
      permissions: access.permissions,
      organizationName: access.organizationName,
      timezone: access.timezone,
      timezoneSupported: access.timezoneSupported,
      ...(access.today === undefined ? {} : { today: access.today }),
      ...(access.employee === undefined ? {} : { employee: access.employee }),
      sites: access.sites,
      sitesComplete: access.sitesComplete,
      identityKey: `${access.organizationId}:${access.actorUserId}`,
    };
  }, [isAuthenticated, isLoading, outcome]);
  return (
    <HrAccessContext.Provider value={value}>
      {children}
    </HrAccessContext.Provider>
  );
}

/** For environments without a configured backend or identity provider. */
export function UnavailableHrAccessProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <HrAccessContext.Provider value={UNAVAILABLE}>
      {children}
    </HrAccessContext.Provider>
  );
}

export function useHrAccess(): HrAccessValue {
  return useContext(HrAccessContext);
}

export function useHrCan(code: string): boolean {
  const access = useHrAccess();
  return access.status === "READY" && access.permissions.includes(code);
}
