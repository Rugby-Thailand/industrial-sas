/**
 * Typed references to the ledger's public Convex functions, and the wire types
 * of what they answer.
 *
 * ### Why these are hand-declared rather than imported from `convex/_generated`
 *
 * `convex/_generated/` is git-ignored (it is a build artifact of `convex dev`),
 * so it is absent in CI and absent on a machine that has never run the Convex
 * CLI. An import of `convex/_generated/api` would make `pnpm typecheck` and
 * `pnpm build` fail for everyone who has not provisioned a deployment, which is
 * the opposite of this repository's rule that every guard passes with no vendor
 * configuration present.
 *
 * `makeFunctionReference` is the supported alternative: a function reference is
 * just a path string plus the argument and return types, and codegen exists to
 * infer those types, not to create the reference. The cost is that the types
 * below are a *claim* about `convex/inventory/ledger.ts` rather than a
 * derivation from it, so `ledgerApi.test.ts` re-reads that module and fails if a
 * referenced export disappears or is renamed.
 *
 * ### The envelope
 *
 * Every function registered through `queryWithOrg`/`mutationWithOrg` answers a
 * `TenantOutcome`: `{ ok: true, value }` on success, `{ ok: false, denial }` when
 * authorization refused. An *unauthenticated* call is neither — the wrapper
 * throws a `ConvexError` carrying a tenant-context denial, because there is no
 * tenant to answer for. `toLedgerFailure` in `ledgerState.ts` is where those
 * three shapes become one union the UI can switch on.
 *
 * Only the read functions are declared here. `postTransaction` and
 * `reverseTransaction` exist on the server and have no caller in this milestone:
 * a write UI without a resolved tenant could not post anything, and a button
 * that always denies is worse than no button.
 */
import { makeFunctionReference } from "convex/server";

/* -------------------------------------------------------------------------- */
/* Envelope                                                                    */
/* -------------------------------------------------------------------------- */

/** The public form of an authorization denial (`toPublicAuthorizationDenial`). */
export interface PublicDenial {
  readonly kind: "AUTHORIZATION_DENIED";
  readonly code: string;
  readonly requestId: string;
  readonly message: string;
}

/** What every tenant-bound function answers (`TenantFunctionOutcome`). */
export type TenantOutcome<Value> =
  | { readonly ok: true; readonly requestId: string; readonly value: Value }
  | {
      readonly ok: false;
      readonly requestId: string;
      readonly denial: PublicDenial;
    };

/* -------------------------------------------------------------------------- */
/* Wire shapes                                                                 */
/* -------------------------------------------------------------------------- */

/** A structured ledger refusal (`toPublicLedgerError`). */
export interface LedgerErrorPayload {
  readonly code: string;
  readonly field?: string;
  readonly reason?: string;
  readonly bucketKey?: string;
  readonly expected?: string;
  readonly received?: string;
}

/** One row of `listBalances` (`wireBalanceSummary`). */
export interface BalanceRow {
  readonly bucketKey: string;
  readonly stockStatus: string;
  readonly uom: string;
  readonly minorUnits: number;
}

/** One row of `listTransactions` (`wireTransactionSummary`). */
export interface TransactionRow {
  readonly transactionId: string;
  readonly type: string;
  readonly operation: string;
  readonly requestId: string;
  readonly occurredAt: number;
  readonly businessDate: string;
  readonly lineCount: number;
  readonly reversalOfTransactionId?: string;
}

/** A bounded, resumable page, or the refusal that replaced it. */
export type LedgerPage<Row> =
  | {
      readonly ok: true;
      readonly items: readonly Row[];
      readonly nextCursor: string | null;
      readonly complete: boolean;
    }
  | { readonly ok: false; readonly error: LedgerErrorPayload };

/**
 * The arguments every paged ledger read takes.
 *
 * A type alias rather than an interface, deliberately: Convex constrains a
 * function's arguments to `Record<string, any>`, and TypeScript gives an object
 * *type* an implicit index signature while withholding one from an interface. An
 * interface here fails to satisfy `DefaultFunctionArgs` for a reason that has
 * nothing to do with this code.
 */
export type LedgerPageArgs = {
  readonly warehouseId: string;
  readonly maxPageSize?: number;
  readonly cursor?: string;
};

/* -------------------------------------------------------------------------- */
/* References                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Convex resolves a function by `"<path within convex/>:<export>"`, with the
 * `.ts` extension dropped and directory separators kept. These four strings are
 * the only place the application names a server function.
 */
export const LEDGER_FUNCTION_PATHS = Object.freeze({
  listBalances: "inventory/ledger:listBalances",
  listTransactions: "inventory/ledger:listTransactions",
});

export const listBalancesRef = makeFunctionReference<
  "query",
  LedgerPageArgs,
  TenantOutcome<LedgerPage<BalanceRow>>
>(LEDGER_FUNCTION_PATHS.listBalances);

export const listTransactionsRef = makeFunctionReference<
  "query",
  LedgerPageArgs,
  TenantOutcome<LedgerPage<TransactionRow>>
>(LEDGER_FUNCTION_PATHS.listTransactions);

/**
 * The server's own page-size cap (`MAX_JOB_PAGE_SIZE`, re-exported from the
 * ledger module as `maxLedgerPageSize`).
 *
 * Restated rather than imported because importing `convex/inventory/ledger.ts`
 * into the browser bundle would pull the whole Convex server runtime with it. A
 * page size above the server's cap is *refused* rather than clamped, so a UI that
 * guessed too high would show an error instead of rows; the drift test pins this
 * number against the server constant.
 */
export const MAX_LEDGER_PAGE_SIZE = 100;

/** What the screens actually ask for: enough to fill a table, well under the cap. */
export const DEFAULT_LEDGER_PAGE_SIZE = 25;
