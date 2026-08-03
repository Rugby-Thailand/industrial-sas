/**
 * Integration tier — the inbound primitives composed, with no Convex.
 *
 * The unit tiers prove each module in isolation. This one proves they fit
 * together in the shape the inbound slice needs: a supplier label is scanned and
 * classified, its GTIN selects an item, its lot and expiry become a business date,
 * a quantity captured in cases converts exactly to base minor units, a pallet is
 * given a licence plate, and two lots are ordered for rotation against a Bangkok
 * business date.
 *
 * Everything below is synthetic and pure. There is no `convex-test` world here on
 * purpose: `convex/model/**` has no Convex imports (plan §6.2, enforced by
 * `pnpm verify:tenant-boundary`), so composing it needs no backend — and the
 * absence of one is what makes this suite evidence about the algebra rather than
 * about a harness.
 *
 * What this is **not**: a receiving flow. There is no purchase order, no receipt,
 * no ledger posting, and no persistence. Resolving a GTIN to an item is a `Map`
 * lookup here; in production it is a tenant-scoped indexed read that does not
 * exist yet.
 */
import { describe, expect, it } from "vitest";

import {
  parseGs1ElementString,
  type Gs1Scan,
} from "../../convex/model/gs1/elementString";
import { gs1DateToBusinessDate } from "../../convex/model/gs1/date";
import {
  generateInternalLpn,
  lpnFromSscc,
  makeLpnNamespace,
  parseInternalLpn,
  type EntropySource,
} from "../../convex/model/identifiers/lpn";
import { normalizeLotCode } from "../../convex/model/identifiers/normalization";
import {
  resolveScan,
  type ScanResolutionPolicy,
} from "../../convex/model/identifiers/scanResolution";
import {
  orderForRotation,
  type StockRotationCandidate,
  type StockRotationPolicy,
} from "../../convex/model/rotation/stockRotation";
import {
  ASIA_BANGKOK,
  businessDateFromInstant,
  businessDateToIso,
  formatBusinessDate,
  parseBusinessDate,
  type BusinessDate,
} from "../../convex/model/time/businessDate";
import {
  convertToBase,
  makeItemQuantity,
  makeItemUomProfile,
  type ItemUomProfile,
} from "../../convex/model/uom/itemUom";
import { formatQuantity } from "../../convex/model/uom/quantity";
import { makeRatio } from "../../convex/model/uom/ratio";
import { expectError, expectOk } from "../fixtures/domain-results";

/* -------------------------------------------------------------------------- */
/* Synthetic master data                                                       */
/* -------------------------------------------------------------------------- */

const ratio = (numerator: number, denominator: number) =>
  expectOk(makeRatio(numerator, denominator));

/** Bolts: base PCS, a case of 12, a pallet of 40 cases. */
const boltProfile: ItemUomProfile = expectOk(
  makeItemUomProfile({
    itemKey: "ITEM-BOLT-M8",
    baseUom: "PCS",
    alternates: [
      { uom: "CASE", toBase: ratio(12, 1) },
      { uom: "PALLET", toBase: ratio(480, 1) },
    ],
  }),
);

/** Resin: base KG, sold in 200.5 kg drums. */
const resinProfile: ItemUomProfile = expectOk(
  makeItemUomProfile({
    itemKey: "ITEM-RESIN",
    baseUom: "KG",
    alternates: [{ uom: "DRUM", toBase: ratio(401, 2) }],
  }),
);

/** The item master, keyed by the GTIN a supplier prints (`G-043`). */
const itemsByGtin: ReadonlyMap<string, ItemUomProfile> = new Map([
  ["10614141999993", boltProfile],
  ["10614141888884", resinProfile],
]);

const namespace = expectOk(makeLpnNamespace("org_acme", "PA"));

/** A fixed entropy source: the pallet label is reproducible in a test. */
const entropy: EntropySource = (byteLength) =>
  new Uint8Array(Array.from({ length: byteLength }, (_u, index) => index + 11));

const scanPolicy: ScanResolutionPolicy = {
  referenceYear: 2026,
  namespaces: [namespace],
};

/** 2026-08-03T17:30:00Z — the evening of 3 August in UTC, the 4th in Bangkok. */
const receiptInstant = 1_785_778_200_000;

/**
 * Builds an element string from AI/value pairs, the way a supplier's printer
 * concatenates them. Every AI used here is predefined-length or last in the
 * string, so no FNC1 is required.
 */
const label = (...pairs: readonly (readonly [string, string])[]): string =>
  pairs.map(([ai, value]) => `${ai}${value}`).join("");

/* -------------------------------------------------------------------------- */
/* The composition under test                                                  */
/* -------------------------------------------------------------------------- */

interface CapturedLine {
  readonly itemKey: string;
  readonly baseQuantity: string;
  readonly lotCode: string | null;
  readonly expiresOn: BusinessDate | null;
  readonly receivedOn: BusinessDate;
}

type CaptureFailure =
  | { readonly step: "SCAN"; readonly reason: string }
  | { readonly step: "ITEM"; readonly reason: string }
  | { readonly step: "QUANTITY"; readonly reason: string }
  | { readonly step: "LOT"; readonly reason: string };

/**
 * One captured receipt line, assembled from the primitives in the order the
 * handheld would use them. Returns a failure rather than throwing, so each step's
 * refusal is observable.
 */
function captureLine(input: {
  readonly rawScan: string;
  readonly capturedUom: string;
  readonly capturedMinorUnits: number;
  readonly instant: number;
}): { ok: true; line: CapturedLine } | { ok: false; failure: CaptureFailure } {
  const resolved = resolveScan(input.rawScan, scanPolicy);
  if (!resolved.ok) {
    return {
      ok: false,
      failure: { step: "SCAN", reason: resolved.error.code },
    };
  }
  if (resolved.value.interpretation.kind !== "GS1") {
    return {
      ok: false,
      failure: {
        step: "SCAN",
        reason: `NOT_A_PRODUCT_LABEL:${resolved.value.interpretation.kind}`,
      },
    };
  }
  const scan: Gs1Scan = resolved.value.interpretation.scan;
  if (scan.gtin14 === null) {
    return { ok: false, failure: { step: "ITEM", reason: "NO_GTIN" } };
  }
  const profile = itemsByGtin.get(scan.gtin14);
  if (profile === undefined) {
    return { ok: false, failure: { step: "ITEM", reason: "UNKNOWN_GTIN" } };
  }

  const converted = convertToBase(
    profile,
    input.capturedUom,
    input.capturedMinorUnits,
  );
  if (converted.kind === "REJECTED") {
    return {
      ok: false,
      failure: { step: "QUANTITY", reason: converted.error.code },
    };
  }
  if (converted.kind === "INEXACT") {
    return {
      ok: false,
      failure: {
        step: "QUANTITY",
        reason: `INEXACT:${converted.exact.numerator}/${converted.exact.denominator}`,
      },
    };
  }
  const itemQuantity = makeItemQuantity(profile, converted.quantity);
  if (!itemQuantity.ok) {
    return {
      ok: false,
      failure: { step: "QUANTITY", reason: itemQuantity.error.code },
    };
  }
  const baseQuantity = formatQuantity(itemQuantity.value.quantity);
  if (!baseQuantity.ok) {
    return {
      ok: false,
      failure: { step: "QUANTITY", reason: baseQuantity.error.code },
    };
  }

  let lotCode: string | null = null;
  if (scan.lot !== null) {
    const normalized = normalizeLotCode(scan.lot);
    if (!normalized.ok) {
      return {
        ok: false,
        failure: { step: "LOT", reason: normalized.error.code },
      };
    }
    lotCode = normalized.value;
  }

  // A month-precision expiry resolves to the last usable day, which is what GS1
  // means by an expiration month — and the policy is stated here, not guessed by
  // the parser.
  const expiresOn =
    scan.expirationDate === null
      ? null
      : gs1DateToBusinessDate(scan.expirationDate, {
          monthPrecision: "LAST_DAY_OF_MONTH",
        });
  if (expiresOn !== null && !expiresOn.ok) {
    return {
      ok: false,
      failure: { step: "LOT", reason: expiresOn.error.code },
    };
  }

  const receivedOn = businessDateFromInstant(input.instant, ASIA_BANGKOK);
  if (!receivedOn.ok) {
    return {
      ok: false,
      failure: { step: "SCAN", reason: receivedOn.error.code },
    };
  }

  return {
    ok: true,
    line: {
      itemKey: itemQuantity.value.itemKey,
      baseQuantity: baseQuantity.value,
      lotCode,
      expiresOn: expiresOn === null ? null : expiresOn.value,
      receivedOn: receivedOn.value,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                       */
/* -------------------------------------------------------------------------- */

describe("scan, resolve, convert, date", () => {
  it("captures a supplier label into an exact base quantity and a business date", () => {
    const result = captureLine({
      rawScan: `${label(
        ["01", "10614141999993"],
        ["17", "260831"],
        ["10", "LOT-A1"],
      )}\r\n`,
      capturedUom: "CASE",
      capturedMinorUnits: 3000,
      instant: receiptInstant,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.line).toEqual({
      itemKey: "ITEM-BOLT-M8",
      // 3 cases of 12 pieces: 36 pieces, exactly, in thousandths.
      baseQuantity: "36.000",
      lotCode: "LOT-A1",
      expiresOn: { year: 2026, month: 8, day: 31 },
      // 17:30 UTC is already the next day in Bangkok (D-05).
      receivedOn: { year: 2026, month: 8, day: 4 },
    });
    expect(expectOk(businessDateToIso(result.line.receivedOn))).toBe(
      "2026-08-04",
    );
    expect(
      expectOk(formatBusinessDate(result.line.receivedOn, "BUDDHIST")),
    ).toBe("2569-08-04");
  });

  it("resolves a month-precision expiry to the last day of that month", () => {
    const result = captureLine({
      rawScan: label(
        ["01", "10614141999993"],
        ["17", "260900"],
        ["10", "LOT-B2"],
      ),
      capturedUom: "CASE",
      capturedMinorUnits: 1000,
      instant: receiptInstant,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.line.expiresOn).toEqual({ year: 2026, month: 9, day: 30 });
  });

  it("rejects a half drum instead of rounding it into the ledger", () => {
    // Half of a 200.5 kg drum is 100.25 kg, which three decimals *can* hold…
    const exact = captureLine({
      rawScan: label(["01", "10614141888884"], ["10", "LOT-R1"]),
      capturedUom: "DRUM",
      capturedMinorUnits: 500,
      instant: receiptInstant,
    });
    expect(exact.ok).toBe(true);
    if (exact.ok) expect(exact.line.baseQuantity).toBe("100.250");

    // …but a thousandth of a drum is 0.2005 kg, which they cannot, so the capture
    // is refused with the exact value rather than rounded (INV-0004-05).
    const inexact = captureLine({
      rawScan: label(["01", "10614141888884"], ["10", "LOT-R1"]),
      capturedUom: "DRUM",
      capturedMinorUnits: 1,
      instant: receiptInstant,
    });
    expect(inexact.ok).toBe(false);
    if (!inexact.ok) {
      expect(inexact.failure).toEqual({
        step: "QUANTITY",
        reason: "INEXACT:401/2",
      });
    }
  });

  it("refuses a UOM the scanned item does not declare", () => {
    const result = captureLine({
      rawScan: label(["01", "10614141888884"], ["10", "LOT-R1"]),
      capturedUom: "CASE",
      capturedMinorUnits: 1000,
      instant: receiptInstant,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toEqual({
        step: "QUANTITY",
        reason: "UNKNOWN_UOM",
      });
    }
  });

  it("refuses an unknown GTIN and a mis-scanned one differently", () => {
    const unknown = captureLine({
      rawScan: "0100000000000000",
      capturedUom: "CASE",
      capturedMinorUnits: 1000,
      instant: receiptInstant,
    });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.failure).toEqual({ step: "ITEM", reason: "UNKNOWN_GTIN" });
    }

    const misScanned = captureLine({
      rawScan: "0110614141999994",
      capturedUom: "CASE",
      capturedMinorUnits: 1000,
      instant: receiptInstant,
    });
    expect(misScanned.ok).toBe(false);
    if (!misScanned.ok) {
      expect(misScanned.failure).toEqual({
        step: "SCAN",
        reason: "INVALID_GS1_SCAN",
      });
    }
  });

  it("refuses a pallet label where a product label was expected", () => {
    const lpn = expectOk(
      generateInternalLpn({ namespace, nowMs: receiptInstant, entropy }),
    );
    const result = captureLine({
      rawScan: lpn.value,
      capturedUom: "CASE",
      capturedMinorUnits: 1000,
      instant: receiptInstant,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toEqual({
        step: "SCAN",
        reason: "NOT_A_PRODUCT_LABEL:INTERNAL_LPN",
      });
    }
  });
});

describe("building the pallet", () => {
  it("issues a licence plate that validates and rescans as itself", () => {
    const lpn = expectOk(
      generateInternalLpn({ namespace, nowMs: receiptInstant, entropy }),
    );
    expect(lpn.value.startsWith("PA")).toBe(true);
    expect(parseInternalLpn(lpn.value, { namespace })).toEqual({
      ok: true,
      value: lpn,
    });
    const rescanned = expectOk(resolveScan(`${lpn.value}\r\n`, scanPolicy));
    expect(rescanned.interpretation).toEqual({ kind: "INTERNAL_LPN", lpn });
    // The printed value is reproducible from the same clock and entropy, which is
    // what makes a reprint (`G-046`) distinguishable from a relabel.
    expect(
      expectOk(
        generateInternalLpn({ namespace, nowMs: receiptInstant, entropy }),
      ).value,
    ).toBe(lpn.value);
  });

  it("refuses a neighbouring tenant's pallet label", () => {
    const theirs = expectOk(makeLpnNamespace("org_rival", "XQ"));
    const theirLpn = expectOk(
      generateInternalLpn({
        namespace: theirs,
        nowMs: receiptInstant,
        entropy,
      }),
    );
    const rejection = expectError(resolveScan(theirLpn.value, scanPolicy));
    expect(rejection.code).toBe("FOREIGN_LPN_NAMESPACE");
  });
});

describe("rotation over what was received", () => {
  const asOf = expectOk(businessDateFromInstant(receiptInstant, ASIA_BANGKOK));

  /** Three lots of the bolt item, as they would arrive from three labels. */
  const lots: readonly StockRotationCandidate[] = [
    {
      candidateKey: "bucket-lot-c",
      lotCode: "LOT-C3",
      receivedOn: expectOk(
        businessDateFromInstant(receiptInstant - 86_400_000, ASIA_BANGKOK),
      ),
      receiptSequence: 3,
      expirationDate: expectOk(
        parseGs1Expiry(
          label(["01", "10614141999993"], ["17", "270131"], ["10", "LOT-C3"]),
        ),
      ),
      bestBeforeDate: null,
      manufactureDate: null,
    },
    {
      candidateKey: "bucket-lot-a",
      lotCode: "LOT-A1",
      receivedOn: asOf,
      receiptSequence: 1,
      expirationDate: expectOk(
        parseGs1Expiry(
          label(["01", "10614141999993"], ["17", "260831"], ["10", "LOT-A1"]),
        ),
      ),
      bestBeforeDate: null,
      manufactureDate: null,
    },
    {
      candidateKey: "bucket-lot-b",
      lotCode: "LOT-B2",
      receivedOn: asOf,
      receiptSequence: 2,
      // Expired the day before this receipt: still physically present, and not
      // available for work.
      expirationDate: expectOk(
        parseGs1Expiry(
          label(["01", "10614141999993"], ["17", "260803"], ["10", "LOT-B2"]),
        ),
      ),
      bestBeforeDate: null,
      manufactureDate: null,
    },
  ];

  const fefo: StockRotationPolicy = {
    strategy: "FEFO",
    rotationDateSource: "EXPIRATION",
    missingRotationDate: "EXCLUDE",
    expired: "EXCLUDE",
  };

  it("orders the lots by expiry and excludes the expired one", () => {
    const order = expectOk(orderForRotation(lots, fefo, { asOf }));
    expect(order.ordered.map((ranking) => ranking.candidate.lotCode)).toEqual([
      "LOT-A1",
      "LOT-C3",
    ]);
    expect(order.excluded).toEqual([{ candidate: lots[2], reason: "EXPIRED" }]);
  });

  it("explains the choice in terms an operator can be shown", () => {
    const order = expectOk(orderForRotation(lots, fefo, { asOf }));
    expect(order.ordered[0]?.explanation).toEqual([
      { criterion: "ROTATION_DATE_PRESENCE", value: "PRESENT" },
      { criterion: "ROTATION_DATE", value: "2026-08-31" },
      { criterion: "RECEIVED_ON", value: "2026-08-04" },
      { criterion: "RECEIPT_SEQUENCE", value: "1" },
      { criterion: "LOT_CODE", value: "LOT-A1" },
      { criterion: "CANDIDATE_KEY", value: "bucket-lot-a" },
    ]);
  });

  it("gives a different order under FIFO, from the same lots", () => {
    const order = expectOk(
      orderForRotation(lots, { ...fefo, strategy: "FIFO" }, { asOf }),
    );
    expect(order.ordered.map((ranking) => ranking.candidate.lotCode)).toEqual([
      // Received a day earlier, despite expiring five months later.
      "LOT-C3",
      "LOT-A1",
    ]);
  });

  it("includes the expired lot when a disposal flow asks for it first", () => {
    const order = expectOk(
      orderForRotation(lots, { ...fefo, expired: "ORDER_FIRST" }, { asOf }),
    );
    expect(order.ordered.map((ranking) => ranking.candidate.lotCode)).toEqual([
      "LOT-B2",
      "LOT-A1",
      "LOT-C3",
    ]);
    expect(order.excluded).toEqual([]);
  });

  it("keeps expired stock out under every rotation source", () => {
    // §5 Q23 lets an item class rotate by manufacture or best-before date. That
    // chooses the *order*; it must not change which stock has expired. Reading
    // expiry off the configured rotation date made `LOT-B2` — expired the day
    // before this receipt — available for work as soon as the tenant rotated by
    // anything other than expiry.
    const withManufactureDates = lots.map((lot) => ({
      ...lot,
      manufactureDate: asOf,
      bestBeforeDate: asOf,
    }));
    for (const rotationDateSource of [
      "EXPIRATION",
      "BEST_BEFORE",
      "MANUFACTURE",
    ] as const) {
      const order = expectOk(
        orderForRotation(
          withManufactureDates,
          { ...fefo, rotationDateSource },
          { asOf },
        ),
      );
      expect(
        order.ordered.map((ranking) => ranking.candidate.lotCode),
      ).not.toContain("LOT-B2");
      expect(
        order.excluded.map(({ candidate, reason }) => [
          candidate.lotCode,
          reason,
        ]),
      ).toEqual([["LOT-B2", "EXPIRED"]]);
    }
  });

  it("does not treat an old manufacture date as an expiry", () => {
    // The mirror image: a lot made years ago with a valid expiry is old, not
    // expired, and a manufacture-date rotation must still offer it first.
    const oldButGood = {
      ...(lots[1] as StockRotationCandidate),
      candidateKey: "bucket-lot-old",
      lotCode: "LOT-OLD",
      manufactureDate: expectOk(parseBusinessDate("2020-01-01")),
      expirationDate: expectOk(parseBusinessDate("2027-12-31")),
    };
    const fresh = {
      ...(lots[0] as StockRotationCandidate),
      candidateKey: "bucket-lot-fresh",
      lotCode: "LOT-FRESH",
      manufactureDate: asOf,
      expirationDate: expectOk(parseBusinessDate("2027-06-30")),
    };
    const order = expectOk(
      orderForRotation(
        [fresh, oldButGood],
        { ...fefo, rotationDateSource: "MANUFACTURE" },
        { asOf },
      ),
    );
    expect(order.ordered.map((ranking) => ranking.candidate.lotCode)).toEqual([
      "LOT-OLD",
      "LOT-FRESH",
    ]);
    expect(order.ordered.map((ranking) => ranking.expired)).toEqual([
      false,
      false,
    ]);
    expect(order.excluded).toEqual([]);
  });
});

describe("a bare pallet label is never reinterpreted", () => {
  it("refuses a valid bare SSCC while the tenant has not enabled them", () => {
    // `10` + 16 digits is both a valid AI 10 element string and, for this digit
    // string, a valid SSCC. The capture path used to read it as a lot code, which
    // would have posted stock against a lot nobody printed.
    const bareSscc = "106141411234567897";
    expect(expectOk(lpnFromSscc(bareSscc)).value).toBe(bareSscc);
    const rejection = expectError(resolveScan(bareSscc, scanPolicy));
    expect(rejection.code).toBe("BARE_SSCC_DISABLED");

    const enabled = expectError(
      resolveScan(bareSscc, { ...scanPolicy, bareSscc: true }),
    );
    // Enabling bare SSCCs does not resolve this one either: both readings then
    // exist, so it is ambiguous. Either way it is a named refusal.
    expect(enabled.code).toBe("AMBIGUOUS_SCAN");
    if (enabled.code !== "AMBIGUOUS_SCAN") return;
    expect(enabled.candidates).toEqual(["GS1", "SSCC"]);
  });

  it("refuses an internal LPN when no namespace policy says whose it is", () => {
    const ourLpn = expectOk(
      generateInternalLpn({ namespace, nowMs: receiptInstant, entropy }),
    );
    const rejection = expectError(
      resolveScan(ourLpn.value, { referenceYear: 2026 }),
    );
    expect(rejection.code).toBe("LPN_NAMESPACE_POLICY_MISSING");
    expect(
      expectOk(resolveScan(ourLpn.value, scanPolicy)).interpretation.kind,
    ).toBe("INTERNAL_LPN");
  });
});

/** The expiry a label carries, as a business date. Used to build the lots above. */
function parseGs1Expiry(raw: string) {
  const scan = expectOk(parseGs1ElementString(raw, { referenceYear: 2026 }));
  const expiry = scan.expirationDate;
  if (expiry === null) throw new Error("fixture has no expiry");
  return gs1DateToBusinessDate(expiry, { monthPrecision: "LAST_DAY_OF_MONTH" });
}
