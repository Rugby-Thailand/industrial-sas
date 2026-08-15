/**
 * The customer register.
 *
 * Status: **implemented** (Phase 5A).
 *
 * ### Why a customer is not a supplier
 *
 * `suppliers` is who the tenant buys board from; `customers` is who the tenant
 * sells boxes to. The same legal entity is occasionally both, and that is exactly
 * why they are separate tables rather than one party table with a flag: a design
 * key is unique *per customer* (`INV-0013-01`), an outstanding-demand view reads
 * customers, and a receiving view reads suppliers. One table with a role flag
 * would put sales demand inside every receiving query and make the uniqueness
 * contract on `masterCards` mean "per party in either direction", which is not a
 * rule anybody stated.
 *
 * ### What is here and what is not
 *
 * Create, rename or withdraw, and list. No delete: a customer order, a master
 * card, and an audit row all reference a customer by ID, and removing the row
 * turns each of those into a dangling pointer (same rule as master data,
 * `INV-0003-04`). Withdrawal is `status: "INACTIVE"`, which the order screen
 * reads to keep a retired customer out of the picker without hiding the orders
 * already placed under it.
 */
import { v } from "convex/values";

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
  pageRequestOf,
} from "../lib/listEnvelope";
import { mutationWithOrg, queryWithOrg } from "../lib/tenantFunctions";
import type { TenantOrgId } from "../lib/tenantDb";
import { masterDataStatus } from "../lib/validators";
import {
  refusal,
  writeContextOf,
  writeOutcomeValidator,
  written,
} from "../lib/writeEnvelope";

/* -------------------------------------------------------------------------- */
/* Operations                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The logical operation names, which are half of every idempotency key.
 *
 * Code-owned and stable, and deliberately *not* the permission codes: one
 * permission (`sales.customer.manage`) guards two operations, and the
 * idempotency namespace has to keep a create and an update from colliding on the
 * same request ID.
 */
export const SALES_CUSTOMER_OPERATIONS = Object.freeze({
  createCustomer: "sales.customer.create",
  updateCustomer: "sales.customer.update",
});

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

interface CustomerDocument {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly code: string;
  readonly name: string;
  readonly status: string;
}

/** `(orgId, code)`: a customer code is unique per organization. */
const codeUniqueness = (code: string): readonly UniquenessCheck[] => [
  {
    field: "code",
    index: "by_orgId_code",
    equality: [{ field: "code", value: code }],
  },
];

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/** Register a customer. */
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

/**
 * Rename a customer, or withdraw it.
 *
 * The code is not updatable, for the same reason a SKU's is not: it is what a
 * purchase order document, an export, and a person all cite, and changing it in
 * place rewrites the meaning of every artefact that already names it.
 */
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

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

const customerValidator = v.object({
  customerId: v.id("customers"),
  code: v.string(),
  name: v.string(),
  status: masterDataStatus,
});

/**
 * Customers, in code order.
 *
 * `status` narrows through `by_orgId_status_code` rather than by filtering a
 * wider page, so asking for the active customers reads active rows only — a
 * filtered page would return fewer rows than the page size and make the caller's
 * "am I done" test wrong.
 */
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

    return {
      ok: true as const,
      items: page.page.map((customer) => ({
        customerId: customer._id as never,
        code: customer.code,
        name: customer.name,
        status: customer.status as never,
      })),
      nextCursor: page.isDone ? null : page.continueCursor,
      complete: page.isDone,
    };
  },
});
