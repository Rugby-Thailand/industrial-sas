/**
 * Stock rotation: FIFO and FEFO ordering with explainable, deterministic
 * tie-breakers (`G-032`, `G-033`, `G-063`, `G-064`, `INV-0005-10`, §5 Q23).
 *
 * Status: **implemented** as pure ordering over candidates the caller supplies.
 * Nothing selects real stock: there are no lots, no balances, and no putaway or
 * pick that consumes an order.
 *
 * The requirement is not "sort by expiry". It is that two operators, two devices,
 * and a replay of the same data produce the *same* sequence, and that the reason
 * for the sequence can be shown on a screen. Four decisions follow.
 *
 * 1. **The order is total, or the call fails.** Every candidate carries a
 *    `candidateKey` that is unique within the call — a bucket identity in practice.
 *    It is the last tie-breaker, which makes the comparator a strict total order:
 *    no two distinct candidates ever compare equal, so the result cannot depend on
 *    the input order or on the sort implementation's stability. A duplicate key
 *    means no total order exists, and the whole call fails rather than returning an
 *    arbitrary sequence.
 * 2. **Missing data excludes, by default.** A FEFO candidate without a rotation
 *    date and a FIFO candidate without a receipt order are not "probably fine" —
 *    they are unrankable. They are excluded with a reason, and a caller that wants
 *    them ranked last must say so (`missingRotationDate: "ORDER_LAST"`). Nothing
 *    is silently treated as the epoch or as infinitely far away. Where two reasons
 *    apply, `EXPIRED` is the one reported: it is the reason an operator most needs
 *    to see, and a missing receipt order must not mask it.
 * 3. **Expired means expired, whatever the rotation policy is.** A candidate is
 *    expired exactly when its `expirationDate` is before `asOf`. That is
 *    deliberately *not* read off the configured rotation date: the rotation source
 *    decides the *order* (§5 Q23 lets an item class rotate by manufacture or best
 *    before), and reading expiry from it would have called a lot with an old
 *    manufacture date "expired" — and, worse, called a lot whose expiry has passed
 *    "good" whenever the policy rotated by anything else. Expiry is compared
 *    against an explicit `asOf` business date, never a host clock, and stock is
 *    usable through the whole of its expiration date, so equality is not expiry.
 *    Expired candidates are excluded by default; `ORDER_FIRST` exists for the
 *    disposal and quarantine flows that specifically want them, and it is an
 *    opt-in.
 * 4. **Nothing here trusts its input.** Every candidate, the policy, and `asOf`
 *    are validated before any comparison: a `candidateKey` that is not a bounded
 *    key, a negative or non-integer `receiptSequence`, an impossible
 *    `BusinessDate`, a lot code carrying a control character, and a policy field a
 *    cast invented are each a named error. An unvalidated date would otherwise
 *    order a pick list by `NaN`, which is not an order at all — and `NaN`
 *    comparisons are how a "total" order silently stops being one.
 *
 * Ordering never uses `localeCompare`: string tie-breakers compare by code unit,
 * because a collation-dependent order would differ between a Thai locale and a
 * CI runner. Dates are compared in their `YYYY-MM-DD` form, which sorts
 * chronologically by code unit for every representable year.
 *
 * Pure module (plan §6.2): no Convex imports.
 */
import { frozenArray, isArray, isRecord, isSafeInt, isString } from "../guards";
import { fail, ok, type Result } from "../result";
import {
  businessDateToIso,
  validateBusinessDate,
  type BusinessDate,
  type BusinessDateError,
} from "../time/businessDate";
import {
  normalizeCode,
  MAX_CODE_LENGTH,
  MAX_LOT_CODE_LENGTH,
  type IdentifierError,
} from "../identifiers/normalization";

/** FIFO orders by receipt; FEFO by rotation date (`G-033`, `G-063`). */
export type RotationStrategy = "FIFO" | "FEFO";

/** Which lot date drives FEFO. Configurable per item class (§5 Q23). */
export type RotationDateSource = "EXPIRATION" | "BEST_BEFORE" | "MANUFACTURE";

/** What to do with a candidate that has no usable rotation date. */
export type MissingRotationDatePolicy = "EXCLUDE" | "ORDER_LAST";

/** What to do with a candidate whose expiration date has passed. */
export type ExpiredPolicy = "EXCLUDE" | "ORDER_FIRST";

export interface StockRotationPolicy {
  readonly strategy: RotationStrategy;
  readonly rotationDateSource: RotationDateSource;
  readonly missingRotationDate: MissingRotationDatePolicy;
  readonly expired: ExpiredPolicy;
}

/**
 * One rankable unit of stock. Every field is optional data the caller may not
 * have, except `candidateKey`, which must be unique within a call.
 */
export interface StockRotationCandidate {
  readonly candidateKey: string;
  readonly lotCode: string | null;
  readonly receivedOn: BusinessDate | null;
  /** A monotonic per-organization sequence, e.g. a ledger line ordinal. */
  readonly receiptSequence: number | null;
  readonly expirationDate: BusinessDate | null;
  readonly bestBeforeDate: BusinessDate | null;
  readonly manufactureDate: BusinessDate | null;
}

/** The keys the comparator used, in the order it used them. */
export type RotationCriterion =
  | "EXPIRY_GROUP"
  | "ROTATION_DATE"
  | "ROTATION_DATE_PRESENCE"
  | "RECEIVED_ON"
  | "RECEIPT_SEQUENCE"
  | "LOT_CODE"
  | "CANDIDATE_KEY";

/** One criterion and the candidate's value for it, for display. */
export interface RotationCriterionValue {
  readonly criterion: RotationCriterion;
  readonly value: string;
}

export interface RotationRanking {
  /**
   * The candidate as this module validated it: trimmed key, NFC lot code, and
   * frozen dates. It is the input's normalized form, not the caller's object, so a
   * ranking cannot be edited by mutating what was passed in.
   */
  readonly candidate: StockRotationCandidate;
  /** 1-based position in the returned order. */
  readonly rank: number;
  readonly expired: boolean;
  readonly rotationDate: BusinessDate | null;
  readonly explanation: readonly RotationCriterionValue[];
}

export type RotationExclusionReason =
  "MISSING_ROTATION_DATE" | "EXPIRED" | "MISSING_RECEIPT_ORDER";

export interface RotationExclusion {
  readonly candidate: StockRotationCandidate;
  readonly reason: RotationExclusionReason;
}

export interface StockRotationOrder {
  readonly ordered: readonly RotationRanking[];
  readonly excluded: readonly RotationExclusion[];
}

export type RotationError =
  | { readonly code: "NOT_A_CANDIDATE"; readonly received: string }
  | { readonly code: "DUPLICATE_CANDIDATE_KEY"; readonly candidateKey: string }
  | { readonly code: "EMPTY_CANDIDATE_KEY" }
  | {
      readonly code: "INVALID_CANDIDATE_KEY";
      readonly candidateKey: string;
      readonly error: IdentifierError;
    }
  | {
      readonly code: "INVALID_LOT_CODE";
      readonly candidateKey: string;
      readonly error: IdentifierError;
    }
  | {
      readonly code: "INVALID_RECEIPT_SEQUENCE";
      readonly candidateKey: string;
      readonly receiptSequence: number;
    }
  | {
      readonly code: "INVALID_DATE";
      readonly candidateKey: string;
      readonly field:
        | "receivedOn"
        | "expirationDate"
        | "bestBeforeDate"
        | "manufactureDate"
        | "asOf";
      readonly error: BusinessDateError;
    }
  | {
      readonly code: "INVALID_POLICY";
      readonly field:
        "strategy" | "rotationDateSource" | "missingRotationDate" | "expired";
    };

/* -------------------------------------------------------------------------- */
/* Public operations                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The rotation date a policy selects, or `null` when the lot does not carry it.
 * Validates the candidate and the policy, because a forged
 * `rotationDateSource` would otherwise fall off the end of the switch and answer
 * `undefined` while the type said `BusinessDate | null`.
 */
export function rotationDateOf(
  candidate: StockRotationCandidate,
  policy: StockRotationPolicy,
): Result<BusinessDate | null, RotationError> {
  const rules = validateRotationPolicy(policy);
  if (!rules.ok) return rules;
  const validated = validateRotationCandidate(candidate);
  if (!validated.ok) return validated;
  return ok(rotationDateOfValid(validated.value, rules.value));
}

/**
 * Whether a candidate has expired as of a business date: its `expirationDate` is
 * strictly before `asOf`. Independent of the rotation policy on purpose — see the
 * header — and independent of a best-before or manufacture date, neither of which
 * is an expiry.
 */
export function isCandidateExpired(
  candidate: StockRotationCandidate,
  asOf: BusinessDate,
): Result<boolean, RotationError> {
  const validated = validateRotationCandidate(candidate);
  if (!validated.ok) return validated;
  const at = validateAsOf(asOf, validated.value.candidateKey);
  if (!at.ok) return at;
  return ok(expiredAt(validated.value, at.value));
}

/**
 * Compares two candidates under a policy: -1, 0, or 1, or a named error for an
 * input that cannot be ordered.
 *
 * Both candidates are validated on every call, which is why this returns a
 * `Result` and not a comparator function. A bare comparator handed to
 * `Array.prototype.sort` is the one place an unvalidated value does the most
 * damage: `sort` calls it with whatever the array holds, a `NaN` comparison makes
 * the "total" order intransitive, and the resulting sequence is
 * implementation-defined rather than wrong in a way anyone can see.
 * `orderForRotation` validates once and then sorts, so the cost is paid per call
 * and not per comparison.
 */
export function compareRotationCandidates(
  left: StockRotationCandidate,
  right: StockRotationCandidate,
  policy: StockRotationPolicy,
  asOf: BusinessDate,
): Result<number, RotationError> {
  const rules = validateRotationPolicy(policy);
  if (!rules.ok) return rules;
  const first = validateRotationCandidate(left);
  if (!first.ok) return first;
  const second = validateRotationCandidate(right);
  if (!second.ok) return second;
  const at = validateAsOf(asOf, first.value.candidateKey);
  if (!at.ok) return at;
  return ok(compareValid(first.value, second.value, rules.value, at.value));
}

/**
 * Orders candidates and explains the order.
 *
 * Returns a result rather than an array because several inputs are unrankable
 * rather than merely awkward: a duplicate candidate key (no total order exists), a
 * receipt sequence that is not a non-negative safe integer (no defined position),
 * an impossible date, and a policy this module does not implement.
 */
export function orderForRotation(
  candidates: readonly StockRotationCandidate[],
  policy: StockRotationPolicy,
  options: { readonly asOf: BusinessDate },
): Result<StockRotationOrder, RotationError> {
  const rules = validateRotationPolicy(policy);
  if (!rules.ok) return rules;
  if (!isArray(candidates) || !isRecord(options)) {
    return fail({
      code: "NOT_A_CANDIDATE",
      received: describe(isArray(candidates) ? options : candidates),
    });
  }
  const at = validateAsOf(options.asOf, "");
  if (!at.ok) return at;

  const validated: ValidCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const checked = validateRotationCandidate(candidate);
    if (!checked.ok) return checked;
    if (seen.has(checked.value.candidateKey)) {
      return fail({
        code: "DUPLICATE_CANDIDATE_KEY",
        candidateKey: checked.value.candidateKey,
      });
    }
    seen.add(checked.value.candidateKey);
    validated.push(checked.value);
  }

  const eligible: ValidCandidate[] = [];
  const excluded: RotationExclusion[] = [];

  for (const candidate of validated) {
    const rotationDate = rotationDateOfValid(candidate, rules.value);
    // Expiry is checked first: it is the reason an operator most needs to see,
    // and it is the reason that must not be masked by a missing date or a missing
    // receipt order on the same candidate.
    if (expiredAt(candidate, at.value) && rules.value.expired === "EXCLUDE") {
      excluded.push(exclusion(candidate, "EXPIRED"));
      continue;
    }
    if (
      rotationDate === null &&
      rules.value.strategy === "FEFO" &&
      rules.value.missingRotationDate === "EXCLUDE"
    ) {
      excluded.push(exclusion(candidate, "MISSING_ROTATION_DATE"));
      continue;
    }
    if (
      rules.value.strategy === "FIFO" &&
      (candidate.receivedOnIso === null || candidate.receiptSequence === null)
    ) {
      excluded.push(exclusion(candidate, "MISSING_RECEIPT_ORDER"));
      continue;
    }
    eligible.push(candidate);
  }

  const ordered = [...eligible]
    .sort((left, right) => compareValid(left, right, rules.value, at.value))
    .map((candidate, index) =>
      Object.freeze({
        candidate: candidate.value,
        rank: index + 1,
        expired: expiredAt(candidate, at.value),
        rotationDate: rotationDateOfValid(candidate, rules.value),
        explanation: explain(candidate, rules.value, at.value),
      }),
    );

  return ok(
    Object.freeze({
      ordered: frozenArray(ordered),
      excluded: frozenArray(excluded),
    }),
  );
}

/**
 * Re-checks one candidate. Exported because a caller assembling candidates from
 * documents wants the error before it has a whole list, and because it is the only
 * way to obtain the validated form the ordering uses.
 */
export function validateRotationCandidate(
  candidate: StockRotationCandidate,
): Result<ValidCandidate, RotationError> {
  if (!isRecord(candidate)) {
    return fail({ code: "NOT_A_CANDIDATE", received: describe(candidate) });
  }
  if (
    !isString(candidate.candidateKey) ||
    candidate.candidateKey.length === 0
  ) {
    return fail({ code: "EMPTY_CANDIDATE_KEY" });
  }
  const key = normalizeCode(candidate.candidateKey, {
    maxLength: MAX_CODE_LENGTH,
    caseFolding: "PRESERVE",
  });
  if (!key.ok) {
    return fail({
      code: "INVALID_CANDIDATE_KEY",
      candidateKey: candidate.candidateKey,
      error: key.error,
    });
  }
  const candidateKey = key.value;

  let lotCode: string | null = null;
  if (candidate.lotCode !== null && candidate.lotCode !== undefined) {
    const normalized = normalizeCode(candidate.lotCode, {
      maxLength: MAX_LOT_CODE_LENGTH,
      caseFolding: "PRESERVE",
    });
    if (!normalized.ok) {
      return fail({
        code: "INVALID_LOT_CODE",
        candidateKey,
        error: normalized.error,
      });
    }
    lotCode = normalized.value;
  }

  if (
    candidate.receiptSequence !== null &&
    candidate.receiptSequence !== undefined
  ) {
    if (
      !isSafeInt(candidate.receiptSequence) ||
      candidate.receiptSequence < 0
    ) {
      return fail({
        code: "INVALID_RECEIPT_SEQUENCE",
        candidateKey,
        receiptSequence:
          typeof candidate.receiptSequence === "number"
            ? candidate.receiptSequence
            : Number.NaN,
      });
    }
  }

  const receivedOn = validateOptionalDate(
    candidate.receivedOn,
    candidateKey,
    "receivedOn",
  );
  if (!receivedOn.ok) return receivedOn;
  const expirationDate = validateOptionalDate(
    candidate.expirationDate,
    candidateKey,
    "expirationDate",
  );
  if (!expirationDate.ok) return expirationDate;
  const bestBeforeDate = validateOptionalDate(
    candidate.bestBeforeDate,
    candidateKey,
    "bestBeforeDate",
  );
  if (!bestBeforeDate.ok) return bestBeforeDate;
  const manufactureDate = validateOptionalDate(
    candidate.manufactureDate,
    candidateKey,
    "manufactureDate",
  );
  if (!manufactureDate.ok) return manufactureDate;

  const value: StockRotationCandidate = Object.freeze({
    candidateKey,
    lotCode,
    receivedOn: receivedOn.value?.date ?? null,
    receiptSequence:
      candidate.receiptSequence === null ||
      candidate.receiptSequence === undefined
        ? null
        : candidate.receiptSequence,
    expirationDate: expirationDate.value?.date ?? null,
    bestBeforeDate: bestBeforeDate.value?.date ?? null,
    manufactureDate: manufactureDate.value?.date ?? null,
  });

  return ok(
    Object.freeze({
      value,
      candidateKey,
      lotCode,
      receivedOnIso: receivedOn.value?.iso ?? null,
      expirationIso: expirationDate.value?.iso ?? null,
      bestBeforeIso: bestBeforeDate.value?.iso ?? null,
      manufactureIso: manufactureDate.value?.iso ?? null,
      receiptSequence: value.receiptSequence,
    }),
  );
}

/** Re-checks a policy: a field a cast invented is a named error, not a default. */
export function validateRotationPolicy(
  policy: StockRotationPolicy,
): Result<StockRotationPolicy, RotationError> {
  if (!isRecord(policy))
    return fail({ code: "INVALID_POLICY", field: "strategy" });
  if (policy.strategy !== "FIFO" && policy.strategy !== "FEFO") {
    return fail({ code: "INVALID_POLICY", field: "strategy" });
  }
  if (
    policy.rotationDateSource !== "EXPIRATION" &&
    policy.rotationDateSource !== "BEST_BEFORE" &&
    policy.rotationDateSource !== "MANUFACTURE"
  ) {
    return fail({ code: "INVALID_POLICY", field: "rotationDateSource" });
  }
  if (
    policy.missingRotationDate !== "EXCLUDE" &&
    policy.missingRotationDate !== "ORDER_LAST"
  ) {
    return fail({ code: "INVALID_POLICY", field: "missingRotationDate" });
  }
  if (policy.expired !== "EXCLUDE" && policy.expired !== "ORDER_FIRST") {
    return fail({ code: "INVALID_POLICY", field: "expired" });
  }
  return ok(
    Object.freeze({
      strategy: policy.strategy,
      rotationDateSource: policy.rotationDateSource,
      missingRotationDate: policy.missingRotationDate,
      expired: policy.expired,
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A candidate this module has validated, carrying the ISO form of each date so the
 * comparator is string and integer comparison only. Opaque by construction:
 * `validateRotationCandidate` is the only way to obtain one, so no comparison here
 * can run on a value that was never checked.
 */
export interface ValidCandidate {
  readonly value: StockRotationCandidate;
  readonly candidateKey: string;
  readonly lotCode: string | null;
  readonly receivedOnIso: string | null;
  readonly expirationIso: string | null;
  readonly bestBeforeIso: string | null;
  readonly manufactureIso: string | null;
  readonly receiptSequence: number | null;
}

/** The rotation date, as an ISO string, for a validated candidate. */
const rotationIsoOf = (
  candidate: ValidCandidate,
  policy: StockRotationPolicy,
): string | null => {
  switch (policy.rotationDateSource) {
    case "EXPIRATION":
      return candidate.expirationIso;
    case "BEST_BEFORE":
      return candidate.bestBeforeIso;
    case "MANUFACTURE":
      return candidate.manufactureIso;
  }
};

const rotationDateOfValid = (
  candidate: ValidCandidate,
  policy: StockRotationPolicy,
): BusinessDate | null => {
  switch (policy.rotationDateSource) {
    case "EXPIRATION":
      return candidate.value.expirationDate;
    case "BEST_BEFORE":
      return candidate.value.bestBeforeDate;
    case "MANUFACTURE":
      return candidate.value.manufactureDate;
  }
};

/** Expiry, from the expiration date alone, against a validated `asOf`. */
const expiredAt = (candidate: ValidCandidate, asOfIso: string): boolean =>
  candidate.expirationIso !== null && candidate.expirationIso < asOfIso;

const exclusion = (
  candidate: ValidCandidate,
  reason: RotationExclusionReason,
): RotationExclusion => Object.freeze({ candidate: candidate.value, reason });

/**
 * The criteria in priority order. `CANDIDATE_KEY` is always last and always
 * present: it is what makes the order total.
 */
function criteriaFor(
  policy: StockRotationPolicy,
): readonly RotationCriterion[] {
  const expiryGroup: readonly RotationCriterion[] =
    policy.expired === "ORDER_FIRST" ? ["EXPIRY_GROUP"] : [];
  return policy.strategy === "FEFO"
    ? [
        ...expiryGroup,
        "ROTATION_DATE_PRESENCE",
        "ROTATION_DATE",
        "RECEIVED_ON",
        "RECEIPT_SEQUENCE",
        "LOT_CODE",
        "CANDIDATE_KEY",
      ]
    : [
        ...expiryGroup,
        "RECEIVED_ON",
        "RECEIPT_SEQUENCE",
        "ROTATION_DATE_PRESENCE",
        "ROTATION_DATE",
        "LOT_CODE",
        "CANDIDATE_KEY",
      ];
}

function compareValid(
  left: ValidCandidate,
  right: ValidCandidate,
  policy: StockRotationPolicy,
  asOfIso: string,
): number {
  for (const criterion of criteriaFor(policy)) {
    const difference = compareBy(criterion, left, right, policy, asOfIso);
    if (difference !== 0) return difference;
  }
  return 0;
}

function compareBy(
  criterion: RotationCriterion,
  left: ValidCandidate,
  right: ValidCandidate,
  policy: StockRotationPolicy,
  asOfIso: string,
): number {
  switch (criterion) {
    case "EXPIRY_GROUP": {
      // Expired first when the policy asks for it, so a disposal task sees the
      // stock it is for before anything still usable.
      const leftExpired = expiredAt(left, asOfIso);
      const rightExpired = expiredAt(right, asOfIso);
      if (leftExpired === rightExpired) return 0;
      return leftExpired ? -1 : 1;
    }
    case "ROTATION_DATE_PRESENCE": {
      // A dateless candidate only reaches the comparator under `ORDER_LAST`.
      const leftHas = rotationIsoOf(left, policy) !== null;
      const rightHas = rotationIsoOf(right, policy) !== null;
      if (leftHas === rightHas) return 0;
      return leftHas ? -1 : 1;
    }
    case "ROTATION_DATE":
      return compareNullableStrings(
        rotationIsoOf(left, policy),
        rotationIsoOf(right, policy),
      );
    case "RECEIVED_ON":
      return compareNullableStrings(left.receivedOnIso, right.receivedOnIso);
    case "RECEIPT_SEQUENCE":
      return compareNullableNumbers(
        left.receiptSequence,
        right.receiptSequence,
      );
    case "LOT_CODE":
      return compareNullableStrings(left.lotCode, right.lotCode);
    case "CANDIDATE_KEY":
      return compareStrings(left.candidateKey, right.candidateKey);
  }
}

function compareNullableNumbers(
  left: number | null,
  right: number | null,
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Nulls sort last; two nulls are equal and defer to the next criterion. */
function compareNullableStrings(
  left: string | null,
  right: string | null,
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return compareStrings(left, right);
}

/** Code-unit comparison. `localeCompare` would make the order locale-dependent. */
function compareStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function explain(
  candidate: ValidCandidate,
  policy: StockRotationPolicy,
  asOfIso: string,
): readonly RotationCriterionValue[] {
  return frozenArray(
    criteriaFor(policy).map((criterion) =>
      Object.freeze({
        criterion,
        value: describeCriterion(criterion, candidate, policy, asOfIso),
      }),
    ),
  );
}

function describeCriterion(
  criterion: RotationCriterion,
  candidate: ValidCandidate,
  policy: StockRotationPolicy,
  asOfIso: string,
): string {
  switch (criterion) {
    case "EXPIRY_GROUP":
      return expiredAt(candidate, asOfIso) ? "EXPIRED" : "NOT_EXPIRED";
    case "ROTATION_DATE_PRESENCE":
      return rotationIsoOf(candidate, policy) === null ? "ABSENT" : "PRESENT";
    case "ROTATION_DATE":
      return rotationIsoOf(candidate, policy) ?? "";
    case "RECEIVED_ON":
      return candidate.receivedOnIso ?? "";
    case "RECEIPT_SEQUENCE":
      return candidate.receiptSequence === null
        ? ""
        : String(candidate.receiptSequence);
    case "LOT_CODE":
      return candidate.lotCode ?? "";
    case "CANDIDATE_KEY":
      return candidate.candidateKey;
  }
}

/** A date field, validated, with the ISO form the comparator uses. */
function validateOptionalDate(
  date: unknown,
  candidateKey: string,
  field: "receivedOn" | "expirationDate" | "bestBeforeDate" | "manufactureDate",
): Result<
  { readonly date: BusinessDate; readonly iso: string } | null,
  RotationError
> {
  if (date === null || date === undefined) return ok(null);
  const validated = validateBusinessDate(date as BusinessDate);
  if (!validated.ok) {
    return fail({
      code: "INVALID_DATE",
      candidateKey,
      field,
      error: validated.error,
    });
  }
  const iso = businessDateToIso(validated.value);
  if (!iso.ok) {
    return fail({
      code: "INVALID_DATE",
      candidateKey,
      field,
      error: iso.error,
    });
  }
  return ok(Object.freeze({ date: validated.value, iso: iso.value }));
}

/** `asOf` in ISO form, so every expiry comparison is a string comparison. */
function validateAsOf(
  asOf: BusinessDate,
  candidateKey: string,
): Result<string, RotationError> {
  const iso = businessDateToIso(asOf);
  return iso.ok
    ? ok(iso.value)
    : fail({
        code: "INVALID_DATE",
        candidateKey,
        field: "asOf",
        error: iso.error,
      });
}

/** The shape of a value that is not a candidate, for the error field. */
const describe = (value: unknown): string =>
  value === null ? "null" : typeof value;
