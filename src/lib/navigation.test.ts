import { expect, it } from "vitest";
import {
  batchPath,
  customerJobScanPath,
  customerNewPath,
  customerWorkspacePath,
  jobScanRecordSearchPath,
  readCustomerWorkspaceUrl,
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

it("omits customer workspace defaults and keeps the jobs filter only on the jobs section", () => {
  expect(customerWorkspacePath("c1")).toBe("/master-data/customers/c1");
  expect(
    customerWorkspacePath("c1", {
      section: "overview",
      warehouse: "all",
      filter: "all",
    }),
  ).toBe("/master-data/customers/c1");
  expect(
    customerWorkspacePath("c1", {
      section: "jobs",
      warehouse: "wh1",
      filter: "unmapped",
    }),
  ).toBe(
    "/master-data/customers/c1?section=jobs&warehouse=wh1&filter=unmapped",
  );
  expect(
    customerWorkspacePath("c1", { section: "products", filter: "mapped" }),
  ).toBe("/master-data/customers/c1?section=products");
});

it("normalizes customer workspace URLs for the member's warehouse access", () => {
  const read = (query: string, canViewWarehouseData = true) =>
    readCustomerWorkspaceUrl(new URLSearchParams(query), {
      canViewWarehouseData,
    });
  expect(read("")).toEqual({
    section: "overview",
    warehouse: "all",
    filter: "all",
  });
  expect(read("section=jobs&warehouse=wh1&filter=mapped")).toEqual({
    section: "jobs",
    warehouse: "wh1",
    filter: "mapped",
  });
  expect(read("section=unknown&warehouse=../x&filter=mapped")).toEqual({
    section: "overview",
    warehouse: "all",
    filter: "all",
  });
  expect(read("section=stock&warehouse=wh1", false)).toEqual({
    section: "overview",
    warehouse: "all",
    filter: "all",
  });
  expect(read("section=details", false).section).toBe("details");
});

it("links workspace jobs to their saved record search and the scan page to the customer", () => {
  const records = new URL(
    jobScanRecordSearchPath("wh1", "JO-691124"),
    "https://example.test",
  );
  expect(records.pathname).toBe("/finished-goods/scan/records");
  expect(records.searchParams.get("warehouseId")).toBe("wh1");
  expect(JSON.parse(records.searchParams.get("scans")!)).toEqual({
    filter: "ALL",
    search: "JO-691124",
  });
  expect(customerJobScanPath("c1")).toBe("/finished-goods/scan?customer=c1");
});
