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

const readCustomers = {
  permissionCode: NAVIGATION_PERMISSION.customers,
  target: { table: "customers" },
} as const;

function customerDetail({
  codeSequenceKey: _codeSequenceKey,
  aliasSearchText: _aliasSearchText,
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
          (row.aliasSearchText?.includes(needle) ?? false) ||
          (exactTaxId !== null && row.taxId === exactTaxId)),
    });
    return {
      ...result,
      page: result.page.map(({ _id, code, name, status, deliveryAddress }) => ({
        customerId: _id,
        code,
        name,
        status,
        ...(deliveryAddress?.province === undefined
          ? {}
          : { province: deliveryAddress.province }),
      })),
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
    // Tax details belong to customer administration: read-only members get
    // the record without them (workspace contract, permission matrix).
    const grants = await grantedPermissionsAmong(ctx, [
      NAVIGATION_PERMISSION.customerManage,
    ]);
    if (!grants.includes(NAVIGATION_PERMISSION.customerManage)) {
      const { taxId: _taxId, ...visible } = customerDetail(row);
      return visible;
    }
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
