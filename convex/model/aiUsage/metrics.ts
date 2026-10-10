/**
 * AI usage projections: the operation projection derived from its attempt
 * ledger, each operation's contribution to a daily summary, the summary key,
 * and the organization-local report range.
 *
 * Status: implemented. The live lifecycle (`convex/aiUsage/internal.ts`) and
 * the operator rebuild (`convex/aiUsage/rebuild.ts`) both derive projections
 * and summary keys only through this module, so a repaired total cannot drift
 * from a live one. Every public function re-validates what it is handed and
 * returns a frozen `Result`; nothing throws and nothing mutates its input.
 * Not supported: daylight-saving timezones (see `hr/calendar.ts`).
 */
import { isRecord, isSafeInt, isString } from "../guards";
import {
  dayNumber,
  MS_PER_DAY,
  timezoneOffsetMinutes,
  toLocal,
} from "../hr/calendar";
import { fail, ok, type Result } from "../result";
import {
  isFeature,
  isUsageStatus,
  MAX_ATTEMPTS,
  type BillingStatus,
  type Feature,
  type UsageStatus,
} from "./usage";

export const METRIC_KEYS = Object.freeze([
  "operationCount",
  "attemptCount",
  "successCount",
  "pendingCount",
  "knownCostUsdNano",
  "unknownAttemptCount",
  "incompleteOperationCount",
  "completeOperationCount",
  "completeCostUsdNano",
  "totalDurationMs",
  "finishedOperationCount",
] as const);
export type MetricKey = (typeof METRIC_KEYS)[number];
export type Metrics = Readonly<Record<MetricKey, number>>;

export type UsageAggregateError =
  | { readonly code: "AI_USAGE_AGGREGATE_INVALID"; readonly field: string }
  | { readonly code: "AI_USAGE_LEDGER_INVALID"; readonly field: string };
export type ReportRangeError =
  | { readonly code: "TIMEZONE_UNSUPPORTED" }
  | { readonly code: "DATE_RANGE_INVALID"; readonly field: string };

const aggregateInvalid = (field: string) =>
  fail({ code: "AI_USAGE_AGGREGATE_INVALID" as const, field });
const ledgerInvalid = (field: string) =>
  fail({ code: "AI_USAGE_LEDGER_INVALID" as const, field });

const isCount = (value: unknown): value is number =>
  isSafeInt(value) && value >= 0;

const freezeMetrics = (values: Record<MetricKey, number>): Metrics =>
  Object.freeze({ ...values });

export const EMPTY_METRICS: Metrics = freezeMetrics(
  Object.fromEntries(METRIC_KEYS.map((key) => [key, 0])) as Record<
    MetricKey,
    number
  >,
);

/**
 * The metric fields of `value` (a summary document, for example) as a new
 * frozen record; every field must be a nonnegative safe integer.
 */
export function readMetrics(
  value: unknown,
): Result<Metrics, UsageAggregateError> {
  if (!isRecord(value)) return aggregateInvalid("metrics");
  const out = {} as Record<MetricKey, number>;
  for (const key of METRIC_KEYS) {
    const entry = value[key];
    if (!isCount(entry)) return aggregateInvalid(key);
    out[key] = entry;
  }
  return ok(freezeMetrics(out));
}

/** The projection fields a summary contribution depends on. */
export interface OperationFacts {
  readonly attemptCount: number;
  readonly knownCostUsdNano: number;
  readonly unknownAttemptCount: number;
  readonly status: UsageStatus;
  readonly durationMs: number;
}

function readOperation(
  value: unknown,
): Result<OperationFacts, UsageAggregateError> {
  if (!isRecord(value)) return aggregateInvalid("operation");
  const { attemptCount, knownCostUsdNano, unknownAttemptCount, status } = value;
  const durationMs = value.durationMs;
  if (!isCount(attemptCount) || attemptCount < 1 || attemptCount > MAX_ATTEMPTS)
    return aggregateInvalid("attemptCount");
  if (!isCount(knownCostUsdNano)) return aggregateInvalid("knownCostUsdNano");
  if (!isCount(unknownAttemptCount) || unknownAttemptCount > attemptCount)
    return aggregateInvalid("unknownAttemptCount");
  if (!isUsageStatus(status)) return aggregateInvalid("status");
  if (!isCount(durationMs)) return aggregateInvalid("durationMs");
  return ok({
    attemptCount,
    knownCostUsdNano,
    unknownAttemptCount,
    status,
    durationMs,
  });
}

/**
 * One operation's daily-summary contribution. An operation is complete once
 * it is finished and every attempt's cost is known; only complete operations
 * enter the average.
 */
export function contribution(
  operation: unknown,
): Result<Metrics, UsageAggregateError> {
  const read = readOperation(operation);
  if (!read.ok) return read;
  const op = read.value;
  const pending = op.status === "PENDING",
    complete = !pending && op.unknownAttemptCount === 0;
  return ok(
    freezeMetrics({
      operationCount: 1,
      attemptCount: op.attemptCount,
      successCount: Number(op.status === "SUCCEEDED"),
      pendingCount: Number(pending),
      knownCostUsdNano: op.knownCostUsdNano,
      unknownAttemptCount: op.unknownAttemptCount,
      incompleteOperationCount: Number(!complete),
      completeOperationCount: Number(complete),
      completeCostUsdNano: complete ? op.knownCostUsdNano : 0,
      totalDurationMs: pending ? 0 : op.durationMs,
      finishedOperationCount: Number(!pending),
    }),
  );
}

function combine(
  parts: readonly { readonly metrics: Metrics; readonly sign: 1 | -1 }[],
): Result<Metrics, UsageAggregateError> {
  const out = {} as Record<MetricKey, number>;
  for (const key of METRIC_KEYS) {
    let total = 0;
    for (const part of parts) total += part.metrics[key] * part.sign;
    if (!isCount(total)) return aggregateInvalid(key);
    out[key] = total;
  }
  return ok(freezeMetrics(out));
}

/** `left + right` as a new frozen record; both operands are re-validated. */
export function addMetrics(
  left: unknown,
  right: unknown,
): Result<Metrics, UsageAggregateError> {
  const a = readMetrics(left);
  if (!a.ok) return a;
  const b = readMetrics(right);
  if (!b.ok) return b;
  return combine([
    { metrics: a.value, sign: 1 },
    { metrics: b.value, sign: 1 },
  ]);
}

/**
 * A summary after one operation's projection changes from `before` to
 * `after` (either may be null: created or removed). The net delta is applied
 * before validating, because a reconciliation can lower an unknown count.
 */
export function replaceContribution(
  summary: unknown,
  before: unknown,
  after: unknown,
): Result<Metrics, UsageAggregateError> {
  const base = summary === null ? ok(EMPTY_METRICS) : readMetrics(summary);
  if (!base.ok) return base;
  const old = before === null ? ok(EMPTY_METRICS) : contribution(before);
  if (!old.ok) return old;
  const next = after === null ? ok(EMPTY_METRICS) : contribution(after);
  if (!next.ok) return next;
  return combine([
    { metrics: base.value, sign: 1 },
    { metrics: old.value, sign: -1 },
    { metrics: next.value, sign: 1 },
  ]);
}

/** The ledger fields of one provider attempt that its operation depends on. */
export interface AttemptFacts {
  readonly attemptNo: number;
  readonly startedAt: number;
  readonly finishedAt?: number;
  readonly status: UsageStatus;
  readonly billingStatus: BillingStatus;
  readonly costUsdNano?: number;
}

export interface OperationProjection extends OperationFacts {
  readonly startedAt: number;
}

/**
 * The operation projection of its attempts, in attempt order. Cost sums
 * every reported attempt; status and end time are the last attempt's; a
 * pending operation has no duration yet.
 */
export function projectOperation(
  attempts: unknown,
): Result<OperationProjection, UsageAggregateError> {
  if (
    !Array.isArray(attempts) ||
    attempts.length < 1 ||
    attempts.length > MAX_ATTEMPTS
  )
    return ledgerInvalid("attempts");
  let knownCostUsdNano = 0,
    unknownAttemptCount = 0;
  const read: AttemptFacts[] = [];
  for (const [index, attempt] of attempts.entries()) {
    if (!isRecord(attempt)) return ledgerInvalid("attempt");
    const { attemptNo, startedAt, finishedAt, status, billingStatus } = attempt;
    const cost = attempt.costUsdNano;
    if (attemptNo !== index + 1) return ledgerInvalid("attemptNo");
    if (!isCount(startedAt)) return ledgerInvalid("startedAt");
    if (finishedAt !== undefined && !isCount(finishedAt))
      return ledgerInvalid("finishedAt");
    if (!isUsageStatus(status)) return ledgerInvalid("status");
    if (billingStatus === "REPORTED") {
      if (!isCount(cost)) return ledgerInvalid("costUsdNano");
      knownCostUsdNano += cost;
      if (!isCount(knownCostUsdNano)) return ledgerInvalid("costUsdNano");
    } else if (billingStatus === "UNKNOWN") {
      if (cost !== undefined) return ledgerInvalid("costUsdNano");
      unknownAttemptCount += 1;
    } else return ledgerInvalid("billingStatus");
    read.push({
      attemptNo,
      startedAt,
      ...(finishedAt === undefined ? {} : { finishedAt }),
      status,
      billingStatus,
    });
  }
  const first = read[0]!,
    last = read[read.length - 1]!;
  return ok(
    Object.freeze({
      startedAt: first.startedAt,
      attemptCount: read.length,
      status: last.status,
      knownCostUsdNano,
      unknownAttemptCount,
      durationMs:
        last.status === "PENDING"
          ? 0
          : Math.max(0, (last.finishedAt ?? last.startedAt) - first.startedAt),
    }),
  );
}

/** The dimensions one daily summary row aggregates. */
export interface SummaryDimensions {
  readonly utcDay: number;
  readonly feature: Feature;
  readonly environment: string;
  readonly actorUserId: string;
  readonly warehouseId?: string | undefined;
  readonly requestedModel: string;
}

/** The deterministic daily-summary key; the stored format is unchanged. */
export function summaryKey(
  dimensions: unknown,
): Result<string, UsageAggregateError> {
  if (!isRecord(dimensions)) return aggregateInvalid("dimensions");
  const {
    utcDay,
    feature,
    environment,
    actorUserId,
    warehouseId,
    requestedModel,
  } = dimensions;
  if (!isCount(utcDay)) return aggregateInvalid("utcDay");
  if (!isFeature(feature)) return aggregateInvalid("feature");
  for (const [field, value] of [
    ["environment", environment],
    ["actorUserId", actorUserId],
    ["requestedModel", requestedModel],
  ] as const)
    if (!isString(value) || value.length === 0) return aggregateInvalid(field);
  if (warehouseId !== undefined && (!isString(warehouseId) || !warehouseId))
    return aggregateInvalid("warehouseId");
  return ok(
    JSON.stringify([
      utcDay,
      feature,
      environment,
      actorUserId,
      warehouseId ?? "",
      requestedModel,
    ]),
  );
}

/** Longest report range, in organization-local days after the first. */
export const MAX_REPORT_SPAN_DAYS = 92;

export interface ReportRange {
  readonly from: string;
  readonly to: string;
  /** Inclusive start and exclusive end instants of the local dates. */
  readonly start: number;
  readonly end: number;
  /** Every UTC day overlapping [start, end), ascending. */
  readonly utcDays: readonly number[];
  readonly timezone: string;
}

/**
 * The report's organization-local dates as exact UTC instants. Defaults to
 * this month; `today` is the local date of `now`.
 */
export function reportRange(
  timezone: unknown,
  now: unknown,
  input: unknown,
): Result<ReportRange, ReportRangeError> {
  if (!isString(timezone)) return fail({ code: "TIMEZONE_UNSUPPORTED" });
  const offset = timezoneOffsetMinutes(timezone);
  if (!offset.ok) return fail({ code: "TIMEZONE_UNSUPPORTED" });
  if (!isSafeInt(now))
    return fail({ code: "DATE_RANGE_INVALID", field: "now" });
  if (!isRecord(input))
    return fail({ code: "DATE_RANGE_INVALID", field: "input" });
  const { period, from: fromInput, to: toInput } = input;
  if (period !== undefined && period !== "month" && period !== "today")
    return fail({ code: "DATE_RANGE_INVALID", field: "period" });
  if (fromInput !== undefined && !isString(fromInput))
    return fail({ code: "DATE_RANGE_INVALID", field: "from" });
  if (toInput !== undefined && !isString(toInput))
    return fail({ code: "DATE_RANGE_INVALID", field: "to" });
  const today = toLocal(now, offset.value).date;
  const from =
    fromInput ?? (period === "today" ? today : `${today.slice(0, 7)}-01`);
  const to = toInput ?? today;
  const first = dayNumber(from),
    last = dayNumber(to);
  if (first === null)
    return fail({ code: "DATE_RANGE_INVALID", field: "from" });
  if (last === null || last < first || last - first > MAX_REPORT_SPAN_DAYS)
    return fail({ code: "DATE_RANGE_INVALID", field: "to" });
  const start = first * MS_PER_DAY - offset.value * 60_000,
    end = (last + 1) * MS_PER_DAY - offset.value * 60_000;
  const firstUtcDay = Math.floor(start / MS_PER_DAY);
  const utcDays = Object.freeze(
    Array.from(
      { length: Math.ceil(end / MS_PER_DAY) - firstUtcDay },
      (_, i) => firstUtcDay + i,
    ),
  );
  return ok(Object.freeze({ from, to, start, end, utcDays, timezone }));
}
