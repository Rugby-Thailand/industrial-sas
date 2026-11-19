import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import {
  CODE_FIELD,
  createMasterDataRow,
  normalizeField,
  replayTenantWriteIfPresent,
  updateMasterDataRow,
  type MasterDataError,
  type MasterDataOutcome,
} from "../lib/masterDataStore";
import {
  mutationWithOrg,
  type TenantFunctionContext,
} from "../lib/tenantFunctions";
import { writeContextOf } from "../lib/writeEnvelope";
import { NAVIGATION_PERMISSION } from "../model/authorization/navigationPermissions";
import { validateCustomerFields } from "../model/customers/customers";
import type { Result } from "../model/result";
import { customerCodeSequenceKey, nextCustomerCode } from "./customerCodes";
import { editableCustomerFields } from "./validators";

const requestArgs = { requestId: v.string() };
const changeArgs = {
  ...requestArgs,
  customerId: v.string(),
  expectedVersion: v.number(),
};

const writeOutcome = v.union(
  v.object({
    ok: v.literal(true),
    customerId: v.string(),
    replayed: v.boolean(),
  }),
  v.object({
    ok: v.literal(false),
    code: v.string(),
    field: v.optional(v.string()),
  }),
);

const failure = (code: string, field?: string) => ({
  ok: false as const,
  code,
  ...(field === undefined ? {} : { field }),
});
const success = ({ documentId, replayed }: MasterDataOutcome) => ({
  ok: true as const,
  customerId: documentId,
  replayed,
});
const outcomeOf = (write: Result<MasterDataOutcome, MasterDataError>) =>
  write.ok
    ? success(write.value)
    : failure(
        write.error.code,
        "field" in write.error ? write.error.field : undefined,
      );

const manageCustomers = {
  permissionCode: NAVIGATION_PERMISSION.customerManage,
  returns: writeOutcome,
};
const targetCustomer = {
  table: "customers",
  id: ({ customerId }: { customerId: string }) => customerId,
} as const;
const privateAuditFields = [
  "contact",
  "deliveryAddress",
  "taxId",
  "notes",
] as const;

const writeContext = (
  ctx: TenantFunctionContext,
  operation: string,
  requestId: string,
) => ({
  ...writeContextOf(ctx, { table: "customers", operation, requestId }),
  redactedAuditFields: privateAuditFields,
});

export const createCustomer = mutationWithOrg({
  ...manageCustomers,
  args: {
    ...requestArgs,
    ...editableCustomerFields,
    code: v.optional(v.string()),
  },
  target: { table: "customers" },
  handler: async (ctx, args) => {
    const context = writeContext(ctx, "customer.create", args.requestId);
    const replay = await replayTenantWriteIfPresent({
      ...context,
      fingerprint: args,
    });
    if (!replay.ok) return failure(replay.error.code);
    if (replay.value) return success(replay.value);

    const editable = validateCustomerFields(args);
    if (!editable.ok) return failure(editable.error.code, editable.error.field);

    let code: string;
    if (args.code?.trim()) {
      const explicitCode = normalizeField("code", args.code, CODE_FIELD);
      if (!explicitCode.ok) return failure(explicitCode.error.code, "code");
      code = explicitCode.value;
    } else {
      code = await nextCustomerCode(ctx.tenantDb);
    }

    return outcomeOf(
      await createMasterDataRow({
        ...context,
        fingerprint: args,
        uniqueness: [
          {
            field: "code",
            index: "by_orgId_code",
            equality: [{ field: "code", value: code }],
          },
        ],
        document: {
          ...editable.value,
          code,
          codeSequenceKey: customerCodeSequenceKey(code),
          status: "ACTIVE",
          version: 1,
          createdAt: context.now,
          createdByUserId: context.actorUserId,
          updatedAt: context.now,
          updatedByUserId: context.actorUserId,
        },
      }),
    );
  },
});

type ExistingCustomerArgs = {
  requestId: string;
  customerId: string;
  expectedVersion: number;
};

async function changeCustomer(
  ctx: TenantFunctionContext,
  args: ExistingCustomerArgs,
  operation: "customer.update" | "customer.archive" | "customer.restore",
  patch: (
    row: Doc<"customers">,
    now: number,
  ) => Result<Record<string, unknown>, { code: string; field?: string }>,
) {
  const context = writeContext(ctx, operation, args.requestId);
  const replay = await replayTenantWriteIfPresent({
    ...context,
    fingerprint: args,
  });
  if (!replay.ok) return failure(replay.error.code);
  if (replay.value) return success(replay.value);

  const row = await ctx.tenantDb.get<Doc<"customers">>(
    "customers",
    args.customerId,
  );
  if (!row) return failure("NOT_FOUND");
  if (operation === "customer.update" && row.status === "ARCHIVED")
    return failure("CUSTOMER_ARCHIVED");
  if (row.version !== args.expectedVersion) return failure("VERSION_CONFLICT");

  const changes = patch(row, context.now);
  if (!changes.ok) return failure(changes.error.code, changes.error.field);

  return outcomeOf(
    await updateMasterDataRow({
      ...context,
      documentId: row._id,
      fingerprint: args,
      uniqueness: [],
      patch: {
        ...changes.value,
        updatedAt: context.now,
        updatedByUserId: context.actorUserId,
        version: row.version + 1,
      },
    }),
  );
}

export const updateCustomer = mutationWithOrg({
  ...manageCustomers,
  args: { ...changeArgs, ...editableCustomerFields },
  target: targetCustomer,
  handler: (ctx, args) =>
    changeCustomer(ctx, args, "customer.update", () =>
      validateCustomerFields(args),
    ),
});

export const archiveCustomer = mutationWithOrg({
  ...manageCustomers,
  args: changeArgs,
  target: targetCustomer,
  handler: (ctx, args) =>
    changeCustomer(ctx, args, "customer.archive", (row, now) =>
      row.status === "ARCHIVED"
        ? { ok: false, error: { code: "CUSTOMER_ALREADY_ARCHIVED" } }
        : {
            ok: true,
            value: {
              status: "ARCHIVED",
              archivedAt: now,
              archivedByUserId: ctx.tenant.actor._id,
            },
          },
    ),
});

export const restoreCustomer = mutationWithOrg({
  ...manageCustomers,
  args: changeArgs,
  target: targetCustomer,
  handler: (ctx, args) =>
    changeCustomer(ctx, args, "customer.restore", (row) =>
      row.status === "ACTIVE"
        ? { ok: false, error: { code: "CUSTOMER_ALREADY_ACTIVE" } }
        : {
            ok: true,
            value: {
              status: "ACTIVE",
              archivedAt: undefined,
              archivedByUserId: undefined,
            },
          },
    ),
});
