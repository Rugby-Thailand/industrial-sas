/**
 * Expiry reclassification, as *planned intents* rather than as writes.
 *
 * Status: **implemented.** Pure module (plan §6.2): no Convex imports, and no
 * imports outside `convex/model/**`.
 *
 * §5 Q19 and `ADR-0005` §8 both say the same thing: expiry is not a field that
 * flips. Stock whose lot has expired moves from `AVAILABLE` to `EXPIRED` as a
 * *balanced paired posting*, so the movement has a transaction, a time, an actor,
 * and a reversal path — none of which a row edit has.
 *
 * This module decides **which** buckets should move and produces the pair of lines
 * for each. It deliberately does not post: the intents it returns are handed to the
 * ordinary ledger mutation, which is where authorization, idempotency, the
 * non-negativity rule, and the same-transaction audit live. A scheduled job that
 * wrote balances directly would be a second, unaudited posting path, and
 * `INV-0003-11` is that no such path exists.
 *
 * ### What "expired" means here
 *
 * The **expiration date** against an explicit `asOf` business date, and nothing
 * else. Not the configured rotation date: `convex/model/rotation/stockRotation.ts`
 * already carries the same rule and the same reason (`G-032`, §5 Q23) — a rotation
 * source of `MANUFACTURE` would otherwise call an old lot expired and let a lot
 * that really had expired rank as usable. A candidate with no expiration date is
 * never expired; a lot without one is a lot the tenant did not shelf-life.
 *
 * The comparison is strict: expiry *on* `asOf` is not yet expired. A lot marked
 * best-before 31 March is usable through the 31st, which is the reading operators
 * and suppliers share.
 */
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

/** The status expired stock moves into. Code-owned; see `stockIdentity.ts`. */
export const EXPIRY_TARGET_STATUS: StockStatus = "EXPIRED";

/**
 * The statuses expiry moves stock *out of*.
 *
 * Only `AVAILABLE`. Quarantined, rejected, and scrapped stock is already withheld
 * from use, and moving it again would generate a second transaction that changes
 * no decision while making the history harder to read. Stock already `EXPIRED` is
 * excluded by construction — reclassifying it would be a no-op pair the ledger
 * would refuse as a zero line.
 */
export const EXPIRY_SOURCE_STATUSES: ReadonlySet<StockStatus> = new Set([
  "AVAILABLE",
]);

/** A bucket the job is considering, with its lot's expiration date. */
export interface ExpiryCandidate {
  readonly bucketKey: string;
  readonly bucket: InventoryBucket;
  readonly quantity: Quantity;
  /** The lot's expiration date, or `null` when the lot has none. */
  readonly expirationDate: BusinessDate | null;
}

/** Why a candidate was passed over. Reported, so a job run is explainable. */
export type ExpirySkipReason =
  | "NOT_EXPIRED"
  | "NO_EXPIRATION_DATE"
  | "STATUS_NOT_ELIGIBLE"
  | "NOT_PHYSICAL"
  | "NON_POSITIVE_BALANCE";

/** One planned status movement: two lines that balance to zero. */
export interface ExpiryIntent {
  readonly bucketKey: string;
  readonly lines: readonly LedgerLineDraft[];
  readonly fromStatus: StockStatus;
  readonly toStatus: StockStatus;
  readonly minorUnits: number;
  readonly uom: string;
}

/** A candidate that will not move, and why. */
export interface ExpirySkip {
  readonly bucketKey: string;
  readonly reason: ExpirySkipReason;
}

/** The whole plan: what moves, what does not, and why. Frozen. */
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

/**
 * Whether a candidate's stock has expired as of a business date.
 *
 * Separated from the planner so the rule is testable on its own and so the
 * planner's control flow reads as a filter rather than as an argument about dates.
 */
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

/**
 * Plan the status movements for one bounded page of candidates.
 *
 * The page is the caller's: this function loops over what it was handed and never
 * fetches, so its cost is the caller's page size. `jobPage.ts` is what makes that
 * page bounded and resumable.
 *
 * Order is the candidates' `bucketKey`, ascending, so two runs over the same page
 * produce the same plan in the same order — which is what lets a test assert the
 * plan rather than a set, and what makes a job run's log comparable to the next
 * one.
 */
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
