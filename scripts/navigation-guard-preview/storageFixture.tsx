"use client";
import { floorMapDemo } from "@tests/fixtures/storage-floor-demo-data";
import {
  BuildingModelWorkspace,
  StorageBuildingCatalogue,
} from "@/features/storageLayouts/StorageLayoutScreens";
import type { StorageFloorRow } from "@/lib/convex/storageLayoutApi";
import { fixtureBuilding } from "./storageFixtureData";
import { CatalogueWorkspaceContext } from "./storageWorkspaceStub";

const demo = floorMapDemo(false, false);
const building = fixtureBuilding;
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

export function StorageCatalogueFixture() {
  return (
    <CatalogueWorkspaceContext.Provider value={true}>
      <StorageBuildingCatalogue />
    </CatalogueWorkspaceContext.Provider>
  );
}
