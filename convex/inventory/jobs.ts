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

const driverArgs = {
  warehouseId: v.id("warehouses"),

  checkpoint: v.optional(checkpointValidator),
  maxPageSize: v.optional(v.number()),
};

const PAGES_PER_INVOCATION = 1;

const checkpointFrom = (supplied: JobCheckpoint | undefined): JobCheckpoint =>
  supplied ?? initialCheckpoint;

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

const isoOf = (date: BusinessDate): string =>
  `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;

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

export const maxPagesPerRun = MAX_PAGES_PER_RUN;

export const maxBoundedReconcileLines = MAX_BOUNDED_RECONCILE_LINES;

export const maxJobPageSize = MAX_JOB_PAGE_SIZE;

export const expirySourceStatuses = EXPIRY_SOURCE_STATUSES;
