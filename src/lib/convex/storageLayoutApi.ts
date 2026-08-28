import { api } from "../../../convex/_generated/api";

import { clientRef } from "./clientRef";

export type StorageLayoutStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

export interface StorageReservedBlockRow {
  readonly blockId: string;
  readonly label: string;
  readonly xMm: number;
  readonly yMm: number;
  readonly widthMm: number;
  readonly depthMm: number;
}

export interface StorageStackPlacementRow {
  readonly placementId: string;
  readonly handlingUnitId: string;
  readonly lpn: string;

  readonly levelIndex: number;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly heightMm: number;
  readonly orientation: "DEFAULT" | "ROTATED";
  readonly placedAt: number;
  readonly positionId?: string;
  readonly positionCode?: string;
  readonly breadcrumb?: string;
}

export type StorageAreaMode =
  "SIMPLE" | "FLOOR_POSITIONS" | "RACK" | "PLATFORM";

export interface StoragePositionRow {
  readonly positionId?: string;
  readonly locationId: string;
  readonly code: string;
  readonly label: string;
  readonly qrValue: string;
  readonly kind: "DEFAULT" | "FLOOR" | "RACK_SLOT" | "PLATFORM";
  readonly isDefault: boolean;
  readonly xMm?: number;
  readonly yMm?: number;
  readonly widthMm?: number;
  readonly depthMm?: number;
  readonly fixtureCode?: string;
  readonly bayIndex?: number;
  readonly levelIndex?: number;
  readonly slotIndex?: number;
  readonly elevationMm?: number;
  readonly breadcrumb: string;
  readonly placements: readonly StorageStackPlacementRow[];
}

export interface StorageZoneRow {
  readonly zoneId: string;
  readonly locationId: string;
  readonly code: string;
  readonly label: string;
  readonly qrValue: string;
  readonly mode: StorageAreaMode;
  readonly baseElevationMm?: number;
  readonly xMm: number;
  readonly yMm: number;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly maxStackHeightMm: number;
  readonly positions: readonly StoragePositionRow[];
  readonly placements: readonly StorageStackPlacementRow[];
}

export interface StorageFloorRow {
  readonly floorId: string;
  readonly floorNumber: number;
  readonly widthMm?: number;
  readonly depthMm?: number;
  readonly heightMm?: number;
  readonly offsetXMm?: number;
  readonly offsetYMm?: number;
  readonly grossAreaSqMm: number;
  readonly reservedAreaSqMm: number;
  readonly usableAreaSqMm: number;
  readonly version: number;
  readonly storageZones: readonly StorageZoneRow[];
  readonly reservedBlocks: readonly StorageReservedBlockRow[];
}

export interface StorageBuildingRow {
  readonly buildingId: string;
  readonly warehouseId: string;
  readonly code: string;
  readonly name: string;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly defaultFloorHeightMm: number;
  readonly floorCount: number;
  readonly totalHeightMm: number;
  readonly grossAreaSqMm: number;
  readonly reservedAreaSqMm: number;
  readonly usableAreaSqMm: number;
  readonly status: StorageLayoutStatus;
  readonly version: number;
}

export type StorageBuildingDetail =
  | {
      readonly found: true;
      readonly building: StorageBuildingRow;
      readonly floors: readonly StorageFloorRow[];
    }
  | { readonly found: false };

export type StorageLocationMapDetail =
  | {
      readonly found: true;
      readonly building: StorageBuildingRow;
      readonly floor: StorageFloorRow;
      readonly zone: StorageZoneRow;
    }
  | { readonly found: false };

export const storageLayoutRefs = Object.freeze({
  list: clientRef(api.storageLayouts.catalogue.listStorageBuildings),
  get: clientRef(api.storageLayouts.catalogue.getStorageBuilding),
  locationMap: clientRef(api.storageLayouts.catalogue.getStorageLocationMap),
  listOperationalZones: clientRef(
    api.storageLayouts.catalogue.listOperationalStorageZones,
  ),
  create: clientRef(api.storageLayouts.writes.createStorageBuilding),
  update: clientRef(api.storageLayouts.writes.updateStorageBuilding),
  changeFloorCount: clientRef(
    api.storageLayouts.writes.changeStorageFloorCount,
  ),
  saveFloor: clientRef(api.storageLayouts.writes.saveStorageFloor),
  activate: clientRef(api.storageLayouts.writes.activateStorageBuilding),
  archive: clientRef(api.storageLayouts.writes.archiveStorageBuilding),
  createZone: clientRef(api.storageLayouts.zones.createStorageZone),
  updateZone: clientRef(api.storageLayouts.zones.updateStorageZone),
  archiveZone: clientRef(api.storageLayouts.zones.archiveStorageZone),
  placeHandlingUnit: clientRef(api.storageLayouts.zones.placeHandlingUnit),
  createPosition: clientRef(api.storageLayouts.zones.createStoragePosition),
  generateRackPositions: clientRef(
    api.storageLayouts.zones.generateRackStoragePositions,
  ),
  updatePosition: clientRef(api.storageLayouts.zones.updateStoragePosition),
  archivePosition: clientRef(api.storageLayouts.zones.archiveStoragePosition),
  resolveAddress: clientRef(api.storageLayouts.zones.resolveStorageAddress),
  backfillPositions: clientRef(
    api.storageLayouts.zones.backfillStoragePositions,
  ),
});
