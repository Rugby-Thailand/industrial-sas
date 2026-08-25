import { api } from "../../../convex/_generated/api";

import { clientRef } from "./clientRef";

export interface PublicDenial {
  readonly kind: "AUTHORIZATION_DENIED";
  readonly code: string;
  readonly requestId: string;
  readonly message: string;
}

export type TenantOutcome<Value> =
  | { readonly ok: true; readonly requestId: string; readonly value: Value }
  | {
      readonly ok: false;
      readonly requestId: string;
      readonly denial: PublicDenial;
    };

export interface LedgerErrorPayload {
  readonly code: string;
  readonly field?: string;
  readonly reason?: string;
  readonly bucketKey?: string;
  readonly expected?: string;
  readonly received?: string;
}

export interface BalanceRow {
  readonly bucketKey: string;
  readonly stockStatus: string;
  readonly uom: string;
  readonly minorUnits: number;
}

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

export type LedgerPage<Row> =
  | {
      readonly ok: true;
      readonly items: readonly Row[];
      readonly nextCursor: string | null;
      readonly complete: boolean;
    }
  | { readonly ok: false; readonly error: LedgerErrorPayload };

export type LedgerPageArgs = {
  readonly warehouseId: string;
  readonly maxPageSize?: number;
  readonly cursor?: string;
};

export const listBalancesRef = clientRef(api.inventory.ledger.listBalances);

export const listTransactionsRef = clientRef(
  api.inventory.ledger.listTransactions,
);

export const DEFAULT_LEDGER_PAGE_SIZE = 25;
