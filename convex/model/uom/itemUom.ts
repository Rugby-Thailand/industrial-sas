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

export const MAX_ITEM_KEY_LENGTH = MAX_CODE_LENGTH;

export interface UomConversion {
  readonly uom: UomCode;

  readonly toBase: Ratio;
}

export interface ItemUomProfile {
  readonly itemKey: string;
  readonly baseUom: UomCode;
  readonly alternates: readonly UomConversion[];
}

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

export type UomConversionOutcome =
  | { readonly kind: "EXACT"; readonly quantity: Quantity }
  | {
      readonly kind: "INEXACT";
      readonly uom: UomCode;
      readonly exact: ExactFraction;
    }
  | { readonly kind: "REJECTED"; readonly error: ItemUomError };

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

export function alternateUoms(
  profile: ItemUomProfile,
): Result<readonly UomCode[], ItemUomError> {
  const validated = validateItemUomProfile(profile);
  if (!validated.ok) return validated;
  return ok(
    frozenArray(validated.value.alternates.map((conversion) => conversion.uom)),
  );
}

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

const rawText = (value: unknown): string =>
  isString(value) ? value : describe(value);

const describe = (value: unknown): string =>
  value === null ? "null" : typeof value;
