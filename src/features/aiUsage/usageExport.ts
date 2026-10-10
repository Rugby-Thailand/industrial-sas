import type { FunctionArgs, FunctionReturnType } from "convex/server";

import { api } from "../../../convex/_generated/api";
import { clientRef, type RefValue } from "@/lib/convex/clientRef";
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
 * range, filters, FX settings and actor names. Later renders (a new period,
 * filter or report) cannot change a running export.
 */
export interface UsageExportScope {
  readonly utcDays: readonly number[];
  readonly from: string;
  readonly to: string;
  readonly timezone: string;
  readonly filter: Readonly<Filter>;
  readonly settings: Report["settings"];
  readonly users: readonly { readonly id: string; readonly name: string }[];
}

export type UsageExportResult =
  | { readonly kind: "READY"; readonly csv: string; readonly fileName: string }
  | { readonly kind: "CANCELLED" }
  | { readonly kind: "FAILED"; readonly reason: "DENIED" | "LIMIT" | "ERROR" };

export function usageExportScope(
  report: Pick<Report, "range" | "settings" | "users">,
  filter: Filter,
): UsageExportScope {
  return Object.freeze({
    utcDays: Object.freeze([...report.range.utcDays]),
    from: report.range.from,
    to: report.range.to,
    timezone: report.range.timezone,
    filter: Object.freeze({ ...filter }),
    settings: report.settings ? Object.freeze({ ...report.settings }) : null,
    users: Object.freeze(
      report.users.map((user) =>
        Object.freeze({ id: user.id, name: user.name }),
      ),
    ),
  });
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
  "fx_version",
  "usd_thb_rate",
  "funding_fee_percent",
  "rate_source",
  "rate_effective_at",
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
    settings = scope.settings;
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
              settings && a.costUsdNano !== undefined
                ? estimateThb(
                    a.costUsdNano,
                    settings.usdThbRate,
                    settings.feePercent,
                  )
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
              settings?.version,
              settings?.usdThbRate,
              settings?.feePercent,
              settings?.source,
              settings?.effectiveAt,
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
