import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import { paginatedOrderedScan } from "../lib/cataloguePagination";
import { grantedPermissionsAmong } from "../lib/navigationGrants";
import { TENANT_INDEX_MAX_PAGE_SIZE } from "../lib/tenantDb";
import { queryWithOrg } from "../lib/tenantFunctions";
import { NAVIGATION_PERMISSION } from "../model/authorization/navigationPermissions";
import {
  isValidThaiTaxIdChecksum,
  normalizeCustomerName,
  normalizeTaxId,
} from "../model/customers/customers";
import { customerCatalogueGeneration } from "./catalogueGeneration";
import { nextCustomerCode } from "./customerCodes";
import {
  customerDetailFields,
  customerStatus,
  customerSummary,
} from "./validators";
import {
  allowedCustomerWarehouses,
  type AllowedCustomerWarehouses,
} from "./warehouseScope";

const readCustomers = {
  permissionCode: NAVIGATION_PERMISSION.customers,
  target: { table: "customers" },
} as const;

function customerDetail({
  codeSequenceKey: _codeSequenceKey,
  ...row
}: Doc<"customers">) {
  return { ...row, customerId: row._id };
}

const pageValidator = v.object({
  status: v.union(
    v.literal("ready"),
    v.literal("scanning"),
    v.literal("reset"),
  ),
  page: v.array(customerSummary),
  isDone: v.boolean(),
  continueCursor: v.string(),
  scanCursor: v.optional(v.string()),
  scanned: v.number(),
});

export const viewer = queryWithOrg({
  ...readCustomers,
  args: {},
  returns: v.object({ canManage: v.boolean() }),
  handler: async (ctx) => {
    const grants = await grantedPermissionsAmong(ctx, [
      NAVIGATION_PERMISSION.customerManage,
    ]);
    return { canManage: grants.includes(NAVIGATION_PERMISSION.customerManage) };
  },
});

const ALIAS_PREFIX_LIMIT = TENANT_INDEX_MAX_PAGE_SIZE;
const ALIAS_SCAN_LIMIT = TENANT_INDEX_MAX_PAGE_SIZE;
const PRODUCT_COUNT_CAP = TENANT_INDEX_MAX_PAGE_SIZE - 1;
const JOB_PEEK_LIMIT = 10;

async function aliasMatchedCustomers(
  tenantDb: Parameters<typeof customerCatalogueGeneration>[0],
  needle: string,
): Promise<ReadonlySet<string>> {
  if (!needle) return new Set();
  const [prefixHits, orgSample] = await Promise.all([
    tenantDb
      .byIndex<Doc<"customerAliases">>(
        "customerAliases",
        "by_orgId_normalizedAlias",
        [],
        {
          field: "normalizedAlias",
          lower: { value: needle, inclusive: true },
        },
      )
      .take(ALIAS_PREFIX_LIMIT),
    tenantDb
      .byIndex<Doc<"customerAliases">>(
        "customerAliases",
        "by_orgId_normalizedAlias",
        [],
      )
      .take(ALIAS_SCAN_LIMIT),
  ]);
  const ids = new Set<string>();
  for (const row of prefixHits) {
    if (!row.normalizedAlias.startsWith(needle)) break;
    ids.add(row.customerId);
  }
  for (const row of orgSample) {
    if (row.normalizedAlias.includes(needle)) ids.add(row.customerId);
  }
  return ids;
}

async function customerPageActivity(
  tenantDb: Parameters<typeof customerCatalogueGeneration>[0],
  customerId: Doc<"customers">["_id"],
  allowed: AllowedCustomerWarehouses,
) {
  if (!allowed.hasWarehouseRead || allowed.warehouses.length === 0) return {};
  const productsPromise =
    allowed.orgWide || allowed.warehouses.length > 5
      ? tenantDb
          .byIndex<Doc<"finishedGoodsProducts">>(
            "finishedGoodsProducts",
            "by_orgId_customerId",
            [{ field: "customerId", value: customerId }],
          )
          .take(PRODUCT_COUNT_CAP + 1)
          .then((rows) => {
            const visible = rows.filter((row) =>
              allowed.byId.has(row.warehouseId),
            );
            return {
              count: Math.min(visible.length, PRODUCT_COUNT_CAP),
              more: rows.length > PRODUCT_COUNT_CAP,
            };
          })
      : Promise.all(
          allowed.warehouses.map((warehouse) =>
            tenantDb
              .byIndex<Doc<"finishedGoodsProducts">>(
                "finishedGoodsProducts",
                "by_orgId_warehouseId_customerId",
                [
                  { field: "warehouseId", value: warehouse._id },
                  { field: "customerId", value: customerId },
                ],
              )
              .take(PRODUCT_COUNT_CAP + 1),
          ),
        ).then((groups) => {
          const total = groups.reduce((sum, rows) => sum + rows.length, 0);
          return {
            count: Math.min(total, PRODUCT_COUNT_CAP),
            more:
              total > PRODUCT_COUNT_CAP ||
              groups.some((rows) => rows.length > PRODUCT_COUNT_CAP),
          };
        });

  const latestJobPromise =
    allowed.orgWide || allowed.warehouses.length > 5
      ? tenantDb
          .byIndex<Doc<"finishedGoodsJobScans">>(
            "finishedGoodsJobScans",
            "by_orgId_customerId_createdAt",
            [{ field: "customerId", value: customerId }],
          )
          .take(JOB_PEEK_LIMIT, "desc")
          .then(
            (rows) =>
              rows.find(
                (row) => !row.voided && allowed.byId.has(row.warehouseId),
              ) ?? null,
          )
      : Promise.all(
          allowed.warehouses.map((warehouse) =>
            tenantDb
              .byIndex<Doc<"finishedGoodsJobScans">>(
                "finishedGoodsJobScans",
                "by_orgId_warehouseId_customerId_createdAt",
                [
                  { field: "warehouseId", value: warehouse._id },
                  { field: "customerId", value: customerId },
                ],
              )
              .take(5, "desc"),
          ),
        ).then((groups) => {
          let newest: Doc<"finishedGoodsJobScans"> | null = null;
          for (const rows of groups) {
            const candidate = rows.find((row) => !row.voided);
            if (
              candidate &&
              (!newest || candidate.createdAt > newest.createdAt)
            )
              newest = candidate;
          }
          return newest;
        });

  const [products, latest] = await Promise.all([
    productsPromise,
    latestJobPromise,
  ]);
  return {
    ...(products.count > 0
      ? {
          linkedProductCount: products.count,
          ...(products.more ? { linkedProductCountMore: true } : {}),
        }
      : {}),
    ...(latest
      ? {
          latestJob: {
            jobScanId: latest._id,
            factoryOrder: latest.factoryOrder,
            createdAt: latest.createdAt,
            warehouseId: latest.warehouseId,
          },
        }
      : {}),
  };
}

export const listCustomersPage = queryWithOrg({
  ...readCustomers,
  args: {
    status: v.optional(customerStatus),
    search: v.optional(v.string()),
    pageSize: v.number(),
    cursor: v.optional(v.string()),
    scanCursor: v.optional(v.string()),
  },
  returns: pageValidator,
  handler: async (ctx, args) => {
    const { status, cursor, scanCursor, pageSize } = args;
    const needle = normalizeCustomerName(args.search ?? "");
    const exactTaxId = normalizeTaxId(args.search ?? "");
    const aliasMatches = await aliasMatchedCustomers(ctx.tenantDb, needle);
    const result = await paginatedOrderedScan(ctx, {
      scope: { entity: "customers", status, needle, exactTaxId },
      pageSize,
      confirmNextMatch: Boolean(needle),
      cursor,
      scanCursor,
      generation: () => customerCatalogueGeneration(ctx.tenantDb),
      read: ({ raw, end }) =>
        ctx.tenantDb
          .byIndex<Doc<"customers">>(
            "customers",
            status
              ? "by_orgId_status_normalizedName"
              : "by_orgId_normalizedName",
            status ? [{ field: "status", value: status }] : [],
          )
          .page({
            // A filtered search keeps only matching IDs, so it reads the
            // largest bounded chunk the tenant index allows: fewer sequential
            // calls through long unmatched stretches. An unfiltered page reads
            // exactly the rows it shows.
            limit: needle ? TENANT_INDEX_MAX_PAGE_SIZE : pageSize,
            ...(raw ? { cursor: raw } : {}),
            ...(end ? { endCursor: end } : {}),
          }),
      get: (id) => ctx.tenantDb.get<Doc<"customers">>("customers", id),
      matches: (row) =>
        (!status || row.status === status) &&
        (!needle ||
          row.normalizedName.includes(needle) ||
          normalizeCustomerName(row.code).includes(needle) ||
          normalizeCustomerName(row.legalNameTh ?? "").includes(needle) ||
          normalizeCustomerName(row.legalNameEn ?? "").includes(needle) ||
          aliasMatches.has(row._id) ||
          (exactTaxId !== null && row.taxId === exactTaxId)),
    });
    const allowed =
      result.status === "ready" && result.page.length > 0
        ? await allowedCustomerWarehouses(ctx)
        : null;
    const page = await Promise.all(
      result.page.map(async ({ _id, code, name, status, deliveryAddress }) => ({
        customerId: _id,
        code,
        name,
        status,
        ...(deliveryAddress?.province === undefined
          ? {}
          : { province: deliveryAddress.province }),
        ...(allowed
          ? await customerPageActivity(ctx.tenantDb, _id, allowed)
          : {}),
      })),
    );
    return {
      ...result,
      page,
    };
  },
});

export const getCustomer = queryWithOrg({
  ...readCustomers,
  args: { customerId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      ...customerDetailFields,
      taxIdChecksumValid: v.optional(v.boolean()),
    }),
  ),
  handler: async (ctx, { customerId }) => {
    const row = await ctx.tenantDb.get<Doc<"customers">>(
      "customers",
      customerId,
    );
    if (!row) return null;
    return {
      ...customerDetail(row),
      ...(row.taxId === undefined
        ? {}
        : { taxIdChecksumValid: isValidThaiTaxIdChecksum(row.taxId) }),
    };
  },
});

export const findSimilarCustomers = queryWithOrg({
  ...readCustomers,
  args: { name: v.string(), excludeCustomerId: v.optional(v.string()) },
  returns: v.array(
    v.object({
      customerId: v.id("customers"),
      code: v.string(),
      name: v.string(),
      status: customerStatus,
    }),
  ),
  handler: async (ctx, { name, excludeCustomerId }) => {
    const normalizedName = normalizeCustomerName(name);
    if (!normalizedName) return [];
    // Name-prefix matches are contiguous after the lower bound. One extra row
    // leaves room for the optional self-exclusion.
    const rows = await ctx.tenantDb
      .byIndex<Doc<"customers">>("customers", "by_orgId_normalizedName", [], {
        field: "normalizedName",
        lower: { value: normalizedName, inclusive: true },
      })
      .take(excludeCustomerId ? 6 : 5);
    return rows
      .filter(
        (row) =>
          row._id !== excludeCustomerId &&
          row.normalizedName.startsWith(normalizedName),
      )
      .slice(0, 5)
      .map(({ _id, code, name, status }) => ({
        customerId: _id,
        code,
        name,
        status,
      }));
  },
});

export const suggestCustomerCode = queryWithOrg({
  ...readCustomers,
  args: {},
  returns: v.string(),
  handler: (ctx) => nextCustomerCode(ctx.tenantDb),
});
