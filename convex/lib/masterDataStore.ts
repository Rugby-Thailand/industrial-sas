import {
  MAX_CODE_LENGTH,
  MAX_LOT_CODE_LENGTH,
  normalizeCode,
} from "../model/identifiers/normalization";
import { fail, ok, type Result } from "../model/result";

import {
  checkIdempotency,
  fingerprintArguments,
  sha256Hex,
  writeIdempotencyRecord,
  type IdempotencyError,
} from "./idempotency";
import type { TenantTableName } from "./schemaPolicy";
import type { TenantDocumentAccess, TenantOrgId } from "./tenantDb";

export type MasterDataError =
  | IdempotencyError
  /** A code did not survive normalization: empty, over-long, illegal character. */
  | {
      readonly code: "FIELD_INVALID";
      readonly field: string;
      readonly reason: string;
    }
  /** A uniqueness contract would be violated. Names the field, never the value. */
  | { readonly code: "DUPLICATE_KEY"; readonly field: string }
  /** The target does not exist, is another tenant's, or is unusable. */
  | { readonly code: "NOT_FOUND"; readonly table: string }
  /** A referenced document is not this tenant's, or does not exist. */
  | { readonly code: "REFERENCE_NOT_FOUND"; readonly field: string }
  /** The replay index points at a row that is no longer readable. */
  | { readonly code: "REPLAY_TARGET_MISSING"; readonly requestId: string }
  /** A rebuilt replay answer does not match the digest the original produced. */
  | { readonly code: "REPLAY_RESULT_UNVERIFIABLE"; readonly requestId: string };

export function normalizeField(
  field: string,
  raw: string,
  options: {
    readonly caseFolding: "UPPERCASE" | "PRESERVE";
    readonly maxLength: number;
  },
): Result<string, MasterDataError> {
  const normalized = normalizeCode(raw, options);
  if (!normalized.ok) {
    return fail({
      code: "FIELD_INVALID",
      field,
      reason: normalized.error.code,
    });
  }
  return ok(normalized.value);
}

export const MAX_DISPLAY_NAME_LENGTH = 200;

export function normalizeDisplayName(
  field: string,
  raw: string,
): Result<string, MasterDataError> {
  if (typeof raw !== "string") {
    return fail({ code: "FIELD_INVALID", field, reason: "NOT_A_STRING" });
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return fail({ code: "FIELD_INVALID", field, reason: "EMPTY" });
  }
  if (trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
    return fail({ code: "FIELD_INVALID", field, reason: "TOO_LONG" });
  }
  return ok(trimmed);
}

export const CODE_FIELD = Object.freeze({
  caseFolding: "UPPERCASE" as const,
  maxLength: MAX_CODE_LENGTH,
});

export const LOT_CODE_FIELD = Object.freeze({
  caseFolding: "PRESERVE" as const,
  maxLength: MAX_LOT_CODE_LENGTH,
});

export interface UniquenessCheck {
  readonly field: string;
  readonly index: string;
  readonly equality: readonly {
    readonly field: string;
    readonly value: unknown;
  }[];
}

interface OwnedRow {
  readonly _id: string;
  readonly orgId: TenantOrgId;
}

export async function assertUnique(
  tenantDb: TenantDocumentAccess,
  table: TenantTableName,
  checks: readonly UniquenessCheck[],
  excludeId?: string,
): Promise<Result<true, MasterDataError>> {
  for (const check of checks) {
    const existing = await tenantDb
      .byIndex<OwnedRow>(table, check.index, check.equality)
      .first();

    if (existing === null) continue;
    if (excludeId !== undefined && existing._id === excludeId) continue;

    return fail({ code: "DUPLICATE_KEY", field: check.field });
  }
  return ok(true);
}

export interface AuditChange {
  readonly field: string;
  readonly from?: string;
  readonly to?: string;
}

export function describeAuditValue(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}

export function insertedFields(
  document: Readonly<Record<string, unknown>>,
): readonly AuditChange[] {
  return Object.freeze(
    Object.entries(document)
      .filter(([, value]) => value !== undefined)
      .map(([field, value]) => ({ field, to: describeAuditValue(value) })),
  );
}

/** The audit shape of a delete: every stored field, as it stood, and nothing new. */
export function removedFields(
  document: Readonly<Record<string, unknown>>,
): readonly AuditChange[] {
  return Object.freeze(
    Object.entries(document)
      .filter(([field, value]) => !field.startsWith("_") && value !== undefined)
      .map(([field, value]) => ({ field, from: describeAuditValue(value) })),
  );
}

export function diffFields(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): readonly AuditChange[] {
  const changes: AuditChange[] = [];
  for (const [field, next] of Object.entries(after)) {
    const previous = before[field];
    if (previous === next) continue;
    changes.push({
      field,
      ...(previous === undefined ? {} : { from: describeAuditValue(previous) }),
      ...(next === undefined ? {} : { to: describeAuditValue(next) }),
    });
  }
  return Object.freeze(changes);
}

export interface MasterDataWriteContext {
  readonly tenantDb: TenantDocumentAccess;
  readonly table: TenantTableName;

  readonly operation: string;
  readonly requestId: string;
  readonly permissionCode: string;
  readonly actorUserId: string;
  readonly warehouseId?: string;
  readonly deviceId?: string;

  readonly now: number;
}

export interface MasterDataOutcome {
  readonly documentId: string;

  readonly replayed: boolean;
}

export interface CreateInput extends MasterDataWriteContext {
  readonly fingerprint: unknown;
  readonly uniqueness: readonly UniquenessCheck[];

  readonly document: Record<string, unknown>;
}

export async function createMasterDataRow(
  input: CreateInput,
): Promise<Result<MasterDataOutcome, MasterDataError>> {
  const { tenantDb, table, operation, requestId, now } = input;

  const fingerprint = await fingerprintArguments(input.fingerprint);
  if (!fingerprint.ok) return fingerprint;

  const decision = await checkIdempotency({
    tenantDb,
    operation,
    requestId,
    requestHash: fingerprint.value,
  });
  if (!decision.ok) return decision;

  if (decision.value.kind === "REPLAY") {
    return await replayStoredMasterDataWrite(
      tenantDb,
      table,
      decision.value.record,
    );
  }

  const unique = await assertUnique(tenantDb, table, input.uniqueness);
  if (!unique.ok) return unique;

  const documentId = await tenantDb.insert(table, input.document);

  await appendMasterDataAudit(input, {
    entityId: documentId,
    changes: insertedFields(input.document),
  });

  const resultHash = await identityDigest(table, documentId);
  await writeIdempotencyRecord({
    tenantDb,
    operation,
    requestId,
    requestHash: fingerprint.value,
    resultRef: documentId,
    resultHash,
    actorUserId: input.actorUserId,
    ...(input.deviceId === undefined ? {} : { deviceId: input.deviceId }),
    now,
  });

  return ok(Object.freeze({ documentId, replayed: false }));
}

export interface UpdateInput extends MasterDataWriteContext {
  readonly documentId: string;
  readonly fingerprint: unknown;
  readonly uniqueness: readonly UniquenessCheck[];

  readonly patch: Record<string, unknown>;
}

export async function updateMasterDataRow(
  input: UpdateInput,
): Promise<Result<MasterDataOutcome, MasterDataError>> {
  const { tenantDb, table, operation, requestId, documentId, now } = input;

  const before = await tenantDb.get<OwnedRow & Record<string, unknown>>(
    table,
    documentId,
  );
  if (before === null) return fail({ code: "NOT_FOUND", table });

  const fingerprint = await fingerprintArguments(input.fingerprint);
  if (!fingerprint.ok) return fingerprint;

  const decision = await checkIdempotency({
    tenantDb,
    operation,
    requestId,
    requestHash: fingerprint.value,
  });
  if (!decision.ok) return decision;

  if (decision.value.kind === "REPLAY") {
    return await replayStoredMasterDataWrite(
      tenantDb,
      table,
      decision.value.record,
    );
  }

  const unique = await assertUnique(
    tenantDb,
    table,
    input.uniqueness,
    documentId,
  );
  if (!unique.ok) return unique;

  await tenantDb.patch(table, documentId, input.patch);

  await appendMasterDataAudit(input, {
    entityId: documentId,
    changes: diffFields(before, input.patch),
  });

  const resultHash = await identityDigest(table, documentId);
  await writeIdempotencyRecord({
    tenantDb,
    operation,
    requestId,
    requestHash: fingerprint.value,
    resultRef: documentId,
    resultHash,
    actorUserId: input.actorUserId,
    ...(input.deviceId === undefined ? {} : { deviceId: input.deviceId }),
    now,
  });

  return ok(Object.freeze({ documentId, replayed: false }));
}

export interface DeleteInput<
  Block extends { readonly code: string },
> extends MasterDataWriteContext {
  readonly documentId: string;
  readonly fingerprint: unknown;
  /**
   * The domain's own reasons to keep the row, checked on the fresh path only.
   *
   * It has to run after the replay branch, not before: a retried delete finds
   * nothing to inspect, and a second call must answer "already gone", never
   * "no such row".
   */
  readonly precondition?: (
    before: Readonly<Record<string, unknown>>,
  ) => Promise<Block | null>;
}

/**
 * Hard-delete one master-data row, idempotently.
 *
 * A delete cannot replay the way a create or an update does: there is no
 * surviving row to re-read, so the stored record itself is the answer. The
 * digest is taken over a removal-flavoured identity, which keeps a replayed
 * delete from ever being mistaken for a replayed create of the same id.
 */
export async function deleteMasterDataRow<
  Block extends { readonly code: string },
>(
  input: DeleteInput<Block>,
): Promise<Result<MasterDataOutcome, MasterDataError | Block>> {
  const { tenantDb, table, operation, requestId, documentId, now } = input;

  const fingerprint = await fingerprintArguments(input.fingerprint);
  if (!fingerprint.ok) return fingerprint;

  const decision = await checkIdempotency({
    tenantDb,
    operation,
    requestId,
    requestHash: fingerprint.value,
  });
  if (!decision.ok) return decision;

  if (decision.value.kind === "REPLAY") {
    const record = decision.value.record;
    if (record.resultRef === undefined || record.status !== "SUCCEEDED") {
      return fail({
        code: "REPLAY_TARGET_MISSING",
        requestId: record.requestId,
      });
    }
    const expected = await removalDigest(table, record.resultRef);
    if (record.resultHash !== undefined && record.resultHash !== expected) {
      return fail({
        code: "REPLAY_RESULT_UNVERIFIABLE",
        requestId: record.requestId,
      });
    }
    return ok(Object.freeze({ documentId: record.resultRef, replayed: true }));
  }

  const before = await tenantDb.get<OwnedRow & Record<string, unknown>>(
    table,
    documentId,
  );
  if (before === null) return fail({ code: "NOT_FOUND", table });

  const blocked = await input.precondition?.(before);
  if (blocked !== undefined && blocked !== null) return fail(blocked);

  await tenantDb.delete(table, documentId);

  await appendMasterDataAudit(input, {
    entityId: documentId,
    changes: removedFields(before),
  });

  await writeIdempotencyRecord({
    tenantDb,
    operation,
    requestId,
    requestHash: fingerprint.value,
    resultRef: documentId,
    resultHash: await removalDigest(table, documentId),
    actorUserId: input.actorUserId,
    ...(input.deviceId === undefined ? {} : { deviceId: input.deviceId }),
    now,
  });

  return ok(Object.freeze({ documentId, replayed: false }));
}

const identityDigest = (table: string, documentId: string): Promise<string> =>
  sha256Hex(`${table}:${documentId}`);

const removalDigest = (table: string, documentId: string): Promise<string> =>
  sha256Hex(`${table}:${documentId}:deleted`);

async function replayStoredMasterDataWrite(
  tenantDb: TenantDocumentAccess,
  table: TenantTableName,
  record: {
    readonly requestId: string;
    readonly status: string;
    readonly resultRef?: string;
    readonly resultHash?: string;
  },
): Promise<Result<MasterDataOutcome, MasterDataError>> {
  const reference = record.resultRef;
  if (reference === undefined || record.status !== "SUCCEEDED") {
    return fail({
      code: "REPLAY_TARGET_MISSING",
      requestId: record.requestId,
    });
  }

  const current = await tenantDb.get<OwnedRow>(table, reference);
  if (current === null) {
    return fail({
      code: "REPLAY_TARGET_MISSING",
      requestId: record.requestId,
    });
  }

  const expected = await identityDigest(table, reference);
  if (record.resultHash !== undefined && record.resultHash !== expected) {
    return fail({
      code: "REPLAY_RESULT_UNVERIFIABLE",
      requestId: record.requestId,
    });
  }

  return ok(Object.freeze({ documentId: reference, replayed: true }));
}

export async function replayTenantWriteIfPresent(input: {
  readonly tenantDb: TenantDocumentAccess;
  readonly table: TenantTableName;
  readonly operation: string;
  readonly requestId: string;
  readonly fingerprint: unknown;
}): Promise<Result<MasterDataOutcome | null, MasterDataError>> {
  const fingerprint = await fingerprintArguments(input.fingerprint);
  if (!fingerprint.ok) return fingerprint;
  const decision = await checkIdempotency({
    tenantDb: input.tenantDb,
    operation: input.operation,
    requestId: input.requestId,
    requestHash: fingerprint.value,
  });
  if (!decision.ok) return decision;
  if (decision.value.kind === "FRESH") return ok(null);
  return await replayStoredMasterDataWrite(
    input.tenantDb,
    input.table,
    decision.value.record,
  );
}

async function appendMasterDataAudit(
  context: MasterDataWriteContext,
  input: {
    readonly entityId: string;
    readonly changes: readonly AuditChange[];
  },
): Promise<void> {
  await appendDomainAudit(context, {
    entityTable: context.table,
    entityId: input.entityId,
    changes: input.changes,
  });
}

export async function appendDomainAudit(
  context: MasterDataWriteContext,
  input: {
    readonly entityTable: TenantTableName;
    readonly entityId: string;
    readonly changes: readonly AuditChange[];
  },
): Promise<void> {
  await context.tenantDb.insert("auditEvents", {
    occurredAt: context.now,
    actorKind: "USER" as const,
    actorUserId: context.actorUserId,
    action: context.operation,
    permissionCode: context.permissionCode,
    entityTable: input.entityTable,
    entityId: input.entityId,
    ...(context.warehouseId === undefined
      ? {}
      : { warehouseId: context.warehouseId }),
    outcome: "ALLOWED" as const,
    requestId: context.requestId,
    ...(context.deviceId === undefined ? {} : { deviceId: context.deviceId }),
    changes: input.changes.map((change) => ({ ...change })),
  });
}
