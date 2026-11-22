"use client";

import { useEffect, useState } from "react";

import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { updateBrowserQuery } from "@/lib/browser/history";

/**
 * Resolves the effective warehouse when a deep link passes `?warehouseId=...`.
 * - Honors an authorized `requestedWarehouseId` immediately and syncs the
 *   workspace selection so the shell switcher and downstream routes stay aligned.
 * - If the user subsequently chooses another warehouse in the switcher,
 *   stops overriding with the stale URL query and removes `?warehouseId`.
 */
export function useEffectiveWarehouse(
  activeWarehouseId: string,
  requestedWarehouseId?: string,
): {
  readonly warehouseId: string;
  readonly crossWarehouseId: string | undefined;
} {
  const { warehouses, selectWarehouse } = useWorkspace();
  const authorizedRequest =
    requestedWarehouseId &&
    warehouses.some((warehouse) => warehouse.id === requestedWarehouseId)
      ? requestedWarehouseId
      : undefined;

  const [syncState, setSyncState] = useState<{
    readonly requested: string | undefined;
    readonly baselineActive: string;
    readonly dismissed: boolean;
  }>(() => ({
    requested: authorizedRequest,
    baselineActive: activeWarehouseId,
    dismissed: false,
  }));

  if (syncState.requested !== authorizedRequest) {
    setSyncState({
      requested: authorizedRequest,
      baselineActive: activeWarehouseId,
      dismissed: false,
    });
  } else if (
    authorizedRequest !== undefined &&
    !syncState.dismissed &&
    activeWarehouseId === authorizedRequest &&
    syncState.baselineActive !== authorizedRequest
  ) {
    setSyncState({
      requested: authorizedRequest,
      baselineActive: authorizedRequest,
      dismissed: false,
    });
  } else if (
    authorizedRequest !== undefined &&
    !syncState.dismissed &&
    activeWarehouseId !== authorizedRequest &&
    activeWarehouseId !== syncState.baselineActive
  ) {
    setSyncState({
      requested: authorizedRequest,
      baselineActive: activeWarehouseId,
      dismissed: true,
    });
  }

  const userSwitchedAway =
    syncState.requested === authorizedRequest &&
    authorizedRequest !== undefined &&
    (syncState.dismissed ||
      (activeWarehouseId !== authorizedRequest &&
        activeWarehouseId !== syncState.baselineActive));

  const honoringRequest = authorizedRequest !== undefined && !userSwitchedAway;

  useEffect(() => {
    if (!honoringRequest || !authorizedRequest) return;
    if (activeWarehouseId !== authorizedRequest) {
      selectWarehouse(authorizedRequest);
    }
  }, [activeWarehouseId, authorizedRequest, honoringRequest, selectWarehouse]);

  useEffect(() => {
    if (!authorizedRequest || !userSwitchedAway) return;
    if (typeof window === "undefined") return;
    const current = new URLSearchParams(window.location.search).get(
      "warehouseId",
    );
    if (current === authorizedRequest) {
      updateBrowserQuery((query) => query.delete("warehouseId"));
    }
  }, [authorizedRequest, userSwitchedAway]);

  return {
    warehouseId: honoringRequest ? authorizedRequest : activeWarehouseId,
    crossWarehouseId: honoringRequest ? authorizedRequest : undefined,
  };
}
