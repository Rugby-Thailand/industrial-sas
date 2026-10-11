/**
 * Baht estimates for display and CSV only. The ledger and every total stay
 * integer nano-USD; these approximate floating-point values are derived at
 * the presentation boundary from the automatic daily USD/THB rate and
 * OpenRouter's published card funding percentage, and are rounded only when
 * shown. The funding fee is an estimate of a credit purchase fee, not a
 * charge on each call.
 */
const NANO_PER_USD = 1_000_000_000;

export interface ThbEstimate {
  /** Confirmed USD at the reference rate. */
  readonly inference: number;
  /** Null when no published funding percentage is available: never zero. */
  readonly fundingFee: number | null;
  readonly withFundingFee: number | null;
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * Confirmed nano-USD × USD/THB, with the funding fee estimated separately.
 * Null without a valid amount and rate, so a broken value is shown as
 * unavailable rather than as `NaN` baht. A missing or invalid percentage
 * leaves only the fee and total unavailable; it is never treated as 0%.
 */
export function estimateThb(
  nano: unknown,
  usdThbRate: unknown,
  feePercent: unknown,
): ThbEstimate | null {
  if (!finite(nano) || nano < 0 || !finite(usdThbRate) || usdThbRate <= 0)
    return null;
  const inference = (nano / NANO_PER_USD) * usdThbRate;
  const fee =
    finite(feePercent) && feePercent >= 0 && feePercent <= 100
      ? feePercent
      : null;
  return Object.freeze({
    inference,
    fundingFee: fee === null ? null : (inference * fee) / 100,
    withFundingFee: fee === null ? null : inference * (1 + fee / 100),
  });
}
