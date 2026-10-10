import { describe, expect, it } from "vitest";
import { estimatedThb, normalizeUsage, reportRange } from "./usage";

describe("provider accounting", () => {
  it("keeps tiny costs, explicit zero, and subset unit counts without inventing a price", () => {
    const usage = normalizeUsage({
      id: "gen-fixture",
      model: "openai/gpt-6-luna",
      usage: {
        prompt_tokens: 3886,
        completion_tokens: 206,
        total_tokens: 4092,
        cost: 0.000588675,
        is_byok: false,
        prompt_tokens_details: {
          cached_tokens: 3883,
          cache_write_tokens: 3883,
        },
        completion_tokens_details: { reasoning_tokens: 105 },
      },
    });
    expect(usage).toMatchObject({
      costUsdNano: 588675,
      totalUnitCount: 4092,
      reasoningUnitCount: 105,
      cachedInputUnitCount: 3883,
      billingStatus: "REPORTED",
    });
    expect(normalizeUsage({ usage: { cost: 0 } })).toMatchObject({
      costUsdNano: 0,
      billingStatus: "REPORTED",
    });
    for (const cost of [undefined, null, -1, NaN, Infinity, "0.02"])
      expect(normalizeUsage({ usage: { cost } }).billingStatus).toBe("UNKNOWN");
  });
  it("uses reported generation cost and separates the funding fee", () => {
    expect(
      normalizeUsage(
        {
          data: {
            id: "gen-a",
            total_cost: 0.000603675,
            native_tokens_prompt: 3886,
          },
        },
        "GENERATION_LOOKUP",
      ),
    ).toMatchObject({
      costUsdNano: 603675,
      inputUnitCount: 3886,
      usageSource: "GENERATION_LOOKUP",
    });
    const result = estimatedThb(603675, 33.53, 5.5);
    expect(result.inference).toBeCloseTo(0.000603675 * 33.53, 12);
    expect(result.withFundingFee).toBeCloseTo(result.inference * 1.055, 12);
    expect(result.fundingFee).toBeCloseTo(result.inference * 0.055, 12);
  });
  it("starts this month in Bangkok, independent of the browser timezone", () => {
    const r = reportRange(
      "Asia/Bangkok",
      Date.parse("2026-09-30T17:01:00Z"),
      {},
    );
    expect(r.from).toBe("2026-10-01");
    expect(r.to).toBe("2026-10-01");
    expect(new Date(r.start).toISOString()).toBe("2026-09-30T17:00:00.000Z");
    expect(new Date(r.end).toISOString()).toBe("2026-10-01T17:00:00.000Z");
    expect(r.utcDays).toHaveLength(2);
    expect(() =>
      reportRange("Asia/Bangkok", 0, { from: "2026-02-30", to: "2026-03-01" }),
    ).toThrow();
    expect(() => reportRange("America/New_York", 0, {})).toThrow(
      "TIMEZONE_UNSUPPORTED",
    );
  });
});
