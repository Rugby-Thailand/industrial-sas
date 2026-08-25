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

export type RotationStrategy = "FIFO" | "FEFO";

export type RotationDateSource = "EXPIRATION" | "BEST_BEFORE" | "MANUFACTURE";

export type MissingRotationDatePolicy = "EXCLUDE" | "ORDER_LAST";

export type ExpiredPolicy = "EXCLUDE" | "ORDER_FIRST";

export interface StockRotationPolicy {
  readonly strategy: RotationStrategy;
  readonly rotationDateSource: RotationDateSource;
  readonly missingRotationDate: MissingRotationDatePolicy;
  readonly expired: ExpiredPolicy;
}

export interface StockRotationCandidate {
  readonly candidateKey: string;
  readonly lotCode: string | null;
  readonly receivedOn: BusinessDate | null;

  readonly receiptSequence: number | null;
  readonly expirationDate: BusinessDate | null;
  readonly bestBeforeDate: BusinessDate | null;
  readonly manufactureDate: BusinessDate | null;
}

export type RotationCriterion =
  | "EXPIRY_GROUP"
  | "ROTATION_DATE"
  | "ROTATION_DATE_PRESENCE"
  | "RECEIVED_ON"
  | "RECEIPT_SEQUENCE"
  | "LOT_CODE"
  | "CANDIDATE_KEY";

export interface RotationCriterionValue {
  readonly criterion: RotationCriterion;
  readonly value: string;
}

export interface RotationRanking {
  readonly candidate: StockRotationCandidate;

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

const expiredAt = (candidate: ValidCandidate, asOfIso: string): boolean =>
  candidate.expirationIso !== null && candidate.expirationIso < asOfIso;

const exclusion = (
  candidate: ValidCandidate,
  reason: RotationExclusionReason,
): RotationExclusion => Object.freeze({ candidate: candidate.value, reason });

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
      const leftExpired = expiredAt(left, asOfIso);
      const rightExpired = expiredAt(right, asOfIso);
      if (leftExpired === rightExpired) return 0;
      return leftExpired ? -1 : 1;
    }
    case "ROTATION_DATE_PRESENCE": {
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

function compareNullableStrings(
  left: string | null,
  right: string | null,
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return compareStrings(left, right);
}

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

const describe = (value: unknown): string =>
  value === null ? "null" : typeof value;
