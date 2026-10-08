import { expect, it } from "vitest";
import { storageBuildingPath, storageFloorPath } from "./navigation";

it("opens a building overview before its storage setup", () => {
  expect(storageBuildingPath("building-a")).toBe(
    "/master-data/storage-layouts/building-a",
  );
});

it("opens the selected floor in the building workspace editing mode", () => {
  expect(storageFloorPath("building-a", 4)).toBe(
    "/master-data/storage-layouts/building-a?floor=4&editing=1",
  );
});

it("encodes building identifiers while preserving location fragments", () => {
  expect(`${storageFloorPath("building/a", 2)}#storage-zone-zone-a`).toBe(
    "/master-data/storage-layouts/building%2Fa?floor=2&editing=1#storage-zone-zone-a",
  );
});
