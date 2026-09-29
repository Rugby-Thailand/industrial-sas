"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import {
  storageLayoutRefs,
  type StorageBuildingDetail,
} from "@/lib/convex/storageLayoutApi";
import type { TenantFunctionOutcome } from "../../../convex/lib/tenantFunctions";
import { mergeBuildingInventory } from "./buildingInventory";

/** Convex caches the static layout independently of live inventory updates.
 * No persistent browser cache: identity, warehouse and permission changes must
 * always follow Convex's authenticated subscription lifecycle.
 */
export function useStorageBuilding(
  warehouseId: string,
  buildingId: string,
  enabled = true,
): TenantFunctionOutcome<StorageBuildingDetail> | undefined {
  const args = enabled ? { warehouseId, buildingId } : "skip";
  const layout = useQuery(storageLayoutRefs.layout, args);
  const inventory = useQuery(storageLayoutRefs.inventory, args);
  return useMemo(() => {
    if (layout && !layout.ok) return layout;
    if (inventory && !inventory.ok) return inventory;
    if (layout?.ok && !layout.value.found) return layout;
    if (inventory?.ok && !inventory.value.found)
      return { ...inventory, value: { found: false as const } };
    if (!layout || !inventory) return undefined;
    return {
      ...layout,
      value: mergeBuildingInventory(layout.value, inventory.value),
    };
  }, [layout, inventory]);
}
