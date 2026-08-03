/**
 * Unit tier — item UOM profiles and conversions.
 *
 * The scenarios are the ones ADR-0004 argues about: a clean pack factor, a factor
 * that cannot land on a whole minor unit, an alternate-to-alternate conversion
 * that only works because it does not detour through the base, and the two
 * mistakes a UOM check alone cannot catch (another item's factors, another item's
 * stock).
 */
import { describe, expect, it } from "vitest";

import { expectError, expectOk } from "../../../tests/fixtures/domain-results";
import {
  addItemQuantities,
  conversionToBase,
  convertBetween,
  convertFromBase,
  convertToBase,
  makeItemQuantity,
  makeItemUomProfile,
  MAX_ITEM_KEY_LENGTH,
  alternateUoms,
  validateItemUomProfile,
  type ItemUomProfile,
} from "./itemUom";
import { makeQuantity } from "./quantity";
import { makeRatio, MAX_RATIO_COMPONENT } from "./ratio";

const ratio = (numerator: number, denominator: number) =>
  expectOk(makeRatio(numerator, denominator));

/** A case of twelve pieces, and a pallet of forty cases. */
const boltsProfile: ItemUomProfile = expectOk(
  makeItemUomProfile({
    itemKey: "ITEM-BOLT-M8",
    baseUom: "PCS",
    alternates: [
      { uom: "CASE", toBase: ratio(12, 1) },
      { uom: "PALLET", toBase: ratio(480, 1) },
    ],
  }),
);

/** A resin sold in drums of 200.5 kg and in thirds of a kilogram. */
const resinProfile: ItemUomProfile = expectOk(
  makeItemUomProfile({
    itemKey: "ITEM-RESIN",
    baseUom: "KG",
    alternates: [
      { uom: "DRUM", toBase: ratio(401, 2) },
      { uom: "THIRD", toBase: ratio(1, 3) },
    ],
  }),
);

describe("makeItemUomProfile", () => {
  it("keeps the base UOM and the declared alternates", () => {
    expect(boltsProfile.itemKey).toBe("ITEM-BOLT-M8");
    expect(boltsProfile.baseUom).toBe("PCS");
    expect(alternateUoms(boltsProfile)).toEqual(["CASE", "PALLET"]);
    expect(Object.isFrozen(boltsProfile)).toBe(true);
  });

  it("normalizes UOM codes on the way in", () => {
    const profile = expectOk(
      makeItemUomProfile({
        itemKey: "ITEM-1",
        baseUom: "pcs",
        alternates: [{ uom: "case", toBase: ratio(6, 1) }],
      }),
    );
    expect(profile.baseUom).toBe("PCS");
    expect(alternateUoms(profile)).toEqual(["CASE"]);
  });

  it("rejects a duplicate alternate and an alternate that repeats the base", () => {
    expect(
      makeItemUomProfile({
        itemKey: "ITEM-1",
        baseUom: "PCS",
        alternates: [
          { uom: "CASE", toBase: ratio(12, 1) },
          { uom: "CASE", toBase: ratio(6, 1) },
        ],
      }),
    ).toEqual({ ok: false, error: { code: "DUPLICATE_UOM", uom: "CASE" } });
    expect(
      makeItemUomProfile({
        itemKey: "ITEM-1",
        baseUom: "PCS",
        alternates: [{ uom: "PCS", toBase: ratio(2, 1) }],
      }),
    ).toEqual({
      ok: false,
      error: { code: "BASE_UOM_AS_ALTERNATE", uom: "PCS" },
    });
  });

  it("rejects an invalid item key, UOM code, or ratio", () => {
    expect(
      expectError(makeItemUomProfile({ itemKey: "  ", baseUom: "PCS" })).code,
    ).toBe("INVALID_ITEM_KEY");
    expect(
      makeItemUomProfile({
        itemKey: "x".repeat(MAX_ITEM_KEY_LENGTH + 1),
        baseUom: "PCS",
      }).ok,
    ).toBe(false);
    expect(makeItemUomProfile({ itemKey: "ITEM-1", baseUom: "1" }).ok).toBe(
      false,
    );
    expect(
      makeItemUomProfile({
        itemKey: "ITEM-1",
        baseUom: "PCS",
        alternates: [{ uom: "CASE", toBase: { numerator: 1, denominator: 0 } }],
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "RATIO_INVALID",
        error: { code: "NOT_POSITIVE", numerator: 1, denominator: 0 },
      },
    });
  });

  it("resolves the base UOM to the identity factor", () => {
    expect(conversionToBase(boltsProfile, "PCS")).toEqual({
      ok: true,
      value: { numerator: 1, denominator: 1 },
    });
    expect(conversionToBase(boltsProfile, "CASE")).toEqual({
      ok: true,
      value: { numerator: 12, denominator: 1 },
    });
  });
});

describe("convertToBase", () => {
  it("converts an exact pack quantity", () => {
    // 3 CASE = 36 PCS = 36000 minor units.
    expect(convertToBase(boltsProfile, "CASE", 3000)).toEqual({
      kind: "EXACT",
      quantity: { uom: "PCS", minorUnits: 36_000 },
    });
  });

  it("converts a fractional pack quantity when it is still exact", () => {
    // 0.5 CASE = 6 PCS.
    expect(convertToBase(boltsProfile, "CASE", 500)).toEqual({
      kind: "EXACT",
      quantity: { uom: "PCS", minorUnits: 6000 },
    });
    // 2 DRUM = 401 KG.
    expect(convertToBase(resinProfile, "DRUM", 2000)).toEqual({
      kind: "EXACT",
      quantity: { uom: "KG", minorUnits: 401_000 },
    });
  });

  it("reports the exact fraction when the result is not a whole minor unit", () => {
    // 1 THIRD is 1/3 KG: 333.333… thousandths, which three decimals cannot hold.
    expect(convertToBase(resinProfile, "THIRD", 1000)).toEqual({
      kind: "INEXACT",
      uom: "KG",
      exact: { numerator: 1000, denominator: 3 },
    });
    // 1 DRUM is 200.5 KG, and a thousandth of a drum is 0.2005 KG.
    expect(convertToBase(resinProfile, "DRUM", 1)).toEqual({
      kind: "INEXACT",
      uom: "KG",
      exact: { numerator: 401, denominator: 2 },
    });
  });

  it("rejects a UOM the item does not declare", () => {
    expect(convertToBase(boltsProfile, "DRUM", 1000)).toEqual({
      kind: "REJECTED",
      error: { code: "UNKNOWN_UOM", itemKey: "ITEM-BOLT-M8", uom: "DRUM" },
    });
  });

  it("rejects an invalid captured amount", () => {
    expect(convertToBase(boltsProfile, "CASE", 0.5)).toEqual({
      kind: "REJECTED",
      error: {
        code: "QUANTITY_INVALID",
        error: { code: "NOT_AN_INTEGER", value: 0.5 },
      },
    });
    expect(
      convertToBase(boltsProfile, "CASE", Number.MAX_SAFE_INTEGER),
    ).toEqual({
      kind: "REJECTED",
      error: {
        code: "QUANTITY_INVALID",
        error: {
          code: "OUT_OF_RANGE",
          value: Number.MAX_SAFE_INTEGER,
          limit: 1_000_000_000_000,
        },
      },
    });
  });

  it("distinguishes an unrepresentable product from an out-of-bound one", () => {
    const profile = expectOk(
      makeItemUomProfile({
        itemKey: "ITEM-BIG",
        baseUom: "PCS",
        alternates: [
          { uom: "MEGA", toBase: ratio(MAX_RATIO_COMPONENT, 1) },
          { uom: "KILO", toBase: ratio(1000, 1) },
        ],
      }),
    );
    // 10^12 × 10^6 is past 2^53: the exact product cannot be represented at all.
    expect(convertToBase(profile, "MEGA", 1_000_000_000_000)).toEqual({
      kind: "REJECTED",
      error: {
        code: "CONVERSION_OVERFLOW",
        itemKey: "ITEM-BIG",
        fromUom: "MEGA",
        toUom: "PCS",
      },
    });
    // 10^12 × 10^3 is exact, and still past the quantity bound.
    expect(convertToBase(profile, "KILO", 1_000_000_000_000)).toEqual({
      kind: "REJECTED",
      error: {
        code: "QUANTITY_INVALID",
        error: {
          code: "OUT_OF_RANGE",
          value: 1_000_000_000_000_000,
          limit: 1_000_000_000_000,
        },
      },
    });
  });
});

describe("convertFromBase", () => {
  it("converts base stock into a pack count", () => {
    const stock = expectOk(makeQuantity(36_000, "PCS"));
    expect(convertFromBase(boltsProfile, "CASE", stock)).toEqual({
      kind: "EXACT",
      quantity: { uom: "CASE", minorUnits: 3000 },
    });
  });

  it("reports the exact fraction, reduced, for a part pack", () => {
    // One piece is 1/12 of a case: 1000/12 thousandths, reduced to 250/3.
    const stock = expectOk(makeQuantity(1000, "PCS"));
    expect(convertFromBase(boltsProfile, "CASE", stock)).toEqual({
      kind: "INEXACT",
      uom: "CASE",
      exact: { numerator: 250, denominator: 3 },
    });
  });

  it("round-trips every exact conversion", () => {
    const captured = convertToBase(boltsProfile, "CASE", 2500);
    expect(captured.kind).toBe("EXACT");
    if (captured.kind !== "EXACT") return;
    expect(convertFromBase(boltsProfile, "CASE", captured.quantity)).toEqual({
      kind: "EXACT",
      quantity: { uom: "CASE", minorUnits: 2500 },
    });
  });

  it("refuses stock measured in something other than the base UOM", () => {
    const wrong = expectOk(makeQuantity(1000, "KG"));
    expect(convertFromBase(boltsProfile, "CASE", wrong)).toEqual({
      kind: "REJECTED",
      error: { code: "BASE_UOM_MISMATCH", expected: "PCS", actual: "KG" },
    });
  });
});

describe("convertBetween", () => {
  it("composes both factors instead of detouring through the base", () => {
    // 1 PALLET = 40 CASE, and the composition is exact even though a single
    // piece is not a whole case.
    expect(convertBetween(boltsProfile, "PALLET", "CASE", 1000)).toEqual({
      kind: "EXACT",
      quantity: { uom: "CASE", minorUnits: 40_000 },
    });
    // 3 THIRD = 1 KG exactly, though one THIRD is not a whole KG minor unit.
    expect(convertBetween(resinProfile, "THIRD", "KG", 3000)).toEqual({
      kind: "EXACT",
      quantity: { uom: "KG", minorUnits: 1000 },
    });
  });

  it("still reports an inexact composition", () => {
    // One case is 0.025 pallet, which three decimals hold exactly…
    expect(convertBetween(boltsProfile, "CASE", "PALLET", 1000)).toEqual({
      kind: "EXACT",
      quantity: { uom: "PALLET", minorUnits: 25 },
    });
    // …but one piece is 1/480 of a pallet, which they do not.
    expect(convertBetween(boltsProfile, "PCS", "PALLET", 1000)).toEqual({
      kind: "INEXACT",
      uom: "PALLET",
      exact: { numerator: 25, denominator: 12 },
    });
  });

  it("rejects either side being undeclared", () => {
    expect(convertBetween(boltsProfile, "CASE", "DRUM", 1000).kind).toBe(
      "REJECTED",
    );
    expect(convertBetween(boltsProfile, "DRUM", "CASE", 1000).kind).toBe(
      "REJECTED",
    );
  });
});

describe("item-scoped quantities", () => {
  it("binds a base quantity to its item", () => {
    const quantity = expectOk(makeQuantity(12_000, "PCS"));
    expect(makeItemQuantity(boltsProfile, quantity)).toEqual({
      ok: true,
      value: {
        itemKey: "ITEM-BOLT-M8",
        quantity: { uom: "PCS", minorUnits: 12_000 },
      },
    });
  });

  it("refuses to add two items that share a UOM", () => {
    // The failure a UOM check cannot see: both are KG, and they are still two
    // different items.
    const resin = expectOk(
      makeItemQuantity(resinProfile, expectOk(makeQuantity(1000, "KG"))),
    );
    const otherProfile = expectOk(
      makeItemUomProfile({ itemKey: "ITEM-SOLVENT", baseUom: "KG" }),
    );
    const solvent = expectOk(
      makeItemQuantity(otherProfile, expectOk(makeQuantity(1000, "KG"))),
    );
    expect(addItemQuantities(resin, solvent)).toEqual({
      ok: false,
      error: {
        code: "ITEM_MISMATCH",
        expected: "ITEM-RESIN",
        actual: "ITEM-SOLVENT",
      },
    });
  });

  it("adds two quantities of the same item", () => {
    const first = expectOk(
      makeItemQuantity(resinProfile, expectOk(makeQuantity(1500, "KG"))),
    );
    const second = expectOk(
      makeItemQuantity(resinProfile, expectOk(makeQuantity(2500, "KG"))),
    );
    expect(addItemQuantities(first, second)).toEqual({
      ok: true,
      value: {
        itemKey: "ITEM-RESIN",
        quantity: { uom: "KG", minorUnits: 4000 },
      },
    });
  });

  it("rejects binding a quantity in the wrong UOM", () => {
    const wrong = expectOk(makeQuantity(1000, "CASE"));
    expect(makeItemQuantity(boltsProfile, wrong)).toEqual({
      ok: false,
      error: { code: "BASE_UOM_MISMATCH", expected: "PCS", actual: "CASE" },
    });
  });
});

describe("profile immutability and forged input", () => {
  it("does not hand out a mutable conversion table", () => {
    // `alternates` was a `Map` typed `ReadonlyMap`, so this cast rewrote one
    // tenant's pack factor for every holder of the profile.
    expect(Object.isFrozen(boltsProfile.alternates)).toBe(true);
    expect(() => {
      (
        boltsProfile.alternates as unknown as {
          push: (value: unknown) => void;
        }
      ).push({
        uom: "DOZEN",
        toBase: ratio(12, 1),
      });
    }).toThrow(TypeError);
    expect(() => {
      (boltsProfile.alternates[0] as { toBase: unknown }).toBase = ratio(1, 1);
    }).toThrow(TypeError);
    expect(alternateUoms(boltsProfile)).toEqual(["CASE", "PALLET"]);
    expect(expectOk(conversionToBase(boltsProfile, "CASE"))).toEqual({
      numerator: 12,
      denominator: 1,
    });
  });

  it("rejects an item key that is not a bounded, whitespace-free code", () => {
    const rejected = [
      "ITEM 1",
      "ITEM\u00001",
      "ITEM\u200d1",
      "\u0009",
      "x".repeat(MAX_ITEM_KEY_LENGTH + 1),
    ];
    for (const itemKey of rejected) {
      expect(
        expectError(makeItemUomProfile({ itemKey, baseUom: "PCS" })).code,
      ).toBe("INVALID_ITEM_KEY");
    }
    expect(
      expectError(
        makeItemUomProfile({
          itemKey: 12 as unknown as string,
          baseUom: "PCS",
        }),
      ),
    ).toEqual({ code: "INVALID_ITEM_KEY", raw: "number", error: null });
  });

  it("preserves item-key case, because a key may be a document id", () => {
    const profile = expectOk(
      makeItemUomProfile({ itemKey: "kg1234abcd", baseUom: "PCS" }),
    );
    expect(profile.itemKey).toBe("kg1234abcd");
  });

  it("refuses to convert with a forged profile", () => {
    const bad = {
      itemKey: "ITEM-1",
      baseUom: "PCS",
      alternates: [{ uom: "CASE", toBase: { numerator: 1, denominator: 0 } }],
    } as unknown as ItemUomProfile;
    expect(convertToBase(bad, "CASE", 1000)).toEqual({
      kind: "REJECTED",
      error: {
        code: "RATIO_INVALID",
        error: { code: "NOT_POSITIVE", numerator: 1, denominator: 0 },
      },
    });
    expect(expectError(validateItemUomProfile(bad)).code).toBe("RATIO_INVALID");
    expect(
      expectError(validateItemUomProfile(null as unknown as ItemUomProfile)),
    ).toEqual({ code: "NOT_A_PROFILE", received: "null" });
    expect(alternateUoms(null as unknown as ItemUomProfile)).toEqual([]);
  });

  it("refuses to add item quantities that were never validated", () => {
    const forgedItemQuantity = {
      itemKey: "ITEM-RESIN",
      quantity: { uom: "KG", minorUnits: Number.NaN },
    } as unknown as Parameters<typeof addItemQuantities>[0];
    const good = expectOk(
      makeItemQuantity(resinProfile, expectOk(makeQuantity(1000, "KG"))),
    );
    expect(expectError(addItemQuantities(good, forgedItemQuantity)).code).toBe(
      "QUANTITY_INVALID",
    );
  });

  it("rejects a conversion whose UOM code is not a string", () => {
    expect(convertToBase(boltsProfile, 12 as unknown as string, 1000)).toEqual({
      kind: "REJECTED",
      error: { code: "INVALID_UOM_CODE", raw: "number" },
    });
  });
});
