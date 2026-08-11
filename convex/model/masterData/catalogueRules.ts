/**
 * The domain rules the new master-data entities own, as pure algebra.
 *
 * This module is the bridge between *stored rows* and the two kernels that
 * already decide the hard parts:
 *
 * - `convex/model/uom/itemUom.ts` decides what a conversion table is — exact
 *   rationals, no duplicate unit, no base UOM masquerading as an alternate.
 * - `convex/model/identifiers/scanResolution.ts` decides what a scanned string
 *   *is* before anything decides what it points at.
 *
 * Neither is reimplemented here and neither is wrapped in a way that could
 * disagree with it. What this module adds is the translation: a row has two
 * integers where the kernel wants a `Ratio`, and a row has a `kind` column where
 * the kernel produces an interpretation. Getting that translation wrong is how a
 * conversion table that the kernel would reject gets stored anyway.
 *
 * No Convex import (plan §6.2, enforced by `pnpm verify:tenant-boundary`).
 */
import { normalizeGtin, normalizeRawScan } from "../identifiers/normalization";
import { fail, ok, type Result } from "../result";
import { makeRatio, type Ratio } from "../uom/ratio";
import {
  makeItemUomProfile,
  type ItemUomProfile,
  type UomConversion,
} from "../uom/itemUom";
import { normalizeUomCode } from "../uom/quantity";

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

export type CatalogueRuleError =
  | { readonly code: "UOM_CODE_INVALID"; readonly field: string }
  | { readonly code: "CONVERSION_NOT_EXACT"; readonly field: string }
  | { readonly code: "CONVERSION_NOT_POSITIVE"; readonly field: string }
  | { readonly code: "BASE_UOM_AS_ALTERNATE"; readonly field: string }
  | { readonly code: "PROFILE_INVALID"; readonly reason: string }
  | { readonly code: "BARCODE_UNREADABLE"; readonly field: string }
  | { readonly code: "BARCODE_KIND_MISMATCH"; readonly field: string }
  | { readonly code: "LABEL_BODY_INVALID"; readonly field: string };

/* -------------------------------------------------------------------------- */
/* Alternate UOM conversions                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A conversion as a row stores it: two integers rather than a `Ratio`.
 *
 * Two integers, because `Ratio` is an interface and a Convex document is
 * whatever was written into it. Reconstituting through `makeRatio` on the way
 * out is what keeps a stored `{numerator: 1, denominator: 0}` from reaching
 * Euclid's algorithm.
 */
export interface StoredConversion {
  readonly uom: string;
  readonly toBaseNumerator: number;
  readonly toBaseDenominator: number;
}

/**
 * Validate one alternate-UOM declaration against the item's base unit.
 *
 * Every refusal names a **field**, never the value: this runs on a create, and
 * the caller already holds what it sent.
 *
 * The base-UOM check is here rather than left to `makeItemUomProfile` because
 * this function validates *one* row in isolation — at create time there is no
 * profile yet, and discovering the clash only when the whole table is rebuilt
 * would mean storing a row that can never be read back.
 */
export function validateAlternateConversion(input: {
  readonly uom: string;
  readonly baseUom: string;
  readonly toBaseNumerator: number;
  readonly toBaseDenominator: number;
}): Result<StoredConversion, CatalogueRuleError> {
  const uom = normalizeUomCode(input.uom);
  if (!uom.ok) return fail({ code: "UOM_CODE_INVALID", field: "uom" });

  const baseUom = normalizeUomCode(input.baseUom);
  if (!baseUom.ok) return fail({ code: "UOM_CODE_INVALID", field: "baseUom" });

  if (uom.value === baseUom.value) {
    return fail({ code: "BASE_UOM_AS_ALTERNATE", field: "uom" });
  }

  /*
   * A non-positive factor is refused before `makeRatio` sees it. `makeRatio`
   * normalizes sign, so `-12/-1` would reduce to `12/1` and be accepted — but a
   * caller that sent a negative numerator meant something, and silently
   * agreeing with the wrong reading is worse than refusing.
   */
  if (
    !Number.isSafeInteger(input.toBaseNumerator) ||
    input.toBaseNumerator <= 0
  ) {
    return fail({ code: "CONVERSION_NOT_POSITIVE", field: "toBaseNumerator" });
  }
  if (
    !Number.isSafeInteger(input.toBaseDenominator) ||
    input.toBaseDenominator <= 0
  ) {
    return fail({
      code: "CONVERSION_NOT_POSITIVE",
      field: "toBaseDenominator",
    });
  }

  const ratio = makeRatio(input.toBaseNumerator, input.toBaseDenominator);
  if (!ratio.ok) return fail({ code: "CONVERSION_NOT_EXACT", field: "toBase" });

  /*
   * Stored **reduced**, from `makeRatio`'s own normalization. Two rows saying
   * `12/1` and `24/2` are the same factor, and storing both forms would make an
   * equality check on the conversion table a comparison of spellings.
   */
  return ok(
    Object.freeze({
      uom: uom.value,
      toBaseNumerator: ratio.value.numerator,
      toBaseDenominator: ratio.value.denominator,
    }),
  );
}

/**
 * Rebuild an item's conversion profile from its stored rows.
 *
 * Delegates to `makeItemUomProfile`, which is the only thing that decides
 * whether a set of conversions is a profile: it re-validates every ratio,
 * refuses a duplicate unit, and refuses the base UOM as an alternate. A caller
 * that wants to convert a quantity uses the profile this returns and the
 * kernel's own `convertToBase` — there is no conversion arithmetic in this file.
 */
export function profileFromRows(input: {
  readonly itemKey: string;
  readonly baseUom: string;
  readonly rows: readonly StoredConversion[];
}): Result<ItemUomProfile, CatalogueRuleError> {
  const alternates: UomConversion[] = [];

  for (const row of input.rows) {
    const ratio = makeRatio(row.toBaseNumerator, row.toBaseDenominator);
    if (!ratio.ok) {
      return fail({ code: "CONVERSION_NOT_EXACT", field: row.uom });
    }
    alternates.push({ uom: row.uom, toBase: ratio.value as Ratio });
  }

  const profile = makeItemUomProfile({
    itemKey: input.itemKey,
    baseUom: input.baseUom,
    alternates,
  });
  if (!profile.ok) {
    return fail({ code: "PROFILE_INVALID", reason: profile.error.code });
  }
  return ok(profile.value);
}

/* -------------------------------------------------------------------------- */
/* Barcodes                                                                    */
/* -------------------------------------------------------------------------- */

export type StoredBarcodeKind = "GTIN" | "SSCC" | "INTERNAL" | "SUPPLIER";

export interface StoredBarcode {
  readonly barcode: string;
  readonly kind: StoredBarcodeKind;
}

/**
 * Normalize and check one barcode alias against the kind it claims to be.
 *
 * The interesting rule is the `GTIN` branch. `normalizeGtin` is the same kernel
 * the scan resolver uses: it pads to 14 digits and verifies the check digit. A
 * row that claimed `GTIN` for a value whose check digit fails is a row the
 * resolver would never produce, so accepting it would mean the catalogue holds
 * an alias no scan can ever match — a silent dead entry an operator would blame
 * the scanner for.
 *
 * `SSCC`, `INTERNAL`, and `SUPPLIER` are normalized as raw scans and not
 * otherwise judged: an SSCC's own check digit is verified by the resolver when
 * it classifies one, an internal LPN's check character is the LPN kernel's
 * business, and a supplier's code is whatever the supplier printed. Re-deriving
 * those rules here is exactly the duplication this module exists to avoid.
 */
export function validateBarcodeAlias(input: {
  readonly barcode: string;
  readonly kind: StoredBarcodeKind;
}): Result<StoredBarcode, CatalogueRuleError> {
  const normalized = normalizeRawScan(input.barcode);
  if (!normalized.ok) {
    return fail({ code: "BARCODE_UNREADABLE", field: "barcode" });
  }

  /*
   * `normalizeRawScan` strips the wedge's terminator and nothing else, on
   * purpose: a *scan* is persisted as it arrived (`INV-0005-12`). A stored
   * catalogue **alias** is a different thing — one made only of spaces is
   * unusable, unscannable, and would still occupy the unique key that is
   * supposed to guarantee a scan resolves to one item. So a whitespace-only
   * alias is refused here rather than in the scan kernel, which is right to
   * allow it.
   */
  if (normalized.value.trim().length === 0) {
    return fail({ code: "BARCODE_UNREADABLE", field: "barcode" });
  }

  if (input.kind === "GTIN") {
    const gtin = normalizeGtin(normalized.value);
    if (!gtin.ok) {
      return fail({ code: "BARCODE_KIND_MISMATCH", field: "barcode" });
    }
    return ok(Object.freeze({ barcode: gtin.value, kind: "GTIN" as const }));
  }

  return ok(Object.freeze({ barcode: normalized.value, kind: input.kind }));
}

/* -------------------------------------------------------------------------- */
/* Label templates                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The longest template body this repository will store.
 *
 * A ZPL label is a few hundred bytes; a PDF template source is larger but still
 * a document, not a file. The bound exists because the body is unparsed text
 * from a form, and an unbounded text column is an unbounded write.
 */
export const MAX_LABEL_BODY_LENGTH = 16_384;

/**
 * Check a label template body.
 *
 * Deliberately shallow: non-empty, bounded, and no control characters other than
 * the newlines and tabs a ZPL payload legitimately contains.
 *
 * It does **not** parse ZPL, validate a PDF, render anything, or check that a
 * printer would accept it. This repository has no printer transport (`INT-04`)
 * and no physical print evidence (`RG-004`); a validator that implied otherwise
 * would be the most misleading thing in the module. What is stored is text a
 * human authored, versioned so a printed label can cite which one produced it.
 */
export function validateLabelBody(
  body: string,
): Result<string, CatalogueRuleError> {
  if (typeof body !== "string") {
    return fail({ code: "LABEL_BODY_INVALID", field: "body" });
  }
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    return fail({ code: "LABEL_BODY_INVALID", field: "body" });
  }
  if (trimmed.length > MAX_LABEL_BODY_LENGTH) {
    return fail({ code: "LABEL_BODY_INVALID", field: "body" });
  }
  // Control characters other than tab, newline, and carriage return.
  if (/[ --]/.test(trimmed)) {
    return fail({ code: "LABEL_BODY_INVALID", field: "body" });
  }
  return ok(trimmed);
}

/**
 * The next version number for a template code.
 *
 * Monotonic and gap-free from the highest existing version, so a version number
 * is a count of published revisions rather than an opaque handle. `1` when the
 * code is new.
 */
export function nextTemplateVersion(
  existing: readonly number[],
): Result<number, CatalogueRuleError> {
  let highest = 0;
  for (const version of existing) {
    if (!Number.isSafeInteger(version) || version < 1) {
      return fail({ code: "LABEL_BODY_INVALID", field: "version" });
    }
    if (version > highest) highest = version;
  }
  return ok(highest + 1);
}
