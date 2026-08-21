import { makeFunctionReference } from "convex/server";

import type { TenantOutcome } from "./ledgerApi";

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

export type StorageWriteOutcome =
  | {
      readonly written: true;
      readonly documentId: string;
      readonly replayed: boolean;
    }
  | {
      readonly written: false;
      readonly error: { readonly code: string; readonly field?: string };
    };

export type StoragePlacementOutcome =
  | {
      readonly written: true;
      readonly documentId: string;
      readonly replayed: boolean;
      readonly levelIndex: number;
      readonly orientation: "DEFAULT" | "ROTATED";
      readonly occupiedHeightMm: number;
      readonly resultingHeightMm: number;
      readonly capacityWarning: boolean;
    }
  | {
      readonly written: false;
      readonly error: { readonly code: string; readonly field?: string };
    };

export const storageLayoutRefs = Object.freeze({
  list: makeFunctionReference<
    "query",
    { warehouseId: string; status?: StorageLayoutStatus },
    TenantOutcome<readonly StorageBuildingRow[]>
  >("storageLayouts/catalogue:listStorageBuildings"),
  get: makeFunctionReference<
    "query",
    { warehouseId: string; buildingId: string },
    TenantOutcome<StorageBuildingDetail>
  >("storageLayouts/catalogue:getStorageBuilding"),
  create: makeFunctionReference<
    "mutation",
    {
      warehouseId: string;
      requestId: string;
      code: string;
      name: string;
      widthMm: number;
      depthMm: number;
      defaultFloorHeightMm: number;
      floorCount: number;
    },
    TenantOutcome<StorageWriteOutcome>
  >("storageLayouts/writes:createStorageBuilding"),
  update: makeFunctionReference<
    "mutation",
    {
      warehouseId: string;
      buildingId: string;
      requestId: string;
      expectedVersion: number;
      name: string;
      widthMm: number;
      depthMm: number;
      defaultFloorHeightMm: number;
    },
    TenantOutcome<StorageWriteOutcome>
  >("storageLayouts/writes:updateStorageBuilding"),
  changeFloorCount: makeFunctionReference<
    "mutation",
    {
      warehouseId: string;
      buildingId: string;
      requestId: string;
      expectedVersion: number;
      floorCount: number;
    },
    TenantOutcome<StorageWriteOutcome>
  >("storageLayouts/writes:changeStorageFloorCount"),
  saveFloor: makeFunctionReference<
    "mutation",
    {
      warehouseId: string;
      buildingId: string;
      requestId: string;
      expectedBuildingVersion: number;
      expectedFloorVersion: number;
      floor: {
        floorNumber: number;
        widthMm?: number;
        depthMm?: number;
        heightMm?: number;
        offsetXMm?: number;
        offsetYMm?: number;
        reservedBlocks: readonly {
          id: string;
          label: string;
          xMm: number;
          yMm: number;
          widthMm: number;
          depthMm: number;
        }[];
      };
    },
    TenantOutcome<StorageWriteOutcome>
  >("storageLayouts/writes:saveStorageFloor"),
  activate: makeFunctionReference<
    "mutation",
    {
      warehouseId: string;
      buildingId: string;
      requestId: string;
      expectedVersion: number;
    },
    TenantOutcome<StorageWriteOutcome>
  >("storageLayouts/writes:activateStorageBuilding"),
  archive: makeFunctionReference<
    "mutation",
    {
      warehouseId: string;
      buildingId: string;
      requestId: string;
      expectedVersion: number;
    },
    TenantOutcome<StorageWriteOutcome>
  >("storageLayouts/writes:archiveStorageBuilding"),
  createZone: makeFunctionReference<
    "mutation",
    {
      warehouseId: string;
      buildingId: string;
      floorNumber: number;
      requestId: string;
      label: string;
      xMm: number;
      yMm: number;
      widthMm: number;
      depthMm: number;
      maxStackHeightMm: number;
    },
    TenantOutcome<StorageWriteOutcome>
  >("storageLayouts/zones:createStorageZone"),
  archiveZone: makeFunctionReference<
    "mutation",
    { warehouseId: string; zoneId: string; requestId: string },
    TenantOutcome<StorageWriteOutcome>
  >("storageLayouts/zones:archiveStorageZone"),
  placeHandlingUnit: makeFunctionReference<
    "mutation",
    {
      warehouseId: string;
      requestId: string;
      lpn: string;
      zoneScan: string;
      widthMm: number;
      depthMm: number;
      heightMm: number;
    },
    TenantOutcome<StoragePlacementOutcome>
  >("storageLayouts/zones:placeHandlingUnit"),
});
