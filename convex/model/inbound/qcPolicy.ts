import { fail, ok, type Result } from "../result";

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

export type SamplingStrategy = "ALL" | "FIXED" | "PERCENT";

/** Strategies named in the plan and deliberately not implemented (plan §2.3). */
export const UNSUPPORTED_SAMPLING_STRATEGIES: readonly string[] = Object.freeze(
  ["AQL", "ISO_2859"],
);

export interface SamplingPlanInput {
  readonly strategy: string;

  readonly parameter?: number | undefined;

  readonly lotSize: number;
}

export interface SamplingPlan {
  readonly strategy: SamplingStrategy;
  readonly sampleSize: number;
  readonly lotSize: number;

  readonly inspectsEverything: boolean;
}

const MAX_LOT_SIZE = 1_000_000_000;

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

export const receiptStockStatus = (
  applicability: QcApplicability,
): "AVAILABLE" | "QC_HOLD" =>
  applicability.controlled ? "QC_HOLD" : "AVAILABLE";

export type QcDisposition =
  "RELEASE" | "QUARANTINE" | "REJECT" | "SCRAP" | "REWORK";

const DISPOSITION_TARGETS: Readonly<Record<QcDisposition, string>> =
  Object.freeze({
    RELEASE: "AVAILABLE",
    QUARANTINE: "QUARANTINE",
    REJECT: "REJECTED",
    SCRAP: "SCRAP",
    REWORK: "QC_HOLD",
  });

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

  readonly sourceStatus: string;
  readonly reasonCodeId?: string | undefined;
}

export interface DispositionPlan {
  readonly disposition: QcDisposition;
  readonly fromStatus: "QC_HOLD";
  readonly toStatus: string;
  readonly reasonCodeId: string;
  readonly requiresApproval: boolean;

  readonly isReinspection: boolean;
}

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

export type InspectionStatus =
  "OPEN" | "PENDING_APPROVAL" | "DISPOSED" | "CANCELLED";

export const acceptsDisposition = (status: InspectionStatus): boolean =>
  status === "OPEN";

export function statusAfterSubmission(plan: DispositionPlan): InspectionStatus {
  return plan.requiresApproval ? "PENDING_APPROVAL" : "DISPOSED";
}

export function assertSubmittable(
  status: InspectionStatus,
): Result<InspectionStatus, QcPolicyError> {
  return acceptsDisposition(status)
    ? ok(status)
    : fail({ code: "INSPECTION_NOT_OPEN", status });
}
