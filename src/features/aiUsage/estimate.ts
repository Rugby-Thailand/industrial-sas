/**
 * Baht estimates for display and CSV only. The ledger and every total stay
 * integer nano-USD; these approximate floating-point values are derived at
 * the presentation boundary from the administrator's saved FX rate and the
 * funding-fee estimate, and are rounded only when shown.
 */
const NANO_PER_USD = 1_000_000_000;

export interface ThbEstimate {
  readonly inference: number;
  readonly fundingFee: number;
  readonly withFundingFee: number;
}

/**
 * Confirmed nano-USD × USD/THB, with the funding fee estimated separately.
 * Null when any input is outside what the settings form accepts, so a broken
 * value is shown as unavailable rather than as `NaN` baht.
 */
export function estimateThb(
  nano: unknown,
  usdThbRate: unknown,
  feePercent: unknown,
): ThbEstimate | null {
  if (
    typeof nano !== "number" ||
    !Number.isFinite(nano) ||
    nano < 0 ||
    typeof usdThbRate !== "number" ||
    !Number.isFinite(usdThbRate) ||
    usdThbRate <= 0 ||
    typeof feePercent !== "number" ||
    !Number.isFinite(feePercent) ||
    feePercent < 0 ||
    feePercent > 100
  )
    return null;
  const inference = (nano / NANO_PER_USD) * usdThbRate;
  return Object.freeze({
    inference,
    fundingFee: (inference * feePercent) / 100,
    withFundingFee: inference * (1 + feePercent / 100),
  });
}
