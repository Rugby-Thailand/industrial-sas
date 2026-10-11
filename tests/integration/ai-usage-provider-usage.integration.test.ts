import { describe, expect, it } from "vitest";

import {
  decodeProviderUsage,
  providerCostToNano,
  responseUsage,
} from "../../convex/lib/providerUsage";
import { UNKNOWN_USAGE } from "../../convex/model/aiUsage/usage";

const SENTINEL = "SENTINEL-PROMPT customer=Somchai";
const WHITELIST = new Set([
  "providerGenerationId",
  "actualModel",
  "isByok",
  "unitKind",
  "inputUnitCount",
  "outputUnitCount",
  "totalUnitCount",
  "reasoningUnitCount",
  "cachedInputUnitCount",
  "cacheWriteUnitCount",
  "currency",
  "costUsd",
  "costUsdNano",
  "billingStatus",
  "usageSource",
]);

describe("provider usage adapter: decimal USD to integer nano-USD", () => {
  it("keeps tiny costs, explicit zero and subset counts without inventing a price", () => {
    const usage = responseUsage({
      id: "gen-fixture",
      model: "openai/gpt-6-luna",
      choices: [{ message: { content: SENTINEL } }],
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
    expect(usage).toEqual({
      providerGenerationId: "gen-fixture",
      actualModel: "openai/gpt-6-luna",
      isByok: false,
      inputUnitCount: 3886,
      outputUnitCount: 206,
      totalUnitCount: 4092,
      reasoningUnitCount: 105,
      cachedInputUnitCount: 3883,
      cacheWriteUnitCount: 3883,
      costUsd: 0.000588675,
      costUsdNano: 588_675,
      unitKind: "MODEL_TOKEN",
      currency: "USD",
      billingStatus: "REPORTED",
      usageSource: "RESPONSE",
    });
    expect(Object.isFrozen(usage)).toBe(true);
    // Privacy: only whitelisted billing fields leave the adapter.
    expect(JSON.stringify(usage)).not.toContain("SENTINEL");
    for (const key of Object.keys(usage)) expect(WHITELIST.has(key)).toBe(true);
    expect(responseUsage({ usage: { cost: 0 } })).toMatchObject({
      costUsd: 0,
      costUsdNano: 0,
      billingStatus: "REPORTED",
    });
  });

  it.each([undefined, null, -1, -0.0001, NaN, Infinity, "0.02", 1e300, {}])(
    "records cost %j as UNKNOWN, never zero",
    (cost) => {
      const usage = responseUsage({ usage: { cost, prompt_tokens: 1 } });
      expect(usage.billingStatus).toBe("UNKNOWN");
      expect(usage.costUsdNano).toBeUndefined();
      expect(usage.costUsd).toBeUndefined();
      expect(usage.inputUnitCount).toBe(1);
    },
  );

  it.each([null, 7, "text", [], { usage: [] }, { usage: "x" }])(
    "answers unreadable body %j with unknown usage",
    (body) => {
      expect(responseUsage(body)).toEqual(UNKNOWN_USAGE);
    },
  );

  it("converts at nano precision, rounding only here", () => {
    expect(providerCostToNano(0.000588675)).toBe(588_675);
    expect(providerCostToNano(0.000603675)).toBe(603_675);
    expect(providerCostToNano(1)).toBe(1_000_000_000);
    expect(providerCostToNano(0)).toBe(0);
    // Sub-nano provider decimals round to the nearest nano; the raw decimal
    // stays in costUsd for audit.
    expect(providerCostToNano(4e-10)).toBe(0);
    expect(providerCostToNano(6e-10)).toBe(1);
    expect(responseUsage({ usage: { cost: 4e-10 } })).toMatchObject({
      costUsd: 4e-10,
      costUsdNano: 0,
      billingStatus: "REPORTED",
    });
    for (const invalid of [-1, NaN, Infinity, 1e300, "1", null, undefined])
      expect(providerCostToNano(invalid)).toBeUndefined();
  });

  it("reads generation metadata cost", () => {
    const decoded = decodeProviderUsage(
      {
        data: {
          id: "gen-a",
          total_cost: 0.000603675,
          native_tokens_prompt: 3886,
          native_tokens_completion: 12,
        },
      },
      "GENERATION_LOOKUP",
    );
    expect(decoded).toEqual({
      ok: true,
      value: {
        providerGenerationId: "gen-a",
        inputUnitCount: 3886,
        outputUnitCount: 12,
        costUsd: 0.000603675,
        costUsdNano: 603_675,
        unitKind: "MODEL_TOKEN",
        currency: "USD",
        billingStatus: "REPORTED",
        usageSource: "GENERATION_LOOKUP",
      },
    });
    expect(Object.isFrozen(decoded)).toBe(true);
    if (decoded.ok) expect(Object.isFrozen(decoded.value)).toBe(true);
  });

  it.each(["BOGUS", "", "response", undefined, null, 1, {}])(
    "refuses the forged source option %j instead of storing it",
    (source) => {
      const body = { id: "gen-a", usage: { cost: 0.1 } };
      expect(decodeProviderUsage(body, source as never)).toEqual({
        ok: false,
        error: { code: "AI_USAGE_SOURCE_INVALID" },
      });
    },
  );

  it("does not change the provider body it decodes", () => {
    const body = { id: "gen-a", usage: { cost: 0.25, prompt_tokens: 3 } };
    const before = JSON.stringify(body);
    responseUsage(body);
    decodeProviderUsage(body, "GENERATION_LOOKUP");
    expect(JSON.stringify(body)).toBe(before);
  });
});
