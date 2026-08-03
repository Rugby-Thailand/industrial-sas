/**
 * Unit tier — FIFO and FEFO ordering.
 *
 * Determinism is asserted the only way that means anything: the same candidates
 * are ordered from several input permutations and the results must be identical.
 * The rest covers each policy switch and the exclusions, which are the decisions
 * an operator will ask about when a lot they expected is not offered.
 */
import { describe, expect, it } from "vitest";

import { expectError, expectOk } from "../../../tests/fixtures/domain-results";
import { parseBusinessDate, type BusinessDate } from "../time/businessDate";
import {
  compareRotationCandidates,
  isCandidateExpired,
  orderForRotation,
  rotationDateOf,
  validateRotationCandidate,
  validateRotationPolicy,
  type StockRotationCandidate,
  type StockRotationPolicy,
} from "./stockRotation";

const date = (iso: string): BusinessDate => expectOk(parseBusinessDate(iso));
const asOf = date("2026-08-03");

const candidate = (
  overrides: Partial<StockRotationCandidate> & { candidateKey: string },
): StockRotationCandidate => ({
  lotCode: null,
  receivedOn: null,
  receiptSequence: null,
  expirationDate: null,
  bestBeforeDate: null,
  manufactureDate: null,
  ...overrides,
});

const fefo: StockRotationPolicy = {
  strategy: "FEFO",
  rotationDateSource: "EXPIRATION",
  missingRotationDate: "EXCLUDE",
  expired: "EXCLUDE",
};

const fifo: StockRotationPolicy = { ...fefo, strategy: "FIFO" };

const keys = (result: ReturnType<typeof orderForRotation>): readonly string[] =>
  expectOk(result).ordered.map((ranking) => ranking.candidate.candidateKey);

describe("rotationDateOf", () => {
  const lot = candidate({
    candidateKey: "b1",
    expirationDate: date("2026-12-01"),
    bestBeforeDate: date("2026-11-01"),
    manufactureDate: date("2026-01-01"),
  });

  it("follows the configured source", () => {
    expect(expectOk(rotationDateOf(lot, fefo))).toEqual(date("2026-12-01"));
    expect(
      expectOk(
        rotationDateOf(lot, { ...fefo, rotationDateSource: "BEST_BEFORE" }),
      ),
    ).toEqual(date("2026-11-01"));
    expect(
      expectOk(
        rotationDateOf(lot, { ...fefo, rotationDateSource: "MANUFACTURE" }),
      ),
    ).toEqual(date("2026-01-01"));
  });

  it("rejects a rotation source this module does not implement", () => {
    // The switch had no default, so a forged source answered `undefined` while
    // the type said `BusinessDate | null` — and the next comparison read fields
    // off it.
    expect(
      expectError(
        rotationDateOf(lot, {
          ...fefo,
          rotationDateSource:
            "RECEIPT" as StockRotationPolicy["rotationDateSource"],
        }),
      ),
    ).toEqual({ code: "INVALID_POLICY", field: "rotationDateSource" });
  });
});

describe("isCandidateExpired", () => {
  const expiring = (iso: string | null) =>
    candidate({
      candidateKey: "b1",
      expirationDate: iso === null ? null : date(iso),
    });

  it("treats stock as usable through the whole of its expiration date", () => {
    expect(expectOk(isCandidateExpired(expiring("2026-08-02"), asOf))).toBe(
      true,
    );
    expect(expectOk(isCandidateExpired(expiring("2026-08-03"), asOf))).toBe(
      false,
    );
    expect(expectOk(isCandidateExpired(expiring("2026-08-04"), asOf))).toBe(
      false,
    );
    expect(expectOk(isCandidateExpired(expiring(null), asOf))).toBe(false);
  });

  it("reads expiry from the expiration date alone", () => {
    // Expiry used to be read off the configured rotation date. Under a
    // manufacture-date policy that called an old lot "expired", and — the
    // dangerous half — called a genuinely expired lot good.
    const oldManufacture = candidate({
      candidateKey: "b-old",
      manufactureDate: date("2020-01-01"),
      expirationDate: date("2027-01-01"),
    });
    const reallyExpired = candidate({
      candidateKey: "b-gone",
      manufactureDate: date("2026-08-01"),
      bestBeforeDate: date("2027-01-01"),
      expirationDate: date("2026-08-01"),
    });
    expect(expectOk(isCandidateExpired(oldManufacture, asOf))).toBe(false);
    expect(expectOk(isCandidateExpired(reallyExpired, asOf))).toBe(true);
  });
});

describe("FEFO ordering", () => {
  const soon = candidate({
    candidateKey: "b-soon",
    expirationDate: date("2026-08-10"),
  });
  const later = candidate({
    candidateKey: "b-later",
    expirationDate: date("2027-01-31"),
  });
  const soonest = candidate({
    candidateKey: "b-soonest",
    expirationDate: date("2026-08-04"),
  });

  it("orders by rotation date, earliest first", () => {
    expect(
      keys(orderForRotation([later, soon, soonest], fefo, { asOf })),
    ).toEqual(["b-soonest", "b-soon", "b-later"]);
  });

  it("is independent of the input order", () => {
    const permutations = [
      [soonest, soon, later],
      [later, soonest, soon],
      [soon, later, soonest],
      [later, soon, soonest],
    ];
    const results = permutations.map((permutation) =>
      keys(orderForRotation(permutation, fefo, { asOf })).join(","),
    );
    expect(new Set(results).size).toBe(1);
  });

  it("breaks a tie by receipt date, then sequence, then lot, then key", () => {
    const base = { expirationDate: date("2026-09-01") };
    const first = candidate({
      ...base,
      candidateKey: "k-2",
      receivedOn: date("2026-07-01"),
      receiptSequence: 1,
    });
    const second = candidate({
      ...base,
      candidateKey: "k-1",
      receivedOn: date("2026-07-02"),
      receiptSequence: 1,
    });
    expect(keys(orderForRotation([second, first], fefo, { asOf }))).toEqual([
      "k-2",
      "k-1",
    ]);

    const sameDay = [
      candidate({
        ...base,
        candidateKey: "k-b",
        receivedOn: date("2026-07-01"),
        receiptSequence: 9,
      }),
      candidate({
        ...base,
        candidateKey: "k-a",
        receivedOn: date("2026-07-01"),
        receiptSequence: 4,
      }),
    ];
    expect(keys(orderForRotation(sameDay, fefo, { asOf }))).toEqual([
      "k-a",
      "k-b",
    ]);

    const sameSequence = [
      candidate({ ...base, candidateKey: "k-z", lotCode: "B" }),
      candidate({ ...base, candidateKey: "k-y", lotCode: "A" }),
    ];
    expect(keys(orderForRotation(sameSequence, fefo, { asOf }))).toEqual([
      "k-y",
      "k-z",
    ]);

    const identical = [
      candidate({ ...base, candidateKey: "k-2" }),
      candidate({ ...base, candidateKey: "k-1" }),
    ];
    expect(keys(orderForRotation(identical, fefo, { asOf }))).toEqual([
      "k-1",
      "k-2",
    ]);
  });

  it("excludes a candidate with no rotation date by default", () => {
    const undated = candidate({ candidateKey: "b-undated" });
    const order = expectOk(orderForRotation([soon, undated], fefo, { asOf }));
    expect(
      order.ordered.map((ranking) => ranking.candidate.candidateKey),
    ).toEqual(["b-soon"]);
    expect(order.excluded).toEqual([
      { candidate: undated, reason: "MISSING_ROTATION_DATE" },
    ]);
  });

  it("can be told to rank a dateless candidate last instead", () => {
    const undated = candidate({ candidateKey: "b-undated" });
    const order = expectOk(
      orderForRotation(
        [undated, later, soon],
        {
          ...fefo,
          missingRotationDate: "ORDER_LAST",
        },
        { asOf },
      ),
    );
    expect(
      order.ordered.map((ranking) => ranking.candidate.candidateKey),
    ).toEqual(["b-soon", "b-later", "b-undated"]);
    expect(order.excluded).toEqual([]);
  });

  it("excludes expired stock by default", () => {
    const expired = candidate({
      candidateKey: "b-expired",
      expirationDate: date("2026-08-01"),
    });
    const order = expectOk(orderForRotation([expired, soon], fefo, { asOf }));
    expect(
      order.ordered.map((ranking) => ranking.candidate.candidateKey),
    ).toEqual(["b-soon"]);
    expect(order.excluded).toEqual([{ candidate: expired, reason: "EXPIRED" }]);
  });

  it("can be told to rank expired stock first, for a disposal flow", () => {
    const expired = candidate({
      candidateKey: "b-expired",
      expirationDate: date("2026-08-01"),
    });
    const order = expectOk(
      orderForRotation(
        [soon, expired],
        { ...fefo, expired: "ORDER_FIRST" },
        {
          asOf,
        },
      ),
    );
    expect(
      order.ordered.map((ranking) => ranking.candidate.candidateKey),
    ).toEqual(["b-expired", "b-soon"]);
    expect(order.ordered[0]?.expired).toBe(true);
    expect(order.ordered[1]?.expired).toBe(false);
  });

  it("ranks from one and reports the rotation date it used", () => {
    const order = expectOk(orderForRotation([soon, later], fefo, { asOf }));
    expect(order.ordered.map((ranking) => ranking.rank)).toEqual([1, 2]);
    expect(order.ordered[0]?.rotationDate).toEqual(date("2026-08-10"));
  });

  it("explains each ranking with the criteria in priority order", () => {
    const lot = candidate({
      candidateKey: "b-1",
      lotCode: "L-1",
      expirationDate: date("2026-09-01"),
      receivedOn: date("2026-07-01"),
      receiptSequence: 42,
    });
    const order = expectOk(orderForRotation([lot], fefo, { asOf }));
    expect(order.ordered[0]?.explanation).toEqual([
      { criterion: "ROTATION_DATE_PRESENCE", value: "PRESENT" },
      { criterion: "ROTATION_DATE", value: "2026-09-01" },
      { criterion: "RECEIVED_ON", value: "2026-07-01" },
      { criterion: "RECEIPT_SEQUENCE", value: "42" },
      { criterion: "LOT_CODE", value: "L-1" },
      { criterion: "CANDIDATE_KEY", value: "b-1" },
    ]);
  });
});

describe("FIFO ordering", () => {
  const early = candidate({
    candidateKey: "f-early",
    receivedOn: date("2026-07-01"),
    receiptSequence: 10,
    expirationDate: date("2027-01-01"),
  });
  const late = candidate({
    candidateKey: "f-late",
    receivedOn: date("2026-07-05"),
    receiptSequence: 20,
    expirationDate: date("2026-08-20"),
  });

  it("orders by receipt, ignoring a nearer expiry", () => {
    expect(keys(orderForRotation([late, early], fifo, { asOf }))).toEqual([
      "f-early",
      "f-late",
    ]);
  });

  it("excludes a candidate with no receipt order, and says so", () => {
    const unordered = candidate({
      candidateKey: "f-unordered",
      receivedOn: date("2026-07-01"),
    });
    const order = expectOk(
      orderForRotation([early, unordered], fifo, { asOf }),
    );
    expect(
      order.ordered.map((ranking) => ranking.candidate.candidateKey),
    ).toEqual(["f-early"]);
    expect(order.excluded).toEqual([
      { candidate: unordered, reason: "MISSING_RECEIPT_ORDER" },
    ]);
  });

  it("uses a different criterion order from FEFO", () => {
    const order = expectOk(orderForRotation([early], fifo, { asOf }));
    expect(
      order.ordered[0]?.explanation.map((entry) => entry.criterion),
    ).toEqual([
      "RECEIVED_ON",
      "RECEIPT_SEQUENCE",
      "ROTATION_DATE_PRESENCE",
      "ROTATION_DATE",
      "LOT_CODE",
      "CANDIDATE_KEY",
    ]);
  });
});

describe("fail-closed inputs", () => {
  it("refuses a duplicate candidate key, because no total order exists", () => {
    const duplicate = [
      candidate({ candidateKey: "same", expirationDate: date("2026-09-01") }),
      candidate({ candidateKey: "same", expirationDate: date("2026-10-01") }),
    ];
    expect(expectError(orderForRotation(duplicate, fefo, { asOf }))).toEqual({
      code: "DUPLICATE_CANDIDATE_KEY",
      candidateKey: "same",
    });
  });

  it("refuses an empty candidate key", () => {
    expect(
      expectError(
        orderForRotation([candidate({ candidateKey: "" })], fefo, { asOf }),
      ),
    ).toEqual({ code: "EMPTY_CANDIDATE_KEY" });
  });

  it("refuses a non-integer receipt sequence", () => {
    expect(
      expectError(
        orderForRotation(
          [candidate({ candidateKey: "k", receiptSequence: 1.5 })],
          fefo,
          { asOf },
        ),
      ),
    ).toEqual({
      code: "INVALID_RECEIPT_SEQUENCE",
      candidateKey: "k",
      receiptSequence: 1.5,
    });
  });

  it("returns an empty order for no candidates", () => {
    expect(expectOk(orderForRotation([], fefo, { asOf }))).toEqual({
      ordered: [],
      excluded: [],
    });
  });
});

describe("compareRotationCandidates", () => {
  const compare = (
    left: StockRotationCandidate,
    right: StockRotationCandidate,
  ) => expectOk(compareRotationCandidates(left, right, fefo, asOf));

  it("never reports two distinct candidates as equal", () => {
    const left = candidate({
      candidateKey: "a",
      expirationDate: date("2026-09-01"),
    });
    const right = candidate({
      candidateKey: "b",
      expirationDate: date("2026-09-01"),
    });
    expect(compare(left, right)).toBe(-1);
    expect(compare(right, left)).toBe(1);
    expect(compare(left, left)).toBe(0);
  });

  it("orders strings by code unit rather than by collation", () => {
    // A locale-aware comparison can order "a" before "B"; this one does not,
    // because the stored order must not depend on the reader's locale.
    const upper = candidate({
      candidateKey: "B",
      expirationDate: date("2026-09-01"),
    });
    const lower = candidate({
      candidateKey: "a",
      expirationDate: date("2026-09-01"),
    });
    expect(compare(upper, lower)).toBe(-1);
    expect("a".localeCompare("B") < 0).toBe(true);
  });

  it("refuses to order values it has not validated", () => {
    // A bare comparator handed to `sort` is where an unvalidated value does the
    // most damage: a `NaN` comparison makes the order intransitive and the
    // resulting sequence implementation-defined.
    const good = candidate({
      candidateKey: "a",
      expirationDate: date("2026-09-01"),
    });
    const forgedDate = candidate({
      candidateKey: "b",
      expirationDate: { year: Number.NaN, month: 9, day: 1 } as BusinessDate,
    });
    expect(
      expectError(compareRotationCandidates(good, forgedDate, fefo, asOf)).code,
    ).toBe("INVALID_DATE");
    expect(
      expectError(
        compareRotationCandidates(good, good, fefo, {
          year: 2026,
          month: 13,
          day: 1,
        } as BusinessDate),
      ).code,
    ).toBe("INVALID_DATE");
  });
});

describe("candidate and policy validation", () => {
  it("rejects a receipt sequence that is not a non-negative safe integer", () => {
    for (const receiptSequence of [-1, 1.5, 2 ** 53, Number.NaN]) {
      expect(
        expectError(
          orderForRotation(
            [candidate({ candidateKey: "b1", receiptSequence })],
            fifo,
            { asOf },
          ),
        ).code,
      ).toBe("INVALID_RECEIPT_SEQUENCE");
    }
    expect(
      expectOk(
        validateRotationCandidate(
          candidate({ candidateKey: "b1", receiptSequence: 0 }),
        ),
      ).receiptSequence,
    ).toBe(0);
  });

  it("rejects a candidate key that is not a bounded, whitespace-free code", () => {
    expect(
      expectError(validateRotationCandidate(candidate({ candidateKey: "" }))),
    ).toEqual({ code: "EMPTY_CANDIDATE_KEY" });
    expect(
      expectError(validateRotationCandidate(candidate({ candidateKey: "   " })))
        .code,
    ).toBe("INVALID_CANDIDATE_KEY");
    expect(
      expectError(
        validateRotationCandidate(candidate({ candidateKey: "a\u0000b" })),
      ).code,
    ).toBe("INVALID_CANDIDATE_KEY");
    expect(
      expectError(
        validateRotationCandidate(candidate({ candidateKey: "x".repeat(65) })),
      ).code,
    ).toBe("INVALID_CANDIDATE_KEY");
    expect(
      expectError(
        validateRotationCandidate({
          candidateKey: 7,
        } as unknown as StockRotationCandidate),
      ).code,
    ).toBe("EMPTY_CANDIDATE_KEY");
    expect(
      expectError(
        validateRotationCandidate(null as unknown as StockRotationCandidate),
      ),
    ).toEqual({ code: "NOT_A_CANDIDATE", received: "null" });
  });

  it("rejects a lot code carrying a control character", () => {
    expect(
      expectError(
        validateRotationCandidate(
          candidate({ candidateKey: "b1", lotCode: "LOT\u0001" }),
        ),
      ).code,
    ).toBe("INVALID_LOT_CODE");
  });

  it("rejects an impossible date in any date field", () => {
    const impossible = { year: 2026, month: 2, day: 30 } as BusinessDate;
    for (const field of [
      "receivedOn",
      "expirationDate",
      "bestBeforeDate",
      "manufactureDate",
    ] as const) {
      const error = expectError(
        validateRotationCandidate(
          candidate({ candidateKey: "b1", [field]: impossible }),
        ),
      );
      expect(error.code).toBe("INVALID_DATE");
      if (error.code === "INVALID_DATE") expect(error.field).toBe(field);
    }
  });

  it("rejects a policy field a cast invented", () => {
    expect(
      expectError(
        validateRotationPolicy({
          ...fefo,
          strategy: "LIFO" as StockRotationPolicy["strategy"],
        }),
      ),
    ).toEqual({ code: "INVALID_POLICY", field: "strategy" });
    expect(
      expectError(
        validateRotationPolicy({
          ...fefo,
          missingRotationDate:
            "GUESS" as StockRotationPolicy["missingRotationDate"],
        }),
      ).code,
    ).toBe("INVALID_POLICY");
    expect(
      expectError(
        validateRotationPolicy({
          ...fefo,
          expired: "IGNORE" as StockRotationPolicy["expired"],
        }),
      ).code,
    ).toBe("INVALID_POLICY");
    expect(
      expectError(
        orderForRotation([], null as unknown as StockRotationPolicy, { asOf }),
      ).code,
    ).toBe("INVALID_POLICY");
  });

  it("rejects an `asOf` that is not a calendar day", () => {
    expect(
      expectError(
        orderForRotation([candidate({ candidateKey: "b1" })], fefo, {
          asOf: { year: 2026, month: 0, day: 0 } as BusinessDate,
        }),
      ).code,
    ).toBe("INVALID_DATE");
  });

  it("returns frozen rankings and exclusions", () => {
    const order = expectOk(
      orderForRotation(
        [
          candidate({
            candidateKey: "b-good",
            expirationDate: date("2026-09-01"),
          }),
          candidate({ candidateKey: "b-none" }),
        ],
        fefo,
        { asOf },
      ),
    );
    expect(Object.isFrozen(order)).toBe(true);
    expect(Object.isFrozen(order.ordered)).toBe(true);
    expect(Object.isFrozen(order.ordered[0])).toBe(true);
    expect(Object.isFrozen(order.ordered[0]?.explanation)).toBe(true);
    expect(Object.isFrozen(order.ordered[0]?.candidate)).toBe(true);
    expect(Object.isFrozen(order.excluded)).toBe(true);
    expect(Object.isFrozen(order.excluded[0])).toBe(true);
  });
});

describe("expiry is independent of the rotation source", () => {
  const expiredButNewlyMade = candidate({
    candidateKey: "b-expired",
    manufactureDate: date("2026-08-01"),
    bestBeforeDate: date("2027-01-01"),
    expirationDate: date("2026-08-01"),
    receivedOn: date("2026-08-01"),
    receiptSequence: 1,
  });
  const usable = candidate({
    candidateKey: "b-usable",
    manufactureDate: date("2020-01-01"),
    bestBeforeDate: date("2027-06-01"),
    expirationDate: date("2027-06-01"),
    receivedOn: date("2026-08-02"),
    receiptSequence: 2,
  });

  it("excludes expired stock under every FEFO rotation source", () => {
    for (const rotationDateSource of [
      "EXPIRATION",
      "BEST_BEFORE",
      "MANUFACTURE",
    ] as const) {
      const order = expectOk(
        orderForRotation(
          [expiredButNewlyMade, usable],
          {
            ...fefo,
            rotationDateSource,
          },
          { asOf },
        ),
      );
      expect(
        order.ordered.map((ranking) => ranking.candidate.candidateKey),
      ).toEqual(["b-usable"]);
      expect(order.excluded).toEqual([
        { candidate: expiredButNewlyMade, reason: "EXPIRED" },
      ]);
    }
  });

  it("excludes expired stock under FIFO too", () => {
    const order = expectOk(
      orderForRotation([expiredButNewlyMade, usable], fifo, { asOf }),
    );
    expect(
      order.ordered.map((ranking) => ranking.candidate.candidateKey),
    ).toEqual(["b-usable"]);
    expect(order.excluded).toEqual([
      { candidate: expiredButNewlyMade, reason: "EXPIRED" },
    ]);
  });

  it("does not call an old manufacture date an expiry", () => {
    // Rotating by manufacture date must still order the old lot first; it is old,
    // not expired.
    const order = expectOk(
      orderForRotation(
        [usable, expiredButNewlyMade],
        {
          ...fefo,
          rotationDateSource: "MANUFACTURE",
          expired: "ORDER_FIRST",
        },
        { asOf },
      ),
    );
    expect(
      order.ordered.map((ranking) => ranking.candidate.candidateKey),
    ).toEqual(["b-expired", "b-usable"]);
    expect(order.ordered.map((ranking) => ranking.expired)).toEqual([
      true,
      false,
    ]);
  });
});
