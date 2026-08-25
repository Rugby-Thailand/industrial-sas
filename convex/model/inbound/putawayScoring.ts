import { fail, ok, type Result } from "../result";

export type PutawayError =
  | { readonly code: "NO_CANDIDATE_LOCATIONS" }
  | { readonly code: "ALL_CANDIDATES_FILTERED"; readonly considered: number }
  | { readonly code: "QUANTITY_INVALID"; readonly field: string }
  | { readonly code: "CANDIDATE_INVALID"; readonly field: string }
  | { readonly code: "WEIGHTS_INVALID"; readonly field: string };

export interface PutawayCandidate {
  readonly locationId: string;

  readonly code: string;
  readonly locationType: string;
  readonly status: string;

  readonly freeCapacityMinorUnits?: number | undefined;

  readonly storageClassCodes?: readonly string[] | undefined;

  readonly travelDistance?: number | undefined;

  readonly distinctItemCount?: number | undefined;

  readonly holdsSameItem?: boolean | undefined;

  readonly holdsSameLot?: boolean | undefined;

  readonly isItemHome?: boolean | undefined;

  readonly isPreferredZone?: boolean | undefined;

  readonly prohibited?: boolean | undefined;
}

export interface PutawayDemand {
  readonly itemId: string;
  readonly lotId?: string | undefined;
  readonly minorUnits: number;

  readonly requiredStorageClassCode?: string | undefined;

  readonly stockStatus: string;
}

export const PUTAWAY_TARGET_TYPES: readonly string[] = Object.freeze([
  "RACK_BIN",
  "FLOOR_BLOCK",
  "OVERFLOW",
]);

export const NON_PUTAWAYABLE_STATUSES: readonly string[] = Object.freeze([
  "QC_HOLD",
  "QUARANTINE",
  "REJECTED",
  "SCRAP",
  "EXPIRED",
]);

export interface PutawayWeights {
  readonly sameLot: number;
  readonly sameItem: number;
  readonly home: number;
  readonly preferredZone: number;
  readonly capacityFit: number;
  readonly travel: number;
  readonly fragmentation: number;
}

export const DEFAULT_PUTAWAY_WEIGHTS: PutawayWeights = Object.freeze({
  sameLot: 500,
  sameItem: 300,
  home: 250,
  preferredZone: 120,
  capacityFit: 100,
  travel: 80,
  fragmentation: 40,
});

export type PutawayFilterReason =
  | "LOCATION_INACTIVE"
  | "LOCATION_TYPE_NOT_STORAGE"
  | "LOCATION_PROHIBITED"
  | "STORAGE_CLASS_INCOMPATIBLE"
  | "INSUFFICIENT_CAPACITY"
  | "STOCK_STATUS_NOT_PUTAWAYABLE";

export interface PutawayRejection {
  readonly locationId: string;
  readonly code: string;
  readonly reason: PutawayFilterReason;
}

export interface ScoreComponent {
  readonly name: string;

  readonly weight: number;

  readonly points: number;
}

export interface ScoredLocation {
  readonly locationId: string;
  readonly code: string;
  readonly score: number;
  readonly components: readonly ScoreComponent[];

  readonly viaOverflow: boolean;
}

export interface PutawayRecommendation {
  readonly ranked: readonly ScoredLocation[];

  readonly rejected: readonly PutawayRejection[];
  /** The filters that ran, in order, so the trace states what was applied. */
  readonly filtersApplied: readonly string[];
  readonly weights: PutawayWeights;
}

const FILTER_ORDER: readonly string[] = Object.freeze([
  "STOCK_STATUS_PUTAWAYABLE",
  "LOCATION_ACTIVE",
  "LOCATION_TYPE_IS_STORAGE",
  "NOT_PROHIBITED",
  "STORAGE_CLASS_COMPATIBLE",
  "CAPACITY_SUFFICIENT",
]);

const isCount = (value: number): boolean => Number.isSafeInteger(value);

export function recommendPutaway(input: {
  readonly demand: PutawayDemand;
  readonly candidates: readonly PutawayCandidate[];
  readonly weights?: PutawayWeights | undefined;
}): Result<PutawayRecommendation, PutawayError> {
  const weights = input.weights ?? DEFAULT_PUTAWAY_WEIGHTS;
  for (const [name, value] of Object.entries(weights)) {
    if (!isCount(value) || value < 0) {
      return fail({ code: "WEIGHTS_INVALID", field: name });
    }
  }

  const { demand } = input;
  if (!isCount(demand.minorUnits) || demand.minorUnits <= 0) {
    return fail({ code: "QUANTITY_INVALID", field: "minorUnits" });
  }
  if (input.candidates.length === 0) {
    return fail({ code: "NO_CANDIDATE_LOCATIONS" });
  }

  const rejected: PutawayRejection[] = [];

  if (NON_PUTAWAYABLE_STATUSES.includes(demand.stockStatus)) {
    return ok(
      Object.freeze({
        ranked: [],
        rejected: Object.freeze(
          input.candidates.map((candidate) => ({
            locationId: candidate.locationId,
            code: candidate.code,
            reason: "STOCK_STATUS_NOT_PUTAWAYABLE" as const,
          })),
        ),
        filtersApplied: FILTER_ORDER,
        weights,
      }),
    );
  }

  const survivors: PutawayCandidate[] = [];

  for (const candidate of input.candidates) {
    if (candidate.code.trim().length === 0) {
      return fail({ code: "CANDIDATE_INVALID", field: "code" });
    }

    const reason = hardFilterReason(candidate, demand);
    if (reason === undefined) {
      survivors.push(candidate);
    } else {
      rejected.push({
        locationId: candidate.locationId,
        code: candidate.code,
        reason,
      });
    }
  }

  if (survivors.length === 0) {
    return fail({
      code: "ALL_CANDIDATES_FILTERED",
      considered: input.candidates.length,
    });
  }

  const scored = survivors.map((candidate) =>
    scoreCandidate(candidate, demand, weights),
  );

  const ranked = [...scored].sort((left, right) =>
    left.score === right.score
      ? left.code.localeCompare(right.code, "en")
      : right.score - left.score,
  );

  return ok(
    Object.freeze({
      ranked: Object.freeze(ranked),
      rejected: Object.freeze(rejected),
      filtersApplied: FILTER_ORDER,
      weights,
    }),
  );
}

function hardFilterReason(
  candidate: PutawayCandidate,
  demand: PutawayDemand,
): PutawayFilterReason | undefined {
  if (candidate.status !== "ACTIVE") return "LOCATION_INACTIVE";
  if (!PUTAWAY_TARGET_TYPES.includes(candidate.locationType)) {
    return "LOCATION_TYPE_NOT_STORAGE";
  }
  if (candidate.prohibited === true) return "LOCATION_PROHIBITED";

  const required = demand.requiredStorageClassCode;
  if (required !== undefined && required.length > 0) {
    const accepted = candidate.storageClassCodes ?? [];
    if (accepted.length > 0 && !accepted.includes(required)) {
      return "STORAGE_CLASS_INCOMPATIBLE";
    }
  }

  const free = candidate.freeCapacityMinorUnits;
  if (free !== undefined && free < demand.minorUnits) {
    return "INSUFFICIENT_CAPACITY";
  }
  return undefined;
}

function scoreCandidate(
  candidate: PutawayCandidate,
  demand: PutawayDemand,
  weights: PutawayWeights,
): ScoredLocation {
  const components: ScoreComponent[] = [];

  const add = (name: string, weight: number, multiplier: number) => {
    if (weight === 0 || multiplier === 0) return;
    components.push({ name, weight, points: weight * multiplier });
  };

  if (candidate.holdsSameLot === true && demand.lotId !== undefined) {
    add("SAME_LOT", weights.sameLot, 1);
  }
  if (candidate.holdsSameItem === true) add("SAME_ITEM", weights.sameItem, 1);
  if (candidate.isItemHome === true) add("HOME_LOCATION", weights.home, 1);
  if (candidate.isPreferredZone === true) {
    add("PREFERRED_ZONE", weights.preferredZone, 1);
  }

  const free = candidate.freeCapacityMinorUnits;
  if (free !== undefined && free > 0) {
    const fit = Math.min(10, Math.floor((demand.minorUnits * 10) / free));
    add("CAPACITY_FIT", weights.capacityFit, fit);
  }

  const distance = candidate.travelDistance;
  if (distance !== undefined && distance >= 0) {
    const closeness = Math.max(
      0,
      10 - Math.floor(Math.min(distance, 100) / 10),
    );
    add("TRAVEL", weights.travel, closeness);
  }

  const distinct = candidate.distinctItemCount;
  if (distinct !== undefined && distinct >= 0) {
    add("FRAGMENTATION", weights.fragmentation, Math.max(0, 5 - distinct));
  }

  const score = components.reduce(
    (total, component) => total + component.points,
    0,
  );

  return Object.freeze({
    locationId: candidate.locationId,
    code: candidate.code,
    score,
    components: Object.freeze(components),
    viaOverflow: candidate.locationType === "OVERFLOW",
  });
}

export interface OverrideRecord {
  readonly recommendedLocationId: string | undefined;
  readonly chosenLocationId: string;
  readonly reasonCodeId: string;

  readonly isOverride: boolean;
}

export interface OverrideInput {
  readonly recommendation: PutawayRecommendation;
  readonly chosenLocationId: string;
  readonly reasonCodeId?: string | undefined;
}

export type OverrideError =
  | { readonly code: "REASON_REQUIRED"; readonly field: string }
  | {
      readonly code: "LOCATION_FAILS_HARD_CONSTRAINT";
      readonly reason: PutawayFilterReason;
    }
  | { readonly code: "LOCATION_NOT_CONSIDERED" };

export function validateOverride(
  input: OverrideInput,
): Result<OverrideRecord, OverrideError> {
  const top = input.recommendation.ranked[0];
  const chosen = input.recommendation.ranked.find(
    (candidate) => candidate.locationId === input.chosenLocationId,
  );

  if (chosen === undefined) {
    const blocked = input.recommendation.rejected.find(
      (rejection) => rejection.locationId === input.chosenLocationId,
    );
    if (blocked !== undefined) {
      return fail({
        code: "LOCATION_FAILS_HARD_CONSTRAINT",
        reason: blocked.reason,
      });
    }
    return fail({ code: "LOCATION_NOT_CONSIDERED" });
  }

  const isOverride =
    top !== undefined && top.locationId !== input.chosenLocationId;

  const reasonCodeId = (input.reasonCodeId ?? "").trim();
  if (isOverride && reasonCodeId.length === 0) {
    return fail({ code: "REASON_REQUIRED", field: "reasonCodeId" });
  }

  return ok(
    Object.freeze({
      recommendedLocationId: top?.locationId,
      chosenLocationId: input.chosenLocationId,
      reasonCodeId,
      isOverride,
    }),
  );
}

export type PutawayTaskStatus = "READY" | "CLAIMED" | "CONFIRMED" | "CANCELLED";

export type ClaimError =
  | { readonly code: "TASK_NOT_CLAIMABLE"; readonly status: string }
  | { readonly code: "TASK_CLAIMED_BY_ANOTHER" }
  | { readonly code: "TASK_NOT_CLAIMED_BY_ACTOR" };

export function decideClaim(input: {
  readonly status: PutawayTaskStatus;
  readonly claimedByUserId?: string | undefined;
  readonly actorUserId: string;
}): Result<{ readonly alreadyHeld: boolean }, ClaimError> {
  if (input.status === "READY") {
    return ok(Object.freeze({ alreadyHeld: false }));
  }
  if (input.status !== "CLAIMED") {
    return fail({ code: "TASK_NOT_CLAIMABLE", status: input.status });
  }
  return input.claimedByUserId === input.actorUserId
    ? ok(Object.freeze({ alreadyHeld: true }))
    : fail({ code: "TASK_CLAIMED_BY_ANOTHER" });
}

export function assertConfirmable(input: {
  readonly status: PutawayTaskStatus;
  readonly claimedByUserId?: string | undefined;
  readonly actorUserId: string;
}): Result<true, ClaimError> {
  if (input.status !== "CLAIMED") {
    return fail({ code: "TASK_NOT_CLAIMABLE", status: input.status });
  }
  return input.claimedByUserId === input.actorUserId
    ? ok(true)
    : fail({ code: "TASK_NOT_CLAIMED_BY_ACTOR" });
}
