import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import {
  readProductSummary,
  summaryReadiness,
} from "../lib/finishedGoodsSummary";
import { grantedPermissionsAmong } from "../lib/navigationGrants";
import { TENANT_INDEX_MAX_PAGE_SIZE } from "../lib/tenantDb";
import {
  queryWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import { NAVIGATION_PERMISSION } from "../model/authorization/navigationPermissions";
import {
  compactCustomerStem,
  normalizeCustomerName,
} from "../model/customers/customers";
import { pageWarehouseActivity } from "./activityReads";
import {
  customerJobRange,
  customerProductRange,
  readPendingScansSummary,
} from "./linking";
import { resolveExactCustomerMatch } from "./matching";
import { customerLinkSource } from "./validators";
import {
  allowedCustomerWarehouses,
  canAccessWarehouse,
} from "./warehouseScope";

/**
 * Customer workspace reads (docs/plans/customer-module-2026-11-18/
 * workspace-contract.md). Every read is organization-scoped by `queryWithOrg`
 * and limited to warehouses the member may access with storage-layout read.
 */
const readCustomers = {
  permissionCode: NAVIGATION_PERMISSION.customers,
  target: { table: "customers" },
} as const;

/** Rollup counts stop here and report `complete: false` ("99+"). */
const COUNT_CAP = TENANT_INDEX_MAX_PAGE_SIZE - 1;
const LATEST_JOBS = 3;
/** Activity rows (one per warehouse) read for one customer. */
const MAX_CUSTOMER_WAREHOUSES = 20;
const STOCK_PRODUCTS_CAP = TENANT_INDEX_MAX_PAGE_SIZE - 1;
const PENDING_REVIEW_SCAN_BUDGET = 300;
const JOBS_PAGE_DEFAULT = 20;
const JOBS_PAGE_MAX = 50;
const PRODUCTS_PAGE_DEFAULT = 10;
const PRODUCTS_PAGE_MAX = 20;
const PALLETS_PER_PRODUCT = 10;

const boundedCount = v.object({ count: v.number(), complete: v.boolean() });

const workspaceJob = v.object({
  jobScanId: v.id("finishedGoodsJobScans"),
  factoryOrder: v.string(),
  partName: v.optional(v.string()),
  productCode: v.string(),
  quantity: v.optional(v.number()),
  warehouseId: v.id("warehouses"),
  warehouseName: v.string(),
  createdAt: v.number(),
  source: v.union(v.literal("AI"), v.literal("BARCODE"), v.literal("MANUAL")),
  mapped: v.boolean(),
  locationText: v.string(),
  locationCode: v.optional(v.string()),
  locationName: v.optional(v.string()),
  customerLinkSource: v.optional(customerLinkSource),
  capturedName: v.optional(v.string()),
});

const workspacePallet = v.object({
  palletId: v.id("finishedGoodsPallets"),
  code: v.string(),
  quantity: v.number(),
  positionCode: v.optional(v.string()),
  zoneId: v.optional(v.id("storageZones")),
  zoneLabel: v.optional(v.string()),
});

const workspaceProduct = v.object({
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
  /** From the warehouse product summary; absent while it is being built. */
  storedCount: v.optional(v.number()),
  totalQuantity: v.optional(v.number()),
  /** First stored pallets, newest placement data included. */
  pallets: v.array(workspacePallet),
  hasMorePallets: v.boolean(),
  /** Distinct zone labels among `pallets`. */
  zones: v.array(v.string()),
});

function jobRow(scan: Doc<"finishedGoodsJobScans">, warehouseName: string) {
  return {
    jobScanId: scan._id,
    factoryOrder: scan.factoryOrder,
    ...(scan.partName === undefined ? {} : { partName: scan.partName }),
    productCode: scan.productBarcodeText,
    ...(scan.quantity === undefined ? {} : { quantity: scan.quantity }),
    warehouseId: scan.warehouseId,
    warehouseName,
    createdAt: scan.createdAt,
    source: scan.source,
    mapped: scan.mapped,
    locationText: scan.locationText,
    ...(scan.locationCode === undefined
      ? {}
      : { locationCode: scan.locationCode }),
    ...(scan.locationName === undefined
      ? {}
      : { locationName: scan.locationName }),
    ...(scan.customerLinkSource === undefined
      ? {}
      : { customerLinkSource: scan.customerLinkSource }),
    ...(scan.customer === undefined ? {} : { capturedName: scan.customer }),
  };
}

function mappedJobRange(
  ctx: TenantFunctionContext,
  customerId: Id<"customers">,
  warehouseId: Id<"warehouses">,
  mapped: boolean,
) {
  return ctx.tenantDb.byIndex<Doc<"finishedGoodsJobScans">>(
    "finishedGoodsJobScans",
    "by_orgId_warehouseId_customerId_voided_mapped_createdAt",
    [
      { field: "warehouseId", value: warehouseId },
      { field: "customerId", value: customerId },
      { field: "voided", value: undefined, missing: true },
      { field: "mapped", value: mapped },
    ],
  );
}

/** Count rows across ranges until `cap`; `complete` is false past the cap. */
async function countRanges(
  ranges: readonly (() => {
    take: (limit: number) => Promise<readonly unknown[]>;
  })[],
  cap: number,
) {
  let count = 0;
  for (const range of ranges) {
    const remaining = cap - count;
    const rows = await range().take(remaining + 1);
    if (rows.length > remaining) return { count: cap, complete: false };
    count += rows.length;
  }
  return { count, complete: true };
}

/**
 * Whether the review queue would propose `customer` for a captured name: an
 * exact canonical/alias match, or (for active customers, when the name has no
 * exact match anywhere) the queue's compact-stem similarity rule.
 */
async function proposedForCustomer(
  ctx: TenantFunctionContext,
  customer: Doc<"customers">,
  captured: string,
  exactCache: Map<string, Promise<boolean>>,
) {
  const normalized = normalizeCustomerName(captured);
  if (!normalized) return false;
  if (normalized === customer.normalizedName) return true;
  if (customer.aliasSearchText?.split("\n").includes(normalized)) return true;
  if (customer.status !== "ACTIVE") return false;
  const stem = compactCustomerStem(captured);
  if (stem.length < 2) return false;
  const stems = [customer.name, customer.legalNameTh, customer.legalNameEn]
    .filter((value): value is string => Boolean(value))
    .map(compactCustomerStem)
    .filter((value) => value.length >= 2);
  if (!stems.some((value) => value.includes(stem) || stem.includes(value)))
    return false;
  let unmatched = exactCache.get(normalized);
  if (unmatched === undefined) {
    unmatched = resolveExactCustomerMatch(ctx.tenantDb, captured).then(
      (match) => match.kind === "UNMATCHED",
    );
    exactCache.set(normalized, unmatched);
  }
  return unmatched;
}

async function customerWarehouses(
  ctx: TenantFunctionContext,
  customerId: Id<"customers">,
  allowed: Awaited<ReturnType<typeof allowedCustomerWarehouses>>,
) {
  const rows = await ctx.tenantDb
    .byIndex<Doc<"customerWarehouseActivity">>(
      "customerWarehouseActivity",
      "by_orgId_customerId_warehouseId",
      [{ field: "customerId", value: customerId }],
    )
    .take(MAX_CUSTOMER_WAREHOUSES + 1);
  const visible = await Promise.all(
    rows.slice(0, MAX_CUSTOMER_WAREHOUSES).map(async (row) => {
      const listed = allowed.byId.get(row.warehouseId);
      if (listed) return { row, warehouse: listed };
      if (allowed.complete || !(await canAccessWarehouse(ctx, row.warehouseId)))
        return null;
      const warehouse = await ctx.tenantDb.get<Doc<"warehouses">>(
        "warehouses",
        row.warehouseId,
      );
      return warehouse ? { row, warehouse } : null;
    }),
  );
  return {
    entries: visible
      .filter((entry) => entry !== null)
      .sort((a, b) => a.warehouse.name.localeCompare(b.warehouse.name)),
    complete: rows.length <= MAX_CUSTOMER_WAREHOUSES,
  };
}

/**
 * Workspace shell data: access flags, the selector's warehouses, and the
 * overview rollup for the selected warehouse scope (all when omitted).
 */
export const getCustomerWorkspace = queryWithOrg({
  ...readCustomers,
  args: {
    customerId: v.string(),
    warehouseId: v.optional(v.id("warehouses")),
  },
  returns: v.union(
    v.null(),
    v.object({
      access: v.object({
        canManage: v.boolean(),
        canViewWarehouseData: v.boolean(),
        canReview: v.boolean(),
        canScan: v.boolean(),
      }),
      warehouses: v.array(
        v.object({
          warehouseId: v.id("warehouses"),
          code: v.string(),
          name: v.string(),
        }),
      ),
      warehousesComplete: v.boolean(),
      scopeAvailable: v.boolean(),
      rollup: v.optional(
        v.object({
          linkedJobs: boundedCount,
          linkedProducts: boundedCount,
          storedPallets: boundedCount,
          unmappedJobs: boundedCount,
          pendingReview: v.optional(
            v.object({
              names: v.number(),
              scans: v.number(),
              complete: v.boolean(),
            }),
          ),
        }),
      ),
      latestJobs: v.array(workspaceJob),
    }),
  ),
  handler: async (ctx, { customerId, warehouseId }) => {
    const customer = await ctx.tenantDb.get<Doc<"customers">>(
      "customers",
      customerId,
    );
    if (!customer) return null;
    const [grants, allowed] = await Promise.all([
      grantedPermissionsAmong(ctx, [NAVIGATION_PERMISSION.customerManage]),
      allowedCustomerWarehouses(ctx),
    ]);
    const canManage = grants.includes(NAVIGATION_PERMISSION.customerManage);
    const access = {
      canManage,
      canViewWarehouseData: allowed.hasWarehouseRead,
      canReview:
        canManage && allowed.hasWarehouseRead && allowed.hasWarehouseManage,
      canScan: allowed.hasWarehouseManage && customer.status === "ACTIVE",
    };
    if (!allowed.hasWarehouseRead) {
      return {
        access,
        warehouses: [],
        warehousesComplete: true,
        scopeAvailable: warehouseId === undefined,
        latestJobs: [],
      };
    }

    const { entries, complete } = await customerWarehouses(
      ctx,
      customer._id,
      allowed,
    );
    const warehouses = entries.map(({ warehouse }) => ({
      warehouseId: warehouse._id,
      code: warehouse.code,
      name: warehouse.name,
    }));
    const scopeAvailable =
      warehouseId === undefined ||
      allowed.byId.has(warehouseId) ||
      (!allowed.complete && (await canAccessWarehouse(ctx, warehouseId)));
    if (!scopeAvailable) {
      return {
        access,
        warehouses,
        warehousesComplete: complete,
        scopeAvailable,
        latestJobs: [],
      };
    }
    const scoped = entries.filter(
      ({ warehouse }) =>
        warehouseId === undefined || warehouse._id === warehouseId,
    );
    const scopeComplete = warehouseId !== undefined || complete;

    const linkedJobs = await countRanges(
      scoped.map(
        ({ warehouse }) =>
          () =>
            customerJobRange(ctx, customer._id, warehouse._id),
      ),
      COUNT_CAP,
    );
    const unmappedJobs = await countRanges(
      scoped.map(
        ({ warehouse }) =>
          () =>
            mappedJobRange(ctx, customer._id, warehouse._id, false),
      ),
      COUNT_CAP,
    );

    let stored = 0;
    let storedComplete = scopeComplete;
    let productBudget = STOCK_PRODUCTS_CAP;
    for (const { warehouse, row } of scoped) {
      if (row.linkedProductCount === 0) continue;
      const readiness = await summaryReadiness(ctx.tenantDb, warehouse._id);
      if (!readiness?.ready) {
        storedComplete = false;
        continue;
      }
      const products = await customerProductRange(
        ctx,
        customer._id,
        warehouse._id,
      ).take(productBudget + 1);
      if (products.length > productBudget) storedComplete = false;
      const counted = products.slice(0, productBudget);
      productBudget -= counted.length;
      const summaries = await Promise.all(
        counted.map((product) => readProductSummary(ctx, product, readiness)),
      );
      for (const summary of summaries) {
        if (summary === null) storedComplete = false;
        else stored += summary.stored;
      }
      if (productBudget === 0) break;
    }

    let pendingReview:
      { names: number; scans: number; complete: boolean } | undefined;
    if (access.canReview) {
      const { scans, hasMore } = await readPendingScansSummary(
        ctx,
        PENDING_REVIEW_SCAN_BUDGET,
      );
      const exactCache = new Map<string, Promise<boolean>>();
      const names = new Set<string>();
      let scanCount = 0;
      for (const scan of scans) {
        if (warehouseId !== undefined && scan.warehouseId !== warehouseId)
          continue;
        const captured = scan.customer ?? "";
        if (!(await proposedForCustomer(ctx, customer, captured, exactCache)))
          continue;
        names.add(normalizeCustomerName(captured));
        scanCount += 1;
      }
      pendingReview = {
        names: names.size,
        scans: scanCount,
        complete: !hasMore,
      };
    }

    // The newest jobs overall are among each warehouse's newest few, and the
    // activity row tracks every warehouse's latest job.
    const recent = scoped
      .filter(({ row }) => row.latestJobCreatedAt !== undefined)
      .sort(
        (a, b) =>
          (b.row.latestJobCreatedAt ?? 0) - (a.row.latestJobCreatedAt ?? 0),
      )
      .slice(0, LATEST_JOBS);
    const recentJobs = await Promise.all(
      recent.map(async ({ warehouse }) =>
        (
          await customerJobRange(ctx, customer._id, warehouse._id).take(
            LATEST_JOBS,
            "desc",
          )
        ).map((scan) => jobRow(scan, warehouse.name)),
      ),
    );
    const latestJobs = recentJobs
      .flat()
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, LATEST_JOBS);

    return {
      access,
      warehouses,
      warehousesComplete: complete,
      scopeAvailable,
      rollup: {
        linkedJobs,
        linkedProducts: {
          count: scoped.reduce(
            (sum, { row }) => sum + row.linkedProductCount,
            0,
          ),
          complete: scopeComplete,
        },
        storedPallets: { count: stored, complete: storedComplete },
        unmappedJobs,
        ...(pendingReview === undefined ? {} : { pendingReview }),
      },
      latestJobs,
    };
  },
});

const jobFilter = v.union(
  v.literal("all"),
  v.literal("mapped"),
  v.literal("unmapped"),
);

/** Newest-first linked jobs, optionally one warehouse and mapped/unmapped. */
export const listCustomerWorkspaceJobs = queryWithOrg({
  ...readCustomers,
  args: {
    customerId: v.id("customers"),
    warehouseId: v.optional(v.id("warehouses")),
    filter: v.optional(jobFilter),
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
  },
  returns: v.union(
    v.null(),
    v.object({
      canViewWarehouseData: v.boolean(),
      items: v.array(workspaceJob),
      isDone: v.boolean(),
      continueCursor: v.string(),
    }),
  ),
  handler: async (
    ctx,
    { customerId, warehouseId, filter, cursor, pageSize },
  ) => {
    const limit = pageSize ?? JOBS_PAGE_DEFAULT;
    if (!Number.isInteger(limit) || limit < 1 || limit > JOBS_PAGE_MAX)
      throw new Error("INVALID_PAGE_SIZE");
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
      (id) =>
        filter === undefined || filter === "all"
          ? customerJobRange(ctx, customer._id, id)
          : mappedJobRange(ctx, customer._id, id, filter === "mapped"),
      "desc",
      warehouseId,
    );
    return {
      ...page,
      items: items.map(({ row, warehouseName }) => jobRow(row, warehouseName)),
    };
  },
});

/**
 * Linked products with their stored pallets and zones: the products tab, the
 * overview's product list, and the stock view share this read.
 */
export const listCustomerWorkspaceProducts = queryWithOrg({
  ...readCustomers,
  args: {
    customerId: v.id("customers"),
    warehouseId: v.optional(v.id("warehouses")),
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
  },
  returns: v.union(
    v.null(),
    v.object({
      canViewWarehouseData: v.boolean(),
      items: v.array(workspaceProduct),
      isDone: v.boolean(),
      continueCursor: v.string(),
    }),
  ),
  handler: async (ctx, { customerId, warehouseId, cursor, pageSize }) => {
    const limit = pageSize ?? PRODUCTS_PAGE_DEFAULT;
    if (!Number.isInteger(limit) || limit < 1 || limit > PRODUCTS_PAGE_MAX)
      throw new Error("INVALID_PAGE_SIZE");
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
      (id) => customerProductRange(ctx, customer._id, id),
      "asc",
      warehouseId,
    );

    const readiness = new Map<
      Id<"warehouses">,
      Promise<Doc<"finishedGoodsSummaryReadiness"> | null>
    >();
    const zones = new Map<Id<"storageZones">, Promise<string | undefined>>();
    const zoneLabel = (zoneId: Id<"storageZones">) => {
      let label = zones.get(zoneId);
      if (label === undefined) {
        label = ctx.tenantDb
          .get<Doc<"storageZones">>("storageZones", zoneId)
          .then((zone) => zone?.label || zone?.code);
        zones.set(zoneId, label);
      }
      return label;
    };

    const products = await Promise.all(
      items.map(async ({ row: product, warehouseName }) => {
        let ready = readiness.get(product.warehouseId);
        if (ready === undefined) {
          ready = summaryReadiness(ctx.tenantDb, product.warehouseId);
          readiness.set(product.warehouseId, ready);
        }
        const [summary, palletRows] = await Promise.all([
          ready.then((state) =>
            state?.ready ? readProductSummary(ctx, product, state) : null,
          ),
          ctx.tenantDb
            .byIndex<Doc<"finishedGoodsPallets">>(
              "finishedGoodsPallets",
              "by_orgId_productId_status",
              [
                { field: "productId", value: product._id },
                { field: "status", value: "STORED" },
              ],
            )
            .take(PALLETS_PER_PRODUCT + 1),
        ]);
        const live = palletRows.filter(
          (pallet) =>
            pallet.retiredAt === undefined &&
            pallet.warehouseId === product.warehouseId,
        );
        const pallets = await Promise.all(
          live.slice(0, PALLETS_PER_PRODUCT).map(async (pallet) => {
            const placement = pallet.placementId
              ? await ctx.tenantDb.get<Doc<"finishedGoodsPlacements">>(
                  "finishedGoodsPlacements",
                  pallet.placementId,
                )
              : null;
            const held = placement && placement.status !== "RELEASED";
            const label = held ? await zoneLabel(placement.zoneId) : undefined;
            return {
              palletId: pallet._id,
              code: pallet.code,
              quantity: pallet.quantity,
              ...(held
                ? {
                    positionCode: placement.positionCode,
                    zoneId: placement.zoneId,
                  }
                : {}),
              ...(label === undefined ? {} : { zoneLabel: label }),
            };
          }),
        );
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
          ...(summary === null
            ? {}
            : { storedCount: summary.stored, totalQuantity: summary.quantity }),
          pallets,
          hasMorePallets: palletRows.length > PALLETS_PER_PRODUCT,
          zones: [
            ...new Set(
              pallets
                .map((pallet) => pallet.zoneLabel)
                .filter((label): label is string => label !== undefined),
            ),
          ],
        };
      }),
    );
    return { ...page, items: products };
  },
});
