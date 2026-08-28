import type { TenantDocumentAccess, TenantOwnedDocument } from "./tenantDb";

interface LocationRow extends TenantOwnedDocument {
  readonly _id: string;
  readonly code: string;
}

interface PositionRow extends TenantOwnedDocument {
  readonly _id: string;
  readonly zoneId: string;
  readonly locationId: string;
  readonly label: string;
  readonly kind: string;
  readonly fixtureCode?: string;
  readonly bayIndex?: number;
  readonly levelIndex?: number;
  readonly slotIndex?: number;
}

interface ZoneRow extends TenantOwnedDocument {
  readonly _id: string;
  readonly floorId: string;
  readonly locationId: string;
  readonly label: string;
}

interface FloorRow extends TenantOwnedDocument {
  readonly _id: string;
  readonly floorNumber: number;
}

function positionTrail(position: PositionRow): string {
  if (position.kind !== "RACK_SLOT") return position.label;
  return `${position.fixtureCode ?? "Rack"} › Bay ${String(position.bayIndex ?? 0).padStart(2, "0")} › Level ${String(position.levelIndex ?? 0).padStart(2, "0")}${(position.slotIndex ?? 1) > 1 ? ` › Slot ${String(position.slotIndex).padStart(2, "0")}` : ""}`;
}

/** Resolve a physical ledger location to a stable, operator-readable address. */
export async function storageLocationBreadcrumb(
  tenantDb: TenantDocumentAccess,
  locationId: string,
): Promise<string | undefined> {
  const position = await tenantDb
    .byIndex<PositionRow>("storagePositions", "by_orgId_locationId", [
      { field: "locationId", value: locationId },
    ])
    .unique();
  const legacyZone =
    position === null
      ? await tenantDb
          .byIndex<ZoneRow>("storageZones", "by_orgId_locationId", [
            { field: "locationId", value: locationId },
          ])
          .unique()
      : null;
  const zone =
    position === null
      ? legacyZone
      : await tenantDb.get<ZoneRow>("storageZones", position.zoneId);
  if (zone !== null) {
    const floor = await tenantDb.get<FloorRow>("storageFloors", zone.floorId);
    if (floor !== null) {
      return position === null || position.locationId === zone.locationId
        ? `Floor ${floor.floorNumber} › ${zone.label}`
        : `Floor ${floor.floorNumber} › ${zone.label} › ${positionTrail(position)}`;
    }
  }
  return (await tenantDb.get<LocationRow>("locations", locationId))?.code;
}
