import type { RefValue } from "@/lib/convex/clientRef";
import type {
  StorageBuildingDetail,
  storageLayoutRefs,
} from "@/lib/convex/storageLayoutApi";

type Inventory = RefValue<typeof storageLayoutRefs.inventory>;

/** Compose two reactive queries; never interpret pending inventory as empty. */
export function mergeBuildingInventory(
  layout: StorageBuildingDetail,
  inventory: Inventory,
): StorageBuildingDetail {
  if (!layout.found || !inventory.found) return { found: false };
  const byZone = new Map(inventory.zones.map((zone) => [zone.zoneId, zone]));
  return {
    ...layout,
    floors: layout.floors.map((floor) => ({
      ...floor,
      storageZones: floor.storageZones.map((zone) => {
        const live = byZone.get(zone.zoneId) ?? {
          placements: [],
          locationOnlyPlacements: [],
          unmeasuredPalletCount: 0,
          measuredAreaPartial: false,
          palletCount: 0,
          occupiedFootprintAreaSqMm: 0,
        };
        return {
          ...zone,
          ...live,
          positions: zone.positions.map((position) => ({
            ...position,
            placements: live.placements.filter(
              (placement) =>
                placement.positionId === position.positionId ||
                (position.isDefault && placement.positionId === undefined),
            ),
          })),
        };
      }),
    })),
  };
}
