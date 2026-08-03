/**
 * Scan precedence (`ADR-0005` §13, `INV-0005-11`, `INV-0005-12`, §5 Q29).
 *
 * Status: **implemented** as syntactic classification only. Resolving an
 * interpretation to a document — a GTIN to an item, an LPN to a handling unit — is
 * a tenant-scoped lookup and belongs to the Convex layer, which does not exist
 * yet. This module decides *what a string is*, never *what it refers to*.
 *
 * The plan's ladder is GS1, then internal LPN, then GTIN, then SKU, otherwise
 * explicit rejection. A ladder alone is not enough, because the alphabets overlap:
 * an 18-digit SSCC begins with digits that are also a valid Application
 * Identifier, and a numeric item code can begin with `01`. A first-match ladder
 * would resolve those to whichever rung it happened to reach first, which is the
 * best-effort guessing the ADR rejects. So these rules sit on top of the order:
 *
 * 1. **A scan that can only be GS1 is decided by the GS1 parser alone.** If a
 *    symbology identifier or an FNC1 separator is present, the string is a GS1
 *    element string; if it does not parse, the scan is rejected with the parse
 *    error rather than retried as something else.
 * 2. **A content error in a GS1-shaped scan is fatal; a shape error is not.** A
 *    bad check digit, an impossible date, or a repeated AI means "this is GS1 and
 *    it is wrong" — a mis-scanned pallet label, not an item code. A truncated
 *    field or an unknown AI means "this is probably not GS1", and the remaining
 *    rungs are tried. Without the distinction, a mis-scanned GTIN would silently
 *    become a SKU lookup.
 * 3. **An internal LPN needs a namespace policy to be classified at all.** A
 *    well-formed internal LPN is somebody's pallet. Without the current tenant's
 *    registered prefixes there is no way to say whose, so an absent or empty
 *    `namespaces` is `LPN_NAMESPACE_POLICY_MISSING` rather than an acceptance of
 *    any label that happens to satisfy the check character.
 * 4. **A valid LPN that belongs to another prefix is rejected as foreign.** It is
 *    definitely a licence plate; it is definitely not this organization's. Reading
 *    it as a SKU would be the guess again.
 * 5. **A scan shaped like one of this tenant's LPNs but carrying a bad check
 *    character is `INVALID_LPN_SCAN`.** It matches a registered prefix and the
 *    exact internal length; it is a mis-keyed or damaged pallet label, and the
 *    rungs below must not be offered it — falling through would turn a corrupt
 *    LPN into a SKU lookup.
 * 6. **A bare 18-digit SSCC is never reinterpreted.** With `bareSscc` off it is
 *    `BARE_SSCC_DISABLED`, not a lot code, a GTIN, or a SKU: `10` + 16 digits is
 *    both a valid AI 10 element string and, for some digit strings, a valid SSCC,
 *    and the earlier ladder resolved exactly that case to a lot. With `bareSscc`
 *    on it is a candidate like any other, so a second reading makes it ambiguous.
 * 7. **A bare scan that satisfies two rungs is rejected as ambiguous**, naming the
 *    candidates. The SKU rung is excluded from that count: it is the deliberate
 *    catch-all, so counting it would make every scan ambiguous.
 *
 * The policy itself is validated before any of it (`INVALID_SCAN_POLICY`): a
 * reference year the GS1 date rule cannot use, a namespace that is not a
 * registered one, or a flag that is not a boolean would each decide a
 * classification silently.
 *
 * The raw scan travels with every result and every rejection, because
 * `INV-0005-12` requires it to be persisted next to its interpretation.
 *
 * Pure module (plan §6.2): no Convex imports.
 */
import {
  frozenArray,
  isArray,
  isBoolean,
  isRecord,
  isSafeInt,
} from "../guards";
import { fail, ok, type Result } from "../result";
import { MAX_BUSINESS_YEAR, MIN_BUSINESS_YEAR } from "../time/businessDate";
import {
  GROUP_SEPARATOR,
  looksLikeGs1ElementString,
  parseGs1ElementString,
  type Gs1ParseError,
  type Gs1Scan,
} from "../gs1/elementString";
import {
  looksLikeInternalLpn,
  lpnFromSscc,
  parseInternalLpn,
  validateLpnNamespace,
  LPN_RANDOM_LENGTH,
  LPN_TIME_LENGTH,
  type InternalLpn,
  type LpnError,
  type LpnNamespace,
  type SsccLpn,
} from "./lpn";
import {
  normalizeGtin,
  normalizeRawScan,
  normalizeSku,
  type IdentifierError,
} from "./normalization";

/** The rungs, in the order they are tried. */
export type ScanStage = "GS1" | "INTERNAL_LPN" | "SSCC" | "GTIN" | "SKU";

export type ScanInterpretation =
  | { readonly kind: "GS1"; readonly scan: Gs1Scan }
  | { readonly kind: "INTERNAL_LPN"; readonly lpn: InternalLpn }
  | { readonly kind: "SSCC"; readonly lpn: SsccLpn }
  | { readonly kind: "GTIN"; readonly gtin14: string }
  | { readonly kind: "SKU"; readonly sku: string };

export interface ResolvedScan {
  /** The scan exactly as received (`G-047`). */
  readonly raw: string;
  /** The scan with the wedge terminator removed: what was actually parsed. */
  readonly normalized: string;
  readonly interpretation: ScanInterpretation;
}

/** Why one rung declined, so a rejection can be explained rung by rung. */
export interface ScanStageFailure {
  readonly stage: ScanStage;
  readonly reason:
    | "NOT_APPLICABLE"
    | "DISABLED"
    | Gs1ParseError["code"]
    | LpnError["code"]
    | IdentifierError["code"];
}

/** The policy field a rejected policy blamed. */
export type ScanPolicyField =
  "referenceYear" | "namespaces" | "bareSscc" | "skuFallback";

export type ScanRejection =
  | {
      readonly code: "INVALID_SCAN_POLICY";
      readonly raw: string;
      readonly field: ScanPolicyField;
    }
  | {
      readonly code: "UNREADABLE_SCAN";
      readonly raw: string;
      readonly error: IdentifierError;
    }
  | {
      readonly code: "INVALID_GS1_SCAN";
      readonly raw: string;
      readonly normalized: string;
      readonly error: Gs1ParseError;
    }
  | {
      readonly code: "LPN_NAMESPACE_POLICY_MISSING";
      readonly raw: string;
      readonly normalized: string;
      readonly prefix: string;
    }
  | {
      readonly code: "FOREIGN_LPN_NAMESPACE";
      readonly raw: string;
      readonly normalized: string;
      readonly prefix: string;
      readonly registered: readonly string[];
    }
  | {
      readonly code: "INVALID_LPN_SCAN";
      readonly raw: string;
      readonly normalized: string;
      readonly prefix: string;
      readonly error: LpnError;
    }
  | {
      readonly code: "BARE_SSCC_DISABLED";
      readonly raw: string;
      readonly normalized: string;
      readonly sscc18: string;
    }
  | {
      readonly code: "AMBIGUOUS_SCAN";
      readonly raw: string;
      readonly normalized: string;
      readonly candidates: readonly ScanStage[];
    }
  | {
      readonly code: "UNRECOGNIZED_SCAN";
      readonly raw: string;
      readonly normalized: string;
      readonly attempts: readonly ScanStageFailure[];
    };

export interface ScanResolutionPolicy {
  /** Required by the GS1 date AIs; never taken from the host clock. */
  readonly referenceYear: number;
  /**
   * The organization's LPN namespaces. Required to classify an internal LPN at
   * all: absent or empty, a well-formed internal LPN is rejected with
   * `LPN_NAMESPACE_POLICY_MISSING` rather than accepted as anybody's.
   */
  readonly namespaces?: readonly LpnNamespace[];
  /** Accept a bare 18-digit SSCC carrying no AI. Off by default. */
  readonly bareSscc?: boolean;
  /** Accept a plain tenant item code as the last rung. On by default. */
  readonly skuFallback?: boolean;
}

/**
 * GS1 parse failures that mean the scan *is* a GS1 element string with wrong
 * content. Anything else means the string was probably never GS1.
 */
const FATAL_GS1_ERRORS: ReadonlySet<Gs1ParseError["code"]> = new Set([
  "INVALID_CHECK_DIGIT",
  "INVALID_DATE",
  "DUPLICATE_AI",
  "UNSUPPORTED_SYMBOLOGY",
]);

/** Classifies a scan, or explains why it cannot be classified. */
export function resolveScan(
  raw: string,
  policy: ScanResolutionPolicy,
): Result<ResolvedScan, ScanRejection> {
  const checkedPolicy = validatePolicy(policy);
  if (!checkedPolicy.ok) {
    return fail({
      code: "INVALID_SCAN_POLICY",
      raw: typeof raw === "string" ? raw : "",
      field: checkedPolicy.error,
    });
  }
  const rules = checkedPolicy.value;

  const normalizedResult = normalizeRawScan(raw);
  if (!normalizedResult.ok) {
    return fail({
      code: "UNREADABLE_SCAN",
      raw,
      error: normalizedResult.error,
    });
  }
  const normalized = normalizedResult.value;
  const resolved = (interpretation: ScanInterpretation) =>
    ok<ResolvedScan>(Object.freeze({ raw, normalized, interpretation }));

  // Rule 1: a symbology identifier or an FNC1 leaves no other reading available.
  const onlyGs1 =
    normalized.startsWith("]") || normalized.includes(GROUP_SEPARATOR);
  if (onlyGs1) {
    const parsed = parseGs1ElementString(normalized, {
      referenceYear: rules.referenceYear,
    });
    return parsed.ok
      ? resolved({ kind: "GS1", scan: parsed.value })
      : fail({
          code: "INVALID_GS1_SCAN",
          raw,
          normalized,
          error: parsed.error,
        });
  }

  const attempts: ScanStageFailure[] = [];
  const candidates: { stage: ScanStage; interpretation: ScanInterpretation }[] =
    [];

  if (looksLikeGs1ElementString(normalized)) {
    const parsed = parseGs1ElementString(normalized, {
      referenceYear: rules.referenceYear,
    });
    if (parsed.ok) {
      candidates.push({
        stage: "GS1",
        interpretation: { kind: "GS1", scan: parsed.value },
      });
    } else {
      // Rule 2: a content error is fatal, a shape error is not.
      if (FATAL_GS1_ERRORS.has(parsed.error.code)) {
        return fail({
          code: "INVALID_GS1_SCAN",
          raw,
          normalized,
          error: parsed.error,
        });
      }
      attempts.push({ stage: "GS1", reason: parsed.error.code });
    }
  } else {
    attempts.push({ stage: "GS1", reason: "NOT_APPLICABLE" });
  }

  if (looksLikeInternalLpn(normalized)) {
    const structural = parseInternalLpn(normalized);
    if (structural.ok) {
      const prefix = structural.value.prefix;
      // Rule 3: with no namespace policy there is no answer to "whose pallet is
      // this?", and a well-formed LPN must not be read as anything else.
      if (rules.namespaces.length === 0) {
        return fail({
          code: "LPN_NAMESPACE_POLICY_MISSING",
          raw,
          normalized,
          prefix,
        });
      }
      // Rule 4: a valid LPN with a prefix this organization does not own is
      // rejected outright, not reinterpreted.
      if (!rules.namespaces.some((namespace) => namespace.prefix === prefix)) {
        return fail({
          code: "FOREIGN_LPN_NAMESPACE",
          raw,
          normalized,
          prefix,
          registered: frozenArray(
            rules.namespaces.map((namespace) => namespace.prefix),
          ),
        });
      }
      candidates.push({
        stage: "INTERNAL_LPN",
        interpretation: { kind: "INTERNAL_LPN", lpn: structural.value },
      });
    } else {
      // Rule 5: shaped like one of ours and structurally wrong is a broken label
      // of ours, not a code from a lower rung.
      const claimed = claimedNamespacePrefix(normalized, rules.namespaces);
      if (claimed !== null) {
        return fail({
          code: "INVALID_LPN_SCAN",
          raw,
          normalized,
          prefix: claimed,
          error: structural.error,
        });
      }
      attempts.push({ stage: "INTERNAL_LPN", reason: structural.error.code });
    }
  } else {
    attempts.push({ stage: "INTERNAL_LPN", reason: "NOT_APPLICABLE" });
  }

  // Rule 6: a syntactically valid bare SSCC is never quietly something else.
  const sscc = lpnFromSscc(normalized);
  if (sscc.ok) {
    if (!rules.bareSscc) {
      return fail({
        code: "BARE_SSCC_DISABLED",
        raw,
        normalized,
        sscc18: sscc.value.value,
      });
    }
    candidates.push({
      stage: "SSCC",
      interpretation: { kind: "SSCC", lpn: sscc.value },
    });
  } else {
    attempts.push({
      stage: "SSCC",
      reason: rules.bareSscc ? sscc.error.code : "DISABLED",
    });
  }

  const gtin = normalizeGtin(normalized);
  if (gtin.ok) {
    candidates.push({
      stage: "GTIN",
      interpretation: { kind: "GTIN", gtin14: gtin.value },
    });
  } else {
    attempts.push({ stage: "GTIN", reason: gtin.error.code });
  }

  // Rule 7: two readings of one bare scan is an ambiguity, not a preference.
  if (candidates.length > 1) {
    return fail({
      code: "AMBIGUOUS_SCAN",
      raw,
      normalized,
      candidates: frozenArray(candidates.map(({ stage }) => stage)),
    });
  }
  const only = candidates[0];
  if (only !== undefined) return resolved(only.interpretation);

  if (!rules.skuFallback) {
    attempts.push({ stage: "SKU", reason: "DISABLED" });
  } else {
    const sku = normalizeSku(normalized);
    if (sku.ok) return resolved({ kind: "SKU", sku: sku.value });
    attempts.push({ stage: "SKU", reason: sku.error.code });
  }

  return fail({
    code: "UNRECOGNIZED_SCAN",
    raw,
    normalized,
    attempts: frozenArray(attempts),
  });
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/** The policy as this module will use it, or the field that made it unusable. */
interface ValidatedScanPolicy {
  readonly referenceYear: number;
  readonly namespaces: readonly LpnNamespace[];
  readonly bareSscc: boolean;
  readonly skuFallback: boolean;
}

function validatePolicy(
  policy: ScanResolutionPolicy,
): Result<ValidatedScanPolicy, ScanPolicyField> {
  if (!isRecord(policy)) return fail("referenceYear");
  if (
    !isSafeInt(policy.referenceYear) ||
    policy.referenceYear < MIN_BUSINESS_YEAR ||
    policy.referenceYear > MAX_BUSINESS_YEAR
  ) {
    return fail("referenceYear");
  }
  if (policy.bareSscc !== undefined && !isBoolean(policy.bareSscc)) {
    return fail("bareSscc");
  }
  if (policy.skuFallback !== undefined && !isBoolean(policy.skuFallback)) {
    return fail("skuFallback");
  }
  const declared = policy.namespaces;
  if (declared !== undefined && !isArray(declared)) return fail("namespaces");
  const namespaces: LpnNamespace[] = [];
  for (const namespace of declared ?? []) {
    const validated = validateLpnNamespace(namespace);
    if (!validated.ok) return fail("namespaces");
    namespaces.push(validated.value);
  }
  return ok(
    Object.freeze({
      referenceYear: policy.referenceYear,
      namespaces: frozenArray(namespaces),
      bareSscc: policy.bareSscc === true,
      skuFallback: policy.skuFallback !== false,
    }),
  );
}

/**
 * The registered prefix a scan claims by shape: it starts with that prefix and is
 * exactly as long as an internal LPN issued under it. That is what separates "one
 * of ours, damaged" from "a string that happens to use the same alphabet".
 */
function claimedNamespacePrefix(
  normalized: string,
  namespaces: readonly LpnNamespace[],
): string | null {
  const folded = normalized
    .trim()
    .replace(/[a-z]/g, (character) => character.toUpperCase());
  for (const namespace of namespaces) {
    const expectedLength =
      namespace.prefix.length + LPN_TIME_LENGTH + LPN_RANDOM_LENGTH + 1;
    if (
      folded.length === expectedLength &&
      folded.startsWith(namespace.prefix)
    ) {
      return namespace.prefix;
    }
  }
  return null;
}
