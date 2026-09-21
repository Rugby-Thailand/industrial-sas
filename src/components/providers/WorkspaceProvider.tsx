"use client";

import { useConvexAuth, useQuery_experimental } from "convex/react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { readCurrentWorkspaceRef } from "@/lib/convex/workspaceApi";
import { failureCodeOf, type LedgerPanelState } from "@/lib/convex/ledgerState";
import {
  readStoredWarehouse,
  serverWarehouseSnapshot,
  subscribeWarehouse,
  writeStoredWarehouse,
} from "@/lib/workspace/warehouseStore";
import {
  resolveWorkspace,
  type OrganizationSummary,
  type WarehouseOption,
} from "@/lib/workspace/workspace";

export interface WorkspaceContextValue {
  readonly readiness:
    | Exclude<LedgerPanelState<never>, { kind: "READY" }>
    | { readonly kind: "READY_TO_QUERY" };
  readonly organization: OrganizationSummary | undefined;
  readonly warehouses: readonly WarehouseOption[];
  readonly selectedWarehouseId: string | undefined;
  readonly selectable: boolean;
  readonly complete: boolean;
  readonly loading: boolean;
  readonly failed: boolean;
  readonly denied: boolean;
  readonly navigationPermissions: readonly string[];
  readonly permissionsReady: boolean;
  readonly selectWarehouse: (warehouseId: string) => void;
}

const idleSelection = () => {};

const EMPTY_WORKSPACE: WorkspaceContextValue = Object.freeze({
  readiness: { kind: "BACKEND_MISSING" as const },
  organization: undefined,
  warehouses: [],
  selectedWarehouseId: undefined,
  selectable: false,
  complete: true,
  loading: false,
  failed: false,
  denied: false,
  navigationPermissions: [],
  permissionsReady: false,
  selectWarehouse: idleSelection,
});

const WorkspaceContext = createContext<WorkspaceContextValue>(EMPTY_WORKSPACE);

/** Provides setup state without mounting hooks requiring a Convex auth provider. */
export function UnavailableWorkspaceProvider({
  reason,
  children,
}: {
  readonly reason: "BACKEND_MISSING" | "SIGN_IN_REQUIRED";
  readonly children: ReactNode;
}) {
  const value = useMemo<WorkspaceContextValue>(
    () => ({ ...EMPTY_WORKSPACE, readiness: { kind: reason } }),
    [reason],
  );
  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function WorkspaceProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const { isAuthenticated, isLoading: isAuthenticationLoading } =
    useConvexAuth();
  const canReadWorkspace = !isAuthenticationLoading && isAuthenticated;
  const queryState = useQuery_experimental({
    query: readCurrentWorkspaceRef,
    args: canReadWorkspace ? {} : "skip",
  });
  const stored = useSyncExternalStore(
    subscribeWarehouse,
    readStoredWarehouse,
    serverWarehouseSnapshot,
  );
  const selectWarehouse = useCallback((warehouseId: string) => {
    writeStoredWarehouse(warehouseId);
  }, []);

  const value = useMemo<WorkspaceContextValue>(() => {
    if (isAuthenticationLoading) {
      return {
        ...EMPTY_WORKSPACE,
        readiness: { kind: "LOADING" },
        loading: true,
        selectWarehouse,
      };
    }
    if (!isAuthenticated) {
      return {
        ...EMPTY_WORKSPACE,
        readiness: { kind: "SIGN_IN_REQUIRED" },
        selectWarehouse,
      };
    }
    if (queryState.status === "error") {
      return {
        ...EMPTY_WORKSPACE,
        readiness: { kind: "ERROR", code: failureCodeOf(queryState.error) },
        failed: true,
        selectWarehouse,
      };
    }
    if (queryState.status === "pending") {
      return {
        ...EMPTY_WORKSPACE,
        readiness: { kind: "LOADING" },
        loading: true,
        selectWarehouse,
      };
    }
    const outcome = queryState.data;
    if (!outcome.ok) {
      return {
        ...EMPTY_WORKSPACE,
        readiness: { kind: "DENIED", requestId: outcome.requestId },
        denied: true,
        selectWarehouse,
      };
    }

    return {
      ...resolveWorkspace(outcome.value, stored ?? undefined),
      readiness: { kind: "READY_TO_QUERY" },
      loading: false,
      failed: false,
      denied: false,
      permissionsReady: true,
      selectWarehouse,
    };
  }, [
    isAuthenticated,
    isAuthenticationLoading,
    queryState,
    selectWarehouse,
    stored,
  ]);

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  return useContext(WorkspaceContext);
}
