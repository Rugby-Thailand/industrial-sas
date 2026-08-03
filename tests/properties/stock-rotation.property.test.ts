/**
 * Property tier — stock rotation ordering (`ADR-0005` verification,
 * `INV-0005-10`).
 *
 * The invariant is not "sorted by expiry" but "the same sequence, every time,
 * from any input order". That needs the comparator to be a strict total order, so
 * the laws are asserted directly — irreflexivity, antisymmetry, transitivity, and
 * totality — and then determinism is asserted over shuffled inputs.
 *
 * The negative control removes the final tie-breaker, which is the change a
 * reviewer would consider harmless, and shows the determinism property catching
 * it.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  addDays,
  compareBusinessDates,
  parseBusinessDate,
  type BusinessDate,
} from "../../convex/model/time/businessDate";
import {
  compareForRotation,
  orderForRotation,
  rotationDateOf,
  type RotationStrategy,
  type StockRotationCandidate,
  type StockRotationPolicy,
} from "../../convex/model/rotation/stockRotation";
import { expectOk } from "../fixtures/domain-results";

const asOf: BusinessDate = expectOk(parseBusinessDate("2026-08-03"));

/** Dates near `asOf`, so expired and unexpired candidates both occur. */
const businessDate: fc.Arbitrary<BusinessDate> = fc
  .integer({ min: -30, max: 30 })
  .map((offset) => expectOk(addDays(asOf, offset)));

const maybeDate = fc.oneof(
  { arbitrary: fc.constant(null), weight: 1 },
  { arbitrary: businessDate, weight: 4 },
);

const candidateFor = (key: string): fc.Arbitrary<StockRotationCandidate> =>
  fc.record({
    candidateKey: fc.constant(key),
    lotCode: fc.oneof(
      { arbitrary: fc.constant(null), weight: 1 },
      { arbitrary: fc.stringMatching(/^L[0-9]{1,3}$/), weight: 3 },
    ),
    receivedOn: maybeDate,
    receiptSequence: fc.oneof(
      { arbitrary: fc.constant(null), weight: 1 },
      { arbitrary: fc.integer({ min: 1, max: 20 }), weight: 4 },
    ),
    expirationDate: maybeDate,
    bestBeforeDate: maybeDate,
    manufactureDate: maybeDate,
  });

/** Candidates with distinct keys: the precondition the module requires. */
const candidates = fc
  .integer({ min: 0, max: 8 })
  .chain((count) =>
    fc.tuple(
      ...Array.from({ length: count }, (_unused, index) =>
        candidateFor(`bucket-${index}`),
      ),
    ),
  );

const policy: fc.Arbitrary<StockRotationPolicy> = fc.record({
  strategy: fc.constantFrom<RotationStrategy>("FIFO", "FEFO"),
  rotationDateSource: fc.constantFrom(
    "EXPIRATION" as const,
    "BEST_BEFORE" as const,
    "MANUFACTURE" as const,
  ),
  missingRotationDate: fc.constantFrom(
    "EXCLUDE" as const,
    "ORDER_LAST" as const,
  ),
  expired: fc.constantFrom("EXCLUDE" as const, "ORDER_FIRST" as const),
});

/** A permutation of the input, driven by the generator rather than by chance. */
const permute = <T>(items: readonly T[], seed: readonly number[]): T[] => {
  const remaining = [...items];
  const output: T[] = [];
  let index = 0;
  while (remaining.length > 0) {
    const pick =
      (seed[index % Math.max(seed.length, 1)] ?? 0) % remaining.length;
    output.push(...remaining.splice(pick, 1));
    index += 1;
  }
  return output;
};

describe("comparator laws", () => {
  it("is irreflexive and antisymmetric", () => {
    fc.assert(
      fc.property(
        policy,
        candidateFor("a"),
        candidateFor("b"),
        (rules, left, right) => {
          const compare = compareForRotation(rules, asOf);
          expect(compare(left, left)).toBe(0);
          expect(compare(right, right)).toBe(0);
          expect(Math.sign(compare(left, right))).toBe(
            -Math.sign(compare(right, left)),
          );
        },
      ),
    );
  });

  it("is total: two distinct candidates never compare equal", () => {
    fc.assert(
      fc.property(
        policy,
        candidateFor("a"),
        candidateFor("b"),
        (rules, left, right) => {
          expect(compareForRotation(rules, asOf)(left, right)).not.toBe(0);
        },
      ),
    );
  });

  it("is transitive", () => {
    fc.assert(
      fc.property(
        policy,
        candidateFor("a"),
        candidateFor("b"),
        candidateFor("c"),
        (rules, first, second, third) => {
          const compare = compareForRotation(rules, asOf);
          if (compare(first, second) < 0 && compare(second, third) < 0) {
            expect(compare(first, third)).toBeLessThan(0);
          }
        },
      ),
    );
  });
});

describe("orderForRotation", () => {
  it("is deterministic under permutation of its input", () => {
    fc.assert(
      fc.property(
        policy,
        candidates,
        fc.array(fc.nat(), { minLength: 1, maxLength: 10 }),
        (rules, input, seed) => {
          const first = expectOk(orderForRotation(input, rules, { asOf }));
          const second = expectOk(
            orderForRotation(permute(input, seed), rules, { asOf }),
          );
          expect(
            second.ordered.map((ranking) => ranking.candidate.candidateKey),
          ).toEqual(
            first.ordered.map((ranking) => ranking.candidate.candidateKey),
          );
          expect(
            new Set(
              second.excluded.map(({ candidate }) => candidate.candidateKey),
            ),
          ).toEqual(
            new Set(
              first.excluded.map(({ candidate }) => candidate.candidateKey),
            ),
          );
        },
      ),
    );
  });

  it("accounts for every candidate exactly once", () => {
    fc.assert(
      fc.property(policy, candidates, (rules, input) => {
        const order = expectOk(orderForRotation(input, rules, { asOf }));
        const seen = [
          ...order.ordered.map((ranking) => ranking.candidate.candidateKey),
          ...order.excluded.map(({ candidate }) => candidate.candidateKey),
        ];
        expect(seen.length).toBe(input.length);
        expect(new Set(seen).size).toBe(input.length);
      }),
    );
  });

  it("ranks from one, contiguously", () => {
    fc.assert(
      fc.property(policy, candidates, (rules, input) => {
        const order = expectOk(orderForRotation(input, rules, { asOf }));
        expect(order.ordered.map((ranking) => ranking.rank)).toEqual(
          order.ordered.map((_unused, index) => index + 1),
        );
      }),
    );
  });

  it("never orders a later rotation date before an earlier one under FEFO", () => {
    fc.assert(
      fc.property(candidates, (input) => {
        const rules: StockRotationPolicy = {
          strategy: "FEFO",
          rotationDateSource: "EXPIRATION",
          missingRotationDate: "EXCLUDE",
          expired: "EXCLUDE",
        };
        const order = expectOk(orderForRotation(input, rules, { asOf }));
        const dates = order.ordered.map((ranking) => ranking.rotationDate);
        for (let index = 1; index < dates.length; index += 1) {
          const previous = dates[index - 1];
          const current = dates[index];
          if (
            previous === null ||
            current === null ||
            previous === undefined ||
            current === undefined
          ) {
            continue;
          }
          expect(compareBusinessDates(previous, current)).toBeLessThanOrEqual(
            0,
          );
        }
      }),
    );
  });

  it("excludes exactly what the policy says it excludes", () => {
    fc.assert(
      fc.property(policy, candidates, (rules, input) => {
        const order = expectOk(orderForRotation(input, rules, { asOf }));
        for (const { candidate, reason } of order.excluded) {
          const rotationDate = rotationDateOf(candidate, rules);
          if (reason === "MISSING_ROTATION_DATE") {
            expect(rotationDate).toBeNull();
            expect(rules.strategy).toBe("FEFO");
            expect(rules.missingRotationDate).toBe("EXCLUDE");
          }
          if (reason === "MISSING_RECEIPT_ORDER") {
            expect(rules.strategy).toBe("FIFO");
            expect(
              candidate.receivedOn === null ||
                candidate.receiptSequence === null,
            ).toBe(true);
          }
          if (reason === "EXPIRED") {
            expect(rules.expired).toBe("EXCLUDE");
            expect(rotationDate).not.toBeNull();
            if (rotationDate !== null) {
              expect(compareBusinessDates(rotationDate, asOf)).toBe(-1);
            }
          }
        }
      }),
    );
  });

  it("explains every ranked candidate with the same criteria, in order", () => {
    fc.assert(
      fc.property(policy, candidates, (rules, input) => {
        const order = expectOk(orderForRotation(input, rules, { asOf }));
        const shapes = new Set(
          order.ordered.map((ranking) =>
            ranking.explanation.map((entry) => entry.criterion).join(">"),
          ),
        );
        expect(shapes.size).toBeLessThanOrEqual(1);
        for (const ranking of order.ordered) {
          expect(ranking.explanation.at(-1)?.criterion).toBe("CANDIDATE_KEY");
        }
      }),
    );
  });
});

describe("negative controls", () => {
  /**
   * Both controls are built so the counterexample is guaranteed: the collision the
   * mutation cannot survive is constructed, not hoped for. A control that only
   * fails on some seeds would be a flaky test pretending to be evidence.
   */
  it("determinism fails when the final tie-breaker is removed", () => {
    // The mutation: order by rotation date alone, with no stable last key. Two
    // lots that expire on the same day then depend on the input order, which is
    // exactly the bug that makes two handhelds disagree.
    const withoutTieBreaker =
      (rules: StockRotationPolicy) =>
      (left: StockRotationCandidate, right: StockRotationCandidate): number => {
        const leftDate = rotationDateOf(left, rules);
        const rightDate = rotationDateOf(right, rules);
        if (leftDate === null || rightDate === null) return 0;
        return compareBusinessDates(leftDate, rightDate);
      };

    const rules: StockRotationPolicy = {
      strategy: "FEFO",
      rotationDateSource: "EXPIRATION",
      missingRotationDate: "ORDER_LAST",
      expired: "ORDER_FIRST",
    };

    /** Two lots of one item expiring on the same day: the ordinary case. */
    const sameDayLots = businessDate.map((shared) => [
      sameDayCandidate("bucket-1", shared),
      sameDayCandidate("bucket-2", shared),
    ]);

    const details = fc.check(
      fc.property(sameDayLots, (input) => {
        const compare = withoutTieBreaker(rules);
        const forward = [...input].sort(compare).map((one) => one.candidateKey);
        const reversed = [...input]
          .reverse()
          .sort(compare)
          .map((one) => one.candidateKey);
        expect(reversed).toEqual(forward);
      }),
    );
    expect(details.failed).toBe(true);

    // The real comparator orders the same two lots identically either way.
    fc.assert(
      fc.property(sameDayLots, (input) => {
        const compare = compareForRotation(rules, asOf);
        expect(
          [...input]
            .reverse()
            .sort(compare)
            .map((one) => one.candidateKey),
        ).toEqual([...input].sort(compare).map((one) => one.candidateKey));
      }),
    );
  });

  it("the totality law fails when candidates carry no unique key", () => {
    // The mutation: compare only the rotation dates. Two distinct lots expiring on
    // the same day compare equal, so the order is not a total order at all.
    const details = fc.check(
      fc.property(businessDate, (shared) => {
        const left = sameDayCandidate("bucket-1", shared);
        const right = sameDayCandidate("bucket-2", shared);
        const leftDate = rotationDateOf(left, {
          strategy: "FEFO",
          rotationDateSource: "EXPIRATION",
          missingRotationDate: "ORDER_LAST",
          expired: "EXCLUDE",
        });
        const rightDate = rotationDateOf(right, {
          strategy: "FEFO",
          rotationDateSource: "EXPIRATION",
          missingRotationDate: "ORDER_LAST",
          expired: "EXCLUDE",
        });
        if (leftDate === null || rightDate === null) return;
        expect(compareBusinessDates(leftDate, rightDate)).not.toBe(0);
      }),
    );
    expect(details.failed).toBe(true);
  });
});

/** Two of these differ only by key: the input every tie-breaker exists for. */
function sameDayCandidate(
  candidateKey: string,
  expirationDate: BusinessDate,
): StockRotationCandidate {
  return {
    candidateKey,
    lotCode: null,
    receivedOn: null,
    receiptSequence: null,
    expirationDate,
    bestBeforeDate: null,
    manufactureDate: null,
  };
}
