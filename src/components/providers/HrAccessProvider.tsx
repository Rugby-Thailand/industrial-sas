"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import { hrRefs } from "@/lib/convex/hrApi";

import { useBusinessDate } from "./useBusinessDate";

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
  /**
   * The organization's business date for display, derived on this device
   * from the organization's offset and refreshed at local midnight. Never
   * authoritative: server writes and locks use the server clock.
   */
  readonly today?: string;
  readonly employee?: {
    readonly id: string;
    readonly code: string;
    readonly displayName: string;
  };
  readonly sites: readonly HrSite[];
  /** False when the member's site scope exceeds the pilot listing bound. */
  readonly sitesComplete?: boolean;
  /** Organization, actor and linked employee isolate cached write intents. */
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
 * Display only: each HR function authorizes on the server. The query is
 * clock-free (cacheable all day); `today` is derived here.
 */
export function HrAccessProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const outcome = useQuery(
    hrRefs.accessDisplay,
    !isLoading && isAuthenticated ? {} : "skip",
  );
  const today = useBusinessDate(
    outcome?.ok === true && outcome.value.timezoneSupported
      ? outcome.value.offsetMinutes
      : undefined,
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
      ...(today === undefined ? {} : { today }),
      ...(access.employee === undefined ? {} : { employee: access.employee }),
      sites: access.sites,
      sitesComplete: access.sitesComplete,
      identityKey: `${access.organizationId}:${access.actorUserId}:${access.employee?.id ?? "not-linked"}`,
    };
  }, [isAuthenticated, isLoading, outcome, today]);
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
