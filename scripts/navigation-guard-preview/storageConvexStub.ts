"use client";

import { useMemo, useSyncExternalStore } from "react";
import { getFunctionName } from "convex/server";
import { fixtureBuilding } from "./storageFixtureData";

import type {
  HrUnreadSummary,
  QuickMenuCurrent,
  QuickMenuKey,
  QuickMenuSaveResult,
} from "../../convex/model/home/quickMenu";

type Reference = Parameters<typeof getFunctionName>[0];
type FixturePreferences = Pick<QuickMenuCurrent, "pinnedKeys" | "version">;
const scope = {
  clerkOrgId: "fixture-clerk-org",
  clerkUserId: "fixture-clerk-user",
};
const availableKeys = [
  "planner.storageLayouts",
  "planner.jobScan",
  "hr.notifications",
] satisfies QuickMenuKey[];
const preferenceKey = "navigation-fixture-home-preferences";
const preferenceChanged = "navigation-fixture-home-preferences-change";
const initialPreferences = JSON.stringify({
  version: 0,
  pinnedKeys: ["planner.storageLayouts", "hr.notifications"],
} satisfies FixturePreferences);

function readPreferences() {
  return sessionStorage.getItem(preferenceKey) ?? initialPreferences;
}

function subscribe(listener: () => void) {
  window.addEventListener(preferenceChanged, listener);
  return () => window.removeEventListener(preferenceChanged, listener);
}

export function useConvexAuth() {
  return { isAuthenticated: true, isLoading: false };
}

const client = {
  connectionState: () => ({ isWebSocketConnected: true }),
  subscribeToConnectionState: () => () => {},
  query: async () => {
    throw new Error("This fixture does not support imperative queries");
  },
};

export function useConvex() {
  return client;
}

export function useMutation(reference: Reference) {
  const name = getFunctionName(reference);
  if (name === "storageLayouts/writes:activateStorageBuilding") {
    return async (args: unknown) => {
      const response = await fetch("/fixture-save?write=activate-building", {
        method: "POST",
        body: JSON.stringify(args),
      });
      if (!response.ok) throw new Error("Fixture activation failed");
      return { ok: true, value: { written: true } };
    };
  }
  return async (args: {
    expectedVersion: number;
    pinnedKeys: QuickMenuKey[];
  }) => {
    if (name !== "workspace/quickMenus:save") {
      throw new Error("Storage fixture writes are disabled");
    }
    const response = await fetch("/fixture-save", { method: "POST" });
    if (!response.ok) throw new Error("Fixture save failed");
    const saved: FixturePreferences = {
      version: args.expectedVersion + 1,
      pinnedKeys: args.pinnedKeys,
    };
    sessionStorage.setItem(preferenceKey, JSON.stringify(saved));
    window.dispatchEvent(new Event(preferenceChanged));
    return {
      ok: true,
      value: {
        ok: true,
        replayed: false,
        documentId: "fixture-quick-menu",
        ...saved,
      } satisfies QuickMenuSaveResult,
    };
  };
}

const catalogueReads = {
  "storageLayouts/catalogue:listStorageBuildingsPage": {
    status: "ready",
    page: [fixtureBuilding],
    isDone: true,
    continueCursor: "",
  },
  "storageLayouts/catalogue:buildingOccupancy": {
    ...fixtureBuilding,
    blocked: false,
  },
  "storageLayouts/writes:buildingLifecycleImpact": {
    found: true,
    zoneCount: 3,
    positionCount: 4,
    namedRegistrationCount: 1,
    complete: true,
    canArchive: true,
  },
  "storageLayouts/writes:layoutReadiness": {
    found: true,
    ready: true,
    version: fixtureBuilding.version,
  },
};

export function useQuery(reference: Reference, args: unknown) {
  if (args === "skip") return undefined;
  const name = getFunctionName(reference);
  const value = catalogueReads[name as keyof typeof catalogueReads];
  return value ? { ok: true, value } : undefined;
}

export function useQuery_experimental({
  query,
  args,
}: {
  readonly query: Reference;
  readonly args: unknown;
}) {
  const preferences = useSyncExternalStore(
    subscribe,
    readPreferences,
    () => initialPreferences,
  );
  const skip = args === "skip";
  return useMemo(() => {
    if (skip) return { status: "pending" };
    switch (getFunctionName(query)) {
      case "workspace/quickMenus:current":
        return {
          status: "success",
          data: {
            ok: true,
            value: {
              ...(JSON.parse(preferences) as FixturePreferences),
              actorUserId: "fixture-actor",
              clerkScope: scope,
              maxVersion: 10,
              customized: preferences !== initialPreferences,
              availableKeys,
            } satisfies QuickMenuCurrent,
          },
        };
      case "hr/notifications:unreadSummary":
        return {
          status: "success",
          data: {
            ok: true,
            value: {
              clerkScope: scope,
              total: 2,
              linked: true,
              counts: {
                ANNOUNCEMENT_PUBLISHED: 1,
                LEAVE_DECIDED: 1,
                CORRECTION_DECIDED: 0,
                PAYSLIP_PUBLISHED: 0,
              },
            } satisfies HrUnreadSummary,
          },
        };
      case "hr/access:display":
        return {
          status: "success",
          data: {
            ok: true,
            value: {
              organizationId: "fixture-org",
              actorUserId: "fixture-actor",
              organizationName: "Navigation fixture",
              permissions: ["hr.self.access"],
              timezoneSupported: true,
              offsetMinutes: 420,
              sites: [],
              sitesComplete: true,
            },
          },
        };
      default:
        return { status: "pending" };
    }
    // The stub represents Convex's stable subscription result. Callers may create
    // a fresh argument object on every render.
  }, [query, skip, preferences]);
}
