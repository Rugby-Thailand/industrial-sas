/**
 * The ledger's two maintenance jobs, as callable, bounded, resumable drivers.
 *
 * Both are `queryWithOrg` registrations, which is not an accident of
 * convenience:
 *
 * - **Reconciliation must not repair.** It replays a bucket's ledger lines and
 *   *reports* drift; a job that could write would be a job that could quietly
 *   make the balance agree with a wrong replay (`OPS-0003-02`). A Convex query
 *   cannot write, so the guarantee is the runtime's rather than a reviewer's.
 * - **Expiry reclassification plans, and posting is separate.** The plan says
 *   which buckets have expired and what the compensating movements would be. The
 *   posting is `inventory.transaction.post` with its own permission, its own
 *   idempotency, and its own audit row — because moving stock into `EXPIRED` is a
 *   ledger transaction like any other (§5 Q19), not a side effect of a scan.
 *
 * ### Scheduling
 *
 * There is **no cron registered**, and that is deliberate rather than
 * unfinished. `convex/crons.ts` would schedule work against a deployed backend;
 * this repository has no deployment, and a registered schedule that has never
 * run is a claim nobody can check. What exists is the driver a scheduler calls,
 * with its budget, its checkpoint, and its structured outcome codes — so
 * registering it later is a file that names these functions, not a redesign.
 * The exact external gate is in `docs/manuals/inventory-jobs.md`.
 *
 * ### One page per call, because Convex says so
 *
 * **Convex permits one paginated query per function execution.** That is a
 * platform rule, not a style choice, and it decides the shape of everything
 * here: a driver cannot loop over pages inside a single call, and it certainly
 * cannot page balances *and* page each bucket's ledger lines.
 *
 * So each invocation reads exactly one bounded page and returns the checkpoint
 * to resume from; the **caller** loops. `runJob` — the pure kernel in
 * `convex/model/inventory/jobRun.ts` — is still what drives it, with a budget of
 * one page, because that keeps the checkpoint arithmetic, the
 * cursor-did-not-advance check, and the failure semantics in one tested place
 * rather than inlined here.
 *
 * Per-bucket reconciliation therefore uses `reconcileBucketBounded`, a
 * non-paginated `take` capped at `MAX_BOUNDED_RECONCILE_LINES`. A bucket deeper
 * than that is reported as `RECONCILE_INCOMPLETE` rather than folded partially.
 */
import { v } from "convex/values";

import {
  MAX_BOUNDED_RECONCILE_LINES,
  readBalancePage,
  reconcileBucketBounded,
  toPublicLedgerError,
  type LedgerStoreError,
} from "../lib/inventoryLedgerStore";
import { pageRequestOf } from "../lib/listEnvelope";
import { queryWithOrg } from "../lib/tenantFunctions";
import { fail, ok, type Result } from "../model/result";
import {
  EXPIRY_SOURCE_STATUSES,
  isExpiredAsOf,
} from "../model/inventory/expiryReclassification";
import { MAX_JOB_PAGE_SIZE } from "../model/inventory/jobPage";
import {
  MAX_PAGES_PER_RUN,
  initialCheckpoint,
  runJob,
  type JobCheckpoint,
  type JobReaderPage,
} from "../model/inventory/jobRun";
import {
  decodeBucketKey,
  type StockStatus,
} from "../model/inventory/stockIdentity";
import {
  ASIA_BANGKOK,
  parseBusinessDate,
  zoneById,
  businessDateFromInstant,
  type BusinessDate,
} from "../model/time/businessDate";

/* -------------------------------------------------------------------------- */
/* Wire shapes                                                                 */
/* -------------------------------------------------------------------------- */

const checkpointValidator = v.object({
  cursor: v.union(v.string(), v.null()),
  pagesRead: v.number(),
  itemsProcessed: v.number(),
});

const jobErrorValidator = v.object({
  code: v.string(),
  page: v.optional(v.number()),
  field: v.optional(v.string()),
  requested: v.optional(v.string()),
  bucketKey: v.optional(v.string()),
});

/** The arguments both drivers share. */
const driverArgs = {
  warehouseId: v.id("warehouses"),
  /** Where to resume. Absent means start at the beginning. */
  checkpoint: v.optional(checkpointValidator),
  maxPageSize: v.optional(v.number()),
};

/**
 * One page per invocation. Not configurable, and not an oversight: Convex
 * permits a single paginated query per function execution, so a budget above one
 * would fail at run time in a deployed backend rather than here.
 */
const PAGES_PER_INVOCATION = 1;

const checkpointFrom = (supplied: JobCheckpoint | undefined): JobCheckpoint =>
  supplied ?? initialCheckpoint;

/* -------------------------------------------------------------------------- */
/* Reconciliation                                                              */
/* -------------------------------------------------------------------------- */

const driftValidator = v.object({
  bucketKey: v.string(),
  kind: v.string(),
  projectedMinorUnits: v.optional(v.number()),
  storedMinorUnits: v.optional(v.number()),
  projectedUom: v.optional(v.string()),
  storedUom: v.optional(v.string()),
});

const reconciliationValidator = v.union(
  v.object({
    ok: v.literal(true),
    status: v.string(),
    checkpoint: checkpointValidator,
    pagesThisRun: v.number(),
    bucketsChecked: v.number(),
    /** Every bucket whose replayed total disagrees with its stored balance. */
    drift: v.array(driftValidator),
    error: v.optional(jobErrorValidator),
  }),
  v.object({ ok: v.literal(false), error: jobErrorValidator }),
);

interface ReconciliationSummary {
  readonly bucketsChecked: number;
  readonly drift: readonly {
    readonly bucketKey: string;
    readonly kind: string;
    readonly projectedMinorUnits?: number;
    readonly storedMinorUnits?: number;
    readonly projectedUom?: string;
    readonly storedUom?: string;
  }[];
}

/**
 * Sweep one warehouse's balances, reconciling each bucket against a replay of
 * its ledger lines (`INV-0003-10`).
 *
 * Two nested folds, and the nesting is the interesting part. The **outer** fold
 * is `runJob` over pages of `inventoryBalances`. The **inner** one is
 * `reconcileBucketPage` over a single bucket's ledger lines, which is itself
 * paged and resumable — a bucket with more history than one page is folded to
 * completion here, within this run's budget, because a partial total would
 * report drift on every bucket that has any depth.
 *
 * A bucket whose own line history exceeds what one run can read is reported as a
 * drift record of kind `RECONCILE_INCOMPLETE` rather than silently as agreeing.
 * That is the honest answer: the job did not finish checking it.
 */
export const reconcileWarehouse = queryWithOrg({
  args: driverArgs,
  returns: reconciliationValidator,
  permissionCode: "inventory.balance.read",
  target: { table: "inventoryBalances" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const pageRequest = pageRequestOf(args);
    if (!pageRequest.ok) {
      return {
        ok: false as const,
        error: { ...toPublicLedgerError(pageRequest.error as never) },
      };
    }

    const outcome = await runJob<
      { readonly bucketKey: string },
      ReconciliationSummary
    >({
      checkpoint: checkpointFrom(args.checkpoint),
      pageBudget: PAGES_PER_INVOCATION,

      readPage: async (cursor) => {
        const page = await readBalancePage(ctx.tenantDb, args.warehouseId, {
          maxPageSize: pageRequest.value.maxPageSize,
          cursor,
        });
        if (!page.ok) return fail(page.error);
        return ok<JobReaderPage<{ readonly bucketKey: string }>>({
          items: page.value.items.map((row) => ({ bucketKey: row.bucketKey })),
          nextCursor: page.value.nextCursor,
          complete: page.value.complete,
        });
      },

      processPage: async (rows, summary) => {
        const drift = [...summary.drift];
        let checked = summary.bucketsChecked;

        for (const row of rows) {
          const verdict = await reconcileBucketBounded(
            ctx.tenantDb,
            row.bucketKey,
          );
          if (!verdict.ok) return fail(verdict.error);
          checked += 1;
          drift.push(
            ...(verdict.value.complete
              ? verdict.value.drift.map((record) => ({ ...record }))
              : [{ bucketKey: row.bucketKey, kind: "RECONCILE_INCOMPLETE" }]),
          );
        }

        return ok({ bucketsChecked: checked, drift });
      },

      initialSummary: { bucketsChecked: 0, drift: [] },
    });

    if (!outcome.ok) {
      return { ok: false as const, error: { ...outcome.error } };
    }

    return {
      ok: true as const,
      status: outcome.value.status,
      checkpoint: { ...outcome.value.checkpoint },
      pagesThisRun: outcome.value.pagesThisRun,
      bucketsChecked: outcome.value.summary.bucketsChecked,
      drift: outcome.value.summary.drift.map((record) => ({ ...record })),
      ...(outcome.value.error === undefined
        ? {}
        : { error: { ...outcome.value.error } }),
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Expiry reclassification                                                     */
/* -------------------------------------------------------------------------- */

const expiryCandidateValidator = v.object({
  bucketKey: v.string(),
  stockStatus: v.string(),
  uom: v.string(),
  minorUnits: v.number(),
  expirationDate: v.string(),
});

const expiryValidator = v.union(
  v.object({
    ok: v.literal(true),
    status: v.string(),
    checkpoint: checkpointValidator,
    pagesThisRun: v.number(),
    asOf: v.string(),
    balancesScanned: v.number(),
    /** Buckets whose lot has expired as of the business date. */
    expired: v.array(expiryCandidateValidator),
    error: v.optional(jobErrorValidator),
  }),
  v.object({ ok: v.literal(false), error: jobErrorValidator }),
);

interface ExpirySummary {
  readonly balancesScanned: number;
  readonly expired: readonly {
    readonly bucketKey: string;
    readonly stockStatus: string;
    readonly uom: string;
    readonly minorUnits: number;
    readonly expirationDate: string;
  }[];
}

/**
 * Find the buckets whose stock has expired as of a business date (§5 Q19).
 *
 * **Plans only.** It reads balances, resolves each bucket's lot, asks
 * `isExpiredAsOf` — the same kernel `planExpiryReclassification` uses — and
 * reports what would move. Nothing is posted: the compensating
 * `STATUS_CHANGE` transaction is `inventory.transaction.post`, with its own
 * permission and its own idempotency, because moving stock into `EXPIRED` is a
 * ledger transaction and not a side effect of a scan.
 *
 * `asOf` defaults to today in the organization's timezone, never the host's
 * (D-05). A caller may supply one — a nightly job run at 00:05 Bangkok time
 * reconciling the day that just ended needs to — and it is parsed by the strict
 * business-date kernel, so `2026-8-3` is refused rather than shifted.
 *
 * Only **physical** buckets are considered. A virtual boundary is a counterparty
 * outside the warehouse, not stock on a shelf; its balance is routinely negative
 * because a `SOURCE` boundary supplies rather than holds, and planning a
 * movement out of one would be planning to move stock that is not there.
 *
 * Which statuses count is the kernel's decision, imported rather than restated:
 * `EXPIRY_SOURCE_STATUSES` is `AVAILABLE` alone. Quarantined, rejected, and
 * scrapped stock is already withheld from use, and moving it again would
 * generate a transaction that changes no decision while making the history
 * harder to read.
 */
export const planExpiry = queryWithOrg({
  args: { ...driverArgs, asOf: v.optional(v.string()) },
  returns: expiryValidator,
  permissionCode: "inventory.balance.read",
  target: { table: "inventoryBalances" },
  warehouseId: ({ warehouseId }) => warehouseId,
  handler: async (ctx, args) => {
    const asOf = resolveAsOf(
      args.asOf,
      ctx.tenant.organization.settings.timezone,
      Date.now(),
    );
    if (!asOf.ok) {
      return { ok: false as const, error: { code: asOf.error, field: "asOf" } };
    }

    const pageRequest = pageRequestOf(args);
    if (!pageRequest.ok) {
      return {
        ok: false as const,
        error: { ...toPublicLedgerError(pageRequest.error as never) },
      };
    }

    const outcome = await runJob<BalanceRowLite, ExpirySummary>({
      checkpoint: checkpointFrom(args.checkpoint),
      pageBudget: PAGES_PER_INVOCATION,

      readPage: async (cursor) => {
        const page = await readBalancePage(ctx.tenantDb, args.warehouseId, {
          maxPageSize: pageRequest.value.maxPageSize,
          cursor,
        });
        if (!page.ok) return fail(page.error);
        return ok<JobReaderPage<BalanceRowLite>>({
          items: page.value.items.map((row) => ({
            bucketKey: row.bucketKey,
            stockStatus: row.stockStatus,
            uom: row.uom,
            minorUnits: row.minorUnits,
          })),
          nextCursor: page.value.nextCursor,
          complete: page.value.complete,
        });
      },

      processPage: async (rows, summary) => {
        const expired = [...summary.expired];

        for (const row of rows) {
          if (!EXPIRY_SOURCE_STATUSES.has(row.stockStatus as StockStatus)) {
            continue;
          }
          // A zero balance has nothing to move; posting one would be an audited
          // no-op.
          if (row.minorUnits === 0) continue;

          const lot = await lotOfBucket(ctx.tenantDb, row.bucketKey);
          if (!lot.ok) return fail(lot.error);
          if (lot.value === null) continue;

          const verdict = isExpiredAsOf(lot.value, asOf.value);
          if (!verdict.ok) return fail(verdict.error);
          if (!verdict.value) continue;

          expired.push({
            bucketKey: row.bucketKey,
            stockStatus: row.stockStatus,
            uom: row.uom,
            minorUnits: row.minorUnits,
            expirationDate: isoOf(lot.value),
          });
        }

        return ok({
          balancesScanned: summary.balancesScanned + rows.length,
          expired,
        });
      },

      initialSummary: { balancesScanned: 0, expired: [] },
    });

    if (!outcome.ok) {
      return { ok: false as const, error: { ...outcome.error } };
    }

    return {
      ok: true as const,
      status: outcome.value.status,
      checkpoint: { ...outcome.value.checkpoint },
      pagesThisRun: outcome.value.pagesThisRun,
      asOf: isoOf(asOf.value),
      balancesScanned: outcome.value.summary.balancesScanned,
      expired: outcome.value.summary.expired.map((record) => ({ ...record })),
      ...(outcome.value.error === undefined
        ? {}
        : { error: { ...outcome.value.error } }),
    };
  },
});

interface BalanceRowLite {
  readonly bucketKey: string;
  readonly stockStatus: string;
  readonly uom: string;
  readonly minorUnits: number;
}

/** `YYYY-MM-DD` for a validated business date. */
const isoOf = (date: BusinessDate): string =>
  `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;

/**
 * The business date the run is judged against.
 *
 * A supplied date is parsed strictly. An absent one is derived from the server
 * clock *in the organization's timezone* — never the host's, which is how a
 * shift that crosses midnight in Bangkok gets counted against the wrong day.
 */
function resolveAsOf(
  supplied: string | undefined,
  timezone: string,
  now: number,
): Result<BusinessDate, string> {
  if (supplied !== undefined) {
    const parsed = parseBusinessDate(supplied);
    return parsed.ok ? ok(parsed.value) : fail(parsed.error.code);
  }
  const zone = zoneById(timezone);
  const resolved = zone.ok ? zone.value : ASIA_BANGKOK;
  const derived = businessDateFromInstant(now, resolved);
  return derived.ok ? ok(derived.value) : fail(derived.error.code);
}

/**
 * The expiration date of the lot a bucket names, or `null`.
 *
 * The bucket key is *decoded* rather than pattern-matched: a lot ID is a
 * length-prefixed component, and a substring search would also match a key whose
 * item ID happened to contain it. A bucket with no lot — an item tracked `NONE` —
 * has no expiry and is skipped.
 */
async function lotOfBucket(
  tenantDb: Parameters<typeof reconcileBucketBounded>[0],
  bucketKey: string,
): Promise<Result<BusinessDate | null, LedgerStoreError>> {
  const decoded = decodeBucketKey(bucketKey);
  if (!decoded.ok) {
    return fail({
      code: "LINE_BUCKET_INVALID",
      index: -1,
      cause: decoded.error,
    });
  }

  /*
   * A **virtual** bucket is a counterparty outside the warehouse — a supplier
   * receipt, a production issue, a stock-count adjustment (`G-023`). It is not
   * stock on a shelf, so it cannot expire, and its balance is routinely negative
   * because a `SOURCE` boundary supplies rather than holds. Including one would
   * plan a movement of stock that is not there.
   */
  if (decoded.value.location.kind !== "PHYSICAL") return ok(null);

  const lotId = decoded.value.lotId;
  if (lotId === undefined) return ok(null);

  const lot = await tenantDb.get<{
    readonly orgId: never;
    readonly expirationDate?: string;
  }>("lots", lotId);
  if (lot === null || lot.expirationDate === undefined) return ok(null);

  const parsed = parseBusinessDate(lot.expirationDate);
  return parsed.ok ? ok(parsed.value) : ok(null);
}

/** The per-run page cap the *scheduler* may use, re-exported for its loop. */
export const maxPagesPerRun = MAX_PAGES_PER_RUN;
/** The per-bucket line cap a bounded reconciliation folds before giving up. */
export const maxBoundedReconcileLines = MAX_BOUNDED_RECONCILE_LINES;
/** The per-page row cap, re-exported for the same reason. */
export const maxJobPageSize = MAX_JOB_PAGE_SIZE;
/** The statuses expiry considers, re-exported so a test can pin them. */
export const expirySourceStatuses = EXPIRY_SOURCE_STATUSES;
