import type {
  LedgerErrorPayload,
  LedgerPage,
  TenantOutcome,
} from "./ledgerApi";

import type { AppEnvironment } from "../environment";

export type ReadScope = "ORG" | "WAREHOUSE";

export type LedgerPanelState<Row> =
  | { readonly kind: "BACKEND_MISSING" }
  | { readonly kind: "SIGN_IN_REQUIRED" }
  | { readonly kind: "WAREHOUSE_MISSING" }
  | { readonly kind: "LOADING" }
  | { readonly kind: "DENIED"; readonly requestId: string }
  | {
      readonly kind: "LEDGER_ERROR";
      readonly code: string;
      readonly requestId: string;
    }
  | { readonly kind: "ERROR"; readonly code: string }
  | {
      readonly kind: "READY";
      readonly rows: readonly Row[];
      readonly nextCursor: string | null;
      readonly complete: boolean;
      readonly requestId: string;
    };

export interface LedgerPanelInput<Row> {
  readonly environment: AppEnvironment;

  readonly warehouseId: string | undefined;

  readonly outcome: TenantOutcome<LedgerPage<Row>> | undefined;

  readonly failure?: unknown;

  readonly scope?: ReadScope;
}

export const UNKNOWN_FAILURE_CODE = "UNKNOWN";

export function failureCodeOf(failure: unknown): string {
  if (typeof failure !== "object" || failure === null) {
    return UNKNOWN_FAILURE_CODE;
  }
  const data = (failure as { readonly data?: unknown }).data;
  if (typeof data !== "object" || data === null) return UNKNOWN_FAILURE_CODE;
  const code = (data as { readonly code?: unknown }).code;
  return typeof code === "string" && code.length > 0
    ? code
    : UNKNOWN_FAILURE_CODE;
}

export const isAnonymousFailure = (failure: unknown): boolean =>
  failureCodeOf(failure) === "ANONYMOUS";

export type LedgerGate =
  | { readonly kind: "BACKEND_MISSING" }
  | { readonly kind: "SIGN_IN_REQUIRED" }
  | { readonly kind: "WAREHOUSE_MISSING" }
  | { readonly kind: "READY_TO_QUERY"; readonly warehouseId: string };

export function resolveLedgerGate(
  environment: AppEnvironment,
  warehouseId: string | undefined,
  scope: ReadScope = "WAREHOUSE",
): LedgerGate {
  if (!environment.backendConfigured) {
    return { kind: "BACKEND_MISSING" };
  }
  if (!environment.identityConfigured) {
    return { kind: "SIGN_IN_REQUIRED" };
  }
  if (scope === "ORG") return { kind: "READY_TO_QUERY", warehouseId: "" };
  if (warehouseId === undefined) return { kind: "WAREHOUSE_MISSING" };
  return { kind: "READY_TO_QUERY", warehouseId };
}

export function toLedgerPanelState<Row>(
  input: LedgerPanelInput<Row>,
): LedgerPanelState<Row> {
  const { environment, warehouseId, outcome, failure } = input;

  const gate = resolveLedgerGate(environment, warehouseId, input.scope);
  if (gate.kind !== "READY_TO_QUERY") return gate;

  if (failure !== undefined) {
    return isAnonymousFailure(failure)
      ? { kind: "SIGN_IN_REQUIRED" }
      : { kind: "ERROR", code: failureCodeOf(failure) };
  }
  if (outcome === undefined) return { kind: "LOADING" };
  if (!outcome.ok) return { kind: "DENIED", requestId: outcome.requestId };

  const page = outcome.value;
  if (!page.ok) {
    return {
      kind: "LEDGER_ERROR",
      code: ledgerErrorCode(page.error),
      requestId: outcome.requestId,
    };
  }

  return {
    kind: "READY",
    rows: page.items,
    nextCursor: page.nextCursor,
    complete: page.complete,
    requestId: outcome.requestId,
  };
}

const ledgerErrorCode = (error: LedgerErrorPayload): string =>
  typeof error.code === "string" && error.code.length > 0
    ? error.code
    : UNKNOWN_FAILURE_CODE;

export const isReady = <Row>(
  state: LedgerPanelState<Row>,
): state is Extract<LedgerPanelState<Row>, { kind: "READY" }> =>
  state.kind === "READY";
