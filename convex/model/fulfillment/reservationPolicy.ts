import { isSafeInt } from "../guards";
import { fail, ok, type Result } from "../result";
import {
  orderForRotation,
  type StockRotationCandidate,
  type StockRotationPolicy,
} from "../rotation/stockRotation";
import type { BusinessDate } from "../time/businessDate";

export const FULFILLMENT_STAGES = [
  "DEMAND",
  "RESERVED",
  "PICKING",
  "STAGED",
  "ISSUED",
  "LOADED",
  "DELIVERED",
  "RETURNED",
  "BACKORDERED",
  "CANCELLED",
] as const;

export type FulfillmentStage = (typeof FULFILLMENT_STAGES)[number];

export type FulfillmentLineStatus =
  | "UNPLANNED"
  | "BACKORDERED"
  | "RESERVED"
  | "PICKING"
  | "STAGED"
  | "ISSUED"
  | "LOADED"
  | "PARTIALLY_DELIVERED"
  | "DELIVERED"
  | "RETURNED"
  | "CANCELLED";

export type FulfillmentQuantities = Readonly<Record<FulfillmentStage, number>>;

export interface ReservationCandidate {
  readonly bucketKey: string;
  readonly stockMinorUnits: number;
  readonly alreadyReservedMinorUnits: number;
  readonly rotation: StockRotationCandidate;
}

export interface ReservationAllocation {
  readonly bucketKey: string;
  readonly baseMinorUnits: number;
  readonly rank: number;
  readonly explanation: readonly {
    readonly criterion: string;
    readonly value: string;
  }[];
}

export interface ReservationDecision {
  readonly requestedMinorUnits: number;
  readonly atpMinorUnits: number;
  readonly reservedMinorUnits: number;
  readonly backorderedMinorUnits: number;
  readonly complete: boolean;
  readonly allocations: readonly ReservationAllocation[];
  readonly excludedBucketKeys: readonly string[];
}

export type ReservationError =
  | {
      readonly code: "INVALID_QUANTITY";
      readonly field: string;
      readonly value: number;
    }
  | {
      readonly code: "DUPLICATE_BUCKET";
      readonly bucketKey: string;
    }
  | {
      readonly code: "ROTATION_REFUSED";
      readonly reason: string;
    }
  | {
      readonly code: "INSUFFICIENT_ATP";
      readonly requestedMinorUnits: number;
      readonly atpMinorUnits: number;
    }
  | {
      readonly code: "CONSERVATION_FAILED";
      readonly orderedMinorUnits: number;
      readonly accountedMinorUnits: number;
    }
  | {
      readonly code: "ILLEGAL_STAGE_MOVE";
      readonly from: FulfillmentStage;
      readonly to: FulfillmentStage;
    }
  | {
      readonly code: "INSUFFICIENT_STAGE_QUANTITY";
      readonly stage: FulfillmentStage;
      readonly availableMinorUnits: number;
      readonly requestedMinorUnits: number;
    };

const validNonNegative = (value: number): boolean =>
  isSafeInt(value) && value >= 0;

const validPositive = (value: number): boolean => isSafeInt(value) && value > 0;

export function calculateAtp(
  candidates: readonly ReservationCandidate[],
): Result<number, ReservationError> {
  const seen = new Set<string>();
  let total = 0;
  for (const candidate of candidates) {
    if (seen.has(candidate.bucketKey)) {
      return fail({ code: "DUPLICATE_BUCKET", bucketKey: candidate.bucketKey });
    }
    seen.add(candidate.bucketKey);
    if (!validNonNegative(candidate.stockMinorUnits)) {
      return fail({
        code: "INVALID_QUANTITY",
        field: "stockMinorUnits",
        value: candidate.stockMinorUnits,
      });
    }
    if (!validNonNegative(candidate.alreadyReservedMinorUnits)) {
      return fail({
        code: "INVALID_QUANTITY",
        field: "alreadyReservedMinorUnits",
        value: candidate.alreadyReservedMinorUnits,
      });
    }
    total += Math.max(
      0,
      candidate.stockMinorUnits - candidate.alreadyReservedMinorUnits,
    );
    if (!Number.isSafeInteger(total)) {
      return fail({
        code: "INVALID_QUANTITY",
        field: "atpMinorUnits",
        value: total,
      });
    }
  }
  return ok(total);
}

export function allocateReservation(input: {
  readonly requestedMinorUnits: number;
  readonly candidates: readonly ReservationCandidate[];
  readonly rotationPolicy: StockRotationPolicy;
  readonly asOf: BusinessDate;
  readonly allowPartial: boolean;
}): Result<ReservationDecision, ReservationError> {
  if (!validPositive(input.requestedMinorUnits)) {
    return fail({
      code: "INVALID_QUANTITY",
      field: "requestedMinorUnits",
      value: input.requestedMinorUnits,
    });
  }
  const atp = calculateAtp(input.candidates);
  if (!atp.ok) return atp;
  if (atp.value < input.requestedMinorUnits && !input.allowPartial) {
    return fail({
      code: "INSUFFICIENT_ATP",
      requestedMinorUnits: input.requestedMinorUnits,
      atpMinorUnits: atp.value,
    });
  }

  const byRotationKey = new Map<string, ReservationCandidate>();
  for (const candidate of input.candidates) {
    if (byRotationKey.has(candidate.rotation.candidateKey)) {
      return fail({
        code: "ROTATION_REFUSED",
        reason: "DUPLICATE_ROTATION_KEY",
      });
    }
    byRotationKey.set(candidate.rotation.candidateKey, candidate);
  }
  const rotation = orderForRotation(
    input.candidates.map((candidate) => candidate.rotation),
    input.rotationPolicy,
    { asOf: input.asOf },
  );
  if (!rotation.ok) {
    return fail({
      code: "ROTATION_REFUSED",
      reason: rotation.error.code,
    });
  }

  let remaining = input.requestedMinorUnits;
  const allocations: ReservationAllocation[] = [];
  for (const ranked of rotation.value.ordered) {
    if (remaining === 0) break;
    const candidate = byRotationKey.get(ranked.candidate.candidateKey);
    if (candidate === undefined) {
      return fail({
        code: "ROTATION_REFUSED",
        reason: "CANDIDATE_KEY_MISMATCH",
      });
    }
    const available = Math.max(
      0,
      candidate.stockMinorUnits - candidate.alreadyReservedMinorUnits,
    );
    const baseMinorUnits = Math.min(remaining, available);
    if (baseMinorUnits === 0) continue;
    allocations.push(
      Object.freeze({
        bucketKey: candidate.bucketKey,
        baseMinorUnits,
        rank: ranked.rank,
        explanation: Object.freeze(
          ranked.explanation.map((entry) => Object.freeze({ ...entry })),
        ),
      }),
    );
    remaining -= baseMinorUnits;
  }

  const reservedMinorUnits = input.requestedMinorUnits - remaining;
  return ok(
    Object.freeze({
      requestedMinorUnits: input.requestedMinorUnits,
      atpMinorUnits: atp.value,
      reservedMinorUnits,
      backorderedMinorUnits: remaining,
      complete: remaining === 0,
      allocations: Object.freeze(allocations),
      excludedBucketKeys: Object.freeze(
        rotation.value.excluded.map(
          (entry) =>
            byRotationKey.get(entry.candidate.candidateKey)?.bucketKey ??
            entry.candidate.candidateKey,
        ),
      ),
    }),
  );
}

export function initialFulfillmentQuantities(
  orderedMinorUnits: number,
): Result<FulfillmentQuantities, ReservationError> {
  if (!validPositive(orderedMinorUnits)) {
    return fail({
      code: "INVALID_QUANTITY",
      field: "orderedMinorUnits",
      value: orderedMinorUnits,
    });
  }
  return ok(
    Object.freeze({
      DEMAND: orderedMinorUnits,
      RESERVED: 0,
      PICKING: 0,
      STAGED: 0,
      ISSUED: 0,
      LOADED: 0,
      DELIVERED: 0,
      RETURNED: 0,
      BACKORDERED: 0,
      CANCELLED: 0,
    }),
  );
}

const stages = (...values: FulfillmentStage[]): readonly FulfillmentStage[] =>
  Object.freeze(values);

const ALLOWED_STAGE_MOVES: Readonly<
  Record<FulfillmentStage, readonly FulfillmentStage[]>
> = Object.freeze({
  DEMAND: stages("RESERVED", "BACKORDERED", "CANCELLED"),
  RESERVED: stages("PICKING", "DEMAND", "BACKORDERED", "CANCELLED"),
  PICKING: stages("STAGED", "RESERVED", "BACKORDERED"),
  STAGED: stages("ISSUED", "RESERVED", "BACKORDERED"),

  ISSUED: stages("STAGED", "LOADED", "RETURNED"),
  LOADED: stages("DELIVERED", "RETURNED"),
  DELIVERED: stages("RETURNED"),
  RETURNED: stages("RESERVED", "BACKORDERED", "CANCELLED"),
  BACKORDERED: stages("RESERVED", "CANCELLED"),
  CANCELLED: stages(),
});

export function moveFulfillmentQuantity(
  quantities: FulfillmentQuantities,
  move: {
    readonly from: FulfillmentStage;
    readonly to: FulfillmentStage;
    readonly baseMinorUnits: number;
  },
): Result<FulfillmentQuantities, ReservationError> {
  if (!validPositive(move.baseMinorUnits)) {
    return fail({
      code: "INVALID_QUANTITY",
      field: "baseMinorUnits",
      value: move.baseMinorUnits,
    });
  }
  if (!ALLOWED_STAGE_MOVES[move.from].includes(move.to)) {
    return fail({
      code: "ILLEGAL_STAGE_MOVE",
      from: move.from,
      to: move.to,
    });
  }
  if (quantities[move.from] < move.baseMinorUnits) {
    return fail({
      code: "INSUFFICIENT_STAGE_QUANTITY",
      stage: move.from,
      availableMinorUnits: quantities[move.from],
      requestedMinorUnits: move.baseMinorUnits,
    });
  }
  return ok(
    Object.freeze({
      ...quantities,
      [move.from]: quantities[move.from] - move.baseMinorUnits,
      [move.to]: quantities[move.to] + move.baseMinorUnits,
    }),
  );
}

export function checkFulfillmentConservation(
  orderedMinorUnits: number,
  quantities: FulfillmentQuantities,
): Result<true, ReservationError> {
  if (!validPositive(orderedMinorUnits)) {
    return fail({
      code: "INVALID_QUANTITY",
      field: "orderedMinorUnits",
      value: orderedMinorUnits,
    });
  }
  let accountedMinorUnits = 0;
  for (const stage of FULFILLMENT_STAGES) {
    const quantity = quantities[stage];
    if (!validNonNegative(quantity)) {
      return fail({
        code: "INVALID_QUANTITY",
        field: stage,
        value: quantity,
      });
    }
    accountedMinorUnits += quantity;
  }
  return accountedMinorUnits === orderedMinorUnits
    ? ok(true)
    : fail({
        code: "CONSERVATION_FAILED",
        orderedMinorUnits,
        accountedMinorUnits,
      });
}

export function deriveFulfillmentLineStatus(
  orderedMinorUnits: number,
  quantities: FulfillmentQuantities,
): Result<FulfillmentLineStatus, ReservationError> {
  const conserved = checkFulfillmentConservation(orderedMinorUnits, quantities);
  if (!conserved.ok) return conserved;
  if (quantities.CANCELLED === orderedMinorUnits) return ok("CANCELLED");
  if (quantities.RETURNED === orderedMinorUnits) return ok("RETURNED");
  if (quantities.DELIVERED === orderedMinorUnits) return ok("DELIVERED");
  if (quantities.DELIVERED > 0) return ok("PARTIALLY_DELIVERED");
  if (quantities.LOADED > 0) return ok("LOADED");
  if (quantities.ISSUED > 0) return ok("ISSUED");
  if (quantities.STAGED > 0) return ok("STAGED");
  if (quantities.PICKING > 0) return ok("PICKING");
  if (quantities.RESERVED > 0) return ok("RESERVED");
  if (quantities.BACKORDERED > 0) return ok("BACKORDERED");
  return ok("UNPLANNED");
}
