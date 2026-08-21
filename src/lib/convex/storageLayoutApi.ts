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
});
