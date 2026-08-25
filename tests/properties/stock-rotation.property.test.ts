import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  addDays,
  compareBusinessDates,
  parseBusinessDate,
  type BusinessDate,
} from "../../convex/model/time/businessDate";
import {
  compareRotationCandidates,
  isCandidateExpired,
  orderForRotation,
  rotationDateOf,
  type RotationStrategy,
  type StockRotationCandidate,
  type StockRotationPolicy,
} from "../../convex/model/rotation/stockRotation";
import { expectOk } from "../fixtures/domain-results";

const asOf: BusinessDate = expectOk(parseBusinessDate("2026-08-03"));

const comparatorFor =
  (rules: StockRotationPolicy) =>
  (left: StockRotationCandidate, right: StockRotationCandidate): number =>
    expectOk(compareRotationCandidates(left, right, rules, asOf));

const rotationDate = (
  candidate: StockRotationCandidate,
  rules: StockRotationPolicy,
): BusinessDate | null => expectOk(rotationDateOf(candidate, rules));

const compareDates = (left: BusinessDate, right: BusinessDate): number =>
  expectOk(compareBusinessDates(left, right));

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
          const compare = comparatorFor(rules);
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
          expect(comparatorFor(rules)(left, right)).not.toBe(0);
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
          const compare = comparatorFor(rules);
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
          expect(compareDates(previous, current)).toBeLessThanOrEqual(0);
        }
      }),
    );
  });

  it("excludes exactly what the policy says it excludes", () => {
    fc.assert(
      fc.property(policy, candidates, (rules, input) => {
        const order = expectOk(orderForRotation(input, rules, { asOf }));
        for (const { candidate, reason } of order.excluded) {
          const selected = rotationDate(candidate, rules);
          if (reason === "MISSING_ROTATION_DATE") {
            expect(selected).toBeNull();
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
            expect(candidate.expirationDate).not.toBeNull();
            if (candidate.expirationDate !== null) {
              expect(compareDates(candidate.expirationDate, asOf)).toBe(-1);
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

describe("expiry is the expiration date, not the rotation date", () => {
  it("holds for every rotation source and strategy", () => {
    fc.assert(
      fc.property(policy, candidateFor("bucket-1"), (rules, candidate) => {
        const expired = expectOk(isCandidateExpired(candidate, asOf));
        expect(expired).toBe(
          candidate.expirationDate !== null &&
            compareDates(candidate.expirationDate, asOf) < 0,
        );
        const order = expectOk(orderForRotation([candidate], rules, { asOf }));
        if (expired && rules.expired === "EXCLUDE") {
          expect(order.ordered).toEqual([]);
          expect(order.excluded.map(({ reason }) => reason)).toEqual([
            "EXPIRED",
          ]);
        }
        for (const ranking of order.ordered) {
          expect(ranking.expired).toBe(expired);
        }
      }),
    );
  });

  it("never ranks stock whose expiry has passed while excluding is on", () => {
    fc.assert(
      fc.property(policy, candidates, (rules, input) => {
        if (rules.expired !== "EXCLUDE") return;
        const order = expectOk(orderForRotation(input, rules, { asOf }));
        for (const ranking of order.ordered) {
          expect(ranking.expired).toBe(false);
          const expiry = ranking.candidate.expirationDate;
          if (expiry !== null) {
            expect(compareDates(expiry, asOf)).toBeGreaterThanOrEqual(0);
          }
        }
      }),
    );
  });

  it("negative control: reading expiry off the rotation date is caught", () => {
    const rules: StockRotationPolicy = {
      strategy: "FEFO",
      rotationDateSource: "MANUFACTURE",
      missingRotationDate: "ORDER_LAST",
      expired: "EXCLUDE",
    };
    const expiredLots = fc
      .tuple(fc.integer({ min: -30, max: -1 }), fc.integer({ min: 0, max: 30 }))
      .map(([expiryOffset, manufactureOffset]) => ({
        candidateKey: "bucket-1",
        lotCode: null,
        receivedOn: null,
        receiptSequence: null,
        expirationDate: expectOk(addDays(asOf, expiryOffset)),
        bestBeforeDate: null,
        manufactureDate: expectOk(addDays(asOf, manufactureOffset)),
      }));

    const details = fc.check(
      fc.property(expiredLots, (candidate) => {
        const selected = rotationDate(candidate, rules);
        const expiredByRotationDate =
          selected !== null && compareDates(selected, asOf) < 0;
        expect(expiredByRotationDate).toBe(true);
      }),
    );
    expect(details.failed).toBe(true);

    fc.assert(
      fc.property(expiredLots, (candidate) => {
        expect(expectOk(isCandidateExpired(candidate, asOf))).toBe(true);
        expect(
          expectOk(orderForRotation([candidate], rules, { asOf })).excluded.map(
            ({ reason }) => reason,
          ),
        ).toEqual(["EXPIRED"]);
      }),
    );
  });
});

describe("negative controls", () => {
  it("determinism fails when the final tie-breaker is removed", () => {
    const withoutTieBreaker =
      (rules: StockRotationPolicy) =>
      (left: StockRotationCandidate, right: StockRotationCandidate): number => {
        const leftDate = rotationDate(left, rules);
        const rightDate = rotationDate(right, rules);
        if (leftDate === null || rightDate === null) return 0;
        return compareDates(leftDate, rightDate);
      };

    const rules: StockRotationPolicy = {
      strategy: "FEFO",
      rotationDateSource: "EXPIRATION",
      missingRotationDate: "ORDER_LAST",
      expired: "ORDER_FIRST",
    };

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

    fc.assert(
      fc.property(sameDayLots, (input) => {
        const compare = comparatorFor(rules);
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
    const details = fc.check(
      fc.property(businessDate, (shared) => {
        const left = sameDayCandidate("bucket-1", shared);
        const right = sameDayCandidate("bucket-2", shared);
        const rules: StockRotationPolicy = {
          strategy: "FEFO",
          rotationDateSource: "EXPIRATION",
          missingRotationDate: "ORDER_LAST",
          expired: "EXCLUDE",
        };
        const leftDate = rotationDate(left, rules);
        const rightDate = rotationDate(right, rules);
        if (leftDate === null || rightDate === null) return;
        expect(compareDates(leftDate, rightDate)).not.toBe(0);
      }),
    );
    expect(details.failed).toBe(true);
  });
});

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
