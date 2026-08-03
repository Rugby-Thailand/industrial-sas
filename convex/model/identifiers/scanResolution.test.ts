/**
 * Unit tier — the scan precedence ladder.
 *
 * Each rung gets a case, and so does each of the four rules that sit on top of the
 * order. The rejections are the point of the file: a mis-scanned pallet label, a
 * neighbouring tenant's LPN, and a string with two readings must all come back as
 * named refusals with the raw scan attached, never as a plausible SKU.
 */
import { describe, expect, it } from "vitest";

import { expectError, expectOk } from "../../../tests/fixtures/domain-results";
import { GROUP_SEPARATOR } from "../gs1/elementString";
import {
  generateInternalLpn,
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

  it("accepts any well-formed LPN when no namespace is registered", () => {
    expect(
      expectOk(resolveScan(lpn.value, { referenceYear: 2026 })).interpretation
        .kind,
    ).toBe("INTERNAL_LPN");
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
    const raw = `01${GTIN14}${GROUP_SEPARATOR}99XX`;
    expect(expectError(resolveScan(raw, policy))).toEqual({
      code: "INVALID_GS1_SCAN",
      raw,
      normalized: raw,
      error: { code: "UNKNOWN_AI", ai: "99", offset: 17 },
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

  it("still lets a badly formed LPN-shaped string be a SKU", () => {
    // Right length and alphabet, wrong check character: this was never an LPN.
    const notAnLpn = `PA${"A".repeat(13)}`;
    expect(expectOk(resolveScan(notAnLpn, policy)).interpretation).toEqual({
      kind: "SKU",
      sku: notAnLpn,
    });
  });
});

describe("rule 4 — two readings is an ambiguity", () => {
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

  it("reads the same string as a GS1 lot when bare SSCCs are off", () => {
    // With one reading available the scan resolves, and the tenant's label policy
    // is what decides which reading exists.
    const resolved = expectOk(resolveScan(SSCC18, policy));
    expect(resolved.interpretation.kind).toBe("GS1");
    if (resolved.interpretation.kind !== "GS1") return;
    expect(resolved.interpretation.scan.lot).toBe("6141411234567897");
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
