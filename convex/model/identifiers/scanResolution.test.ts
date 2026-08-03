/**
 * Unit tier — the scan precedence ladder.
 *
 * Each rung gets a case, and so does each rule that sits on top of the order. The
 * rejections are the point of the file: a mis-scanned pallet label, a
 * neighbouring tenant's LPN, a valid SSCC a tenant has not enabled, and a string
 * with two readings must all come back as named refusals with the raw scan
 * attached, never as a plausible SKU.
 */
import { describe, expect, it } from "vitest";

import { expectError, expectOk } from "../../../tests/fixtures/domain-results";
import { gs1CheckDigit } from "../gs1/checkDigit";
import { GROUP_SEPARATOR } from "../gs1/elementString";
import {
  generateInternalLpn,
  lpnFromSscc,
  makeLpnNamespace,
  type EntropySource,
} from "./lpn";
import { resolveScan, type ScanResolutionPolicy } from "./scanResolution";

const namespace = expectOk(makeLpnNamespace("org_acme", "PA"));
const foreign = expectOk(makeLpnNamespace("org_rival", "XQ"));
const entropy: EntropySource = (byteLength) =>
  new Uint8Array(Array.from({ length: byteLength }, () => 7));
const lpn = expectOk(
  generateInternalLpn({ namespace, nowMs: 1_800_000_000_000, entropy }),
);

const policy: ScanResolutionPolicy = {
  referenceYear: 2026,
  namespaces: [namespace],
};

const GTIN14 = "10614141999993";
const SSCC18 = "106141411234567897";

describe("resolveScan", () => {
  it("prefers a GS1 element string and keeps the raw scan", () => {
    const raw = `01${GTIN14}10LOT-A1\r\n`;
    const resolved = expectOk(resolveScan(raw, policy));
    expect(resolved.interpretation.kind).toBe("GS1");
    if (resolved.interpretation.kind !== "GS1") return;
    expect(resolved.interpretation.scan.lot).toBe("LOT-A1");
    expect(resolved.raw).toBe(raw);
    expect(resolved.normalized).toBe(`01${GTIN14}10LOT-A1`);
  });

  it("falls to the internal LPN when the string is not GS1", () => {
    expect(expectOk(resolveScan(lpn.value, policy)).interpretation).toEqual({
      kind: "INTERNAL_LPN",
      lpn,
    });
  });

  it("refuses to classify an LPN with no namespace policy to classify it by", () => {
    // An absent or empty `namespaces` used to accept any well-formed internal
    // LPN, which meant a neighbouring tenant's pallet label resolved as ours.
    for (const rules of [
      { referenceYear: 2026 },
      { referenceYear: 2026, namespaces: [] },
    ] satisfies ScanResolutionPolicy[]) {
      expect(expectError(resolveScan(lpn.value, rules))).toEqual({
        code: "LPN_NAMESPACE_POLICY_MISSING",
        raw: lpn.value,
        normalized: lpn.value,
        prefix: "PA",
      });
    }
  });

  it("falls to a bare GTIN and normalizes it to 14 digits", () => {
    expect(
      expectOk(resolveScan("4006381333931", policy)).interpretation,
    ).toEqual({ kind: "GTIN", gtin14: "04006381333931" });
  });

  it("falls to a SKU last, folding its case", () => {
    expect(expectOk(resolveScan("bolt-m8", policy)).interpretation).toEqual({
      kind: "SKU",
      sku: "BOLT-M8",
    });
  });

  it("still reads a numeric item code that only looks like a truncated AI", () => {
    // "01" followed by too few digits is a shape error, not a content error, so
    // the ladder continues and the code resolves as the SKU it is.
    expect(expectOk(resolveScan("0100123", policy)).interpretation).toEqual({
      kind: "SKU",
      sku: "0100123",
    });
  });
});

describe("rule 1 — a scan that can only be GS1 is decided by the parser alone", () => {
  it("rejects an FNC1-bearing scan with the parse error", () => {
    const raw = `10LOT-A1${GROUP_SEPARATOR}99XX`;
    expect(expectError(resolveScan(raw, policy))).toEqual({
      code: "INVALID_GS1_SCAN",
      raw,
      normalized: raw,
      error: { code: "UNKNOWN_AI", ai: "99", offset: 9 },
    });
  });

  it("rejects a separator a scanner put where the specification has none", () => {
    const raw = `01${GTIN14}${GROUP_SEPARATOR}17260831`;
    expect(expectError(resolveScan(raw, policy))).toEqual({
      code: "INVALID_GS1_SCAN",
      raw,
      normalized: raw,
      error: { code: "UNEXPECTED_SEPARATOR", offset: 16 },
    });
  });

  it("rejects an unknown symbology identifier without trying other rungs", () => {
    const rejection = expectError(resolveScan(`]A001${GTIN14}`, policy));
    expect(rejection.code).toBe("INVALID_GS1_SCAN");
  });
});

describe("rule 2 — content errors are fatal, shape errors are not", () => {
  it("rejects a mis-scanned GTIN instead of treating it as an item code", () => {
    const raw = "0110614141999994";
    expect(expectError(resolveScan(raw, policy))).toEqual({
      code: "INVALID_GS1_SCAN",
      raw,
      normalized: raw,
      error: {
        code: "INVALID_CHECK_DIGIT",
        ai: "01",
        value: "10614141999994",
      },
    });
  });

  it("rejects an impossible date in a GS1-shaped scan", () => {
    const rejection = expectError(resolveScan(`01${GTIN14}17261301`, policy));
    expect(rejection.code).toBe("INVALID_GS1_SCAN");
  });
});

describe("rule 3 — a foreign LPN is refused, not reinterpreted", () => {
  it("names the prefix and the registered namespaces", () => {
    expect(
      expectError(resolveScan(lpn.value, { ...policy, namespaces: [foreign] })),
    ).toEqual({
      code: "FOREIGN_LPN_NAMESPACE",
      raw: lpn.value,
      normalized: lpn.value,
      prefix: "PA",
      registered: ["XQ"],
    });
  });

  it("rejects a scan shaped like one of ours with a bad check character", () => {
    // Right prefix, right length, wrong check character: a damaged or mis-keyed
    // label of ours. It used to fall through to the SKU rung, which turned a
    // corrupt pallet label into an item lookup.
    const damaged = `${lpn.value.slice(0, -1)}${
      lpn.value.endsWith("A") ? "B" : "A"
    }`;
    const rejection = expectError(resolveScan(damaged, policy));
    expect(rejection.code).toBe("INVALID_LPN_SCAN");
    if (rejection.code !== "INVALID_LPN_SCAN") return;
    expect(rejection.prefix).toBe("PA");
    expect(rejection.normalized).toBe(damaged);
    expect(rejection.error.code).toBe("CHECK_CHARACTER_MISMATCH");
  });

  it("still lets an LPN-shaped string under no registered prefix be a SKU", () => {
    // `QQ…` is the right alphabet and length, but no registered namespace claims
    // it, so nothing here can call it a licence plate.
    const notOurs = `QQ${"A".repeat(13)}`;
    expect(expectOk(resolveScan(notOurs, policy)).interpretation).toEqual({
      kind: "SKU",
      sku: notOurs,
    });
  });
});

describe("rules 6 and 7 — a bare SSCC, and two readings", () => {
  it("rejects a bare SSCC that is also a valid GS1 lot element string", () => {
    // 106141411234567897 is a valid SSCC and, read as an element string, AI 10
    // with a 16-character lot code. Enabling bare SSCCs makes both readings
    // available, and the scan is refused rather than one being preferred.
    expect(
      expectError(resolveScan(SSCC18, { ...policy, bareSscc: true })),
    ).toEqual({
      code: "AMBIGUOUS_SCAN",
      raw: SSCC18,
      normalized: SSCC18,
      candidates: ["GS1", "SSCC"],
    });
  });

  it("never reads a valid bare SSCC as a lot code, a GTIN, or a SKU", () => {
    // This is the case the earlier ladder got wrong: with bare SSCCs off, an
    // 18-digit SSCC beginning `10` resolved as AI 10 with a 16-character lot
    // code, and stock would have posted against a lot that does not exist.
    expect(expectError(resolveScan(SSCC18, policy))).toEqual({
      code: "BARE_SSCC_DISABLED",
      raw: SSCC18,
      normalized: SSCC18,
      sscc18: SSCC18,
    });
  });

  it("rejects a bare SSCC that no other rung can read either", () => {
    // 18 digits beginning `99` is not a GS1 element string at all, so before the
    // rule it fell all the way to the SKU rung.
    const body = "99314141123456789";
    const plainSscc = `${body}${expectOk(gs1CheckDigit(body))}`;
    expect(expectOk(lpnFromSscc(plainSscc)).value).toBe(plainSscc);
    const rejection = expectError(resolveScan(plainSscc, policy));
    expect(rejection.code).toBe("BARE_SSCC_DISABLED");
    expect(
      expectOk(resolveScan(plainSscc, { ...policy, bareSscc: true }))
        .interpretation,
    ).toEqual({ kind: "SSCC", lpn: { kind: "SSCC", value: plainSscc } });
  });

  it("still rejects an 18-digit string that is not a valid SSCC", () => {
    // One digit changed: the check digit fails, so it is not an SSCC and the
    // ladder continues. `10` + 16 digits is a valid AI 10 element string.
    const notAnSscc = "106141411234567890";
    expect(lpnFromSscc(notAnSscc).ok).toBe(false);
    const resolved = expectOk(resolveScan(notAnSscc, policy));
    expect(resolved.interpretation.kind).toBe("GS1");
    if (resolved.interpretation.kind !== "GS1") return;
    expect(resolved.interpretation.scan.lot).toBe("6141411234567890");
  });
});

describe("policy validation", () => {
  it("rejects a reference year the GS1 date rule cannot use", () => {
    for (const referenceYear of [Number.NaN, 1969, 3000, 2026.5]) {
      expect(
        expectError(resolveScan("bolt-m8", { ...policy, referenceYear })),
      ).toEqual({
        code: "INVALID_SCAN_POLICY",
        raw: "bolt-m8",
        field: "referenceYear",
      });
    }
    expect(
      expectError(
        resolveScan("bolt-m8", null as unknown as ScanResolutionPolicy),
      ).code,
    ).toBe("INVALID_SCAN_POLICY");
  });

  it("rejects a namespace that is not a registered one", () => {
    const rejection = expectError(
      resolveScan("bolt-m8", {
        ...policy,
        namespaces: [{ organizationKey: "org_acme", prefix: "1A" } as never],
      }),
    );
    expect(rejection.code).toBe("INVALID_SCAN_POLICY");
    if (rejection.code !== "INVALID_SCAN_POLICY") return;
    expect(rejection.field).toBe("namespaces");
  });

  // A prefix belongs to one organization — that is the whole basis of rule 4,
  // which decides whose pallet a scan is by matching its prefix. A table that
  // claimed one prefix for two organizations made that answer meaningless, and the
  // policy accepted it silently.
  it("rejects one prefix claimed by two organization keys", () => {
    const rejection = expectError(
      resolveScan("bolt-m8", {
        ...policy,
        namespaces: [
          expectOk(makeLpnNamespace("org_acme", "PA")),
          expectOk(makeLpnNamespace("org_rival", "PA")),
        ],
      }),
    );
    expect(rejection).toEqual({
      code: "INVALID_SCAN_POLICY",
      raw: "bolt-m8",
      field: "namespaces",
    });
    // Case folding must not be a way around it: `pa` and `PA` are one prefix.
    expect(
      expectError(
        resolveScan("bolt-m8", {
          ...policy,
          namespaces: [
            expectOk(makeLpnNamespace("org_acme", "PA")),
            expectOk(makeLpnNamespace("org_rival", "pa")),
          ],
        }),
      ).code,
    ).toBe("INVALID_SCAN_POLICY");
  });

  it("rejects a duplicated organization key and prefix pair", () => {
    // Harmless-looking, and it corrupts what a rejection reports: the registered
    // prefixes on `FOREIGN_LPN_NAMESPACE` would list the same prefix twice.
    expect(
      expectError(
        resolveScan("bolt-m8", {
          ...policy,
          namespaces: [namespace, namespace],
        }),
      ),
    ).toEqual({
      code: "INVALID_SCAN_POLICY",
      raw: "bolt-m8",
      field: "namespaces",
    });
    expect(
      expectError(
        resolveScan("bolt-m8", {
          ...policy,
          namespaces: [
            expectOk(makeLpnNamespace("org_acme", "PA")),
            expectOk(makeLpnNamespace(" org_acme ", "pa")),
          ],
        }),
      ).code,
    ).toBe("INVALID_SCAN_POLICY");
  });

  it("still accepts one organization holding several distinct prefixes", () => {
    const several: ScanResolutionPolicy = {
      referenceYear: 2026,
      namespaces: [
        expectOk(makeLpnNamespace("org_acme", "PA")),
        expectOk(makeLpnNamespace("org_acme", "PAB")),
        expectOk(makeLpnNamespace("org_acme", "BX")),
      ],
    };
    expect(expectOk(resolveScan("bolt-m8", several)).interpretation).toEqual({
      kind: "SKU",
      sku: "BOLT-M8",
    });
  });

  // `claimedNamespacePrefix` walks the namespaces in order, so the question is
  // whether two registered prefixes can both claim one scan. They cannot: the
  // expected length is `prefix.length + 14`, so a scan of a given length can only
  // be claimed by a prefix of one length, and two prefixes of the same length that
  // both prefix the same string are the same prefix. These assertions pin that,
  // because it is the reason the rule can stay a first match.
  it("claims the same prefix whatever order the namespaces are declared in", () => {
    const short = expectOk(makeLpnNamespace("org_acme", "PA"));
    const long = expectOk(makeLpnNamespace("org_acme", "PAB"));
    const underShort = expectOk(
      generateInternalLpn({
        namespace: short,
        nowMs: 1_800_000_000_000,
        entropy,
      }),
    );
    const underLong = expectOk(
      generateInternalLpn({
        namespace: long,
        nowMs: 1_800_000_000_000,
        entropy,
      }),
    );
    const broken = (value: string) =>
      value.slice(0, -1) + (value.endsWith("0") ? "1" : "0");
    const orders: readonly (readonly [typeof short, typeof long])[] = [
      [short, long],
      [long, short],
    ];
    for (const order of orders) {
      const withOrder: ScanResolutionPolicy = {
        referenceYear: 2026,
        namespaces: order,
      };
      const shortRejection = expectError(
        resolveScan(broken(underShort.value), withOrder),
      );
      expect(shortRejection.code).toBe("INVALID_LPN_SCAN");
      if (shortRejection.code !== "INVALID_LPN_SCAN") return;
      expect(shortRejection.prefix).toBe("PA");

      const longRejection = expectError(
        resolveScan(broken(underLong.value), withOrder),
      );
      expect(longRejection.code).toBe("INVALID_LPN_SCAN");
      if (longRejection.code !== "INVALID_LPN_SCAN") return;
      expect(longRejection.prefix).toBe("PAB");
    }
  });

  it("rejects a flag that is not a boolean", () => {
    expect(
      expectError(
        resolveScan("bolt-m8", {
          ...policy,
          bareSscc: "yes" as unknown as boolean,
        }),
      ).code,
    ).toBe("INVALID_SCAN_POLICY");
    expect(
      expectError(
        resolveScan("bolt-m8", {
          ...policy,
          skuFallback: 1 as unknown as boolean,
        }),
      ).code,
    ).toBe("INVALID_SCAN_POLICY");
  });

  it("treats a scan that is not a string as unreadable", () => {
    expect(
      expectError(resolveScan(undefined as unknown as string, policy)),
    ).toEqual({
      code: "UNREADABLE_SCAN",
      raw: undefined,
      error: { code: "EMPTY", raw: "undefined" },
    });
  });

  it("freezes what it returns", () => {
    const resolved = expectOk(resolveScan("bolt-m8", policy));
    expect(Object.isFrozen(resolved)).toBe(true);
  });
});

describe("rejections", () => {
  it("separates an unreadable scan from an unrecognised one", () => {
    expect(expectError(resolveScan("\r\n", policy))).toEqual({
      code: "UNREADABLE_SCAN",
      raw: "\r\n",
      error: { code: "EMPTY", raw: "\r\n" },
    });
    expect(expectError(resolveScan("AB\u0000CD", policy)).code).toBe(
      "UNREADABLE_SCAN",
    );
  });

  it("explains an unrecognised scan rung by rung", () => {
    const raw = "BOLT M8";
    const rejection = expectError(resolveScan(raw, policy));
    expect(rejection.code).toBe("UNRECOGNIZED_SCAN");
    if (rejection.code !== "UNRECOGNIZED_SCAN") return;
    expect(rejection.raw).toBe(raw);
    expect(rejection.attempts).toEqual([
      { stage: "GS1", reason: "NOT_APPLICABLE" },
      { stage: "INTERNAL_LPN", reason: "NOT_APPLICABLE" },
      { stage: "SSCC", reason: "DISABLED" },
      { stage: "GTIN", reason: "NOT_DIGITS" },
      { stage: "SKU", reason: "WHITESPACE_NOT_ALLOWED" },
    ]);
  });

  it("can be told not to accept a SKU at all", () => {
    const rejection = expectError(
      resolveScan("bolt-m8", { ...policy, skuFallback: false }),
    );
    expect(rejection.code).toBe("UNRECOGNIZED_SCAN");
    if (rejection.code !== "UNRECOGNIZED_SCAN") return;
    expect(rejection.attempts).toContainEqual({
      stage: "SKU",
      reason: "DISABLED",
    });
  });
});
