/**
 * Unit tier — bucket identity, the canonical key, and the virtual boundaries.
 *
 * The key's job is to be a *total injection*: two different buckets must never
 * encode alike, because a colliding key would put one bucket's stock in another's
 * balance row. The cases below cover the collisions a delimiter-joined key would
 * actually produce, and `inventory-ledger.property.test.ts` proves injectivity over
 * randomized buckets.
 */
import { describe, expect, it } from "vitest";

import {
  BUCKET_KEY_PREFIX,
  CONSERVATION_KEY_PREFIX,
  MAX_BUCKET_COMPONENT_LENGTH,
  STOCK_STATUSES,
  VIRTUAL_BOUNDARIES,
  conservationKeyOfBucket,
  decodeBucketKey,
  encodeBucketKey,
  encodeConservationKey,
  isAvailableStatus,
  isPhysicalLocation,
  isStockStatus,
  physicalLocation,
  validateBucket,
  validateLedgerLocation,
  virtualBoundaryByCode,
  virtualBoundaryCodes,
  virtualLocation,
  type InventoryBucket,
} from "./stockIdentity";

const bucket = (overrides: Partial<InventoryBucket> = {}): InventoryBucket => ({
  orgId: "org1",
  warehouseId: "wh1",
  itemId: "item1",
  location: { kind: "PHYSICAL", locationId: "loc1" },
  stockStatus: "AVAILABLE",
  ...overrides,
});

const key = (input: InventoryBucket): string => {
  const encoded = encodeBucketKey(input);
  if (!encoded.ok) throw new Error(`expected a key, got ${encoded.error.code}`);
  return encoded.value;
};

describe("stock status", () => {
  it("is the closed six-member set the ledger and the schema share", () => {
    expect([...STOCK_STATUSES]).toEqual([
      "AVAILABLE",
      "QC_HOLD",
      "QUARANTINE",
      "REJECTED",
      "SCRAP",
      "EXPIRED",
    ]);
    expect(isStockStatus("AVAILABLE")).toBe(true);
    expect(isStockStatus("available")).toBe(false);
    expect(isStockStatus("INVENTED")).toBe(false);
    expect(isStockStatus(null)).toBe(false);
    expect(isStockStatus(undefined)).toBe(false);
  });

  it("treats only AVAILABLE as the non-negotiable non-negative status", () => {
    expect(isAvailableStatus("AVAILABLE")).toBe(true);
    for (const status of STOCK_STATUSES.filter((s) => s !== "AVAILABLE")) {
      expect(isAvailableStatus(status)).toBe(false);
    }
  });
});

describe("virtual boundaries", () => {
  it("covers every external flow the plan names, and no more", () => {
    expect(virtualBoundaryCodes()).toEqual([
      "CUSTOMER_RETURN",
      "CUSTOMER_SHIPMENT",
      "INVENTORY_ADJUSTMENT",
      "PRODUCTION_ISSUE",
      "PRODUCTION_RECEIPT",
      "RECONCILIATION",
      "SCRAP_DAMAGE",
      "SUPPLIER_RECEIPT",
      "TRANSFER_IN_TRANSIT",
    ]);
  });

  it("declares a direction for each, so a flow cannot run backwards", () => {
    expect(virtualBoundaryByCode("SUPPLIER_RECEIPT")?.flow).toBe("SOURCE");
    expect(virtualBoundaryByCode("PRODUCTION_RECEIPT")?.flow).toBe("SOURCE");
    expect(virtualBoundaryByCode("CUSTOMER_SHIPMENT")?.flow).toBe("SINK");
    expect(virtualBoundaryByCode("CUSTOMER_RETURN")?.flow).toBe("SOURCE");
    expect(virtualBoundaryByCode("PRODUCTION_ISSUE")?.flow).toBe("SINK");
    expect(virtualBoundaryByCode("SCRAP_DAMAGE")?.flow).toBe("SINK");
    expect(virtualBoundaryByCode("INVENTORY_ADJUSTMENT")?.flow).toBe("BOTH");
    expect(virtualBoundaryByCode("TRANSFER_IN_TRANSIT")?.flow).toBe("BOTH");
    expect(virtualBoundaryByCode("RECONCILIATION")?.flow).toBe("BOTH");
  });

  it("answers null for an unknown code and for a prototype key", () => {
    expect(virtualBoundaryByCode("SUPPLIER")).toBeNull();
    expect(virtualBoundaryByCode("toString")).toBeNull();
    expect(virtualBoundaryByCode("constructor")).toBeNull();
  });

  it("is frozen at run time, not merely readonly in the signature", () => {
    expect(Object.isFrozen(VIRTUAL_BOUNDARIES)).toBe(true);
    expect(() => {
      (VIRTUAL_BOUNDARIES as Record<string, unknown>)["INVENTED"] = {};
    }).toThrow(TypeError);
    expect(virtualBoundaryByCode("INVENTED")).toBeNull();
  });
});

describe("location references", () => {
  it("decides on the discriminant, not on which field is present", () => {
    const forged = validateLedgerLocation({
      kind: "PHYSICAL",
      boundary: "SCRAP_DAMAGE",
    } as never);
    expect(forged.ok).toBe(false);
    if (!forged.ok) expect(forged.error.code).toBe("MISSING_COMPONENT");
  });

  it("refuses a boundary the catalogue does not define", () => {
    const refused = virtualLocation("SUPPLIER");
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("UNKNOWN_VIRTUAL_BOUNDARY");
    }
  });

  it("refuses a kind that is neither PHYSICAL nor VIRTUAL", () => {
    const refused = validateLedgerLocation({ kind: "EXTERNAL" } as never);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe("INVALID_LOCATION_KIND");
  });

  it("freezes what it returns and reports physicality", () => {
    const physical = physicalLocation("loc1");
    expect(physical.ok).toBe(true);
    if (!physical.ok) return;
    expect(Object.isFrozen(physical.value)).toBe(true);
    expect(isPhysicalLocation(physical.value)).toBe(true);

    const virtual = virtualLocation("SCRAP_DAMAGE");
    if (!virtual.ok) throw new Error("expected a boundary");
    expect(isPhysicalLocation(virtual.value)).toBe(false);
  });
});

describe("bucket validation", () => {
  it("omits absent optional dimensions rather than storing undefined", () => {
    const validated = validateBucket(bucket({ lotId: undefined }));
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(Object.keys(validated.value).sort()).toEqual([
      "itemId",
      "location",
      "orgId",
      "stockStatus",
      "warehouseId",
    ]);
    expect(Object.isFrozen(validated.value)).toBe(true);
  });

  it("refuses an empty optional component instead of reading it as absent", () => {
    const refused = validateBucket(bucket({ lotId: "" }));
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("INVALID_COMPONENT");
      expect(refused.error).toMatchObject({ component: "lotId" });
    }
  });

  it("refuses a component carrying the key's own punctuation", () => {
    for (const forged of ["a|b", "a:b", "a b", "a\u0000b", "a\nb"]) {
      const refused = validateBucket(bucket({ itemId: forged }));
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error.code).toBe("INVALID_COMPONENT");
    }
  });

  it("refuses a component beyond the length bound", () => {
    const refused = validateBucket(
      bucket({ itemId: "x".repeat(MAX_BUCKET_COMPONENT_LENGTH + 1) }),
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.code).toBe("COMPONENT_TOO_LONG");
      expect(refused.error).toMatchObject({
        limit: MAX_BUCKET_COMPONENT_LENGTH,
      });
    }
  });

  it("refuses a forged stock status and a non-record", () => {
    const status = validateBucket(bucket({ stockStatus: "SOLD" as never }));
    expect(status.ok).toBe(false);
    if (!status.ok) expect(status.error.code).toBe("INVALID_STOCK_STATUS");

    for (const forged of [null, undefined, "bucket", 7]) {
      const refused = validateBucket(forged as never);
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error.code).toBe("NOT_A_BUCKET");
    }
  });
});

describe("canonical bucket key", () => {
  it("round-trips every dimension, which is what makes it injective", () => {
    const full = bucket({
      lotId: "lot1",
      serialId: "ser1",
      handlingUnitId: "hu1",
      ownerId: "own1",
      stockStatus: "QC_HOLD",
    });
    const encoded = key(full);
    expect(encoded.startsWith(BUCKET_KEY_PREFIX)).toBe(true);

    const decoded = decodeBucketKey(encoded);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const revalidated = validateBucket(full);
    if (!revalidated.ok) throw new Error("expected a valid bucket");
    expect(decoded.value).toEqual(revalidated.value);
  });

  it("round-trips a virtual boundary bucket", () => {
    const external = bucket({
      location: { kind: "VIRTUAL", boundary: "SUPPLIER_RECEIPT" },
    });
    const decoded = decodeBucketKey(key(external));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value.location).toEqual({
      kind: "VIRTUAL",
      boundary: "SUPPLIER_RECEIPT",
    });
  });

  it("does not alias two buckets a delimiter-joined key would collide", () => {
    // The classic shift: moving a character across a component boundary.
    expect(key(bucket({ itemId: "ab", lotId: "c" }))).not.toBe(
      key(bucket({ itemId: "a", lotId: "bc" })),
    );
    expect(key(bucket({ warehouseId: "wh", itemId: "1item" }))).not.toBe(
      key(bucket({ warehouseId: "wh1", itemId: "item" })),
    );
    // "absent lot" is not "lot whose ID is the next component".
    expect(key(bucket({ lotId: undefined, handlingUnitId: "hu1" }))).not.toBe(
      key(bucket({ lotId: "hu1", handlingUnitId: undefined })),
    );
    // A physical location ID equal to a boundary code is still a different bucket.
    expect(
      key(
        bucket({ location: { kind: "PHYSICAL", locationId: "SCRAP_DAMAGE" } }),
      ),
    ).not.toBe(
      key(bucket({ location: { kind: "VIRTUAL", boundary: "SCRAP_DAMAGE" } })),
    );
  });

  it("separates buckets differing only in one dimension", () => {
    const base = bucket();
    const variants: InventoryBucket[] = [
      bucket({ orgId: "org2" }),
      bucket({ warehouseId: "wh2" }),
      bucket({ itemId: "item2" }),
      bucket({ location: { kind: "PHYSICAL", locationId: "loc2" } }),
      bucket({ lotId: "lot1" }),
      bucket({ serialId: "ser1" }),
      bucket({ handlingUnitId: "hu1" }),
      bucket({ ownerId: "own1" }),
      bucket({ stockStatus: "SCRAP" }),
    ];
    const keys = new Set([key(base), ...variants.map(key)]);
    expect(keys.size).toBe(variants.length + 1);
  });

  it("refuses a malformed stored key rather than misreading it", () => {
    const good = key(bucket());
    const cases: readonly [string, string][] = [
      ["IB2|4:org1", "PREFIX"],
      ["", "PREFIX"],
      [BUCKET_KEY_PREFIX, "FIELD_COUNT"],
      [`${BUCKET_KEY_PREFIX}|4:org1`, "FIELD_COUNT"],
      [`${BUCKET_KEY_PREFIX}|x:org1`, "FIELD_SYNTAX"],
      [`${BUCKET_KEY_PREFIX}|99:org1`, "FIELD_LENGTH"],
      [`${good}|3:xyz`, "TRAILING_INPUT"],
      [`${good}extra`, "TRAILING_INPUT"],
    ];
    for (const [forged, reason] of cases) {
      const refused = decodeBucketKey(forged);
      expect(refused.ok, forged).toBe(false);
      if (!refused.ok) {
        expect(refused.error.code, forged).toBe("MALFORMED_BUCKET_KEY");
        expect(refused.error, forged).toMatchObject({ reason });
      }
    }
    expect(decodeBucketKey(null as never).ok).toBe(false);
  });

  it("refuses to encode a bucket it would not validate", () => {
    const refused = encodeBucketKey(bucket({ itemId: "a|b" }));
    expect(refused.ok).toBe(false);
  });
});

describe("conservation key", () => {
  it("carries its own prefix so it cannot equal a bucket key", () => {
    const conservation = conservationKeyOfBucket(bucket(), "PCS");
    expect(conservation.ok).toBe(true);
    if (!conservation.ok) return;
    expect(conservation.value.startsWith(CONSERVATION_KEY_PREFIX)).toBe(true);
    expect(conservation.value).not.toBe(key(bucket()));
  });

  it("ignores location, handling unit, and stock status", () => {
    const left = conservationKeyOfBucket(
      bucket({
        location: { kind: "PHYSICAL", locationId: "loc1" },
        handlingUnitId: "hu1",
        stockStatus: "AVAILABLE",
      }),
      "PCS",
    );
    const right = conservationKeyOfBucket(
      bucket({
        location: { kind: "VIRTUAL", boundary: "SUPPLIER_RECEIPT" },
        handlingUnitId: "hu2",
        stockStatus: "QC_HOLD",
      }),
      "PCS",
    );
    expect(left.ok && right.ok).toBe(true);
    if (!left.ok || !right.ok) return;
    expect(left.value).toBe(right.value);
  });

  it("separates warehouse, item, lot, serial, owner, and UOM", () => {
    const keys = new Set(
      (
        [
          [bucket(), "PCS"],
          [bucket({ warehouseId: "wh2" }), "PCS"],
          [bucket({ itemId: "item2" }), "PCS"],
          [bucket({ lotId: "lot1" }), "PCS"],
          [bucket({ serialId: "ser1" }), "PCS"],
          [bucket({ ownerId: "own1" }), "PCS"],
          [bucket(), "KG"],
        ] as const
      ).map(([input, uom]) => {
        const encoded = conservationKeyOfBucket(input, uom);
        if (!encoded.ok) throw new Error("expected a conservation key");
        return encoded.value;
      }),
    );
    expect(keys.size).toBe(7);
  });

  it("refuses a forged input", () => {
    expect(encodeConservationKey(null as never).ok).toBe(false);
    expect(
      encodeConservationKey({
        orgId: "org1",
        warehouseId: "wh1",
        itemId: "item1",
        uom: "P|CS",
      }).ok,
    ).toBe(false);
  });
});
