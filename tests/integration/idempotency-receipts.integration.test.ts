import { describe, expect, it } from "vitest";

import {
  resultIdentityDigest,
  sha256Hex,
  verifiedResultIdentity,
} from "../../convex/lib/idempotency";

// The receipt digest shared by finished-goods `command`, HR `hrCommand` and
// the master-data write helpers. Their replay policies stay feature-owned;
// these cases pin only the shared identity check.
describe("idempotency result identity", () => {
  it("keeps the stored digest format of existing receipts", async () => {
    expect(await resultIdentityDigest("hrPeriods", "abc")).toBe(
      await sha256Hex("hrPeriods:abc"),
    );
  });

  it("returns the replayed document only for the table it answered", async () => {
    const resultHash = await resultIdentityDigest("finishedGoodsPallets", "p1");
    expect(
      await verifiedResultIdentity(
        { resultRef: "p1", resultHash },
        "finishedGoodsPallets",
      ),
    ).toBe("p1");
    expect(
      await verifiedResultIdentity(
        { resultRef: "p1", resultHash },
        "finishedGoodsProducts",
      ),
    ).toBeNull();
    expect(
      await verifiedResultIdentity(
        { resultRef: "p2", resultHash },
        "finishedGoodsPallets",
      ),
    ).toBeNull();
  });

  it("treats a missing reference or digest as unverifiable", async () => {
    const resultHash = await resultIdentityDigest("hrPeriods", "x");
    expect(
      await verifiedResultIdentity({ resultHash }, "hrPeriods"),
    ).toBeNull();
    expect(
      await verifiedResultIdentity({ resultRef: "", resultHash }, "hrPeriods"),
    ).toBeNull();
    expect(
      await verifiedResultIdentity({ resultRef: "x" }, "hrPeriods"),
    ).toBeNull();
  });
});
