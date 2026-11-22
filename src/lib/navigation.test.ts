import { expect, it } from "vitest";
import {
  batchPath,
  customerNewPath,
  productPackingPath,
  storageBuildingPath,
  storageFloorPath,
} from "./navigation";

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

it("builds raw-name-free customer creation URLs only from valid opaque prefill tokens", () => {
  expect(customerNewPath()).toBe("/master-data/customers/new");
  expect(customerNewPath({ prefill: "token_1234-abcd" })).toBe(
    "/master-data/customers/new?prefill=token_1234-abcd",
  );
  expect(customerNewPath({ prefill: "short" })).toBe(
    "/master-data/customers/new",
  );
  expect(customerNewPath({ prefill: "บริษัท ไทยรุ่งเรือง" })).toBe(
    "/master-data/customers/new",
  );
});

it("builds cross-warehouse packing and batch paths cleanly", () => {
  expect(productPackingPath("product-a")).toBe(
    "/finished-goods/products/product-a/packing",
  );
  expect(
    productPackingPath("product-a", {
      draft: "draft-1",
      warehouseId: "warehouse-b",
    }),
  ).toBe(
    "/finished-goods/products/product-a/packing?draft=draft-1&warehouseId=warehouse-b",
  );
  expect(batchPath("batch-a")).toBe("/finished-goods/batches/batch-a");
  expect(batchPath("batch-a", "warehouse-b")).toBe(
    "/finished-goods/batches/batch-a?warehouseId=warehouse-b",
  );
});
