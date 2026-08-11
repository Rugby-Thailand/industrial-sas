/**
 * Quality control, as the two decisions it actually is.
 *
 * 1. **How much to look at.** A sampling plan, from a strategy the tenant
 *    configured and the size of the delivery.
 * 2. **Where held stock may go.** A disposition, which is a *balanced ledger
 *    transition* between stock statuses, never an edit to a status field
 *    (`ADR-0007` §6, `INV-0007-05`).
 *
 * Both are pure. No clock, no database, no Convex import (plan §6.2).
 *
 * ### Simple sampling only, and the refusal is explicit
 *
 * `ALL`, `FIXED`, and `PERCENT` (`ADR-0007` §5). Statistical AQL / ISO 2859 is
 * deliberately out of scope (plan §2.3), and this module refuses an `AQL`
 * strategy by *name* rather than falling through to a default. A silent fallback
 * to "inspect everything" would be the most expensive possible wrong answer, and
 * a silent fallback to `FIXED` would let a regulated customer believe a sampling
 * plan had been applied that never was (`B-01`).
 *
 * ### Why a disposition is a transition table and not a status assignment
 *
 * `QC_HOLD` stock leaves only through one of five dispositions, and each lands in
 * a specific bucket. Expressing that as "set the status to whatever the operator
 * chose" would let held stock reach `AVAILABLE` with no ledger movement, which is
 * exactly the bypass `ADR-0005` rejects: a balance query would then disagree with
 * the transaction history, and the disagreement would be invisible.
 */
import { fail, ok, type Result } from "../result";

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

export type QcPolicyError =
  | {
      readonly code: "SAMPLING_STRATEGY_UNSUPPORTED";
      readonly strategy: string;
    }
  | { readonly code: "SAMPLING_PARAMETER_INVALID"; readonly field: string }
  | { readonly code: "LOT_SIZE_INVALID"; readonly field: string }
  | { readonly code: "DISPOSITION_UNKNOWN"; readonly disposition: string }
  | { readonly code: "SOURCE_STATUS_NOT_HELD"; readonly status: string }
  | { readonly code: "REASON_REQUIRED"; readonly field: string }
  | { readonly code: "INSPECTION_NOT_OPEN"; readonly status: string };

/* -------------------------------------------------------------------------- */
/* Sampling                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The strategies this repository implements.
 *
 * A closed union rather than a string, so a profile row carrying `AQL` fails to
 * type-check at the boundary that reads it rather than at a dock.
 */
export type SamplingStrategy = "ALL" | "FIXED" | "PERCENT";

/** Strategies named in the plan and deliberately not implemented (plan §2.3). */
export const UNSUPPORTED_SAMPLING_STRATEGIES: readonly string[] = Object.freeze(
  ["AQL", "ISO_2859"],
);

export interface SamplingPlanInput {
  readonly strategy: string;
  /**
   * The strategy's parameter: the count for `FIXED`, the whole-number percentage
   * for `PERCENT`, ignored for `ALL`.
   */
  readonly parameter?: number | undefined;
  /** How many units are being offered for inspection, in whole units. */
  readonly lotSize: number;
}

export interface SamplingPlan {
  readonly strategy: SamplingStrategy;
  readonly sampleSize: number;
  readonly lotSize: number;
  /** True when the plan asks the inspector to look at the whole delivery. */
  readonly inspectsEverything: boolean;
}

const MAX_LOT_SIZE = 1_000_000_000;

/**
 * Work out how many units an inspector must look at.
 *
 * Three rules worth stating, because each has a plausible wrong version:
 *
 * - **`PERCENT` rounds up.** A 10% sample of 15 units is 1.5, and inspecting one
 *   is less than the tenant configured. Rounding down would quietly weaken every
 *   sampling plan on odd lot sizes.
 * - **A sample is never zero for a non-empty delivery.** A configured 1% of 50
 *   units rounds up to 1 anyway, but a `FIXED` plan of zero would mean "QC is
 *   configured and nothing is inspected", which reads as a passed inspection in
 *   every report that counts them.
 * - **A sample never exceeds the lot.** `FIXED 100` against 30 units inspects 30,
 *   because the other 70 do not exist.
 */
export function planSample(
  input: SamplingPlanInput,
): Result<SamplingPlan, QcPolicyError> {
  if (UNSUPPORTED_SAMPLING_STRATEGIES.includes(input.strategy)) {
    return fail({
      code: "SAMPLING_STRATEGY_UNSUPPORTED",
      strategy: input.strategy,
    });
  }
  if (
    input.strategy !== "ALL" &&
    input.strategy !== "FIXED" &&
    input.strategy !== "PERCENT"
  ) {
    return fail({
      code: "SAMPLING_STRATEGY_UNSUPPORTED",
      strategy: input.strategy,
    });
  }
  if (!Number.isSafeInteger(input.lotSize) || input.lotSize <= 0) {
    return fail({ code: "LOT_SIZE_INVALID", field: "lotSize" });
  }
  if (input.lotSize > MAX_LOT_SIZE) {
    return fail({ code: "LOT_SIZE_INVALID", field: "lotSize" });
  }

  const strategy: SamplingStrategy = input.strategy;

  if (strategy === "ALL") {
    return ok(
      Object.freeze({
        strategy,
        sampleSize: input.lotSize,
        lotSize: input.lotSize,
        inspectsEverything: true,
      }),
    );
  }

  const parameter = input.parameter;
  if (!Number.isSafeInteger(parameter) || (parameter ?? 0) <= 0) {
    return fail({ code: "SAMPLING_PARAMETER_INVALID", field: "parameter" });
  }
  const value = parameter as number;

  if (strategy === "PERCENT" && value > 100) {
    return fail({ code: "SAMPLING_PARAMETER_INVALID", field: "parameter" });
  }

  const raw =
    strategy === "FIXED" ? value : Math.ceil((input.lotSize * value) / 100);
  const sampleSize = Math.min(input.lotSize, Math.max(1, raw));

  return ok(
    Object.freeze({
      strategy,
      sampleSize,
      lotSize: input.lotSize,
      inspectsEverything: sampleSize === input.lotSize,
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Applicability                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Whether a receipt is QC-controlled at all (`ADR-0007` §8).
 *
 * Not every receipt is blocked, and the profile that decides is configured per
 * item and per supplier. The **more specific** profile wins: an item profile
 * beats a supplier profile, because "this component is critical" is a stronger
 * statement than "this vendor is generally reliable".
 *
 * With no profile the answer is *not controlled*. That is the honest default for
 * an unconfigured tenant: inventing a hold nobody configured would strand stock
 * at the dock on day one, and `OPS-0007-03` is the open gate that says which
 * items and suppliers are actually gated.
 */
export interface QcProfileMatch {
  readonly scope: "ITEM" | "SUPPLIER";
  readonly enabled: boolean;
  readonly strategy: string;
  readonly parameter?: number | undefined;
}

export interface QcApplicability {
  readonly controlled: boolean;
  readonly matched?: QcProfileMatch | undefined;
}

export function resolveQcApplicability(
  profiles: readonly QcProfileMatch[],
): QcApplicability {
  const item = profiles.find((profile) => profile.scope === "ITEM");
  const supplier = profiles.find((profile) => profile.scope === "SUPPLIER");
  const matched = item ?? supplier;

  if (matched === undefined) return Object.freeze({ controlled: false });
  return Object.freeze({ controlled: matched.enabled, matched });
}

/** The stock status a receipt lands in, given its QC applicability. */
export const receiptStockStatus = (
  applicability: QcApplicability,
): "AVAILABLE" | "QC_HOLD" =>
  applicability.controlled ? "QC_HOLD" : "AVAILABLE";

/* -------------------------------------------------------------------------- */
/* Dispositions                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The five ways stock leaves `QC_HOLD` (`ADR-0007` §6).
 *
 * `REWORK` returns stock to `QC_HOLD` on purpose. It is not a no-op: the ledger
 * records that a decision was taken and the inspection closed, and the stock is
 * then re-inspected under a new inspection. Modelling it as "do nothing" would
 * lose the only evidence that anybody looked.
 */
export type QcDisposition =
  "RELEASE" | "QUARANTINE" | "REJECT" | "SCRAP" | "REWORK";

/** Where each disposition sends the stock. */
const DISPOSITION_TARGETS: Readonly<Record<QcDisposition, string>> =
  Object.freeze({
    RELEASE: "AVAILABLE",
    QUARANTINE: "QUARANTINE",
    REJECT: "REJECTED",
    SCRAP: "SCRAP",
    REWORK: "QC_HOLD",
  });

/**
 * Which dispositions need a second person (`INV-0007-06`).
 *
 * `RELEASE` and `SCRAP` are the two that are irreversible in practice: released
 * stock ships and scrapped stock is destroyed. `QUARANTINE`, `REJECT`, and
 * `REWORK` all keep the stock unavailable and recoverable, so a single inspector
 * may take them and the delivery is not blocked waiting for a supervisor.
 */
const REQUIRES_APPROVAL: Readonly<Record<QcDisposition, boolean>> =
  Object.freeze({
    RELEASE: true,
    QUARANTINE: false,
    REJECT: false,
    SCRAP: true,
    REWORK: false,
  });

export interface DispositionPlanInput {
  readonly disposition: string;
  /** The bucket the stock is in now. Must be `QC_HOLD`. */
  readonly sourceStatus: string;
  readonly reasonCodeId?: string | undefined;
}

export interface DispositionPlan {
  readonly disposition: QcDisposition;
  readonly fromStatus: "QC_HOLD";
  readonly toStatus: string;
  readonly reasonCodeId: string;
  readonly requiresApproval: boolean;
  /** True when the movement changes nothing about where the stock sits. */
  readonly isReinspection: boolean;
}

/**
 * Turn a requested disposition into the transition the ledger will post.
 *
 * The source status is checked rather than assumed. Stock that is already
 * `AVAILABLE` cannot be "released": there is no hold to lift, and posting the
 * transition anyway would move quantity from a bucket that does not hold it —
 * which the ledger would refuse later, with a message about balances rather than
 * about quality.
 *
 * Every disposition requires a reason code. It is the audit evidence for the
 * decision (`ADR-0003` §5) and the only durable record of *why* a batch was
 * rejected once the inspector has gone home.
 */
export function planDisposition(
  input: DispositionPlanInput,
): Result<DispositionPlan, QcPolicyError> {
  const disposition = input.disposition as QcDisposition;
  if (!(disposition in DISPOSITION_TARGETS)) {
    return fail({
      code: "DISPOSITION_UNKNOWN",
      disposition: String(input.disposition),
    });
  }
  if (input.sourceStatus !== "QC_HOLD") {
    return fail({
      code: "SOURCE_STATUS_NOT_HELD",
      status: String(input.sourceStatus),
    });
  }

  const reasonCodeId = (input.reasonCodeId ?? "").trim();
  if (reasonCodeId.length === 0) {
    return fail({ code: "REASON_REQUIRED", field: "reasonCodeId" });
  }

  const toStatus = DISPOSITION_TARGETS[disposition];
  return ok(
    Object.freeze({
      disposition,
      fromStatus: "QC_HOLD" as const,
      toStatus,
      reasonCodeId,
      requiresApproval: REQUIRES_APPROVAL[disposition],
      isReinspection: toStatus === "QC_HOLD",
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* Inspection lifecycle                                                        */
/* -------------------------------------------------------------------------- */

/**
 * An inspection's state.
 *
 * `PENDING_APPROVAL` exists as its own state rather than as a flag on `OPEN`,
 * because the two answer different questions for a supervisor's queue: `OPEN`
 * means somebody must inspect, `PENDING_APPROVAL` means somebody must approve,
 * and a single state with a boolean would put both in the same list.
 */
export type InspectionStatus =
  "OPEN" | "PENDING_APPROVAL" | "DISPOSED" | "CANCELLED";

/** Whether a disposition may be submitted against this inspection. */
export const acceptsDisposition = (status: InspectionStatus): boolean =>
  status === "OPEN";

/** The state an inspection reaches once a disposition is submitted. */
export function statusAfterSubmission(plan: DispositionPlan): InspectionStatus {
  return plan.requiresApproval ? "PENDING_APPROVAL" : "DISPOSED";
}

/**
 * Guard the submission path.
 *
 * Separated from `planDisposition` so the two refusals stay distinguishable: "the
 * disposition is not valid for this stock" and "this inspection has already been
 * decided" are different problems with different fixes, and an operator told the
 * wrong one goes looking in the wrong place.
 */
export function assertSubmittable(
  status: InspectionStatus,
): Result<InspectionStatus, QcPolicyError> {
  return acceptsDisposition(status)
    ? ok(status)
    : fail({ code: "INSPECTION_NOT_OPEN", status });
}
