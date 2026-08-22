/**
 * One state machine for every ledger panel, as a pure function.
 *
 * A read of the ledger can end in eight distinguishable ways, and a screen that
 * collapses any two of them lies to an operator. This module names all eight and
 * decides between them without touching React, the network, or the clock, which
 * is what makes them testable one by one:
 *
 * | State               | What is actually true                                          |
 * | ------------------- | -------------------------------------------------------------- |
 * | `BACKEND_MISSING`   | No `NEXT_PUBLIC_CONVEX_URL`. Nothing was asked.                  |
 * | `SIGN_IN_REQUIRED`  | No identity provider, so no verified token can exist.            |
 * | `WAREHOUSE_MISSING` | Every ledger read is warehouse-scoped; none is selected.         |
 * | `LOADING`           | Asked, no answer yet.                                            |
 * | `DENIED`            | The server decided, and the answer is no (`INV-0006-01`).        |
 * | `LEDGER_ERROR`      | Authorized, but the read itself was refused (bad cursor, scope). |
 * | `ERROR`             | Anything else, including an unreachable deployment.              |
 * | `READY`             | Rows, and whether there are more.                                |
 *
 * The order of the checks is the point. `BACKEND_MISSING` and
 * `SIGN_IN_REQUIRED` are decided *before* a query is issued, so an operator sees
 * "not configured" immediately instead of a spinner that resolves into a denial
 * a round trip later. `DENIED` outranks `LEDGER_ERROR` because the wrapper
 * decides authorization before the handler runs, so a denial means the handler
 * never executed and there is no ledger error to report.
 *
 * A denial is never explained further than the server explains it. The wrapper
 * returns one message and one coarse code for every refusal on purpose
 * (`INV-0002-07`): a UI that inferred "you lack `inventory.balance.read`" from a
 * generic denial would be guessing, and guessing right would turn the screen
 * into a permission oracle.
 */
import type {
  LedgerErrorPayload,
  LedgerPage,
  TenantOutcome,
} from "./ledgerApi";

import type { AppEnvironment } from "../environment";

/**
 * Whether a read is scoped to a warehouse.
 *
 * The ledger's reads all are. Master data is mixed: an item and a reason code
 * belong to the tenant, a location and a handling unit belong to a site. An
 * `ORG` read must *not* wait for a warehouse selection — asking a supervisor to
 * pick a site before they can see the item catalogue would be a fiction, and
 * `WAREHOUSE_MISSING` would be the wrong explanation for it.
 */
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
  /** The warehouse the reads are scoped to; `undefined` when none is chosen. */
  readonly warehouseId: string | undefined;
  /** The query's answer, or `undefined` while it is in flight. */
  readonly outcome: TenantOutcome<LedgerPage<Row>> | undefined;
  /** A thrown failure, if the query threw instead of answering. */
  readonly failure?: unknown;
  /** Whether the read is warehouse-scoped. Defaults to `WAREHOUSE`. */
  readonly scope?: ReadScope;
}

/** The code a failure with no readable structure is reported under. */
export const UNKNOWN_FAILURE_CODE = "UNKNOWN";

/**
 * Read the `code` out of a thrown Convex failure.
 *
 * A `ConvexError`'s `data` is whatever the server put there, so this is written
 * as a shape check rather than an `instanceof`: the browser may hold a different
 * copy of the Convex package than the one that constructed the error, and a
 * network-level throw is a plain `Error` with no `data` at all. Anything
 * unreadable becomes `UNKNOWN` rather than the error's own message, because a
 * raw message from an unknown source does not belong on a warehouse screen.
 */
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

/**
 * Whether a thrown failure is the wrapper refusing an anonymous caller.
 *
 * `ANONYMOUS` is what `resolveTenantContext` answers when
 * `ctx.auth.getUserIdentity()` is `null`. It is worth separating from every
 * other failure because it is the one an unconfigured machine will hit on every
 * read, and "sign in" is a different instruction from "something went wrong".
 */
export const isAnonymousFailure = (failure: unknown): boolean =>
  failureCodeOf(failure) === "ANONYMOUS";

/**
 * What can be decided before a query is issued.
 *
 * Separated from `toLedgerPanelState` so a caller can act on it: the panel has
 * to know not only *that* it is blocked but that it may now safely call
 * `useQuery` — which throws without a `ConvexProvider` — and it needs the
 * warehouse narrowed to a `string` to do it. Returning the warehouse on the
 * `READY_TO_QUERY` branch carries that narrowing to the caller instead of making
 * it re-check a value this function already checked.
 */
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

/** The refusal's code, defended against a payload that lost its `code`. */
const ledgerErrorCode = (error: LedgerErrorPayload): string =>
  typeof error.code === "string" && error.code.length > 0
    ? error.code
    : UNKNOWN_FAILURE_CODE;

/** Whether a state has rows the caller can render. Narrows for the caller. */
export const isReady = <Row>(
  state: LedgerPanelState<Row>,
): state is Extract<LedgerPanelState<Row>, { kind: "READY" }> =>
  state.kind === "READY";
