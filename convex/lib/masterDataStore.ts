/**
 * The master-data write seam: one idempotent, uniqueness-checked, audited create
 * or update, for any tenant reference table.
 *
 * Everything below runs inside a caller's Convex transaction, through the
 * tenant-bound accessor it was handed (`TenantDocumentAccess`, `G-102`). It never
 * sees `ctx.db`, never resolves a tenant, and never decides a permission — those
 * happened in `mutationWithOrg` before the handler ran.
 *
 * ### The order, and why it is this order
 *
 * 1. **Normalize.** The server decides the stored form of every code. A SKU the
 *    browser sent as ` widget-001 ` and one it sent as `WIDGET-001` are the same
 *    SKU, and a uniqueness check that ran before normalization would let both
 *    exist. Normalization is `convex/model/identifiers/normalization.ts` — the
 *    same kernel a scan resolution uses, so a scanned code and a typed code
 *    normalize identically.
 * 2. **Fingerprint and check idempotency** (`INV-0003-01`, generalized). Before
 *    anything is read or written, so a retry costs one indexed read.
 * 3. **Uniqueness.** Convex has no unique constraint, so every "unique" key in
 *    `UNIQUENESS_CONTRACTS` is unique *by contract* — and the contract is the
 *    check this function performs. One bounded `orgId`-first indexed read per
 *    key.
 * 4. **Write**, then **audit**, then **the replay index**, in that order and in
 *    the caller's transaction, so all of it commits or none does.
 *
 * ### Why failures do not say what collided
 *
 * A create that answered "SKU WIDGET-001 already exists" is an oracle over the
 * tenant's own catalogue — which is fine — but the *same code path* answers for
 * a caller who guessed. The refusal therefore names the **field**, never the
 * value and never the colliding document's ID (`INV-0002-07`). The caller
 * already holds the value it sent; it learns nothing it did not bring.
 *
 * An update to a document this tenant does not own is `NOT_FOUND`, the same
 * answer a document that never existed produces (`INV-0002-03`).
 *
 * ### What this module will not do
 *
 * Delete. Master data is deactivated (`status: "INACTIVE"`), never removed: a
 * ledger line, a lot, and an audit row all reference an item by ID, and a
 * deleted item turns every one of those into a dangling pointer. `deactivate` is
 * an update like any other, which is why it needs no special path here — only a
 * different permission code at the function that calls this.
 */
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

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* Normalization                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Normalize one code field, or refuse it by name.
 *
 * `folding` is the caller's decision because the domain's is not uniform: a SKU
 * and a location code are upper-cased, a lot code preserves its case because a
 * supplier's `ab12` and `AB12` may be different batches
 * (`normalization.ts`). Getting that wrong silently merges two lots, so it is an
 * argument rather than a default.
 */
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
    /*
     * The refusal carries the kernel's *code* — `EMPTY`, `TOO_LONG`,
     * `WHITESPACE_NOT_ALLOWED` — and not the value that failed. A caller sent
     * the value and can see it; echoing it back into an error payload is how a
     * tenant's data ends up in a log nobody classified.
     */
    return fail({
      code: "FIELD_INVALID",
      field,
      reason: normalized.error.code,
    });
  }
  return ok(normalized.value);
}

/**
 * A free-text display name: trimmed, bounded, and required to be non-empty.
 *
 * Deliberately *not* run through `normalizeCode`. A name may be Thai, may
 * contain spaces, and must keep its case — it is content, not an identifier. The
 * only rules are the ones that protect the database: no unbounded length, and no
 * value that is only whitespace.
 */
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

/** The bound for an ordinary tenant code: SKU, location code, supplier code. */
export const CODE_FIELD = Object.freeze({
  caseFolding: "UPPERCASE" as const,
  maxLength: MAX_CODE_LENGTH,
});

/**
 * The bound for a lot code, which preserves case.
 *
 * A supplier's `ab12` and `AB12` may be different batches, so folding them would
 * silently merge two lots (`normalization.ts`). This is an explicit option
 * rather than a default for exactly that reason.
 */
export const LOT_CODE_FIELD = Object.freeze({
  caseFolding: "PRESERVE" as const,
  maxLength: MAX_LOT_CODE_LENGTH,
});

/* -------------------------------------------------------------------------- */
/* Uniqueness                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One "unique by contract" key to enforce before a write.
 *
 * `index` must be an `orgId`-first index whose remaining prefix is exactly
 * `equality`, so the check is a bounded indexed read and never a scan. The
 * accessor validates that itself and throws `INVALID_INDEX_QUERY` otherwise, so a
 * mis-specified contract fails loudly rather than silently reading too much.
 */
export interface UniquenessCheck {
  /** The field the refusal names. Never the value. */
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

/**
 * Prove every uniqueness key is free, or refuse.
 *
 * `excludeId` is what makes this usable for an update: renaming a location to
 * its own current code must not collide with itself. Without it, every no-op
 * update of a keyed field would be a duplicate.
 *
 * `first()` rather than `unique()`: a *second* row under a supposedly unique key
 * is a pre-existing corruption, and this function's job is to refuse the write
 * either way. Surfacing the corruption is `schemaPolicy`'s and the reconciliation
 * job's business, not this write's.
 */
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

/* -------------------------------------------------------------------------- */
/* Audit                                                                       */
/* -------------------------------------------------------------------------- */

/** One changed field, as the audit row records it. */
export interface AuditChange {
  readonly field: string;
  readonly from?: string;
  readonly to?: string;
}

/**
 * One field value, as the audit row displays it.
 *
 * Objects and arrays go through `JSON.stringify` rather than `String`, which
 * would render every one of them as `[object Object]`. A master-card revision
 * embeds its whole specification in one field, so plain coercion would record
 * that the specification changed while erasing what it changed to — the exact
 * thing the row exists to answer.
 */
export function describeAuditValue(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Every field of a freshly inserted document, as its audit changes.
 *
 * An insert has no `from`: there was no previous value, and an empty string
 * would read as "it used to be blank".
 */
export function insertedFields(
  document: Readonly<Record<string, unknown>>,
): readonly AuditChange[] {
  return Object.freeze(
    Object.entries(document)
      .filter(([, value]) => value !== undefined)
      .map(([field, value]) => ({ field, to: describeAuditValue(value) })),
  );
}

/**
 * The diff between two records, as display strings.
 *
 * Only fields whose value actually changed. An update that touched nothing
 * produces an empty diff and still writes its audit row: "someone submitted an
 * update that changed nothing" is a fact worth keeping, and an absent row would
 * make it look like the request never arrived.
 *
 * Values are stringified because `auditEvents.changes` stores display strings —
 * the audit trail is read by people, and a typed diff would need a reader that
 * knows every table's shape.
 */
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

/* -------------------------------------------------------------------------- */
/* Write                                                                       */
/* -------------------------------------------------------------------------- */

export interface MasterDataWriteContext {
  readonly tenantDb: TenantDocumentAccess;
  readonly table: TenantTableName;
  /** The logical operation name; half of the idempotency key. */
  readonly operation: string;
  readonly requestId: string;
  readonly permissionCode: string;
  readonly actorUserId: string;
  readonly warehouseId?: string;
  readonly deviceId?: string;
  /** The caller's clock, so this module takes none. */
  readonly now: number;
}

export interface MasterDataOutcome {
  readonly documentId: string;
  /** True when an identical request had already been applied. */
  readonly replayed: boolean;
}

export interface CreateInput extends MasterDataWriteContext {
  /** Everything that decides what gets written; the idempotency fingerprint. */
  readonly fingerprint: unknown;
  readonly uniqueness: readonly UniquenessCheck[];
  /** The row, without `orgId` — the accessor derives and stamps that. */
  readonly document: Record<string, unknown>;
}

/**
 * Create one master-data row, idempotently.
 *
 * A replay re-reads the row the original created and verifies it against the
 * stored digest, rather than trusting the reference. That verification is not
 * ceremony: the row is mutable — unlike a ledger line — so "the record says we
 * created `items:abc`" and "`items:abc` is still the row we created" are
 * different claims. A mismatch is `REPLAY_RESULT_UNVERIFIABLE` rather than a
 * plausible-looking answer.
 *
 * A replay of a *create* whose row has since been deactivated still replays
 * successfully: deactivation is a legitimate later edit, so the digest covers
 * only the identity the create established, not the row's current state.
 */
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
  /** The fields to change. Absent fields are left alone. */
  readonly patch: Record<string, unknown>;
}

/**
 * Update one master-data row, idempotently.
 *
 * The document is read **before** the idempotency decision is acted on, because
 * an update to something this tenant does not own must answer `NOT_FOUND`
 * whatever its request ID — otherwise a caller could probe another tenant's IDs
 * by observing which ones produced a conflict.
 */
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

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The digest a replay verifies against.
 *
 * Deliberately the *identity* of the row — its table and ID — and not its
 * contents. A content digest would make every legitimate later edit turn a
 * replay into `REPLAY_RESULT_UNVERIFIABLE`, which would mean a retry arriving
 * after an unrelated edit looks like corruption. What the record promises is
 * "this request created or updated that row", and that is exactly what is
 * checked.
 */
const identityDigest = (table: string, documentId: string): Promise<string> =>
  sha256Hex(`${table}:${documentId}`);

/**
 * Answer a replayed request from the record, after proving the row is still
 * readable and still the one the record names.
 */
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

/**
 * Return a stored successful answer before a handler evaluates lifecycle state.
 *
 * Transition handlers call this after proving the target belongs to the tenant,
 * but before asking whether its *current* status permits the transition. The
 * original successful transition necessarily changed that status, so doing the
 * lifecycle check first would turn a legitimate transport retry into an
 * `ILLEGAL_TRANSITION` refusal instead of replaying the original answer.
 */
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

/**
 * Append the domain audit row for a master-data write.
 *
 * Separate from the wrapper's authorization row, which records that the actor
 * *was allowed*. This one records what they *did*, with the field diff — the
 * evidence an administrator needs to answer "who changed this SKU's base UOM".
 * Insert only: `auditEvents` is append-only and the boundary guard fails the
 * build on any `patch`, `replace`, or `delete` naming it (`INV-0003-07`).
 */
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

/**
 * Append a domain audit row for a row this write touched *besides* its primary
 * target.
 *
 * Several order-to-ship transitions are one decision that lands on two rows:
 * releasing a master-card revision also supersedes the revision it replaces and
 * repoints its card; issuing a factory packet also moves the order line to
 * `HANDED_OFF`. The idempotency record covers the whole transaction through its
 * primary target, but the audit trail is read per entity — an administrator
 * asking "why did this line become handed off" looks the *line* up, not the
 * packet. Without this, that question has no answer.
 *
 * Insert only, same as every other writer of this table: the boundary guard
 * fails the build on a `patch`, `replace`, or `delete` naming `auditEvents`
 * (`INV-0003-07`).
 */
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
