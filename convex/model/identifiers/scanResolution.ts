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

export type ScanStage = "GS1" | "INTERNAL_LPN" | "SSCC" | "GTIN" | "SKU";

export type ScanInterpretation =
  | { readonly kind: "GS1"; readonly scan: Gs1Scan }
  | { readonly kind: "INTERNAL_LPN"; readonly lpn: InternalLpn }
  | { readonly kind: "SSCC"; readonly lpn: SsccLpn }
  | { readonly kind: "GTIN"; readonly gtin14: string }
  | { readonly kind: "SKU"; readonly sku: string };

export interface ResolvedScan {
  readonly raw: string;

  readonly normalized: string;
  readonly interpretation: ScanInterpretation;
}

export interface ScanStageFailure {
  readonly stage: ScanStage;
  readonly reason:
    | "NOT_APPLICABLE"
    | "DISABLED"
    | Gs1ParseError["code"]
    | LpnError["code"]
    | IdentifierError["code"];
}

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
  readonly referenceYear: number;

  readonly namespaces?: readonly LpnNamespace[];

  readonly bareSscc?: boolean;

  readonly skuFallback?: boolean;
}

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

  const claimedPrefixes = new Set<string>();
  for (const namespace of declared ?? []) {
    const validated = validateLpnNamespace(namespace);
    if (!validated.ok) return fail("namespaces");
    if (claimedPrefixes.has(validated.value.prefix)) return fail("namespaces");
    claimedPrefixes.add(validated.value.prefix);
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
