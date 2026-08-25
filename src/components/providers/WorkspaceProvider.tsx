"use client";

import { useConvexAuth, useQuery } from "convex/react";
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
  const outcome = useQuery(
    readCurrentWorkspaceRef,
    canReadWorkspace ? {} : "skip",
  );
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
    if (outcome === undefined) {
      return { ...EMPTY_WORKSPACE, loading: true, selectWarehouse };
    }
    if (!outcome.ok) {
      return { ...EMPTY_WORKSPACE, denied: true, selectWarehouse };
    }

    return {
      ...resolveWorkspace(outcome.value, stored ?? undefined),
      loading: false,
      denied: false,
      permissionsReady: true,
      selectWarehouse,
    };
  }, [
    isAuthenticated,
    isAuthenticationLoading,
    outcome,
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
