import { describe, expect, it } from "vitest";

import {
  DEFAULT_PUTAWAY_WEIGHTS,
  assertConfirmable,
  decideClaim,
  recommendPutaway,
  validateOverride,
  type PutawayCandidate,
  type PutawayDemand,
} from "./putawayScoring";

const bin = (
  overrides: Partial<PutawayCandidate> & { readonly code: string },
): PutawayCandidate => ({
  locationId: `loc_${overrides.code}`,
  locationType: "RACK_BIN",
  status: "ACTIVE",
  ...overrides,
});

const demand = (overrides: Partial<PutawayDemand> = {}): PutawayDemand => ({
  itemId: "item_1",
  minorUnits: 12_000,
  stockStatus: "AVAILABLE",
  ...overrides,
});

const rank = (
  candidates: readonly PutawayCandidate[],
  overrides: Partial<PutawayDemand> = {},
) => {
  const result = recommendPutaway({ demand: demand(overrides), candidates });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  return result.value;
};

describe("hard constraints", () => {
  it("removes an inactive location rather than ranking it last", () => {
    const result = rank([
      bin({ code: "A1" }),
      bin({ code: "B1", status: "INACTIVE", holdsSameItem: true }),
    ]);

    expect(result.ranked.map((entry) => entry.code)).toEqual(["A1"]);
    expect(result.rejected).toEqual([
      { locationId: "loc_B1", code: "B1", reason: "LOCATION_INACTIVE" },
    ]);
  });

  it("refuses a dock or a staging lane as a putaway target", () => {
    const result = rank([
      bin({ code: "A1" }),
      bin({ code: "DOCK-1", locationType: "DOCK" }),
      bin({ code: "STAGE-1", locationType: "STAGING" }),
    ]);

    expect(result.ranked.map((entry) => entry.code)).toEqual(["A1"]);
    expect(result.rejected.map((entry) => entry.reason)).toEqual([
      "LOCATION_TYPE_NOT_STORAGE",
      "LOCATION_TYPE_NOT_STORAGE",
    ]);
  });

  it("honours a tenant prohibition", () => {
    const result = rank([
      bin({ code: "A1" }),
      bin({ code: "B1", prohibited: true }),
    ]);
    expect(result.rejected[0]?.reason).toBe("LOCATION_PROHIBITED");
  });

  it("removes a bin too small for the pallet", () => {
    const result = rank([
      bin({ code: "A1", freeCapacityMinorUnits: 20_000 }),
      bin({ code: "B1", freeCapacityMinorUnits: 5_000 }),
    ]);

    expect(result.ranked.map((entry) => entry.code)).toEqual(["A1"]);
    expect(result.rejected[0]?.reason).toBe("INSUFFICIENT_CAPACITY");
  });

  it("treats unmodelled capacity as no obstacle", () => {
    const result = rank([bin({ code: "A1" })]);
    expect(result.ranked).toHaveLength(1);
  });

  it("treats an unclassified location as accepting anything", () => {
    const result = rank(
      [
        bin({ code: "A1" }),
        bin({ code: "B1", storageClassCodes: ["AMBIENT"] }),
        bin({ code: "C1", storageClassCodes: ["FLAMMABLE"] }),
      ],
      { requiredStorageClassCode: "FLAMMABLE" },
    );

    expect(result.ranked.map((entry) => entry.code).sort()).toEqual([
      "A1",
      "C1",
    ]);
    expect(result.rejected[0]?.reason).toBe("STORAGE_CLASS_INCOMPATIBLE");
  });

  it("says once, not per bin, that the stock may not be put away at all", () => {
    const result = rank([bin({ code: "A1" }), bin({ code: "B1" })], {
      stockStatus: "QC_HOLD",
    });

    expect(result.ranked).toHaveLength(0);
    expect(result.rejected.map((entry) => entry.reason)).toEqual([
      "STOCK_STATUS_NOT_PUTAWAYABLE",
      "STOCK_STATUS_NOT_PUTAWAYABLE",
    ]);
  });

  it("separates an empty warehouse from a fully filtered one", () => {
    const empty = recommendPutaway({ demand: demand(), candidates: [] });
    const filtered = recommendPutaway({
      demand: demand(),
      candidates: [bin({ code: "A1", status: "INACTIVE" })],
    });

    expect(!empty.ok && empty.error.code).toBe("NO_CANDIDATE_LOCATIONS");
    expect(!filtered.ok && filtered.error.code).toBe("ALL_CANDIDATES_FILTERED");
  });
});

describe("preference and scoring", () => {
  it("prefers the bin already holding this lot", () => {
    const result = rank(
      [
        bin({ code: "A1", travelDistance: 0 }),
        bin({
          code: "Z9",
          holdsSameLot: true,
          holdsSameItem: true,
          travelDistance: 90,
        }),
      ],
      { lotId: "lot_1" },
    );

    expect(result.ranked[0]?.code).toBe("Z9");
    expect(result.ranked[0]?.components.map((c) => c.name)).toContain(
      "SAME_LOT",
    );
  });

  it("ignores a same-lot claim when nothing is putting away a lot", () => {
    // An untracked item has no lot, so a bin cannot hold "the same" one.
    const result = rank([bin({ code: "A1", holdsSameLot: true })]);
    expect(result.ranked[0]?.components.map((c) => c.name)).not.toContain(
      "SAME_LOT",
    );
  });

  it("rewards the tightest bin that still fits, not the roomiest", () => {
    const result = rank([
      bin({ code: "ROOMY", freeCapacityMinorUnits: 120_000 }),
      bin({ code: "TIGHT", freeCapacityMinorUnits: 13_000 }),
    ]);

    expect(result.ranked[0]?.code).toBe("TIGHT");
  });

  it("prefers a shorter walk, all else equal", () => {
    const result = rank([
      bin({ code: "FAR", travelDistance: 95 }),
      bin({ code: "NEAR", travelDistance: 5 }),
    ]);
    expect(result.ranked[0]?.code).toBe("NEAR");
  });

  it("saturates travel so one distant bin cannot compress the rest into a tie", () => {
    const result = rank([
      bin({ code: "A1", travelDistance: 100 }),
      bin({ code: "B1", travelDistance: 5_000 }),
    ]);

    const [first, second] = result.ranked;
    expect(first?.code).toBe("A1");

    expect(first?.score).toBe(second?.score);
  });

  it("prefers a bin holding fewer distinct items", () => {
    const result = rank([
      bin({ code: "MIXED", distinctItemCount: 4 }),
      bin({ code: "CLEAN", distinctItemCount: 0 }),
    ]);
    expect(result.ranked[0]?.code).toBe("CLEAN");
  });

  it("records every component with the weight it was scored against", () => {
    // The trace has to read back as arithmetic, not as a number to be trusted.
    const result = rank(
      [bin({ code: "A1", holdsSameItem: true, isItemHome: true })],
      {},
    );

    const entry = result.ranked[0];
    expect(entry).toBeDefined();
    const total = (entry?.components ?? []).reduce(
      (sum, component) => sum + component.points,
      0,
    );
    expect(entry?.score).toBe(total);

    const sameItem = entry?.components.find((c) => c.name === "SAME_ITEM");
    expect(sameItem?.weight).toBe(DEFAULT_PUTAWAY_WEIGHTS.sameItem);
    expect(sameItem?.points).toBe(DEFAULT_PUTAWAY_WEIGHTS.sameItem);
  });

  it("names the filters it applied, in order", () => {
    const result = rank([bin({ code: "A1" })]);
    expect(result.filtersApplied[0]).toBe("STOCK_STATUS_PUTAWAYABLE");
    expect(result.filtersApplied).toContain("CAPACITY_SUFFICIENT");
  });

  it("marks an overflow location as such", () => {
    const result = rank([bin({ code: "OF1", locationType: "OVERFLOW" })]);
    expect(result.ranked[0]?.viaOverflow).toBe(true);
  });

  it("refuses a negative or fractional weight", () => {
    const result = recommendPutaway({
      demand: demand(),
      candidates: [bin({ code: "A1" })],
      weights: { ...DEFAULT_PUTAWAY_WEIGHTS, travel: -1 },
    });
    expect(!result.ok && result.error.code).toBe("WEIGHTS_INVALID");
  });
});

describe("determinism (INV-0007-10)", () => {
  it("does not depend on the order candidates arrive in", () => {
    const candidates = [
      bin({ code: "C3", travelDistance: 20 }),
      bin({ code: "A1", travelDistance: 20 }),
      bin({ code: "B2", travelDistance: 20 }),
    ];

    const forward = rank(candidates);
    const reversed = rank([...candidates].reverse());

    expect(forward.ranked.map((entry) => entry.code)).toEqual([
      "A1",
      "B2",
      "C3",
    ]);
    expect(reversed.ranked).toEqual(forward.ranked);
  });

  it("produces an identical result for identical inputs", () => {
    const candidates = [
      bin({ code: "A1", holdsSameItem: true, travelDistance: 12 }),
      bin({ code: "B2", freeCapacityMinorUnits: 15_000 }),
    ];
    expect(rank(candidates)).toEqual(rank(candidates));
  });
});

describe("validateOverride", () => {
  const recommendation = rank([
    bin({ code: "A1", holdsSameItem: true }),
    bin({ code: "B2" }),
    bin({ code: "DEAD", status: "INACTIVE" }),
  ]);

  it("accepts the top recommendation with no reason", () => {
    const record = validateOverride({
      recommendation,
      chosenLocationId: "loc_A1",
    });

    expect(record.ok && record.value.isOverride).toBe(false);
    expect(record.ok && record.value.recommendedLocationId).toBe("loc_A1");
  });

  it("requires a reason to take a runner-up", () => {
    const missing = validateOverride({
      recommendation,
      chosenLocationId: "loc_B2",
    });
    expect(!missing.ok && missing.error.code).toBe("REASON_REQUIRED");

    const given = validateOverride({
      recommendation,
      chosenLocationId: "loc_B2",
      reasonCodeId: "reason_1",
    });
    expect(given.ok && given.value.isOverride).toBe(true);
    expect(given.ok && given.value.recommendedLocationId).toBe("loc_A1");
  });

  it("refuses a location a hard constraint rejected, reason or not", () => {
    const result = validateOverride({
      recommendation,
      chosenLocationId: "loc_DEAD",
      reasonCodeId: "reason_1",
    });

    expect(!result.ok && result.error.code).toBe(
      "LOCATION_FAILS_HARD_CONSTRAINT",
    );
    expect(!result.ok && "reason" in result.error && result.error.reason).toBe(
      "LOCATION_INACTIVE",
    );
  });

  it("separates a stale recommendation from a blocked location", () => {
    const result = validateOverride({
      recommendation,
      chosenLocationId: "loc_NEVER_SEEN",
      reasonCodeId: "reason_1",
    });
    expect(!result.ok && result.error.code).toBe("LOCATION_NOT_CONSIDERED");
  });
});

describe("task claiming (INV-0007-11)", () => {
  it("lets one actor claim a ready task", () => {
    const claim = decideClaim({ status: "READY", actorUserId: "user_a" });
    expect(claim.ok && claim.value.alreadyHeld).toBe(false);
  });

  it("refuses a task another actor holds", () => {
    const claim = decideClaim({
      status: "CLAIMED",
      claimedByUserId: "user_a",
      actorUserId: "user_b",
    });
    expect(!claim.ok && claim.error.code).toBe("TASK_CLAIMED_BY_ANOTHER");
  });

  it("lets an actor re-claim their own task", () => {
    const claim = decideClaim({
      status: "CLAIMED",
      claimedByUserId: "user_a",
      actorUserId: "user_a",
    });
    expect(claim.ok && claim.value.alreadyHeld).toBe(true);
  });

  it("refuses to claim a finished or cancelled task", () => {
    for (const status of ["CONFIRMED", "CANCELLED"] as const) {
      const claim = decideClaim({ status, actorUserId: "user_a" });
      expect(!claim.ok && claim.error.code, status).toBe("TASK_NOT_CLAIMABLE");
    }
  });

  it("lets only the holder confirm", () => {
    expect(
      assertConfirmable({
        status: "CLAIMED",
        claimedByUserId: "user_a",
        actorUserId: "user_a",
      }).ok,
    ).toBe(true);

    const other = assertConfirmable({
      status: "CLAIMED",
      claimedByUserId: "user_a",
      actorUserId: "user_b",
    });
    expect(!other.ok && other.error.code).toBe("TASK_NOT_CLAIMED_BY_ACTOR");
  });

  it("refuses to confirm a task nobody claimed", () => {
    const result = assertConfirmable({
      status: "READY",
      actorUserId: "user_a",
    });
    expect(!result.ok && result.error.code).toBe("TASK_NOT_CLAIMABLE");
  });
});
