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
import { writeContextOf } from "../lib/writeEnvelope";
import { NAVIGATION_PERMISSION } from "../model/authorization/navigationPermissions";
import {
  compactCustomerStem,
  normalizeCustomerName,
  validateCustomerAlias,
} from "../model/customers/customers";
import {
  addCustomerAliasToSearchText,
  isReviewPendingScan,
  recordCustomerJobLink,
  removeCustomerAliasFromSearchText,
} from "./activitySummary";
import { bumpCustomerCatalogueGeneration } from "./catalogueGeneration";
import { resolveExactCustomerMatch } from "./matching";
import {
  customerLatestJob,
  customerLinkSource,
  customerStatus,
  customerSummary,
} from "./validators";
import {
  allowedCustomerWarehouses,
  canAccessWarehouse,
  type AllowedCustomerWarehouses,
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

async function resolveWarehouseName(
  ctx: TenantFunctionContext,
  allowed: AllowedCustomerWarehouses,
  warehouseId: Id<"warehouses">,
  cache: Map<Id<"warehouses">, Doc<"warehouses"> | null>,
): Promise<string | null> {
  const known = allowed.byId.get(warehouseId);
  if (known) return known.name;
  if (allowed.complete) return null;
  if (!cache.has(warehouseId)) {
    const ok = await canAccessWarehouse(ctx, warehouseId);
    cache.set(
      warehouseId,
      ok
        ? await ctx.tenantDb.get<Doc<"warehouses">>("warehouses", warehouseId)
        : null,
    );
  }
  return cache.get(warehouseId)?.name ?? null;
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
  readonly w: number;
  readonly c?: string | undefined;
}

function parseReviewCursor(raw: string): ReviewScanCursor {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("w" in parsed) ||
      typeof parsed.w !== "number" ||
      !Number.isInteger(parsed.w) ||
      parsed.w < 0
    ) {
      throw new Error("REVIEW_CURSOR_INVALID");
    }
    const c = "c" in parsed ? parsed.c : undefined;
    if (c !== undefined && typeof c !== "string") {
      throw new Error("REVIEW_CURSOR_INVALID");
    }
    return { w: parsed.w, ...(c === undefined ? {} : { c }) };
  } catch {
    throw new Error("REVIEW_CURSOR_INVALID");
  }
}

/**
 * Fallback probe for pre-backfill legacy scans that do not yet carry
 * `customerReviewPending: true`. Bounded strictly per warehouse.
 */
async function readLegacyUnresolvedScans(
  ctx: TenantFunctionContext,
  warehouses: readonly Doc<"warehouses">[],
  budget: number,
) {
  if (warehouses.length === 0) {
    return { scans: [] as Doc<"finishedGoodsJobScans">[], hasMore: false };
  }
  const perWarehouse = Math.max(
    1,
    Math.min(100, Math.ceil(budget / warehouses.length) + 1),
  );
  const chunks = await Promise.all(
    warehouses.map((warehouse) =>
      ctx.tenantDb
        .byIndex<Doc<"finishedGoodsJobScans">>(
          "finishedGoodsJobScans",
          "by_orgId_warehouseId_customerLinkSource_createdAt",
          [
            { field: "warehouseId", value: warehouse._id },
            {
              field: "customerLinkSource",
              value: undefined,
              missing: true,
            },
          ],
        )
        .take(perWarehouse, "desc"),
    ),
  );
  let hasMore = false;
  const combined: Doc<"finishedGoodsJobScans">[] = [];
  for (const rows of chunks) {
    if (rows.length >= perWarehouse) hasMore = true;
    for (const scan of rows) {
      if (isReviewPendingScan(scan)) combined.push(scan);
    }
  }
  combined.sort((a, b) => b.createdAt - a.createdAt);
  if (combined.length > budget) {
    hasMore = true;
    combined.length = budget;
  }
  return { scans: combined, hasMore };
}

async function readPendingScansSummary(
  ctx: TenantFunctionContext,
  budget: number,
) {
  const allowed = await allowedCustomerWarehouses(ctx);
  if (!allowed.hasWarehouseRead || allowed.warehouses.length === 0) {
    return {
      allowed,
      scans: [] as Doc<"finishedGoodsJobScans">[],
      hasMore: false,
    };
  }
  const perWarehouse = Math.max(
    1,
    Math.min(100, Math.ceil(budget / allowed.warehouses.length) + 1),
  );
  const chunks = await Promise.all(
    allowed.warehouses.map((warehouse) =>
      ctx.tenantDb
        .byIndex<Doc<"finishedGoodsJobScans">>(
          "finishedGoodsJobScans",
          "by_orgId_warehouseId_customerReviewPending_createdAt",
          [
            { field: "warehouseId", value: warehouse._id },
            { field: "customerReviewPending", value: true },
          ],
        )
        .take(perWarehouse, "desc"),
    ),
  );
  let hasMore = !allowed.complete;
  const combined: Doc<"finishedGoodsJobScans">[] = [];
  for (const rows of chunks) {
    if (rows.length >= perWarehouse) hasMore = true;
    for (const scan of rows) {
      if (isReviewPendingScan(scan)) combined.push(scan);
    }
  }
  if (combined.length === 0 && !hasMore) {
    const legacy = await readLegacyUnresolvedScans(
      ctx,
      allowed.warehouses,
      budget,
    );
    return { allowed, scans: legacy.scans, hasMore: legacy.hasMore };
  }
  combined.sort((a, b) => b.createdAt - a.createdAt);
  if (combined.length > budget) {
    hasMore = true;
    combined.length = budget;
  }
  return { allowed, scans: combined, hasMore };
}

/**
 * Paginate review-pending scans across authorized warehouses using the sparse
 * `customerReviewPending: true` index so blank, voided, and resolved scans
 * never consume read budget or hide older unresolved tickets.
 */
async function readPendingScansPage(
  ctx: TenantFunctionContext,
  scanCursor: string | undefined,
) {
  const allowed = await allowedCustomerWarehouses(ctx);
  if (!allowed.hasWarehouseRead || allowed.warehouses.length === 0) {
    return {
      allowed,
      scans: [] as Doc<"finishedGoodsJobScans">[],
      hasMore: false,
      scanCursor: undefined as string | undefined,
    };
  }
  const warehouses = [...allowed.warehouses].sort((a, b) =>
    a._id.localeCompare(b._id),
  );
  const start = scanCursor ? parseReviewCursor(scanCursor) : { w: 0 };
  if (start.w >= warehouses.length) {
    return {
      allowed,
      scans: [] as Doc<"finishedGoodsJobScans">[],
      hasMore: false,
      scanCursor: undefined as string | undefined,
    };
  }

  let activeWarehouseIdx = start.w;
  if (start.c === undefined) {
    // Skip warehouses with zero indexed pending scans without consuming the
    // single `.page()` call allowed per Convex query.
    while (activeWarehouseIdx < warehouses.length) {
      const probe = await ctx.tenantDb
        .byIndex<Doc<"finishedGoodsJobScans">>(
          "finishedGoodsJobScans",
          "by_orgId_warehouseId_customerReviewPending_createdAt",
          [
            {
              field: "warehouseId",
              value: warehouses[activeWarehouseIdx]!._id,
            },
            { field: "customerReviewPending", value: true },
          ],
        )
        .take(1, "desc");
      if (probe.length > 0) break;
      activeWarehouseIdx += 1;
    }
  }

  if (activeWarehouseIdx >= warehouses.length) {
    if (!scanCursor) {
      const legacy = await readLegacyUnresolvedScans(
        ctx,
        warehouses,
        REVIEW_PAGE_SCAN_LIMIT,
      );
      return {
        allowed,
        scans: legacy.scans,
        hasMore: legacy.hasMore,
        scanCursor: undefined as string | undefined,
      };
    }
    return {
      allowed,
      scans: [] as Doc<"finishedGoodsJobScans">[],
      hasMore: false,
      scanCursor: undefined as string | undefined,
    };
  }

  const page = await ctx.tenantDb
    .byIndex<Doc<"finishedGoodsJobScans">>(
      "finishedGoodsJobScans",
      "by_orgId_warehouseId_customerReviewPending_createdAt",
      [
        { field: "warehouseId", value: warehouses[activeWarehouseIdx]!._id },
        { field: "customerReviewPending", value: true },
      ],
    )
    .page({
      limit: REVIEW_PAGE_SCAN_LIMIT,
      ...(start.c ? { cursor: start.c } : {}),
      order: "desc",
    });

  const collected: Doc<"finishedGoodsJobScans">[] =
    page.page.filter(isReviewPendingScan);
  if (!page.isDone) {
    return {
      allowed,
      scans: collected,
      hasMore: true,
      scanCursor: JSON.stringify({
        w: activeWarehouseIdx,
        c: page.continueCursor,
      }),
    };
  }

  // Current warehouse finished: pack any remaining whole warehouses that fit
  // into this page's scan budget, stopping cleanly before the first warehouse
  // that would overflow so continuation never skips or duplicates rows.
  let remaining = REVIEW_PAGE_SCAN_LIMIT - collected.length;
  for (let nextW = activeWarehouseIdx + 1; nextW < warehouses.length; nextW++) {
    const probeLimit = Math.max(1, remaining + 1);
    const chunk = await ctx.tenantDb
      .byIndex<Doc<"finishedGoodsJobScans">>(
        "finishedGoodsJobScans",
        "by_orgId_warehouseId_customerReviewPending_createdAt",
        [
          { field: "warehouseId", value: warehouses[nextW]!._id },
          { field: "customerReviewPending", value: true },
        ],
      )
      .take(probeLimit, "desc");
    if (chunk.length === 0) continue;
    if (remaining > 0 && chunk.length <= remaining) {
      for (const scan of chunk) {
        if (isReviewPendingScan(scan)) collected.push(scan);
      }
      remaining -= chunk.length;
      continue;
    }
    return {
      allowed,
      scans: collected,
      hasMore: true,
      scanCursor: JSON.stringify({ w: nextW }),
    };
  }

  return {
    allowed,
    scans: collected,
    hasMore: false,
    scanCursor: undefined as string | undefined,
  };
}

/**
 * Compact per-page customer activity summary (`linkedProductCount`, `latestJob`)
 * backed by `customerWarehouseActivity` so `listCustomersPage` retains its v1
 * read budget and zero-activity customers cost zero extra document reads.
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

    const accessCache = new Map<Id<"warehouses">, boolean>();
    const isAllowedWarehouse = async (
      warehouseId: Id<"warehouses">,
    ): Promise<boolean> => {
      if (allowed.byId.has(warehouseId)) return true;
      if (allowed.complete) return false;
      const cached = accessCache.get(warehouseId);
      if (cached !== undefined) return cached;
      const ok = await canAccessWarehouse(ctx, warehouseId);
      accessCache.set(warehouseId, ok);
      return ok;
    };

    const summaries = await Promise.all(
      uniqueIds.map(async (customerId) => {
        const rows = await ctx.tenantDb
          .byIndex<Doc<"customerWarehouseActivity">>(
            "customerWarehouseActivity",
            "by_orgId_customerId_warehouseId",
            [{ field: "customerId", value: customerId }],
          )
          .take(MAX_SUMMARY_CUSTOMERS);
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
          if (!(await isAllowedWarehouse(row.warehouseId))) continue;
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
        return {
          customerId,
          linkedProductCount,
          ...(latestJob === undefined ? {} : { latestJob }),
        };
      }),
    );

    return {
      canViewWarehouseData: true,
      summaries,
    };
  },
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
      recentJobs: v.array(
        v.object({
          jobScanId: v.id("finishedGoodsJobScans"),
          factoryOrder: v.string(),
          partName: v.optional(v.string()),
          warehouseId: v.id("warehouses"),
          warehouseName: v.string(),
          createdAt: v.number(),
          customerLinkSource: v.optional(customerLinkSource),
          capturedName: v.optional(v.string()),
        }),
      ),
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

    if (!allowed.hasWarehouseRead || allowed.warehouses.length === 0) {
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

    const warehouseCache = new Map<
      Id<"warehouses">,
      Doc<"warehouses"> | null
    >();
    const usePerWarehouse = allowed.complete && allowed.warehouses.length <= 20;

    const jobScanLimit = RECENT_JOBS_LIMIT + 1;
    const rawJobs = usePerWarehouse
      ? (
          await Promise.all(
            allowed.warehouses.map((warehouse) =>
              ctx.tenantDb
                .byIndex<Doc<"finishedGoodsJobScans">>(
                  "finishedGoodsJobScans",
                  "by_orgId_warehouseId_customerId_createdAt",
                  [
                    { field: "warehouseId", value: warehouse._id },
                    { field: "customerId", value: customer._id },
                  ],
                )
                .take(jobScanLimit + 5, "desc"),
            ),
          )
        ).flat()
      : await ctx.tenantDb
          .byIndex<Doc<"finishedGoodsJobScans">>(
            "finishedGoodsJobScans",
            "by_orgId_customerId_createdAt",
            [{ field: "customerId", value: customer._id }],
          )
          .take(50, "desc");

    const visibleJobs: {
      scan: Doc<"finishedGoodsJobScans">;
      warehouseName: string;
    }[] = [];
    for (const scan of rawJobs) {
      if (scan.voided) continue;
      const warehouseName = await resolveWarehouseName(
        ctx,
        allowed,
        scan.warehouseId,
        warehouseCache,
      );
      if (warehouseName === null) continue;
      visibleJobs.push({ scan, warehouseName });
    }
    visibleJobs.sort((a, b) => b.scan.createdAt - a.scan.createdAt);
    const hasMoreJobs =
      visibleJobs.length > RECENT_JOBS_LIMIT ||
      (!usePerWarehouse && rawJobs.length >= 50);
    const recentJobs = visibleJobs
      .slice(0, RECENT_JOBS_LIMIT)
      .map(({ scan, warehouseName }) => ({
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
      }));

    const productLimit = LINKED_PRODUCTS_LIMIT + 1;
    const rawProducts = usePerWarehouse
      ? (
          await Promise.all(
            allowed.warehouses.map((warehouse) =>
              ctx.tenantDb
                .byIndex<Doc<"finishedGoodsProducts">>(
                  "finishedGoodsProducts",
                  "by_orgId_warehouseId_customerId",
                  [
                    { field: "warehouseId", value: warehouse._id },
                    { field: "customerId", value: customer._id },
                  ],
                )
                .take(productLimit),
            ),
          )
        ).flat()
      : await ctx.tenantDb
          .byIndex<Doc<"finishedGoodsProducts">>(
            "finishedGoodsProducts",
            "by_orgId_customerId",
            [{ field: "customerId", value: customer._id }],
          )
          .take(productLimit);

    const visibleProducts: {
      product: Doc<"finishedGoodsProducts">;
      warehouseName: string;
    }[] = [];
    for (const product of rawProducts) {
      const warehouseName = await resolveWarehouseName(
        ctx,
        allowed,
        product.warehouseId,
        warehouseCache,
      );
      if (warehouseName === null) continue;
      visibleProducts.push({ product, warehouseName });
    }
    visibleProducts.sort((a, b) =>
      a.product.name.localeCompare(b.product.name),
    );
    const hasMoreProducts =
      visibleProducts.length > LINKED_PRODUCTS_LIMIT ||
      (!usePerWarehouse && rawProducts.length >= productLimit);
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

    const allowed = await allowedCustomerWarehouses(ctx);
    if (!allowed.hasWarehouseRead) {
      return {
        canViewWarehouseData: false,
        items: [],
        isDone: true,
        continueCursor: "",
      };
    }

    const page = await ctx.tenantDb
      .byIndex<Doc<"finishedGoodsProducts">>(
        "finishedGoodsProducts",
        "by_orgId_customerId",
        [{ field: "customerId", value: customer._id }],
      )
      .page({ limit, ...(cursor ? { cursor } : {}) });

    const warehouseCache = new Map<
      Id<"warehouses">,
      Doc<"warehouses"> | null
    >();
    const visible: {
      product: Doc<"finishedGoodsProducts">;
      warehouseName: string;
    }[] = [];
    for (const product of page.page) {
      const warehouseName = await resolveWarehouseName(
        ctx,
        allowed,
        product.warehouseId,
        warehouseCache,
      );
      if (warehouseName === null) continue;
      visible.push({ product, warehouseName });
    }
    const items = await hydrateLinkedProducts(ctx, visible);

    return {
      canViewWarehouseData: true,
      items,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
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

    const existing = await ctx.tenantDb
      .byIndex<Doc<"customerAliases">>(
        "customerAliases",
        "by_orgId_customerId_normalizedAlias",
        [
          { field: "customerId", value: customer._id },
          { field: "normalizedAlias", value: validated.value.normalizedAlias },
        ],
      )
      .unique();
    if (existing) return failure("DUPLICATE_KEY", "alias");

    const requestHash = await fingerprintArguments(args);
    if (!requestHash.ok) return failure(requestHash.error.code);

    const aliasId = await ctx.tenantDb.insert("customerAliases", {
      customerId: customer._id,
      alias: validated.value.alias,
      normalizedAlias: validated.value.normalizedAlias,
      ...(args.exampleJobScanId === undefined
        ? {}
        : { exampleJobScanId: args.exampleJobScanId }),
      approvedAt: context.now,
      approvedByUserId: context.actorUserId,
    });
    await addCustomerAliasToSearchText(
      ctx.tenantDb,
      customer._id,
      validated.value.normalizedAlias,
    );

    await ctx.tenantDb.insert("auditEvents", {
      occurredAt: context.now,
      actorKind: "USER",
      actorUserId: context.actorUserId,
      action: "customer.alias.add",
      permissionCode: context.permissionCode,
      entityTable: "customerAliases",
      entityId: aliasId,
      outcome: "ALLOWED",
      requestId: context.requestId,
      changes: [{ field: "customerId", to: customer._id }, { field: "alias" }],
    });
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
    await bumpCustomerCatalogueGeneration(ctx.tenantDb);

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
      canReview: canManageCustomers && allowed.hasWarehouseManage,
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
    const canReview = canManageCustomers && allowed.hasWarehouseManage;
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
    const manageGrants = await grantedPermissionsAmong(ctx, [
      NAVIGATION_PERMISSION.storageLayoutManage,
    ]);
    if (!manageGrants.includes(NAVIGATION_PERMISSION.storageLayoutManage))
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
      const verifiedId = await verifiedResultIdentity(
        decision.value.record,
        "finishedGoodsJobScans",
      );
      if (!verifiedId || verifiedId !== loadedScans[0]!._id) {
        return failure("REPLAY_TARGET_MISSING");
      }
      let replayedAliasId: string | undefined;
      if (
        args.action === "LINK" &&
        args.rememberAlias === true &&
        args.customerId
      ) {
        const newest = loadedScans.reduce((best, scan) =>
          scan.createdAt > best.createdAt ? scan : best,
        );
        const rawAlias = args.aliasText ?? newest.customer?.trim() ?? "";
        const normalizedAlias = normalizeCustomerName(rawAlias);
        if (normalizedAlias) {
          const existingAlias = await ctx.tenantDb
            .byIndex<Doc<"customerAliases">>(
              "customerAliases",
              "by_orgId_customerId_normalizedAlias",
              [
                { field: "customerId", value: args.customerId },
                { field: "normalizedAlias", value: normalizedAlias },
              ],
            )
            .unique();
          if (existingAlias) replayedAliasId = existingAlias._id;
        }
      }
      return {
        ok: true as const,
        updatedCount: args.scans.length,
        ...(replayedAliasId === undefined ? {} : { aliasId: replayedAliasId }),
        replayed: true,
      };
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
      const existing = await ctx.tenantDb
        .byIndex<Doc<"customerAliases">>(
          "customerAliases",
          "by_orgId_customerId_normalizedAlias",
          [
            { field: "customerId", value: targetCustomer._id },
            { field: "normalizedAlias", value: validatedAlias.normalizedAlias },
          ],
        )
        .unique();
      if (existing) {
        aliasId = existing._id;
      } else {
        aliasId = await ctx.tenantDb.insert("customerAliases", {
          customerId: targetCustomer._id,
          alias: validatedAlias.alias,
          normalizedAlias: validatedAlias.normalizedAlias,
          exampleJobScanId: newestScan._id,
          approvedAt: context.now,
          approvedByUserId: context.actorUserId,
        });
        await addCustomerAliasToSearchText(
          ctx.tenantDb,
          targetCustomer._id,
          validatedAlias.normalizedAlias,
        );
        await bumpCustomerCatalogueGeneration(ctx.tenantDb);
      }
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

    const firstId = loadedScans[0]!._id;
    await writeIdempotencyRecord({
      tenantDb: ctx.tenantDb,
      operation: "customer.review.resolve",
      requestId: context.requestId,
      requestHash: requestHash.value,
      resultRef: firstId,
      resultHash: await resultIdentityDigest("finishedGoodsJobScans", firstId),
      actorUserId: context.actorUserId,
      now: context.now,
    });

    return {
      ok: true as const,
      updatedCount: loadedScans.length,
      ...(aliasId === undefined ? {} : { aliasId }),
      replayed: false,
    };
  },
});
