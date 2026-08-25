import {
  compareBusinessDates,
  validateBusinessDate,
  type BusinessDate,
  type BusinessDateError,
} from "../time/businessDate";
import {
  negateQuantity,
  validateQuantity,
  type Quantity,
} from "../uom/quantity";
import { frozenArray, isArray, isRecord, isString } from "../guards";
import { fail, ok, type Result } from "../result";
import {
  encodeBucketKey,
  isPhysicalLocation,
  validateBucket,
  type InventoryBucket,
  type StockStatus,
} from "./stockIdentity";
import type { LedgerError, LedgerLineDraft } from "./ledgerTransaction";

export const EXPIRY_TARGET_STATUS: StockStatus = "EXPIRED";

export const EXPIRY_SOURCE_STATUSES: ReadonlySet<StockStatus> = new Set([
  "AVAILABLE",
]);

export interface ExpiryCandidate {
  readonly bucketKey: string;
  readonly bucket: InventoryBucket;
  readonly quantity: Quantity;

  readonly expirationDate: BusinessDate | null;
}

export type ExpirySkipReason =
  | "NOT_EXPIRED"
  | "NO_EXPIRATION_DATE"
  | "STATUS_NOT_ELIGIBLE"
  | "NOT_PHYSICAL"
  | "NON_POSITIVE_BALANCE";

export interface ExpiryIntent {
  readonly bucketKey: string;
  readonly lines: readonly LedgerLineDraft[];
  readonly fromStatus: StockStatus;
  readonly toStatus: StockStatus;
  readonly minorUnits: number;
  readonly uom: string;
}

export interface ExpirySkip {
  readonly bucketKey: string;
  readonly reason: ExpirySkipReason;
}

export interface ExpiryPlan {
  readonly intents: readonly ExpiryIntent[];
  readonly skipped: readonly ExpirySkip[];
}

export type ExpiryPlanError =
  | LedgerError
  | { readonly code: "INVALID_AS_OF_DATE"; readonly cause: BusinessDateError }
  | {
      readonly code: "INVALID_EXPIRATION_DATE";
      readonly bucketKey: string;
      readonly cause: BusinessDateError;
    };

export function isExpiredAsOf(
  expirationDate: BusinessDate | null,
  asOf: BusinessDate,
): Result<boolean, ExpiryPlanError> {
  const reference = validateBusinessDate(asOf);
  if (!reference.ok) {
    return fail({ code: "INVALID_AS_OF_DATE", cause: reference.error });
  }
  if (expirationDate === null || expirationDate === undefined) return ok(false);
  const expiry = validateBusinessDate(expirationDate);
  if (!expiry.ok) {
    return fail({ code: "INVALID_AS_OF_DATE", cause: expiry.error });
  }
  const comparison = compareBusinessDates(expiry.value, reference.value);
  if (!comparison.ok) {
    return fail({ code: "INVALID_AS_OF_DATE", cause: comparison.error });
  }
  return ok(comparison.value < 0);
}

export function planExpiryReclassification(input: {
  readonly asOf: BusinessDate;
  readonly candidates: readonly ExpiryCandidate[];
}): Result<ExpiryPlan, ExpiryPlanError> {
  if (!isRecord(input) || !isArray(input.candidates)) {
    return fail({ code: "NOT_A_TRANSACTION", received: typeof input });
  }
  const asOf = validateBusinessDate(input.asOf);
  if (!asOf.ok) {
    return fail({ code: "INVALID_AS_OF_DATE", cause: asOf.error });
  }

  const intents: ExpiryIntent[] = [];
  const skipped: ExpirySkip[] = [];
  const ordered = [...input.candidates].sort((left, right) => {
    const leftKey =
      isRecord(left) && isString(left.bucketKey) ? left.bucketKey : "";
    const rightKey =
      isRecord(right) && isString(right.bucketKey) ? right.bucketKey : "";
    if (leftKey === rightKey) return 0;
    return leftKey < rightKey ? -1 : 1;
  });

  for (const [index, candidate] of ordered.entries()) {
    if (!isRecord(candidate)) {
      return fail({
        code: "LINE_NOT_A_RECORD",
        index,
        received: typeof candidate,
      });
    }
    const bucket = validateBucket(candidate.bucket as InventoryBucket);
    if (!bucket.ok) {
      return fail({ code: "LINE_BUCKET_INVALID", index, cause: bucket.error });
    }
    const key = encodeBucketKey(bucket.value);
    if (!key.ok) {
      return fail({ code: "LINE_BUCKET_INVALID", index, cause: key.error });
    }
    const quantity = validateQuantity(candidate.quantity as Quantity);
    if (!quantity.ok) {
      return fail({
        code: "LINE_QUANTITY_INVALID",
        index,
        cause: quantity.error,
      });
    }

    if (!isPhysicalLocation(bucket.value.location)) {
      skipped.push(
        Object.freeze({
          bucketKey: key.value,
          reason: "NOT_PHYSICAL" as const,
        }),
      );
      continue;
    }
    if (!EXPIRY_SOURCE_STATUSES.has(bucket.value.stockStatus)) {
      skipped.push(
        Object.freeze({
          bucketKey: key.value,
          reason: "STATUS_NOT_ELIGIBLE" as const,
        }),
      );
      continue;
    }
    if (quantity.value.minorUnits <= 0) {
      skipped.push(
        Object.freeze({
          bucketKey: key.value,
          reason: "NON_POSITIVE_BALANCE" as const,
        }),
      );
      continue;
    }
    const expirationDate = candidate.expirationDate ?? null;
    if (expirationDate === null) {
      skipped.push(
        Object.freeze({
          bucketKey: key.value,
          reason: "NO_EXPIRATION_DATE" as const,
        }),
      );
      continue;
    }
    const expired = isExpiredAsOf(expirationDate as BusinessDate, asOf.value);
    if (!expired.ok) {
      return fail({
        code: "INVALID_EXPIRATION_DATE",
        bucketKey: key.value,
        cause: (expired.error as { cause: BusinessDateError }).cause,
      });
    }
    if (!expired.value) {
      skipped.push(
        Object.freeze({ bucketKey: key.value, reason: "NOT_EXPIRED" as const }),
      );
      continue;
    }

    const outbound = negateQuantity(quantity.value);
    if (!outbound.ok) {
      return fail({
        code: "LINE_QUANTITY_INVALID",
        index,
        cause: outbound.error,
      });
    }
    const target = validateBucket({
      ...bucket.value,
      stockStatus: EXPIRY_TARGET_STATUS,
    });
    if (!target.ok) {
      return fail({ code: "LINE_BUCKET_INVALID", index, cause: target.error });
    }

    intents.push(
      Object.freeze({
        bucketKey: key.value,
        lines: frozenArray<LedgerLineDraft>([
          Object.freeze({ bucket: bucket.value, quantity: outbound.value }),
          Object.freeze({ bucket: target.value, quantity: quantity.value }),
        ]),
        fromStatus: bucket.value.stockStatus,
        toStatus: EXPIRY_TARGET_STATUS,
        minorUnits: quantity.value.minorUnits,
        uom: quantity.value.uom,
      }),
    );
  }

  return ok(
    Object.freeze({
      intents: frozenArray(intents),
      skipped: frozenArray(skipped),
    }),
  );
}
