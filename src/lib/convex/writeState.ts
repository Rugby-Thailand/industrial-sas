import type { MasterDataWriteOutcome } from "./masterDataApi";
import type { TenantOutcome } from "./ledgerApi";
import { failureCodeOf, isAnonymousFailure } from "./ledgerState";

import type { AppEnvironment } from "../environment";

export type WriteGate =
  | { readonly kind: "BACKEND_MISSING" }
  | { readonly kind: "SIGN_IN_REQUIRED" }
  | { readonly kind: "READY" };

export function resolveWriteGate(environment: AppEnvironment): WriteGate {
  if (!environment.backendConfigured) return { kind: "BACKEND_MISSING" };
  if (!environment.identityConfigured) return { kind: "SIGN_IN_REQUIRED" };
  return { kind: "READY" };
}

export const canSubmit = (gate: WriteGate): boolean => gate.kind === "READY";

export type WriteState =
  | { readonly kind: "IDLE" }
  | { readonly kind: "SUBMITTING" }
  | {
      readonly kind: "SAVED";
      readonly documentId: string;

      readonly replayed: boolean;
    }
  | { readonly kind: "DENIED"; readonly requestId: string }
  | {
      readonly kind: "REFUSED";
      readonly code: string;

      readonly field?: string;
    }
  | { readonly kind: "FAILED"; readonly code: string };

export const IDLE: WriteState = Object.freeze({ kind: "IDLE" as const });

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

export const isTerminal = (state: WriteState): boolean =>
  state.kind === "SAVED" || state.kind === "DENIED" || state.kind === "REFUSED";

/** Whether a control should be disabled because a request is outstanding. */
export const isBusy = (state: WriteState): boolean =>
  state.kind === "SUBMITTING";

export const invalidField = (state: WriteState): string | undefined =>
  state.kind === "REFUSED" ? state.field : undefined;

export const REQUEST_ID_PREFIX = "web_";

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
