import { describe, expect, it } from "vitest";

import {
  ESTIMATE_STALE_AFTER_MS,
  estimateInputs,
  parseFundingPolicy,
  parseFxQuote,
  revalidateFundingPolicy,
  revalidateFxQuote,
  sourceState,
  unavailableEstimate,
  withCurrentStatus,
} from "./estimateSources";

const NOW = Date.parse("2026-10-11T07:00:00Z");
const FAQ = `> ## Documentation Index

# Frequently Asked Questions

export const getTotalFeeString = (type, value) => {
  if (type === 'stripe') return '5.5% ($0.80 minimum)';
  if (type === 'coinbase') return '5%';
};

export const BYOK_FEE_PERCENTAGE = '5';

OpenRouter charges a {getTotalFeeString('stripe', null)} fee when you purchase credits.
`;

describe("parseFxQuote", () => {
  it("accepts exactly USD to THB with a positive rate and valid date", () => {
    expect(
      parseFxQuote(
        { date: "2026-10-11", base: "USD", quote: "THB", rate: 33.583 },
        NOW,
      ),
    ).toEqual({ rate: 33.583, date: "2026-10-11", fetchedAt: NOW });
    // Weekend and holiday dates trail the fetch date; that is valid.
    expect(
      parseFxQuote(
        { date: "2026-10-09", base: "USD", quote: "THB", rate: 33.5 },
        NOW,
      ),
    ).not.toBeNull();
  });

  it.each([
    ["null", null],
    ["array", [33.5]],
    ["string", "33.5"],
    ["wrong base", { date: "2026-10-11", base: "EUR", quote: "THB", rate: 38 }],
    [
      "wrong quote",
      { date: "2026-10-11", base: "USD", quote: "JPY", rate: 150 },
    ],
    [
      "string rate",
      { date: "2026-10-11", base: "USD", quote: "THB", rate: "33" },
    ],
    ["zero rate", { date: "2026-10-11", base: "USD", quote: "THB", rate: 0 }],
    ["negative", { date: "2026-10-11", base: "USD", quote: "THB", rate: -33 }],
    [
      "NaN",
      { date: "2026-10-11", base: "USD", quote: "THB", rate: Number.NaN },
    ],
    [
      "infinite",
      { date: "2026-10-11", base: "USD", quote: "THB", rate: Infinity },
    ],
    ["absurd", { date: "2026-10-11", base: "USD", quote: "THB", rate: 5000 }],
    ["no date", { base: "USD", quote: "THB", rate: 33.5 }],
    ["bad date", { date: "2026-02-30", base: "USD", quote: "THB", rate: 33.5 }],
    ["format", { date: "11/10/2026", base: "USD", quote: "THB", rate: 33.5 }],
    ["future", { date: "2026-10-20", base: "USD", quote: "THB", rate: 33.5 }],
  ])("refuses %s", (_label, payload) => {
    expect(parseFxQuote(payload, NOW)).toBeNull();
  });
});

describe("parseFundingPolicy", () => {
  it("reads the stripe branch of getTotalFeeString as text", () => {
    expect(parseFundingPolicy(FAQ, NOW)).toEqual({
      percent: 5.5,
      minimumUsd: 0.8,
      fetchedAt: NOW,
    });
  });

  it("accepts double quotes and a changed published value", () => {
    expect(
      parseFundingPolicy(
        FAQ.replace("'5.5% ($0.80 minimum)'", '"6% ($1 minimum)"').replace(
          "'stripe'",
          '"stripe"',
        ),
        NOW,
      ),
    ).toEqual({ percent: 6, minimumUsd: 1, fetchedAt: NOW });
  });

  it.each([
    ["not text", 42],
    ["empty", ""],
    ["no function", FAQ.replace("getTotalFeeString =", "getFee =")],
    ["no stripe branch", FAQ.replace("'stripe'", "'card'")],
    [
      "two stripe branches",
      FAQ.replace(
        "  if (type === 'coinbase')",
        "  if (type === 'stripe') return '1% ($0 minimum)';\n  if (type === 'coinbase')",
      ),
    ],
    ["changed sentence", FAQ.replace("($0.80 minimum)", "(min $0.80)")],
    ["percent too high", FAQ.replace("5.5%", "55%")],
    ["zero percent", FAQ.replace("5.5%", "0%")],
    ["expression", FAQ.replace("'5.5% ($0.80 minimum)'", "fee()")],
    ["unterminated", FAQ.replace("\n};", "\n")],
    ["oversized", FAQ + "x".repeat(600 * 1024)],
    [
      "stripe branch outside the function",
      FAQ.replace(
        "  if (type === 'stripe') return '5.5% ($0.80 minimum)';\n",
        "",
      ) + "\nif (type === 'stripe') return '5.5% ($0.80 minimum)';",
    ],
  ])("refuses %s", (_label, markdown) => {
    expect(parseFundingPolicy(markdown, NOW)).toBeNull();
  });
});

describe("cached value checks and staleness", () => {
  it("revalidates values read back from the cache", () => {
    expect(
      revalidateFxQuote({ rate: 33.5, date: "2026-10-11", fetchedAt: NOW }),
    ).not.toBeNull();
    expect(
      revalidateFxQuote({ rate: 0, date: "2026-10-11", fetchedAt: NOW }),
    ).toBeNull();
    expect(revalidateFxQuote("33.5")).toBeNull();
    expect(
      revalidateFundingPolicy({
        percent: 5.5,
        minimumUsd: 0.8,
        fetchedAt: NOW,
      }),
    ).not.toBeNull();
    expect(
      revalidateFundingPolicy({ percent: 5.5, minimumUsd: 0.8 }),
    ).toBeNull();
    expect(revalidateFundingPolicy(null)).toBeNull();
  });

  it("marks a value stale only after its refresh window and grace", () => {
    const value = { fetchedAt: NOW };
    expect(sourceState(value, NOW + ESTIMATE_STALE_AFTER_MS).status).toBe(
      "READY",
    );
    expect(sourceState(value, NOW + ESTIMATE_STALE_AFTER_MS + 1).status).toBe(
      "STALE",
    );
    expect(sourceState(null, NOW)).toEqual({ status: "UNAVAILABLE" });
  });

  it("ages a long-open snapshot to stale without changing its values", () => {
    const estimate = {
      version: 1 as const,
      loadedAt: NOW,
      fx: {
        status: "READY" as const,
        value: { rate: 33.5, date: "2026-10-11", fetchedAt: NOW },
      },
      funding: { status: "UNAVAILABLE" as const },
    };
    expect(withCurrentStatus(estimate, NOW + 1000)).toBe(estimate);
    const aged = withCurrentStatus(estimate, NOW + ESTIMATE_STALE_AFTER_MS + 1);
    expect(aged.fx).toEqual({ status: "STALE", value: estimate.fx.value });
    expect(aged.funding).toEqual({ status: "UNAVAILABLE" });
    expect(aged.loadedAt).toBe(NOW);
    expect(Object.isFrozen(aged)).toBe(true);
  });

  it("offers no rate or fee from an unavailable snapshot", () => {
    expect(estimateInputs(null)).toEqual({ rate: null, feePercent: null });
    expect(estimateInputs(unavailableEstimate(NOW))).toEqual({
      rate: null,
      feePercent: null,
    });
  });
});
