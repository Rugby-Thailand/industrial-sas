import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import {
  paginatedScan,
  remainingScanCapacity,
} from "../lib/cataloguePagination";
import { queryWithOrg } from "../lib/tenantFunctions";
import { NAVIGATION_PERMISSION } from "../model/authorization/navigationPermissions";
import {
  isValidThaiTaxIdChecksum,
  normalizeCustomerName,
  normalizeTaxId,
} from "../model/customers/customers";
import { nextCustomerCode } from "./customerCodes";
import { customerRowFields, customerStatus } from "./validators";

const readCustomers = {
  permissionCode: NAVIGATION_PERMISSION.customers,
  target: { table: "customers" },
} as const;

function customerRow({
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
  page: v.array(v.object(customerRowFields)),
  isDone: v.boolean(),
  continueCursor: v.string(),
  scanCursor: v.optional(v.string()),
  scanned: v.number(),
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
    return paginatedScan(ctx, {
      scope: { entity: "customers", status, needle, exactTaxId },
      pageSize,
      cursor,
      scanCursor,
      read: (rawCursor, endCursor) =>
        ctx.tenantDb
          .byIndex<Doc<"customers">>(
            "customers",
            status
              ? "by_orgId_status_normalizedName"
              : "by_orgId_normalizedName",
            status ? [{ field: "status", value: status }] : [],
          )
          .page({
            limit: remainingScanCapacity(scanCursor, pageSize),
            ...(rawCursor ? { cursor: rawCursor } : {}),
            ...(endCursor ? { endCursor } : {}),
          }),
      get: (id) => ctx.tenantDb.get<Doc<"customers">>("customers", id),
      hydrate: async (row) => customerRow(row),
      matches: (row) =>
        (!status || row.status === status) &&
        (!needle ||
          row.normalizedName.includes(needle) ||
          normalizeCustomerName(row.code).includes(needle) ||
          normalizeCustomerName(row.legalNameTh ?? "").includes(needle) ||
          normalizeCustomerName(row.legalNameEn ?? "").includes(needle) ||
          (exactTaxId !== null && row.taxId === exactTaxId)),
    });
  },
});

export const getCustomer = queryWithOrg({
  ...readCustomers,
  args: { customerId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      ...customerRowFields,
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
      ...customerRow(row),
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
