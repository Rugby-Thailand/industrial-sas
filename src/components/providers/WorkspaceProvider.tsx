"use client";

/**
 * The active organization and warehouse, shared by the shells and the panels.
 *
 * The stored warehouse is read through `useSyncExternalStore` rather than in an
 * effect: `localStorage` is an external store, the server has no value for it,
 * and reading it in an effect would mean a cascading render on every mount. It
 * also means a second tab that switches warehouse re-renders this one, which is
 * the behaviour a supervisor with two windows open expects.
 *
 * `resolveWorkspace` decides everything else — which warehouses exist, whether
 * one can be chosen at all, and whether a stored choice is still valid. This
 * component only supplies it with the two inputs and memoizes the result.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  readStoredWarehouse,
  serverWarehouseSnapshot,
  subscribeWarehouse,
  writeStoredWarehouse,
} from "@/lib/workspace/warehouseStore";
import {
  resolveWorkspace,
  type WorkspaceState,
} from "@/lib/workspace/workspace";

import { useAppEnvironment } from "./EnvironmentProvider";

export interface WorkspaceContextValue extends WorkspaceState {
  readonly selectWarehouse: (warehouseId: string) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(
  undefined,
);

/**
 * A subscription that never fires, for a consumer that already has a value.
 *
 * Hook order is fixed, so `useWorkspace` cannot *skip* the store when a
 * provider is above it — but it can subscribe to nothing and read nothing.
 * Without this, every consumer attaches its own `storage` listener and calls
 * `localStorage.getItem` on each render, and the answer is thrown away in
 * favour of the context value on the very next line.
 */
const noSubscription = () => () => {};

/**
 * Resolve the workspace from the store, or stand idle.
 *
 * `subscribed` is false for a consumer whose value comes from the provider. The
 * hooks still run — they must — but against a constant, so the resolved value
 * below is the one the provider already computed once for the whole tree.
 */
function useResolvedWorkspace(subscribed: boolean): WorkspaceContextValue {
  const environment = useAppEnvironment();
  const stored = useSyncExternalStore(
    subscribed ? subscribeWarehouse : noSubscription,
    subscribed ? readStoredWarehouse : serverWarehouseSnapshot,
    serverWarehouseSnapshot,
  );

  const selectWarehouse = useCallback((warehouseId: string) => {
    writeStoredWarehouse(warehouseId);
  }, []);

  return useMemo<WorkspaceContextValue>(
    () => ({
      ...resolveWorkspace(environment, stored ?? undefined),
      selectWarehouse,
    }),
    [environment, stored, selectWarehouse],
  );
}

export function WorkspaceProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const value = useResolvedWorkspace(true);
  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

/**
 * The active workspace.
 *
 * Resolves on its own when no provider is above it, rather than throwing, so a
 * component under test renders the same way it would in the application without
 * the test having to assemble the whole provider stack.
 *
 * In the application a provider always is above it, and there are ten or more
 * consumers on a busy screen, so the fallback subscribes only when it is the
 * one actually answering. Otherwise each of them would hold a `storage`
 * listener and re-read `localStorage` on every render to recompute what the
 * provider had already resolved.
 */
export function useWorkspace(): WorkspaceContextValue {
  const provided = useContext(WorkspaceContext);
  const standalone = useResolvedWorkspace(provided === undefined);
  return provided ?? standalone;
}
