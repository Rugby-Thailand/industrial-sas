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
 * best-effort guessing the ADR rejects. So four rules sit on top of the order:
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
 * 3. **A valid LPN that belongs to another prefix is rejected as foreign.** It is
 *    definitely a licence plate; it is definitely not this organization's. Reading
 *    it as a SKU would be the guess again.
 * 4. **A bare scan that satisfies two rungs is rejected as ambiguous**, naming the
 *    candidates. The SKU rung is excluded from that count: it is the deliberate
 *    catch-all, so counting it would make every scan ambiguous.
 *
 * A bare 18-digit SSCC is off by default (`bareSscc`), because it is ambiguous
 * with a numeric item code of the same length; a tenant that prints such labels
 * enables it knowingly.
 *
 * The raw scan travels with every result and every rejection, because
 * `INV-0005-12` requires it to be persisted next to its interpretation.
 *
 * Pure module (plan §6.2): no Convex imports.
 */
import { fail, ok, type Result } from "../result";
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

export type ScanRejection =
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
      readonly code: "FOREIGN_LPN_NAMESPACE";
      readonly raw: string;
      readonly normalized: string;
      readonly prefix: string;
      readonly registered: readonly string[];
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
  /** The organization's LPN namespaces. Empty accepts any well-formed LPN. */
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
    ok<ResolvedScan>({ raw, normalized, interpretation });

  // Rule 1: a symbology identifier or an FNC1 leaves no other reading available.
  const onlyGs1 =
    normalized.startsWith("]") || normalized.includes(GROUP_SEPARATOR);
  if (onlyGs1) {
    const parsed = parseGs1ElementString(normalized, {
      referenceYear: policy.referenceYear,
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
      referenceYear: policy.referenceYear,
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
      const namespaces = policy.namespaces ?? [];
      const registered =
        namespaces.length === 0 ||
        namespaces.some(
          (namespace) => namespace.prefix === structural.value.prefix,
        );
      // Rule 3: a valid LPN with a prefix this organization does not own is
      // rejected outright, not reinterpreted.
      if (!registered) {
        return fail({
          code: "FOREIGN_LPN_NAMESPACE",
          raw,
          normalized,
          prefix: structural.value.prefix,
          registered: Object.freeze(
            namespaces.map((namespace) => namespace.prefix),
          ),
        });
      }
      candidates.push({
        stage: "INTERNAL_LPN",
        interpretation: { kind: "INTERNAL_LPN", lpn: structural.value },
      });
    } else {
      attempts.push({ stage: "INTERNAL_LPN", reason: structural.error.code });
    }
  } else {
    attempts.push({ stage: "INTERNAL_LPN", reason: "NOT_APPLICABLE" });
  }

  if (policy.bareSscc === true) {
    const sscc = lpnFromSscc(normalized);
    if (sscc.ok) {
      candidates.push({
        stage: "SSCC",
        interpretation: { kind: "SSCC", lpn: sscc.value },
      });
    } else {
      attempts.push({ stage: "SSCC", reason: sscc.error.code });
    }
  } else {
    attempts.push({ stage: "SSCC", reason: "DISABLED" });
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

  // Rule 4: two readings of one bare scan is an ambiguity, not a preference.
  if (candidates.length > 1) {
    return fail({
      code: "AMBIGUOUS_SCAN",
      raw,
      normalized,
      candidates: Object.freeze(candidates.map(({ stage }) => stage)),
    });
  }
  const only = candidates[0];
  if (only !== undefined) return resolved(only.interpretation);

  if (policy.skuFallback === false) {
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
    attempts: Object.freeze([...attempts]),
  });
}
