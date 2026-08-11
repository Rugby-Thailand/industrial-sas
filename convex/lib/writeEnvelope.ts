/**
 * The wire envelope every tenant-bound write answers with.
 *
 * Extracted from `convex/masterData/writes.ts`, which proved the shape over
 * sixteen mutations, so the inbound slice's own writes cannot drift from it. One
 * envelope means one client-side state machine
 * (`src/lib/convex/writeState.ts`) rather than one per feature.
 *
 * The rule the shape enforces is the one that matters: **a refusal names a field
 * and never a value**. `DUPLICATE_KEY` says which column collided and refuses to
 * say with what, so the same code path cannot become an oracle for a caller who
 * guessed (`INV-0002-07`).
 */
import { v } from "convex/values";

import type { TenantDocumentAccess } from "./tenantDb";
import type { TenantFunctionContext } from "./tenantFunctions";

/** Every optional field here is a *name* — a field, a table — never a value. */
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
    /** True when an identical request had already been applied. */
    replayed: v.boolean(),
  }),
  v.object({ written: v.literal(false), error: writeErrorValidator }),
);

/** Anything a domain kernel or a store may refuse with. */
export interface StructuredError {
  readonly code: string;
  readonly field?: unknown;
  readonly reason?: unknown;
  readonly table?: unknown;
  readonly status?: unknown;
  readonly requestId?: unknown;
}

/**
 * Flatten a refusal for the wire.
 *
 * Every field is copied through `String` only when present, so an error carrying
 * a structural extra — a bucket key, an index — loses it here rather than
 * leaking a shape a caller could probe. Anything worth showing an operator is on
 * the envelope by name.
 */
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

/**
 * The write context every mutation builds the same way.
 *
 * `now` is taken here, from the server's clock, and is never an argument. A
 * client-supplied instant would let a handheld backdate stock into a closed
 * period, and the audit row's `occurredAt` is evidence.
 */
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
