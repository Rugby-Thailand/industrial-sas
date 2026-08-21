import { describe, expect, it } from "vitest";

import {
  claimDelivery,
  recordDeliveryResult,
  retryDeadLetter,
} from "./delivery";

describe("integration delivery state", () => {
  it("leases once, backs off retryably, and delivers once", () => {
    const claimed = claimDelivery(
      { status: "PENDING", attemptCount: 0, availableAt: 0 },
      1_000,
      60_000,
    );
    expect(claimed).toMatchObject({ ok: true, value: { attemptCount: 1 } });
    if (!claimed.ok) return;
    expect(claimDelivery(claimed.value, 2_000, 60_000)).toMatchObject({
      ok: false,
      error: { code: "LEASE_ACTIVE" },
    });
    const failed = recordDeliveryResult(
      claimed.value,
      "RETRYABLE_FAILURE",
      3_000,
      "PROVIDER_TIMEOUT",
    );
    expect(failed).toMatchObject({
      ok: true,
      value: { status: "RETRY_WAIT", availableAt: 33_000 },
    });
    if (!failed.ok) return;
    const reclaimed = claimDelivery(failed.value, 33_000, 60_000);
    expect(reclaimed.ok).toBe(true);
    if (!reclaimed.ok) return;
    expect(
      recordDeliveryResult(reclaimed.value, "DELIVERED", 34_000, undefined),
    ).toMatchObject({ ok: true, value: { status: "DELIVERED" } });
  });

  it("dead-letters permanent failure and allows deliberate retry", () => {
    const state = {
      status: "DELIVERING" as const,
      attemptCount: 1,
      availableAt: 0,
      leaseExpiresAt: 100,
    };
    const dead = recordDeliveryResult(
      state,
      "PERMANENT_FAILURE",
      10,
      "CREDENTIAL_EXPIRED",
    );
    expect(dead).toMatchObject({ ok: true, value: { status: "DEAD_LETTER" } });
    if (!dead.ok) return;
    expect(retryDeadLetter(dead.value, 20)).toMatchObject({
      ok: true,
      value: { status: "PENDING", availableAt: 20 },
    });
  });
});
