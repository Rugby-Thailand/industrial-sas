/**
 * The finished-goods write envelope shared by every finished-goods command
 * module (workflow, packing batches, batch management, scanning, job scans):
 * request-ID bounds, argument fingerprint, replay, DENIED/ALLOWED audit and
 * the idempotency receipt, all inside the caller's mutation transaction.
 * Move and scan operations bind the actor into the fingerprint. Business
 * checks and writes stay in each command's `run` callback.
 */
import type { Id } from "../_generated/dataModel";
import {
  checkIdempotency,
  fingerprintArguments,
  resultIdentityDigest,
  verifiedResultIdentity,
  writeIdempotencyRecord,
} from "../lib/idempotency";
import type { AuditChange } from "../lib/masterDataStore";
import type { TenantTableName } from "../lib/schemaPolicy";
import type { TenantFunctionContext } from "../lib/tenantFunctions";
import { refusal, written } from "../lib/writeEnvelope";

export const failure = (code: string, field?: string, reason?: string) =>
  refusal({ code, field, reason });
export const stamp = (ctx: TenantFunctionContext) => ({
  updatedAt: Date.now(),
  updatedByUserId: ctx.tenant.actor._id,
});
export const created = (ctx: TenantFunctionContext) => ({
  ...stamp(ctx),
  createdAt: Date.now(),
  createdByUserId: ctx.tenant.actor._id,
});
export const compact = <T extends Record<string, unknown>>(fields: T) =>
  Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );

/** A mutation reads the complete occupancy range before inserting a hold. Convex retries conflicting transactions. */
export async function command(
  ctx: TenantFunctionContext,
  args: { warehouseId: Id<"warehouses">; requestId: string },
  operation: string,
  table: TenantTableName,
  run: () => Promise<
    | ReturnType<typeof refusal>
    | { documentId: string; changes?: readonly AuditChange[] }
  >,
) {
  if (!args.requestId.trim() || args.requestId.length > 200)
    return failure("REQUEST_IDENTITY_INVALID", "requestId");
  const hash = await fingerprintArguments(
    compact(
      operation.startsWith("finishedGoods.move.") ||
        operation.startsWith("finishedGoods.scan.")
        ? { ...args, actorUserId: ctx.tenant.actor._id }
        : args,
    ),
  );
  if (!hash.ok) return refusal(hash.error);
  const replay = await checkIdempotency({
    tenantDb: ctx.tenantDb,
    operation,
    requestId: args.requestId,
    requestHash: hash.value,
  });
  if (!replay.ok) return refusal(replay.error);
  if (replay.value.kind === "REPLAY") {
    const id = await verifiedResultIdentity(replay.value.record, table);
    if (id === null) return failure("REPLAY_RESULT_UNVERIFIABLE");
    return written({ documentId: id, replayed: true });
  }
  const result = await run();
  if ("written" in result) {
    await ctx.tenantDb.insert("auditEvents", {
      occurredAt: Date.now(),
      actorKind: "USER",
      actorUserId: ctx.tenant.actor._id,
      action: operation,
      permissionCode: ctx.permission.code,
      entityTable: table,
      warehouseId: args.warehouseId,
      outcome: "DENIED",
      requestId: args.requestId,
      changes: [{ field: "error", to: result.error.code }],
    });
    return result;
  }
  const now = Date.now();
  await ctx.tenantDb.insert("auditEvents", {
    occurredAt: now,
    actorKind: "USER",
    actorUserId: ctx.tenant.actor._id,
    action: operation,
    permissionCode: ctx.permission.code,
    entityTable: table,
    entityId: result.documentId,
    warehouseId: args.warehouseId,
    outcome: "ALLOWED",
    requestId: args.requestId,
    ...(result.changes
      ? { changes: result.changes.map((change) => ({ ...change })) }
      : {}),
  });
  await writeIdempotencyRecord({
    tenantDb: ctx.tenantDb,
    operation,
    requestId: args.requestId,
    requestHash: hash.value,
    resultRef: result.documentId,
    resultHash: await resultIdentityDigest(table, result.documentId),
    actorUserId: ctx.tenant.actor._id,
    now,
  });
  return written({ ...result, replayed: false });
}
