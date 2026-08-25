import { describe, expect, it } from "vitest";

import {
  encodeBucketKey,
  type InventoryBucket,
} from "../../../convex/model/inventory/stockIdentity";

import { describeBucketKey } from "./bucketIdentity";

const keyOf = (bucket: InventoryBucket): string => {
  const encoded = encodeBucketKey(bucket);
  if (!encoded.ok) throw new Error(JSON.stringify(encoded.error));
  return encoded.value;
};

const PHYSICAL: InventoryBucket = {
  orgId: "org_fixture",
  warehouseId: "wh_bangpoo",
  itemId: "item_steel_coil",
  location: { kind: "PHYSICAL", locationId: "loc_A01-02-1" },
  lotId: "lot_2607B",
  stockStatus: "AVAILABLE",
};

describe("describeBucketKey", () => {
  it("names the dimensions a screen can tell two rows apart by", () => {
    expect(describeBucketKey(keyOf(PHYSICAL))).toEqual([
      { dimension: "item", value: "item_steel_coil" },
      { dimension: "location", value: "loc_A01-02-1" },
      { dimension: "lot", value: "lot_2607B" },
    ]);
  });

  it("omits the organization and the warehouse", () => {
    const parts = describeBucketKey(keyOf(PHYSICAL));

    expect(parts.map((part) => part.value)).not.toContain("org_fixture");
    expect(parts.map((part) => part.value)).not.toContain("wh_bangpoo");
  });

  it("omits an absent optional dimension rather than reporting it empty", () => {
    const parts = describeBucketKey(
      keyOf({
        orgId: "org_fixture",
        warehouseId: "wh_bangpoo",
        itemId: "item_bolt_m8",
        location: { kind: "PHYSICAL", locationId: "loc_B04-11-3" },
        stockStatus: "AVAILABLE",
      }),
    );

    expect(parts.map((part) => part.dimension)).toEqual(["item", "location"]);
  });

  it("reports every optional dimension a bucket does carry", () => {
    const parts = describeBucketKey(
      keyOf({
        ...PHYSICAL,
        serialId: "serial_9",
        handlingUnitId: "hu_pallet_01",
        ownerId: "owner_customer_a",
      }),
    );

    expect(parts.map((part) => part.dimension)).toEqual([
      "item",
      "location",
      "lot",
      "serial",
      "handlingUnit",
      "owner",
    ]);
  });

  it("reports a virtual boundary as a boundary, not as a location", () => {
    const parts = describeBucketKey(
      keyOf({
        ...PHYSICAL,
        location: { kind: "VIRTUAL", boundary: "SUPPLIER_RECEIPT" },
      }),
    );

    expect(parts).toContainEqual({
      dimension: "boundary",
      value: "SUPPLIER_RECEIPT",
    });
    expect(parts.map((part) => part.dimension)).not.toContain("location");
  });

  it("distinguishes two buckets that differ in one dimension", () => {
    const left = describeBucketKey(keyOf(PHYSICAL));
    const right = describeBucketKey(keyOf({ ...PHYSICAL, lotId: "lot_2608C" }));

    expect(left).not.toEqual(right);
  });

  it("answers nothing for a key it cannot decode, and never throws", () => {
    for (const malformed of ["", "IB1|3:org", "not-a-key", "IB1|9:short"]) {
      expect(describeBucketKey(malformed), malformed).toEqual([]);
    }
  });
});
