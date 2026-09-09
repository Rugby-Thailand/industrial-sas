import { describe, expect, it } from "vitest";
import {
  finishedGoodsList,
  finishedGoodProduct,
  finishedGoodPallet,
} from "@tests/fixtures/finished-goods-ui";
import {
  catalogueRows,
  clearColumn,
  filterRows,
  filtersValid,
  newCatalogueState,
  newFilters,
  readCatalogueState,
  serializeCatalogueState,
  type CatalogueFilters,
} from "./catalogueFilters";

const data = {
  products: [
    finishedGoodProduct,
    {
      ...finishedGoodProduct,
      _id: "b",
      sku: "FG-002",
      name: "Empty",
      status: "DRAFT" as const,
    },
    {
      ...finishedGoodProduct,
      _id: "c",
      sku: "FG-003",
      name: "Liquid",
      unit: "kg",
    },
  ],
  pallets: [
    {
      ...finishedGoodsList.pallets[0]!,
      quantity: 50,
      storageFormat: "BOX" as const,
    },
    {
      ...finishedGoodsList.pallets[0]!,
      _id: "second",
      code: "P-002",
      quantity: 50,
      status: "STORED" as const,
      lengthMm: 1200,
      widthMm: 1000,
      heightMm: 1400,
      storageFormat: "PALLET" as const,
    },
    {
      ...finishedGoodsList.pallets[0]!,
      _id: "third",
      productId: "c",
      code: "P-003",
      quantity: 5,
      status: "STORED" as const,
      moveStatus: "IN_TRANSIT" as const,
      lot: "LIQ",
    },
    {
      ...finishedGoodsList.pallets[0]!,
      _id: "retired",
      quantity: 999,
      retiredAt: 123,
    },
  ],
};
const rows = catalogueRows(data);
const match = (
  f: Partial<CatalogueFilters>,
  tab: "products" | "pallets" = "products",
  search = "",
) =>
  filterRows(rows[tab], { ...newFilters(), ...f }, search, "en").map(
    (r) => r.id,
  );

describe("catalogue column filtering", () => {
  it("uses actual active quantities and ignores retired records", () => {
    expect(rows.products[0]?.quantity).toBe(100);
    expect(rows.pallets).toHaveLength(3);
  });
  it("combines columns with AND and choices with OR", () => {
    expect(
      match({
        formats: ["BOX", "PALLET"],
        statuses: ["ACTIVE"],
        progress: ["stored"],
      }),
    ).toEqual(["product-a"]);
    expect(match({ formats: ["BOX"], statuses: ["DRAFT"] })).toEqual([]);
    expect(match({ statuses: ["ACTIVE", "DRAFT"], record: "empty" })).toEqual([
      "b",
    ]);
  });
  it("matches mixed progress and empty products without treating moving units as stored", () => {
    expect(match({ progress: ["awaitingMeasurement", "stored"] })).toEqual([
      "product-a",
    ]);
    expect(match({ progress: ["empty", "moving"] })).toEqual(["b", "c"]);
  });
  it("uses inclusive ranges, zero, decimals and exact counting units", () => {
    expect(
      match({ unit: "pieces", quantity: { min: "100", max: "100" } }),
    ).toEqual(["product-a"]);
    expect(match({ unit: "pieces", quantity: { min: "0", max: "0" } })).toEqual(
      ["b"],
    );
    expect(match({ unit: "kg", quantity: { min: "4.5", max: "5.1" } })).toEqual(
      ["c"],
    );
  });
  it("searches product names, SKU, storage-unit codes and lots", () => {
    expect(match({}, "products", "p-002")).toEqual(["product-a"]);
    expect(match({}, "pallets", " liquid ")).toEqual(["third"]);
    expect(match({ record: "fg-001", lot: "lot-001" }, "pallets")).toEqual([
      "pallet-a",
      "second",
    ]);
  });
  it("filters dimensions in metres and incomplete measurements", () => {
    expect(
      match(
        { length: { min: "1.2", max: "1.2" }, height: { min: "1", max: "2" } },
        "pallets",
      ),
    ).toEqual(["second"]);
    expect(match({ measurement: "unmeasured" }, "pallets")).toEqual([
      "pallet-a",
      "third",
    ]);
    expect(match({ statuses: ["STORED"] }, "pallets")).toEqual(["second"]);
    expect(match({ statuses: ["IN_TRANSIT"] }, "pallets")).toEqual(["third"]);
  });
  it("sorts numerically within unit groups and keeps missing dimensions last", () => {
    expect(match({ sort: "quantity:desc" })).toEqual(["c", "product-a", "b"]);
    expect(match({ sort: "length:asc" }, "pallets")[0]).toBe("second");
    expect(match({ sort: "length:desc" }, "pallets")[0]).toBe("second");
    expect(match({ sort: "name:asc" })).toEqual(["b", "c", "product-a"]);
  });
  it("validates ranges and requires a unit before applying quantity limits", () => {
    for (const quantity of [
      { min: "-1", max: "" },
      { min: "3", max: "2" },
      { min: "NaN", max: "" },
      { min: "Infinity", max: "" },
    ])
      expect(filtersValid({ ...newFilters(), unit: "pieces", quantity })).toBe(
        false,
      );
    expect(
      filtersValid({ ...newFilters(), quantity: { min: "0", max: "100" } }),
    ).toBe(false);
    expect(
      filtersValid({
        ...newFilters(),
        unit: "pieces",
        quantity: { min: "0", max: "0" },
      }),
    ).toBe(true);
  });
  it("clears only the requested column and its sorting", () => {
    const cleared = clearColumn(
      {
        ...newFilters(),
        record: "abc",
        statuses: ["ACTIVE"],
        sort: "status:asc",
      },
      "status",
    );
    expect(cleared.record).toBe("abc");
    expect(cleared.statuses).toEqual([]);
    expect(cleared.sort).toBe("");
  });
  it("round trips both tabs and layout through the URL", () => {
    const state = {
      ...newCatalogueState(),
      layout: "table" as const,
      search: "กล่อง",
      products: {
        ...newFilters(),
        formats: ["BOX"],
        unit: "ชิ้น",
        quantity: { min: "0", max: "100" },
      },
      pallets: { ...newFilters(), lot: "LOT", sort: "code:desc" },
    };
    expect(
      readCatalogueState(
        `?fg=${encodeURIComponent(serializeCatalogueState(state))}`,
      ),
    ).toEqual(state);
  });
  it("safely ignores malformed URLs, hidden columns and unknown options", () => {
    for (const query of [
      "?fg=bad",
      "?fg=null",
      "?fg=3",
      `?fg=${"x".repeat(13000)}`,
    ])
      expect(readCatalogueState(query)).toEqual(newCatalogueState());
    const parsed = readCatalogueState(
      `?fg=${encodeURIComponent(JSON.stringify({ products: { statuses: ["ACTIVE", "ACTIVE", "BAD"], lot: "invisible", measurement: "measured", sort: "lot:asc", quantity: { min: "1", max: "5" } }, pallets: { formats: ["BOX"], progress: ["stored"], width: { min: "5", max: "1" } } }))}`,
    );
    expect(parsed.products).toEqual({ ...newFilters(), statuses: ["ACTIVE"] });
    expect(parsed.pallets).toEqual(newFilters());
  });
  it("handles completely empty warehouses", () => {
    expect(catalogueRows({ products: [], pallets: [] })).toEqual({
      products: [],
      pallets: [],
    });
    expect(
      catalogueRows({
        products: [finishedGoodProduct],
        pallets: [
          { ...finishedGoodPallet, productName: "", sku: "", retiredAt: 123 },
        ],
      }).products[0]?.quantity,
    ).toBe(0);
  });
});

it("writes compact URLs and removes default filter state", () => {
  expect(serializeCatalogueState(newCatalogueState())).toBe("");
  expect(
    serializeCatalogueState({ ...newCatalogueState(), layout: "table" }),
  ).toBe('{"layout":"table"}');
});
