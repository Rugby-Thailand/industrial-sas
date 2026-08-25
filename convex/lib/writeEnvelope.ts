import { v } from "convex/values";

import type { TenantDocumentAccess } from "./tenantDb";
import type { TenantFunctionContext } from "./tenantFunctions";

export const writeErrorValidator = v.object({
  code: v.string(),
  field: v.optional(v.string()),
  reason: v.optional(v.string()),
  table: v.optional(v.string()),
  status: v.optional(v.string()),
  requestId: v.optional(v.string()),
});

export const writeOutcomeValidator = v.union(
  v.object({
    written: v.literal(true),
    documentId: v.string(),

    replayed: v.boolean(),
  }),
  v.object({ written: v.literal(false), error: writeErrorValidator }),
);

export interface StructuredError {
  readonly code: string;
  readonly field?: unknown;
  readonly reason?: unknown;
  readonly table?: unknown;
  readonly status?: unknown;
  readonly requestId?: unknown;
}

export const refusal = (error: StructuredError) => ({
  written: false as const,
  error: {
    code: error.code,
    ...(error.field === undefined ? {} : { field: String(error.field) }),
    ...(error.reason === undefined ? {} : { reason: String(error.reason) }),
    ...(error.table === undefined ? {} : { table: String(error.table) }),
    ...(error.status === undefined ? {} : { status: String(error.status) }),
    ...(error.requestId === undefined
      ? {}
      : { requestId: String(error.requestId) }),
  },
});

export const written = (outcome: {
  readonly documentId: string;
  readonly replayed: boolean;
}) => ({
  written: true as const,
  documentId: outcome.documentId,
  replayed: outcome.replayed,
});

export const writeContextOf = (
  ctx: TenantFunctionContext,
  input: {
    readonly table: Parameters<TenantDocumentAccess["byIndex"]>[0];
    readonly operation: string;
    readonly requestId: string;
    readonly warehouseId?: string | undefined;
  },
) => ({
  tenantDb: ctx.tenantDb,
  table: input.table,
  operation: input.operation,
  requestId: input.requestId,
  permissionCode: ctx.permission.code,
  actorUserId: ctx.tenant.actor._id,
  ...(input.warehouseId === undefined
    ? {}
    : { warehouseId: input.warehouseId }),
  now: Date.now(),
});
