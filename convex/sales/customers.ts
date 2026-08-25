import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import {
  CODE_FIELD,
  createMasterDataRow,
  normalizeDisplayName,
  normalizeField,
  updateMasterDataRow,
  type UniquenessCheck,
} from "../lib/masterDataStore";
import {
  listArgs,
  pageOf,
  pageOptions,
  pageRefusal,
  pageResult,
  pageRequestOf,
} from "../lib/listEnvelope";
import { mutationWithOrg, queryWithOrg } from "../lib/tenantFunctions";
import { masterDataStatus } from "../lib/validators";
import {
  refusal,
  writeContextOf,
  writeOutcomeValidator,
  written,
} from "../lib/writeEnvelope";

export const SALES_CUSTOMER_OPERATIONS = Object.freeze({
  createCustomer: "sales.customer.create",
  updateCustomer: "sales.customer.update",
});

type CustomerDocument = Doc<"customers">;

const codeUniqueness = (code: string): readonly UniquenessCheck[] => [
  {
    field: "code",
    index: "by_orgId_code",
    equality: [{ field: "code", value: code }],
  },
];

export const createCustomer = mutationWithOrg({
  args: { requestId: v.string(), code: v.string(), name: v.string() },
  returns: writeOutcomeValidator,
  permissionCode: "sales.customer.manage",
  target: { table: "customers" },
  handler: async (ctx, args) => {
    const code = normalizeField("code", args.code, CODE_FIELD);
    if (!code.ok) return refusal(code.error);
    const name = normalizeDisplayName("name", args.name);
    if (!name.ok) return refusal(name.error);

    const outcome = await createMasterDataRow({
      ...writeContextOf(ctx, {
        table: "customers",
        operation: SALES_CUSTOMER_OPERATIONS.createCustomer,
        requestId: args.requestId,
      }),
      fingerprint: {
        operation: SALES_CUSTOMER_OPERATIONS.createCustomer,
        requestId: args.requestId,
        code: code.value,
        name: name.value,
      },
      uniqueness: codeUniqueness(code.value),
      document: { code: code.value, name: name.value, status: "ACTIVE" },
    });

    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

export const updateCustomer = mutationWithOrg({
  args: {
    requestId: v.string(),
    customerId: v.id("customers"),
    name: v.optional(v.string()),
    status: v.optional(masterDataStatus),
  },
  returns: writeOutcomeValidator,
  permissionCode: "sales.customer.manage",
  target: { table: "customers", id: ({ customerId }) => customerId },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) {
      const name = normalizeDisplayName("name", args.name);
      if (!name.ok) return refusal(name.error);
      patch["name"] = name.value;
    }
    if (args.status !== undefined) patch["status"] = args.status;

    const outcome = await updateMasterDataRow({
      ...writeContextOf(ctx, {
        table: "customers",
        operation: SALES_CUSTOMER_OPERATIONS.updateCustomer,
        requestId: args.requestId,
      }),
      documentId: args.customerId,
      fingerprint: {
        operation: SALES_CUSTOMER_OPERATIONS.updateCustomer,
        requestId: args.requestId,
        customerId: args.customerId,
        ...patch,
      },
      uniqueness: [],
      patch,
    });

    return outcome.ok ? written(outcome.value) : refusal(outcome.error);
  },
});

const customerValidator = v.object({
  customerId: v.id("customers"),
  code: v.string(),
  name: v.string(),
  status: masterDataStatus,
});

export const listCustomers = queryWithOrg({
  args: { status: v.optional(masterDataStatus), ...listArgs },
  returns: pageOf(customerValidator),
  permissionCode: "sales.customer.read",
  target: { table: "customers" },
  handler: async (ctx, args) => {
    const request = pageRequestOf(args);
    if (!request.ok) return pageRefusal(request.error.code);

    const page = await ctx.tenantDb
      .byIndex<CustomerDocument>(
        "customers",
        args.status === undefined ? "by_orgId_code" : "by_orgId_status_code",
        args.status === undefined
          ? []
          : [{ field: "status", value: args.status }],
      )
      .page(pageOptions(request.value));

    return pageResult(
      page.page.map((customer) => ({
        customerId: customer._id as never,
        code: customer.code,
        name: customer.name,
        status: customer.status as never,
      })),
      page,
    );
  },
});
