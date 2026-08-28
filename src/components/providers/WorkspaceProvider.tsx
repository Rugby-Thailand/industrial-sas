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
      return { ...EMPTY_WORKSPACE, loading: true, selectWarehouse };
    }
    if (!isAuthenticated) {
      return { ...EMPTY_WORKSPACE, selectWarehouse };
    }
    if (queryState.status === "error") {
      return { ...EMPTY_WORKSPACE, failed: true, selectWarehouse };
    }
    if (queryState.status === "pending") {
      return { ...EMPTY_WORKSPACE, loading: true, selectWarehouse };
    }
    const outcome = queryState.data;
    if (!outcome.ok) {
      return { ...EMPTY_WORKSPACE, denied: true, selectWarehouse };
    }

    return {
      ...resolveWorkspace(outcome.value, stored ?? undefined),
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
