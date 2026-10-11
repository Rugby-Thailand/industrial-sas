import { renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { UsageEstimate } from "@/lib/aiUsage/estimateSources";
import { useUsageFormat, type UsageFormat } from "./format";

const estimate: UsageEstimate = {
  version: 1,
  loadedAt: 1,
  fx: {
    status: "READY",
    value: { rate: 40, date: "2026-10-11", fetchedAt: 1 },
  },
  funding: {
    status: "READY",
    value: { percent: 5, minimumUsd: 0.8, fetchedAt: 1 },
  },
};
function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" timeZone="Asia/Bangkok">
      {children}
    </NextIntlClientProvider>
  );
}
afterEach(() => vi.unstubAllGlobals());

describe("usage formatting", () => {
  it("keeps nano USD, sub-satang baht and explicit number precision", () => {
    const { result } = renderHook(() => useUsageFormat(estimate), { wrapper });
    expect(result.current.usd(1)).toBe("US$0.000000001");
    expect(result.current.usd(0)).toBe("US$0.00");
    expect(result.current.num(1234.5, 2)).toBe("1,234.50");
    expect(result.current.baht(0.0001)).toBe("฿0.0001");
    expect(result.current.thb(1_000_000_000)).toBe("≈ ฿40.0000");
  });

  it("uses the latest estimate after a refresh and preserves unavailable values", () => {
    const { result, rerender } = renderHook<UsageFormat, UsageEstimate | null>(
      (value) => useUsageFormat(value),
      {
        initialProps: estimate,
        wrapper,
      },
    );
    rerender({
      ...estimate,
      fx: {
        status: "STALE",
        value: { date: "2026-10-11", fetchedAt: 1, rate: 30 },
      },
    });
    expect(result.current.thb(1_000_000_000)).toBe("≈ ฿30.0000");
    rerender({ ...estimate, fx: { status: "UNAVAILABLE" } });
    expect(result.current.thb(1_000_000_000)).toBeNull();
    rerender(null);
    expect(result.current.thb(0)).toBeNull();
  });

  it("reuses number formatters for repeated report values", () => {
    let numberFormatters = 0;
    const Original = Intl.NumberFormat;
    const tracked = new Proxy(Original, {
      construct(target, args) {
        numberFormatters++;
        return Reflect.construct(target, args);
      },
    });
    vi.stubGlobal(
      "Intl",
      new Proxy(Intl, {
        get(target, key) {
          return key === "NumberFormat" ? tracked : Reflect.get(target, key);
        },
      }),
    );
    const { result } = renderHook(() => useUsageFormat(estimate), { wrapper });
    for (let index = 0; index < 1000; index++) {
      result.current.num(index / 3, [0, 1, 2, 4][index % 4]);
      result.current.usd(index);
    }
    expect(numberFormatters).toBeLessThanOrEqual(5);
  });
});
