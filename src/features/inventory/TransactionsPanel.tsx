"use client";

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
