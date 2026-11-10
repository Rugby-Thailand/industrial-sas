import {
  canonicalArgumentText,
  type RequestIdentityError,
} from "../model/inventory/requestIdentity";
import { fail, ok, type Result } from "../model/result";

import type { TenantDocumentAccess, TenantOrgId } from "./tenantDb";

export const IDEMPOTENCY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** The stored replay index, as this module reads it. */
export interface IdempotencyRecord {
  readonly _id: string;
  readonly orgId: TenantOrgId;
  readonly operation: string;
  readonly requestId: string;
  readonly expiresAt: number;
  readonly status: "IN_PROGRESS" | "SUCCEEDED" | "FAILED";
  readonly requestHash: string;
  readonly resultRef?: string;
  readonly resultHash?: string;
}

export type IdempotencyError =
  | { readonly code: "REQUEST_ARGUMENT_CONFLICT"; readonly requestId: string }
  | {
      readonly code: "REQUEST_IDENTITY_INVALID";
      readonly cause: RequestIdentityError;
    };

const HEX = "0123456789abcdef";

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  let hex = "";
  for (const byte of view) {
    hex += HEX[byte >> 4]! + HEX[byte & 0x0f]!;
  }
  return hex;
}

export async function fingerprintArguments(
  payload: unknown,
): Promise<Result<string, IdempotencyError>> {
  const text = canonicalArgumentText(payload);
  if (!text.ok) {
    return fail({ code: "REQUEST_IDENTITY_INVALID", cause: text.error });
  }
  return ok(await sha256Hex(text.value));
}

export type IdempotencyDecision =
  | { readonly kind: "FRESH" }
  | { readonly kind: "REPLAY"; readonly record: IdempotencyRecord };

/**
 * The receipt digest that binds a stored result reference to the table it
 * answered, so a replay cannot return another table's document. Shared by
 * the finished-goods, HR and master-data command helpers. Commands whose
 * receipt is a structured payload (rack generation) digest that payload.
 */
export const resultIdentityDigest = (
  table: string,
  documentId: string,
): Promise<string> => sha256Hex(`${table}:${documentId}`);

/**
 * The replayed document ID when the receipt proves it answered `table`,
 * otherwise null. Strict: a missing reference or digest is unverifiable.
 * What a caller does next (refuse, rebuild the answer under current access,
 * check the target still exists) remains that feature's policy.
 */
export async function verifiedResultIdentity(
  record: Pick<IdempotencyRecord, "resultRef" | "resultHash">,
  table: string,
): Promise<string | null> {
  const documentId = record.resultRef;
  if (!documentId) return null;
  return record.resultHash === (await resultIdentityDigest(table, documentId))
    ? documentId
    : null;
}

export interface IdempotencyCheckInput {
  readonly tenantDb: TenantDocumentAccess;

  readonly operation: string;

  readonly requestId: string;

  readonly requestHash: string;
}

export async function checkIdempotency(
  input: IdempotencyCheckInput,
): Promise<Result<IdempotencyDecision, IdempotencyError>> {
  const { tenantDb, operation, requestId, requestHash } = input;

  const existing = await tenantDb
    .byIndex<IdempotencyRecord>(
      "idempotencyRecords",
      "by_orgId_operation_requestId",
      [
        { field: "operation", value: operation },
        { field: "requestId", value: requestId },
      ],
    )
    .unique();

  // At the boundary the key may be reused, independently of sweep timing.
  if (existing === null || existing.expiresAt <= Date.now())
    return ok(Object.freeze({ kind: "FRESH" as const }));

  if (existing.requestHash !== requestHash) {
    return fail({ code: "REQUEST_ARGUMENT_CONFLICT", requestId });
  }

  return ok(Object.freeze({ kind: "REPLAY" as const, record: existing }));
}

export interface IdempotencyWriteInput {
  readonly tenantDb: TenantDocumentAccess;
  readonly operation: string;
  readonly requestId: string;
  readonly requestHash: string;

  readonly resultRef: string;
  /** Integrity digest of the original answer, so a replay is verifiable. */
  readonly resultHash: string;
  readonly actorUserId: string;
  readonly deviceId?: string;

  readonly now: number;
}

export async function writeIdempotencyRecord(
  input: IdempotencyWriteInput,
): Promise<void> {
  const previous = await input.tenantDb
    .byIndex<IdempotencyRecord>(
      "idempotencyRecords",
      "by_orgId_operation_requestId",
      [
        { field: "operation", value: input.operation },
        { field: "requestId", value: input.requestId },
      ],
    )
    .unique();
  if (previous) {
    if (previous.expiresAt > input.now)
      throw new Error("Live idempotency key cannot be overwritten");
    await input.tenantDb.delete("idempotencyRecords", previous._id);
  }
  await input.tenantDb.insert("idempotencyRecords", {
    operation: input.operation,
    requestId: input.requestId,
    status: "SUCCEEDED" as const,
    requestHash: input.requestHash,
    resultRef: input.resultRef,
    resultHash: input.resultHash,
    actorUserId: input.actorUserId,
    ...(input.deviceId === undefined ? {} : { deviceId: input.deviceId }),
    firstSeenAt: input.now,
    completedAt: input.now,
    expiresAt: input.now + IDEMPOTENCY_RETENTION_MS,
  });
}
