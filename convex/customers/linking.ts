import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import {
  readProductSummary,
  summaryReadiness,
} from "../lib/finishedGoodsSummary";
import {
  checkIdempotency,
  fingerprintArguments,
  resultIdentityDigest,
  sha256Hex,
  verifiedResultIdentity,
  writeIdempotencyRecord,
} from "../lib/idempotency";
import { inventoryWriter } from "../lib/inventoryWriter";
import { replayTenantWriteIfPresent } from "../lib/masterDataStore";
import { grantedPermissionsAmong } from "../lib/navigationGrants";
import {
  mutationWithOrg,
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import { TENANT_INDEX_MAX_PAGE_SIZE } from "../lib/tenantDb";
import { writeContextOf } from "../lib/writeEnvelope";
import { NAVIGATION_PERMISSION } from "../model/authorization/navigationPermissions";
import {
  compactCustomerStem,
  normalizeCustomerName,
  validateCustomerAlias,
} from "../model/customers/customers";
import {
  isReviewPendingScan,
  recordCustomerJobLink,
  removeCustomerAliasFromSearchText,
} from "./activitySummary";
import {
  pageWarehouseActivity,
  scanVisible,
  type ScanBudget,
  type ScanPosition,
} from "./activityReads";
import { bumpCustomerCatalogueGeneration } from "./catalogueGeneration";
import { approveCustomerAlias, resolveExactCustomerMatch } from "./matching";
import {
  customerLatestJob,
  customerLinkSource,
  customerStatus,
  customerSummary,
} from "./validators";
import {
  allowedCustomerWarehouses,
  canAccessWarehouse,
} from "./warehouseScope";

const readCustomers = {
  permissionCode: NAVIGATION_PERMISSION.customers,
  target: { table: "customers" },
} as const;

const RECENT_JOBS_LIMIT = 10;
const LINKED_PRODUCTS_LIMIT = 50;
const CUSTOMER_ALIASES_PREVIEW_LIMIT = 50;
const REVIEW_SCAN_BUDGET = 300;
const REVIEW_PAGE_SCAN_LIMIT = 50;
const ACTIVE_CUSTOMER_SAMPLE = 100;
const MAX_RESOLVE_SCANS = 100;
const MAX_SUMMARY_CUSTOMERS = 100;
/** Activity rows one summary request may scan across all its customers. */
const SUMMARY_READ_BUDGET = 2_000;
/** Rows read for every customer before continuing busy ones. */
const SUMMARY_FIRST_SLICE = 10;
const PICKER_DEFAULT_LIMIT = 25;
const PICKER_SEARCH_PAGE_LIMIT = 100;

const aliasItemValidator = v.object({
  aliasId: v.id("customerAliases"),
  alias: v.string(),
  approvedAt: v.number(),
});

const linkedProductItemValidator = v.object({
  productId: v.id("finishedGoodsProducts"),
  sku: v.string(),
  name: v.string(),
  unit: v.string(),
  status: v.union(
    v.literal("DRAFT"),
    v.literal("ACTIVE"),
    v.literal("ARCHIVED"),
  ),
  warehouseId: v.id("warehouses"),
  warehouseName: v.string(),
  customerReference: v.optional(v.string()),
  totalQuantity: v.optional(v.number()),
});

const aliasWriteOutcome = v.union(
  v.object({
    ok: v.literal(true),
    aliasId: v.string(),
    replayed: v.boolean(),
  }),
  v.object({
    ok: v.literal(false),
    code: v.string(),
    field: v.optional(v.string()),
  }),
);

const resolveOutcome = v.union(
  v.object({
    ok: v.literal(true),
    updatedCount: v.number(),
    aliasId: v.optional(v.string()),
    replayed: v.boolean(),
  }),
  v.object({
    ok: v.literal(false),
    code: v.string(),
    field: v.optional(v.string()),
  }),
);

function failure(code: string, field?: string) {
  return {
    ok: false as const,
    code,
    ...(field === undefined ? {} : { field }),
  };
}

function toSummary(row: Doc<"customers">) {
  return {
    customerId: row._id,
    code: row.code,
    name: row.name,
    status: row.status,
    ...(row.deliveryAddress?.province === undefined
      ? {}
      : { province: row.deliveryAddress.province }),
  };
}

async function hydrateLinkedProducts(
  ctx: TenantFunctionContext,
  products: readonly {
    product: Doc<"finishedGoodsProducts">;
    warehouseName: string;
  }[],
) {
  const touchedWarehouses = [
    ...new Set(products.map(({ product }) => product.warehouseId)),
  ];
  const readinessEntries = await Promise.all(
    touchedWarehouses.map(
      async (warehouseId): Promise<[Id<"warehouses">, boolean]> => [
        warehouseId,
        Boolean((await summaryReadiness(ctx.tenantDb, warehouseId))?.ready),
      ],
    ),
  );
  const readyByWarehouse = new Map(readinessEntries);
  return Promise.all(
    products.map(async ({ product, warehouseName }) => {
      const summary = readyByWarehouse.get(product.warehouseId)
        ? await readProductSummary(ctx, product)
        : null;
      return {
        productId: product._id,
        sku: product.sku,
        name: product.name,
        unit: product.unit,
        status: product.status,
        warehouseId: product.warehouseId,
        warehouseName,
        ...(product.customerReference === undefined
          ? {}
          : { customerReference: product.customerReference }),
        ...(summary !== null ? { totalQuantity: summary.quantity } : {}),
      };
    }),
  );
}

interface ReviewScanCursor {
  readonly key: string;
  readonly warehouseId?: string;
  readonly legacy?: boolean;
  readonly cursor?: string;
}

function parseReviewCursor(raw: string): ReviewScanCursor {
  try {
    const value = JSON.parse(raw) as Partial<ReviewScanCursor> | null;
    if (
      typeof value?.key === "string" &&
      (value.warehouseId === undefined ||
        typeof value.warehouseId === "string") &&
      (value.legacy === undefined || typeof value.legacy === "boolean") &&
      (value.cursor === undefined ||
        (typeof value.cursor === "string" &&
          typeof value.warehouseId === "string"))
    ) {
      return { ...value, key: value.key };
    }
  } catch {
    // Invalid cursors are rejected before reading any scan ranges.
  }
  throw new Error("REVIEW_CURSOR_INVALID");
}

function reviewScanRange(
  ctx: TenantFunctionContext,
  warehouseId: Id<"warehouses">,
  legacy: boolean,
) {
  // Legacy rows carry neither a link decision nor a v2 classification, so
  // the two ranges are disjoint. Live saves and backfill classify every row
  // (blank tickets as `false`), which keeps blanks out of both ranges.
  return legacy
    ? ctx.tenantDb.byIndex<Doc<"finishedGoodsJobScans">>(
        "finishedGoodsJobScans",
        "by_orgId_warehouseId_linkSource_reviewPending_createdAt",
        [
          { field: "warehouseId", value: warehouseId },
          { field: "customerLinkSource", value: undefined, missing: true },
          { field: "customerReviewPending", value: undefined, missing: true },
        ],
      )
    : ctx.tenantDb.byIndex<Doc<"finishedGoodsJobScans">>(
        "finishedGoodsJobScans",
        "by_orgId_warehouseId_customerReviewPending_createdAt",
        [
          { field: "warehouseId", value: warehouseId },
          { field: "customerReviewPending", value: true },
        ],
      );
}

function collectReviewScans(
  scans: Doc<"finishedGoodsJobScans">[],
  rows: readonly Doc<"finishedGoodsJobScans">[],
) {
  for (const scan of rows) {
    if (
      isReviewPendingScan(scan) &&
      normalizeCustomerName(scan.customer ?? "")
    ) {
      scans.push(scan);
    }
  }
}

export async function readPendingScansSummary(
  ctx: TenantFunctionContext,
  budget: number,
  scope?: Awaited<ReturnType<typeof allowedCustomerWarehouses>>,
) {
  const allowed = scope ?? (await allowedCustomerWarehouses(ctx));
  const scans: Doc<"finishedGoodsJobScans">[] = [];
  if (!allowed.hasWarehouseRead) return { allowed, scans, hasMore: false };

  // Count distinct eligible rows within a fixed read budget, prioritizing the
  // sparse index. A truncated raw range can still contain eligible legacy rows.
  let remaining = budget;
  let hasMore = !allowed.complete;
  for (const legacy of [false, true]) {
    for (const warehouse of allowed.warehouses) {
      const limit = Math.min(TENANT_INDEX_MAX_PAGE_SIZE, remaining + 1);
      const rows = await reviewScanRange(ctx, warehouse._id, legacy).take(
        limit,
        "desc",
      );
      const count = Math.min(rows.length, remaining);
      collectReviewScans(scans, rows.slice(0, count));
      remaining -= count;
      if (rows.length === limit) hasMore = true;
    }
  }
  return { allowed, scans, hasMore };
}

async function readPendingScansPage(
  ctx: TenantFunctionContext,
  scanCursor: string | undefined,
) {
  const start =
    scanCursor === undefined ? undefined : parseReviewCursor(scanCursor);
  const allowed = await allowedCustomerWarehouses(ctx, start);
  const scans: Doc<"finishedGoodsJobScans">[] = [];
  const result = (next?: ReviewScanCursor) => ({
    allowed,
    scans,
    hasMore: next !== undefined,
    scanCursor: next === undefined ? undefined : JSON.stringify(next),
  });
  if (!allowed.hasWarehouseRead) return result();

  let remaining = REVIEW_PAGE_SCAN_LIMIT;
  for (const warehouse of allowed.warehouses) {
    const key = allowed.orgWide ? warehouse.code : warehouse._id;
    const resume = start?.warehouseId === warehouse._id && start.key === key;
    for (const legacy of [false, true]) {
      if (resume && start.legacy && !legacy) continue;
      const cursor =
        resume && start.legacy === legacy ? start.cursor : undefined;
      const position = { key, warehouseId: warehouse._id, legacy };
      const range = reviewScanRange(ctx, warehouse._id, legacy);
      if (cursor === undefined) {
        const rows = await range.take(remaining + 1, "desc");
        if (rows.length <= remaining) {
          collectReviewScans(scans, rows);
          remaining -= rows.length;
          continue;
        }
        if (remaining === 0) return result(position);
      }

      // At most one native pagination call per Convex query. Resume this
      // range or use bounded takes for any later ranges that fit the budget.
      const page = await range.page({
        limit: remaining,
        ...(cursor === undefined ? {} : { cursor }),
        order: "desc",
      });
      collectReviewScans(scans, page.page);
      if (!page.isDone)
        return result({ ...position, cursor: page.continueCursor });

      // Defer other ranges until the next request if they require pagination.
      remaining = 0;
    }
  }
  return result(allowed.nextStart);
}

/**
 * Compact per-page customer activity summary (`linkedProductCount`, `latestJob`)
 * backed by `customerWarehouseActivity` so `listCustomersPage` retains its v1
 * read budget and zero-activity customers cost zero extra document reads.
 *
 * Each customer's activity rows (one per warehouse) are read to the end with
 * keyset continuation before warehouse scope is applied, so a customer active
 * in many warehouses is never reported as zero. A customer whose rows do not
 * fit the request's read budget is omitted (unknown), never under-counted.
 */
export const listCustomerActivitySummaries = queryWithOrg({
  ...readCustomers,
  args: {
    customerIds: v.array(v.id("customers")),
  },
  returns: v.object({
    canViewWarehouseData: v.boolean(),
    summaries: v.array(
      v.object({
        customerId: v.id("customers"),
        linkedProductCount: v.number(),
        latestJob: v.optional(customerLatestJob),
      }),
    ),
  }),
  handler: async (ctx, { customerIds }) => {
    const uniqueIds = [...new Set(customerIds)];
    if (uniqueIds.length > MAX_SUMMARY_CUSTOMERS) {
      throw new Error("TOO_MANY_CUSTOMERS");
    }
    const allowed = await allowedCustomerWarehouses(ctx);
    if (!allowed.hasWarehouseRead || uniqueIds.length === 0) {
      return {
        canViewWarehouseData: allowed.hasWarehouseRead,
        summaries: [],
      };
    }

    const budget: ScanBudget = { remaining: SUMMARY_READ_BUDGET };
    const accessCache = new Map<Id<"warehouses">, Promise<boolean>>();
    const isAllowedWarehouse = (warehouseId: Id<"warehouses">) => {
      if (allowed.byId.has(warehouseId)) return Promise.resolve(true);
      if (allowed.complete) return Promise.resolve(false);
      let cached = accessCache.get(warehouseId);
      if (cached === undefined) {
        // Exact check past the listed scope: a warehouse and a scope row.
        budget.remaining -= 2;
        cached = canAccessWarehouse(ctx, warehouseId);
        accessCache.set(warehouseId, cached);
      }
      return cached;
    };

    type ActivityRow = Doc<"customerWarehouseActivity">;
    const scanCustomer = (
      customerId: Id<"customers">,
      stepBudget: ScanBudget,
      start?: ScanPosition,
    ) =>
      scanVisible<ActivityRow, ActivityRow>({
        readBatch: (bound, limit) =>
          ctx.tenantDb
            .byIndex<ActivityRow>(
              "customerWarehouseActivity",
              "by_orgId_customerId_warehouseId",
              [{ field: "customerId", value: customerId }],
              bound === undefined
                ? undefined
                : {
                    field: "warehouseId",
                    lower: { value: bound, inclusive: true },
                  },
            )
            .take(limit),
        key: (row) => row.warehouseId,
        accept: async (row) =>
          (await isAllowedWarehouse(row.warehouseId)) ? row : null,
        want: Number.POSITIVE_INFINITY,
        budget: stepBudget,
        start,
      });

    // First a small slice for every customer (most use few warehouses), then
    // continue the busy ones while the shared budget lasts.
    const firstPass = await Promise.all(
      uniqueIds.map(async (customerId) => {
        const slice: ScanBudget = { remaining: SUMMARY_FIRST_SLICE };
        const result = await scanCustomer(customerId, slice);
        budget.remaining -= SUMMARY_FIRST_SLICE - slice.remaining;
        return { customerId, result };
      }),
    );
    const summaries = [];
    for (const { customerId, result: first } of firstPass) {
      let rows: ActivityRow[] | null = first.items.map(({ item }) => item);
      if (!first.done) {
        const rest =
          budget.remaining > 0
            ? await scanCustomer(customerId, budget, first.position)
            : null;
        rows = rest?.done
          ? [...rows, ...rest.items.map(({ item }) => item)]
          : null;
      }
      if (rows === null) continue;
      let linkedProductCount = 0;
      let latestJob:
        | {
            jobScanId: Id<"finishedGoodsJobScans">;
            factoryOrder: string;
            createdAt: number;
            warehouseId: Id<"warehouses">;
          }
        | undefined;
      for (const row of rows) {
        linkedProductCount += row.linkedProductCount;
        if (
          row.latestJobScanId !== undefined &&
          row.latestJobFactoryOrder !== undefined &&
          row.latestJobCreatedAt !== undefined &&
          (latestJob === undefined ||
            row.latestJobCreatedAt > latestJob.createdAt)
        ) {
          latestJob = {
            jobScanId: row.latestJobScanId,
            factoryOrder: row.latestJobFactoryOrder,
            createdAt: row.latestJobCreatedAt,
            warehouseId: row.warehouseId,
          };
        }
      }
      summaries.push({
        customerId,
        linkedProductCount,
        ...(latestJob === undefined ? {} : { latestJob }),
      });
    }

    return {
      canViewWarehouseData: true,
      summaries,
    };
  },
});

const jobItemValidator = v.object({
  jobScanId: v.id("finishedGoodsJobScans"),
  factoryOrder: v.string(),
  partName: v.optional(v.string()),
  warehouseId: v.id("warehouses"),
  warehouseName: v.string(),
  createdAt: v.number(),
  customerLinkSource: v.optional(customerLinkSource),
  capturedName: v.optional(v.string()),
});

export const getCustomerActivity = queryWithOrg({
  ...readCustomers,
  args: { customerId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      canViewWarehouseData: v.boolean(),
      aliases: v.array(aliasItemValidator),
      hasMoreAliases: v.boolean(),
      recentJobs: v.array(jobItemValidator),
      hasMoreJobs: v.boolean(),
      linkedProducts: v.array(linkedProductItemValidator),
      hasMoreProducts: v.boolean(),
    }),
  ),
  handler: async (ctx, { customerId }) => {
    const customer = await ctx.tenantDb.get<Doc<"customers">>(
      "customers",
      customerId,
    );
    if (!customer) return null;

    const [aliasRows, allowed] = await Promise.all([
      ctx.tenantDb
        .byIndex<Doc<"customerAliases">>(
          "customerAliases",
          "by_orgId_customerId_normalizedAlias",
          [{ field: "customerId", value: customer._id }],
        )
        .take(CUSTOMER_ALIASES_PREVIEW_LIMIT + 1),
      allowedCustomerWarehouses(ctx),
    ]);

    const hasMoreAliases = aliasRows.length > CUSTOMER_ALIASES_PREVIEW_LIMIT;
    const aliases = aliasRows
      .slice(0, CUSTOMER_ALIASES_PREVIEW_LIMIT)
      .map((row) => ({
        aliasId: row._id,
        alias: row.alias,
        approvedAt: row.approvedAt,
      }));

    if (
      !allowed.hasWarehouseRead ||
      (allowed.complete && allowed.warehouses.length === 0)
    ) {
      return {
        canViewWarehouseData: allowed.hasWarehouseRead,
        aliases,
        hasMoreAliases,
        recentJobs: [],
        hasMoreJobs: false,
        linkedProducts: [],
        hasMoreProducts: false,
      };
    }

    const jobs = await Promise.all(
      allowed.warehouses.map(async (warehouse) =>
        (
          await customerJobRange(ctx, customer._id, warehouse._id).take(
            RECENT_JOBS_LIMIT + 1,
            "desc",
          )
        ).map((scan) => ({ scan, warehouseName: warehouse.name })),
      ),
    );
    const visibleJobs = jobs
      .flat()
      .sort(
        ({ scan: a }, { scan: b }) =>
          b.createdAt - a.createdAt ||
          b._creationTime - a._creationTime ||
          b._id.localeCompare(a._id),
      );
    const hasMoreJobs =
      !allowed.complete || visibleJobs.length > RECENT_JOBS_LIMIT;
    const recentJobs = visibleJobs
      .slice(0, RECENT_JOBS_LIMIT)
      .map(({ scan, warehouseName }) => jobItem(scan, warehouseName));

    const visibleProducts: {
      product: Doc<"finishedGoodsProducts">;
      warehouseName: string;
    }[] = [];
    for (const warehouse of allowed.warehouses) {
      const remaining = LINKED_PRODUCTS_LIMIT + 1 - visibleProducts.length;
      if (remaining === 0) break;
      const products = await customerProductRange(
        ctx,
        customer._id,
        warehouse._id,
      ).take(remaining);
      visibleProducts.push(
        ...products.map((product) => ({
          product,
          warehouseName: warehouse.name,
        })),
      );
    }
    visibleProducts.sort((a, b) =>
      a.product.name.localeCompare(b.product.name),
    );
    const hasMoreProducts =
      !allowed.complete || visibleProducts.length > LINKED_PRODUCTS_LIMIT;
    const linkedProducts = await hydrateLinkedProducts(
      ctx,
      visibleProducts.slice(0, LINKED_PRODUCTS_LIMIT),
    );

    return {
      canViewWarehouseData: true,
      aliases,
      hasMoreAliases,
      recentJobs,
      hasMoreJobs,
      linkedProducts,
      hasMoreProducts,
    };
  },
});

export const listCustomerAliasesPage = queryWithOrg({
  ...readCustomers,
  args: {
    customerId: v.id("customers"),
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
  },
  returns: v.union(
    v.null(),
    v.object({
      items: v.array(aliasItemValidator),
      isDone: v.boolean(),
      continueCursor: v.string(),
    }),
  ),
  handler: async (ctx, { customerId, cursor, pageSize }) => {
    const limit = pageSize ?? CUSTOMER_ALIASES_PREVIEW_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("INVALID_PAGE_SIZE");
    }
    const customer = await ctx.tenantDb.get<Doc<"customers">>(
      "customers",
      customerId,
    );
    if (!customer) return null;

    const page = await ctx.tenantDb
      .byIndex<Doc<"customerAliases">>(
        "customerAliases",
        "by_orgId_customerId_normalizedAlias",
        [{ field: "customerId", value: customer._id }],
      )
      .page({ limit, ...(cursor ? { cursor } : {}) });

    return {
      items: page.page.map((row) => ({
        aliasId: row._id,
        alias: row.alias,
        approvedAt: row.approvedAt,
      })),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const listCustomerProductsPage = queryWithOrg({
  ...readCustomers,
  args: {
    customerId: v.id("customers"),
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
  },
  returns: v.union(
    v.null(),
    v.object({
      canViewWarehouseData: v.boolean(),
      items: v.array(linkedProductItemValidator),
      isDone: v.boolean(),
      continueCursor: v.string(),
    }),
  ),
  handler: async (ctx, { customerId, cursor, pageSize }) => {
    const limit = pageSize ?? LINKED_PRODUCTS_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("INVALID_PAGE_SIZE");
    }
    const customer = await ctx.tenantDb.get<Doc<"customers">>(
      "customers",
      customerId,
    );
    if (!customer) return null;

    const { items, ...page } = await pageWarehouseActivity(
      ctx,
      customer._id,
      cursor,
      limit,
      (warehouseId) => customerProductRange(ctx, customer._id, warehouseId),
      "asc",
    );
    return {
      ...page,
      items: await hydrateLinkedProducts(
        ctx,
        items.map(({ row, warehouseName }) => ({
          product: row,
          warehouseName,
        })),
      ),
    };
  },
});

export function customerProductRange(
  ctx: TenantFunctionContext,
  customerId: Id<"customers">,
  warehouseId: Id<"warehouses">,
) {
  return ctx.tenantDb.byIndex<Doc<"finishedGoodsProducts">>(
    "finishedGoodsProducts",
    "by_orgId_warehouseId_customerId",
    [
      { field: "warehouseId", value: warehouseId },
      { field: "customerId", value: customerId },
    ],
  );
}

export function customerJobRange(
  ctx: TenantFunctionContext,
  customerId: Id<"customers">,
  warehouseId: Id<"warehouses">,
) {
  return ctx.tenantDb.byIndex<Doc<"finishedGoodsJobScans">>(
    "finishedGoodsJobScans",
    "by_orgId_warehouseId_customerId_voided_createdAt",
    [
      { field: "warehouseId", value: warehouseId },
      { field: "customerId", value: customerId },
      { field: "voided", value: undefined, missing: true },
    ],
  );
}

function jobItem(scan: Doc<"finishedGoodsJobScans">, warehouseName: string) {
  return {
    jobScanId: scan._id,
    factoryOrder: scan.factoryOrder,
    ...(scan.partName === undefined ? {} : { partName: scan.partName }),
    warehouseId: scan.warehouseId,
    warehouseName,
    createdAt: scan.createdAt,
    ...(scan.customerLinkSource === undefined
      ? {}
      : { customerLinkSource: scan.customerLinkSource }),
    ...(scan.customer === undefined ? {} : { capturedName: scan.customer }),
  };
}

export const listCustomerJobsPage = queryWithOrg({
  ...readCustomers,
  args: { customerId: v.id("customers"), cursor: v.optional(v.string()) },
  returns: v.union(
    v.null(),
    v.object({
      canViewWarehouseData: v.boolean(),
      items: v.array(jobItemValidator),
      isDone: v.boolean(),
      continueCursor: v.string(),
    }),
  ),
  handler: async (ctx, { customerId, cursor }) => {
    const customer = await ctx.tenantDb.get<Doc<"customers">>(
      "customers",
      customerId,
    );
    if (!customer) return null;
    const { items, ...page } = await pageWarehouseActivity(
      ctx,
      customer._id,
      cursor,
      RECENT_JOBS_LIMIT,
      (warehouseId) => customerJobRange(ctx, customer._id, warehouseId),
      "desc",
    );
    return {
      ...page,
      items: items.map(({ row, warehouseName }) => jobItem(row, warehouseName)),
    };
  },
});

export const searchCustomerOptions = queryWithOrg({
  ...readCustomers,
  args: {
    search: v.optional(v.string()),
    includeCustomerId: v.optional(v.string()),
    scanCursor: v.optional(v.string()),
  },
  returns: v.object({
    items: v.array(customerSummary),
    hasMore: v.boolean(),
    scanCursor: v.optional(v.string()),
  }),
  handler: async (ctx, { search, includeCustomerId, scanCursor }) => {
    const rawSearch = (search ?? "").trim();
    const needle = normalizeCustomerName(rawSearch);
    const isFirstPage = !scanCursor;

    const [included, exactCode, exactNames, exactAliases, activePage] =
      await Promise.all([
        includeCustomerId
          ? ctx.tenantDb.get<Doc<"customers">>("customers", includeCustomerId)
          : Promise.resolve(null),
        isFirstPage && rawSearch
          ? ctx.tenantDb
              .byIndex<Doc<"customers">>("customers", "by_orgId_code", [
                { field: "code", value: rawSearch.toUpperCase() },
              ])
              .unique()
          : Promise.resolve(null),
        isFirstPage && needle
          ? ctx.tenantDb
              .byIndex<Doc<"customers">>(
                "customers",
                "by_orgId_status_normalizedName",
                [
                  { field: "status", value: "ACTIVE" },
                  { field: "normalizedName", value: needle },
                ],
              )
              .take(10)
          : Promise.resolve([]),
        isFirstPage && needle
          ? ctx.tenantDb
              .byIndex<Doc<"customerAliases">>(
                "customerAliases",
                "by_orgId_normalizedAlias",
                [{ field: "normalizedAlias", value: needle }],
              )
              .take(10)
          : Promise.resolve([]),
        ctx.tenantDb
          .byIndex<Doc<"customers">>(
            "customers",
            "by_orgId_status_normalizedName",
            [{ field: "status", value: "ACTIVE" }],
          )
          .page({
            limit: needle ? PICKER_SEARCH_PAGE_LIMIT : PICKER_DEFAULT_LIMIT,
            ...(scanCursor ? { cursor: scanCursor } : {}),
          }),
      ]);

    const exactAliasDocs =
      exactAliases.length > 0
        ? (
            await Promise.all(
              [...new Set(exactAliases.map((row) => row.customerId))].map(
                (id) => ctx.tenantDb.get<Doc<"customers">>("customers", id),
              ),
            )
          ).filter(
            (doc): doc is Doc<"customers"> =>
              doc !== null && doc.status === "ACTIVE",
          )
        : [];

    const items: ReturnType<typeof toSummary>[] = [];
    const seen = new Set<Id<"customers">>();
    const push = (doc: Doc<"customers"> | null) => {
      if (!doc || seen.has(doc._id)) return;
      seen.add(doc._id);
      items.push(toSummary(doc));
    };

    if (included) push(included);
    if (exactCode?.status === "ACTIVE") push(exactCode);
    for (const doc of exactNames) push(doc);
    for (const doc of exactAliasDocs) push(doc);

    for (const row of activePage.page) {
      if (
        !needle ||
        row.normalizedName.includes(needle) ||
        normalizeCustomerName(row.code).includes(needle) ||
        normalizeCustomerName(row.legalNameTh ?? "").includes(needle) ||
        normalizeCustomerName(row.legalNameEn ?? "").includes(needle) ||
        (row.aliasSearchText?.includes(needle) ?? false)
      ) {
        push(row);
      }
    }

    return {
      items,
      hasMore: !activePage.isDone,
      ...(activePage.isDone ? {} : { scanCursor: activePage.continueCursor }),
    };
  },
});

export const addCustomerAlias = mutationWithOrg({
  permissionCode: NAVIGATION_PERMISSION.customerManage,
  args: {
    requestId: v.string(),
    customerId: v.id("customers"),
    alias: v.string(),
    exampleJobScanId: v.optional(v.id("finishedGoodsJobScans")),
  },
  returns: aliasWriteOutcome,
  target: {
    table: "customers",
    id: ({ customerId }: { customerId: Id<"customers"> }) => customerId,
  },
  handler: async (ctx, args) => {
    const context = writeContextOf(ctx, {
      table: "customerAliases",
      operation: "customer.alias.add",
      requestId: args.requestId,
    });
    if (args.exampleJobScanId) {
      const warehouseGrants = await grantedPermissionsAmong(ctx, [
        NAVIGATION_PERMISSION.storageLayouts,
      ]);
      if (!warehouseGrants.includes(NAVIGATION_PERMISSION.storageLayouts)) {
        return failure("ACCESS_DENIED", "exampleJobScanId");
      }
      const scan = await ctx.tenantDb.get<Doc<"finishedGoodsJobScans">>(
        "finishedGoodsJobScans",
        args.exampleJobScanId,
      );
      if (!scan) return failure("NOT_FOUND", "exampleJobScanId");
      if (!(await canAccessWarehouse(ctx, scan.warehouseId))) {
        return failure("ACCESS_DENIED", "exampleJobScanId");
      }
    }

    const replay = await replayTenantWriteIfPresent({
      ...context,
      fingerprint: args,
    });
    if (!replay.ok) return failure(replay.error.code);
    if (replay.value) {
      return {
        ok: true as const,
        aliasId: replay.value.documentId,
        replayed: true,
      };
    }

    const validated = validateCustomerAlias(args.alias);
    if (!validated.ok)
      return failure(validated.error.code, validated.error.field);

    const customer = await ctx.tenantDb.get<Doc<"customers">>(
      "customers",
      args.customerId,
    );
    if (!customer) return failure("NOT_FOUND");
    if (customer.status === "ARCHIVED") return failure("CUSTOMER_ARCHIVED");

    const requestHash = await fingerprintArguments(args);
    if (!requestHash.ok) return failure(requestHash.error.code);
    const approval = await approveCustomerAlias(
      context,
      customer,
      validated.value,
      args.exampleJobScanId,
    );
    if (!approval.ok) return failure(approval.code, "alias");
    if (!approval.created) return failure("DUPLICATE_KEY", "alias");
    const { aliasId } = approval;
    await writeIdempotencyRecord({
      tenantDb: ctx.tenantDb,
      operation: "customer.alias.add",
      requestId: context.requestId,
      requestHash: requestHash.value,
      resultRef: aliasId,
      resultHash: await resultIdentityDigest("customerAliases", aliasId),
      actorUserId: context.actorUserId,
      now: context.now,
    });

    return { ok: true as const, aliasId, replayed: false };
  },
});

export const removeCustomerAlias = mutationWithOrg({
  permissionCode: NAVIGATION_PERMISSION.customerManage,
  args: {
    requestId: v.string(),
    aliasId: v.id("customerAliases"),
  },
  returns: aliasWriteOutcome,
  target: {
    table: "customerAliases",
    id: ({ aliasId }: { aliasId: Id<"customerAliases"> }) => aliasId,
  },
  handler: async (ctx, args) => {
    const context = writeContextOf(ctx, {
      table: "customerAliases",
      operation: "customer.alias.remove",
      requestId: args.requestId,
    });
    const requestHash = await fingerprintArguments(args);
    if (!requestHash.ok) return failure(requestHash.error.code);
    const decision = await checkIdempotency({
      tenantDb: ctx.tenantDb,
      operation: context.operation,
      requestId: context.requestId,
      requestHash: requestHash.value,
    });
    if (!decision.ok) return failure(decision.error.code);
    if (decision.value.kind === "REPLAY") {
      const replayedId = await verifiedResultIdentity(
        decision.value.record,
        "customerAliases",
      );
      if (!replayedId) return failure("REPLAY_TARGET_MISSING");
      return {
        ok: true as const,
        aliasId: replayedId,
        replayed: true,
      };
    }

    const row = await ctx.tenantDb.get<Doc<"customerAliases">>(
      "customerAliases",
      args.aliasId,
    );
    if (!row) return failure("NOT_FOUND");

    await ctx.tenantDb.delete("customerAliases", row._id);
    await removeCustomerAliasFromSearchText(
      ctx.tenantDb,
      row.customerId,
      row.normalizedAlias,
    );
    await ctx.tenantDb.insert("auditEvents", {
      occurredAt: context.now,
      actorKind: "USER",
      actorUserId: context.actorUserId,
      action: "customer.alias.remove",
      permissionCode: context.permissionCode,
      entityTable: "customerAliases",
      entityId: row._id,
      outcome: "ALLOWED",
      requestId: context.requestId,
      changes: [
        { field: "customerId", from: row.customerId },
        { field: "alias" },
      ],
    });
    await writeIdempotencyRecord({
      tenantDb: ctx.tenantDb,
      operation: "customer.alias.remove",
      requestId: context.requestId,
      requestHash: requestHash.value,
      resultRef: row._id,
      resultHash: await resultIdentityDigest("customerAliases", row._id),
      actorUserId: context.actorUserId,
      now: context.now,
    });
    await bumpCustomerCatalogueGeneration(ctx.tenantDb);

    return { ok: true as const, aliasId: row._id, replayed: false };
  },
});

export const reviewSummary = queryWithOrg({
  ...readCustomers,
  args: {},
  returns: v.object({
    canViewWarehouseData: v.boolean(),
    canReview: v.boolean(),
    unresolvedNameCount: v.number(),
    unresolvedScanCount: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx) => {
    const [manageGrants, { allowed, scans, hasMore }] = await Promise.all([
      grantedPermissionsAmong(ctx, [NAVIGATION_PERMISSION.customerManage]),
      readPendingScansSummary(ctx, REVIEW_SCAN_BUDGET),
    ]);
    const canManageCustomers = manageGrants.includes(
      NAVIGATION_PERMISSION.customerManage,
    );
    const names = new Set<string>();
    for (const scan of scans) {
      const key = normalizeCustomerName(scan.customer ?? "");
      if (key) names.add(key);
    }
    return {
      canViewWarehouseData: allowed.hasWarehouseRead,
      canReview:
        canManageCustomers &&
        allowed.hasWarehouseRead &&
        allowed.hasWarehouseManage,
      unresolvedNameCount: names.size,
      unresolvedScanCount: scans.length,
      hasMore,
    };
  },
});

export const listUnresolvedNames = queryWithOrg({
  ...readCustomers,
  args: {
    scanCursor: v.optional(v.string()),
  },
  returns: v.object({
    canViewWarehouseData: v.boolean(),
    canReview: v.boolean(),
    hasMore: v.boolean(),
    scanCursor: v.optional(v.string()),
    groups: v.array(
      v.object({
        normalizedName: v.string(),
        displayName: v.string(),
        scanCount: v.number(),
        latestAt: v.number(),
        warehouses: v.array(
          v.object({
            warehouseId: v.id("warehouses"),
            name: v.string(),
          }),
        ),
        scans: v.array(
          v.object({
            jobScanId: v.id("finishedGoodsJobScans"),
            warehouseId: v.id("warehouses"),
            warehouseName: v.string(),
            factoryOrder: v.string(),
            partName: v.optional(v.string()),
            capturedName: v.string(),
            createdAt: v.number(),
            version: v.number(),
          }),
        ),
        matchKind: v.union(
          v.literal("AMBIGUOUS"),
          v.literal("ARCHIVED"),
          v.literal("SIMILAR"),
          v.literal("NONE"),
        ),
        candidates: v.array(
          v.object({
            customerId: v.id("customers"),
            code: v.string(),
            name: v.string(),
            province: v.optional(v.string()),
            status: customerStatus,
          }),
        ),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const [manageGrants, pageResult] = await Promise.all([
      grantedPermissionsAmong(ctx, [NAVIGATION_PERMISSION.customerManage]),
      readPendingScansPage(ctx, args.scanCursor),
    ]);
    const { allowed, scans, hasMore, scanCursor: nextCursor } = pageResult;
    const canManageCustomers = manageGrants.includes(
      NAVIGATION_PERMISSION.customerManage,
    );
    const canReview =
      canManageCustomers &&
      allowed.hasWarehouseRead &&
      allowed.hasWarehouseManage;
    if (!allowed.hasWarehouseRead || scans.length === 0) {
      return {
        canViewWarehouseData: allowed.hasWarehouseRead,
        canReview,
        hasMore,
        ...(nextCursor === undefined ? {} : { scanCursor: nextCursor }),
        groups: [],
      };
    }

    const grouped = new Map<
      string,
      {
        displayName: string;
        latestAt: number;
        warehouseIds: Set<Id<"warehouses">>;
        scans: Doc<"finishedGoodsJobScans">[];
      }
    >();
    for (const scan of scans) {
      const captured = scan.customer?.trim();
      if (!captured) continue;
      const key = normalizeCustomerName(captured);
      if (!key) continue;
      let bucket = grouped.get(key);
      if (!bucket) {
        bucket = {
          displayName: captured,
          latestAt: scan.createdAt,
          warehouseIds: new Set(),
          scans: [],
        };
        grouped.set(key, bucket);
      }
      if (scan.createdAt > bucket.latestAt) {
        bucket.latestAt = scan.createdAt;
        bucket.displayName = captured;
      }
      bucket.warehouseIds.add(scan.warehouseId);
      bucket.scans.push(scan);
    }

    // Reuse loaded customer docs across groups in the same page.
    const customerCache = new Map<
      Id<"customers">,
      Promise<Doc<"customers"> | null>
    >();
    const readCustomer = (id: Id<"customers">) => {
      let pending = customerCache.get(id);
      if (!pending) {
        pending = ctx.tenantDb.get<Doc<"customers">>("customers", id);
        customerCache.set(id, pending);
      }
      return pending;
    };

    const entries = [...grouped.entries()];
    const exactResults = await Promise.all(
      entries.map(async ([normalizedName, bucket]) => ({
        normalizedName,
        bucket,
        exact: await resolveExactCustomerMatch(
          ctx.tenantDb,
          bucket.displayName,
        ),
      })),
    );

    const needsStemSample = exactResults.some(
      ({ exact }) => exact.kind === "UNMATCHED",
    );
    const activeByStem = new Map<string, Doc<"customers">[]>();
    let activeEntries: {
      customer: Doc<"customers">;
      stem: string;
      legalThStem: string;
      legalEnStem: string;
    }[] = [];
    if (needsStemSample) {
      const activeCustomers = await ctx.tenantDb
        .byIndex<Doc<"customers">>(
          "customers",
          "by_orgId_status_normalizedName",
          [{ field: "status", value: "ACTIVE" }],
        )
        .take(ACTIVE_CUSTOMER_SAMPLE);
      activeEntries = activeCustomers.map((customer) => {
        customerCache.set(customer._id, Promise.resolve(customer));
        return {
          customer,
          stem: compactCustomerStem(customer.name),
          legalThStem: customer.legalNameTh
            ? compactCustomerStem(customer.legalNameTh)
            : "",
          legalEnStem: customer.legalNameEn
            ? compactCustomerStem(customer.legalNameEn)
            : "",
        };
      });
      for (const entry of activeEntries) {
        for (const stem of new Set(
          [entry.stem, entry.legalThStem, entry.legalEnStem].filter(Boolean),
        )) {
          const list = activeByStem.get(stem) ?? [];
          list.push(entry.customer);
          activeByStem.set(stem, list);
        }
      }
    }

    const groups = await Promise.all(
      exactResults.map(async ({ normalizedName, bucket, exact }) => {
        let matchKind: "AMBIGUOUS" | "ARCHIVED" | "SIMILAR" | "NONE" = "NONE";
        const candidateDocs: Doc<"customers">[] = [];
        const addedIds = new Set<string>();
        const pushCandidate = (doc: Doc<"customers"> | null) => {
          if (!doc || addedIds.has(doc._id)) return;
          addedIds.add(doc._id);
          candidateDocs.push(doc);
        };

        if (exact.kind === "AMBIGUOUS") {
          matchKind = "AMBIGUOUS";
          const docs = await Promise.all(exact.customerIds.map(readCustomer));
          for (const doc of docs) {
            if (doc?.status === "ACTIVE") pushCandidate(doc);
          }
        } else if (exact.kind === "ARCHIVED") {
          matchKind = "ARCHIVED";
          pushCandidate(await readCustomer(exact.customerId));
        } else if (exact.kind === "MATCHED") {
          matchKind = "SIMILAR";
          pushCandidate(await readCustomer(exact.customerId));
        }

        if (candidateDocs.length === 0) {
          const stem = compactCustomerStem(bucket.displayName);
          if (stem.length >= 2) {
            const directStemHits = activeByStem.get(stem) ?? [];
            for (const doc of directStemHits) pushCandidate(doc);
            if (candidateDocs.length < 3) {
              for (const entry of activeEntries) {
                if (candidateDocs.length >= 3) break;
                if (addedIds.has(entry.customer._id)) continue;
                const stems = [
                  entry.stem,
                  entry.legalThStem,
                  entry.legalEnStem,
                ].filter((s) => s.length >= 2);
                if (
                  stems.some(
                    (candidateStem) =>
                      candidateStem.includes(stem) ||
                      stem.includes(candidateStem),
                  )
                ) {
                  pushCandidate(entry.customer);
                }
              }
            }
          }
          if (candidateDocs.length > 0) {
            matchKind = candidateDocs.length > 1 ? "AMBIGUOUS" : "SIMILAR";
          }
        }

        return {
          normalizedName,
          displayName: bucket.displayName,
          scanCount: bucket.scans.length,
          latestAt: bucket.latestAt,
          warehouses: [...bucket.warehouseIds]
            .map((warehouseId) => ({
              warehouseId,
              name: allowed.byId.get(warehouseId)?.name ?? "",
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
          scans: bucket.scans.slice(0, MAX_RESOLVE_SCANS).map((scan) => ({
            jobScanId: scan._id,
            warehouseId: scan.warehouseId,
            warehouseName: allowed.byId.get(scan.warehouseId)?.name ?? "",
            factoryOrder: scan.factoryOrder,
            ...(scan.partName === undefined ? {} : { partName: scan.partName }),
            capturedName: scan.customer?.trim() ?? bucket.displayName,
            createdAt: scan.createdAt,
            version: scan.version ?? 1,
          })),
          matchKind,
          candidates: candidateDocs.slice(0, 5).map(toSummary),
        };
      }),
    );

    groups.sort((a, b) => b.scanCount - a.scanCount || b.latestAt - a.latestAt);

    return {
      canViewWarehouseData: true,
      canReview,
      hasMore,
      ...(nextCursor === undefined ? {} : { scanCursor: nextCursor }),
      groups,
    };
  },
});

export const resolveUnresolvedScans = mutationWithOrg({
  writer: inventoryWriter,
  permissionCode: NAVIGATION_PERMISSION.customerManage,
  args: {
    requestId: v.string(),
    action: v.union(v.literal("LINK"), v.literal("SKIP")),
    customerId: v.optional(v.id("customers")),
    rememberAlias: v.optional(v.boolean()),
    aliasText: v.optional(v.string()),
    scans: v.array(
      v.object({
        jobScanId: v.id("finishedGoodsJobScans"),
        expectedVersion: v.number(),
      }),
    ),
  },
  returns: resolveOutcome,
  target: { table: "finishedGoodsJobScans" },
  handler: async (ctx, args) => {
    if (args.scans.length === 0 || args.scans.length > MAX_RESOLVE_SCANS)
      return failure("SCAN_GROUP_SIZE_INVALID");

    // Authorize warehouse manage permission and exact per-scan warehouse scope
    // BEFORE checking idempotency replay so revoked callers cannot probe or
    // replay earlier receipts.
    const required = [
      NAVIGATION_PERMISSION.customers,
      NAVIGATION_PERMISSION.storageLayouts,
      NAVIGATION_PERMISSION.storageLayoutManage,
    ] as const;
    const grants = await grantedPermissionsAmong(ctx, required);
    if (!required.every((code) => grants.includes(code)))
      return failure("ACCESS_DENIED");

    const seenIds = new Set<string>();
    const loadedScans: Doc<"finishedGoodsJobScans">[] = [];
    const warehouseAccessCache = new Map<Id<"warehouses">, boolean>();
    for (const item of args.scans) {
      if (seenIds.has(item.jobScanId))
        return failure("SCAN_GROUP_SIZE_INVALID");
      seenIds.add(item.jobScanId);
      const scan = await ctx.tenantDb.get<Doc<"finishedGoodsJobScans">>(
        "finishedGoodsJobScans",
        item.jobScanId,
      );
      if (!scan) return failure("NOT_FOUND");
      let allowedWarehouse = warehouseAccessCache.get(scan.warehouseId);
      if (allowedWarehouse === undefined) {
        allowedWarehouse = await canAccessWarehouse(ctx, scan.warehouseId);
        warehouseAccessCache.set(scan.warehouseId, allowedWarehouse);
      }
      if (!allowedWarehouse) return failure("ACCESS_DENIED");
      loadedScans.push(scan);
    }

    const context = writeContextOf(ctx, {
      table: "finishedGoodsJobScans",
      operation: "customer.review.resolve",
      requestId: args.requestId,
    });
    const requestHash = await fingerprintArguments(args);
    if (!requestHash.ok) return failure(requestHash.error.code);
    const decision = await checkIdempotency({
      tenantDb: ctx.tenantDb,
      operation: context.operation,
      requestId: context.requestId,
      requestHash: requestHash.value,
    });
    if (!decision.ok) return failure(decision.error.code);
    if (decision.value.kind === "REPLAY") {
      const { resultRef, resultHash, status } = decision.value.record;
      if (
        !resultRef ||
        status !== "SUCCEEDED" ||
        (await sha256Hex(resultRef)) !== resultHash
      )
        return failure("REPLAY_TARGET_MISSING");
      const receipt: { updatedCount: number; aliasId?: string } =
        JSON.parse(resultRef);
      return { ok: true as const, ...receipt, replayed: true };
    }

    // Validate every scan's state, version, and single-name group membership
    // before touching any record.
    let groupNormalizedName: string | null = null;
    let newestScan = loadedScans[0]!;
    for (let i = 0; i < loadedScans.length; i += 1) {
      const scan = loadedScans[i]!;
      const expectedVersion = args.scans[i]!.expectedVersion;
      if (scan.voided) return failure("NOT_FOUND");
      if (!isReviewPendingScan(scan)) return failure("ALREADY_RESOLVED");
      const currentVersion = scan.version ?? 1;
      if (
        !Number.isSafeInteger(expectedVersion) ||
        expectedVersion !== currentVersion
      ) {
        return failure("STALE_REVISION");
      }
      const normalized = normalizeCustomerName(scan.customer ?? "");
      if (!normalized) return failure("ALREADY_RESOLVED");
      if (groupNormalizedName === null) {
        groupNormalizedName = normalized;
      } else if (groupNormalizedName !== normalized) {
        return failure("MIXED_NAME_GROUP");
      }
      if (scan.createdAt > newestScan.createdAt) {
        newestScan = scan;
      }
    }

    let targetCustomer: Doc<"customers"> | null = null;
    if (args.action === "LINK") {
      if (!args.customerId) return failure("FIELD_INVALID", "customerId");
      targetCustomer = await ctx.tenantDb.get<Doc<"customers">>(
        "customers",
        args.customerId,
      );
      if (!targetCustomer) return failure("NOT_FOUND", "customerId");
      if (targetCustomer.status === "ARCHIVED")
        return failure("CUSTOMER_ARCHIVED", "customerId");
    }

    let validatedAlias: { alias: string; normalizedAlias: string } | null =
      null;
    if (args.action === "LINK" && args.rememberAlias === true) {
      const rawAlias = args.aliasText ?? newestScan.customer?.trim() ?? "";
      const parsed = validateCustomerAlias(rawAlias);
      if (!parsed.ok) return failure(parsed.error.code, "aliasText");
      if (parsed.value.normalizedAlias !== groupNormalizedName) {
        return failure("FIELD_INVALID", "aliasText");
      }
      validatedAlias = parsed.value;
    }

    let aliasId: string | undefined;
    if (targetCustomer && validatedAlias) {
      const approval = await approveCustomerAlias(
        context,
        targetCustomer,
        validatedAlias,
        newestScan._id,
      );
      if (!approval.ok) return failure(approval.code, "aliasText");
      aliasId = approval.aliasId;
    }

    for (const scan of loadedScans) {
      const now = Math.max(context.now, scan.updatedAt + 1);
      await ctx.tenantDb.patch("finishedGoodsJobScans", scan._id, {
        customerId: targetCustomer?._id,
        customerLinkSource: args.action === "LINK" ? "MANUAL" : "UNLINKED",
        customerReviewPending: undefined,
        version: (scan.version ?? 1) + 1,
        updatedAt: now,
        updatedByUserId: context.actorUserId,
      });
      if (targetCustomer) {
        await recordCustomerJobLink(
          ctx.tenantDb,
          scan.warehouseId,
          targetCustomer._id,
          {
            jobScanId: scan._id,
            factoryOrder: scan.factoryOrder,
            createdAt: scan.createdAt,
          },
        );
      }
      await ctx.tenantDb.insert("auditEvents", {
        occurredAt: now,
        actorKind: "USER",
        actorUserId: context.actorUserId,
        action:
          args.action === "LINK"
            ? "customer.review.link"
            : "customer.review.skip",
        permissionCode: context.permissionCode,
        entityTable: "finishedGoodsJobScans",
        entityId: scan._id,
        warehouseId: scan.warehouseId,
        outcome: "ALLOWED",
        requestId: context.requestId,
        changes: [
          {
            field: "customerLinkSource",
            to: args.action === "LINK" ? "MANUAL" : "UNLINKED",
          },
          ...(targetCustomer
            ? [{ field: "customerId", to: targetCustomer._id }]
            : []),
          ...(aliasId ? [{ field: "aliasId", to: aliasId }] : []),
        ],
      });
    }

    const receipt = {
      updatedCount: loadedScans.length,
      ...(aliasId === undefined ? {} : { aliasId }),
    };
    const resultRef = JSON.stringify(receipt);
    await writeIdempotencyRecord({
      tenantDb: ctx.tenantDb,
      operation: "customer.review.resolve",
      requestId: context.requestId,
      requestHash: requestHash.value,
      resultRef,
      resultHash: await sha256Hex(resultRef),
      actorUserId: context.actorUserId,
      now: context.now,
    });

    return {
      ok: true as const,
      ...receipt,
      replayed: false,
    };
  },
});
