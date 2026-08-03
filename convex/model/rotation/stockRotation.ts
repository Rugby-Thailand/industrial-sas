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
 * for the sequence can be shown on a screen. Three decisions follow.
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
 *    is silently treated as the epoch or as infinitely far away.
 * 3. **Expired stock is not picked by accident.** Expiry is compared against an
 *    explicit `asOf` business date, never a host clock. Stock expires at the *end*
 *    of its rotation date, so a lot dated today is still good today. Expired
 *    candidates are excluded by default; `ORDER_FIRST` exists for the disposal and
 *    quarantine flows that specifically want them, and it is an opt-in.
 *
 * Ordering never uses `localeCompare`: string tie-breakers compare by code unit,
 * because a collation-dependent order would differ between a Thai locale and a
 * CI runner.
 *
 * Pure module (plan §6.2): no Convex imports.
 */
import { fail, ok, type Result } from "../result";
import {
  businessDateToIso,
  compareBusinessDates,
  type BusinessDate,
} from "../time/businessDate";

/** FIFO orders by receipt; FEFO by rotation date (`G-033`, `G-063`). */
export type RotationStrategy = "FIFO" | "FEFO";

/** Which lot date drives FEFO. Configurable per item class (§5 Q23). */
export type RotationDateSource = "EXPIRATION" | "BEST_BEFORE" | "MANUFACTURE";

/** What to do with a candidate that has no usable rotation date. */
export type MissingRotationDatePolicy = "EXCLUDE" | "ORDER_LAST";

/** What to do with a candidate whose rotation date has passed. */
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
  | { readonly code: "DUPLICATE_CANDIDATE_KEY"; readonly candidateKey: string }
  | { readonly code: "EMPTY_CANDIDATE_KEY" }
  | {
      readonly code: "INVALID_RECEIPT_SEQUENCE";
      readonly candidateKey: string;
      readonly receiptSequence: number;
    };

/** The rotation date a policy selects, or `null` when the lot does not carry it. */
export function rotationDateOf(
  candidate: StockRotationCandidate,
  policy: StockRotationPolicy,
): BusinessDate | null {
  switch (policy.rotationDateSource) {
    case "EXPIRATION":
      return candidate.expirationDate;
    case "BEST_BEFORE":
      return candidate.bestBeforeDate;
    case "MANUFACTURE":
      return candidate.manufactureDate;
  }
}

/**
 * True when the rotation date is strictly before `asOf`. Stock is usable through
 * the whole of its rotation date, so equality is not expiry.
 */
export const isExpired = (
  rotationDate: BusinessDate | null,
  asOf: BusinessDate,
): boolean =>
  rotationDate !== null && compareBusinessDates(rotationDate, asOf) < 0;

/**
 * Orders candidates and explains the order.
 *
 * Returns a result rather than an array because two inputs are unrankable rather
 * than merely awkward: a duplicate candidate key (no total order exists) and a
 * non-integer receipt sequence (no defined position).
 */
export function orderForRotation(
  candidates: readonly StockRotationCandidate[],
  policy: StockRotationPolicy,
  options: { readonly asOf: BusinessDate },
): Result<StockRotationOrder, RotationError> {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.candidateKey.length === 0) {
      return fail({ code: "EMPTY_CANDIDATE_KEY" });
    }
    if (seen.has(candidate.candidateKey)) {
      return fail({
        code: "DUPLICATE_CANDIDATE_KEY",
        candidateKey: candidate.candidateKey,
      });
    }
    seen.add(candidate.candidateKey);
    if (
      candidate.receiptSequence !== null &&
      !Number.isSafeInteger(candidate.receiptSequence)
    ) {
      return fail({
        code: "INVALID_RECEIPT_SEQUENCE",
        candidateKey: candidate.candidateKey,
        receiptSequence: candidate.receiptSequence,
      });
    }
  }

  const eligible: StockRotationCandidate[] = [];
  const excluded: RotationExclusion[] = [];

  for (const candidate of candidates) {
    const rotationDate = rotationDateOf(candidate, policy);
    if (rotationDate === null && policy.strategy === "FEFO") {
      if (policy.missingRotationDate === "EXCLUDE") {
        excluded.push({ candidate, reason: "MISSING_ROTATION_DATE" });
        continue;
      }
    }
    if (
      policy.strategy === "FIFO" &&
      (candidate.receivedOn === null || candidate.receiptSequence === null)
    ) {
      excluded.push({ candidate, reason: "MISSING_RECEIPT_ORDER" });
      continue;
    }
    if (isExpired(rotationDate, options.asOf) && policy.expired === "EXCLUDE") {
      excluded.push({ candidate, reason: "EXPIRED" });
      continue;
    }
    eligible.push(candidate);
  }

  const compare = compareForRotation(policy, options.asOf);
  const ordered = [...eligible].sort(compare).map((candidate, index) => {
    const rotationDate = rotationDateOf(candidate, policy);
    return Object.freeze({
      candidate,
      rank: index + 1,
      expired: isExpired(rotationDate, options.asOf),
      rotationDate,
      explanation: explain(candidate, policy, options.asOf),
    });
  });

  return ok(
    Object.freeze({
      ordered: Object.freeze(ordered),
      excluded: Object.freeze([...excluded]),
    }),
  );
}

/**
 * The comparator, as a strict total order over candidates with distinct keys.
 * Exported so a caller can sort its own collection, and so the property suite can
 * assert the order laws directly.
 */
export function compareForRotation(
  policy: StockRotationPolicy,
  asOf: BusinessDate,
): (left: StockRotationCandidate, right: StockRotationCandidate) => number {
  return (left, right) => {
    for (const criterion of criteriaFor(policy)) {
      const difference = compareBy(criterion, left, right, policy, asOf);
      if (difference !== 0) return difference;
    }
    return 0;
  };
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

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

function compareBy(
  criterion: RotationCriterion,
  left: StockRotationCandidate,
  right: StockRotationCandidate,
  policy: StockRotationPolicy,
  asOf: BusinessDate,
): number {
  switch (criterion) {
    case "EXPIRY_GROUP": {
      // Expired first when the policy asks for it, so a disposal task sees the
      // stock it is for before anything still usable.
      const leftExpired = isExpired(rotationDateOf(left, policy), asOf);
      const rightExpired = isExpired(rotationDateOf(right, policy), asOf);
      if (leftExpired === rightExpired) return 0;
      return leftExpired ? -1 : 1;
    }
    case "ROTATION_DATE_PRESENCE": {
      // A dateless candidate only reaches the comparator under `ORDER_LAST`.
      const leftHas = rotationDateOf(left, policy) !== null;
      const rightHas = rotationDateOf(right, policy) !== null;
      if (leftHas === rightHas) return 0;
      return leftHas ? -1 : 1;
    }
    case "ROTATION_DATE":
      return compareNullableDates(
        rotationDateOf(left, policy),
        rotationDateOf(right, policy),
      );
    case "RECEIVED_ON":
      return compareNullableDates(left.receivedOn, right.receivedOn);
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

/** Nulls sort last; two nulls are equal and defer to the next criterion. */
function compareNullableDates(
  left: BusinessDate | null,
  right: BusinessDate | null,
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return compareBusinessDates(left, right);
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
  candidate: StockRotationCandidate,
  policy: StockRotationPolicy,
  asOf: BusinessDate,
): readonly RotationCriterionValue[] {
  const rotationDate = rotationDateOf(candidate, policy);
  return Object.freeze(
    criteriaFor(policy).map((criterion) =>
      Object.freeze({
        criterion,
        value: describe(criterion, candidate, rotationDate, asOf),
      }),
    ),
  );
}

function describe(
  criterion: RotationCriterion,
  candidate: StockRotationCandidate,
  rotationDate: BusinessDate | null,
  asOf: BusinessDate,
): string {
  switch (criterion) {
    case "EXPIRY_GROUP":
      return isExpired(rotationDate, asOf) ? "EXPIRED" : "NOT_EXPIRED";
    case "ROTATION_DATE_PRESENCE":
      return rotationDate === null ? "ABSENT" : "PRESENT";
    case "ROTATION_DATE":
      return rotationDate === null ? "" : businessDateToIso(rotationDate);
    case "RECEIVED_ON":
      return candidate.receivedOn === null
        ? ""
        : businessDateToIso(candidate.receivedOn);
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
