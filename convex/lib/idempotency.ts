/**
 * Idempotency, as a capability any tenant-bound operation can use.
 *
 * This machinery was written for and proved by the inventory ledger
 * (`INV-0003-01`). Nothing about it is ledger-specific: "the same request ID with
 * the same arguments is a retry, the same request ID with different arguments is
 * a reused ID, and a retry must not write twice" is the rule every write in this
 * system owes. It lived inside `inventoryLedgerStore.ts` because that was the
 * only writer; a second writer would otherwise reimplement it, and a
 * reimplementation that got the fingerprint comparison backwards is a duplicate
 * posting nobody notices.
 *
 * ### What this module owns
 *
 * The **decision**, not the payloads:
 *
 * 1. One bounded read of `idempotencyRecords.by_orgId_operation_requestId`
 *    through the tenant-bound accessor, so the record of another tenant's request
 *    is not merely invisible — it is unreachable.
 * 2. The comparison of the caller's request fingerprint with the stored one, and
 *    the `REQUEST_ARGUMENT_CONFLICT` that a mismatch produces.
 * 3. The record write, with its retention horizon.
 *
 * ### What this module deliberately does not own
 *
 * **Replay.** Reconstructing the original answer is operation-specific: the
 * ledger rebuilds a posting from its immutable header and lines and verifies the
 * rebuild against `resultHash`; a master-data create re-reads the row it made.
 * `checkIdempotency` hands back the stored record and lets the operation decide,
 * because a generic replay would have to store the response — and an idempotency
 * table holding requests and responses becomes a second, unaudited copy of domain
 * data and a place for PII to collect (plan §14).
 *
 * So the record holds a reference and two digests. Never a payload.
 *
 * ### Why the fingerprint is a hash and not the arguments
 *
 * Same reason. A stored argument list is a copy of the request, with whatever a
 * tenant put in it. A SHA-256 of the canonical text answers "are these the same
 * arguments" and answers nothing else.
 */
import {
  canonicalArgumentText,
  type RequestIdentityError,
} from "../model/inventory/requestIdentity";
import { fail, ok, type Result } from "../model/result";

import type { TenantDocumentAccess, TenantOrgId } from "./tenantDb";

/* -------------------------------------------------------------------------- */
/* Retention                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Idempotency retention: 30 days.
 *
 * Not the seven years D-27 gives the ledger and the audit trail. A replay window
 * only has to outlive a retry, and keeping request correlation longer than that
 * means keeping a second index of domain activity for no reader (plan §14). The
 * operation's own durable row carries `operation` and `requestId` forever where
 * the domain needs provenance, so it survives the record's expiry.
 */
export const IDEMPOTENCY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/* -------------------------------------------------------------------------- */
/* Row                                                                         */
/* -------------------------------------------------------------------------- */

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

/**
 * The two ways an idempotency check refuses.
 *
 * `cause` is the kernel's own structured error rather than `unknown`: an
 * operation whose error union already names `REQUEST_IDENTITY_INVALID` — the
 * ledger's does — can then absorb one of these without widening its own contract
 * to accept anything at all.
 */
export type IdempotencyError =
  | { readonly code: "REQUEST_ARGUMENT_CONFLICT"; readonly requestId: string }
  | {
      readonly code: "REQUEST_IDENTITY_INVALID";
      readonly cause: RequestIdentityError;
    };

/* -------------------------------------------------------------------------- */
/* Digest                                                                      */
/* -------------------------------------------------------------------------- */

const HEX = "0123456789abcdef";

/**
 * SHA-256 of a canonical text, as lower-case hex.
 *
 * Web Crypto, because it is present in the Convex runtime and in Node 24 and
 * needs no dependency. Not a keyed digest and not a secret: these hashes decide
 * "are these the same arguments" and "is this the same result", and neither
 * question involves an adversary who does not already hold the arguments.
 */
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

/**
 * The fingerprint of an operation's arguments.
 *
 * The caller chooses what goes in: everything that decides what gets written,
 * and nothing that does not. The ledger's own choice is instructive — it hashes
 * the organization, warehouse, type, operation, request ID, source, reason,
 * reversal link, and ordered lines, but **not** the actor, the device, or the
 * clock. A retry from a second handheld under the same request ID is still the
 * same intent, and hashing the device would turn a legitimate retry into
 * `REQUEST_ARGUMENT_CONFLICT`.
 *
 * `canonicalArgumentText` is the pure kernel that makes two structurally equal
 * argument sets produce one text: sorted keys, bounded depth, no `undefined`
 * ambiguity.
 */
export async function fingerprintArguments(
  payload: unknown,
): Promise<Result<string, IdempotencyError>> {
  const text = canonicalArgumentText(payload);
  if (!text.ok) {
    return fail({ code: "REQUEST_IDENTITY_INVALID", cause: text.error });
  }
  return ok(await sha256Hex(text.value));
}

/* -------------------------------------------------------------------------- */
/* The decision                                                                */
/* -------------------------------------------------------------------------- */

/**
 * What a caller should do about a request ID it has been handed.
 *
 * `FRESH` means no record exists and the operation should proceed. `REPLAY`
 * means a record exists whose arguments match, and the caller owns reconstructing
 * the original answer from it — see the module note for why that is not generic.
 */
export type IdempotencyDecision =
  | { readonly kind: "FRESH" }
  | { readonly kind: "REPLAY"; readonly record: IdempotencyRecord };

export interface IdempotencyCheckInput {
  readonly tenantDb: TenantDocumentAccess;
  /** The logical operation name; half of the idempotency key. */
  readonly operation: string;
  /** The client's request ID; the other half. */
  readonly requestId: string;
  /** The fingerprint of this call's arguments, from `fingerprintArguments`. */
  readonly requestHash: string;
}

/**
 * Look up the request, and decide.
 *
 * One bounded, `orgId`-first indexed read through the tenant-bound accessor.
 * `unique()` rather than `first()` on purpose: `(orgId, operation, requestId)` is
 * unique **by contract** — Convex has no unique constraint — and a second row
 * under that key is a broken invariant. A reader that answered with the first of
 * them would be how the breakage stays invisible; `unique()` surfaces it.
 *
 * A record whose fingerprint differs is `REQUEST_ARGUMENT_CONFLICT`, and the
 * error names the request ID and nothing else. It deliberately does not say what
 * differed: the caller already holds its own arguments, and the stored ones are
 * not this module's to disclose.
 */
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

/* -------------------------------------------------------------------------- */
/* The record                                                                  */
/* -------------------------------------------------------------------------- */

export interface IdempotencyWriteInput {
  readonly tenantDb: TenantDocumentAccess;
  readonly operation: string;
  readonly requestId: string;
  readonly requestHash: string;
  /** The operation's own stable handle to what it wrote. */
  readonly resultRef: string;
  /** Integrity digest of the original answer, so a replay is verifiable. */
  readonly resultHash: string;
  readonly actorUserId: string;
  readonly deviceId?: string;
  /** The caller's clock, so this module takes none. */
  readonly now: number;
}

/**
 * Write the replay index.
 *
 * **Last**, always. The record must only exist if everything the operation wrote
 * has committed, because its presence is what makes the next identical request a
 * replay rather than a second write. Convex gives the whole mutation one
 * transaction, so "last" here means last in program order — and if the operation
 * throws after this line, the record rolls back with everything else.
 *
 * `status` is `SUCCEEDED` unconditionally: this function is only reachable on the
 * success path. An `IN_PROGRESS` record would need a writer that could observe
 * its own crash, which a single-transaction model does not have, and a `FAILED`
 * one would be a durable record of something that did not happen.
 */
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
