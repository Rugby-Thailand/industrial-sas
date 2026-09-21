import { expect, it } from "vitest";
import { storageFloorPath } from "./navigation";

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
