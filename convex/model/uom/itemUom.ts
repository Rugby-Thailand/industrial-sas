/**
 * Item UOM profile: one base UOM per item plus exact alternate conversions
 * (`G-029`, `G-030`, `ADR-0004`, `INV-0004-02`, `INV-0004-03`, `INV-0004-04`).
 *
 * Status: **implemented** as pure logic. The `itemUoms` master-data table in plan
 * §7.2 does not exist, so nothing loads a profile from anywhere yet; a caller
 * builds one from values it already holds.
 *
 * A conversion belongs to an item, not to a pair of UOM codes. `1 CASE = 12 PCS`
 * for one item and `1 CASE = 6 PCS` for another; a global table would receive
 * both and be wrong for one of them. So every conversion here goes through the
 * profile of exactly one item, and a UOM the item does not declare is rejected
 * rather than resolved from somewhere else. Because the profile carries its
 * `itemKey`, converting item A's stock with item B's factors is a named error
 * (`ITEM_MISMATCH`) instead of a plausible number.
 *
 * The two outcomes that matter are `EXACT` and `INEXACT`. `INEXACT` is not an
 * error: it is the true value, as a fraction, for a caller that must explain why
 * `1 CASE` of a 1/3 KG item cannot be received. What no caller gets is a rounded
 * quantity (`INV-0004-05`), because a rounded receipt creates or destroys stock
 * that later shows up as unexplainable drift.
 *
 * Pure module (plan §6.2): no Convex imports.
 */
import { fail, ok, type Result } from "../result";
import {
  invertRatio,
  composeRatios,
  scaleInteger,
  UNIT_RATIO,
  type ExactFraction,
  type Ratio,
  type RatioError,
} from "./ratio";
import {
  makeQuantity,
  normalizeUomCode,
  type Quantity,
  type QuantityError,
  type UomCode,
} from "./quantity";

/** Longest item key accepted. A key is a normalized SKU or a document id. */
export const MAX_ITEM_KEY_LENGTH = 64;

/** A declared packaging unit and its exact factor to the item's base UOM. */
export interface UomConversion {
  readonly uom: UomCode;
  /** Base units per one `uom`: `1 uom = numerator/denominator base units`. */
  readonly toBase: Ratio;
}

/** One item's UOM vocabulary. Immutable; `makeItemUomProfile` is the only source. */
export interface ItemUomProfile {
  readonly itemKey: string;
  readonly baseUom: UomCode;
  readonly alternates: ReadonlyMap<UomCode, Ratio>;
}

/** A quantity that knows which item it counts. Prevents cross-item arithmetic. */
export interface ItemQuantity {
  readonly itemKey: string;
  readonly quantity: Quantity;
}

export type ItemUomError =
  | { readonly code: "INVALID_ITEM_KEY"; readonly raw: string }
  | { readonly code: "INVALID_UOM_CODE"; readonly raw: string }
  | { readonly code: "DUPLICATE_UOM"; readonly uom: UomCode }
  | { readonly code: "BASE_UOM_AS_ALTERNATE"; readonly uom: UomCode }
  | {
      readonly code: "UNKNOWN_UOM";
      readonly itemKey: string;
      readonly uom: UomCode;
    }
  | {
      readonly code: "BASE_UOM_MISMATCH";
      readonly expected: UomCode;
      readonly actual: UomCode;
    }
  | {
      readonly code: "ITEM_MISMATCH";
      readonly expected: string;
      readonly actual: string;
    }
  | { readonly code: "RATIO_INVALID"; readonly error: RatioError }
  | { readonly code: "QUANTITY_INVALID"; readonly error: QuantityError }
  | {
      readonly code: "CONVERSION_OVERFLOW";
      readonly itemKey: string;
      readonly fromUom: UomCode;
      readonly toUom: UomCode;
    };

/**
 * The result of a conversion. Three cases, all caller-visible:
 *
 * - `EXACT` — a whole number of minor units; the only case a posting may use.
 * - `INEXACT` — the exact value is `exact.numerator / exact.denominator` minor
 *   units of `uom`. Nothing rounds it; the caller decides what to tell the
 *   operator, and the ledger's answer is "reject".
 * - `REJECTED` — the conversion could not be attempted at all: unknown UOM,
 *   wrong item, invalid input, or an overflow.
 */
export type UomConversionOutcome =
  | { readonly kind: "EXACT"; readonly quantity: Quantity }
  | {
      readonly kind: "INEXACT";
      readonly uom: UomCode;
      readonly exact: ExactFraction;
    }
  | { readonly kind: "REJECTED"; readonly error: ItemUomError };

/* -------------------------------------------------------------------------- */
/* Construction                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Builds a profile. Rejects a duplicate alternate and an alternate that repeats
 * the base UOM: the base factor is `1/1` by definition, and a declaration that
 * could disagree with it is a trap.
 */
export function makeItemUomProfile(input: {
  readonly itemKey: string;
  readonly baseUom: UomCode;
  readonly alternates?: readonly UomConversion[];
}): Result<ItemUomProfile, ItemUomError> {
  const itemKey = input.itemKey.trim();
  if (itemKey.length === 0 || itemKey.length > MAX_ITEM_KEY_LENGTH) {
    return fail({ code: "INVALID_ITEM_KEY", raw: input.itemKey });
  }
  const baseUom = normalizeUomCode(input.baseUom);
  if (!baseUom.ok) {
    return fail({ code: "INVALID_UOM_CODE", raw: input.baseUom });
  }

  const alternates = new Map<UomCode, Ratio>();
  for (const conversion of input.alternates ?? []) {
    const code = normalizeUomCode(conversion.uom);
    if (!code.ok)
      return fail({ code: "INVALID_UOM_CODE", raw: conversion.uom });
    if (code.value === baseUom.value) {
      return fail({ code: "BASE_UOM_AS_ALTERNATE", uom: code.value });
    }
    if (alternates.has(code.value)) {
      return fail({ code: "DUPLICATE_UOM", uom: code.value });
    }
    const ratio = revalidateRatio(conversion.toBase);
    if (!ratio.ok) return ratio;
    alternates.set(code.value, ratio.value);
  }

  return ok(
    Object.freeze({
      itemKey,
      baseUom: baseUom.value,
      alternates,
    }),
  );
}

/** The factor from `uom` to the base UOM, or a named reason there is none. */
export function conversionToBase(
  profile: ItemUomProfile,
  uom: UomCode,
): Result<Ratio, ItemUomError> {
  const code = normalizeUomCode(uom);
  if (!code.ok) return fail({ code: "INVALID_UOM_CODE", raw: uom });
  if (code.value === profile.baseUom) return ok(UNIT_RATIO);
  const ratio = profile.alternates.get(code.value);
  return ratio === undefined
    ? fail({ code: "UNKNOWN_UOM", itemKey: profile.itemKey, uom: code.value })
    : ok(ratio);
}

/* -------------------------------------------------------------------------- */
/* Conversion                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Converts a captured amount, in minor units of `fromUom`, into the item's base
 * UOM. The amount is in thousandths of the *captured* unit, so `1.5 CASE` is
 * `1500` — an operator may type a fractional case, and a fractional case that
 * does not land on a whole base minor unit is exactly the case B-12 rejects.
 */
export function convertToBase(
  profile: ItemUomProfile,
  fromUom: UomCode,
  minorUnits: number,
): UomConversionOutcome {
  const ratio = conversionToBase(profile, fromUom);
  if (!ratio.ok) return { kind: "REJECTED", error: ratio.error };
  return applyConversion(profile, minorUnits, ratio.value, {
    fromUom,
    toUom: profile.baseUom,
    resultUom: profile.baseUom,
  });
}

/**
 * Converts a base-UOM quantity into an alternate UOM, for display and for
 * printing a pack count on a label. Requires the quantity to be in the item's
 * base UOM: a quantity in some other UOM is not this item's stock.
 */
export function convertFromBase(
  profile: ItemUomProfile,
  toUom: UomCode,
  quantity: Quantity,
): UomConversionOutcome {
  if (quantity.uom !== profile.baseUom) {
    return {
      kind: "REJECTED",
      error: {
        code: "BASE_UOM_MISMATCH",
        expected: profile.baseUom,
        actual: quantity.uom,
      },
    };
  }
  const toBase = conversionToBase(profile, toUom);
  if (!toBase.ok) return { kind: "REJECTED", error: toBase.error };
  const inverted = invertRatio(toBase.value);
  if (!inverted.ok) {
    return {
      kind: "REJECTED",
      error: { code: "RATIO_INVALID", error: inverted.error },
    };
  }
  const code = normalizeUomCode(toUom);
  if (!code.ok)
    return {
      kind: "REJECTED",
      error: { code: "INVALID_UOM_CODE", raw: toUom },
    };
  return applyConversion(profile, quantity.minorUnits, inverted.value, {
    fromUom: profile.baseUom,
    toUom: code.value,
    resultUom: code.value,
  });
}

/**
 * Converts between two alternate UOMs of the same item by composing the two
 * factors exactly — never by converting to base and back, which would reject a
 * pair that is exact end to end (6 half-cases is 3 cases even when a half-case
 * is not a whole base unit).
 */
export function convertBetween(
  profile: ItemUomProfile,
  fromUom: UomCode,
  toUom: UomCode,
  minorUnits: number,
): UomConversionOutcome {
  const from = conversionToBase(profile, fromUom);
  if (!from.ok) return { kind: "REJECTED", error: from.error };
  const to = conversionToBase(profile, toUom);
  if (!to.ok) return { kind: "REJECTED", error: to.error };
  const inverted = invertRatio(to.value);
  if (!inverted.ok) {
    return {
      kind: "REJECTED",
      error: { code: "RATIO_INVALID", error: inverted.error },
    };
  }
  const composed = composeRatios(from.value, inverted.value);
  if (!composed.ok) {
    return {
      kind: "REJECTED",
      error: { code: "RATIO_INVALID", error: composed.error },
    };
  }
  const code = normalizeUomCode(toUom);
  if (!code.ok)
    return {
      kind: "REJECTED",
      error: { code: "INVALID_UOM_CODE", raw: toUom },
    };
  return applyConversion(profile, minorUnits, composed.value, {
    fromUom,
    toUom: code.value,
    resultUom: code.value,
  });
}

/* -------------------------------------------------------------------------- */
/* Item-scoped quantities                                                      */
/* -------------------------------------------------------------------------- */

/** Binds a base-UOM quantity to its item. Rejects any other UOM. */
export function makeItemQuantity(
  profile: ItemUomProfile,
  quantity: Quantity,
): Result<ItemQuantity, ItemUomError> {
  if (quantity.uom !== profile.baseUom) {
    return fail({
      code: "BASE_UOM_MISMATCH",
      expected: profile.baseUom,
      actual: quantity.uom,
    });
  }
  const revalidated = makeQuantity(quantity.minorUnits, quantity.uom);
  if (!revalidated.ok) {
    return fail({ code: "QUANTITY_INVALID", error: revalidated.error });
  }
  return ok(
    Object.freeze({ itemKey: profile.itemKey, quantity: revalidated.value }),
  );
}

/**
 * Adds two item quantities. Fails on a different item even when the UOM codes
 * match, which is the case a UOM check alone cannot see: two items measured in
 * `KG` are still two items.
 */
export function addItemQuantities(
  left: ItemQuantity,
  right: ItemQuantity,
): Result<ItemQuantity, ItemUomError> {
  if (left.itemKey !== right.itemKey) {
    return fail({
      code: "ITEM_MISMATCH",
      expected: left.itemKey,
      actual: right.itemKey,
    });
  }
  if (left.quantity.uom !== right.quantity.uom) {
    return fail({
      code: "BASE_UOM_MISMATCH",
      expected: left.quantity.uom,
      actual: right.quantity.uom,
    });
  }
  const sum = makeQuantity(
    left.quantity.minorUnits + right.quantity.minorUnits,
    left.quantity.uom,
  );
  if (!sum.ok) return fail({ code: "QUANTITY_INVALID", error: sum.error });
  return ok(Object.freeze({ itemKey: left.itemKey, quantity: sum.value }));
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

function applyConversion(
  profile: ItemUomProfile,
  minorUnits: number,
  ratio: Ratio,
  context: {
    readonly fromUom: UomCode;
    readonly toUom: UomCode;
    readonly resultUom: UomCode;
  },
): UomConversionOutcome {
  const input = makeQuantity(minorUnits, context.fromUom);
  if (!input.ok) {
    return {
      kind: "REJECTED",
      error: { code: "QUANTITY_INVALID", error: input.error },
    };
  }
  const scaled = scaleInteger(input.value.minorUnits, ratio);
  if (scaled.kind === "OVERFLOW") {
    return {
      kind: "REJECTED",
      error: {
        code: "CONVERSION_OVERFLOW",
        itemKey: profile.itemKey,
        fromUom: context.fromUom,
        toUom: context.toUom,
      },
    };
  }
  if (scaled.kind === "INEXACT") {
    return { kind: "INEXACT", uom: context.resultUom, exact: scaled.exact };
  }
  const converted = makeQuantity(scaled.value, context.resultUom);
  if (!converted.ok) {
    return {
      kind: "REJECTED",
      error: { code: "QUANTITY_INVALID", error: converted.error },
    };
  }
  return { kind: "EXACT", quantity: converted.value };
}

function revalidateRatio(ratio: Ratio): Result<Ratio, ItemUomError> {
  const composed = composeRatios(ratio, UNIT_RATIO);
  return composed.ok
    ? ok(composed.value)
    : fail({ code: "RATIO_INVALID", error: composed.error });
}
