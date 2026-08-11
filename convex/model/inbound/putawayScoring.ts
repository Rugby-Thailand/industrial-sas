/**
 * Where to put it, and why — deterministic and explainable.
 *
 * `ADR-0007` §12–14 asks for three things that pull against each other, and the
 * shape of this module is the resolution:
 *
 * 1. **Hard constraints filter first.** A location that fails one is not a
 *    low-scoring candidate; it is not a candidate. Scoring an incompatible bin
 *    down to last place would let a high enough preference score float it back up.
 * 2. **Preference, then score.** Preference is about *this* stock (the same item
 *    is already there, this is its home); score is about the warehouse (capacity,
 *    travel, fragmentation). Mixing them into one number makes "why this bin?"
 *    unanswerable.
 * 3. **Every answer explains itself.** The result carries the filters that were
 *    applied, why each rejected location was rejected, and each score component
 *    with its weight — so an operator or an auditor can read the recommendation
 *    rather than trust it (`INV-0007-09`, D-14).
 *
 * ### Determinism is a tested property, not an aspiration
 *
 * `INV-0007-10`: identical inputs yield an identical ordered list. That means no
 * clock, no randomness, no `Map` iteration order dependence, and — the one that
 * actually bites — **a total order**. Two locations with the same score are
 * broken apart by location code, which is unique per warehouse by contract, so
 * the sort can never depend on the order the caller happened to pass candidates
 * in. Without that tiebreak the same inputs would rank differently depending on
 * how the database returned rows.
 *
 * No clock, no database, no Convex import (plan §6.2).
 */
import { fail, ok, type Result } from "../result";

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

export type PutawayError =
  | { readonly code: "NO_CANDIDATE_LOCATIONS" }
  | { readonly code: "ALL_CANDIDATES_FILTERED"; readonly considered: number }
  | { readonly code: "QUANTITY_INVALID"; readonly field: string }
  | { readonly code: "CANDIDATE_INVALID"; readonly field: string }
  | { readonly code: "WEIGHTS_INVALID"; readonly field: string };

/* -------------------------------------------------------------------------- */
/* Inputs                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A location as the recommender sees it.
 *
 * Deliberately flat and dumb: every field is a fact the caller read from a row,
 * and nothing here is derived. A candidate that carried, say, a pre-computed
 * "suitability" would move the decision out of this module and out of the test
 * suite that proves it deterministic.
 */
export interface PutawayCandidate {
  readonly locationId: string;
  /** Unique per warehouse by contract; the deterministic tiebreak. */
  readonly code: string;
  readonly locationType: string;
  readonly status: string;
  /** Free capacity in the item's base minor units. `undefined` means unmodelled. */
  readonly freeCapacityMinorUnits?: number | undefined;
  /** Storage classes this location accepts. Empty means it accepts anything. */
  readonly storageClassCodes?: readonly string[] | undefined;
  /** Distance from the dock in whatever unit the tenant measures travel in. */
  readonly travelDistance?: number | undefined;
  /** How many distinct items already sit here. Drives the fragmentation term. */
  readonly distinctItemCount?: number | undefined;
  /** True when this location already holds the item being put away. */
  readonly holdsSameItem?: boolean | undefined;
  /** True when it already holds this exact lot. */
  readonly holdsSameLot?: boolean | undefined;
  /** True when the item's configured home is this location. */
  readonly isItemHome?: boolean | undefined;
  /** True when the location sits in the item's preferred zone. */
  readonly isPreferredZone?: boolean | undefined;
  /** Tenant rule: this location may never receive putaway. */
  readonly prohibited?: boolean | undefined;
}

/** What is being put away. */
export interface PutawayDemand {
  readonly itemId: string;
  readonly lotId?: string | undefined;
  readonly minorUnits: number;
  /** The storage class the item requires, when the tenant configured one. */
  readonly requiredStorageClassCode?: string | undefined;
  /** Stock in this status may not be put away to a normal bin (`INV-0007-05`). */
  readonly stockStatus: string;
}

/**
 * The location types putaway may target.
 *
 * A dock and a staging lane are working surfaces: stock left there is stock that
 * has not been put away, and recommending one would let the task be "completed"
 * without the pallet moving. `OVERFLOW` is included because it is the fallback
 * the policy explicitly wants (D-14).
 */
export const PUTAWAY_TARGET_TYPES: readonly string[] = Object.freeze([
  "RACK_BIN",
  "FLOOR_BLOCK",
  "OVERFLOW",
]);

/**
 * Statuses whose stock must not reach a normal storage bin.
 *
 * `QC_HOLD` is the one `INV-0007-05` names: held stock putaway to an available
 * bucket would be released without a disposition, which is the bypass the whole
 * QC design exists to prevent. `QUARANTINE` and `REJECTED` are here for the same
 * reason — a quarantine bin is a location decision the tenant configures, and
 * until they have, the honest answer is "no recommendation" rather than a normal
 * rack.
 */
export const NON_PUTAWAYABLE_STATUSES: readonly string[] = Object.freeze([
  "QC_HOLD",
  "QUARANTINE",
  "REJECTED",
  "SCRAP",
  "EXPIRED",
]);

/**
 * Score weights, as whole numbers.
 *
 * Integers rather than fractions so the total is exact and two runs cannot
 * disagree in the last bit. The defaults say: filling a bin that already holds
 * this lot beats a shorter walk, and a shorter walk beats a tidier warehouse.
 */
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

/* -------------------------------------------------------------------------- */
/* Outputs                                                                     */
/* -------------------------------------------------------------------------- */

/** Why a location was removed from consideration. */
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

/** One named contribution to a candidate's score. */
export interface ScoreComponent {
  readonly name: string;
  /** The weight this component was scored against. */
  readonly weight: number;
  /** The contribution, already multiplied out. Always an integer. */
  readonly points: number;
}

export interface ScoredLocation {
  readonly locationId: string;
  readonly code: string;
  readonly score: number;
  readonly components: readonly ScoreComponent[];
  /** True when this location was reached through the overflow fallback. */
  readonly viaOverflow: boolean;
}

export interface PutawayRecommendation {
  /** Best first. Deterministic: score descending, then location code ascending. */
  readonly ranked: readonly ScoredLocation[];
  /** Every location that was considered and removed, with its reason. */
  readonly rejected: readonly PutawayRejection[];
  /** The filters that ran, in order, so the trace states what was applied. */
  readonly filtersApplied: readonly string[];
  readonly weights: PutawayWeights;
}

/* -------------------------------------------------------------------------- */
/* Recommendation                                                              */
/* -------------------------------------------------------------------------- */

const FILTER_ORDER: readonly string[] = Object.freeze([
  "STOCK_STATUS_PUTAWAYABLE",
  "LOCATION_ACTIVE",
  "LOCATION_TYPE_IS_STORAGE",
  "NOT_PROHIBITED",
  "STORAGE_CLASS_COMPATIBLE",
  "CAPACITY_SUFFICIENT",
]);

const isCount = (value: number): boolean => Number.isSafeInteger(value);

/**
 * Rank the locations a pallet may go to.
 *
 * Returns a *list*, not a winner. The handheld shows the top candidate and the
 * runners-up, because the recommendation is advice: an operator who can see the
 * second choice can take it without an override, and one who can only see the
 * first has to fight the system to do the obvious thing.
 *
 * `ALL_CANDIDATES_FILTERED` is a distinct refusal from `NO_CANDIDATE_LOCATIONS`.
 * "The warehouse has no bins" and "every bin was ruled out" send a supervisor to
 * completely different screens.
 */
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

  /*
   * The stock-status filter is not per-location and runs first: if the stock may
   * not be put away at all, every location fails for the same reason, and saying
   * so once is the honest explanation. Reporting it per bin would bury one fact
   * under a hundred rows.
   */
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

  /*
   * The total order. Score descending, then code ascending — never the caller's
   * order, which is whatever the database returned and is not a property of the
   * warehouse (`INV-0007-10`).
   */
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

/** The first hard constraint this location fails, or `undefined` if it passes. */
function hardFilterReason(
  candidate: PutawayCandidate,
  demand: PutawayDemand,
): PutawayFilterReason | undefined {
  if (candidate.status !== "ACTIVE") return "LOCATION_INACTIVE";
  if (!PUTAWAY_TARGET_TYPES.includes(candidate.locationType)) {
    return "LOCATION_TYPE_NOT_STORAGE";
  }
  if (candidate.prohibited === true) return "LOCATION_PROHIBITED";

  /*
   * An empty or absent storage-class list means "accepts anything", not "accepts
   * nothing". The opposite reading would make every location incompatible until
   * a tenant had classified all of them, which is the state every new tenant is
   * in.
   */
  const required = demand.requiredStorageClassCode;
  if (required !== undefined && required.length > 0) {
    const accepted = candidate.storageClassCodes ?? [];
    if (accepted.length > 0 && !accepted.includes(required)) {
      return "STORAGE_CLASS_INCOMPATIBLE";
    }
  }

  // Unmodelled capacity does not block: a tenant that has not measured its bins
  // still needs recommendations, and a guess would be worse than the omission.
  const free = candidate.freeCapacityMinorUnits;
  if (free !== undefined && free < demand.minorUnits) {
    return "INSUFFICIENT_CAPACITY";
  }
  return undefined;
}

/**
 * Score one surviving candidate.
 *
 * Every component is an integer contribution with its weight recorded, so the
 * stored trace can be read back as arithmetic rather than as a number somebody
 * has to take on faith.
 */
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

  // Preference: facts about this stock.
  if (candidate.holdsSameLot === true && demand.lotId !== undefined) {
    add("SAME_LOT", weights.sameLot, 1);
  }
  if (candidate.holdsSameItem === true) add("SAME_ITEM", weights.sameItem, 1);
  if (candidate.isItemHome === true) add("HOME_LOCATION", weights.home, 1);
  if (candidate.isPreferredZone === true) {
    add("PREFERRED_ZONE", weights.preferredZone, 1);
  }

  /*
   * Capacity fit rewards the *tightest* bin that still fits, on a 0–10 integer
   * scale. Filling a bin that barely holds the pallet leaves the roomy bins for
   * pallets that need them; rewarding the roomiest instead would scatter stock
   * across the warehouse and is the classic wrong version of this term.
   */
  const free = candidate.freeCapacityMinorUnits;
  if (free !== undefined && free > 0) {
    const fit = Math.min(10, Math.floor((demand.minorUnits * 10) / free));
    add("CAPACITY_FIT", weights.capacityFit, fit);
  }

  /*
   * Travel is scored as closeness on a 0–10 integer scale, saturating at 100
   * distance units. Saturating rather than scaling by the warehouse's longest
   * aisle keeps two tenants' scores comparable and keeps one distant location
   * from compressing every other candidate into a tie.
   */
  const distance = candidate.travelDistance;
  if (distance !== undefined && distance >= 0) {
    const closeness = Math.max(
      0,
      10 - Math.floor(Math.min(distance, 100) / 10),
    );
    add("TRAVEL", weights.travel, closeness);
  }

  // Fragmentation: prefer bins that already hold few distinct items.
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

/* -------------------------------------------------------------------------- */
/* Override                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * What an override has to record (`INV-0007-09`).
 *
 * All four facts, together. The recommended location alone does not say what the
 * operator did; the chosen location alone does not say what the system advised;
 * and without a reason the analytics D-14 asks for is a count with no content.
 */
export interface OverrideRecord {
  readonly recommendedLocationId: string | undefined;
  readonly chosenLocationId: string;
  readonly reasonCodeId: string;
  /** True when the chosen location was not the top recommendation. */
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

/**
 * Validate a chosen location against the recommendation that produced it.
 *
 * An override may pick any location the recommender *ranked*, including the last
 * one — that is the operator's judgement and the system's job is to record it.
 * It may **not** pick a location a hard constraint rejected (`INV-0007-08`): the
 * constraints are compatibility, prohibition, and capacity, and none of them is
 * a preference an operator is entitled to overrule from a handheld.
 *
 * A location that was never considered is refused separately. It usually means
 * the recommendation is stale — the operator is looking at an answer computed
 * before a bin was deactivated — and re-running it is the fix.
 */
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

/* -------------------------------------------------------------------------- */
/* Task claiming                                                               */
/* -------------------------------------------------------------------------- */

export type PutawayTaskStatus = "READY" | "CLAIMED" | "CONFIRMED" | "CANCELLED";

export type ClaimError =
  | { readonly code: "TASK_NOT_CLAIMABLE"; readonly status: string }
  | { readonly code: "TASK_CLAIMED_BY_ANOTHER" }
  | { readonly code: "TASK_NOT_CLAIMED_BY_ACTOR" };

/**
 * Decide a compare-and-set claim (`INV-0007-11`).
 *
 * The comparison is on the *observed* state, so the caller re-reads the row
 * inside its transaction and hands what it saw to this function. Two operators
 * pressing at once therefore resolve on the write, not on a read that both of
 * them passed.
 *
 * Re-claiming a task you already hold succeeds and is not an error: an operator
 * whose screen reconnected should not be told they lost their own task.
 */
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

/** Whether this actor may confirm this task. */
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
