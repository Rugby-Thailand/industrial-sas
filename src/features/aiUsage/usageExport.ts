import type { FunctionArgs, FunctionReturnType } from "convex/server";

import { api } from "../../../convex/_generated/api";
import { clientRef, type RefValue } from "@/lib/convex/clientRef";
import {
  estimateInputs,
  FUNDING_SOURCE_URL,
  FX_SOURCE_URL,
  type SourceState,
  type UsageEstimate,
} from "@/lib/aiUsage/estimateSources";
import { usageCsv } from "./csv";
import { estimateThb } from "./estimate";

export const operationsRef = clientRef(api.aiUsage.reports.operations),
  attemptsRef = clientRef(api.aiUsage.reports.attempts);
type SummaryRef = ReturnType<
  typeof clientRef<typeof api.aiUsage.reports.summary>
>;
type Report = Exclude<RefValue<SummaryRef>, { error: string }>;
type OperationArgs = FunctionArgs<typeof operationsRef>;
type Filter = Omit<OperationArgs, "utcDay" | "from" | "to" | "cursor">;

/** The most operations one CSV may contain. */
export const EXPORT_OPERATION_LIMIT = 3000;

/** Where an export reads its rows; bound to the report's Convex client. */
export interface UsageExportSource {
  readonly operations: (
    args: OperationArgs,
  ) => Promise<FunctionReturnType<typeof operationsRef>>;
  readonly attempts: (
    args: FunctionArgs<typeof attemptsRef>,
  ) => Promise<FunctionReturnType<typeof attemptsRef>>;
}

/**
 * Everything one export answers, copied and frozen when it starts: the
 * range, filters, the automatic estimate snapshot shown on the page and
 * actor names. Later renders (a new period, filter, report or estimate
 * status) cannot change a running export.
 */
export interface UsageExportScope {
  readonly utcDays: readonly number[];
  readonly from: string;
  readonly to: string;
  readonly timezone: string;
  readonly filter: Readonly<Filter>;
  /** The estimate visible when the export started; null if none loaded. */
  readonly estimate: UsageEstimate | null;
  readonly users: readonly { readonly id: string; readonly name: string }[];
}

export type UsageExportResult =
  | { readonly kind: "READY"; readonly csv: string; readonly fileName: string }
  | { readonly kind: "CANCELLED" }
  | { readonly kind: "FAILED"; readonly reason: "DENIED" | "LIMIT" | "ERROR" };

export function usageExportScope(
  report: Pick<Report, "range" | "users">,
  filter: Filter,
  estimate: UsageEstimate | null,
): UsageExportScope {
  return Object.freeze({
    utcDays: Object.freeze([...report.range.utcDays]),
    from: report.range.from,
    to: report.range.to,
    timezone: report.range.timezone,
    filter: Object.freeze({ ...filter }),
    estimate: estimate ? freezeEstimate(estimate) : null,
    users: Object.freeze(
      report.users.map((user) =>
        Object.freeze({ id: user.id, name: user.name }),
      ),
    ),
  });
}

const freezeSource = <T extends object>(
  state: SourceState<T>,
): SourceState<T> =>
  state.status === "UNAVAILABLE"
    ? Object.freeze({ status: "UNAVAILABLE" as const })
    : Object.freeze({
        status: state.status,
        value: Object.freeze({ ...state.value }),
      });

/** A deep frozen copy, so no later state can alter the exported snapshot. */
const freezeEstimate = (estimate: UsageEstimate): UsageEstimate =>
  Object.freeze({
    version: estimate.version,
    loadedAt: estimate.loadedAt,
    fx: freezeSource(estimate.fx),
    funding: freezeSource(estimate.funding),
  });

const iso = (time: number | undefined) =>
  time === undefined ? undefined : new Date(time).toISOString();

/** The estimate columns, identical on every row of one export. */
function estimateColumns(estimate: UsageEstimate | null): unknown[] {
  const fx =
    estimate && estimate.fx.status !== "UNAVAILABLE"
      ? estimate.fx.value
      : undefined;
  const funding =
    estimate && estimate.funding.status !== "UNAVAILABLE"
      ? estimate.funding.value
      : undefined;
  return [
    estimate?.version,
    iso(estimate?.loadedAt),
    fx?.rate,
    fx?.date,
    iso(fx?.fetchedAt),
    estimate?.fx.status ?? "UNAVAILABLE",
    FX_SOURCE_URL,
    funding?.percent,
    funding?.minimumUsd,
    iso(funding?.fetchedAt),
    estimate?.funding.status ?? "UNAVAILABLE",
    FUNDING_SOURCE_URL,
  ];
}

const CANCELLED: UsageExportResult = Object.freeze({ kind: "CANCELLED" });
const failed = (reason: "DENIED" | "LIMIT" | "ERROR"): UsageExportResult =>
  Object.freeze({ kind: "FAILED", reason });

export const USAGE_CSV_HEADERS = Object.freeze([
  "operation_id",
  "feature",
  "environment",
  "actor_id",
  "actor_name",
  "warehouse_id",
  "requested_model",
  "operation_started_at",
  "timezone",
  "operation_status",
  "attempt_count",
  "job_scan_id",
  "attempt_no",
  "attempt_started_at",
  "status",
  "http_status",
  "provider",
  "billing_account_ref",
  "generation_id",
  "actual_model",
  "is_byok",
  "input_units",
  "output_units",
  "reasoning_units_subset",
  "cached_input_units_subset",
  "cache_write_units",
  "total_units",
  "reported_cost_usd",
  "cost_usd_nano",
  "billing_status",
  "usage_source",
  "duration_ms",
  "estimate_cache_version",
  "estimate_loaded_at",
  "usd_thb_rate",
  "usd_thb_rate_date",
  "usd_thb_fetched_at",
  "usd_thb_status",
  "usd_thb_source",
  "funding_fee_percent_estimate",
  "funding_fee_minimum_usd",
  "funding_fee_fetched_at",
  "funding_fee_status",
  "funding_fee_source",
  "estimated_thb",
  "estimated_funding_fee_thb",
  "estimated_total_thb",
] as const);

/**
 * Build one CSV for a frozen scope. `isCurrent` is the export's lifecycle:
 * it is checked before every query, after every awaited answer and before
 * the file is produced, so an export whose report unmounted (organization
 * switch, sign-out, navigation) stops without another query and yields no
 * file, never a partial or mixed-organization one.
 */
export async function exportUsage(
  source: UsageExportSource,
  scope: UsageExportScope,
  isCurrent: () => boolean,
): Promise<UsageExportResult> {
  const rows: unknown[][] = [],
    { rate, feePercent } = estimateInputs(scope.estimate),
    estimate = estimateColumns(scope.estimate);
  let count = 0;
  try {
    for (const utcDay of scope.utcDays) {
      let cursor: string | undefined;
      for (;;) {
        if (!isCurrent()) return CANCELLED;
        const page = await source.operations({
          utcDay,
          from: scope.from,
          to: scope.to,
          ...scope.filter,
          ...(cursor ? { cursor } : {}),
        });
        if (!isCurrent()) return CANCELLED;
        if (!page.ok) return failed("DENIED");
        for (const op of page.value.page) {
          if (++count > EXPORT_OPERATION_LIMIT) return failed("LIMIT");
          if (!isCurrent()) return CANCELLED;
          const attempts = await source.attempts({
            operationId: op.operationId,
          });
          if (!isCurrent()) return CANCELLED;
          if (!attempts.ok) return failed("DENIED");
          for (const a of attempts.value) {
            const baht =
              rate !== null && a.costUsdNano !== undefined
                ? estimateThb(a.costUsdNano, rate, feePercent)
                : null;
            rows.push([
              op.operationId,
              op.feature,
              op.environment,
              op.actorUserId,
              scope.users.find((u) => u.id === op.actorUserId)?.name,
              op.warehouseId,
              op.requestedModel,
              new Date(op.startedAt).toISOString(),
              scope.timezone,
              op.status,
              op.attemptCount,
              op.jobScanId,
              a.attemptNo,
              new Date(a.startedAt).toISOString(),
              a.status,
              a.httpStatus,
              a.provider,
              a.billingAccountRef,
              a.providerGenerationId,
              a.actualModel,
              a.isByok,
              a.inputUnitCount,
              a.outputUnitCount,
              a.reasoningUnitCount,
              a.cachedInputUnitCount,
              a.cacheWriteUnitCount,
              a.totalUnitCount,
              a.costUsd,
              a.costUsdNano,
              a.billingStatus,
              a.usageSource,
              a.durationMs,
              ...estimate,
              baht?.inference,
              baht?.fundingFee,
              baht?.withFundingFee,
            ]);
          }
        }
        if (page.value.isDone) break;
        cursor = page.value.continueCursor;
      }
    }
  } catch {
    // A rejection after the report unmounted is a cancellation, not an error.
    return isCurrent() ? failed("ERROR") : CANCELLED;
  }
  if (!isCurrent()) return CANCELLED;
  return Object.freeze({
    kind: "READY",
    csv: usageCsv(USAGE_CSV_HEADERS, rows),
    fileName: `ai-usage-${scope.from}-${scope.to}.csv`,
  });
}
