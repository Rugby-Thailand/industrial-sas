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

  if (existing === null) return ok(Object.freeze({ kind: "FRESH" as const }));

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
