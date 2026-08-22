/**
 * One state machine for every master-data write, as a pure function.
 *
 * The read side already has `ledgerState.ts`; this is its counterpart, and it is
 * separate for a reason that is not symmetry. A read that fails costs a retry. A
 * write that fails ambiguously costs an operator the answer to "did that save?",
 * and the only honest way to answer it is to distinguish the endings:
 *
 * | State          | What is actually true                                        |
 * | -------------- | ------------------------------------------------------------ |
 * | `IDLE`         | Nothing submitted yet.                                       |
 * | `SUBMITTING`   | Sent; no answer.                                             |
 * | `SAVED`        | The server wrote it, and says whether this was a replay.      |
 * | `DENIED`       | Authorization refused (`INV-0006-01`). Generic, by contract.  |
 * | `REFUSED`      | Authorized, but the write itself was rejected (field, key).   |
 * | `FAILED`       | Transport or unknown. The write **may or may not** have run.  |
 *
 * `FAILED` is the one that earns the module. A network failure after the
 * mutation reached the server is indistinguishable from one before it, so the
 * screen must not say "not saved" — it says "retry with the same request ID",
 * which is exactly what the idempotency key is for: the retry replays rather
 * than duplicating (`convex/lib/idempotency.ts`).
 *
 * `DENIED` is never explained beyond what the server explains. The wrapper
 * returns one code for every refusal on purpose (`INV-0002-07`), so a UI that
 * translated a denial into "you need an approver" would be guessing — and
 * guessing right would make the screen a permission oracle. The request ID is
 * shown instead, because that is what an administrator can look up in the audit
 * trail where the real reason survives.
 */
import type { MasterDataWriteOutcome } from "./masterDataApi";
import type { TenantOutcome } from "./ledgerApi";
import { failureCodeOf, isAnonymousFailure } from "./ledgerState";

import type { AppEnvironment } from "../environment";

/* -------------------------------------------------------------------------- */
/* Gate                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * What can be decided before a mutation is issued.
 *
 * A real write is offered only when backend and identity are configured.
 */
export type WriteGate =
  | { readonly kind: "BACKEND_MISSING" }
  | { readonly kind: "SIGN_IN_REQUIRED" }
  | { readonly kind: "READY" };

export function resolveWriteGate(environment: AppEnvironment): WriteGate {
  if (!environment.backendConfigured) return { kind: "BACKEND_MISSING" };
  if (!environment.identityConfigured) return { kind: "SIGN_IN_REQUIRED" };
  return { kind: "READY" };
}

/** Whether a gate permits a real mutation to be sent. */
export const canSubmit = (gate: WriteGate): boolean => gate.kind === "READY";

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

export type WriteState =
  | { readonly kind: "IDLE" }
  | { readonly kind: "SUBMITTING" }
  | {
      readonly kind: "SAVED";
      readonly documentId: string;
      /** True when the server recognised the request ID and did not re-run. */
      readonly replayed: boolean;
    }
  | { readonly kind: "DENIED"; readonly requestId: string }
  | {
      readonly kind: "REFUSED";
      readonly code: string;
      /** The argument at fault, when the server named one. Never the value. */
      readonly field?: string;
    }
  | { readonly kind: "FAILED"; readonly code: string };

export const IDLE: WriteState = Object.freeze({ kind: "IDLE" as const });

/**
 * Turn a mutation's answer — or its failure to answer — into a state.
 *
 * Pure and total: every input maps to exactly one state, including shapes the
 * server should never produce. A `written: false` with no `code` becomes
 * `REFUSED` under `UNKNOWN` rather than a screen that renders nothing, because
 * "we got an answer we could not read" is still not "saved".
 */
export function toWriteState(input: {
  readonly outcome?: TenantOutcome<MasterDataWriteOutcome> | undefined;
  readonly failure?: unknown;
}): WriteState {
  if (input.failure !== undefined) {
    return isAnonymousFailure(input.failure)
      ? { kind: "FAILED", code: "ANONYMOUS" }
      : { kind: "FAILED", code: failureCodeOf(input.failure) };
  }
  const outcome = input.outcome;
  if (outcome === undefined) return { kind: "SUBMITTING" };
  if (!outcome.ok) return { kind: "DENIED", requestId: outcome.requestId };

  const result = outcome.value;
  if (result.written) {
    return {
      kind: "SAVED",
      documentId: result.documentId,
      replayed: result.replayed,
    };
  }

  const code =
    typeof result.error?.code === "string" && result.error.code.length > 0
      ? result.error.code
      : "UNKNOWN";
  const field = result.error?.field;
  return typeof field === "string" && field.length > 0
    ? { kind: "REFUSED", code, field }
    : { kind: "REFUSED", code };
}

/**
 * Whether the outcome is final for this request ID.
 *
 * A terminal state means the next submission is a *new* request and must carry
 * a new idempotency key. `FAILED` is deliberately not terminal: the server may
 * have applied the write, so the retry has to reuse the key it already sent, or
 * a network blip becomes a duplicate row.
 */
export const isTerminal = (state: WriteState): boolean =>
  state.kind === "SAVED" || state.kind === "DENIED" || state.kind === "REFUSED";

/** Whether a control should be disabled because a request is outstanding. */
export const isBusy = (state: WriteState): boolean =>
  state.kind === "SUBMITTING";

/**
 * The field a refusal blames, if any.
 *
 * Used to put `aria-invalid` on one input rather than on the form. A refusal
 * that names no field — a duplicate key, a request conflict — correctly returns
 * `undefined`, and the message stands alone above the form.
 */
export const invalidField = (state: WriteState): string | undefined =>
  state.kind === "REFUSED" ? state.field : undefined;

/* -------------------------------------------------------------------------- */
/* Request identifiers                                                         */
/* -------------------------------------------------------------------------- */

/** How a browser-minted idempotency key is marked. */
export const REQUEST_ID_PREFIX = "web_";

/**
 * A fresh idempotency key.
 *
 * `crypto.randomUUID` where it exists, `crypto.getRandomValues` where only that
 * does, and a time-and-counter string as a last resort. The last resort is not
 * decorative: `randomUUID` is unavailable on insecure origins in some browsers,
 * and a key generator that threw there would break the form rather than the
 * uniqueness guarantee it was protecting.
 *
 * Uniqueness only has to hold within one tenant and one operation for the
 * retention window; the key is scoped by `(orgId, operation, requestId)` on the
 * server, and the argument fingerprint catches a collision as a conflict rather
 * than as a silently replayed write.
 */
let fallbackCounter = 0;

export function newRequestId(): string {
  const webCrypto = globalThis.crypto as Crypto | undefined;

  if (typeof webCrypto?.randomUUID === "function") {
    return `${REQUEST_ID_PREFIX}${webCrypto.randomUUID()}`;
  }
  if (typeof webCrypto?.getRandomValues === "function") {
    const bytes = webCrypto.getRandomValues(new Uint8Array(16));
    const hex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    return `${REQUEST_ID_PREFIX}${hex}`;
  }
  fallbackCounter += 1;
  return `${REQUEST_ID_PREFIX}${Date.now().toString(36)}_${fallbackCounter}`;
}
