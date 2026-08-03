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
 * Every entry point re-validates the profile it is handed
 * (`validateItemUomProfile`), because a profile is an interface: a cast, a
 * document read back, or a `JSON.parse` can produce one whose factor is `1/0` or
 * whose item key carries a zero-width joiner. A profile's `alternates` is a
 * frozen array rather than a `ReadonlyMap` for the same reason — a `ReadonlyMap`
 * is an ordinary `Map` at run time, so anything holding a profile could have
 * rewritten the item's conversion table.
 *
 * Pure module (plan §6.2): no Convex imports.
 */
import { frozenArray, isArray, isRecord, isString } from "../guards";
import { fail, ok, type Result } from "../result";
import {
  normalizeCode,
  MAX_CODE_LENGTH,
  type IdentifierError,
} from "../identifiers/normalization";
import {
  invertRatio,
  composeRatios,
  scaleInteger,
  validateRatio,
  UNIT_RATIO,
  type ExactFraction,
  type Ratio,
  type RatioError,
} from "./ratio";
import {
  makeQuantity,
  normalizeUomCode,
  validateQuantity,
  type Quantity,
  type QuantityError,
  type UomCode,
} from "./quantity";

/**
 * Longest item key accepted. A key is a normalized SKU or a document id, so the
 * bound is the SKU bound (`identifiers/normalization.ts`); the two must not
 * disagree, or a SKU that normalizes cleanly could still be refused here.
 */
export const MAX_ITEM_KEY_LENGTH = MAX_CODE_LENGTH;

/** A declared packaging unit and its exact factor to the item's base UOM. */
export interface UomConversion {
  readonly uom: UomCode;
  /** Base units per one `uom`: `1 uom = numerator/denominator base units`. */
  readonly toBase: Ratio;
}

/**
 * One item's UOM vocabulary. Immutable in fact: `makeItemUomProfile` is the only
 * source, and it hands back a frozen profile whose `alternates` is a frozen array
 * of frozen entries.
 *
 * `alternates` is an array rather than a map because a `ReadonlyMap` is an
 * ordinary `Map` at run time — `(profile.alternates as Map<string, Ratio>).set(…)`
 * would have compiled and rewritten one tenant's conversion table from anywhere
 * holding a profile. Look a factor up with `conversionToBase`, which validates the
 * code first.
 */
export interface ItemUomProfile {
  readonly itemKey: string;
  readonly baseUom: UomCode;
  readonly alternates: readonly UomConversion[];
}

/** A quantity that knows which item it counts. Prevents cross-item arithmetic. */
export interface ItemQuantity {
  readonly itemKey: string;
  readonly quantity: Quantity;
}

export type ItemUomError =
  | { readonly code: "NOT_A_PROFILE"; readonly received: string }
  | {
      readonly code: "INVALID_ITEM_KEY";
      readonly raw: string;
      readonly error: IdentifierError | null;
    }
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
 *
 * The item key goes through the same normalizer a SKU does, so a key carrying a
 * zero-width joiner, an internal space, a control character, or a decomposed Thai
 * sequence is rejected rather than stored as a second key for the same item.
 * Case is preserved, because a key may be a Convex document id.
 */
export function makeItemUomProfile(input: {
  readonly itemKey: string;
  readonly baseUom: UomCode;
  readonly alternates?: readonly UomConversion[];
}): Result<ItemUomProfile, ItemUomError> {
  if (!isRecord(input)) {
    return fail({ code: "NOT_A_PROFILE", received: describe(input) });
  }
  const itemKey = validateItemKey(input.itemKey);
  if (!itemKey.ok) return itemKey;
  const baseUom = normalizeUomCode(input.baseUom);
  if (!baseUom.ok) {
    return fail({ code: "INVALID_UOM_CODE", raw: rawText(input.baseUom) });
  }

  const declared = input.alternates ?? [];
  if (!isArray(declared)) {
    return fail({ code: "NOT_A_PROFILE", received: describe(declared) });
  }
  const alternates: UomConversion[] = [];
  const seen = new Set<UomCode>();
  for (const conversion of declared) {
    if (!isRecord(conversion)) {
      return fail({ code: "NOT_A_PROFILE", received: describe(conversion) });
    }
    const code = normalizeUomCode(conversion.uom);
    if (!code.ok) {
      return fail({ code: "INVALID_UOM_CODE", raw: rawText(conversion.uom) });
    }
    if (code.value === baseUom.value) {
      return fail({ code: "BASE_UOM_AS_ALTERNATE", uom: code.value });
    }
    if (seen.has(code.value)) {
      return fail({ code: "DUPLICATE_UOM", uom: code.value });
    }
    const ratio = validateRatio(conversion.toBase);
    if (!ratio.ok) return fail({ code: "RATIO_INVALID", error: ratio.error });
    seen.add(code.value);
    alternates.push(Object.freeze({ uom: code.value, toBase: ratio.value }));
  }

  return ok(
    Object.freeze({
      itemKey: itemKey.value,
      baseUom: baseUom.value,
      alternates: frozenArray(alternates),
    }),
  );
}

/**
 * Re-checks a value that claims to be a profile. Every function below goes
 * through it, so a cast-built profile with a forged factor or a mutable
 * `alternates` array cannot drive a conversion.
 */
export function validateItemUomProfile(
  profile: ItemUomProfile,
): Result<ItemUomProfile, ItemUomError> {
  if (!isRecord(profile)) {
    return fail({ code: "NOT_A_PROFILE", received: describe(profile) });
  }
  return makeItemUomProfile({
    itemKey: profile.itemKey,
    baseUom: profile.baseUom,
    alternates: profile.alternates,
  });
}

/** The declared alternate UOM codes, in declaration order. */
export const alternateUoms = (profile: ItemUomProfile): readonly UomCode[] =>
  isRecord(profile) && isArray(profile.alternates)
    ? frozenArray(
        profile.alternates
          .filter((conversion): conversion is UomConversion =>
            isRecord(conversion),
          )
          .map((conversion) => conversion.uom),
      )
    : frozenArray([]);

/** The factor from `uom` to the base UOM, or a named reason there is none. */
export function conversionToBase(
  profile: ItemUomProfile,
  uom: UomCode,
): Result<Ratio, ItemUomError> {
  const validated = validateItemUomProfile(profile);
  if (!validated.ok) return validated;
  const code = normalizeUomCode(uom);
  if (!code.ok) return fail({ code: "INVALID_UOM_CODE", raw: rawText(uom) });
  if (code.value === validated.value.baseUom) return ok(UNIT_RATIO);
  const found = validated.value.alternates.find(
    (conversion) => conversion.uom === code.value,
  );
  return found === undefined
    ? fail({
        code: "UNKNOWN_UOM",
        itemKey: validated.value.itemKey,
        uom: code.value,
      })
    : ok(found.toBase);
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
  const validated = validateItemUomProfile(profile);
  if (!validated.ok) return { kind: "REJECTED", error: validated.error };
  const ratio = conversionToBase(validated.value, fromUom);
  if (!ratio.ok) return { kind: "REJECTED", error: ratio.error };
  const code = normalizeUomCode(fromUom);
  if (!code.ok) {
    return {
      kind: "REJECTED",
      error: { code: "INVALID_UOM_CODE", raw: rawText(fromUom) },
    };
  }
  return applyConversion(validated.value, minorUnits, ratio.value, {
    fromUom: code.value,
    toUom: validated.value.baseUom,
    resultUom: validated.value.baseUom,
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
  const validated = validateItemUomProfile(profile);
  if (!validated.ok) return { kind: "REJECTED", error: validated.error };
  const input = validateQuantity(quantity);
  if (!input.ok) {
    return {
      kind: "REJECTED",
      error: { code: "QUANTITY_INVALID", error: input.error },
    };
  }
  if (input.value.uom !== validated.value.baseUom) {
    return {
      kind: "REJECTED",
      error: {
        code: "BASE_UOM_MISMATCH",
        expected: validated.value.baseUom,
        actual: input.value.uom,
      },
    };
  }
  const toBase = conversionToBase(validated.value, toUom);
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
      error: { code: "INVALID_UOM_CODE", raw: rawText(toUom) },
    };
  return applyConversion(
    validated.value,
    input.value.minorUnits,
    inverted.value,
    {
      fromUom: validated.value.baseUom,
      toUom: code.value,
      resultUom: code.value,
    },
  );
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
  const validated = validateItemUomProfile(profile);
  if (!validated.ok) return { kind: "REJECTED", error: validated.error };
  const from = conversionToBase(validated.value, fromUom);
  if (!from.ok) return { kind: "REJECTED", error: from.error };
  const to = conversionToBase(validated.value, toUom);
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
  const fromCode = normalizeUomCode(fromUom);
  const code = normalizeUomCode(toUom);
  if (!fromCode.ok || !code.ok)
    return {
      kind: "REJECTED",
      error: {
        code: "INVALID_UOM_CODE",
        raw: rawText(fromCode.ok ? toUom : fromUom),
      },
    };
  return applyConversion(validated.value, minorUnits, composed.value, {
    fromUom: fromCode.value,
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
  const validated = validateItemUomProfile(profile);
  if (!validated.ok) return validated;
  const revalidated = validateQuantity(quantity);
  if (!revalidated.ok) {
    return fail({ code: "QUANTITY_INVALID", error: revalidated.error });
  }
  if (revalidated.value.uom !== validated.value.baseUom) {
    return fail({
      code: "BASE_UOM_MISMATCH",
      expected: validated.value.baseUom,
      actual: revalidated.value.uom,
    });
  }
  return ok(
    Object.freeze({
      itemKey: validated.value.itemKey,
      quantity: revalidated.value,
    }),
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
  const first = validateItemQuantity(left);
  if (!first.ok) return first;
  const second = validateItemQuantity(right);
  if (!second.ok) return second;
  if (first.value.itemKey !== second.value.itemKey) {
    return fail({
      code: "ITEM_MISMATCH",
      expected: first.value.itemKey,
      actual: second.value.itemKey,
    });
  }
  if (first.value.quantity.uom !== second.value.quantity.uom) {
    return fail({
      code: "BASE_UOM_MISMATCH",
      expected: first.value.quantity.uom,
      actual: second.value.quantity.uom,
    });
  }
  const sum = makeQuantity(
    first.value.quantity.minorUnits + second.value.quantity.minorUnits,
    first.value.quantity.uom,
  );
  if (!sum.ok) return fail({ code: "QUANTITY_INVALID", error: sum.error });
  return ok(
    Object.freeze({ itemKey: first.value.itemKey, quantity: sum.value }),
  );
}

/** Re-checks a value that claims to be an item-scoped quantity. */
export function validateItemQuantity(
  itemQuantity: ItemQuantity,
): Result<ItemQuantity, ItemUomError> {
  if (!isRecord(itemQuantity)) {
    return fail({ code: "NOT_A_PROFILE", received: describe(itemQuantity) });
  }
  const itemKey = validateItemKey(itemQuantity.itemKey);
  if (!itemKey.ok) return itemKey;
  const quantity = validateQuantity(itemQuantity.quantity);
  if (!quantity.ok) {
    return fail({ code: "QUANTITY_INVALID", error: quantity.error });
  }
  return ok(
    Object.freeze({ itemKey: itemKey.value, quantity: quantity.value }),
  );
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
  if (!scaled.ok) {
    return {
      kind: "REJECTED",
      error: { code: "RATIO_INVALID", error: scaled.error },
    };
  }
  if (scaled.value.kind === "OVERFLOW") {
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
  if (scaled.value.kind === "INEXACT") {
    return {
      kind: "INEXACT",
      uom: context.resultUom,
      exact: scaled.value.exact,
    };
  }
  const converted = makeQuantity(scaled.value.value, context.resultUom);
  if (!converted.ok) {
    return {
      kind: "REJECTED",
      error: { code: "QUANTITY_INVALID", error: converted.error },
    };
  }
  return { kind: "EXACT", quantity: converted.value };
}

/** The item key rules, in one place: the SKU normalizer with case preserved. */
function validateItemKey(raw: string): Result<string, ItemUomError> {
  if (!isString(raw)) {
    return fail({
      code: "INVALID_ITEM_KEY",
      raw: describe(raw),
      error: null,
    });
  }
  const normalized = normalizeCode(raw, {
    maxLength: MAX_ITEM_KEY_LENGTH,
    caseFolding: "PRESERVE",
  });
  return normalized.ok
    ? ok(normalized.value)
    : fail({
        code: "INVALID_ITEM_KEY",
        raw,
        error: normalized.error,
      });
}

/** A string for an error field, whatever arrived. */
const rawText = (value: unknown): string =>
  isString(value) ? value : describe(value);

/** The shape of a value that is not what the field claims, for the error field. */
const describe = (value: unknown): string =>
  value === null ? "null" : typeof value;
