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
  /** One is the floor; larger numbers are physically above it. */
  readonly levelIndex: number;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly heightMm: number;
  readonly orientation: "DEFAULT" | "ROTATED";
  readonly placedAt: number;
}

export interface StorageZoneRow {
  readonly zoneId: string;
  readonly locationId: string;
  readonly code: string;
  readonly label: string;
  readonly qrValue: string;
  readonly xMm: number;
  readonly yMm: number;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly maxStackHeightMm: number;
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

export const storageLayoutRefs = Object.freeze({
  list: clientRef(api.storageLayouts.catalogue.listStorageBuildings),
  get: clientRef(api.storageLayouts.catalogue.getStorageBuilding),
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
});
