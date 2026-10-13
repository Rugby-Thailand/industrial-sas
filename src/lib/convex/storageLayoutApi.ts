import { api } from "../../../convex/_generated/api";

import { clientRef } from "./clientRef";

export type StorageLayoutStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

export interface StorageReservedBlockRow {
  readonly areaKind?: "AISLE" | "PLATFORM" | "STAIRS" | "NO_STORAGE";
  readonly displayHeightMm?: number;
  readonly blockId: string;
  readonly label: string;
  readonly color?: string;
  readonly xMm: number;
  readonly yMm: number;
  readonly widthMm: number;
  readonly depthMm: number;
}

export interface StorageStackPlacementRow {
  readonly productName?: string;
  readonly productSku?: string;
  readonly quantity?: number;
  readonly unit?: string;
  readonly placementId: string;
  readonly handlingUnitId: string;
  readonly lpn: string;

  readonly levelIndex: number;
  /** Coordinates relative to the parent storage location, not the floor. */
  readonly xMm?: number;
  readonly yMm?: number;
  readonly zMm?: number;
  readonly status?: "RESERVED" | "STORED";
  readonly moveId?: string;
  readonly moveState?: "RESERVED" | "IN_TRANSIT";
  readonly moveRole?: "SOURCE" | "TARGET";
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
  /** Optimistic-concurrency token of a stored exact position. */
  readonly revision?: string;
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

export interface LocationOnlyPlacementRow {
  readonly mode: "LOCATION_ONLY";
  readonly placementId: string;
  readonly handlingUnitId: string;
  readonly lpn: string;
  readonly assignmentId: string;
  readonly sequence: number;
  readonly positionCode: string;
  readonly positionId?: string | undefined;
  readonly productName?: string | undefined;
  readonly quantity?: number | undefined;
  readonly status: "RESERVED" | "STORED" | "RELEASED";
}

export interface StorageZoneRow {
  readonly locationOnlyPlacements?: readonly LocationOnlyPlacementRow[];
  readonly unmeasuredPalletCount?: number;
  readonly measuredAreaPartial?: boolean;
  readonly palletCount?: number;
  readonly occupiedFootprintAreaSqMm?: number;
  readonly zoneId: string;
  readonly locationId: string;
  readonly code: string;
  readonly label: string;
  readonly qrValue: string;
  /** Optimistic-concurrency token; sent back with every spot edit. */
  readonly revision?: string;
  readonly mode: StorageAreaMode;
  readonly storageCondition?: string;
  readonly importNote?: string;
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
  readonly fg1Import?: { readonly revision: string };
  readonly approvedSchematic?: {
    readonly revision: string;
    readonly sourcePages: readonly number[];
    readonly blueBayCodes: readonly string[];
    readonly floor1ZoneCount: number;
    readonly floor2ZoneCount: number;
    readonly approvedAt: number;
  };
  readonly unmeasuredPalletCount?: number;
  readonly measuredAreaPartial?: boolean;
  readonly storedFootprintAreaSqMm?: number;
  readonly heldFootprintAreaSqMm?: number;
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
  statusControl: clientRef(api.storageLayouts.catalogue.buildingStatusControl),
  returnToDraft: clientRef(
    api.storageLayouts.writes.returnStorageBuildingToDraft,
  ),
  occupancy: clientRef(api.storageLayouts.catalogue.buildingOccupancy),
  page: clientRef(api.storageLayouts.catalogue.listStorageBuildingsPage),
  list: clientRef(api.storageLayouts.catalogue.listStorageBuildings),
  get: clientRef(api.storageLayouts.catalogue.getStorageBuilding),
  layout: clientRef(api.storageLayouts.catalogue.getStorageBuildingLayout),
  inventory: clientRef(
    api.storageLayouts.catalogue.getStorageBuildingInventory,
  ),
  locationMap: clientRef(api.storageLayouts.catalogue.getStorageLocationMap),
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
  readiness: clientRef(api.storageLayouts.writes.layoutReadiness),
  lifecycleImpact: clientRef(api.storageLayouts.writes.buildingLifecycleImpact),
  removeTopFloor: clientRef(api.storageLayouts.writes.removeTopStorageFloor),
  namedLayoutTarget: clientRef(
    api.storageLayouts.namedLayout.namedLocationLayoutTarget,
  ),
  completeNamedLayout: clientRef(
    api.storageLayouts.namedLayout.completeNamedLocationLayout,
  ),
});

export interface LayoutReadinessIssue {
  readonly code: string;
  readonly blocking: boolean;
  readonly floorNumber?: number;
  readonly zoneCode?: string;
  readonly zoneLabel?: string;
  readonly field?: string;
}

export interface LayoutReadiness {
  readonly found: boolean;
  readonly status?: StorageLayoutStatus;
  readonly version?: number;
  readonly zoneCount?: number;
  readonly ready?: boolean;
  readonly issues?: readonly LayoutReadinessIssue[];
}

export interface BuildingLifecycleImpact {
  readonly found: boolean;
  /** False means the displayed counts are lower bounds. */
  readonly complete?: boolean;
  readonly capacityExceeded?: boolean;
  readonly canArchive?: boolean;
  readonly status?: StorageLayoutStatus;
  readonly version?: number;
  readonly floorCount?: number;
  readonly zoneCount?: number;
  readonly positionCount?: number;
  readonly namedRegistrationCount?: number;
  readonly namedRegistrationCountComplete?: boolean;
  readonly occupied?: boolean;
}
