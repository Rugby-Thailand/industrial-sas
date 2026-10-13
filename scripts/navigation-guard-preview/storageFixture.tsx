"use client";
import { floorMapDemo } from "@/components/storageLayouts/storageFloorDemoData";
import { BuildingModelWorkspace } from "@/features/storageLayouts/StorageLayoutScreens";
import type {
  StorageBuildingRow,
  StorageFloorRow,
} from "@/lib/convex/storageLayoutApi";

const demo = floorMapDemo(false, false);
const building: StorageBuildingRow = {
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
const floors: StorageFloorRow[] = [
  {
    floorId: "fixture-floor",
    floorNumber: 1,
    grossAreaSqMm: building.grossAreaSqMm,
    reservedAreaSqMm: 0,
    usableAreaSqMm: building.usableAreaSqMm,
    version: 1,
    storageZones: demo.zones,
    reservedBlocks: demo.blocks.map((block, index) => ({
      ...block,
      blockId: `fixture-block-${index}`,
    })),
  },
];

export function StorageFixture() {
  return <BuildingModelWorkspace building={building} floors={floors} />;
}
