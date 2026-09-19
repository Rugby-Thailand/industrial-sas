import type { Doc, Id } from "../../_generated/dataModel";

export const MAX_SCAN_UNITS = 50;
export type ScanFailure = { ok: false; error: { code: string } };
export type ScanUnit = {
  id: Id<"finishedGoodsPallets">;
  code: string;
  storageFormat: "PALLET" | "BOX" | "OTHER";
  productId: Id<"finishedGoodsProducts">;
  productName: string;
  status: Doc<"finishedGoodsPallets">["status"];
  version: number;
  sameSize?: boolean;
  fillPercent?: number;
};
export type ScanLocation = {
  zoneId: Id<"storageZones">;
  locationId: Id<"locations">;
  supportPositionId?: Id<"storagePositions">;
  buildingId: Id<"storageBuildings">;
  floorId: Id<"storageFloors">;
  code: string;
  name: string;
  version: string;
};
export type ScanAssignmentInput = {
  warehouseId: Id<"warehouses">;
  requestId: string;
  units: {
    unitId: Id<"finishedGoodsPallets">;
    version: number;
    fillPercent: number;
  }[];
  location: {
    zoneId: Id<"storageZones">;
    supportPositionId?: Id<"storagePositions">;
    version: string;
    code: string;
    method: "SCAN" | "MANUAL";
  };
  sameSize: boolean;
  physicalConfirmed: boolean;
};
export type ScanAssignmentReceipt = Doc<"finishedGoodsScanAssignments"> & {
  orderedUnits: {
    unitId: Id<"finishedGoodsPallets">;
    code: string;
    productName: string;
    fillPercent: number;
    sequence: number;
  }[];
  location: ScanLocation;
};
export function validFillPercent(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 100;
}
export function scanGroupError(
  units: ScanAssignmentInput["units"],
): string | null {
  if (!units.length || units.length > MAX_SCAN_UNITS)
    return "SCAN_GROUP_SIZE_INVALID";
  if (new Set(units.map((unit) => unit.unitId)).size !== units.length)
    return "DUPLICATE_UNIT";
  if (units.some((unit) => !validFillPercent(unit.fillPercent)))
    return "FILL_PERCENT_INVALID";
  return null;
}
export type GeometricPlacement = Extract<
  Doc<"finishedGoodsPlacements">,
  { mode?: "GEOMETRIC" }
>;
export function isGeometricPlacement(
  placement: Doc<"finishedGoodsPlacements">,
): placement is GeometricPlacement {
  return placement.mode !== "LOCATION_ONLY";
}
