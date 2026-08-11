import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  NO_TOLERANCE,
  assessReceipt,
  makeTolerance,
  statusAfterReceipt,
} from "../../convex/model/inbound/receiptPolicy";
import {
  DEFAULT_PUTAWAY_WEIGHTS,
  recommendPutaway,
  type PutawayCandidate,
} from "../../convex/model/inbound/putawayScoring";
import { planSample } from "../../convex/model/inbound/qcPolicy";
import { previewImport, takeChunk } from "../../convex/model/inbound/poImport";

/**
 * The inbound invariants, over generated input.
 *
 * Three of these are the ADR's own claims restated as properties a machine can
 * falsify: tolerance never admits more than the fraction allows (`INV-0007-02`),
 * putaway is deterministic (`INV-0007-10`), and a chunked import visits every
 * accepted row exactly once (`INV-0007-12`).
 */
describe("receipt tolerance (INV-0007-02)", () => {
  it("never admits more than the exact fraction allows", () => {
    /*
     * The floor is what makes this hold at every quantity. Rounding up would let
     * a tolerance admit more than the tenant configured, by a different amount
     * at every order size.
     */
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 99 }),
        (ordered, percent) => {
          const tolerance = makeTolerance(percent, 100);
          expect(tolerance.ok).toBe(true);
          if (!tolerance.ok) return;

          const assessment = assessReceipt({
            orderedMinorUnits: ordered,
            alreadyReceivedMinorUnits: 0,
            incomingMinorUnits: ordered,
            tolerance: tolerance.value,
          });
          expect(assessment.ok).toBe(true);
          if (!assessment.ok) return;

          const allowance = assessment.value.allowanceMinorUnits;
          // The allowance never exceeds the exact real-valued limit.
          expect(allowance * 100).toBeLessThanOrEqual(
            ordered * (100 + percent),
          );
          expect(allowance).toBeGreaterThanOrEqual(ordered);
        },
      ),
      { seed: 20260811, numRuns: 300 },
    );
  });

  it("needs an approval exactly when the total passes the allowance", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_000, max: 100_000 }),
        fc.integer({ min: 1, max: 200_000 }),
        (ordered, incoming) => {
          const assessment = assessReceipt({
            orderedMinorUnits: ordered,
            alreadyReceivedMinorUnits: 0,
            incomingMinorUnits: incoming,
            tolerance: NO_TOLERANCE,
          });
          expect(assessment.ok).toBe(true);
          if (!assessment.ok) return;

          expect(assessment.value.requiresApproval).toBe(
            incoming > assessment.value.allowanceMinorUnits,
          );
        },
      ),
      { seed: 20260811, numRuns: 300 },
    );
  });

  it("keeps the running total consistent with what it classified", () => {
    // Whatever the classification, the arithmetic has to add up: the total after
    // is what was already there plus what arrived, and remaining plus over is
    // the distance from the ordered quantity.
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        (ordered, already, incoming) => {
          const assessment = assessReceipt({
            orderedMinorUnits: ordered,
            alreadyReceivedMinorUnits: already,
            incomingMinorUnits: incoming,
            tolerance: NO_TOLERANCE,
          });
          expect(assessment.ok).toBe(true);
          if (!assessment.ok) return;

          const total = assessment.value.totalAfterMinorUnits;
          expect(total).toBe(already + incoming);
          expect(
            assessment.value.remainingMinorUnits -
              assessment.value.overByMinorUnits,
          ).toBe(ordered - total);

          // A line that has met its quantity is never left open.
          expect(statusAfterReceipt(assessment.value)).toBe(
            total < ordered ? "OPEN" : "COMPLETE",
          );
        },
      ),
      { seed: 20260811, numRuns: 400 },
    );
  });
});

describe("putaway determinism (INV-0007-10)", () => {
  const candidate = (code: string, seed: number): PutawayCandidate => ({
    locationId: `loc_${code}`,
    code,
    locationType: seed % 3 === 0 ? "FLOOR_BLOCK" : "RACK_BIN",
    status: "ACTIVE",
    travelDistance: seed % 100,
    distinctItemCount: seed % 5,
  });

  it("ranks identically however the candidates are ordered", () => {
    /*
     * The property that makes the recommendation reviewable. Without a total
     * order the same warehouse would rank differently depending on how the
     * database happened to return rows.
     */
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.stringMatching(/^[A-Z]{2}-[0-9]{2}$/), {
          minLength: 2,
          maxLength: 12,
        }),
        fc.array(fc.integer({ min: 0, max: 500 }), {
          minLength: 12,
          maxLength: 12,
        }),
        (codes, seeds) => {
          const candidates = codes.map((code, index) =>
            candidate(code, seeds[index] ?? index),
          );
          const demand = {
            itemId: "item_1",
            minorUnits: 1_000,
            stockStatus: "AVAILABLE",
          };

          const forward = recommendPutaway({ demand, candidates });
          const reversed = recommendPutaway({
            demand,
            candidates: [...candidates].reverse(),
          });

          expect(forward.ok && reversed.ok).toBe(true);
          if (!forward.ok || !reversed.ok) return;
          expect(reversed.value.ranked).toEqual(forward.value.ranked);
        },
      ),
      { seed: 20260811, numRuns: 200 },
    );
  });

  it("never ranks a location a hard filter rejected", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.stringMatching(/^[A-Z]{2}-[0-9]{2}$/), {
          minLength: 1,
          maxLength: 10,
        }),
        fc.array(fc.boolean(), { minLength: 10, maxLength: 10 }),
        (codes, prohibitions) => {
          const candidates = codes.map((code, index) => ({
            ...candidate(code, index),
            prohibited: prohibitions[index] ?? false,
          }));

          const result = recommendPutaway({
            demand: {
              itemId: "item_1",
              minorUnits: 1_000,
              stockStatus: "AVAILABLE",
            },
            candidates,
          });
          if (!result.ok) return;

          const rankedIds = new Set(
            result.value.ranked.map((entry) => entry.locationId),
          );
          for (const rejection of result.value.rejected) {
            expect(rankedIds.has(rejection.locationId)).toBe(false);
          }
        },
      ),
      { seed: 20260811, numRuns: 200 },
    );
  });

  it("scores every candidate as the sum of its own components", () => {
    // The trace has to read back as arithmetic rather than as a number to be
    // taken on faith (D-14).
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500 }),
        fc.boolean(),
        fc.boolean(),
        (distance, sameItem, home) => {
          const result = recommendPutaway({
            demand: {
              itemId: "item_1",
              minorUnits: 1_000,
              stockStatus: "AVAILABLE",
            },
            candidates: [
              {
                locationId: "loc_A",
                code: "A-01",
                locationType: "RACK_BIN",
                status: "ACTIVE",
                travelDistance: distance,
                holdsSameItem: sameItem,
                isItemHome: home,
              },
            ],
            weights: DEFAULT_PUTAWAY_WEIGHTS,
          });
          expect(result.ok).toBe(true);
          if (!result.ok) return;

          const entry = result.value.ranked[0];
          expect(entry).toBeDefined();
          expect(entry?.score).toBe(
            (entry?.components ?? []).reduce(
              (sum, component) => sum + component.points,
              0,
            ),
          );
        },
      ),
      { seed: 20260811, numRuns: 200 },
    );
  });
});

describe("sampling plans", () => {
  it("never inspects zero, and never more than the delivery", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 1, max: 100 }),
        fc.constantFrom("FIXED" as const, "PERCENT" as const),
        (lotSize, parameter, strategy) => {
          const plan = planSample({ strategy, parameter, lotSize });
          expect(plan.ok).toBe(true);
          if (!plan.ok) return;

          expect(plan.value.sampleSize).toBeGreaterThanOrEqual(1);
          expect(plan.value.sampleSize).toBeLessThanOrEqual(lotSize);
        },
      ),
      { seed: 20260811, numRuns: 300 },
    );
  });

  it("never plans a smaller percentage sample than the fraction asks for", () => {
    // Rounding down would quietly weaken every plan on an odd lot size.
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000 }),
        fc.integer({ min: 1, max: 100 }),
        (lotSize, percent) => {
          const plan = planSample({
            strategy: "PERCENT",
            parameter: percent,
            lotSize,
          });
          if (!plan.ok) return;
          expect(plan.value.sampleSize * 100).toBeGreaterThanOrEqual(
            lotSize * percent,
          );
        },
      ),
      { seed: 20260811, numRuns: 300 },
    );
  });
});

describe("chunked import (INV-0007-12)", () => {
  it("visits every accepted row exactly once, at any chunk size", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 120 }),
        fc.integer({ min: 1, max: 50 }),
        (rowCount, chunkSize) => {
          const text = [
            "line_number,sku,quantity,uom",
            ...Array.from(
              { length: rowCount },
              (_, index) => `${index + 1},SKU-${index},1,EA`,
            ),
          ].join("\n");

          const preview = previewImport({ batchRef: "BATCH-1", text });
          expect(preview.ok).toBe(true);
          if (!preview.ok) return;

          const seen: string[] = [];
          let cursor: number | undefined = 0;

          while (cursor !== undefined) {
            const chunk = takeChunk({
              accepted: preview.value.accepted,
              cursor,
              chunkSize,
            });
            expect(chunk.ok).toBe(true);
            if (!chunk.ok) return;

            seen.push(...chunk.value.rows.map((row) => row.sourceRowRef));
            cursor = chunk.value.nextCursor ?? undefined;
          }

          expect(seen).toHaveLength(rowCount);
          expect(new Set(seen).size).toBe(rowCount);
        },
      ),
      { seed: 20260811, numRuns: 150 },
    );
  });

  it("gives one file's rows references no other file's rows share", () => {
    // A reference derived from the row's contents would collapse two legitimate
    // identical lines — or two legitimate identical files — into one.
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Z]{3}-[0-9]{2}$/),
        fc.stringMatching(/^[A-Z]{3}-[0-9]{2}$/),
        (first, second) => {
          fc.pre(first !== second);
          const text = "line_number,sku,quantity,uom\n1,SKU-1,1,EA";

          const a = previewImport({ batchRef: first, text });
          const b = previewImport({ batchRef: second, text });
          if (!a.ok || !b.ok) return;

          expect(a.value.accepted[0]?.sourceRowRef).not.toBe(
            b.value.accepted[0]?.sourceRowRef,
          );
        },
      ),
      { seed: 20260811, numRuns: 200 },
    );
  });
});
