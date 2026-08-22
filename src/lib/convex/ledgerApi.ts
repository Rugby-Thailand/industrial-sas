/**
 * Typed references to the ledger's public Convex functions, and the wire types
 * of what they answer.
 *
 * ### Generated references, presentation-owned wire types
 *
 * Function references come from committed, credential-free Convex codegen, so a
 * server rename or argument/return change is a type error. The named row/page
 * types remain here because they are the small presentation interface shared by
 * the generic ledger panels.
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
import { api } from "../../../convex/_generated/api";

import { clientRef } from "./clientRef";

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

export const listBalancesRef = clientRef(api.inventory.ledger.listBalances);

export const listTransactionsRef = clientRef(
  api.inventory.ledger.listTransactions,
);

/** What the screens actually ask for: enough to fill a table, well under the cap. */
export const DEFAULT_LEDGER_PAGE_SIZE = 25;
