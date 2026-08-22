"use client";

/**
 * The transaction-history screen's data panel. See `BalancesPanel` for why this
 * file is three lines of configuration.
 */
import { TransactionsTable } from "@/components/inventory/TransactionsTable";
import {
  listTransactionsRef,
  type TransactionRow,
} from "@/lib/convex/ledgerApi";

import { LedgerPanel } from "./LedgerPanel";

export function TransactionsPanel() {
  return (
    <LedgerPanel<TransactionRow>
      queryRef={listTransactionsRef}
      surface="history"
      renderRows={(rows) => <TransactionsTable rows={rows} />}
    />
  );
}
