import { floorMapDemo } from "@tests/fixtures/storage-floor-demo-data";
import type { StorageBuildingRow } from "@/lib/convex/storageLayoutApi";

const demo = floorMapDemo(false, false);
export const fixtureBuilding: StorageBuildingRow = {
  buildingId: "fixture-building",
  warehouseId: "fixture-warehouse",
  code: "FIXTURE",
  name: "Storage editor fixture",
  widthMm: demo.widthMm,
  depthMm: demo.depthMm,
  defaultFloorHeightMm: demo.heightMm,
  floorCount: 1,
  totalHeightMm: demo.heightMm,
  grossAreaSqMm: demo.widthMm * demo.depthMm,
  reservedAreaSqMm: 0,
  usableAreaSqMm: demo.widthMm * demo.depthMm,
  status: "DRAFT",
  version: 1,
};
